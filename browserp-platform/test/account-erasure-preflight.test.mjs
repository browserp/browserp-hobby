import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { staffAccountErasurePreflight, accountErasureReviewStages } from "../lib/account-erasure-preflight.js";

const uid = "00000000-0000-4000-8000-000000000001", requestId = "22222222-0000-4000-8000-000000000002", csrf = "c".repeat(43);
const token = aal => `fixture.${Buffer.from(JSON.stringify({ sub: uid, aal })).toString("base64url")}.fixture`;
const user = { id: uid, app_metadata: { provider: "discord", providers: ["discord"] }, identities: [{ provider: "discord", provider_id: "fixture" }] };
const response = (body, status=200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const request = (body={ requestId, version: 1 }, aal="aal2") => ({
  method: "POST", url: "/api/admin/account-erasure-preflight", body: body===null ? "null" : body,
  headers: { host: "localhost:8080", origin: "http://localhost:8080", "content-type": "application/json", "x-browserp-csrf": csrf,
    "x-browserp-account": uid, cookie: `brp_access=${token(aal)}; brp_csrf=${csrf}` }, socket: { remoteAddress: "127.0.0.1" }
});
const report = { contractVersion: 1, mode: "read-only", executionEnabled: false, request: { id: requestId, version: 1 },
  coverage: { dependencyGraphComplete: true, boundedCountsComplete: true, fullErasureInventory: false }, dependencies: [] };
function output() { const h=new Map(); return { setHeader: (k,v)=>h.set(k,v), getHeader: k=>h.get(k) }; }
async function fixture(run, handler=()=>{}) {
  const env = { SUPABASE_URL: "https://fixture.supabase.co", SUPABASE_PUBLISHABLE_KEY: "sb_publishable_fixture", SUPABASE_SECRET_KEY: "sb_secret_fixture",
    APP_URL: "http://localhost:8080", NODE_ENV: "test", VERCEL: "0", PRIVACY_HASH_SECRET: "fixture-secret" };
  const previous = new Map(Object.keys(env).map(k=>[k,process.env[k]])), original = globalThis.fetch, calls=[];
  Object.assign(process.env, env);
  globalThis.fetch = async (value, options={}) => {
    const call = { path: new URL(value).pathname, options, body: options.body ? JSON.parse(options.body) : undefined }; calls.push(call);
    const custom = await handler(call); if (custom !== undefined) return custom;
    if (call.path === "/auth/v1/user") return response(user);
    if (call.path.endsWith("/rpc/check_security_ban_server")) return response(null);
    if (call.path.endsWith("/rpc/consume_rate_limit")) return response(true);
    if (call.path.endsWith("/rpc/staff_account_erasure_preflight")) return response(report);
    if (call.path.endsWith("/rpc/staff_account_erasure_preflight_access")) return response(true);
    throw new Error(`Unexpected request ${call.path}`);
  };
  try { await run(calls); } finally { globalThis.fetch=original; for (const [k,v] of previous) v===undefined ? delete process.env[k] : process.env[k]=v; }
}

test("erasure report forwards only request/version on caller token and rechecks access before release", async () => fixture(async calls => {
  const result = await staffAccountErasurePreflight(request(), output());
  const privateCalls = calls.filter(c=>c.path.includes("/rpc/staff_account_erasure_preflight"));
  assert.deepEqual(privateCalls.map(c=>c.path.split("/").at(-1)), ["staff_account_erasure_preflight", "staff_account_erasure_preflight_access"]);
  for (const call of privateCalls) { assert.deepEqual(call.body, { p_request_id: requestId, p_expected_version: 1 }); assert.equal(call.options.headers.Authorization, `Bearer ${token("aal2")}`); }
  assert.equal(result.executionEnabled, false); assert.equal(result.reportSha256, createHash("sha256").update(JSON.stringify(report)).digest("hex"));
  assert.equal(result.stages.find(x=>x.id==="policy_and_ownership").state, "blocked");
  assert.equal(calls.some(c=>c.options.method==="DELETE" || c.path.includes("/storage/") || /fulfill|revoke/.test(c.path)), false);
}));

test("erasure report origin and CSRF deny before any backend access", async () => fixture(async calls => {
  for (const change of [{ origin: "https://evil.example" }, { "x-browserp-csrf": "bad" }]) {
    const req=request(); Object.assign(req.headers,change); await assert.rejects(staffAccountErasurePreflight(req,output()), { status: 403 });
  }
  assert.equal(calls.length,0);
}));

test("erasure report requires displayed account and AAL2", async () => fixture(async calls => {
  const switched=request(); switched.headers["x-browserp-account"]="another";
  await assert.rejects(staffAccountErasurePreflight(switched,output()),{status:401});
  await assert.rejects(staffAccountErasurePreflight(request(undefined,"aal1"),output()),{status:403});
  assert.equal(calls.some(c=>c.path.includes("/rpc/staff_account_erasure_preflight")),false);
}));

test("erasure report rejects extra actions, arbitrary subjects, missing version and unsupported methods", async () => fixture(async calls => {
  for(const body of [null, [], {requestId}, {requestId,version:0}, {requestId,version:1.2}, {requestId:"bad",version:1}, {requestId,version:1,execute:true},
    {requestId,version:1,userId:uid}, {requestId,version:1,policyAccepted:true}]) {
    await assert.rejects(staffAccountErasurePreflight(request(body),output()),{status:400});
  }
  const req=request(); req.method="GET"; await assert.rejects(staffAccountErasurePreflight(req,output()),{status:405});
  assert.equal(calls.some(c=>c.path.includes("/rpc/staff_account_erasure_preflight")),false);
}));

test("database owner denial and changed-request errors propagate without a report", async () => {
  for (const status of [403,409]) await fixture(async () => {
    await assert.rejects(staffAccountErasurePreflight(request(),output()),{status});
  }, call => call.path.endsWith("/rpc/staff_account_erasure_preflight") ? response({message:"Access or request changed."},status) : undefined);
});

test("quota denial stops the expensive dependency scan", async () => fixture(async calls => {
  await assert.rejects(staffAccountErasurePreflight(request(), output()), {status:429});
  assert.equal(calls.some(c=>c.path.includes("/rpc/staff_account_erasure_preflight")),false);
}, call => call.path.endsWith("/rpc/consume_rate_limit") ? response(false) : undefined));

test("revocation or withdrawal during scan withholds the report", async () => {
  for (const responseValue of [false, "denied"]) await fixture(async () => {
    await assert.rejects(staffAccountErasurePreflight(request(),output()),{status:403});
  }, call => call.path.endsWith("/rpc/staff_account_erasure_preflight_access") ? responseValue===false ? response(false) : response({message:"Owner permission revoked"},403) : undefined);
});

test("a stale or unexpected report cannot enable execution or escape request binding", async () => {
  for (const change of [{executionEnabled:true}, {mode:"execute"}, {contractVersion:2}, {request:{id:uid,version:1}}, {request:{id:requestId,version:2}}]) {
    await fixture(async calls => {
      await assert.rejects(staffAccountErasurePreflight(request(),output()),{status:503});
      assert.equal(calls.some(c=>c.path.endsWith("/rpc/staff_account_erasure_preflight_access")),false);
    }, call=>call.path.endsWith("/rpc/staff_account_erasure_preflight") ? response({...report,...change}) : undefined);
  }
});

test("readiness stages remain blocked even with exact empty dependency counts", () => {
  const exact=accountErasureReviewStages(report), partial=accountErasureReviewStages({coverage:{boundedCountsComplete:false,dependencyGraphComplete:true}});
  assert.equal(exact[0].state,"review_required"); assert.equal(partial[0].state,"incomplete");
  for (const stages of [exact,partial,accountErasureReviewStages(null)]) assert.equal(stages.some(x=>["ready","complete","fulfilled"].includes(x.state)),false);
});
