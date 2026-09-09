import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import router from "../api/router.js";
import servers from "../api/servers.js";
import { createBrowseRPServer } from "../dev-server.mjs";

const member = "00000000-0000-4000-8000-000000000001";
const sessionId = "aaaaaaaa-0000-4000-8000-000000000001";
const serverId = "bbbbbbbb-0000-4000-8000-000000000001";
const csrf = "c".repeat(43);
const token = `fixture.${Buffer.from(JSON.stringify({ sub: member, session_id: sessionId })).toString("base64url")}.fixture`;
const response = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const profile = { id: member, display_name: "Fixture member", avatar_url: null, bio: "A saved profile." };
const request = (url, body = {}, method = "POST") => ({
  method, url, body, socket: { remoteAddress: "127.0.0.1" },
  headers: { host: "localhost:8080", origin: "http://localhost:8080", "content-type": "application/json",
    "x-browserp-csrf": csrf, cookie: `brp_access=${token}; brp_csrf=${csrf}` }
});
function output() {
  const headers = new Map();
  return { headers, setHeader: (key, value) => headers.set(key, value), getHeader: key => headers.get(key), end(value) { this.body = JSON.parse(value); } };
}
async function fixture(run, paused = "true") {
  const values = { CONTENT_WRITES_PAUSED: paused, SUPABASE_URL: "https://fixture.supabase.co", SUPABASE_PUBLISHABLE_KEY: "sb_publishable_fixture",
    SUPABASE_SECRET_KEY: "sb_secret_fixture", APP_URL: "http://localhost:8080", NODE_ENV: "test", VERCEL: "0", PRIVACY_HASH_SECRET: "fixture-private-hash" };
  const previous = new Map(Object.keys(values).map(key => [key, process.env[key]]));
  const original = globalThis.fetch, calls = [];
  Object.assign(process.env, values);
  globalThis.fetch = async (value, options = {}) => {
    const url = new URL(value), body = options.body ? JSON.parse(options.body) : null;
    calls.push({ path: url.pathname, body, options });
    if (url.pathname === "/auth/v1/user") return response({ id: member, app_metadata: { provider: "discord", providers: ["discord"] }, identities: [{ provider: "discord" }] });
    if (url.pathname.endsWith("/check_security_ban_server")) return response(null);
    if (url.pathname.endsWith("/consume_rate_limit")) return response(true);
    if (url.pathname.endsWith("/member_connection_status_v2")) return response({ active: true, userId: member, sessionId });
    if (url.pathname === "/rest/v1/profiles") return response([profile]);
    if (url.pathname.endsWith("/member_server_interaction")) return response(body.p_action === "comment" ? { id: "new-comment", status: "pending_review" } : { accepted: true });
    throw new Error(`Unexpected fixture call: ${url.pathname}`);
  };
  try { await run(calls, original); }
  finally {
    globalThis.fetch = original;
    for (const [key, value] of previous) value === undefined ? delete process.env[key] : process.env[key] = value;
  }
}
function pausedResponse(out) {
  assert.equal(out.statusCode, 503);
  assert.deepEqual(out.body, { error: "Profile changes and comments are temporarily paused. Please try again shortly.", code: "CONTENT_WRITES_PAUSED" });
  assert.equal(out.getHeader("Cache-Control"), "no-store");
  assert.equal(out.getHeader("Retry-After"), "60");
}

test("paused avatar and profile writes stop before authentication, body processing or storage on configured router rewrites", async () => fixture(async calls => {
  const rewrites = JSON.parse(readFileSync(new URL("../vercel.json", import.meta.url), "utf8")).rewrites;
  for (const source of ["/api/me/avatar", "/api/me/profile"]) {
    const rewrite = rewrites.find(item => item.source === source);
    assert.ok(rewrite);
    const out = output();
    // Exercise the actual deployment destination, including the raw router query.
    await router(request(rewrite.destination, { imageData: "malformed", displayName: "A replacement" }), out);
    pausedResponse(out);
    assert.equal(out.getHeader("Set-Cookie"), undefined);
  }
  assert.deepEqual(calls, []);
}));

test("friendly HTTP profile and avatar routes return the same recoverable pause", async () => fixture(async (calls, fetchOriginal) => {
  const server = createBrowseRPServer();
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  try {
    const origin = `http://127.0.0.1:${server.address().port}`;
    for (const path of ["/api/me/profile", "/api/me/avatar"]) {
      const res = await fetchOriginal(`${origin}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      assert.equal(res.status, 503);
      assert.equal(res.headers.get("cache-control"), "no-store");
      assert.equal(res.headers.get("retry-after"), "60");
      assert.equal((await res.json()).code, "CONTENT_WRITES_PAUSED");
    }
    assert.deepEqual(calls, []);
  } finally { await new Promise(resolve => server.close(resolve)); }
}));

test("paused ordinary comments and replies cannot reach auth, quota or either comment RPC", async () => fixture(async calls => {
  for (const parentCommentId of [undefined, "cccccccc-0000-4000-8000-000000000001"]) {
    const out = output();
    await servers(request("/api/servers", { action: " COMMENT ", serverId, parentCommentId, body: "A thoughtful comment." }), out);
    pausedResponse(out);
  }
  assert.deepEqual(calls, []);
}));

test("paused content writes preserve current profile reads and v2 member authorization", async () => fixture(async calls => {
  const out = output(); await router(request("/api/router?_route=me/profile", {}, "GET"), out);
  assert.equal(out.statusCode, 200, out.body.error); assert.deepEqual(out.body.profile, profile);
  const check = calls.find(call => call.path.endsWith("/member_connection_status_v2"));
  assert.deepEqual(check.body, {});
  assert.equal(check.options.headers.Authorization, `Bearer ${token}`);
  assert.equal(check.options.headers.apikey, "sb_publishable_fixture");
  assert.equal(calls.some(call => call.path.endsWith("/member_connection_status")), false);
}));

test("votes and reports remain available during the content pause", async () => fixture(async calls => {
  for (const action of ["vote", "unvote", "report"]) {
    const out = output();
    await servers(request("/api/servers", { action, serverId, category: "Other", body: "Please review the inaccurate joining information." }), out);
    assert.equal(out.statusCode, 201, out.body.error);
  }
  assert.deepEqual(calls.filter(call => call.path.endsWith("/member_server_interaction")).map(call => call.body.p_action), ["vote", "unvote", "report"]);
}));

test("reopening this deployment restores normal comment handling and avatar validation", async () => fixture(async calls => {
  const comment = output();
  await servers(request("/api/servers", { action: "comment", serverId, body: "A thoughtful community comment." }), comment);
  assert.equal(comment.statusCode, 201, comment.body.error);
  assert.equal(comment.body.result.status, "pending_review");
  const avatar = output(); await router(request("/api/router?_route=me/avatar", { imageData: "malformed" }), avatar);
  assert.equal(avatar.statusCode, 400);
  assert.ok(calls.some(call => call.path.endsWith("/member_connection_status_v2")));
  assert.equal(calls.some(call => call.path.includes("/storage/")), false);
}, "false"));
