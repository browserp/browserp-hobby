import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
const source=readFileSync(new URL('../public/advertising-enquiries.js',import.meta.url),'utf8');
const tick=()=>new Promise(r=>setImmediate(r));
const item={id:'00000000-0000-4000-8000-000000000001',subject:'Our FiveM community',destinationUrl:'https://community.example.com/join',placement:'directory',message:'We would like to discuss a recruitment campaign.',status:'submitted',reply:'',version:1,createdAt:'2026-09-06T00:00:00Z',updatedAt:'2026-09-06T00:00:00Z'};
async function fixture(t,{staff=false,signedIn=true,handler=async()=>({items:[item],next:null}),canReview=true,accessPromise}={}){
 const dom=new JSDOM('<section id="enquiries"></section>',{url:`https://browserp.test/${staff?'staffpanel/overview':'advertise'}`,runScripts:'outside-only'}),w=dom.window,root=w.document.querySelector('section'),calls=[];w.eval(source);
 const controller=w.BrowseRPAdvertisingEnquiries[staff?'initStaff':'initMember']({root,accountId:staff?'owner-account':undefined,session:signedIn?{authenticated:true,user:{id:'member-account'}}:{authenticated:false},api:async(path,options)=>{calls.push({path,options});if(path==='/api/auth/providers')return{providers:{discord:true,google:true}};if(path.endsWith('?access=1'))return accessPromise||{canReview};return handler(path,options);}});
 t.after(()=>{controller.destroy();w.close();});await tick();await tick();
 return{w,root,calls,controller,$:s=>root.querySelector(s),button:name=>[...root.querySelectorAll('button')].find(x=>x.textContent===name),text:()=>root.textContent,submit:form=>form.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true})),input:(node,value)=>{node.value=value;node.dispatchEvent(new w.Event('input',{bubbles:true}));}};
}
function fill(h){const f=h.$('.enquiry-form');h.input(f.elements.subject,'Launch recruitment');h.input(f.elements.destinationUrl,'https://community.example.com');h.input(f.elements.message,'Please discuss our community recruitment campaign.');return f;}
test('signed-out visitors only see enabled real sign-in choices, with a return to advertising and no private query',async t=>{
 const h=await fixture(t,{signedIn:false});assert.equal(h.calls.length,1);assert.equal(h.calls[0].path,'/api/auth/providers');assert.equal(h.$('form'),null);assert.deepEqual([...h.root.querySelectorAll('a')].map(x=>x.getAttribute('href')),['/api/auth/discord?returnTo=%2Fadvertise','/api/auth/google?returnTo=%2Fadvertise']);assert.equal(h.root.querySelectorAll('svg use').length,2);
});
test('member sends only their own enquiry and gets a durable reply/status card without any booking claim',async t=>{
 let body;const h=await fixture(t,{handler:async(path,options)=>{if(options?.method==='POST'){body=JSON.parse(options.body);return{enquiry:{...item,...body}};}return{items:[],next:null};}});const f=fill(h);h.submit(f);await tick();assert.equal(body.action,'create');assert.equal(body.placement,'any');assert.match(body.key,/^[0-9a-f-]{36}$/);assert.equal(h.calls.at(-1).options.headers['X-BrowseRP-Account'],'member-account');assert.equal(f.elements.subject.value,'');assert.equal(h.$('details').open,true);assert.match(h.text(),/no booking or payment has been made/);assert.ok(h.button('Withdraw enquiry'));
});
test('definite validation errors keep an editable draft; public URL checks reject unsafe schemes before sending',async t=>{
 const h=await fixture(t,{handler:async(path,options)=>{if(options?.method==='POST')throw Object.assign(new Error('Please check the destination.'),{status:400});return{items:[]};}});const f=fill(h);h.input(f.elements.destinationUrl,'javascript:alert(1)');h.submit(f);await tick();assert.equal(h.calls.filter(c=>c.options?.method==='POST').length,0);h.input(f.elements.destinationUrl,'https://community.example.com');h.submit(f);await tick();assert.equal(f.elements.subject.value,'Launch recruitment');assert.equal(f.elements.subject.disabled,false);assert.match(h.text(),/Please check the destination/);
});
test('uncertain saves lock edits and other actions, retry the exact body/key and prevent duplicate submits',async t=>{
 const bodies=[];let resolve;const h=await fixture(t,{handler:async(path,options)=>{if(options?.method!=='POST')return{items:[item]};bodies.push(JSON.parse(options.body));if(bodies.length===1)throw new Error('Connection lost');return new Promise(r=>resolve=r);}});const f=fill(h);h.submit(f);await tick();assert.equal(f.elements.subject.disabled,true);assert.equal(h.button('Refresh enquiries').disabled,true);assert.equal(h.button('Withdraw enquiry').disabled,true);assert.equal(h.button('Retry save').disabled,false);
 f.elements.message.value='A changed value cannot replace the uncertain body.';h.button('Retry save').click();h.button('Retry save').click();await tick();assert.equal(bodies.length,2);assert.deepEqual(bodies[0],bodies[1]);resolve({enquiry:{...item,id:'saved-second'}});await tick();assert.equal(h.button('Refresh enquiries').disabled,false);assert.equal(f.elements.subject.disabled,false);
});
test('staff access is checked separately before any queue data, and enquiry fields remain private',async t=>{
 const denied=await fixture(t,{staff:true,canReview:false});assert.equal(denied.calls.length,1);assert.match(denied.text(),/does not have permission/);assert.equal(denied.$('form'),null);
 const allowed=await fixture(t,{staff:true});assert.match(allowed.calls[0].path,/access=1/);assert.match(allowed.calls[1].path,/status=open/);assert.equal(allowed.calls[1].options.headers['X-BrowseRP-Account'],'owner-account');assert.equal(allowed.button('Send enquiry'),undefined);
});
test('staff can record review, publish one visible reply or close while preserving an existing reply',async t=>{
 const bodies=[];const h=await fixture(t,{staff:true,handler:async(path,options)=>{if(options?.method==='POST'){const body=JSON.parse(options.body);bodies.push(body);return{enquiry:{...item,status:body.status,reply:body.reply,version:item.version+1}};}return{items:[item]};}});
 let form=h.$('.enquiry-form');assert.equal(form.elements.status.value,'reviewing');assert.equal(form.elements.reply.required,false);h.submit(form);await tick();assert.equal(bodies[0].reply,'');assert.match(h.text(),/No reply has been published/);
 form=h.$('.enquiry-form');assert.equal(form.elements.status.value,'replied');h.input(form.elements.reply,'Thanks for the enquiry. Please check back for our launch availability.');h.submit(form);await tick();assert.equal(bodies[1].status,'replied');assert.equal(bodies[1].version,2);assert.match(h.text(),/BrowseRP reply/);
 form=h.$('.enquiry-form');assert.deepEqual([...form.elements.status.options].map(x=>x.value),['closed']);assert.equal(form.elements.reply.value,'');assert.equal(form.elements.reply.required,false);h.submit(form);await tick();assert.equal(bodies[2].reply,'');assert.equal(bodies[2].status,'closed');
});
test('a conflicting staff review keeps the draft through refresh with the new version',async t=>{
 let current={...item,status:'reviewing'},body;const h=await fixture(t,{staff:true,handler:async(path,options)=>{if(options?.method==='POST'){body=JSON.parse(options.body);throw Object.assign(new Error('Changed'),{status:409});}return{items:[current]};}});
 const form=h.$('.enquiry-form');h.input(form.elements.reply,'This unsent draft must survive the version conflict.');h.submit(form);await tick();assert.match(h.text(),/draft is kept/);current={...current,version:5};h.button('Refresh enquiries').click();await tick();assert.equal(h.$('.enquiry-form').elements.reply.value,'This unsent draft must survive the version conflict.');h.submit(h.$('.enquiry-form'));await tick();assert.equal(body.version,5);
});
test('members explicitly confirm withdrawal; closed and withdrawn rows have no mutation controls',async t=>{
 const writes=[];const h=await fixture(t,{handler:async(path,options)=>{if(options?.method==='POST'){writes.push(JSON.parse(options.body));return{enquiry:{...item,status:'withdrawn',reply:'Existing reply stays readable.'}};}return{items:[item]};}});const form=h.$('.enquiry-withdraw');h.submit(form);await tick();assert.equal(writes.length,0);form.elements.confirm.checked=true;h.submit(form);await tick();assert.equal(writes[0].action,'withdraw');assert.equal(writes[0].version,1);assert.equal(h.button('Withdraw enquiry'),undefined);assert.match(h.text(),/Existing reply stays readable/);
});
test('private prose is escaped and late results cannot reappear after session end or navigation',async t=>{
 let resolve;const h=await fixture(t,{handler:async()=>({items:[{...item,subject:'<img src=x onerror=bad()>',reply:'<script>bad()</script>'}]})});assert.equal(h.$('img'),null);assert.equal(h.$('script'),null);assert.match(h.text(),/<script>/);h.w.dispatchEvent(new h.w.CustomEvent('browserp:session-ended'));await tick();assert.doesNotMatch(h.text(),/Our FiveM|<script>/);assert.equal(h.$('form'),null);
 const pending=await fixture(t,{handler:async()=>new Promise(r=>resolve=r)});pending.w.dispatchEvent(new pending.w.Event('pagehide'));resolve({items:[item]});await tick();assert.equal(pending.text(),'');
});
test('pagination carries a cursor and deduplicates rows while refresh keeps the unsent member draft',async t=>{
 const h=await fixture(t,{handler:async path=>({items:[item,...(path.includes('before=')?[{...item,id:'second'}]:[])],next:path.includes('before=')?null:{createdAt:item.createdAt,id:item.id}})});const form=fill(h);h.button('Load more enquiries').click();await tick();assert.match(h.calls.at(-1).path,/beforeId=/);assert.equal(h.root.querySelectorAll('.enquiry-card').length,2);h.button('Refresh enquiries').click();await tick();assert.equal(form.elements.subject.value,'Launch recruitment');
});
test('member script loads before its session hook; enquiry queue survives campaign-root replacement',()=>{
 const read=p=>readFileSync(new URL(`../public/${p}`,import.meta.url),'utf8');const publicPage=read('advertise.html'),staffPage=read('staffpanel-overview.html');assert.ok(publicPage.indexOf('/advertising-enquiries.js')<publicPage.indexOf('/browserp-v3.js'));assert.ok(staffPage.indexOf('/advertising-enquiries.js')<staffPage.indexOf('/staffpanel-v3.js'));
 const dom=new JSDOM(staffPage);try{const outer=dom.window.document.querySelector('#overview-adverts'),campaigns=outer.querySelector('[data-advert-campaigns]'),queue=outer.querySelector('#advertising-enquiries');campaigns.replaceChildren();assert.equal(queue.isConnected,true);}finally{dom.window.close();}
 assert.match(read('staff-adverts.js'),/\[data-advert-campaigns\]/);assert.match(read('staffpanel-v3.js'),/advertisingEnquiries\?\.destroy/);
});

