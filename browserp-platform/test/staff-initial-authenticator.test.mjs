import test from "node:test";
import assert from "node:assert/strict";
import { prepareInitialStaffAuthenticator, verifyInitialStaffAuthenticator } from "../lib/staff-initial-authenticator.js";
import { getSession } from "../lib/supabase.js";
import router from "../api/router.js";
const uid="00000000-0000-4000-8000-000000000001", pending="11111111-0000-4000-8000-000000000001", replacement="22222222-0000-4000-8000-000000000002", other="33333333-0000-4000-8000-000000000003", challenge="44444444-0000-4000-8000-000000000004";
const factor=(id=pending,status="unverified")=>({id,status,factor_type:"totp",friendly_name:"BrowseRP staff"});
const user=factors=>({id:uid,app_metadata:{provider:"discord",providers:["discord"]},identities:[{provider:"discord",provider_id:"fixture-discord"}],factors});
const token=aal=>`fixture.${Buffer.from(JSON.stringify({sub:uid,aal})).toString("base64url")}.fixture`,csrf="c".repeat(43);
const response=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{"Content-Type":"application/json"}});
const request=body=>({method:"POST",body,headers:{host:"localhost:8080",origin:"http://localhost:8080","content-type":"application/json","x-browserp-csrf":csrf,cookie:`brp_access=${token("aal1")}; brp_csrf=${csrf}`},socket:{remoteAddress:"127.0.0.1"}});
function output(){const headers=new Map();return{setHeader:(k,v)=>headers.set(k,v),getHeader:k=>headers.get(k)};}
async function fixture(run,options={}){
  const env={SUPABASE_URL:"https://fixture.supabase.co",SUPABASE_PUBLISHABLE_KEY:"sb_publishable_fixture",SUPABASE_SECRET_KEY:"sb_secret_fixture",APP_URL:"http://localhost:8080",NODE_ENV:"test",VERCEL:"0",PRIVACY_HASH_SECRET:"fixture-secret"};
  const previous=new Map(Object.keys(env).map(k=>[k,process.env[k]])),fetch=globalThis.fetch;Object.assign(process.env,env);
  const state={factors:[factor()],allowed:true,lock:null,calls:[],...options};
  globalThis.fetch=async(value,config={})=>{
    const call={path:new URL(value).pathname,body:config.body?JSON.parse(config.body):undefined,method:config.method||"GET",config};state.calls.push(call);
    const custom=await options.fetch?.(call,state);if(custom!==undefined)return custom;
    if(call.path==="/auth/v1/user")return response(user(state.factors));
    if(call.path.endsWith("/rpc/check_security_ban_server"))return response(null);
    if(call.path.endsWith("/rpc/consume_rate_limit")||call.path.endsWith("/rpc/staff_mfa_enrollment_allowed"))return response(state.allowed);
    if(call.path.endsWith("/rpc/record_account_activity_server"))return response(1);
    if(call.path.endsWith("/rpc/staff_security_status"))return response({isOwner:false,staffMfaRequired:true});
    if(call.path.endsWith("/rpc/staff_initial_authenticator_operation")){
      if(!state.allowed)return response({message:"An active staff sign-in is required."},403);
      if(call.body.p_action==="release"){if(state.lock===call.body.p_operation_id)state.lock=null;return response(true);}
      if(state.factors.some(item=>item.status==="verified"))return response({message:"Already verified"},403);
      if(call.body.p_action==="check")return response(state.lock===call.body.p_operation_id);
      if(state.lock)return response(false);state.lock=call.body.p_operation_id;return response(true);
    }
    if(call.method==="DELETE"){state.factors=state.factors.filter(item=>item.id!==call.path.split("/").at(-1));return response({id:pending});}
    if(call.path==="/auth/v1/factors"){state.factors.push(factor(replacement));return response({id:replacement,totp:{secret:"ABCDEFGHIJKLMNOP",qr_code:"<svg></svg>"}});}
    if(call.path.endsWith("/challenge"))return response({id:challenge});
    if(call.path.endsWith("/verify")){state.factors.find(item=>item.id===call.path.split("/").at(-2)).status="verified";return response({user:user(state.factors),access_token:token("aal2"),refresh_token:"fixture-refresh"});}
    throw new Error(`Unexpected request ${call.path}`);
  };
  try{await run(state);}finally{globalThis.fetch=fetch;for(const[k,v]of previous)v===undefined?delete process.env[k]:process.env[k]=v;}
}

test("first setup uses BrowseRP issuer and cannot silently duplicate an unfinished factor",async()=>{
  await fixture(async state=>{const result=await prepareInitialStaffAuthenticator(request({}),output(),"fixture");assert.equal(result.id,replacement);assert.equal(state.calls.find(call=>call.path==="/auth/v1/factors").body.issuer,"BrowseRP");},{factors:[]});
  await fixture(async state=>{await assert.rejects(prepareInitialStaffAuthenticator(request({}),output(),"fixture"),{status:409});assert.equal(state.calls.some(call=>call.path==="/auth/v1/factors"),false);assert.equal(state.factors[0].id,pending);});
});

test("restart replaces only the chosen owned unverified setup and keeps other pending factors",async()=>fixture(async state=>{
  await prepareInitialStaffAuthenticator(request({action:"restart",factorId:pending}),output(),"fixture");
  assert.deepEqual(state.calls.filter(call=>call.method==="DELETE").map(call=>call.path),[`/auth/v1/factors/${pending}`]);
  assert.deepEqual(state.factors.map(item=>item.id),[other,replacement]);assert.equal(state.lock,null);
},{factors:[factor(),{...factor(other),friendly_name:"Another unfinished setup"}]}));

