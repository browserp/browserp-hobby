import test from "node:test";
import assert from "node:assert/strict";
import handler, { SERVER_SUBMISSION_V2_RPC } from "../api/submissions.js";

const owner = "00000000-0000-4000-8000-000000000001";
const other = "00000000-0000-4000-8000-000000000002";
const sessionId = "aaaaaaaa-0000-4000-8000-000000000001";
const submissionId = "bbbbbbbb-0000-4000-8000-000000000001";
const csrf = "c".repeat(43);
const token = `fixture.${Buffer.from(JSON.stringify({ sub: owner, session_id: sessionId })).toString("base64url")}.fixture`;
const valid = {
  name: "An established community", platform: "fivem", region: "Europe", language: "English", framework: "vMenu",
  description: "A welcoming roleplay community with clear joining information and thoughtful community rules.",
  communityUrl: "https://discord.com/invite/fixture", cfxJoinUrl: "https://cfx.re/join/example",
  accessType: "application", tags: ["serious-roleplay"], agreement: true
};
const response = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const request = () => ({
  method: "POST", url: "/api/submissions", body: { ...valid },
  headers: { host: "localhost:8080", origin: "http://localhost:8080", "content-type": "application/json",
    "x-browserp-csrf": csrf, "idempotency-key": "fixture-new-submission-123", cookie: `brp_access=${token}; brp_csrf=${csrf}` },
  socket: { remoteAddress: "127.0.0.1" }
});
function result() {
  const headers = new Map();
  return { headers, setHeader: (key, value) => headers.set(key, value), getHeader: key => headers.get(key), end(body) { this.body = JSON.parse(body); } };
}
const isSubmissionWrite = call => /\/(?:create_server_submission|attach_server_submission)/.test(call.url.pathname);
async function fixture(run, override = () => undefined) {
  const env = { SUPABASE_URL: "https://fixture.supabase.co", SUPABASE_PUBLISHABLE_KEY: "sb_publishable_fixture",
    SUPABASE_SECRET_KEY: "sb_secret_fixture", APP_URL: "http://localhost:8080", NODE_ENV: "test", VERCEL: "0", PRIVACY_HASH_SECRET: "fixture-private-hash" };
  const previous = new Map(Object.keys(env).map(key => [key, process.env[key]]));
  const originalFetch = globalThis.fetch;
  const calls = [];
  Object.assign(process.env, env);
  globalThis.fetch = async (url, options = {}) => {
    const call = { url: new URL(url), options, body: options.body && JSON.parse(options.body) };
    calls.push(call);
    const custom = await override(call);
    if (custom !== undefined) return custom;
    if (call.url.pathname === "/auth/v1/user") return response({ id: owner, app_metadata: { provider: "discord", providers: ["discord"] }, identities: [{ provider: "discord" }] });
    if (call.url.pathname.endsWith("/check_security_ban_server")) return response(null);
    if (call.url.pathname.endsWith("/consume_rate_limit")) return response(true);
    if (call.url.pathname.endsWith("/member_connection_status")) return response({ active: true, userId: owner, sessionId });
    if (call.url.pathname.endsWith(`/${SERVER_SUBMISSION_V2_RPC}`)) return response({ id: submissionId, status: "pending_review" });
    if (call.url.pathname.endsWith("/attach_server_submission_metadata_server")) return response({ id: submissionId, tags: valid.tags, accessType: valid.accessType });
    throw new Error(`Unexpected fixture route ${call.url.pathname}`);
  };
  try { await run(calls); }
  finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of previous) value === undefined ? delete process.env[key] : process.env[key] = value;
  }
}

test("new listing revalidates the current member before privileged create and metadata attachment", async () => fixture(async calls => {
  const output = result();
  await handler(request(), output);
  assert.equal(output.statusCode, 202, output.body.error);
  assert.equal(output.body.submission.id, submissionId);
  const check = calls.find(call => call.url.pathname.endsWith("/member_connection_status"));
  assert.deepEqual(check.body, {});
  assert.equal(check.options.headers.Authorization, `Bearer ${token}`);
  assert.equal(check.options.headers.apikey, "sb_publishable_fixture");
  const writes = calls.filter(isSubmissionWrite);
  assert.equal(writes.length, 2);
  assert.ok(writes.every(call => calls.indexOf(check) < calls.indexOf(call)));
  assert.ok(writes.every(call => call.options.headers.apikey === "sb_secret_fixture"));
  assert.equal(writes[0].body.p_user_id, owner);
  assert.equal(writes[0].body.p_language, "English");
  assert.equal(writes[0].body.p_framework, "vMenu");
  assert.equal(writes[0].body.p_community_url, "https://discord.gg/fixture");
  assert.equal(writes[1].body.p_submission_id, submissionId);
  assert.equal(writes[1].body.p_access_type, "application");
  const firstKey = writes[0].body.p_idempotency_key;
  await handler(request(), result());
  assert.equal(calls.filter(isSubmissionWrite)[2].body.p_idempotency_key, firstKey);
}));

test("revoked, expired and cross-account session results cannot create a new listing even when Auth accepts the JWT", async t => {
  for (const [name, access] of [
    ["revoked session", { active: false }],
    ["expired session", { active: false, userId: owner, sessionId }],
    ["different account", { active: true, userId: other, sessionId }],
    ["missing session ID", { active: true, userId: owner }],
    ["invalid session ID", { active: true, userId: owner, sessionId: "not-a-session" }],
    ["malformed active status", { active: "true", userId: owner, sessionId }]
  ]) await t.test(name, async () => fixture(async calls => {
    const output = result();
    await handler(request(), output);
    assert.equal(output.statusCode, 401, output.body.error);
    assert.match(output.body.error, /Sign in again/);
    assert.ok(calls.some(call => call.url.pathname === "/auth/v1/user"));
    assert.equal(calls.some(isSubmissionWrite), false);
    assert.equal(calls.some(call => call.url.pathname.endsWith("/consume_rate_limit")), false);
  }, call => call.url.pathname.endsWith("/member_connection_status") ? response(access) : undefined));
});

test("an unavailable current-session check fails closed without clearing the accepted session or writing", async () => fixture(async calls => {
  const output = result();
  await handler(request(), output);
  assert.equal(output.statusCode, 503);
  assert.equal(calls.some(isSubmissionWrite), false);
  assert.equal(JSON.stringify(output.headers.get("Set-Cookie") || []).includes("brp_access=;"), false);
}, call => call.url.pathname.endsWith("/member_connection_status") ? response({ message: "Session check temporarily unavailable" }, 503) : undefined));

test("new listing origin and CSRF checks run before session eligibility and privileged submission writes", async t => {
  for (const [name, mutate, noProviderCalls] of [
    ["foreign origin", req => { req.headers.origin = "https://attacker.example"; }, true],
    ["missing CSRF", req => { delete req.headers["x-browserp-csrf"]; }, false],
    ["wrong CSRF", req => { req.headers["x-browserp-csrf"] = "wrong"; }, false]
  ]) await t.test(name, async () => fixture(async calls => {
    const req = request(); mutate(req); const output = result(); await handler(req, output);
    assert.equal(output.statusCode, 403, output.body.error);
    assert.equal(calls.some(isSubmissionWrite), false);
    assert.equal(calls.some(call => call.url.pathname.endsWith("/member_connection_status")), false);
    if (noProviderCalls) assert.equal(calls.length, 0);
  }));
});
