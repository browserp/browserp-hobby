import test from "node:test";
import assert from "node:assert/strict";
import { memberPrivacyRequests,staffPrivacyRequests } from "../lib/privacy-requests.js";
const uid="00000000-0000-4000-8000-000000000001",key="11111111-0000-4000-8000-000000000001",id="22222222-0000-4000-8000-000000000002",csrf="c".repeat(43);
const token=aal=>`fixture.${Buffer.from(JSON.stringify({sub:uid,aal})).toString("base64url")}.fixture`;
const user={id:uid,app_metadata:{provider:"discord",providers:["discord"]},identities:[{provider:"discord",provider_id:"fixture"}]};
const response=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{"Content-Type":"application/json"}});
const req=(body,aal="aal1")=>({method:body?"POST":"GET",url:"/api/me/data-requests",body,headers:{host:"localhost:8080",origin:"http://localhost:8080","content-type":"application/json","x-browserp-csrf":csrf,"x-browserp-account":uid,cookie:`brp_access=${token(aal)}; brp_csrf=${csrf}`},socket:{remoteAddress:"127.0.0.1"}});
function output(){const h=new Map();return{setHeader:(k,v)=>h.set(k,v),getHeader:k=>h.get(k)};}
async function fixture(run,handler=()=>{}){
 const env={SUPABASE_URL:"https://fixture.supabase.co",SUPABASE_PUBLISHABLE_KEY:"sb_publishable_fixture",SUPABASE_SECRET_KEY:"sb_secret_fixture",APP_URL:"http://localhost:8080",NODE_ENV:"test",VERCEL:"0",PRIVACY_HASH_SECRET:"fixture-secret"},previous=new Map(Object.keys(env).map(k=>[k,process.env[k]])),original=globalThis.fetch,calls=[];
 Object.assign(process.env,env);globalThis.fetch=async(value,options={})=>{const call={path:new URL(value).pathname,options,body:options.body?JSON.parse(options.body):undefined};calls.push(call);const custom=await handler(call);if(custom!==undefined)return custom;
  if(call.path==="/auth/v1/user")return response(user);
  if(call.path.endsWith("/rpc/check_security_ban_server"))return response(null);
  if(call.path.endsWith("/rpc/consume_rate_limit"))return response(true);
  if(call.path.endsWith("/rpc/staff_data_request_access"))return response(true);
  if(/\/(member_data_requests|staff_data_requests|staff_review_data_request|staff_fulfill_data_request|member_data_request_history|staff_data_request_history)$/.test(call.path))return response({items:[],request:{id,status:"submitted"}});
  throw new Error(`Unexpected request ${call.path}`);
 };try{await run(calls);}finally{globalThis.fetch=original;for(const[k,v]of previous)v===undefined?delete process.env[k]:process.env[k]=v;}
}
test("member requests use their own token and cannot pass an owner, state or completion instruction",async()=>fixture(async calls=>{
 await memberPrivacyRequests(req({action:"create",kind:"delete",details:"",key,userId:"attacker",status:"completed"}),output());
 const call=calls.find(c=>c.path.endsWith("/rpc/member_data_requests"));assert.deepEqual(call.body,{p_action:"create",p_kind:"delete",p_details:"",p_key:key});assert.equal(call.options.headers.Authorization,`Bearer ${token("aal1")}`);
 assert.equal(calls.some(c=>c.path.includes("/storage/")||c.options.method==="DELETE"),false);
}));
test("member validation rejects missing keys, invalid kinds, excessive text and unversioned updates",async()=>fixture(async calls=>{
 for(const body of [{action:"create",kind:"copy"},{action:"create",kind:"export",key},{action:"create",kind:"copy",key,details:"a".repeat(1001)},{action:"withdraw",id},{action:"update",id,version:1,details:"bad\u0001text"}])await assert.rejects(memberPrivacyRequests(req(body),output()),{status:400});
 assert.equal(calls.some(c=>c.path.endsWith("/rpc/member_data_requests")),false);
}));
test("origin, CSRF and revoked-session denial happen without returning request data",async()=>{
 await fixture(async calls=>{for(const change of [{origin:"https://evil.example"},{"x-browserp-csrf":"bad"}]){const request=req({action:"create",kind:"copy",key});Object.assign(request.headers,change);await assert.rejects(memberPrivacyRequests(request,output()),{status:403});}assert.equal(calls.length,0);});
 await fixture(async()=>{await assert.rejects(memberPrivacyRequests(req(),output()),{status:403});},call=>call.path.endsWith("/rpc/member_data_requests")?response({message:"An active, unrestricted sign-in is required"},403):undefined);
});
test("staff queue requires AAL2 and database permission and stays on the caller token",async()=>{
 await fixture(async calls=>{await assert.rejects(staffPrivacyRequests(req(),output()),{status:403});assert.equal(calls.some(c=>c.path.endsWith("/rpc/staff_data_requests")),false);});
 await fixture(async()=>{await assert.rejects(staffPrivacyRequests(req(null,"aal2"),output()),{status:403});},call=>call.path.endsWith("/rpc/staff_data_requests")?response({message:"Permission required"},403):undefined);
 await fixture(async calls=>{const request=req(null,"aal2");request.url=`/api/admin/data-requests?status=ready&kind=delete&before=2026-09-01T00:00:00Z&beforeId=${id}`;await staffPrivacyRequests(request,output());const call=calls.find(c=>c.path.endsWith("/rpc/staff_data_requests"));assert.equal(call.body.p_limit,25);assert.equal(call.body.p_status,"ready");assert.equal(call.options.headers.Authorization,`Bearer ${token("aal2")}`);});
});
test("staff decisions cannot mark exports or deletion completed and carry version and idempotency key",async()=>fixture(async calls=>{
 for(const status of["completed","deleted","exported"])await assert.rejects(staffPrivacyRequests(req({id,key,version:1,status,reply:"We are reviewing this request."},"aal2"),output()),{status:400});
 await staffPrivacyRequests(req({id,key,version:2,status:"ready",reply:"Reviewed and ready for follow-up."},"aal2"),output());
 const call=calls.find(c=>c.path.endsWith("/rpc/staff_review_data_request"));assert.deepEqual(call.body,{p_id:id,p_status:"ready",p_reply:"Reviewed and ready for follow-up.",p_expected_version:2,p_key:key});
}));

