import test from "node:test";
import assert from "node:assert/strict";
import router from "../api/router.js";

test("featured Boost API preserves staff session, request validation and dependency failures", async t => {
  const account = "00000000-0000-4000-8000-000000000001", server = "22222222-2222-4222-8222-222222222222", csrf = "c".repeat(43);
  const token = `fixture.${Buffer.from(JSON.stringify({ sub: account, aal: "aal2" })).toString("base64url")}.fixture`;
  const previous = { ...process.env }, originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key]; Object.assign(process.env, previous); });
  Object.assign(process.env, { NODE_ENV: "test", VERCEL: "0", APP_URL: "http://localhost:8080", SUPABASE_URL: "https://fixture.supabase.co", SUPABASE_PUBLISHABLE_KEY: "sb_publishable_fixture", SUPABASE_SECRET_KEY: "sb_secret_fixture", PRIVACY_HASH_SECRET: "fixture-only-secret" });
  const calls = []; let fail = "", provider = "discord", manage = true;
  globalThis.fetch = async (url, options = {}) => {
    const path = new URL(url).pathname, body = options.body ? JSON.parse(options.body) : null;
    calls.push({ path, body, options }); let payload, status = 200;
    if (path === "/auth/v1/user") payload = { id: account, app_metadata: { provider, providers: [provider] }, identities: [{ provider, provider_id: "fixture" }] };
    else if (path.endsWith("/rpc/check_security_ban_server")) payload = null;
    else if (path.endsWith("/rpc/consume_rate_limit")) payload = true;
    else if (path.endsWith("/rpc/staff_featured_boost_control")) payload = manage ? { canManage: true, active: null, version: 0, servers: [] } : { canManage: false };
    else if (path.endsWith("/rpc/staff_set_featured_boost")) payload = { version: 1, serverId: server };
    else throw new Error(`Unexpected fixture request ${path}`);
    if (fail && path.endsWith(fail)) { status = 503; payload = { message: "Fixture dependency unavailable" }; }
    if (fail === "permission" && path.endsWith("/rpc/staff_set_featured_boost")) { status = 403; payload = { code: "42501", message: "Current staff permission required" }; }
    if (fail === "conflict" && path.endsWith("/rpc/staff_set_featured_boost")) { status = 409; payload = { code: "PT409", message: "The featured boost changed. Reload and try again." }; }
    return new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } });
  };
  const request = async (body, method = "POST", extra = {}) => {
    const headers = new Map(); let value;
    const res = { setHeader: (name, content) => headers.set(name.toLowerCase(), content), getHeader: name => headers.get(name.toLowerCase()), end: payload => { value = JSON.parse(payload); } };
    await router({ browserpRoute: "admin/featured-boost", method, url: "/api/admin/featured-boost", body, headers: { host: "localhost:8080", origin: "http://localhost:8080", "content-type": "application/json", "x-browserp-csrf": csrf, cookie: `brp_access=${token}; brp_csrf=${csrf}`, ...extra }, socket: { remoteAddress: "127.0.0.1" } }, res);
    return { status: res.statusCode, value, headers };
  };
  const valid = { action: "start", serverId: server, durationHours: 24, expectedVersion: 0, reason: "A reviewed homepage feature" };
  const writes = () => calls.filter(x => x.path.endsWith("/rpc/staff_set_featured_boost"));
  await t.test("reads and mutations use the caller token and private response caching", async () => {
    for (const [body, method] of [[null, "GET"], [valid, "POST"], [{ action: "end", expectedVersion: 1, reason: valid.reason }, "POST"]]) {
      const result = await request(body, method); assert.equal(result.status, 200); assert.equal(result.headers.get("cache-control"), "no-store");
      const last = calls.at(-1); assert.equal(last.options.headers.Authorization, `Bearer ${token}`);
    }
    assert.deepEqual(writes()[0].body, { p_action: "start", p_server_id: server, p_duration_hours: 24, p_expected_version: 0, p_reason: valid.reason, p_request_id: writes()[0].body.p_request_id });
    assert.match(writes()[0].body.p_request_id, /^[a-f\d-]{36}$/i);
    assert.equal(writes().at(-1).body.p_server_id, null); assert.equal(writes().at(-1).body.p_duration_hours, null);
    manage = false; const result = await request(null, "GET"); assert.equal(result.status, 200); assert.deepEqual(result.value.feature, { canManage: false }); manage = true;
  });
  await t.test("invalid actions, IDs, reasons, durations and absent or coerced versions never reach the write RPC", async () => {
    const before = writes().length;
    for (const delta of [
      { action: ["start"] }, { action: null }, { action: "other" }, { serverId: "invalid" }, { reason: "no" },
      ...[undefined, null, false, "", "0", [], -1, 1.5, Number.MAX_SAFE_INTEGER + 1].map(expectedVersion => ({ expectedVersion })),
      ...[undefined, null, true, "24", 0, -1, 721, 1.5].map(durationHours => ({ durationHours }))
    ]) assert.equal((await request({ ...valid, ...delta })).status, 400, JSON.stringify(delta));
    assert.equal(writes().length, before);
  });
  await t.test("signed-out, wrong-provider, cross-origin and CSRF-invalid access never writes", async () => {
    const before = writes().length;
    assert.equal((await request(null, "GET", { cookie: "" })).status, 401);
    assert.equal((await request(valid, "POST", { origin: "https://untrusted.example" })).status, 403);
    assert.equal((await request(valid, "POST", { "x-browserp-csrf": "wrong" })).status, 403);
    provider = "google"; assert.equal((await request(valid)).status, 403); provider = "discord";
    assert.equal(writes().length, before);
    assert.equal((await request(valid, "DELETE")).status, 405);
  });
  await t.test("current permission denial and version conflicts remain errors", async () => {
    for (const [kind, status] of [["permission", 403], ["conflict", 409]]) {
      fail = kind; const result = await request(valid); assert.equal(result.status, status); assert.equal(result.value.result, undefined);
    }
    fail = "";
  });
  await t.test("failed dependencies cannot fabricate success or bypass the rate limiter", async () => {
    for (const dependency of ["/rpc/consume_rate_limit", "/rpc/staff_set_featured_boost"]) {
      const before = writes().length; fail = dependency;
      const result = await request(valid); assert.equal(result.status, 503); assert.equal(result.value.result, undefined);
      assert.equal(writes().length - before, dependency.endsWith("consume_rate_limit") ? 0 : 1);
    }
    fail = "/rpc/staff_featured_boost_control";
    const result = await request(null, "GET"); assert.equal(result.status, 503); assert.equal(result.value.feature, undefined); fail = "";
  });
});
