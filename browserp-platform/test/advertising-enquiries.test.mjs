import test from "node:test";
import assert from "node:assert/strict";
import router from "../api/router.js";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { memberAdvertisingEnquiries,staffAdvertisingEnquiries,advertisingDestination } from "../lib/advertising-enquiries.js";
const uid="00000000-0000-4000-8000-000000000001",key="11111111-0000-4000-8000-000000000001",id="22222222-0000-4000-8000-000000000002",csrf="c".repeat(43);
const token=aal=>`fixture.${Buffer.from(JSON.stringify({sub:uid,aal})).toString("base64url")}.fixture`;
const user={id:uid,app_metadata:{provider:"discord",providers:["discord"]},identities:[{provider:"discord",provider_id:"fixture"}]};
const response=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{"Content-Type":"application/json"}});
const req=(body,aal="aal1")=>({method:body?"POST":"GET",url:"/api/me/advertising-enquiries",body,headers:{host:"localhost:8080",origin:"http://localhost:8080","content-type":"application/json","x-browserp-csrf":csrf,"x-browserp-account":uid,cookie:`brp_access=${token(aal)}; brp_csrf=${csrf}`},socket:{remoteAddress:"127.0.0.1"}});
function output(){const h=new Map();return{setHeader:(k,v)=>h.set(k,v),getHeader:k=>h.get(k)};}
async function fixture(run,handler=()=>{}){
 const env={SUPABASE_URL:"https://fixture.supabase.co",SUPABASE_PUBLISHABLE_KEY:"sb_publishable_fixture",SUPABASE_SECRET_KEY:"sb_secret_fixture",APP_URL:"http://localhost:8080",NODE_ENV:"test",VERCEL:"0",PRIVACY_HASH_SECRET:"fixture-secret"},previous=new Map(Object.keys(env).map(k=>[k,process.env[k]])),original=globalThis.fetch,calls=[];
 Object.assign(process.env,env);globalThis.fetch=async(value,options={})=>{const call={path:new URL(value).pathname,options,body:options.body?JSON.parse(options.body):undefined};calls.push(call);const custom=await handler(call);if(custom!==undefined)return custom;
  if(call.path==="/auth/v1/user")return response(user);
  if(call.path.endsWith("/rpc/check_security_ban_server"))return response(null);
  if(call.path.endsWith("/rpc/consume_rate_limit"))return response(true);
  if(call.path.endsWith("/rpc/staff_advertising_enquiry_access"))return response(true);
  if(/\/(member_advertising_enquiries|staff_advertising_enquiries|staff_review_advertising_enquiry)$/.test(call.path))return response({items:[],enquiry:{id,status:"submitted"}});
  throw new Error(`Unexpected request ${call.path}`);
 };try{await run(calls);}finally{globalThis.fetch=original;for(const[k,v]of previous)v===undefined?delete process.env[k]:process.env[k]=v;}
}
const create={action:"create",subject:"Community campaign",destinationUrl:"https://example.com/join?ref=browserp",placement:"directory",message:"Please discuss an advertising placement for our RP community.",key};
test("member create transmits only bounded enquiry fields on the current member token",async()=>fixture(async calls=>{
 await memberAdvertisingEnquiries(req({...create,userId:"attacker",status:"published",reply:"injected"}),output());
 const call=calls.find(c=>c.path.endsWith("/rpc/member_advertising_enquiries"));assert.deepEqual(call.body,{p_action:"create",p_key:key,p_data:{subject:create.subject,destinationUrl:create.destinationUrl,placement:create.placement,message:create.message}});assert.equal(call.options.headers.Authorization,`Bearer ${token("aal1")}`);
 assert.equal(calls.some(c=>c.path.includes("/storage/")||c.options.method==="DELETE"),false);assert.ok(calls.every(c=>c.path.startsWith("/auth/")||c.path.startsWith("/rest/v1/rpc/")));
}));
test("private destinations and malformed controls are rejected without outbound fetches",()=>{
 for(const value of["http://example.com","https://127.0.0.1","https://[::1]","https://example.com:443","https://example.com:1234","https://user:pass@example.com","https://user@example.com","https://localhost","https://domain.internal/a","https://example.com\\x","https://example.com/a b","https://example.com/\u0001"]){
  assert.throws(()=>advertisingDestination(value),{status:400},value);
 }
 assert.equal(advertisingDestination("https://Community.Example.com/campaign?source=BrowseRP#details"),"https://community.example.com/campaign?source=BrowseRP#details");
});
test("validation fails before writes for invalid drafts, versions, retry keys or actions",async()=>fixture(async calls=>{
 for(const change of[{subject:"a"},{subject:"Multi\nline"},{message:"short"},{message:"x".repeat(2001)},{subject:"x".repeat(121)},{placement:"paid"},{key:undefined},{action:"publish"}])await assert.rejects(memberAdvertisingEnquiries(req({...create,...change}),output()),{status:400});
 for(const body of[{action:"withdraw",id,key},{action:"withdraw",id,key,version:0},{action:"withdraw",id,key,version:1.5},{action:"withdraw",id:"bad",key,version:2}])await assert.rejects(memberAdvertisingEnquiries(req(body),output()),{status:400});
 assert.equal(calls.some(c=>c.path.endsWith("/rpc/member_advertising_enquiries")),false);
}));
test("CSRF and origin checks precede authentication, and account switching precedes private RPCs",async()=>{
 await fixture(async calls=>{for(const change of[{origin:"https://evil.example"},{"x-browserp-csrf":"wrong"}]){const request=req(create);Object.assign(request.headers,change);await assert.rejects(memberAdvertisingEnquiries(request,output()),{status:403});}assert.equal(calls.length,0);});
 await fixture(async calls=>{for(const body of[null,create,{action:"withdraw",id,version:1,key}]){const request=req(body);request.headers["x-browserp-account"]="another-account";await assert.rejects(memberAdvertisingEnquiries(request,output()),{status:401});}assert.equal(calls.some(c=>c.path.endsWith("/rpc/member_advertising_enquiries")),false);});
});
test("revoked-session and version/limit denials remain definite errors without fallback or service reads",async()=>{
 for(const status of[403,409,429])await fixture(async()=>{await assert.rejects(memberAdvertisingEnquiries(req(create),output()),{status});},call=>call.path.endsWith("/rpc/member_advertising_enquiries")?response({message:"Sign-in, enquiry version or limit changed."},status):undefined);
});
test("list cursors are paired and bounded and member owner arguments cannot be injected",async()=>fixture(async calls=>{
 const request=req();request.url=`/api/me/advertising-enquiries?before=2026-01-01T00:00:00Z&beforeId=${id}&userId=other&limit=1000`;await memberAdvertisingEnquiries(request,output());assert.deepEqual(calls.find(c=>c.path.endsWith("/rpc/member_advertising_enquiries")).body,{p_action:"list",p_before_time:"2026-01-01T00:00:00Z",p_before_id:id,p_limit:25});
 for(const query of[`beforeId=${id}`,"before=invalid",`before=invalid&beforeId=${id}`,"before=2026-01-01&beforeId=bad"]){request.url=`/api/me/advertising-enquiries?${query}`;await assert.rejects(memberAdvertisingEnquiries(request,output()),{status:400});}
}));
test("staff access probe is separate from private rows and review requires AAL2",async()=>fixture(async calls=>{
 const request=req(null,"aal2");request.url="/api/admin/advertising-enquiries?access=1";assert.deepEqual(await staffAdvertisingEnquiries(request,output()),{canReview:true});assert.equal(calls.some(c=>c.path.endsWith("/rpc/staff_advertising_enquiries")),false);
 await assert.rejects(staffAdvertisingEnquiries(req(),output()),{status:403});const low=req();low.url=request.url;assert.deepEqual(await staffAdvertisingEnquiries(low,output()),{canReview:false});
}));
test("staff changes carry expected version and immutable key and leave preservation of sent replies to SQL",async()=>fixture(async calls=>{
 await staffAdvertisingEnquiries(req({action:"review",id,version:4,status:"closed",reply:"",key,accountId:"other",paymentApproved:true},"aal2"),output());
 const call=calls.find(c=>c.path.endsWith("/rpc/staff_review_advertising_enquiry"));assert.deepEqual(call.body,{p_id:id,p_expected_version:4,p_status:"closed",p_reply:"",p_key:key});assert.equal(call.options.headers.Authorization,`Bearer ${token("aal2")}`);
 for(const body of[{status:"paid"},{version:null},{key:undefined},{reply:"x".repeat(2001)},{action:"erase"}])await assert.rejects(staffAdvertisingEnquiries(req({action:"review",id,version:4,status:"replied",reply:"A private reply to this campaign enquiry.",key,...body},"aal2"),output()),{status:400});
}));
test("staff permission denial and stale decisions are surfaced without returning private enquiry data",async()=>{
 for(const status of[403,409])await fixture(async()=>{await assert.rejects(staffAdvertisingEnquiries(req({action:"review",id,version:4,status:"reviewing",reply:"",key},"aal2"),output()),{status});},call=>call.path.endsWith("/rpc/staff_review_advertising_enquiry")?response({message:"Permission or version changed."},status):undefined);
});
test("both hosted router paths return private no-store responses and reject unsupported verbs",async()=>fixture(async()=>{
 for(const route of["me/advertising-enquiries","admin/advertising-enquiries"]){const request=req(null,route.startsWith("admin")?"aal2":"aal1");request.browserpRoute=route;const headers=new Map(),res={setHeader:(k,v)=>headers.set(k.toLowerCase(),v),getHeader:k=>headers.get(k.toLowerCase()),end(text){this.body=JSON.parse(text);}};await router(request,res);assert.equal(res.statusCode,200);assert.ok(Array.isArray(res.body.items));assert.match(headers.get("cache-control"),/no-store/);
 request.method="DELETE";await router(request,res);assert.equal(res.statusCode,405);}
}));

