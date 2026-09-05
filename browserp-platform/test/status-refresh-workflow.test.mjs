import assert from 'node:assert/strict';
import test from 'node:test';
import {scheduledStatusRefresh} from '../lib/status-refresh-workflow.js';
import router from '../api/router.js';

const token='a'.repeat(64),runId='00000000-0000-4000-8000-000000000001';
const request=(overrides={})=>({method:'POST',url:'/api/internal/server-status',headers:{authorization:`Bearer ${token}`,'content-type':'application/json'},body:{},...overrides});
const serverId=index=>`00000000-0000-4000-8000-${String(index+10).padStart(12,'0')}`;
const source=(index,platform='fivem')=>({serverId:serverId(index),joinCode:platform==='minecraft'?index.toString(16).padStart(12,'0'):`cfx${String(index).padStart(3,'0')}`,platform});
function rpcFixture({cfx=[],minecraft=[],claim=runId}={}){
 const calls=[];let sharedSignal;
 const callRpc=async(name,data,access,options)=>{
  calls.push({name,data,access,options});assert.equal(access,undefined);assert.equal(options.useSecret,true);assert.ok(options.signal instanceof AbortSignal);
  if(name==='service_claim_status_refresh'){sharedSignal=options.signal;assert.deepEqual(data,{p_token:token});return claim;}
  if(name!=='service_finish_status_refresh')assert.equal(options.signal,sharedSignal);
  if(name==='service_cfx_sources'){assert.deepEqual(data,{p_platform:null,p_server_id:null,p_due_only:true,p_limit:100});return cfx;}
  if(name==='service_minecraft_sources'){assert.deepEqual(data,{p_server_id:null,p_due_only:true,p_limit:100});return minecraft;}
  if(name==='service_finish_status_refresh'){assert.equal(data.p_run_id,runId);assert.notEqual(options.signal,sharedSignal);assert.equal(options.signal.aborted,false);return true;}
  assert.fail(`Unexpected privileged call: ${name}`);
 };
 return{callRpc,calls,cleanupMedia:async()=>0};
}
const sum=summary=>['checked','unchanged','unavailable','skipped','failed','deferred'].reduce((total,key)=>total+summary[key],0);

test('scheduler requires a correctly formed bearer credential and refuses query/cookie alternatives before database access',async()=>{
 for(const authorization of [undefined,'',`Basic ${token}`,`Bearer ${'a'.repeat(63)}`,`Bearer ${'g'.repeat(64)}`,`Bearer ${token} extra`,[`Bearer ${token}`]]){
  let calls=0;
  await assert.rejects(()=>scheduledStatusRefresh(request({url:`/api/internal/server-status?token=${token}`,headers:{authorization,cookie:`token=${token}`,'content-type':'application/json'}}),{callRpc:async()=>{calls++;}}),{status:401});
  assert.equal(calls,0);
 }
 let queries=0;
 await assert.rejects(()=>scheduledStatusRefresh(request(),{callRpc:async(name)=>{queries++;assert.equal(name,'service_claim_status_refresh');throw Object.assign(new Error('Scheduler authorization required'),{status:403});}}),{status:403});
 assert.equal(queries,1,'A well-formed but invalid secret cannot read registered sources');
});

test('scheduler rejects source inputs and oversized or non-object request bodies before obtaining a run lease',async()=>{
 for(const[body,status]of [[{url:'http://127.0.0.1/internal'},400],[{joinCode:'attacker',sources:[]},400],[[],400],['null',400],[{padding:'x'.repeat(129)},413]]){
  let calls=0;await assert.rejects(()=>scheduledStatusRefresh(request({body}),{callRpc:async()=>{calls++;}}),{status});assert.equal(calls,0);
 }
 await assert.rejects(()=>scheduledStatusRefresh(request({headers:{authorization:`Bearer ${token}`,'content-type':'text/plain'}})),{status:415});
});

test('scheduler busy lease skips source queries and source refreshes',async()=>{
 const rpc=rpcFixture({claim:null});let refreshed=false;
 const result=await scheduledStatusRefresh(request(),{...rpc,refreshCfx:async()=>{refreshed=true;},refreshMinecraft:async()=>{refreshed=true;}});
 assert.deepEqual(result,{accepted:false,reason:'already_running_or_recent'});assert.equal(refreshed,false);
 assert.deepEqual(rpc.calls.map(call=>call.name),['service_claim_status_refresh']);
});

