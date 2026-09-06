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

test("completion is a separate ready-only permitted action, attests a concrete result and preserves safe retry",async t=>{
 for(const [status,canFulfill]of[["submitted",true],["ready",false],["fulfilled",true]]){
  const denied=await harness(t,async()=>({items:[{...item,status}],canFulfill}),{staff:true});assert.equal(denied.$(".privacy-request-completion"),null);
 }
 let attempts=0;const bodies=[];const h=await harness(t,async(path,options)=>{
  if(options?.method==="POST"){bodies.push(JSON.parse(options.body));if(++attempts===1)throw new Error("Interrupted. Try again.");}
  return{items:[{...item,kind:"copy",status:attempts>1?"fulfilled":"ready",staffReply:attempts>1?"Your requested data was delivered through the verified account channel.":""}],canFulfill:true};
 },{staff:true});
 const form=h.$(".privacy-request-completion form");assert.ok(form);assert.match(form.textContent,/does not export, change or erase/);
 form.elements.result.value="Your requested data was delivered through the verified account channel.";form.elements.evidence.value="Private verified delivery record COPY-789.";form.elements.completedAt.value="2026-01-01T12:00";
 h.submit(form);await tick();assert.equal(bodies.length,0);
 form.elements.confirmed.checked=true;h.submit(form);await tick();assert.match(h.text(),/Interrupted/);assert.equal(form.elements.evidence.value,"Private verified delivery record COPY-789.");
 h.submit(form);await tick();assert.equal(bodies.length,2);assert.deepEqual(bodies[0],bodies[1]);assert.equal(bodies[0].method,"secure_delivery");assert.equal(bodies[0].action,"fulfill");assert.equal(bodies[0].version,1);assert.equal(bodies[0].confirmed,true);
 assert.match(h.text(),/Completed follow-up recorded/);assert.equal(h.$(".privacy-request-completion"),null);assert.equal(h.$("article form"),null);
});
test("fulfilled members see the actual result and can start another request without editing the closed one",async t=>{
 const h=await harness(t,async()=>({items:[{...item,status:"fulfilled",staffReply:"Your display name correction was completed as requested."}]}));
 assert.match(h.text(),/Follow-up completed/);assert.match(h.text(),/display name correction was completed/);assert.equal(h.button("Withdraw request"),undefined);assert.equal(h.button("Update request details"),undefined);assert.ok(h.button("Send request"));
});
test("history loads on demand, preserves escaped messages and paginates without exposing staff-only notes to members",async t=>{
 const h=await harness(t,async path=>path.includes("?id=")?{items:[{version:path.includes("beforeVersion=")?1:2,event:path.includes("beforeVersion=")?"legacy_snapshot":"staff_review",status:"reviewing",reply:'First reply <img src=x onerror="alert(1)">',details:path.includes("beforeVersion=")?"Original saved request":null,recordedAt:item.createdAt}],next:path.includes("beforeVersion=")?null:2,completion:{evidence:"Private staff record",completedAt:item.createdAt,recordedAt:item.createdAt}}:{items:[item]});
 assert.equal(h.calls.some(c=>c.path.includes("?id=")),false);const history=h.$(".privacy-request-history");history.open=true;history.dispatchEvent(new h.w.Event("toggle"));await tick();
 assert.match(h.text(),/First reply <img/);assert.equal(h.$("img"),null);assert.doesNotMatch(h.text(),/Private staff record/);assert.equal(h.calls.find(c=>c.path.includes("?id=")).options.headers["X-BrowseRP-Account"],"fixture-account");
 h.button("Show earlier messages").click();await tick();assert.match(h.calls.at(-1).path,/beforeVersion=2/);assert.match(h.text(),/Earlier overwritten messages are not available/);assert.equal(h.$(".privacy-request-history-events").children.length,2);
});
test("a late private history response cannot restore content after account end",async t=>{
 let release;const h=await harness(t,async path=>path.includes("?id=")?new Promise(resolve=>{release=()=>resolve({items:[{event:"staff_review",reply:"Private delayed reply"}]});}):{items:[item]});
 const history=h.$(".privacy-request-history");history.open=true;history.dispatchEvent(new h.w.Event("toggle"));await tick();h.w.dispatchEvent(new h.w.Event("browserp:session-ended"));release();await tick();assert.equal(h.text(),"");
});

