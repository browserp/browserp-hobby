import test from "node:test";
import assert from "node:assert/strict";
import handler, { SERVER_APPLICATION_RPC } from "../api/submissions.js";

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
  accessType: "application", tags: ["serious-roleplay"], agreement: true, expectedAccountId: owner
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
const isSubmissionWrite = call => /\/(?:propose_owned_listing|correct_owned_listing|create_server_application|create_server_submission|attach_server_submission)/.test(call.url.pathname);
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
    if (call.url.pathname.endsWith("/propose_owned_listing_update_server") || call.url.pathname.endsWith("/correct_owned_listing_update_server")) return response({ id: submissionId, status: "pending_review" });
    if (call.url.pathname.endsWith(`/${SERVER_APPLICATION_RPC}`)) return response({ id: submissionId, status: "pending_review" });
    if (call.url.pathname.endsWith("/attach_server_submission_metadata_server")) return response({ id: submissionId, tags: valid.tags, accessType: valid.accessType });
    throw new Error(`Unexpected fixture route ${call.url.pathname}`);
  };
  try { await run(calls); }
  finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of previous) value === undefined ? delete process.env[key] : process.env[key] = value;
  }
}

const serverId="cccccccc-0000-4000-8000-000000000001";
const ownerRequest=()=>{const req=request();req.body.listingUpdate=serverId;req.body.expectedServerVersion=4;return req;};

test("owner HTTP input preserves thirty exact imported keywords for the authoritative owned-target check",async()=>fixture(async calls=>{
 const req=ownerRequest();req.body.tags=["vMenu","English speaking",...Array.from({length:28},(_,i)=>`research-${i}`)];const out=result();await handler(req,out);assert.equal(out.statusCode,202,out.body.error);assert.deepEqual(calls.filter(isSubmissionWrite)[0].body.p_data.tags,req.body.tags);
}));
test("ordinary submissions cannot forge the expanded tag allowance or submit nonlaunch games",async t=>{
 for(const patch of [{tags:Array.from({length:9},(_,i)=>`feature-${i}`),ownerUpdate:true},{platform:"rust",cfxJoinUrl:null},{platform:"arma3",cfxJoinUrl:null}])await t.test(JSON.stringify(patch),async()=>fixture(async calls=>{const req=request();Object.assign(req.body,patch);const out=result();await handler(req,out);assert.equal(out.statusCode,400);assert.equal(calls.filter(isSubmissionWrite).length,0);}));
});
test("malformed owner feature values are rejected before a database write",async()=>fixture(async calls=>{
 for(const tags of [[{}],["x".repeat(41)],Array(129).fill("valid")]){const req=ownerRequest();req.body.tags=tags;const out=result();await handler(req,out);assert.equal(out.statusCode,400);}
 assert.equal(calls.filter(isSubmissionWrite).length,0);
}));