test('scheduler visits all 55 registered due servers with at most six concurrent refreshes and no caller-selected source parameters',async()=>{
 const cfx=Array.from({length:52},(_,i)=>({...source(i,i<32?'fivem':'redm'),url:'https://ignored-database-decoration.example'}));
 const minecraft=Array.from({length:3},(_,i)=>({...source(60+i,'minecraft'),address:'do-not-forward.example:25565'}));
 const rpc=rpcFixture({cfx,minecraft}),seen=[];let active=0,peak=0;
 const refresh=async(code,options)=>{active++;peak=Math.max(peak,active);seen.push({code,options});await new Promise(resolve=>setImmediate(resolve));active--;return{online:true,players:0,capacity:100};};
 const result=await scheduledStatusRefresh(request({url:'/api/internal/server-status?url=http://127.0.0.1/&joinCode=attacker&serverId=attacker'}),{...rpc,refreshCfx:refresh,refreshMinecraft:refresh,now:()=>100});
 assert.equal(result.accepted,true);assert.equal(result.summary.requested,55);assert.equal(result.summary.checked,55);assert.equal(result.summary.failed,0);assert.equal(sum(result.summary),55);assert.equal(peak,6);
 assert.equal(new Set(seen.map(item=>item.code)).size,55);
 for(const item of seen){const registered=[...cfx,...minecraft].find(s=>s.joinCode===item.code);assert.ok(registered);assert.equal(item.options.signal,rpc.calls[0].options.signal);assert.deepEqual(item.options,registered.platform==='minecraft'?{serverId:registered.serverId,signal:item.options.signal}:{platform:registered.platform,signal:item.options.signal});}
 assert.deepEqual(seen.slice(0,3).map(item=>item.code),minecraft.map(item=>item.joinCode),'The smaller Minecraft group cannot be starved by the Cfx queue');
 assert.equal(JSON.stringify(result).includes(token),false);assert.equal(JSON.stringify(seen).includes('attacker'),false);
 const finished=rpc.calls.filter(call=>call.name==='service_finish_status_refresh');assert.equal(finished.length,1);assert.deepEqual(finished[0].data.p_summary,result.summary);
});

test('scheduler isolates source failures and distinguishes zero, unchanged, unavailable and skipped observations',async()=>{
 const rpc=rpcFixture({cfx:Array.from({length:7},(_,i)=>source(i))});let seen=0;
 const result=await scheduledStatusRefresh(request(),{...rpc,now:()=>100,refreshCfx:async code=>{
  seen++;switch(code){case'cfx000':return{online:true,players:0,capacity:100};case'cfx001':return{unchanged:true};case'cfx002':return{unavailable:true,players:null};case'cfx003':return null;case'cfx004':return{skipped:true};case'cfx005':throw new Error('Isolated upstream failure');default:return{online:true,players:9,capacity:100};}
 }});
 assert.equal(seen,7);assert.deepEqual(result.summary,{requested:7,checked:2,unchanged:1,unavailable:1,skipped:2,failed:1,deferred:0,durationMs:0});
 assert.equal(sum(result.summary),7);assert.equal(JSON.stringify(result).includes('upstream'),false);
});

test('scheduler stops claiming new source work at its deadline and records deferred work for a later run',async()=>{
 const rpc=rpcFixture({cfx:Array.from({length:55},(_,i)=>source(i))});let clock=0,started=0;
 const result=await scheduledStatusRefresh(request(),{...rpc,now:()=>clock,budgetMs:40000,refreshCfx:async()=>{started++;await new Promise(resolve=>setImmediate(resolve));clock=40001;return{players:4,capacity:10};}});
 assert.equal(started,6);assert.equal(result.summary.checked,6);assert.equal(result.summary.deferred,49);assert.equal(sum(result.summary),55);assert.equal(result.summary.durationMs,40001);
 const noTime=rpcFixture({cfx:[source(1)]});let called=false;
 const skipped=await scheduledStatusRefresh(request(),{...noTime,now:()=>100,budgetMs:0,refreshCfx:async()=>{called=true;}});
 assert.equal(called,false);assert.equal(skipped.summary.deferred,1);
});

