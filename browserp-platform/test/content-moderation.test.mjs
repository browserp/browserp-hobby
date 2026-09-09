import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { classifyContent } from "../lib/content-classifier.js";
import { contentSignals, processContentCheck, processOAuthContent, contentModeration, contentAvatar, readContentAsset, freezeOAuthPicture, registerPrivateAvatar } from "../lib/content-moderation.js";
const owner="00000000-0000-4000-8000-000000000001", submission="00000000-0000-4000-8000-000000000101", asset="00000000-0000-4000-8000-000000000201";
const session={user:{id:owner},accessToken:"member-fixture-token"};
const pending={id:submission,kind:"comment",text:"Canonical submitted content",status:"pending_review",version:1,appealStatus:"none",reason:"Waiting for review."};
const input={...pending,ownerId:owner,fingerprint:"a".repeat(64),duplicate:false};
const assessment={decision:"approve",reason:"Synthetic fixture is acceptable.",policyVersion:"content-v1",checker:"openai:omni-moderation-2024-09-26",details:{}};
const req=(method="GET",body,url="/api/me/content-moderation")=>({method,url,headers:{host:"localhost:8080",origin:"http://localhost:8080","content-type":"application/json"},body});
const response=()=>({headers:{},setHeader(k,v){this.headers[k]=v;},end(value){this.body=value;}});
const bytes=()=>{const b=Buffer.alloc(40);Buffer.from([137,80,78,71,13,10,26,10]).copy(b);b.writeUInt32BE(13,8);b.write("IHDR",12);b.writeUInt32BE(8,16);b.writeUInt32BE(8,20);return b;};

test("legacy policy patterns and duplicates request review, including warnings",()=>{
 for(const x of [
  {kind:"comment",text:"Do not use discord.gift. Never share a recovery token."},
  {kind:"display_name",text:"BrowserpSupporter"},
  {kind:"comment",text:"Repeated comment",duplicate:true}
 ]){const signals=contentSignals(x);assert.ok(signals.length);assert.ok(signals.every(s=>s.level==="review"));}
 assert.deepEqual(contentSignals({kind:"comment",text:"I did not enjoy the queue, but the staff were helpful."}),[]);
});

test("canonical checker input is bound to owner/fingerprint/version and applied with member session",async()=>{
 const calls=[];let final=pending;
 const call=async(name,args,token,options)=>{
  calls.push({name,args,token,options});
  if(name==="member_content_moderation_item")return final;
  if(name==="service_content_check_input")return input;
  if(name==="service_record_content_check")return true;
  if(name==="member_apply_content_check")return final={...pending,status:"published",version:2};
  throw new Error(name);
 };
 const result=await processContentCheck(session,submission,{rpc:call,classify:async actual=>{assert.equal(actual.text,input.text);assert.equal(actual.kind,"comment");return assessment;}});
 assert.equal(result.status,"published");
 const recorded=calls.find(c=>c.name==="service_record_content_check");assert.deepEqual(recorded.args,{p_id:submission,p_owner:owner,p_version:1,p_fingerprint:input.fingerprint,p_result:assessment});assert.equal(recorded.token,undefined);assert.equal(recorded.options.useSecret,true);
 assert.equal(calls.find(c=>c.name==="member_apply_content_check").token,session.accessToken);
});

test("failed checking records review and a stale checker cannot overwrite a staff decision",async()=>{
 const records=[];let final=pending;
 const call=async(name,args)=>{
  if(name==="member_content_moderation_item")return final;
  if(name==="service_content_check_input")return input;
  if(name==="service_record_content_check"){records.push(args);return true;}
  if(name==="member_apply_content_check")return final={...pending,version:2};
 };
 assert.equal((await processContentCheck(session,submission,{rpc:call,classify:async()=>{throw new Error("private provider body must not leak");}})).status,"pending_review");
 assert.equal(records[0].p_result.decision,"review");assert.ok(!JSON.stringify(records).includes("private provider body"));
 let applied=false;let reads=0;
 const stale=await processContentCheck(session,submission,{classify:async()=>assessment,rpc:async(name)=>{
  if(name==="member_content_moderation_item")return ++reads===1?pending:{...pending,status:"blocked",version:4};
  if(name==="service_content_check_input")return input;
  if(name==="service_record_content_check")return false;
  if(name==="member_apply_content_check")applied=true;
 }});
 assert.equal(stale.status,"blocked");assert.equal(applied,false);
});

