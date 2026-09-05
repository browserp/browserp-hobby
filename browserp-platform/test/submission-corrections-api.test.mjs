import test from "node:test";
import assert from "node:assert/strict";
import handler, { SERVER_SUBMISSION_CORRECTION_RPC } from "../api/submissions.js";
const owner="00000000-0000-4000-8000-000000000001", other="00000000-0000-4000-8000-000000000002",sid="aaaaaaaa-0000-4000-8000-000000000001",id="bbbbbbbb-0000-4000-8000-000000000001";
const csrf="c".repeat(43),token=`fixture.${Buffer.from(JSON.stringify({sub:owner})).toString("base64url")}.fixture`;
const valid={submissionId:id,expectedVersion:3,expectedQueueVersion:1,expectedAccountId:owner,name:"Revised community",platform:"redm",region:"Europe",language:"English",framework:"VORP",description:"A thoughtfully corrected community description with clear rules and welcoming roleplay.",communityUrl:"https://discord.com/invite/fixture",cfxJoinUrl:"https://cfx.re/join/example",accessType:"application",tags:["serious-roleplay"],agreement:true};
const response=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{"Content-Type":"application/json"}});
const req=(method="PATCH",body=valid)=>({method,url:"/api/submissions",body,headers:{host:"localhost:8080",origin:"http://localhost:8080","content-type":"application/json","x-browserp-csrf":csrf,"idempotency-key":"fixture-resubmission-123",cookie:`brp_access=${token}; brp_csrf=${csrf}`},socket:{remoteAddress:"127.0.0.1"}});
const res=()=>{const headers=new Map();return{headers,setHeader:(k,v)=>headers.set(k,v),getHeader:k=>headers.get(k),end(value){this.body=JSON.parse(value);}};};
async function isolated(run,override=()=>undefined){const env={SUPABASE_URL:"https://fixture.supabase.co",SUPABASE_PUBLISHABLE_KEY:"sb_publishable_fixture",SUPABASE_SECRET_KEY:"sb_secret_fixture",APP_URL:"http://localhost:8080",NODE_ENV:"test",VERCEL:"0",PRIVACY_HASH_SECRET:"fixture-private-hash"};const previous=new Map(Object.keys(env).map(k=>[k,process.env[k]]));const original=globalThis.fetch;const calls=[];Object.assign(process.env,env);
 globalThis.fetch=async(url,options={})=>{const c={url:new URL(url),options,body:options.body&&JSON.parse(options.body)};calls.push(c);const custom=await override(c);if(custom!==undefined)return custom;
 if(c.url.pathname==="/auth/v1/user")return response({id:owner,app_metadata:{provider:"discord",providers:["discord"]},identities:[{provider:"discord"}]});
 if(c.url.pathname.endsWith("/check_security_ban_server"))return response(null);
 if(c.url.pathname.endsWith("/consume_rate_limit"))return response(true);
 if(c.url.pathname.endsWith("/member_connection_status"))return response({active:true,userId:owner,sessionId:sid});
 if(c.url.pathname.endsWith("/member_server_submission"))return response({submission:{id,review_version:3,status:"changes_requested",review_note:"Please correct the details."},history:[]});
 if(c.url.pathname.endsWith('/'+SERVER_SUBMISSION_CORRECTION_RPC))return response({id,status:"pending_review",review_version:4,idempotent:false});
 throw new Error(`Unexpected fixture route ${c.url.pathname}`);};
 try{await run(calls);}finally{globalThis.fetch=original;for(const[k,v]of previous)v===undefined?delete process.env[k]:process.env[k]=v;}}

test("correction API forwards verified account/session, canonical data, moderation and stable retry key",async()=>isolated(async calls=>{
 const first=res();await handler(req(),first);assert.equal(first.statusCode,202);assert.equal(first.body.submission.id,id);
 const c=calls.find(c=>c.url.pathname.endsWith('/'+SERVER_SUBMISSION_CORRECTION_RPC));assert.equal(c.body.p_user_id,owner);assert.equal(c.body.p_session_id,sid);assert.equal(c.body.p_expected_version,3);assert.equal(c.body.p_data.language,"English");assert.equal(c.body.p_data.framework,"VORP");assert.equal(c.body.p_data.communityUrl,"https://discord.gg/fixture");assert.equal(c.body.p_terms_version,"2026-08-19");assert.match(c.body.p_idempotency_key,/^[a-f0-9]{64}$/);assert.ok(c.body.p_moderation_confidence);assert.equal(c.options.headers.apikey,"sb_secret_fixture");
 await handler(req(),res());assert.equal(calls.filter(x=>x.url.pathname.endsWith('/'+SERVER_SUBMISSION_CORRECTION_RPC))[1].body.p_idempotency_key,c.body.p_idempotency_key);
 assert.equal(calls.some(c=>/create_server_submission|attach_server_submission/.test(c.url.pathname)),false);
}));
test("correction API rejects foreign origin, CSRF, missing consent, changed account and invalid version without writing",async()=>{
 for(const [change,status]of [
 [r=>{r.headers.origin="https://attacker.example";},403],
 [r=>{r.headers["x-browserp-csrf"]="wrong";},403],
 [r=>{r.body={...valid,agreement:false};},400],
 [r=>{r.body={...valid,expectedAccountId:other};},401],
 [r=>{r.body={...valid,expectedVersion:0};},400],
 [r=>{delete r.headers["idempotency-key"];},400],
 [r=>{r.body={...valid,cfxJoinUrl:"https://discord.gg/fixture"};},400]
 ])await isolated(async calls=>{const r=req();change(r);const output=res();await handler(r,output);assert.equal(output.statusCode,status,output.body.error);assert.equal(calls.some(c=>c.url.pathname.endsWith('/'+SERVER_SUBMISSION_CORRECTION_RPC)),false);});
});
test("revoked or cross-account session state is rejected even when Auth still accepts the access token",async()=>{
 for(const access of [{active:false},{active:true,userId:other,sessionId:sid},{active:true,userId:owner,sessionId:"bad"}])await isolated(async calls=>{const output=res();await handler(req(),output);assert.equal(output.statusCode,401);assert.equal(calls.some(c=>c.url.pathname.endsWith('/'+SERVER_SUBMISSION_CORRECTION_RPC)),false);},c=>c.url.pathname.endsWith("/member_connection_status")?response(access):undefined);
});
test("single submission read uses owner-scoped authenticated RPC and checks the account displayed in the form",async()=>isolated(async calls=>{
 const r=req("GET");r.url=`/api/submissions?id=${id}&account=${owner}`;const output=res();await handler(r,output);assert.equal(output.statusCode,200);const read=calls.find(c=>c.url.pathname.endsWith("/member_server_submission"));assert.equal(read.options.headers.Authorization,`Bearer ${token}`);assert.equal(read.options.headers.apikey,"sb_publishable_fixture");assert.deepEqual(read.body,{p_submission_id:id});
 const switched=res();r.url=`/api/submissions?id=${id}&account=${other}`;await handler(r,switched);assert.equal(switched.statusCode,401);assert.equal(calls.filter(c=>c.url.pathname.endsWith("/member_server_submission")).length,1);
}));
test("staff decision conflicts and ownership denial stay distinct, actionable failures",async()=>{
 for(const [status,message]of [[409,"The review changed. Check its latest state."],[404,"Submission not found in your account."]])await isolated(async()=>{const output=res();await handler(req(),output);assert.equal(output.statusCode,status);assert.equal(output.body.error,message);},c=>c.url.pathname.endsWith('/'+SERVER_SUBMISSION_CORRECTION_RPC)?response({message,code:`PT${status}`},status):undefined);
});
