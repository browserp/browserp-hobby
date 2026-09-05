import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
const source=readFileSync(new URL("../public/privacy-requests.js",import.meta.url),"utf8"),tick=()=>new Promise(r=>setImmediate(r));
const item={id:"22222222-0000-4000-8000-000000000002",kind:"delete",status:"submitted",details:"Private fixture account request",staffReply:"",version:1,createdAt:"2026-09-05T10:00:00Z",updatedAt:"2026-09-05T10:00:00Z",displayName:"Fixture member",accountId:"fixture-account"};
async function harness(t,handler=async()=>({items:[item]}),{staff=false,allowed=true}={}){
 const dom=new JSDOM('<section id="root"></section>',{url:"https://browserp.test/profile",runScripts:"outside-only"}),w=dom.window;t.after(()=>w.close());w.eval(source);const calls=[],root=w.document.querySelector("#root");
 const controller=w.BrowseRPPrivacyRequests[staff?"initStaff":"initMember"]({root,allowed,accountId:"fixture-account",api:async(path,options)=>{calls.push({path,options});return handler(path,options);}});await tick();
 return{w,root,calls,controller,$:s=>root.querySelector(s),buttons:()=>[...root.querySelectorAll("button")],button:text=>[...root.querySelectorAll("button")].find(b=>b.textContent===text),submit(form){form.dispatchEvent(new w.Event("submit",{bubbles:true,cancelable:true}));},text:()=>root.textContent};
}
test("members request a review rather than immediate deletion; retries preserve key and entered details",async t=>{
 let attempts=0;const bodies=[];const h=await harness(t,async(path,options)=>{if(options?.method==="POST"){bodies.push(JSON.parse(options.body));if(++attempts===1)throw new Error("Connection interrupted. Try again.");}return{items:[item]};});
 const form=h.$("form"),kind=form.elements.kind,details=form.elements.details;kind.value="delete";details.value="Please review my account deletion request.";
 h.submit(form);await tick();assert.equal(details.value,"Please review my account deletion request.");assert.match(h.text(),/Connection interrupted/);
 h.submit(form);await tick();assert.equal(bodies.length,2);assert.equal(bodies[0].key,bodies[1].key);assert.equal(bodies[0].kind,"delete");assert.equal(details.value,"");assert.match(h.text(),/Request received/);assert.match(h.text(),/does not immediately change or delete/);
});
test("duplicate submissions stay locked while the first request is pending",async t=>{
 let finish;const h=await harness(t,async(path,options)=>options?.method==="POST"?new Promise(resolve=>{finish=()=>resolve({request:item});}):{items:[]});
 const form=h.$("form");h.submit(form);h.submit(form);await tick();assert.equal(h.calls.filter(c=>c.options?.method==="POST").length,1);assert.equal(h.button("Send request").disabled,true);
 finish();await tick();assert.equal(h.button("Send request").disabled,false);
});
test("members can answer a request for more information and withdraw only their request",async t=>{
 const writes=[];const h=await harness(t,async(path,options)=>{if(options?.method==="POST")writes.push(JSON.parse(options.body));return{items:[{...item,status:"information_needed",staffReply:"Please clarify the requested correction."}]};});
 h.button("Update request details").click();const form=h.$("article form");form.elements.details.value="Please correct the country on my account.";h.submit(form);await tick();assert.equal(writes[0].action,"update");assert.equal(writes[0].id,item.id);assert.equal(writes[0].version,1);
 h.button("Withdraw request").click();await tick();assert.equal(writes[1].action,"withdraw");assert.match(h.text(),/Your account and data stay as they are/);
});
test("staff permission gates prevent loading; authorised review never implies completed deletion",async t=>{
 const denied=await harness(t,undefined,{staff:true,allowed:false});assert.equal(denied.calls.length,0);
 const writes=[];const h=await harness(t,async(path,options)=>{if(options?.method==="POST")writes.push(JSON.parse(options.body));return{items:[{...item,status:writes.length?"ready":"submitted"}]};},{staff:true});
 const form=h.$("article form");assert.equal([...form.elements.status.options].some(o=>o.value==="completed"),false);form.elements.status.value="ready";form.elements.reply.value="Ready for a separate verified follow-up.";h.submit(form);await tick();
 assert.equal(writes[0].status,"ready");assert.match(h.text(),/No account data was exported or deleted/);assert.match(h.text(),/No data has been exported, corrected or deleted/);
});
test("private text is rendered literally and stale results cannot return after sign-out",async t=>{
 let release;const h=await harness(t,async()=>({items:[{...item,details:'<img src=x onerror="alert(1)">'}]}));assert.equal(h.$("img"),null);assert.match(h.text(),/<img src=x/);
 h.w.dispatchEvent(new h.w.Event("pagehide"));assert.equal(h.text(),"");
 const pending=await harness(t,()=>new Promise(resolve=>{release=()=>resolve({items:[item]});}));pending.w.dispatchEvent(new pending.w.CustomEvent("browserp:session-ended"));release();await tick();assert.equal(pending.text(),"");
});
test("loss of staff permission clears private request prose and review controls",async t=>{
 let denied=false;const h=await harness(t,async()=>{if(denied)throw Object.assign(new Error("Permission changed"),{status:403});return{items:[item]};},{staff:true});assert.match(h.text(),/Private fixture account request/);
 denied=true;h.button("Refresh requests").click();await tick();assert.doesNotMatch(h.text(),/Private fixture account request/);assert.equal(h.$("article form"),null);assert.match(h.text(),/Sign in again/);
});
test("staff pagination carries the cursor and filter changes reset it",async t=>{
 const h=await harness(t,async path=>({items:[item],next:path.includes("before=")?null:{createdAt:item.createdAt,id:item.id}}),{staff:true});h.button("Load more requests").click();await tick();assert.match(h.calls[1].path,/beforeId=22222222/);
 const filter=h.$('select[name="kind"]');filter.value="copy";filter.dispatchEvent(new h.w.Event("change"));await tick();assert.match(h.calls.at(-1).path,/kind=copy/);assert.doesNotMatch(h.calls.at(-1).path,/before=/);
});
