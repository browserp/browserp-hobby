import assert from 'node:assert/strict';
import test from 'node:test';
import { staffMinecraft, refreshMinecraftCode, enrichMinecraftServers } from '../lib/minecraft-workflow.js';

const userId='00000000-0000-4000-8000-000000000001';
const serverId='00000000-0000-4000-8000-000000000101';
const candidateId='00000000-0000-4000-8000-000000000201';
const joinCode='123456789abc',csrf='a'.repeat(43);
const token=`fixture.${Buffer.from(JSON.stringify({sub:userId,aal:'aal2'})).toString('base64url')}.fixture`;
const user={id:userId,app_metadata:{provider:'discord',providers:['discord']},identities:[{provider:'discord',provider_id:'111111111111111111'}]};
const candidate={address:'play.example.com:25565',edition:'java',name:'Reviewed roleplay',description:'A reviewed community description with rules and collaborative character stories.',region:'International',language:'English',framework:'Roleplay',accessType:'unknown',tags:['roleplay'],keywords:[],logoUrl:null,bannerUrl:null,discordUrl:null,websiteUrl:null};
const entry={id:candidateId,joinCode,serverId,version:4,status:'published',candidate};
const observation=()=>({sourceKey:joinCode,address:candidate.address,edition:'java',players:0,capacity:100,online:true,checkedAt:new Date().toISOString()});
const response=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json'}});
function request(action,data){return{method:'POST',url:'/api/admin/minecraft',body:{action,id:candidateId,expectedVersion:4,reason:'Checked official community information.',...(data?{data}:{})},headers:{host:'localhost:8080',origin:'http://localhost:8080','content-type':'application/json',cookie:`brp_access=${token}; brp_csrf=${csrf}`,'x-browserp-csrf':csrf},socket:{remoteAddress:'127.0.0.1'}};}
function reply(){const headers=new Map();return{setHeader:(key,value)=>headers.set(key,value),getHeader:key=>headers.get(key)};}
async function backend(handler,run){
 const environment={SUPABASE_URL:'https://fixture.supabase.co',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_fixture',SUPABASE_SECRET_KEY:'sb_secret_fixture',PRIVACY_HASH_SECRET:'fixture-only-secret',NODE_ENV:'test',VERCEL:'0'};
 const before=new Map(Object.keys(environment).map(key=>[key,process.env[key]]));const original=globalThis.fetch;const calls=[];Object.assign(process.env,environment);
 globalThis.fetch=async(value,options={})=>{
  const url=new URL(value),body=typeof options.body==='string'?JSON.parse(options.body):options.body;const call={url,body,options};calls.push(call);
  if(url.pathname==='/auth/v1/user')return response(user);
  if(url.pathname.endsWith('/rpc/check_security_ban_server'))return response(null);
  if(url.pathname.endsWith('/rpc/consume_rate_limit'))return response(true);
  if(url.pathname.endsWith('/rpc/staff_minecraft_candidates'))return response({items:[entry],total:1});
  if(url.pathname.endsWith('/rpc/staff_minecraft_candidate'))return response(entry);
  const result=await handler(call);if(result!==undefined)return result;throw new Error(`Unexpected fixture request: ${url.pathname}`);
 };
 try{return await run(calls);}finally{globalThis.fetch=original;for(const[key,value]of before)value===undefined?delete process.env[key]:process.env[key]=value;}
}

test('Minecraft refresh selects the requested server beyond the first 100 and preserves a verified zero',async()=>{
 const oldest=Array.from({length:100},(_,i)=>({serverId:`unrelated-${i}`,joinCode:i.toString(16).padStart(12,'0')}));let checked=0;
 await backend(({url,body})=>{
  if(url.pathname.endsWith('/rpc/service_minecraft_sources')){assert.equal(body.p_server_id,serverId);assert.equal(body.p_limit,1);return response(body.p_server_id===serverId?[{serverId,joinCode,...candidate}]:oldest);}
  if(url.pathname.endsWith('/rpc/service_claim_minecraft_refresh'))return response(true);
  if(url.pathname.endsWith('/rpc/service_refresh_minecraft_snapshot')){assert.equal(body.p_players,0);return response({serverId,players:0,capacity:100,online:true,checkedAt:body.p_observed_at});}
 },async()=>{
  const result=await refreshMinecraftCode(joinCode,{serverId,fetchServer:async(address,{edition})=>{checked++;assert.equal(address,candidate.address);assert.equal(edition,'java');return observation();}});
  assert.equal(checked,1);assert.equal(result.players,0);assert.equal(result.online,true);
 });
});

test('Minecraft refresh lease no-op is explicit and never fetches or says it checked a new observation',async()=>backend(({url})=>{
 if(url.pathname.endsWith('/rpc/service_minecraft_sources'))return response([{serverId,joinCode,...candidate,lastCheckedAt:null}]);
 if(url.pathname.endsWith('/rpc/service_claim_minecraft_refresh'))return response(false);
},async calls=>{
 const result=await staffMinecraft(request('refresh'),reply(),'fixture-request-id',{fetchServer:async()=>{assert.fail('The leased source must not be fetched');}});
 assert.equal(result.result.skipped,true);assert.equal(result.result.reason,'recent_or_in_progress');assert.match(result.message,/No new observation was fetched/);
 assert.equal(calls.some(c=>c.url.pathname.endsWith('/rpc/service_refresh_minecraft_snapshot')),false);
}));

test('Minecraft skipped refresh keeps an unavailable public count unknown rather than reviving its old value',async()=>backend(({url})=>{
 if(url.pathname.endsWith('/rpc/public_minecraft_import_details'))return response([{serverId,joinCode,lastCheckedAt:new Date(Date.now()-120000).toISOString(),statusUnavailable:true}]);
 if(url.pathname.endsWith('/rpc/service_minecraft_sources'))return response([{serverId,joinCode,...candidate,lastCheckedAt:new Date(Date.now()-120000).toISOString()}]);
 if(url.pathname.endsWith('/rpc/service_claim_minecraft_refresh'))return response(false);
},async()=>{
 const [result]=await enrichMinecraftServers([{id:serverId,platform_id:'minecraft',players:42,capacity:100,online:true}],{refresh:true});
 assert.equal(result.players,null);assert.equal(result.capacity,null);assert.equal(result.online,false);
}));

test('Minecraft publication remains successful if only its later observation write fails',async()=>{
 let published=false;
 await backend(({url,body})=>{
  if(url.pathname.endsWith('/rpc/staff_publish_minecraft_candidate')){published=true;assert.equal(body.p_expected_version,4);assert.deepEqual(Object.keys(body.p_data).sort(),['description','language','name']);return response({id:candidateId,serverId,slug:'reviewed-roleplay',status:'published',version:5});}
  if(url.pathname.endsWith('/rpc/service_refresh_minecraft_snapshot')){assert.equal(published,true);return response({code:'temporarily_unavailable',message:'Observation storage unavailable'},503);}
 },async calls=>{
  const result=await staffMinecraft(request('publish',{name:candidate.name,description:candidate.description,language:'English',players:9999,ownerId:userId}),reply(),'fixture-request-id',{fetchServer:async()=>observation()});
  assert.equal(result.result.status,'published');assert.equal(result.result.version,5);assert.equal(result.warning,'observation_save_failed');assert.match(result.message,/published.*could not be saved/);
  assert.equal(calls.filter(c=>c.url.pathname.endsWith('/rpc/staff_publish_minecraft_candidate')).length,1);
 });
});

test('Minecraft source failure before publishing prevents the publication mutation',async()=>backend(()=>{},async calls=>{
 await assert.rejects(()=>staffMinecraft(request('publish',{name:candidate.name}),reply(),'fixture-request-id',{fetchServer:async()=>{throw Object.assign(new Error('Minecraft status timed out'),{status:502});}}),/timed out/);
 assert.equal(calls.some(c=>c.url.pathname.endsWith('/rpc/staff_publish_minecraft_candidate')),false);
}));

test('Minecraft failed count refresh marks unavailable without inventing a zero snapshot',async()=>backend(({url})=>{
 if(url.pathname.endsWith('/rpc/service_minecraft_sources'))return response([{serverId,joinCode,...candidate}]);
 if(url.pathname.endsWith('/rpc/service_claim_minecraft_refresh'))return response(true);
 if(url.pathname.endsWith('/rpc/service_mark_minecraft_unavailable'))return response(true);
},async calls=>{
 const result=await refreshMinecraftCode(joinCode,{serverId,fetchServer:async()=>{throw new Error('Minecraft status timed out');}});
 assert.equal(result.unavailable,true);assert.equal(result.players,null);assert.equal(result.capacity,null);
 assert.equal(calls.some(c=>c.url.pathname.endsWith('/rpc/service_mark_minecraft_unavailable')),true);
 assert.equal(calls.some(c=>c.url.pathname.endsWith('/rpc/service_refresh_minecraft_snapshot')),false);
}));