test("avatar classifier gets only frozen bytes; failure stays privately pending",async()=>{
 const image=bytes();const calls=[];
 const avatar={...pending,kind:"avatar",text:null};
 await processContentCheck(session,submission,{readAsset:async()=>({bytes:image,mimeType:"image/png"}),classify:async actual=>{
  assert.equal(actual.text,undefined);assert.equal(actual.imageBytes,image);return {...assessment,decision:"review"};
 },rpc:async(name,args)=>{
  calls.push(name);if(name==="member_content_moderation_item")return avatar;
  if(name==="service_content_check_input")return {...input,...avatar,assetId:asset};
  if(name==="service_record_content_check")return true;
  if(name==="member_apply_content_check")return avatar;
 }});
 assert.equal(calls.filter(c=>c==="service_record_content_check").length,1);
});

test("OAuth import checks at most its two private identity candidates, and cannot break sign-in",async()=>{
 const kinds=[],processed=[];
 await processOAuthContent(session,{rpc:async(name,args)=>{kinds.push(args.p_kind);if(args.p_kind==="avatar")throw new Error("no picture");return pending;},process:async(s,id)=>{processed.push(id);throw new Error("checker unavailable");}});
 assert.deepEqual(kinds,["display_name","avatar"]);assert.deepEqual(processed,[submission]);
});

test("member/staff review endpoints validate actions, versions, cursors and bounded bodies",async(t)=>{
 // Keep this local HTTP fixture independent of hosted build origin/runtime flags.
 const values={APP_URL:"http://localhost:8080",NODE_ENV:"test",VERCEL:"0",VERCEL_ENV:""};
 const previous=new Map(Object.keys(values).map(key=>[key,process.env[key]]));
 t.after(()=>{for(const [key,value] of previous)value===undefined?delete process.env[key]:process.env[key]=value;});
 Object.assign(process.env,values);
 const calls=[],deps={getSession:async()=>session,rateLimit:async()=>{},rpc:async(name,args,token)=>{calls.push({name,args,token});return {id:submission};}};
 for(const value of [null,undefined,0,-1,"1",1.1,Number.MAX_SAFE_INTEGER+1])await assert.rejects(contentModeration(req("POST",{id:submission,action:"appeal",statement:"Please review",expectedVersion:value}),{},deps),/Reload/);
 await assert.rejects(contentModeration(req("POST",{id:submission,action:"approve",expectedVersion:1}),{},deps),/appeal action/);
 await assert.rejects(contentModeration(req("GET",undefined,"/api/me/content-moderation?before="+"x".repeat(241)),{},deps),/Reload/);
 await assert.rejects(contentModeration(req("POST",{id:submission,action:"appeal",expectedVersion:1,statement:"x".repeat(5000)}),{},deps),/Payload/);
 const result=await contentModeration(req("POST",{id:submission,action:"appeal",expectedVersion:1,statement:"Please review the context.",decision:"approve",score:0}),{},deps);
 assert.equal(result.item.id,submission);assert.equal(calls[0].name,"member_appeal_content");assert.deepEqual(Object.keys(calls[0].args).sort(),["p_id","p_statement","p_version"]);
 await contentModeration(req("POST",{id:submission,action:"block",expectedVersion:1,reason:"A staff reason."}),{},{...deps,staff:true,requestId:"fixture"});assert.equal(calls[1].name,"staff_decide_content");
});

test("private upload registration precedes upload and never targets public storage",async()=>{
 const calls=[];const registered=await registerPrivateAvatar(owner,bytes(),"image/png",{rest:async(path,options)=>calls.push({path,options}),upload:async(...args)=>calls.push(args)});
 assert.equal(calls[0].path,"uploaded_assets");assert.equal(calls[0].options.body.bucket,"uploads-quarantine");assert.equal(calls[0].options.body.moderation_status,"quarantined");assert.equal(calls[1][0],"uploads-quarantine");assert.equal(registered.byteSize,40);
});

test("OAuth freezing rejects untrusted hosts, redirects, unsupported formats and size overflow",async()=>{
 let fetched=0;const fixtureFetch=async()=>{fetched++;return new Response("hello",{headers:{"content-type":"image/svg+xml"}});};
 for(const url of ["http://cdn.discordapp.com/a.png","https://cdn.discordapp.com.evil.test/a.png","https://user:password@cdn.discordapp.com/a.png","https://127.0.0.1/a.png","https://lh3.googleusercontent.com:123/a.png"]){await assert.rejects(freezeOAuthPicture(url,{fetchImpl:fixtureFetch}));}
 assert.equal(fetched,0);
 await assert.rejects(freezeOAuthPicture("https://cdn.discordapp.com/a.png",{fetchImpl:async(url,options)=>{assert.equal(options.redirect,"error");return new Response("hello");}}),/static/);
 await assert.rejects(freezeOAuthPicture("https://cdn.discordapp.com/a.png",{fetchImpl:async()=>new Response("x",{headers:{"content-length":"1048577"}})}),/too large/);
});

