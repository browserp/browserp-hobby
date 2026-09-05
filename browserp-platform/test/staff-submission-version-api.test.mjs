import test from "node:test";
import assert from "node:assert/strict";
import router from "../api/router.js";

test("staff listing decisions require both displayed versions; other review kinds keep their own handlers", async t => {
  const account = "00000000-0000-4000-8000-000000000001", submission = "22222222-0000-4000-8000-000000000002", csrf = "c".repeat(43);
  const token = `fixture.${Buffer.from(JSON.stringify({ sub: account, aal: "aal2" })).toString("base64url")}.fixture`;
  const previous = { ...process.env }, originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key]; Object.assign(process.env, previous); });
  Object.assign(process.env, { NODE_ENV: "test", VERCEL: "0", APP_URL: "http://localhost:8080", SUPABASE_URL: "https://fixture.supabase.co", SUPABASE_PUBLISHABLE_KEY: "sb_publishable_fixture", SUPABASE_SECRET_KEY: "sb_secret_fixture", PRIVACY_HASH_SECRET: "fixture-only-secret" });
  const calls = []; let conflict = false;
  globalThis.fetch = async (url, options = {}) => {
    const path = new URL(url).pathname, body = options.body ? JSON.parse(options.body) : null; calls.push({ path, body, options });
    let payload, status = 200;
    if (path === "/auth/v1/user") payload = { id: account, app_metadata: { provider: "discord", providers: ["discord"] }, identities: [{ provider: "discord", provider_id: "fixture" }] };
    else if (path.endsWith("/rpc/check_security_ban_server")) payload = null;
    else if (path.endsWith("/rpc/consume_rate_limit")) payload = true;
    else if (path.endsWith("/rpc/staff_server_submission_review")) payload = { id: submission, reviewVersion: 4, queueVersion: 2 };
    else if (path.endsWith("/rpc/staff_review_server_submission") && conflict) { payload = { message: "This submission changed. Reopen it before deciding.", code: "PT409" }; status = 409; }
    else if (/\/(staff_review_server_submission|staff_resolve_queue_item|staff_resolve_comment_review)$/.test(path)) payload = { ok: true };
    else throw new Error(`Unexpected fixture request ${path}`);
    return new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } });
  };
  async function request(body, route = "admin/action", method = "POST", query = "") {
    const headers = new Map(); let value;
    const response = { setHeader: (name, content) => headers.set(name, content), getHeader: name => headers.get(name), end: payload => { value = JSON.parse(payload); } };
    await router({ browserpRoute: route, method, url: `/api/${route}${query}`, body, headers: { host: "localhost:8080", origin: "http://localhost:8080", "content-type": "application/json", "x-browserp-csrf": csrf, cookie: `brp_access=${token}; brp_csrf=${csrf}` }, socket: { remoteAddress: "127.0.0.1" } }, response);
    return { status: response.statusCode, value };
  }
  const base = { kind: "listing", id: submission, action: "approved", reason: "Reviewed the current listing details." };
  const detail = await request(null, "admin/item", "GET", `?kind=listing&id=${submission}`); assert.equal(detail.status, 200); assert.equal(detail.value.item.reviewVersion, 4); assert.equal(detail.value.item.queueVersion, 2);
  for (const values of [{}, { expectedVersion: 4 }, { expectedVersion: 0, expectedQueueVersion: 0 }, { expectedVersion: 4, expectedQueueVersion: -1 }, { expectedVersion: "4", expectedQueueVersion: 2 }, { expectedVersion: 4, expectedQueueVersion: 1.5 }]) {
    const before = calls.filter(call => call.path.endsWith("/rpc/staff_review_server_submission")).length;
    assert.equal((await request({ ...base, ...values })).status, 409);
    assert.equal(calls.filter(call => call.path.endsWith("/rpc/staff_review_server_submission")).length, before);
  }
  assert.equal((await request({ ...base, expectedVersion: 4, expectedQueueVersion: 2 })).status, 200);
  const decision = calls.find(call => call.path.endsWith("/rpc/staff_review_server_submission"));
  assert.deepEqual({ ...decision.body, p_request_id: "present" }, { p_submission_id: submission, p_expected_version: 4, p_expected_queue_version: 2, p_action: "approved", p_reason: base.reason, p_request_id: "present" });
  assert.match(decision.body.p_request_id, /^[a-f0-9-]{36}$/); assert.equal(decision.options.headers.Authorization, `Bearer ${token}`);
  conflict = true; assert.equal((await request({ ...base, expectedVersion: 4, expectedQueueVersion: 2 })).status, 409);
  for (const kind of ["comment", "report"]) assert.equal((await request({ ...base, kind })).status, 200);
  assert.equal(calls.some(call => call.path.endsWith("/rpc/staff_resolve_queue_item") && call.body.p_kind === "listing"), false);
  assert.ok(calls.some(call => call.path.endsWith("/rpc/staff_resolve_queue_item") && call.body.p_kind === "report"));
  assert.ok(calls.some(call => call.path.endsWith("/rpc/staff_resolve_comment_review")));
});