test('staff controls cannot fetch private queue data while access is still being checked',async t=>{
 let allow;const h=await fixture(t,{staff:true,accessPromise:new Promise(r=>allow=r)});assert.equal(h.button('Refresh enquiries').disabled,true);h.button('Refresh enquiries').dispatchEvent(new h.w.Event('click'));await tick();assert.equal(h.calls.length,1);allow({canReview:true});await tick();assert.equal(h.calls.length,2);assert.equal(h.button('Refresh enquiries').disabled,false);
});
test('refreshing a newly closed enquiry retains an unsent staff reply without offering another decision',async t=>{
 let current={...item,status:'reviewing'};const h=await fixture(t,{staff:true,handler:async()=>({items:[current]})});h.input(h.$('.enquiry-form').elements.reply,'This unsent reply must remain available to its author.');current={...current,status:'closed',reply:'Another reviewer has closed this enquiry with an explanation.',version:2};h.button('Refresh enquiries').click();await tick();assert.match(h.text(),/Your unsent draft/);assert.match(h.text(),/This unsent reply must remain available/);assert.equal(h.$('.enquiry-form'),null);
});

test('destination validation rejects the same non-public hosts and explicit ports as the API before saving',async t=>{
 const h=await fixture(t,{handler:async(path,options)=>options?.method==='POST'?{enquiry:{...item,id:'accepted'}}:{items:[]}});const f=fill(h);
 for(const value of ['https://localhost','https://127.0.0.1','https://2130706433','https://[::1]','https://community.example','https://community.local','https://community.internal','https://community.test','https://community.invalid','https://community.onion','https://community.example.com:443','https://community.example.com:8443','https://user:pass@community.example.com','https://community.example.com\\bad']){
  h.input(f.elements.destinationUrl,value);h.submit(f);await tick();assert.equal(h.calls.filter(c=>c.options?.method==='POST').length,0,value);
 }
 h.input(f.elements.destinationUrl,'https://community.example.com/join?from=browserp');h.submit(f);await tick();assert.equal(h.calls.filter(c=>c.options?.method==='POST').length,1);
});