test("both enquiry routes stay in the existing hosted router and local server",()=>{
 const vercel=JSON.parse(readFileSync(new URL("../vercel.json",import.meta.url),"utf8")),dev=readFileSync(new URL("../dev-server.mjs",import.meta.url),"utf8");
 for(const role of["me","admin"]){const path=`/api/${role}/advertising-enquiries`;assert.equal(vercel.rewrites.find(x=>x.source===path)?.destination,`/api/router?_route=${role}/advertising-enquiries`);for(const method of["GET","POST"])assert.ok(dev.includes(`"${method} ${path}", ["api/router.js", "${role}/advertising-enquiries"]`));}
});

test("enquiry API preserves PostgreSQL microseconds across more than one same-millisecond page",async t=>{
 const db=new PGlite();t.after(()=>db.close());
 await db.exec(`create schema auth;create schema private;create table auth.users(id uuid primary key);create table public.profiles(id uuid primary key,display_name text);insert into auth.users values('${uid}');insert into public.profiles values('${uid}','Fixture member');`);
 const migration=readFileSync(new URL("../supabase/migrations/20260906020500_private_advertising_enquiries.sql",import.meta.url),"utf8");
 await db.exec(migration.match(/create table private\.advertising_enquiries \([\s\S]*?\n\);/)[0]);
 for(const name of["advertising_enquiry_json","advertising_enquiry_page"])await db.exec(migration.match(new RegExp(`create or replace function private\\.${name}\\([\\s\\S]*?\n\\$\\$;`))[0]);
 await db.exec(`insert into private.advertising_enquiries(user_id,subject,destination_url,placement,message,created_at)
  select '${uid}','Timestamp fixture '||n,'https://example.com/','any','A complete enquiry message fixture.',timestamptz '2026-09-06T12:00:00.123451+00:00'+(n%9)*interval '1 microsecond' from generate_series(1,61)n;`);
 const expected=(await db.query("select id::text id from private.advertising_enquiries order by created_at desc,id desc")).rows.map(x=>x.id);
 await fixture(async()=>{
  for(const staff of[false,true]){
   const handler=staff?staffAdvertisingEnquiries:memberAdvertisingEnquiries,seen=[];let next=null,pages=0;
   do{const request=req(null,staff?"aal2":"aal1"),params=new URLSearchParams();if(next){params.set("before",next.createdAt);params.set("beforeId",next.id);}
    request.url=`/api/${staff?"admin":"me"}/advertising-enquiries?${params}`;const page=await handler(request,output());seen.push(...page.items.map(x=>x.id));next=page.next;if(next)assert.match(next.createdAt,/\.12345[1-9]/);pages++;
   }while(next&&pages<5);
   assert.deepEqual(seen,expected,`${staff?"staff":"member"} must not skip microsecond rows or duplicate timestamp ties`);assert.equal(pages,3);
  }
 },async call=>{
  if(!/\/(member_advertising_enquiries|staff_advertising_enquiries)$/.test(call.path))return undefined;
  const body=call.body,staff=call.path.endsWith("/staff_advertising_enquiries");
  const result=await db.query("select private.advertising_enquiry_page($1,$2,$3,$4,$5,$6) value",[staff?null:uid,staff?body.p_status:"all",body.p_before_time,body.p_before_id,body.p_limit,staff]);return response(result.rows[0].value);
 });
});
