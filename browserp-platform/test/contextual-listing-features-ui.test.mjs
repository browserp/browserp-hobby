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


test("new applications show the four launch games after loading the full enabled platform list",async t=>{
 const h=setup(t,c=>c.path==="/api/platforms"?reply({platforms:["rust","roblox","fivem","redm","arma3","minecraft","forza"].map(id=>({id,name:id}))}):undefined,{query:""});await settle();
 assert.deepEqual([...h.form.elements.platform.options].map(o=>o.value),["fivem","redm","roblox","minecraft"]);
 const current=()=>[...h.form.querySelectorAll('.tag-picker-v3 input')].map(i=>i.value);
 assert.ok(current().includes("custom-cars"));assert.ok(!current().includes("quests"));
 const beginner=h.form.querySelector('input[value="beginner-friendly"]');beginner.checked=true;h.form.querySelector('input[value="custom-cars"]').checked=true;
 h.form.elements.platform.value="roblox";h.form.elements.platform.dispatchEvent(new h.w.Event("change",{bubbles:true}));
 assert.ok(current().includes("mobile-friendly"));assert.ok(current().includes("events"));assert.ok(!current().includes("custom-cars"));assert.ok(!current().includes("whitelisted"));assert.ok(h.form.querySelector('input[value="beginner-friendly"]').checked);
 h.form.elements.platform.value="minecraft";h.form.elements.platform.dispatchEvent(new h.w.Event("change",{bubbles:true}));assert.ok(current().includes("quests"));assert.ok(current().includes("crossplay"));assert.ok(!current().includes("ems"));
 h.form.elements.platform.value="redm";h.form.elements.platform.dispatchEvent(new h.w.Event("change",{bubbles:true}));assert.ok(current().includes("horses"));assert.ok(!current().includes("custom-cars"));
 assert.equal(h.form.querySelectorAll('[name="accessType"]').length,1);
});
test("a thirty-keyword imported listing sends a name-only update without hidden keyword loss",async t=>{
 const contextual=["serious-roleplay","semi-serious","beginner-friendly","economy","custom-cars","custom-clothing","custom-jobs","player-businesses","housing","police"];
 const researched=["vMenu","English speaking","UK-based",...Array.from({length:17},(_,i)=>`researched-${i+1}`)];
 const listing={...original,status:"owner_draft",platform_id:"fivem",tags:[...contextual,...researched]};
 const h=setup(t,c=>c.path.includes("?listing=")?reply({submission:listing,ownerUpdate:{serverId:id,serverVersion:7,live:listing}}):undefined);await settle();
 assert.equal(h.form.querySelectorAll('.tag-picker-v3 input:checked').length,10);assert.equal(h.form.querySelector('.tag-picker-v3 input[value="ems"]').disabled,true);assert.match(h.form.querySelector('.owner-preserved-features-v3').textContent,/vMenu, English speaking/);
 assert.equal(h.form.querySelector('.tag-picker-v3 input[value="vMenu"]'),null);
 h.form.elements.name.value="Updated name";h.form.elements.agreement.checked=true;h.send();await settle();const sent=h.calls.find(c=>c.options.method==="POST");assert.deepEqual([...sent.body.tags].sort(),[...listing.tags].sort());assert.equal(sent.body.description,listing.description);
});
test("owner may exchange a contextual feature deliberately while all researched keywords remain",async t=>{
 const listing={...original,status:"owner_draft",platform_id:"fivem",tags:["custom-cars","vMenu","English speaking"]};
 const h=setup(t,c=>c.path.includes("?listing=")?reply({submission:listing,ownerUpdate:{serverId:id,serverVersion:7,live:listing}}):undefined);await settle();
 h.form.querySelector('input[value="custom-cars"]').checked=false;h.form.querySelector('input[value="ems"]').checked=true;h.form.elements.agreement.checked=true;h.send();await settle();assert.deepEqual([...h.calls.find(c=>c.options.method==="POST").body.tags].sort(),["English speaking","ems","vMenu"].sort());
});
test("new staff keywords survive rebasing an owner correction and are cleared from the document on account exit",async t=>{
 const listing={...original,platform_id:"fivem",tags:["serious-roleplay","vMenu"]};const live={...listing,tags:[...listing.tags,"ems","New reviewed keyword"]};
 const h=setup(t,c=>c.path.includes("?id=")?reply({submission:listing,ownerUpdate:{serverId:id,serverVersion:9,baselineVersion:7,live}}):undefined,{query:`?submission=${id}`});await settle();h.form.elements.agreement.checked=true;h.send();await settle();assert.deepEqual([...h.calls.find(c=>c.options.method==="PATCH").body.tags].sort(),[...live.tags].sort());
 h.w.dispatchEvent(new h.w.PageTransitionEvent("pagehide",{persisted:true}));assert.equal(h.form.querySelector('.owner-preserved-features-v3'),null);
});
test("legacy owned games remain selected while new applications remain launch-only",async t=>{
 const listing={...original,status:"owner_draft",platform_id:"rust",cfx_join_url:null,tags:["Legacy setting"]};const h=setup(t,c=>c.path.includes("?listing=")?reply({submission:listing,ownerUpdate:{serverId:id,serverVersion:7,live:listing}}):undefined);await settle();assert.equal(h.form.elements.platform.value,"rust");assert.equal(h.form.elements.platform.disabled,true);assert.equal(h.form.querySelectorAll('.tag-picker-v3 input').length,0);h.form.elements.agreement.checked=true;h.send();await settle();assert.deepEqual(h.calls.find(c=>c.options.method==="POST").body.tags,["Legacy setting"]);
});
