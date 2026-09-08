import test from "node:test";
import assert from "node:assert/strict";
import router from "../api/router.js";

// Entirely synthetic Auth responses. No network requests, live accounts or
// credential material are involved in these regression cases.
const account = {
  id: "00000000-0000-4000-8000-000000000006",
  app_metadata: { provider: "discord", providers: ["discord"] },
  identities: [{ provider: "discord" }]
};
const csrf = "c".repeat(43);
const activeAccess = `fixture.${Buffer.from(JSON.stringify({ sub: account.id, aal: "aal1" })).toString("base64url")}.fixture`;
const providerDetail = "SYNTHETIC_PRIVATE_PROVIDER_DETAIL";
const response = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { "Content-Type": "application/json" }
});

async function logoutFixture({ access = "valid", logoutFailure = false }, check) {
  const values = {
    SUPABASE_URL: "https://fixture.supabase.co",
    SUPABASE_PUBLISHABLE_KEY: "sb_publishable_fixture",
    SUPABASE_SECRET_KEY: "sb_secret_fixture",
    PRIVACY_HASH_SECRET: "fixture-private-hash",
    NETWORK_EVIDENCE_KEY: "",
    APP_URL: "http://localhost:8080", NODE_ENV: "test", VERCEL: "0", VERCEL_ENV: ""
  };
  const previous = new Map(Object.keys(values).map(key => [key, process.env[key]]));
  const originalFetch = globalThis.fetch;
  const originalError = console.error;
  Object.assign(process.env, values);
  const observed = { sessionActive: true, refreshes: 0, logoutAttempts: 0, usedValidatedAccess: false, errorLogs: [] };
  console.error = (...values) => { observed.errorLogs.push(values); };
  globalThis.fetch = async (value, options = {}) => {
    const url = new URL(value);
    assert.equal(url.origin, "https://fixture.supabase.co");
    if (url.pathname === "/auth/v1/user") {
      return options.headers?.Authorization === `Bearer ${activeAccess}`
        ? response(account) : response({ code: "bad_jwt" }, 401);
    }
    if (url.pathname === "/auth/v1/token") {
      assert.equal(url.searchParams.get("grant_type"), "refresh_token");
      observed.refreshes++;
      return response({ user: account, access_token: activeAccess, refresh_token: "fixture-rotated-refresh", expires_in: 3600 });
    }
    if (url.pathname === "/auth/v1/logout") {
      observed.logoutAttempts++;
      observed.usedValidatedAccess = options.headers?.Authorization === `Bearer ${activeAccess}`;
      if (!observed.usedValidatedAccess) return response({ code: "bad_jwt" }, 401);
      if (logoutFailure) return response({ code: "unexpected_failure", message: `${providerDetail} ${activeAccess}`, refresh_token: "fixture-refresh" }, 503);
      observed.sessionActive = false;
      return response({});
    }
    if (["/rest/v1/rpc/check_security_ban_server", "/rest/v1/rpc/record_account_activity_server"].includes(url.pathname)) return response(null);
    throw new Error(`Unexpected synthetic Auth request: ${url.pathname}`);
  };
  try {
    const accessCookie = access === "absent" ? "" : `brp_access=${access === "valid" ? activeAccess : "fixture-expired-access"}; `;
    const req = {
      method: "POST", browserpRoute: "auth/logout", url: "/api/auth/logout",
      headers: {
        host: "localhost:8080", origin: "http://localhost:8080",
        cookie: `${accessCookie}brp_refresh=fixture-refresh; brp_csrf=${csrf}`,
        "x-browserp-csrf": csrf
      },
      socket: { remoteAddress: "127.0.0.1" }
    };
    const headers = new Map();
    const res = {
      setHeader: (key, value) => headers.set(key, value), getHeader: key => headers.get(key),
      end: value => { res.body = JSON.parse(value); }
    };
    await router(req, res);
    await check(observed, res);
  } finally {
    globalThis.fetch = originalFetch;
    console.error = originalError;
    for (const [key, value] of previous) value === undefined ? delete process.env[key] : process.env[key] = value;
  }
}

test("logout revokes the current provider session when the access cookie remains valid", async () => {
  await logoutFixture({}, (observed, res) => {
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.signedOut, true);
    assert.equal(observed.refreshes, 0);
    assert.equal(observed.usedValidatedAccess, true);
    assert.equal(observed.sessionActive, false);
  });
});

for (const access of ["absent", "expired"]) {
  test(`logout revokes the refreshed provider session when the access cookie is ${access}`, async () => {
    await logoutFixture({ access }, (observed, res) => {
      assert.equal(observed.refreshes, 1, "The expired browser session should be refreshed only once");
      assert.equal(observed.sessionActive, false, "Local sign-out must also revoke the refreshed provider session");
      assert.equal(observed.usedValidatedAccess, true, "Revocation must use the validated token returned by getSession");
      assert.equal(res.statusCode, 200);
      assert.equal(res.body.signedOut, true);
    });
  });
}

test("logout does not report unqualified success when provider revocation fails", async () => {
  await logoutFixture({ logoutFailure: true }, (observed, res) => {
    assert.equal(observed.sessionActive, true);
    assert.equal(observed.logoutAttempts, 1, "A failed logout should not trigger an unbounded retry");
    // The endpoint may fail the operation, or explicitly distinguish a local
    // cookie clear from unsuccessful server revocation using sessionsEnded.
    assert.ok(res.statusCode >= 400 || res.body.signedOut !== true || res.body.sessionsEnded === false,
      "A surviving server session must be reported instead of an unqualified signedOut:true");
    assert.equal(res.getHeader("Cache-Control"), "no-store");
    const outward = JSON.stringify({ response: res.body, logs: observed.errorLogs });
    assert.equal(outward.includes(providerDetail), false, "Provider details must not reach either the response or logs");
    assert.equal(outward.includes(activeAccess), false, "The access token must not reach either the response or logs");
    assert.equal(outward.includes("fixture-refresh"), false, "The refresh token must not reach either the response or logs");
  });
});
