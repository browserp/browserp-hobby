import test from "node:test";
import assert from "node:assert/strict";
import { memberMessages } from "../lib/member-messages.js";

const accountId = "00000000-0000-4000-8000-000000000001";
const otherId = "00000000-0000-4000-8000-000000000002";
const csrf = "c".repeat(43);
const token = `fixture.${Buffer.from(JSON.stringify({ sub: accountId, aal: "aal1" })).toString("base64url")}.fixture`;
const user = { id: accountId, app_metadata: { provider: "google", providers: ["google"] }, identities: [{ provider: "google" }] };
const response = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { "Content-Type": "application/json" }
});
const request = (body, options = {}) => ({
  method: body === undefined ? "GET" : "POST",
  url: options.url || "/api/me/messages",
  body,
  headers: { host: "localhost:8080", origin: "http://localhost:8080",
    "content-type": "application/json", "x-browserp-account": accountId,
    "x-browserp-csrf": csrf, cookie: `brp_access=${token}; brp_csrf=${csrf}`, ...options.headers },
  socket: { remoteAddress: "127.0.0.1" }
});
function output() {
  const headers = new Map();
  return { statusCode: 0, body: "", setHeader: (key, value) => headers.set(key.toLowerCase(), value),
    getHeader: key => headers.get(key.toLowerCase()), end(value) { this.body = JSON.parse(value); } };
}
async function fixture(run, handler = () => undefined) {
  const values = { SUPABASE_URL: "https://fixture.supabase.co", SUPABASE_PUBLISHABLE_KEY: "sb_publishable_fixture",
    SUPABASE_SECRET_KEY: "sb_secret_fixture", APP_URL: "http://localhost:8080", NODE_ENV: "test",
    VERCEL: "0", PRIVACY_HASH_SECRET: "fixture-private-hash", CONTENT_WRITES_PAUSED: "false" };
  const previous = new Map(Object.keys(values).map(key => [key, process.env[key]]));
  const original = globalThis.fetch, calls = [];
  Object.assign(process.env, values);
  globalThis.fetch = async (value, options = {}) => {
    const call = { path: new URL(value).pathname, options, body: options.body === undefined ? undefined : JSON.parse(options.body) };
    calls.push(call);
    const custom = await handler(call); if (custom !== undefined) return custom;
    if (call.path === "/auth/v1/user") return response(user);
    if (call.path.endsWith("/check_security_ban_server")) return response(null);
    if (call.path.endsWith("/member_connection_status_v2")) return response({ active: true, userId: accountId, sessionId: "current" });
    if (call.path.endsWith("/consume_rate_limit")) return response(true);
    if (call.path.endsWith("/member_message_overview")) return response({ contactPolicy: "members", unread: 0, conversations: [], blockedMembers: [] });
    if (call.path.endsWith("/member_message_send")) return response({ conversationId: "10000000-0000-4000-8000-000000000001", messageId: "20000000-0000-4000-8000-000000000001", status: "pending_review" });
    if (call.path.endsWith("/service_member_message_check")) return response({ id: "20000000-0000-4000-8000-000000000001", status: "pending_review" });
    if (call.path.endsWith("/member_message_thread")) return response({ id: "10000000-0000-4000-8000-000000000001", messages: [] });
    throw new Error(`Unexpected fixture request ${call.path}`);
  };
  try { await run(calls); }
  finally {
    globalThis.fetch = original;
    for (const [key, value] of previous) value === undefined ? delete process.env[key] : process.env[key] = value;
  }
}

test("inbox reads and sends stay on the active account and caller token", async () => fixture(async calls => {
  const res = output();
  await memberMessages(request(), res);
  assert.equal(res.body.inbox.contactPolicy, "members");
  assert.equal(res.getHeader("cache-control"), "no-store");
  const sent = output();
  await memberMessages(request({ action: "send", username: "BOB_RP", body: "Hello Bob" }), sent);
  assert.equal(sent.statusCode, 202);
  assert.equal(sent.body.result.status, "pending_review");
  const write = calls.find(call => call.path.endsWith("/member_message_send"));
  assert.deepEqual(write.body, { p_username: "bob_rp", p_body: "Hello Bob" });
  assert.equal(write.options.headers.Authorization, `Bearer ${token}`);
  assert.equal(write.options.headers.apikey, "sb_publishable_fixture");
  const check = calls.find(call => call.path.endsWith("/service_member_message_check"));
  assert.equal(check.body.p_body, "Hello Bob");
  assert.equal(check.body.p_result.decision, "review", "disabled provider cannot approve a message");
  assert.equal(check.options.headers.apikey, "sb_secret_fixture");
  assert.ok(calls.filter(call => call.path.endsWith("/consume_rate_limit")).length >= 2);
}));

test("content-check storage failure leaves the accepted message pending for staff review", async () => fixture(async calls => {
  const res = output();
  await memberMessages(request({ action: "send", username: "bob_rp", body: "Please check this message" }), res);
  assert.equal(res.statusCode, 202);
  assert.equal(res.body.result.status, "pending_review");
  assert.ok(calls.some(call => call.path.endsWith("/member_message_send")));
}, call => call.path.endsWith("/service_member_message_check") ? response({ error: "Check unavailable" }, 503) : undefined));

test("spoofed senders, switched accounts, invalid IDs and inactive sessions cannot reach message RPCs", async () => fixture(async calls => {
  await assert.rejects(memberMessages(request({ action: "send", username: "bob_rp", body: "Hi", senderId: otherId }), output()), { status: 400 });
  const switched = request({ action: "send", username: "bob_rp", body: "Hi" }, { headers: { "x-browserp-account": otherId } });
  await assert.rejects(memberMessages(switched, output()), { status: 409 });
  await assert.rejects(memberMessages(request(undefined, { url: "/api/me/messages?thread=bad" }), output()), { status: 400 });
  assert.equal(calls.some(call => /member_message_(?:send|thread)/.test(call.path)), false);
}, call => call.path.endsWith("/member_connection_status_v2") ? response({ active: true, userId: accountId, sessionId: "current" }) : undefined));

test("origin and CSRF failures stop before authentication or private reads", async () => fixture(async calls => {
  for (const headers of [{ origin: "https://attacker.example" }, { "sec-fetch-site": "cross-site" }, { "x-browserp-csrf": "wrong" }]) {
    await assert.rejects(memberMessages(request({ action: "send", username: "bob_rp", body: "Hi" }, { headers }), output()), { status: 403 });
  }
  assert.equal(calls.length, 0);
}));

test("an expired database session rejects private reads and sends before any message RPC", async () => fixture(async calls => {
  await assert.rejects(memberMessages(request(), output()), { status: 401 });
  await assert.rejects(memberMessages(request({ action: "send", username: "bob_rp", body: "Hi" }), output()), { status: 401 });
  assert.equal(calls.some(call => /member_message_(?:overview|send)/.test(call.path)), false);
}, call => call.path.endsWith("/member_connection_status_v2") ? response({ active: false, userId: accountId, sessionId: null }) : undefined));
