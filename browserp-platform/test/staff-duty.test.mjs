import assert from "node:assert/strict";
import test from "node:test";
import { staffDuty } from "../lib/staff-duty.js";

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
test("duty read uses private caller scope, bounded range and an exact cursor",async()=>{
  const h=fixture(); const cursor="2026-09-07T09:14:23.123456+00:00";
  const query=new URLSearchParams({view:"team",from:"2026-09-01T00:00:00Z",to:"2026-09-08T00:00:00Z",before:cursor,beforeId:sessionId,limit:"10",userId:actor});
  assert.deepEqual(await staffDuty(req(null,`/api/admin/duty?${query}`),{},h.deps),{fixture:"result"});
  assert.deepEqual(h.calls[0],{type:"session",options:{required:true,provider:"discord"}});
  assert.deepEqual(h.calls.at(-1).args,["staff_duty_read",{p_view:"team",p_from:"2026-09-01T00:00:00Z",p_to:"2026-09-08T00:00:00Z",p_limit:10,p_before:cursor,p_before_id:sessionId,p_user_id:actor,p_after_user_id:null},"caller-token"]);
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
    const h=fixture(),r=req({action:"clock_in",requestKey:key});mutation(r);
    await assert.rejects(staffDuty(r,{},h.deps),{status:403});assert.equal(h.calls.length,0);
  }
});
test("server mutation forwards only the supported contract and never trusts an injected actor",async()=>{
  const h=fixture();await staffDuty(req({action:"correct_session",requestKey:key,sessionId,version:2,userId:"forged-owner",accountId:"forged-owner",
    startedAt:"2026-09-07T10:00:00Z",endedAt:"2026-09-07T12:00:00Z",reason:"  Corrected a forgotten clock-out  ",confirmed:true}),{},h.deps);
  const sent=h.calls.find(c=>c.type==="rpc");
  assert.equal(sent.args[0],"staff_duty_mutate");assert.equal(sent.args[2],"caller-token");
  assert.equal(sent.args[1].p_key,key);assert.equal(sent.args[1].p_session_id,sessionId);assert.equal(sent.args[1].p_reason,"Corrected a forgotten clock-out");
  assert.doesNotMatch(JSON.stringify(sent),/forged-owner/);
  assert.deepEqual(h.calls.find(c=>c.type==="limit").args.slice(1),["staff-duty",60,300,actor,300]);
});
test("invalid ranges, cursors, actions and correction inputs never reach the database",async()=>{
  for (const query of ["view=other","limit=0","limit=101","limit=1.2","from=2020-01-01T00:00:00Z&to=2026-09-08T00:00:00Z","before=2026-09-01T00:00:00Z",
    `view=self&userId=${actor}`,"to=infinity","from=2026-09-07T10:00:00&to=2026-09-08T00:00:00Z"]) {
    const h=fixture();await assert.rejects(staffDuty(req(null,`/api/admin/duty?${query}`),{},h.deps));assert.equal(h.calls.some(c=>c.type==="rpc"),false);
  }
  const valid={action:"confirm_session",requestKey:key,sessionId,version:1,endedAt:"2026-09-07T12:00:00Z",reason:"Actual shift end confirmed",confirmed:true};
  for (const patch of [{action:"delete_all"},{requestKey:"invalid"},{sessionId:null},{version:0},{confirmed:false},{reason:""},{reason:"A secret\nnew line"},{endedAt:"yesterday"}]) {
    const h=fixture();await assert.rejects(staffDuty(req({...valid,...patch}),{},h.deps),{status:400});assert.equal(h.calls.some(c=>c.type==="rpc"),false);
  }
});
