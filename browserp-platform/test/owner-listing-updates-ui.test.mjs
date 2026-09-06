import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {JSDOM,VirtualConsole} from "jsdom";
const read=file=>readFileSync(new URL(`../public/${file}`,import.meta.url),"utf8");
const settle=async()=>{for(let i=0;i<8;i++)await new Promise(resolve=>setImmediate(resolve));};
const owner="00000000-0000-4000-8000-000000000001",id="bbbbbbbb-0000-4000-8000-000000000001";
const original={id,name:"Original community",platform_id:"redm",region:"Europe",language:"French",framework:"VORP",description:"An established community with a carefully documented setting and welcoming rules.",community_url:"https://discord.gg/original",cfx_join_url:"https://cfx.re/join/example",access_type:"application",tags:["serious-roleplay","legacy-feature"],status:"changes_requested",review_note:'Please correct the link. <img src=x onerror="bad()">',review_version:3,queue_version:1,reviewed_at:"2026-09-05T10:00:00Z"};
const reply=(data,status=200)=>({ok:status<400,status,json:async()=>data});
function setup(t,override=()=>undefined,{query=`?listing=${id}`,session={authenticated:true,csrfToken:"fixture-csrf",user:{id:owner,profile:{display_name:"Fixture owner"}}}}={}){
 const navigation=[];const virtualConsole=new VirtualConsole();virtualConsole.on("jsdomError",error=>{navigation.push(error.message);});
 const dom=new JSDOM(read("list-server.html"),{virtualConsole,url:`https://browserp.test/list-server${query}`,runScripts:"outside-only",pretendToBeVisual:true});const w=dom.window;t.after(()=>w.close());const calls=[];
 w.fetch=async(path,options={})=>{const c={path,options,body:options.body&&JSON.parse(options.body)};calls.push(c);const custom=await override(c);if(custom!==undefined)return custom;
 if(path==="/api/platforms")return reply({platforms:["fivem","redm","roblox","minecraft"].map(id=>({id,name:id}))});
 if(path==="/api/auth/session")return reply(session);
 if(path==="/api/auth/providers")return reply({providers:{discord:true,google:false}});
 if(path.startsWith("/api/submissions?listing="))return reply({submission:{...original,status:"owner_draft"},ownerUpdate:{serverId:id,serverVersion:7,slug:"fixed-address",live:original}});
 if(path==="/api/submissions"&&options.method==="POST")return reply({submission:{id:"cccccccc-0000-4000-8000-000000000001",status:"pending_review",review_version:2}});
 if(path.startsWith("/api/submissions?id="))return reply({submission:original,history:[{version:1,review_note:"Explain your community's setting.",reviewed_at:"2026-09-04T10:00:00Z"}]});
 if(path==="/api/submissions"&&options.method==="PATCH")return reply({submission:{id,status:"pending_review",review_version:4}});
 throw new Error(`Unexpected fixture request ${path}`);};
 w.eval(read("submission-correction.js"));w.eval(read("browserp-directory.js"));
 const form=w.document.querySelector("#listing-form");const send=()=>form.dispatchEvent(new w.Event("submit",{bubbles:true,cancelable:true}));
 return{w,doc:w.document,form,calls,send,navigation};
}
function ready(h){h.form.elements.agreement.checked=true;h.form.elements.description.value=original.description+" Now corrected.";}