test("storage read verifies immutable hash/size/type and returns no storage URL",async()=>{
 const image=bytes();const metadata={ownerId:owner,bucket:"uploads-quarantine",path:`${owner}/${asset}.png`,mimeType:"image/png",sha256:createHash("sha256").update(image).digest("hex"),byteSize:image.length};
 const deps={rpc:async()=>metadata,config:()=>({url:"https://example.supabase.co",secretKey:"server-fixture-key"}),fetch:async(url,options)=>{assert.ok(url.includes("/object/authenticated/uploads-quarantine/"));assert.equal(options.headers.apikey,"server-fixture-key");return new Response(image);}};
 assert.deepEqual(Object.keys(await readContentAsset(submission,asset,deps)).sort(),["bytes","mimeType"]);
 await assert.rejects(readContentAsset(submission,asset,{...deps,fetch:async()=>new Response(Buffer.alloc(40))}),/changed/);
 await assert.rejects(readContentAsset(submission,asset,{...deps,rpc:async()=>({...metadata,path:`../${asset}.png`})}),/unavailable/);
});

test("avatar bytes require current approval before and after fetch, with no cache",async()=>{
 const res=response(),calls=[];
 const deps={getSession:async()=>session,rateLimit:async()=>{},rpc:async(name,args,token)=>{calls.push({name,args,token});return {assetId:asset,version:2};},readAsset:async()=>({bytes:bytes(),mimeType:"image/png"})};
 await contentAvatar(req("GET",undefined,`/api/content-moderation/preview?id=${submission}`),res,deps);assert.equal(res.headers["Cache-Control"],"private, no-store");assert.equal(calls.length,2);assert.ok(calls.every(c=>c.token===session.accessToken));
 const pub=response();await contentAvatar(req("GET",undefined,`/api/public/profile-avatar?id=${submission}`),pub,{...deps,publicImage:true});assert.equal(pub.headers["Cache-Control"],"private, no-store");
 let count=0;const denied=response();await assert.rejects(contentAvatar(req("GET",undefined,`/api/public/profile-avatar?id=${submission}`),denied,{...deps,publicImage:true,rpc:async()=>{if(++count===2)throw new Error("Picture not found");return {assetId:asset,version:2};}}),/not found/);assert.equal(denied.body,undefined);
 let read=false;await assert.rejects(contentAvatar(req("GET",undefined,`/api/content-moderation/preview?id=${submission}`),response(),{...deps,rpc:async()=>{throw new Error("access required");},readAsset:async()=>{read=true;}}),/access/);assert.equal(read,false);
});


test("canonical avatar null text reaches real classifier, covered violations block and clear images stay review",async()=>{
 const cats=["harassment","harassment/threatening","hate","hate/threatening","illicit","illicit/violent","self-harm","self-harm/intent","self-harm/instructions","sexual","sexual/minors","violence","violence/graphic"];
 const covered=new Set(["self-harm","self-harm/intent","self-harm/instructions","sexual","violence","violence/graphic"]);
 for(const violation of [false,true]){
  let calls=0,recorded;
  const data={id:"modr-integration-fixture",model:"omni-moderation-2024-09-26",results:[{
   flagged:violation,categories:Object.fromEntries(cats.map(c=>[c,violation&&c==="sexual"])),
   category_scores:Object.fromEntries(cats.map(c=>[c,violation&&c==="sexual"?.99:covered.has(c)?.001:0])),
   category_applied_input_types:Object.fromEntries(cats.map(c=>[c,covered.has(c)?["image"]:[]]))
  }]};
  const avatar={...pending,kind:"avatar",text:null};
  await processContentCheck(session,submission,{readAsset:async()=>({bytes:bytes(),mimeType:"image/png"}),
   classify:actual=>classifyContent(actual,{env:{CONTENT_MODERATION_PROVIDER:"openai",OPENAI_API_KEY:"synthetic-key"},fetch:async(url,options)=>{
    calls++;const payload=JSON.parse(options.body);assert.equal(payload.input.length,1);assert.equal(payload.input[0].type,"image_url");
    return new Response(JSON.stringify(data),{headers:{"content-type":"application/json"}});
   }}),rpc:async(name,args)=>{
    if(name==="member_content_moderation_item")return avatar;
    if(name==="service_content_check_input")return {...input,...avatar,assetId:asset};
    if(name==="service_record_content_check"){recorded=args.p_result;return true;}
    if(name==="member_apply_content_check")return avatar;
   }});
  assert.equal(calls,1);assert.equal(recorded.decision,violation?"block":"review");
 }
});


test("member and staff cursors serialize as opaque JSON strings with microsecond precision",async()=>{
 const next={id:submission,createdAt:"2026-09-09T09:00:00.000123+00:00"};
 for(const staff of [false,true]){
  const page=await contentModeration(req(),{},{staff,getSession:async()=>session,rateLimit:async()=>{},rpc:async()=>({items:[pending],nextBefore:next})});
  assert.equal(typeof page.nextBefore,"string");assert.deepEqual(JSON.parse(page.nextBefore),next);
 }
});
