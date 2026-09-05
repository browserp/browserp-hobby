import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {JSDOM,VirtualConsole} from "jsdom";
const read=file=>readFileSync(new URL(`../public/${file}`,import.meta.url),"utf8");
const settle=async()=>{for(let i=0;i<8;i++)await new Promise(resolve=>setImmediate(resolve));};
const owner="00000000-0000-4000-8000-000000000001",id="bbbbbbbb-0000-4000-8000-000000000001";
const original={id,name:"Original community",platform_id:"redm",region:"Europe",language:"French",framework:"VORP",description:"An established community with a carefully documented setting and welcoming rules.",community_url:"https://discord.gg/original",cfx_join_url:"https://cfx.re/join/example",access_type:"application",tags:["serious-roleplay","legacy-feature"],status:"changes_requested",review_note:'Please correct the link. <img src=x onerror="bad()">',review_version:3,queue_version:1,reviewed_at:"2026-09-05T10:00:00Z"};
const reply=(data,status=200)=>({ok:status<400,status,json:async()=>data});
function setup(t,override=()=>undefined,{query=`?submission=${id}`,session={authenticated:true,csrfToken:"fixture-csrf",user:{id:owner,profile:{display_name:"Fixture owner"}}}}={}){
 const navigation=[];const virtualConsole=new VirtualConsole();virtualConsole.on("jsdomError",error=>{navigation.push(error.message);});
 const dom=new JSDOM(read("list-server.html"),{virtualConsole,url:`https://browserp.test/list-server${query}`,runScripts:"outside-only",pretendToBeVisual:true});const w=dom.window;t.after(()=>w.close());const calls=[];
 w.fetch=async(path,options={})=>{const c={path,options,body:options.body&&JSON.parse(options.body)};calls.push(c);const custom=await override(c);if(custom!==undefined)return custom;
 if(path==="/api/platforms")return reply({platforms:["fivem","redm","roblox","minecraft"].map(id=>({id,name:id}))});
 if(path==="/api/auth/session")return reply(session);
 if(path==="/api/auth/providers")return reply({providers:{discord:true,google:false}});
 if(path.startsWith("/api/submissions?id="))return reply({submission:original,history:[{version:1,review_note:"Explain your community's setting.",reviewed_at:"2026-09-04T10:00:00Z"}]});
 if(path==="/api/submissions"&&options.method==="PATCH")return reply({submission:{id,status:"pending_review",review_version:4}});
 throw new Error(`Unexpected fixture request ${path}`);};
 w.eval(read("submission-correction.js"));w.eval(read("browserp-directory.js"));
 const form=w.document.querySelector("#listing-form");const send=()=>form.dispatchEvent(new w.Event("submit",{bubbles:true,cancelable:true}));
 return{w,doc:w.document,form,calls,send,navigation};
}
function ready(h){h.form.elements.agreement.checked=true;h.form.elements.description.value=original.description+" Now corrected.";}

