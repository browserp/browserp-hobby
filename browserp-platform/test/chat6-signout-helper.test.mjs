import test from "node:test";
import assert from "node:assert/strict";
import { getSession, signOut } from "../lib/supabase.js";

const csrf = "c".repeat(43);
const user = { id: "00000000-0000-4000-8000-000000000006", app_metadata: { provider: "discord", providers: ["discord"] }, identities: [{ provider: "discord" }] };
const access = `fixture.${Buffer.from(JSON.stringify({ sub: user.id, aal: "aal1" })).toString("base64url")}.fixture`;
const cookieBases = ["brp_access", "brp_refresh", "brp_csrf", "brp_discord_claim", "brp_pkce", "brp_auth_return", "brp_auth_provider", "brp_auth_claims", "brp_link_user", "brp_link_session", "brp_link_authenticated", "brp_oauth_state", "brp_oauth_nonce"];
const response = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });

async function fixture(fetcher, run) {
  const env = { SUPABASE_URL: "https://fixture.supabase.co", SUPABASE_PUBLISHABLE_KEY: "sb_publishable_fixture", SUPABASE_SECRET_KEY: "", NODE_ENV: "production", VERCEL: "1", APP_URL: "https://www.browserp.com" };
  const previous = new Map(Object.keys(env).map(key => [key, process.env[key]]));
  const previousFetch = globalThis.fetch;
  Object.assign(process.env, env);
  const calls = [];
  globalThis.fetch = async (value, options = {}) => {
    const url = new URL(value);
    assert.equal(url.origin, "https://fixture.supabase.co", "Only synthetic requests are permitted");
    calls.push({ url, options });
    return fetcher(url, options);
  };
  const headers = new Map();
  const res = { setHeader: (name, value) => headers.set(name, value), getHeader: name => headers.get(name) };
  try { await run({ calls, res }); }
  finally {
    globalThis.fetch = previousFetch;
    for (const [key, value] of previous) value === undefined ? delete process.env[key] : process.env[key] = value;
  }
}

function request({ cookie = `__Host-brp_access=${access}; __Host-brp_refresh=fixture-refresh; __Host-brp_csrf=${csrf}`, csrfHeader = csrf } = {}) {
  return { method: "POST", url: "/api/auth/logout", headers: { host: "www.browserp.com", cookie, "x-browserp-csrf": csrfHeader } };
}

function assertExpiredCookies(res) {
  const cookies = res.getHeader("Set-Cookie") || [];
  for (const base of cookieBases) {
    for (const name of [base, `__Host-${base}`]) {
      const last = cookies.filter(value => value.startsWith(`${name}=`)).at(-1);
      assert.ok(last, `The ${name} cookie must be cleared`);
      assert.ok(last.startsWith(`${name}=;`), `The final ${name} cookie must contain no token`);
      assert.match(last, /(?:^|; )Max-Age=0(?:;|$)/);
      assert.match(last, /(?:^|; )Path=\/(?:;|$)/);
      assert.match(last, /(?:^|; )HttpOnly(?:;|$)/);
      assert.match(last, /(?:^|; )Secure(?:;|$)/);
      assert.doesNotMatch(last, /(?:^|; )Domain=/);
    }
  }
}

test("signOut revokes with the supplied validated token and clears every host and legacy session cookie", async () => {
  await fixture((url, options) => {
    assert.equal(url.pathname, "/auth/v1/logout");
    assert.equal(options.method, "POST");
    assert.equal(options.headers.Authorization, `Bearer ${access}`);
    return response({});
  }, async ({ calls, res }) => {
    await signOut(request(), res, access);
    assert.equal(calls.length, 1);
    assertExpiredCookies(res);
  });
});

for (const priorAccess of ["absent", "expired"]) {
  test(`signOut uses the refreshed validated session when the original access cookie is ${priorAccess}`, async () => {
    await fixture((url, options) => {
      if (url.pathname === "/auth/v1/user") return response({ code: "bad_jwt" }, 401);
      if (url.pathname === "/auth/v1/token") {
        assert.equal(url.searchParams.get("grant_type"), "refresh_token");
        return response({ user, access_token: access, refresh_token: "fixture-rotated-refresh", expires_in: 3600 });
      }
      assert.equal(url.pathname, "/auth/v1/logout");
      assert.equal(options.headers.Authorization, `Bearer ${access}`);
      return response({});
    }, async ({ calls, res }) => {
      const stale = priorAccess === "absent" ? "" : "__Host-brp_access=fixture-expired-access; ";
      const req = request({ cookie: `${stale}__Host-brp_refresh=fixture-refresh; __Host-brp_csrf=${csrf}` });
      const session = await getSession(req, res);
      await signOut(req, res, session?.accessToken);
      assert.equal(calls.filter(call => call.url.pathname === "/auth/v1/token").length, 1);
      assert.equal(calls.filter(call => call.url.pathname === "/auth/v1/logout").length, 1);
      assertExpiredCookies(res);
    });
  });
}

for (const failure of ["provider", "network"]) {
  test(`signOut sanitizes ${failure} failure and still clears every host and legacy session cookie`, async () => {
    const confidential = "SYNTHETIC_PROVIDER_PRIVATE_DETAIL";
    await fixture(() => {
      if (failure === "network") throw new Error(`${confidential} ${access}`);
      return response({ message: `${confidential} ${access}`, access_token: access, refresh_token: "fixture-refresh" }, 503);
    }, async ({ calls, res }) => {
      await assert.rejects(signOut(request(), res, access), error => {
        assert.equal(error.status, 502);
        assert.equal(error.code, "SESSION_REVOCATION_FAILED");
        assert.match(error.message, /signed out here/);
        assert.equal(error.payload, undefined);
        assert.equal(error.cause, undefined);
        const outward = `${String(error)} ${error.stack || ""} ${JSON.stringify(error)}`;
        assert.equal(outward.includes(confidential), false);
        assert.equal(outward.includes(access), false);
        assert.equal(outward.includes("fixture-refresh"), false);
        return true;
      });
      assert.equal(calls.length, 1, "A logout failure should not produce repeated provider calls");
      assertExpiredCookies(res);
    });
  });
}

test("signOut clears a browser with no session without calling Auth or requiring a CSRF token", async () => {
  await fixture(() => { throw new Error("No-session logout must not call Auth"); }, async ({ calls, res }) => {
    await signOut(request({ cookie: "", csrfHeader: "" }), res);
    assert.equal(calls.length, 0);
    assertExpiredCookies(res);
  });
});

test("signOut never substitutes a raw request cookie for an absent validated session", async () => {
  await fixture(() => { throw new Error("An unvalidated cookie must not authorize provider logout"); }, async ({ calls, res }) => {
    await signOut(request(), res);
    assert.equal(calls.length, 0);
    assertExpiredCookies(res);
  });
});

for (const csrfHeader of ["", "x".repeat(43)]) {
  test(`signOut rejects ${csrfHeader ? "mismatched" : "missing"} CSRF before provider revocation or cookie mutation`, async () => {
    await fixture(() => { throw new Error("CSRF failure must precede Auth"); }, async ({ calls, res }) => {
      await assert.rejects(signOut(request({ csrfHeader }), res, access), error => error.status === 403 && error.code === "CSRF_TOKEN_INVALID");
      assert.equal(calls.length, 0);
      assert.equal(res.getHeader("Set-Cookie"), undefined);
    });
  });
}