test("owner form preloads, fixes source identity, checks current account and sends one reviewed proposal",async t=>{
 const h=setup(t);await settle();assert.equal(h.form.hidden,false);assert.equal(h.form.elements.platform.disabled,true);assert.equal(h.form.elements.cfxJoinUrl.readOnly,true);assert.equal(h.form.elements.name.value,original.name);assert.equal(h.form.elements.description.maxLength,3000);assert.match(h.doc.body.textContent,/current listing stays live/);
 ready(h);h.send();await settle();const sent=h.calls.filter(c=>c.options.method==="POST");assert.equal(sent.length,1);assert.equal(sent[0].body.listingUpdate,id);assert.equal(sent[0].body.expectedServerVersion,7);assert.equal(sent[0].body.expectedAccountId,owner);assert.equal(sent[0].body.platform,"redm");assert.equal(sent[0].body.language,"French");assert.equal(sent[0].body.framework,"VORP");assert.equal(h.form.hidden,true);assert.match(h.doc.body.textContent,/Update received/);h.send();await settle();assert.equal(h.calls.filter(c=>c.options.method==="POST").length,1);
});
test("existing open update leads to its review instead of permitting duplicate proposals",async t=>{
 const h=setup(t,c=>c.path.includes("?listing=")?reply({submission:{...original,status:"owner_draft"},ownerUpdate:{serverId:id,serverVersion:7,live:original,pendingStatus:"changes_requested",pendingId:"cccccccc-0000-4000-8000-000000000001"}}):undefined);await settle();assert.equal(h.form.hidden,true);const link=h.doc.querySelector('.submission-correction-v3 a[href*="?submission="]');assert.match(link.textContent,/existing review/);h.send();await settle();assert.equal(h.calls.some(c=>c.options.method==="POST"),false);
});
test("owner retry keeps identical data/key, and a switched account or navigation prevents late writes",async t=>{
 let writes=0;const h=setup(t,c=>c.options.method==="POST"&&++writes===1?reply({error:"Temporary error"},503):undefined);await settle();ready(h);h.send();await settle();const draft=h.form.elements.description.value;h.form.elements.description.value="Unsent browser alteration.";h.send();await settle();const sent=h.calls.filter(c=>c.options.method==="POST");assert.equal(sent.length,2);assert.equal(sent[0].options.body,sent[1].options.body);assert.equal(sent[0].options.headers["Idempotency-Key"],sent[1].options.headers["Idempotency-Key"]);assert.equal(sent[1].body.description,draft);
 let checks=0;const switched=setup(t,c=>c.path==="/api/auth/session"&&++checks>1?reply({authenticated:true,user:{id:"00000000-0000-4000-8000-000000000002"}}):undefined);await settle();ready(switched);switched.send();await settle();assert.equal(switched.calls.some(c=>c.options.method==="POST"),false);assert.equal(switched.form.hidden,true);assert.equal(switched.form.elements.name.value,"");
});
test("owner corrections compare current live data and rebind its version after staff feedback",async t=>{
 const payload={submission:original,ownerUpdate:{serverId:id,serverVersion:9,baselineVersion:7,live:{...original,description:"Staff changed the current public description with updated details."}}};const h=setup(t,c=>c.path.includes("?id=")?reply(payload):undefined,{query:`?submission=${id}`});await settle();assert.equal(h.form.hidden,false);assert.match(h.doc.body.textContent,/live listing changed after/);assert.match(h.doc.body.textContent,/Staff changed the current public description/);ready(h);h.send();await settle();const sent=h.calls.find(c=>c.options.method==="PATCH");assert.equal(sent.body.ownerUpdate,true);assert.equal(sent.body.expectedServerVersion,9);assert.equal(sent.body.expectedVersion,3);
});
test("unconfirmed ownership and late private read cannot reveal or submit the owner form",async t=>{
 const missing=setup(t,c=>c.path.includes("?listing=")?reply({submission:{...original,status:"owner_draft"}}):undefined);await settle();assert.equal(missing.form.hidden,true);missing.send();await settle();assert.equal(missing.calls.some(c=>c.options.method==="POST"),false);
 let release;const h=setup(t,c=>c.path.includes("?listing=")?new Promise(resolve=>{release=()=>resolve(reply({submission:{...original,status:"owner_draft"},ownerUpdate:{serverId:id,serverVersion:7,live:original}}));}):undefined);await settle();h.w.dispatchEvent(new h.w.PageTransitionEvent("pagehide",{persisted:true}));release();await settle();assert.equal(h.form.hidden,true);assert.equal(h.form.elements.name.value,"");assert.doesNotMatch(h.doc.body.textContent,/Original community/);
});

test("Roblox owner form keeps identity locked and offers only public joining edits without private proof inputs",async t=>{
 const rb={kind:"independent_community",experienceUrl:"https://www.roblox.com/games/12345",communityGroupUrl:"https://www.roblox.com/communities/6789",joiningInstructions:"Join the official Discord, read the rules and apply for organised roleplay sessions."};
 const listing={...original,status:"owner_draft",platform_id:"roblox",framework:"Emergency Response Liberty County",cfx_join_url:null,roblox:rb};
 const h=setup(t,c=>c.path.includes("?listing=")?reply({submission:listing,ownerUpdate:{serverId:id,serverVersion:7,live:listing}}):undefined);await settle();assert.equal(h.form.hidden,false);assert.equal(h.form.elements.framework.readOnly,true);assert.equal(h.form.elements.robloxKind.disabled,true);assert.equal(h.form.elements.robloxExperienceUrl.readOnly,true);assert.equal(h.form.elements.robloxAuthorityEvidence.required,false);assert.equal(h.form.elements.robloxAuthorityEvidence.closest("label").hidden,true);assert.equal(h.form.querySelector(".roblox-private-evidence-v3").hidden,true);
 ready(h);h.form.elements.robloxJoiningInstructions.value=rb.joiningInstructions+" Weekend orientation is available.";h.send();await settle();const sent=h.calls.find(c=>c.options.method==="POST");assert.ok(sent);assert.equal(sent.body.roblox.experienceUrl,rb.experienceUrl);assert.equal(sent.body.roblox.authorityEvidence,undefined);assert.equal(sent.body.roblox.applicantRole,undefined);assert.match(sent.body.roblox.joiningInstructions,/Weekend orientation/);
});