test("correction preloads original language/setup/access and previous features, displays feedback safely and submits same ID",async t=>{
 const h=setup(t);await settle();assert.equal(h.form.hidden,false);assert.equal(h.form.elements.name.value,original.name);assert.equal(h.form.elements.language.value,"French");assert.equal(h.form.elements.framework.value,"VORP");assert.equal(h.form.elements.platform.value,"redm");assert.equal(h.form.elements.accessType.value,"application");assert.equal(h.form.elements.agreement.checked,false);
 assert.deepEqual([...h.form.querySelectorAll('[name="tags"]:checked')].map(x=>x.value).sort(),[...original.tags].sort());assert.equal(h.doc.querySelector(".submission-correction-v3 img"),null);assert.match(h.doc.querySelector(".submission-correction-v3").textContent,/<img src=x/);assert.match(h.doc.body.textContent,/Previous review feedback/);
 ready(h);h.send();await settle();const write=h.calls.find(c=>c.options.method==="PATCH");assert.equal(write.body.submissionId,id);assert.equal(write.body.expectedAccountId,owner);assert.equal(write.body.expectedVersion,3);assert.equal(write.body.language,"French");assert.equal(write.body.framework,"VORP");assert.equal(write.options.headers["X-BrowseRP-CSRF"],"fixture-csrf");assert.equal(h.calls.filter(c=>c.options.method==="POST").length,0);assert.equal(h.form.hidden,true);assert.match(h.doc.body.textContent,/Corrections received/);
});
test("pending, approved and withdrawn submissions are truthful read-only states",async t=>{
 for(const state of ["pending_review","approved","withdrawn"]){const h=setup(t,c=>c.path.startsWith("/api/submissions?id=")?reply({submission:{...original,status:state},history:[]}):undefined);await settle();assert.equal(h.form.hidden,true);h.send();await settle();assert.equal(h.calls.some(c=>c.options.method==="PATCH"),false);assert.match(h.doc.querySelector(".submission-correction-v3").textContent,state==="pending_review"?/don't need to send it again/:/review is closed/);}
});
test("a failed load never exposes an empty duplicate form and its locked retry recovers",async t=>{
 let reads=0,release;const h=setup(t,c=>{if(c.path.startsWith("/api/submissions?id=")){if(++reads===1)return reply({error:"Review service unavailable."},503);return new Promise(resolve=>{release=()=>resolve(reply({submission:original}));});}});await settle();assert.equal(h.form.hidden,true);const retry=h.doc.querySelector(".submission-correction-v3 button");retry.click();retry.click();await settle();assert.equal(reads,2);assert.equal(retry.disabled,true);release();await settle();assert.equal(h.form.hidden,false);
});
test("in-flight resubmission locks duplicate events and ambiguous retry uses identical body/key",async t=>{
 let release,writes=0;const h=setup(t,c=>{if(c.options.method==="PATCH"){writes++;if(writes===1)return new Promise(resolve=>{release=()=>resolve(reply({error:"Temporary backend error"},503));});}});await settle();ready(h);h.send();h.send();await settle();assert.equal(writes,1);assert.equal(h.doc.querySelector("#submit-listing").disabled,true);release();await settle();assert.equal(h.form.querySelector(".form-grid-v3").inert,true);assert.match(h.doc.querySelector("#listing-status").textContent,/Retry the same changes safely/);h.send();await settle();const sent=h.calls.filter(c=>c.options.method==="PATCH");assert.equal(sent[0].options.body,sent[1].options.body);assert.equal(sent[0].options.headers["Idempotency-Key"],sent[1].options.headers["Idempotency-Key"]);assert.equal(h.form.hidden,true);
});
test("a changed staff decision requires refreshed feedback while preserving unsent edits and renewed consent",async t=>{
 let reads=0,writes=0;const h=setup(t,c=>{if(c.path.startsWith("/api/submissions?id=")){reads++;return reply({submission:{...original,review_version:reads===1?3:4,review_note:reads===1?original.review_note:"Explain how applications are approved."}});}if(c.options.method==="PATCH"&&++writes===1)return reply({error:"Submission changed. Load the latest review."},409);});await settle();ready(h);const unsent=h.form.elements.description.value;h.send();await settle();assert.equal(h.doc.querySelector("#submit-listing").disabled,true);h.doc.querySelector(".submission-correction-v3 button").click();await settle();assert.equal(h.form.elements.description.value,unsent);assert.equal(h.form.elements.agreement.checked,false);assert.match(h.doc.body.textContent,/Explain how applications are approved/);assert.match(h.doc.body.textContent,/Compare with the latest saved details/);h.form.elements.agreement.checked=true;h.send();await settle();const sent=h.calls.filter(c=>c.options.method==="PATCH");assert.equal(sent[1].body.expectedVersion,4);assert.notEqual(sent[0].options.headers["Idempotency-Key"],sent[1].options.headers["Idempotency-Key"]);
});
test("expired sessions and global sign-out clear personal form/feedback and late responses cannot restore it",async t=>{
 let release;const h=setup(t,c=>c.path.startsWith("/api/submissions?id=")?new Promise(resolve=>{release=()=>resolve(reply({submission:original}));}):undefined);await settle();h.w.dispatchEvent(new h.w.CustomEvent("browserp:session-ended"));release();await settle();assert.equal(h.form.hidden,true);assert.equal(h.form.elements.name.value,"");assert.doesNotMatch(h.doc.body.textContent,/Original community|Fixture owner|Please correct the link/);assert.equal(h.doc.querySelector("#listing-auth-gate").hidden,false);assert.equal(h.doc.querySelector('[data-auth-provider="google"]').hidden,true);assert.equal(h.doc.querySelector('[data-auth-provider="discord"]').hidden,false);const before=h.calls.length;h.send();await settle();assert.equal(h.calls.length,before);
});
test("invalid IDs never issue private reads, and sign-in retains the exact correction return path",async t=>{
 const invalid=setup(t,undefined,{query:"?submission=invalid"});await settle();assert.equal(invalid.calls.some(c=>c.path.startsWith("/api/submissions")),false);assert.equal(invalid.form.hidden,true);
 const signedout=setup(t,undefined,{session:{authenticated:false}});await settle();assert.equal(signedout.form.hidden,true);const signIn=new URL(signedout.doc.querySelector('[data-auth-provider="discord"]').href);assert.equal(signIn.searchParams.get("returnTo"),`/list-server?submission=${id}`);assert.equal(signedout.calls.some(c=>c.path.startsWith("/api/submissions")),false);
});

test("tab changes retain edits but BFCache navigation clears private snapshots and forces a fresh session check",async t=>{
 const h=setup(t);await settle();ready(h);const unsent=h.form.elements.description.value;
 h.w.document.dispatchEvent(new h.w.Event("visibilitychange"));h.w.dispatchEvent(new h.w.Event("blur"));await settle();assert.equal(h.form.elements.description.value,unsent);assert.equal(h.form.hidden,false);
 const before=h.calls.length;h.w.dispatchEvent(new h.w.PageTransitionEvent("pagehide",{persisted:true}));assert.equal(h.form.hidden,true);assert.equal(h.form.elements.description.value,"");assert.equal(h.form.elements.name.value,"");assert.equal(h.form.elements.region.options.length,0);assert.doesNotMatch(h.doc.body.textContent,/Original community|Fixture owner|Please correct the link/);assert.equal(h.doc.querySelector("#listing-auth-gate").hidden,true);assert.equal(h.calls.length,before,"Navigation teardown must not fetch provider choices");
 h.w.dispatchEvent(new h.w.PageTransitionEvent("pageshow",{persisted:true}));assert.ok(h.navigation.some(message=>/navigation/.test(message)),"Persisted restoration must reload rather than reveal the old session");assert.equal(h.form.hidden,true);h.send();await settle();assert.equal(h.calls.length,before);
});
test("a correction response arriving after navigation cannot restore old account details",async t=>{
 let release;const h=setup(t,c=>c.path.startsWith("/api/submissions?id=")?new Promise(resolve=>{release=()=>resolve(reply({submission:original}));}):undefined);await settle();h.w.dispatchEvent(new h.w.PageTransitionEvent("pagehide",{persisted:true}));release();await settle();assert.equal(h.form.hidden,true);assert.doesNotMatch(h.doc.body.textContent,/Original community|Please correct the link/);assert.equal(h.form.elements.name.value,"");
});