test("restart refuses foreign factors, verified accounts, revoked eligibility and CSRF",async()=>{
  await fixture(async state=>{await assert.rejects(prepareInitialStaffAuthenticator(request({action:"restart",factorId:other}),output(),"fixture"),{status:409});assert.equal(state.calls.some(call=>call.method==="DELETE"),false);});
  for(const options of [{factors:[factor(pending,"verified")]},{allowed:false}])await fixture(async state=>{await assert.rejects(prepareInitialStaffAuthenticator(request({action:"restart",factorId:pending}),output(),"fixture"),{status:403});assert.equal(state.calls.some(call=>call.method==="DELETE"),false);},options);
  await fixture(async state=>{const req=request({action:"restart",factorId:pending});req.headers["x-browserp-csrf"]="bad";await assert.rejects(prepareInitialStaffAuthenticator(req,output(),"fixture"),{status:403});assert.equal(state.calls.some(call=>call.method==="DELETE"),false);});
});

test("resuming an owned pending setup verifies its code and safely rotates the session",async()=>fixture(async state=>{
  const res=output();const result=await verifyInitialStaffAuthenticator(request({factorId:pending,code:"123456"}),res,"fixture");
  assert.equal(result.user.id,uid);assert.equal(state.factors[0].status,"verified");assert.ok(res.getHeader("Set-Cookie").some(item=>item.startsWith("brp_access=")));assert.equal(state.lock,null);
  assert.equal(state.calls.some(call=>call.method==="DELETE"),false);
}));

test("a setup verified after the first read is rechecked before any removal",async()=>fixture(async state=>{
  await assert.rejects(prepareInitialStaffAuthenticator(request({action:"restart",factorId:pending}),output(),"fixture"),{status:403});
  assert.equal(state.calls.some(call=>call.method==="DELETE"),false);
},{fetch(call,state){if(call.path.endsWith("/rpc/staff_initial_authenticator_operation")&&call.body.p_action==="check")state.factors[0].status="verified";}}));

test("simultaneous first verification and restart cannot both act on the same factor",async()=>{
  let reached,unblock;const waiting=new Promise(resolve=>{reached=resolve;});
  await fixture(async state=>{
    const verifying=verifyInitialStaffAuthenticator(request({factorId:pending,code:"123456"}),output(),"verify");await waiting;
    await assert.rejects(prepareInitialStaffAuthenticator(request({action:"restart",factorId:pending}),output(),"restart"),{status:409});
    unblock();await verifying;assert.equal(state.factors[0].status,"verified");assert.equal(state.calls.some(call=>call.method==="DELETE"),false);
  },{async fetch(call){if(call.path.endsWith("/challenge")){reached();await new Promise(resolve=>{unblock=resolve;});}}});
});

test("uncertain provider removal retains the lease and performs no replacement enrolment",async()=>{
  for(const status of [408,503])await fixture(async state=>{
    await assert.rejects(prepareInitialStaffAuthenticator(request({action:"restart",factorId:pending}),output(),"fixture"),{status});
    assert.ok(state.lock);assert.equal(state.calls.some(call=>call.path==="/auth/v1/factors"),false);
  },{fetch(call){if(call.method==="DELETE")return response({message:"Interrupted"},status);}});
});

test("a trusted router session avoids double refresh while still rechecking live factors and CSRF",async()=>{
  for(const verify of [false,true]) await fixture(async state=>{
    const req=request(verify?{factorId:pending,code:"123456"}:{}),res=output();
    req.headers.cookie=`brp_access=expired; brp_refresh=fixture-original-refresh; brp_csrf=${csrf}`;
    const session=await getSession(req,res,{required:true,provider:"discord"});
    const handler=verify?verifyInitialStaffAuthenticator:prepareInitialStaffAuthenticator;
    await handler(req,res,"fixture",session);
    assert.equal(state.calls.filter(call=>call.path==="/auth/v1/token").length,1);
    assert.equal(state.calls.filter(call=>call.path==="/auth/v1/user").length,2);
    req.headers["x-browserp-csrf"]="bad";
    await assert.rejects(handler(req,res,"fixture",session),{status:403});
  },{factors:verify?[factor()]:[],fetch(call,state){
    if(call.path==="/auth/v1/user"&&call.config.headers.Authorization==="Bearer expired")return response({message:"Expired"},401);
    if(call.path==="/auth/v1/token")return response({user:user(state.factors),access_token:token("aal1"),refresh_token:"fixture-new-refresh"});
  }});
});

test("the public routes use the initial lock for restart and verification without serializing provider sessions",async()=>{
  const invoke=async(route,body)=>{const req=request(body),res=output();req.browserpRoute=route;res.end=value=>{res.payload=JSON.parse(value);};await router(req,res);return res;};
  await fixture(async state=>{
    const restarted=await invoke("auth/mfa/enroll",{action:"restart",factorId:pending});
    assert.equal(restarted.statusCode,201);assert.equal(restarted.payload.factor.id,replacement);
    const verified=await invoke("auth/mfa/verify",{factorId:replacement,code:"123456"});
    assert.equal(verified.statusCode,200);assert.equal(verified.payload.verified,true);
    assert.doesNotMatch(JSON.stringify(verified.payload),/access_token|refresh_token|secret|ABCDEFGHIJKLMNOP/);
    assert.equal(state.calls.filter(call=>call.path.endsWith("/rpc/staff_initial_authenticator_operation")&&call.body.p_action==="acquire").length,2);
    const refused=await invoke("auth/mfa/enroll",{action:"restart",factorId:replacement});
    assert.equal(refused.statusCode,409);assert.equal(state.calls.filter(call=>call.method==="DELETE").length,1);
  });
});
