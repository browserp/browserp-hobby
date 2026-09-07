import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
const script=readFileSync(new URL('../public/staff-discord-role-sync.js',import.meta.url),'utf8');
const control={guildId:'111111111111111111',botUserId:'222222222222222222',protectedRoleIds:['777777777777777777'],mappings:{moderator:'666666666666666666'},version:4,enabled:false,revokeOnly:false,schedulerEnabled:false,trackedMembers:0,dueMembers:0,recentEvents:[]};
const tick=()=>new Promise(resolve=>setTimeout(resolve,0));
function setup(api){const dom=new JSDOM('<section id="sync"></section>',{url:'https://www.browserp.com/staffpanel/moderation#staff',runScripts:'outside-only'});dom.window.eval(script);const root=dom.window.document.querySelector('#sync');return{dom,root,init:isOwner=>dom.window.BrowseRPStaffDiscordSync.init({root,api,isOwner})};}
const loaded=()=>({control:structuredClone(control),runtime:{environmentAllowed:true,applicationEnabled:false,botTokenConfigured:true}});
test('only the confirmed owner mounts controls or requests private configuration',async()=>{
 let calls=0;const f=setup(async()=>{calls++;return loaded();});try{await f.init(false);await f.init('true');assert.equal(calls,0);assert.equal(f.root.children.length,0);await f.init(true);assert.equal(calls,1);assert.equal(f.root.querySelectorAll('input[name="owner"]').length,0);assert.equal(f.root.querySelectorAll('input[type="password"]').length,0);assert.equal(f.root.querySelector('[name="guildId"]').readOnly,true);assert.match(f.root.textContent,/Pausing does not remove existing Discord roles/);}finally{f.dom.window.close();}
});
test('preflight keeps precise strings and versions, blocks repeat clicks, and renders provider text safely',async()=>{
 const calls=[];let complete;const f=setup(async(path,options)=>{calls.push({path,body:options?.body&&JSON.parse(options.body)});if(!options)return loaded();return new Promise(resolve=>complete=resolve);});
 try{await f.init(true);const check=[...f.root.querySelectorAll('button')].find(b=>b.textContent==='Check bot and roles');check.click();check.click();assert.equal(calls.length,2);assert.equal(calls[1].body.action,'check');assert.equal(calls[1].body.expectedVersion,4);assert.equal(typeof calls[1].body.mappings.moderator,'string');assert.equal(calls[1].body.mappings.moderator,control.mappings.moderator);assert.equal(f.root.querySelector('form').getAttribute('aria-busy'),'true');
 complete({readiness:{ready:true,message:'Checked',roles:[{siteRole:'moderator',roleId:control.mappings.moderator,name:'<img src=x onerror=alert(1)>'}]}});await tick();assert.equal(f.root.querySelector('img'),null);assert.match(f.root.textContent,/<img src=x/);assert.equal(check.disabled,false);
 }finally{f.dom.window.close();}
});
test('removal-only save retains cleanup intent and reloads authoritative state',async()=>{
 const calls=[];const f=setup(async(path,options)=>{calls.push(options?.body&&JSON.parse(options.body));return options?{result:{version:5}}:loaded();});
 try{await f.init(true);f.root.querySelector('[name="mode"]').value='revoke';f.root.querySelector('[name="reason"]').value='Remove all managed role grants';f.root.querySelector('form').dispatchEvent(new f.dom.window.Event('submit',{bubbles:true,cancelable:true}));await tick();assert.equal(calls[1].enabled,true);assert.equal(calls[1].revokeOnly,true);assert.equal(calls[1].expectedVersion,4);assert.equal(calls.length,3);assert.match(f.root.textContent,/Settings saved/);}finally{f.dom.window.close();}
});
test('denied or failed configuration exposes no form and can be retried; detached requests cannot remount private data',async()=>{
 const denied=setup(async()=>{throw Object.assign(new Error('Owner permission required'),{status:403});});try{await denied.init(true);assert.equal(denied.root.querySelector('form'),null);assert.match(denied.root.textContent,/Owner permission/);assert.match(denied.root.textContent,/Try again/);}finally{denied.dom.window.close();}
 let complete;const detached=setup(()=>new Promise(resolve=>complete=resolve));try{const task=detached.init(true);detached.root.remove();complete(loaded());await task;assert.equal(detached.root.querySelector('form'),null);}finally{detached.dom.window.close();}
});