test("queue availability can be checked without returning private request rows",async()=>fixture(async calls=>{
 const request=req(null,"aal2");request.url="/api/admin/data-requests?access=1";
 assert.deepEqual(await staffPrivacyRequests(request,output()),{canReview:true});
 assert.equal(calls.some(c=>c.path.endsWith("/rpc/staff_data_requests")),false);
}));

const completion = { action: "fulfill", id, key, version: 4, method: "secure_delivery", result: "A scoped copy was securely delivered to the verified requester.", evidence: "Verified delivery in private case record COPY-456.", completedAt: "2026-01-01T12:00:00Z", confirmed: true };
test("completion requires a concrete attested result and sends only safe fields on the current staff token", async()=>fixture(async calls=>{
 for(const change of [{confirmed:false},{result:"Done"},{evidence:"yes"},{method:"deleteEverything"},{completedAt:"bad"},{completedAt:"2999-01-01"},{version:0},{key:undefined}])await assert.rejects(staffPrivacyRequests(req({...completion,...change},"aal2"),output()),{status:400});
 assert.equal(calls.some(c=>c.path.endsWith("/staff_fulfill_data_request")),false);
 await staffPrivacyRequests(req({...completion,userId:"someone-else",eraseNow:true},"aal2"),output());
 const call=calls.find(c=>c.path.endsWith("/staff_fulfill_data_request"));assert.deepEqual(call.body,{p_id:id,p_key:key,p_expected_version:4,p_method:completion.method,p_result:completion.result,p_evidence:completion.evidence,p_completed_at:"2026-01-01T12:00:00.000Z",p_confirmed:true});assert.equal(call.options.headers.Authorization,`Bearer ${token("aal2")}`);
 assert.equal(calls.some(c=>c.options.method==="DELETE"||c.path.includes("/storage/")),false);
}));
test("completion rechecks authority and does not swallow stale/revoked denials",async()=>{
 for(const status of[403,409])await fixture(async()=>{await assert.rejects(staffPrivacyRequests(req(completion,"aal2"),output()),{status});},call=>call.path.endsWith("/staff_fulfill_data_request")?response({message:status===403?"Completion permission required":"Request changed"},status):undefined);
 await fixture(async calls=>{const request=req(completion,"aal2");request.headers["x-browserp-account"]="different";await assert.rejects(staffPrivacyRequests(request,output()),{status:401});assert.equal(calls.some(c=>c.path.endsWith("/staff_fulfill_data_request")),false);});
} );
test("request history uses owned/authenticated RPCs, bounded cursor and no private cross-account read",async()=>fixture(async calls=>{
 const member=req();member.url=`/api/me/data-requests?id=${id}&beforeVersion=25`;await memberPrivacyRequests(member,output());
 let call=calls.find(c=>c.path.endsWith("/member_data_request_history"));assert.deepEqual(call.body,{p_id:id,p_before_version:25});assert.equal(call.options.headers.Authorization,`Bearer ${token("aal1")}`);
 const staff=req(null,"aal2");staff.url=`/api/admin/data-requests?id=${id}`;await staffPrivacyRequests(staff,output());assert.deepEqual(calls.find(c=>c.path.endsWith("/staff_data_request_history")).body,{p_id:id,p_before_version:null});
 for(const cursor of["0","-1","NaN","1.5"]){member.url=`/api/me/data-requests?id=${id}&beforeVersion=${cursor}`;await assert.rejects(memberPrivacyRequests(member,output()),{status:400});}
 staff.headers["x-browserp-account"]="another-account";await assert.rejects(staffPrivacyRequests(staff,output()),{status:401});
}));

