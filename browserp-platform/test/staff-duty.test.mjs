import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import { staffDuty } from "../lib/staff-duty.js";

// Keep fixture requests independent of the deployment's configured public URL.
const fixtureEnv = { APP_URL: "http://localhost:8080", NODE_ENV: "test", VERCEL: "0", VERCEL_ENV: "" };
const previousEnv = new Map(Object.keys(fixtureEnv).map(key => [key, process.env[key]]));
before(() => Object.assign(process.env, fixtureEnv));
after(() => {
  for (const [key, value] of previousEnv) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});

const actor="00000000-0000-4000-8000-000000000001";
const sessionId="11111111-0000-4000-8000-000000000001";
const key="22222222-0000-4000-8000-000000000001";
const csrf="c".repeat(43);
const req=(body,url="/api/admin/duty")=>({method:body ? "POST" : "GET",body,url,headers:{host:"localhost:8080",origin:"http://localhost:8080",
  "content-type":"application/json","x-browserp-csrf":csrf,"x-browserp-account":actor,cookie:`brp_csrf=${csrf}`} });
function fixture(overrides={}) {
  const calls=[];
  return { calls,deps:{now:()=>Date.parse("2026-09-08T12:00:00Z"),getSession:async(_req,_res,options)=>{calls.push({type:"session",options});return {user:{id:actor},accessToken:"caller-token",aal:"aal2"};},
    memberRateLimit:async(...args)=>{calls.push({type:"limit",args});},rpc:async(...args)=>{calls.push({type:"rpc",args});return {fixture:"result"};},...overrides} };
}
test("availability read uses the staff caller token and a bounded roster cursor",async()=>{
  const h=fixture();
  const query=new URLSearchParams({view:"availability",limit:"10",afterUserId:actor});
  assert.deepEqual(await staffDuty(req(null,`/api/admin/duty?${query}`),{},h.deps),{fixture:"result"});
  assert.deepEqual(h.calls[0],{type:"session",options:{required:true,provider:"discord"}});
  assert.deepEqual(h.calls.at(-1).args,["staff_duty_read",{p_view:"availability",p_limit:10,p_after_user_id:actor},"caller-token"]);
  await staffDuty(req(),{},h.deps);
  assert.deepEqual(h.calls.at(-1).args,["staff_duty_read",{p_view:"self",p_limit:25,p_after_user_id:null},"caller-token"]);
});
test("changed account, missing session, missing MFA and database revocation fail without returning records",async()=>{
  const h=fixture(); const wrong=req();wrong.headers["x-browserp-account"]="other";
  await assert.rejects(staffDuty(wrong,{},h.deps),{status:401}); assert.equal(h.calls.some(c=>c.type==="rpc"),false);
  const noSession=fixture({getSession:async()=>null});await assert.rejects(staffDuty(req(),{},noSession.deps),{status:401});
  const aal1=fixture({getSession:async()=>({user:{id:actor},accessToken:"token",aal:"aal1"})});await assert.rejects(staffDuty(req(),{},aal1.deps),{status:403});
  const revoked=fixture({rpc:async()=>{throw Object.assign(new Error("Current staff access was revoked"),{status:403});}});
  await assert.rejects(staffDuty(req(),{},revoked.deps),/revoked/);
});
test("mutations require same origin, CSRF and an account-bound session",async()=>{
  for (const mutation of [r=>{r.headers.origin="https://foreign.test";},r=>{delete r.headers["x-browserp-csrf"];},r=>{r.headers.cookie="";}]) {
    const h=fixture(),r=req({action:"set_availability",availability:"busy",requestKey:key});mutation(r);
    await assert.rejects(staffDuty(r,{},h.deps),{status:403});assert.equal(h.calls.length,0);
  }
});
test("server mutation forwards only the supported contract and never trusts an injected actor",async()=>{
  const h=fixture();await staffDuty(req({action:"set_availability",availability:"busy",requestKey:key,userId:"forged-owner",accountId:"forged-owner"}),{},h.deps);
  const sent=h.calls.find(c=>c.type==="rpc");
  assert.equal(sent.args[0],"staff_duty_mutate");assert.equal(sent.args[2],"caller-token");
  assert.deepEqual(sent.args[1],{p_action:"set_availability",p_key:key,p_availability:"busy"});
  assert.doesNotMatch(JSON.stringify(sent),/forged-owner/);
  assert.deepEqual(h.calls.find(c=>c.type==="limit").args.slice(1),["staff-duty",60,300,actor,300]);
});
test("retired hours and work-session operations cannot reach the database",async()=>{
  for (const query of ["view=team","from=2026-09-01T00:00:00Z","before=2026-09-01T00:00:00Z",`userId=${actor}`]) {
    const h=fixture();await assert.rejects(staffDuty(req(null,`/api/admin/duty?${query}`),{},h.deps),{status:410});
    assert.equal(h.calls.some(c=>c.type==="rpc"),false);
  }
  for(const action of ["clock_in","clock_out","confirm_session","correct_session"]){
    const h=fixture();await assert.rejects(staffDuty(req({action,requestKey:key,sessionId}),{},h.deps),{status:410});
    assert.equal(h.calls.some(c=>c.type==="rpc"||c.type==="limit"),false);
  }
});
test("invalid availability views, cursors, states and keys never reach the database",async()=>{
  for (const query of ["view=other","limit=0","limit=101","limit=1.2","view=availability&afterUserId=invalid",`view=self&afterUserId=${actor}`]) {
    const h=fixture();await assert.rejects(staffDuty(req(null,`/api/admin/duty?${query}`),{},h.deps));assert.equal(h.calls.some(c=>c.type==="rpc"),false);
  }
  const valid={action:"set_availability",requestKey:key,availability:"available"};
  for (const patch of [{action:"delete_all"},{requestKey:"invalid"},{availability:"off_duty"},{availability:"online"},{availability:null}]) {
    const h=fixture();await assert.rejects(staffDuty(req({...valid,...patch}),{},h.deps),{status:400});assert.equal(h.calls.some(c=>c.type==="rpc"),false);
  }
});