test('scheduler aborts in-flight work and records completion with an independent signal',async()=>{
 const controller=new AbortController(),reason=new DOMException('Scheduler deadline','TimeoutError');
 const rpc=rpcFixture({cfx:Array.from({length:55},(_,i)=>source(i))});let active=0,stopped=0;
 const pending=scheduledStatusRefresh(request(),{...rpc,signal:controller.signal,now:()=>100,refreshCfx:async(_code,{signal})=>new Promise((_resolve,reject)=>{
  assert.equal(signal,controller.signal);active++;signal.addEventListener('abort',()=>{stopped++;reject(signal.reason);},{once:true});
  if(active===6)queueMicrotask(()=>controller.abort(reason));
 })});
 const result=await pending;assert.equal(active,6);assert.equal(stopped,6);assert.equal(result.summary.failed,6);assert.equal(result.summary.deferred,49);assert.equal(result.summary.unavailable,0);
 const finish=rpc.calls.find(call=>call.name==='service_finish_status_refresh');assert.ok(finish);assert.notEqual(finish.options.signal,controller.signal);assert.equal(finish.options.signal.aborted,false);
});

test('scheduler rejects malformed registered identities and unexpected platforms without passing them to a fetcher',async()=>{
 const rpc=rpcFixture({cfx:[{...source(0),serverId:'not-a-server'},{...source(1),platform:'arbitrary'},source(2)]});let calls=0;
 const result=await scheduledStatusRefresh(request(),{...rpc,now:()=>0,refreshCfx:async code=>{calls++;assert.equal(code,'cfx002');return{players:4,capacity:10};}});
 assert.equal(calls,1);assert.equal(result.summary.failed,2);assert.equal(result.summary.checked,1);
});

test('scheduler records a bounded failed summary when the source registry cannot be read',async()=>{
 const rpc=rpcFixture();let refreshed=false;
 await assert.rejects(()=>scheduledStatusRefresh(request(),{callRpc:async(...args)=>args[0]==='service_cfx_sources'?Promise.reject(new Error('Private database outage detail')):rpc.callRpc(...args),now:()=>100,refreshCfx:async()=>{refreshed=true;},refreshMinecraft:async()=>{refreshed=true;}}),error=>error.status===503&&!error.message.includes('Private database'));
 assert.equal(refreshed,false);const finished=rpc.calls.find(call=>call.name==='service_finish_status_refresh');assert.ok(finished);assert.equal(finished.data.p_summary.failed,1);assert.equal(finished.data.p_summary.checked,0);
});

test('internal refresh HTTP route is POST-only and denies signed-out requests without caching the response',async()=>{
 for(const method of ['GET','POST']){
  const headers=new Map();const res={setHeader:(key,value)=>headers.set(key,value),getHeader:key=>headers.get(key),end(value){this.body=JSON.parse(value);}};
  await router({method,url:'/api/internal/server-status',browserpRoute:'internal/server-status',headers:{host:'localhost:8080','content-type':'application/json'},body:{}},res);
  assert.equal(res.statusCode,method==='GET'?405:401);assert.equal(headers.get('Cache-Control'),'no-store');assert.ok(res.body.error);if(method==='GET')assert.equal(headers.get('Allow'),'POST');
 }
});

test('artwork cleanup requires a claimed scheduler run, follows persisted health, and cannot turn success into failure',async()=>{
 let cleaned=0;
 const rpc=rpcFixture();
 const result=await scheduledStatusRefresh(request(),{...rpc,now:()=>100,cleanupMedia:async({signal})=>{
  cleaned++; assert.equal(rpc.calls.at(-1).name,'service_finish_status_refresh');
  assert.ok(signal instanceof AbortSignal); assert.equal(signal.aborted,false);
  throw new Error('Private storage failure');
 }});
 assert.equal(cleaned,1);assert.equal(result.accepted,true);assert.equal(result.summary.failed,0);
 const busy=rpcFixture({claim:null});await scheduledStatusRefresh(request(),{...busy,cleanupMedia:async()=>{cleaned++;}});assert.equal(cleaned,1);
 await assert.rejects(scheduledStatusRefresh(request({headers:{}}),{...rpc,cleanupMedia:async()=>{cleaned++;}}),{status:401});assert.equal(cleaned,1);
});