const copyItem={...item,kind:'copy',status:'ready',export:{approved:true,scopeComplete:false,supplementNote:'Original uploads still need a separate copy.',copy:null}};
async function downloadHarness(t,handler){
 const {webcrypto}=await import('node:crypto');const h=await harness(t,handler);h.w.TextEncoder=TextEncoder;h.w.Blob=Blob;Object.defineProperty(h.w.crypto,'subtle',{value:webcrypto.subtle});const files=[],revoked=[];
 h.w.URL.createObjectURL=blob=>{files.push(blob);return `blob:https://browserp.test/private-${files.length}`;};h.w.URL.revokeObjectURL=value=>revoked.push(value);
 h.root.addEventListener('click',event=>{if(event.target.tagName==='A')event.preventDefault();});t.after(()=>h.controller.destroy());return{...h,files,revoked};
}
async function drain(){for(let i=0;i<10;i++)await new Promise(r=>setTimeout(r,5));}
test('private copy is checked, downloaded and confirmed separately without closing the wider request',async t=>{
 const {createHash}=await import('node:crypto'),content='{"profile":{"name":"Only this member"}}',sha256=createHash('sha256').update(content).digest('hex'),copy={id:'private-copy',sha256,byteSize:Buffer.byteLength(content),available:true,pending:[]};const writes=[];
 const h=await downloadHarness(t,async(path,options)=>{if(options?.method!=='POST')return{items:[copyItem]};const body=JSON.parse(options.body);writes.push(body);if(body.action==='generate_export')return{copy};if(body.action==='read_export')return{copy,content};if(body.action==='check_export')return{allowed:true,sha256};return{copy:{...copy,receivedAt:item.createdAt},request:copyItem};});
 assert.equal(h.button('Confirm I received this copy'),undefined);h.button('Prepare and download my copy').click();await drain();assert.equal(h.files.length,1);assert.equal(await h.files[0].text(),content);assert.deepEqual(writes.map(x=>x.action),['generate_export','read_export','check_export']);assert.ok(h.calls.every(x=>x.options.headers['X-BrowseRP-Account']==='fixture-account'));
 const confirm=h.button('Confirm I received this copy');assert.equal(confirm.disabled,true);const checkbox=h.$('.privacy-request-copy input[type="checkbox"]');checkbox.checked=true;checkbox.dispatchEvent(new h.w.Event('change'));confirm.click();await drain();assert.equal(writes.at(-1).action,'receive_export');assert.match(h.text(),/request stays open/);assert.match(h.text(),/Original uploads/);
 h.w.dispatchEvent(new h.w.Event('pagehide'));assert.equal(h.text(),'');assert.equal(h.revoked.length,1);
});
test('a corrupt file or account change during final check never creates a download',async t=>{
 const {createHash}=await import('node:crypto'),content='{"name":"Private content"}',sha256=createHash('sha256').update(content).digest('hex'),copy={id:'private-copy',sha256,byteSize:Buffer.byteLength(content)};
 for(const failure of['hash','account']){const h=await downloadHarness(t,async(path,options)=>{if(options?.method!=='POST')return{items:[copyItem]};const {action}=JSON.parse(options.body);if(action==='generate_export')return{copy};if(action==='read_export')return{copy,content:failure==='hash'?content+'x':content};throw Object.assign(new Error('Account changed'),{status:401});});
 h.button('Prepare and download my copy').click();await drain();assert.equal(h.files.length,0);assert.match(h.text(),failure==='hash'?/integrity check/:/Sign in again/);if(failure==='account')assert.doesNotMatch(h.text(),/Private fixture account request/);}
});
test('a late private copy cannot reappear after sign-out and interrupted preparation keeps its retry key',async t=>{
 let resolve;const bodies=[];const h=await downloadHarness(t,async(path,options)=>{if(options?.method!=='POST')return{items:[copyItem]};bodies.push(JSON.parse(options.body));if(bodies.length===1)throw new Error('Try again');return new Promise(r=>{resolve=r;});});
 h.button('Prepare and download my copy').click();await drain();h.button('Prepare and download my copy').click();await drain();assert.equal(bodies[0].key,bodies[1].key);h.w.dispatchEvent(new h.w.CustomEvent('browserp:session-ended'));resolve({copy:{id:'late'}});await drain();assert.equal(h.files.length,0);assert.equal(h.text(),'');
});
test('staff explicitly approve scope with a stable retry and cannot download the member file',async t=>{
 const writes=[];const h=await harness(t,async(path,options)=>{if(options?.method==='POST'){writes.push(JSON.parse(options.body));throw new Error('Retry safely');}return{items:[{...copyItem,export:null}],canFulfill:true};},{staff:true});
 assert.equal(h.button('Prepare and download my copy'),undefined);const form=h.$('.privacy-request-copy form');form.elements.supplementNote.value='Uploaded files will be provided separately.';h.submit(form);await tick();assert.equal(writes.length,0);form.elements.confirmed.checked=true;h.submit(form);await tick();h.submit(form);await tick();assert.deepEqual(writes[0],writes[1]);assert.equal(writes[0].scopeComplete,false);assert.equal(writes[0].action,'approve_export');assert.equal(writes[0].version,item.version);
});
