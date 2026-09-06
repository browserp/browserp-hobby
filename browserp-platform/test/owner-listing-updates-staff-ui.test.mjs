import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {JSDOM} from "jsdom";
const source=readFileSync(new URL("../public/staffpanel-v3.js",import.meta.url),"utf8");
const instrumented=source.replace(/\n  init\(\);\n\}\)\(\);\s*$/,"\n  window.__reviewTest={openReview};\n})();");
const settle=async()=>{for(let i=0;i<5;i++)await new Promise(resolve=>setImmediate(resolve));};
const id="bbbbbbbb-0000-4000-8000-000000000001";
function fixture(t){const dom=new JSDOM('<p id="staff-status-v3"></p>',{url:"https://browserp.test/staffpanel/moderation",runScripts:"outside-only"});const w=dom.window;t.after(()=>w.close());w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};const calls=[];let version=3;
 w.fetch=async(path,options={})=>{calls.push({path,options,body:options.body&&JSON.parse(options.body)});const read=path.startsWith("/api/admin/item");return{ok:read,status:read?200:409,json:async()=>read?{item:{id,name:"Fixture listing",reviewVersion:version++,queueVersion:7,history:[{name:"Original name",description:"Earlier description",reviewNote:"Correct the link",recordedAt:"2026-09-05T10:00:00Z"}]}}:{error:"The submission changed. Read its latest details."}};};w.eval(instrumented);return{w,doc:w.document,calls,open:()=>w.__reviewTest.openReview({id,kind:"listing"})};}
function decide(h){const form=h.doc.querySelector("dialog form");form.elements.reason.value="A clear decision reason";form.dispatchEvent(new h.w.Event("submit",{bubbles:true,cancelable:true}));}
test("owner update review shows human before/after information and applies with no new Roblox control ceremony",async t=>{
 const h=fixture(t);h.w.fetch=async(path,options={})=>{h.calls.push({path,options,body:options.body&&JSON.parse(options.body)});return{ok:options.method!=="POST",status:options.method==="POST"?400:200,json:async()=>options.method==="POST"?{error:"Fixture stopped after recording request"}:{item:{id,name:"A renamed community",platform:"roblox",description:"Updated public description",reviewVersion:2,queueVersion:1,roblox:{joiningInstructions:"Updated joining instructions"},ownerUpdate:{canApprove:true,live:{name:"Current community",description:"Existing public description",roblox:{joiningInstructions:"Existing joining instructions"}}}}}};};
 const pending=h.open();await settle();const evidence=h.doc.querySelector("dialog").textContent;assert.match(evidence,/Owner request to update/);assert.match(evidence,/Current: Current community/);assert.match(evidence,/Proposed: A renamed community/);assert.ok(!evidence.includes("ownerUpdate"));assert.ok(!evidence.includes("Private applicant information"));decide(h);await pending;const sent=h.calls.find(c=>c.options.method==="POST");assert.equal(sent.body.action,"approved");assert.equal(sent.body.controlReviewed,undefined);assert.equal(sent.body.expectedVersion,2);
});
test("changed live listing, transferred ownership and missing management permission prevent approval choices",async t=>{
 for(const extra of [{changed:true},{ownerChanged:true},{unavailable:true},{canApprove:false}]){
  const h=fixture(t);h.w.fetch=async()=>({ok:true,status:200,json:async()=>({item:{id,name:"Proposed listing",reviewVersion:2,queueVersion:1,ownerUpdate:{canApprove:true,...extra,live:{name:"Current listing"}}}})});const pending=h.open();await settle();const choices=[...h.doc.querySelectorAll('select[name="action"] option')].map(x=>x.value);assert.equal(choices.includes("approved"),false);assert.ok(choices.includes("changes_requested"));h.w.dispatchEvent(new h.w.Event("pagehide"));await pending;
 }
});

test("legacy owner review keeps unavailable approval disabled after a failed feedback save",async t=>{
 const legacy=readFileSync(new URL("../public/browserp-portal-v2.js",import.meta.url),"utf8").replace(/\n  init\(\);\n\}\)\(\);\s*$/,"\n  state.csrfToken='fixture'; window.__reviewTest={openReview,wireReviewDialog};\n})();");
 const dom=new JSDOM('<dialog id="review-dialog"><h2 id="review-dialog-title"></h2><form id="review-form"><div id="review-evidence"></div><label><textarea id="review-reason" required></textarea></label><div id="review-actions"></div><p id="review-status"></p></form></dialog>',{url:"https://browserp.test/staff",runScripts:"outside-only"});const w=dom.window;t.after(()=>w.close());w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;};
 w.fetch=async(path)=>path.startsWith("/api/admin/item")?{ok:true,json:async()=>({item:{id,name:"Updated name",platform:"roblox",reviewVersion:8,queueVersion:10,ownerUpdate:{canApprove:false,live:{name:"Current name"}}}})}:{ok:false,status:400,json:async()=>({error:"Fixture feedback error"})};
 w.eval(legacy);w.__reviewTest.wireReviewDialog();await w.__reviewTest.openReview("listing",id,"Review listing",[["approved","Approve",""],["changes_requested","Request changes",""]]);
 const approve=w.document.querySelector('[data-review-action="approved"]'),feedback=w.document.querySelector('[data-review-action="changes_requested"]');assert.equal(approve.disabled,true);assert.equal(feedback.disabled,false);assert.equal(w.document.querySelector('[data-roblox-control-review]'),null);assert.match(w.document.querySelector("#review-evidence").textContent,/Current: Current name/);
 w.document.querySelector("#review-reason").value="Please revise the public link.";w.document.querySelector("#review-form").dispatchEvent(new w.SubmitEvent("submit",{bubbles:true,cancelable:true,submitter:feedback}));await settle();assert.equal(approve.disabled,true);assert.equal(feedback.disabled,false);
});
