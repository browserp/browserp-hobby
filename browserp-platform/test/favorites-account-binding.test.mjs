import test from "node:test";
import assert from "node:assert/strict";
import router from "../api/router.js";

const accountId = "00000000-0000-4000-8000-000000000001";
const otherAccountId = "00000000-0000-4000-8000-000000000002";
const serverId = "00000000-0000-4000-8000-000000000003";
const csrf = "c".repeat(43);
const access = `fixture.${Buffer.from(JSON.stringify({ sub: accountId, aal: "aal1", session_id: "00000000-0000-4000-8000-000000000004" })).toString("base64url")}.fixture`;
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });

async function fixture(run, { provider = "discord", allowed = true, toggleStatus = 200 } = {}) {
  const environment = {
    SUPABASE_URL: "https://fixture.supabase.co", SUPABASE_PUBLISHABLE_KEY: "sb_publishable_fixture",
    SUPABASE_SECRET_KEY: "sb_secret_fixture", PRIVACY_HASH_SECRET: "fixture-private-hash",
    APP_URL: "http://localhost:8080", NODE_ENV: "test", VERCEL: "0", VERCEL_ENV: ""
  };
  const previous = new Map(Object.keys(environment).map(key => [key, process.env[key]]));
  const realFetch = globalThis.fetch;
  const calls = [];
  Object.assign(process.env, environment);
  globalThis.fetch = async (value, options = {}) => {
    const url = new URL(value);
    assert.equal(url.origin, environment.SUPABASE_URL, "the fixture must not contact a real backend");
    const body = options.body ? JSON.parse(options.body) : null;
    calls.push({ path: url.pathname, body, authorization: options.headers?.Authorization });
    if (url.pathname === "/auth/v1/user") return json({
      id: accountId,
      app_metadata: { provider, providers: [provider] },
      identities: [{ provider, provider_id: "fixture-provider-user" }]
    });
    if (url.pathname.endsWith("/rpc/check_security_ban_server")) return json(null);
    if (url.pathname.endsWith("/rpc/consume_rate_limit")) return json(allowed);
    if (url.pathname.endsWith("/rpc/member_favorite_ids")) return json([serverId]);
    if (url.pathname.endsWith("/rpc/toggle_favorite")) return json(toggleStatus === 200
      ? { serverId, favorited: true, count: 1 }
      : { code: "unexpected_failure", message: "Temporary database failure" }, toggleStatus);
    throw new Error(`Unexpected fixture endpoint: ${url.pathname}`);
  };
  try { await run(calls); }
  finally {
    globalThis.fetch = realFetch;
    for (const [key, value] of previous) value === undefined ? delete process.env[key] : process.env[key] = value;
  }
}

async function request(body = { serverId }, { method = "POST", authenticated = true, headers = {} } = {}) {
  const outputHeaders = new Map();
  const res = {
    setHeader: (key, value) => outputHeaders.set(key.toLowerCase(), value),
    getHeader: key => outputHeaders.get(key.toLowerCase()),
    end: value => { res.body = JSON.parse(value); }
  };
  const req = {
    method, browserpRoute: "me/favorites", url: "/api/me/favorites", body,
    socket: { remoteAddress: "127.0.0.1" },
    headers: {
      host: "localhost:8080", origin: "http://localhost:8080", "content-type": "application/json",
      cookie: `${authenticated ? `brp_access=${access}; ` : ""}brp_csrf=${csrf}`,
      "x-browserp-csrf": csrf, ...headers
    }
  };
  await router(req, res);
  assert.equal(res.getHeader("Cache-Control"), "no-store", "private favorites responses are never cacheable");
  return res;
}

const toggles = calls => calls.filter(call => call.path.endsWith("/rpc/toggle_favorite"));

test("favorites accepts the matching account binding and legacy omitted binding for ordinary Discord and Google members", async () => {
  for (const provider of ["discord", "google"]) {
    for (const body of [{ serverId, accountId }, { serverId }]) {
      await fixture(async calls => {
        const res = await request(body);
        assert.equal(res.statusCode, 200);
        assert.deepEqual(res.body, { result: { serverId, favorited: true, count: 1 } });
        assert.deepEqual(toggles(calls), [{
          path: "/rest/v1/rpc/toggle_favorite", body: { p_server_id: serverId }, authorization: `Bearer ${access}`
        }], "the authenticated token, never the submitted account ID, owns the write");
        const rate = calls.find(call => call.path.endsWith("/rpc/consume_rate_limit"));
        assert.equal(rate.body.p_action, "favorite-toggle");
        assert.equal(rate.body.p_limit, 40);
        assert.equal(rate.body.p_window_seconds, 300);
      }, { provider });
    }
  }
});

test("favorites rejects a changed or malformed explicit account binding before any toggle despite valid current cookies and CSRF", async () => {
  for (const suppliedId of [otherAccountId, null, "", false, 123, [accountId], { id: accountId }]) {
    await fixture(async calls => {
      const res = await request({ serverId, accountId: suppliedId });
      assert.equal(res.statusCode, 409);
      assert.match(res.body.error, /signed-in account changed.*Refresh before changing saved servers/);
      assert.deepEqual(toggles(calls), []);
      assert.ok(calls.some(call => call.path === "/auth/v1/user"), "binding is checked against verified current identity");
    });
  }
});

test("favorites retains authentication, CSRF, origin and rate-limit checks for account-bound requests", async () => {
  const cases = [
    [{ authenticated: false }, {}, 401],
    [{ headers: { "x-browserp-csrf": "wrong" } }, {}, 403],
    [{ headers: { origin: "https://untrusted.example" } }, {}, 403],
    [{}, { allowed: false }, 429]
  ];
  for (const [options, fixtureOptions, status] of cases) {
    await fixture(async calls => {
      const res = await request({ serverId, accountId }, options);
      assert.equal(res.statusCode, status);
      assert.deepEqual(toggles(calls), []);
    }, fixtureOptions);
  }
});

test("favorites GET retains its private current-member IDs contract without toggling", async () => fixture(async calls => {
  const res = await request(undefined, { method: "GET" });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { serverIds: [serverId] });
  assert.deepEqual(toggles(calls), []);
  const read = calls.find(call => call.path.endsWith("/rpc/member_favorite_ids"));
  assert.equal(read.authorization, `Bearer ${access}`);
}));

test("favorites does not retry an uncertain non-idempotent toggle", async () => fixture(async calls => {
  const res = await request({ serverId, accountId });
  assert.equal(res.statusCode, 503);
  assert.equal(toggles(calls).length, 1);
}, { toggleStatus: 503 }));