test("export actions require displayed-account, CSRF and exact version/key; scope cannot be silently approved",async()=>fixture(async calls=>{
 for(const change of[{version:undefined},{key:undefined},{scopeComplete:undefined},{confirmed:false},{scopeComplete:false,supplementNote:'short'}])await assert.rejects(staffPrivacyRequests(req({action:'approve_export',id,key,version:3,scopeComplete:true,confirmed:true,...change},'aal2'),output()),{status:400});
 await staffPrivacyRequests(req({action:'approve_export',id,key,version:3,scopeComplete:false,supplementNote:'Uploaded files still need a separate copy.',confirmed:true,userId:'attacker'},'aal2'),output());
 assert.deepEqual(calls.find(x=>x.path.endsWith('/staff_approve_data_export')).body,{p_id:id,p_key:key,p_expected_version:3,p_scope_complete:false,p_supplement_note:'Uploaded files still need a separate copy.',p_confirmed:true});
 await memberPrivacyRequests(req({action:'generate_export',id,version:4,key,userId:'attacker',allAccounts:true}),output());
 assert.deepEqual(calls.find(x=>x.path.endsWith('/member_generate_data_export')).body,{p_id:id,p_expected_version:4,p_key:key});
 for(const action of['generate_export','read_export','check_export','receive_export']){const request=req({action,id,version:4,key,sha256:'a'.repeat(64),confirmed:true});request.headers['x-browserp-account']='switched';await assert.rejects(memberPrivacyRequests(request,output()),{status:401});}
},call=>/\/(staff_approve_data_export|member_generate_data_export)$/.test(call.path)?response({copy:{id}}):undefined));

test("private file bytes are integrity checked and withheld if authority changes before release",async()=>{
 const {createHash}=await import('node:crypto'),content='{"profile":{"displayName":"Private fixture"}}',sha256=createHash('sha256').update(content).digest('hex');
 for(const outcome of['valid','tampered','revoked'])await fixture(async calls=>{
  const work=memberPrivacyRequests(req({action:'read_export',id}),output());
  if(outcome==='valid'){const result=await work;assert.equal(result.content,content);assert.equal(calls.filter(x=>x.path.endsWith('/member_read_data_export')).length,2);}
  else await assert.rejects(work,{status:outcome==='tampered'?503:403});
 },call=>call.path.endsWith('/member_read_data_export')?call.body.p_check_only?(outcome==='revoked'?response({message:'Session revoked'},403):response({allowed:true,sha256})):response({content:outcome==='tampered'?content+'changed':content,copy:{id,sha256,byteSize:Buffer.byteLength(content)}}):undefined);
});
test("receipt requires a hash and explicit confirmation; check-only request cannot include file bytes",async()=>fixture(async calls=>{
 for(const change of[{sha256:'not-a-hash'},{confirmed:false}])await assert.rejects(memberPrivacyRequests(req({action:'receive_export',id,sha256:'a'.repeat(64),confirmed:true,...change}),output()),{status:400});
 await memberPrivacyRequests(req({action:'receive_export',id,sha256:'a'.repeat(64),confirmed:true}),output());
 await memberPrivacyRequests(req({action:'check_export',id}),output());
 assert.deepEqual(calls.find(x=>x.path.endsWith('/member_receive_data_export')).body,{p_id:id,p_sha256:'a'.repeat(64),p_confirmed:true});
 assert.deepEqual(calls.find(x=>x.path.endsWith('/member_read_data_export')).body,{p_id:id,p_check_only:true});
},call=>/\/(member_receive_data_export|member_read_data_export)$/.test(call.path)?response({allowed:true,sha256:'a'.repeat(64)}):undefined));
