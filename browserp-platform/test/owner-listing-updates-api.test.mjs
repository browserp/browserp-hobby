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
    if (call.url.pathname.endsWith("/member_connection_status_v2")) return response({ active: true, userId: owner, sessionId });
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
test("owner proposal reaches only the dedicated atomic writer with account, target and live version",async()=>fixture(async calls=>{
 const req=ownerRequest();req.body.description="Complete existing description. ".repeat(70);const out=result();await handler(req,out);assert.equal(out.statusCode,202,out.body.error);
 const writes=calls.filter(isSubmissionWrite);assert.equal(writes.length,1);assert.match(writes[0].url.pathname,/propose_owned_listing_update_server$/);assert.equal(writes[0].body.p_server_id,serverId);assert.equal(writes[0].body.p_expected_server_version,4);assert.equal(writes[0].body.p_expected_user_id,owner);assert.equal(writes[0].body.p_data.description,req.body.description.trim());assert.ok(writes[0].body.p_data.description.length>1500);
}));
test("revoked, stale, foreign, malformed and CSRF requests cannot reach an owner write",async t=>{
 for(const [name,change] of [["wrong account",r=>r.body.expectedAccountId=other],["invalid version",r=>r.body.expectedServerVersion=0],["missing target",r=>r.body.listingUpdate="bad"],["foreign origin",r=>r.headers.origin="https://attacker.example"],["CSRF",r=>delete r.headers["x-browserp-csrf"]]])await t.test(name,async()=>fixture(async calls=>{const req=ownerRequest();change(req);const out=result();await handler(req,out);assert.ok(out.statusCode>=400);assert.equal(calls.filter(isSubmissionWrite).length,0);}));
 await t.test("revoked live session",async()=>fixture(async calls=>{const out=result();await handler(ownerRequest(),out);assert.equal(out.statusCode,401);assert.equal(calls.filter(isSubmissionWrite).length,0);},c=>c.url.pathname.endsWith("/member_connection_status_v2")?response({active:false}):undefined));
});
test("correction proposals use the ownership-aware writer, preserving ordinary correction behavior",async()=>fixture(async calls=>{
 const req=ownerRequest();req.method="PATCH";delete req.body.listingUpdate;Object.assign(req.body,{ownerUpdate:true,submissionId,expectedVersion:2,expectedQueueVersion:3});const out=result();await handler(req,out);assert.equal(out.statusCode,202,out.body.error);const write=calls.filter(isSubmissionWrite)[0];assert.match(write.url.pathname,/correct_owned_listing_update_server$/);assert.equal(write.body.p_expected_server_version,4);assert.equal(write.body.p_submission_id,submissionId);
}));
test("Roblox owner requests carry public joining edits and factual internal provenance, not arbitrary private proof",async()=>fixture(async calls=>{
 const req=ownerRequest();Object.assign(req.body,{platform:"roblox",framework:"Emergency Response Liberty County",cfxJoinUrl:null,roblox:{kind:"independent_community",experienceUrl:"https://www.roblox.com/games/12345",communityGroupUrl:null,joiningInstructions:"Join the community Discord and read the rules before applying to our sessions."}});
 const out=result();await handler(req,out);assert.equal(out.statusCode,202,out.body.error);const saved=calls.filter(isSubmissionWrite)[0].body.p_data.roblox;assert.match(saved.authorityEvidence,/not new evidence/);assert.equal(saved.applicantRole,"Current BrowseRP listing owner");
 req.body.roblox.authorityEvidence="secret input";const denied=result();await handler(req,denied);assert.equal(denied.statusCode,400);assert.equal(calls.filter(isSubmissionWrite).length,1);
}));
test("owner GET is account-bound and uses authenticated ownership RPC rather than privileged table reads",async()=>fixture(async calls=>{
 const req=request();req.method="GET";req.url=`/api/submissions?listing=${serverId}&account=${owner}`;const out=result();await handler(req,out);assert.equal(out.statusCode,200,out.body.error);const read=calls.find(c=>c.url.pathname.endsWith("/member_owned_listing_update"));assert.equal(read.options.headers.apikey,"sb_publishable_fixture");assert.equal(read.options.headers.Authorization,`Bearer ${token}`);
 req.url=`/api/submissions?listing=${serverId}&account=${other}`;const denied=result();await handler(req,denied);assert.equal(denied.statusCode,403);assert.equal(calls.filter(c=>c.url.pathname.endsWith("/member_owned_listing_update")).length,1);
},c=>c.url.pathname.endsWith("/member_owned_listing_update")?response({submission:{id:serverId}}):undefined));
