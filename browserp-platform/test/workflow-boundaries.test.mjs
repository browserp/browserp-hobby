import assert from 'node:assert/strict';
import test from 'node:test';
import { beginOAuth } from '../lib/supabase.js';
import { sealDiscordToken, openDiscordToken, verifyDiscordOwnership, validatePublicDiscordInvite } from '../lib/discord-claims.js';
import { memberClaims, staffClaims } from '../lib/claim-workflow.js';
import { staffFiveM, refreshDueFiveMServers, enrichImportedServers } from '../lib/fivem-workflow.js';
import { fetchServerImage, rasterType, storedServerImage } from '../lib/server-media.js';

const userId='00000000-0000-4000-8000-000000000001';
const serverId='00000000-0000-4000-8000-000000000101';
const candidateId='00000000-0000-4000-8000-000000000201';
const claimId='00000000-0000-4000-8000-000000000301';
const discordId='111111111111111111';
const guildId='222222222222222222';
const csrf='a'.repeat(43);
const token=`fixture.${Buffer.from(JSON.stringify({sub:userId,aal:'aal2'})).toString('base64url')}.fixture`;
const user={id:userId,app_metadata:{provider:'discord',providers:['discord']},identities:[{provider:'discord',provider_id:discordId}]};
const server={id:serverId,name:'Fixture server',slug:'fixture-server',status:'published',owner_id:null,community_url:'https://discord.gg/fixture'};
const source=()=>({EndPoint:'6myr996',Data:{hostname:'A source fixture',clients:8,svMaxclients:64,lastSeen:new Date().toISOString(),vars:{gamename:'gta5',sv_projectDesc:'An accurate source description that staff can review before importing.',locale:'en-US',tags:'roleplay,economy',sv_appearAllowlisted:'false'}}});
const response=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json'}});
function res(){const headers=new Map();return {setHeader:(key,value)=>headers.set(key,value),getHeader:key=>headers.get(key)};}
function req(method='GET',body,url='/api/server-claims'){return {method,url,body,headers:{host:'localhost:8080',origin:'http://localhost:8080','content-type':'application/json',cookie:`brp_access=${token}; brp_csrf=${csrf}`,'x-browserp-csrf':csrf},socket:{remoteAddress:'127.0.0.1'}};}
async function backend(handler,run){
 const environment={SUPABASE_URL:'https://fixture.supabase.co',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_fixture',SUPABASE_SECRET_KEY:'sb_secret_fixture',PRIVACY_HASH_SECRET:'fixture-only-secret',NODE_ENV:'test',VERCEL:'0'};
 const before=new Map(Object.keys(environment).map(key=>[key,process.env[key]]));const original=globalThis.fetch;const calls=[];
 Object.assign(process.env,environment);
 globalThis.fetch=async(value,options={})=>{
  const url=new URL(value);const body=typeof options.body==='string'?JSON.parse(options.body):options.body;
  const call={url,body,options};calls.push(call);
  if(url.pathname==='/auth/v1/user')return response(user);
  if(url.pathname.endsWith('/rpc/check_security_ban_server'))return response(null);
  if(url.pathname.endsWith('/rpc/consume_rate_limit'))return response(true);
  const result=await handler(call);if(result!==undefined)return result;
  throw new Error(`Unexpected fixture request: ${url}`);
 };
 try{return await run(calls);}finally{globalThis.fetch=original;for(const [key,value]of before)value===undefined?delete process.env[key]:process.env[key]=value;}
}

test('Discord claim consent is opt-in and encrypted token proof is short-lived and user-bound',async()=>backend(()=>{},async()=>{
 for(const provider of ['discord','google'])for(const optIn of [false,true]){
  const request=req('GET',undefined,`/api/auth/${provider}${optIn?'?claimGuilds=1':''}`);
  const url=new URL(beginOAuth(request,res(),provider));
  assert.equal(url.searchParams.get('scopes'),provider==='discord'&&optIn?'identify email guilds':null);
 }
 const now=Date.now(),secret='a-realistic-fixture-provider-token';const sealed=sealDiscordToken(userId,secret,now);
 assert.ok(sealed);assert.equal(sealed.includes(secret),false);assert.equal(openDiscordToken(sealed,userId,now+1000),secret);
 assert.equal(openDiscordToken(sealed,serverId,now+1000),null);assert.equal(openDiscordToken(sealed,userId,now+600001),null);
 const pieces=sealed.split('.');pieces[3]=(pieces[3][0]==='A'?'B':'A')+pieces[3].slice(1);assert.equal(openDiscordToken(pieces.join('.'),userId,now),null);
}));

test('Discord ownership requires the matching authenticated user and actual guild ownership',async()=>{
 const fetcher=(owner,{me=discordId,guilds=null}={})=>async url=>{
  const path=new URL(url).pathname;
  if(path.endsWith('/users/@me'))return response({id:me});
  if(path.endsWith('/users/@me/guilds'))return response(guilds||[{id:guildId,owner,permissions:'8'}]);
  if(path.includes('/invites/'))return response({type:0,guild:{id:guildId,name:'Fixture\ncommunity'}});
  throw new Error('Unexpected Discord endpoint');
 };
 const base={user,communityUrl:'https://discord.gg/fixture',token:'fixture-token'};
 const verified=await verifyDiscordOwnership({...base,fetchImpl:fetcher(true)});assert.equal(verified.status,'verified');assert.equal(verified.guildId,guildId);assert.equal(verified.guildName,'Fixture community');
 assert.equal((await verifyDiscordOwnership({...base,fetchImpl:fetcher(false)})).status,'not_owner');
 assert.equal((await verifyDiscordOwnership({...base,fetchImpl:fetcher(true,{me:'999999999999999999'})})).status,'needs_discord');
 assert.equal((await verifyDiscordOwnership({...base,fetchImpl:fetcher(true,{guilds:Array.from({length:200},(_,i)=>({id:String(i),owner:false}))})})).status,'unavailable');
 assert.equal((await verifyDiscordOwnership({...base,communityUrl:'https://discord.gg.evil.example/fixture',fetchImpl:()=>{throw new Error('Must not fetch arbitrary hosts');}})).status,'unavailable');
});

test('member claim lookup returns CSRF and uses only public non-adult listings',async()=>backend(({url})=>{
 if(url.pathname==='/rest/v1/servers'){assert.equal(url.searchParams.get('status'),'eq.published');assert.equal(url.searchParams.get('age_rating'),'neq.adult');return response([server]);}
 if(url.pathname.endsWith('/rpc/member_server_claims'))return response({items:[]});
},async()=>{
 const result=await memberClaims(req('GET',undefined,`/api/server-claims?serverId=${serverId}`),res(),'request-fixture');
 assert.equal(result.csrfToken,csrf);assert.equal(result.context.claimable,true);assert.deepEqual(result.claims,[]);
}));

test('claim requests discard client-supplied verification and keep evidence within the shared bound',async()=>backend(({url,body})=>{
 if(url.pathname==='/rest/v1/servers')return response([server]);
 if(url.pathname.endsWith('/rpc/member_server_claim')){assert.equal(Object.hasOwn(body,'verificationStatus'),false);assert.equal(Object.hasOwn(body,'p_is_owner'),false);assert.ok(body.p_evidence_url.length>500);return response({id:claimId,serverId,status:'pending',verificationStatus:'pending_check'});}
 if(url.pathname.endsWith('/rpc/service_verify_server_claim')){assert.equal(body.p_user_id,userId);assert.equal(body.p_is_owner,null);assert.equal(body.p_status,'needs_discord');return response({id:claimId,status:'pending',verificationStatus:'needs_discord'});}
},async(calls)=>{
 const result=await memberClaims(req('POST',{action:'request',serverId,message:'I operate this server and can provide evidence.',evidenceUrl:`https://example.com/${'a'.repeat(700)}`,verificationStatus:'verified',isOwner:true}),res(),'request-fixture');
 assert.equal(result.claim.status,'pending');assert.equal(result.verificationStatus,'needs_discord');
 const bad=req('POST',{action:'request',serverId,message:'I operate this server and can provide evidence.'});bad.headers['x-browserp-csrf']='b'.repeat(43);
 const count=calls.filter(call=>call.url.pathname.endsWith('/rpc/member_server_claim')).length;
 await assert.rejects(memberClaims(bad,res(),'forged-csrf'),{status:403});
 assert.equal(calls.filter(call=>call.url.pathname.endsWith('/rpc/member_server_claim')).length,count);
}));

test('staff filtering clamps offsets and candidate lookup preserves the authenticated permission boundary',async()=>backend(({url,body,options})=>{
 if(url.pathname.endsWith('/rpc/staff_server_claims')){assert.equal(body.p_offset,10000);return response({items:[],total:0});}
 if(url.pathname.endsWith('/rpc/staff_fivem_candidates')){assert.equal(body.p_offset,0);return response({items:[],total:0});}
 if(url.pathname.endsWith('/rpc/staff_fivem_candidate')){assert.equal(options.headers.Authorization,`Bearer ${token}`);return response({id:candidateId,joinCode:'6myr996',version:1,serverId,candidate:{name:'Fixture',description:'An accurate description of this server and its roleplay community.',tags:['roleplay']}});}
},async(calls)=>{
 await staffClaims(req('GET',undefined,'/api/admin/claims?offset=100000.5'),res(),'request-fixture');
 await assert.rejects(staffFiveM(req('POST',{action:'publish',id:candidateId,expectedVersion:1,reason:'Reviewing this candidate',data:{tags:'https://discord.gg/not-a-tag'}}),res(),'request-fixture'),{status:400});
 assert.equal(calls.some(call=>call.url.pathname==='/rest/v1/fivem_import_candidates'),false);
 assert.equal(calls.some(call=>call.url.pathname.endsWith('/rpc/staff_publish_fivem_candidate')),false);
}));

test('scraper permission failures stop before upstream fetch or private candidate access',async()=>backend(({url})=>{
 if(url.pathname.endsWith('/rpc/staff_fivem_candidates'))return response({message:'Scraper permission required',code:'42501'},403);
},async(calls)=>{
 await assert.rejects(staffFiveM(req('POST',{action:'fetch',inputs:['6myr996']}),res(),'request-fixture'),{status:403});
 assert.equal(calls.some(call=>call.url.hostname!=='fixture.supabase.co'),false);
 assert.equal(calls.some(call=>call.url.pathname.endsWith('/rpc/service_stage_fivem_candidate')),false);
}));

test('due refresh reads only stored sources, takes a lease and persists current observations',async()=>backend(({url,body})=>{
 if(url.pathname.endsWith('/rpc/service_fivem_sources')){assert.equal(body.p_due_only,true);assert.equal(body.p_limit,3);return response([{serverId,joinCode:'6myr996'}]);}
 if(url.pathname.endsWith('/rpc/service_claim_fivem_refresh')){assert.equal(body.p_join_code,'6myr996');return response(true);}
 if(url.hostname==='frontend.cfx-services.net'){assert.equal(url.pathname,'/api/servers/single/6myr996');return response(source());}
 if(url.pathname.endsWith('/rpc/service_refresh_fivem_snapshot')){assert.equal(body.p_players,8);return response({serverId,online:true,players:8,capacity:64,checkedAt:body.p_observed_at});}
},async(calls)=>{
 const result=await refreshDueFiveMServers();assert.equal(result.length,1);assert.equal(result[0].players,8);
 assert.ok(calls.findIndex(call=>call.url.pathname.endsWith('/rpc/service_claim_fivem_refresh'))<calls.findIndex(call=>call.url.hostname==='frontend.cfx-services.net'));
}));

test('unavailable imported observations remain unknown when enriching cached directory results',async()=>backend(({url})=>{
 if(url.pathname.endsWith('/rpc/public_server_import_details'))return response([{serverId,imported:true,claimable:true,joinCode:'6myr996',websiteUrl:'https://community.example.org/',lastCheckedAt:new Date().toISOString(),statusUnavailable:true,keywords:[]}]);
},async()=>{
 const result=await enrichImportedServers([{id:serverId,online:true,players:25,capacity:64}]);
 assert.equal(result[0].online,false);assert.equal(result[0].players,null);assert.equal(result[0].capacity,null);
 assert.equal(result[0].website_url,'https://community.example.org/');
}));

test('server media rejects non-images, oversized canvases, arbitrary hosts and oversized downloads',async()=>backend(()=>{},async()=>{
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jZ1EAAAAASUVORK5CYII=','base64');
 assert.equal(rasterType(png).type,'image/png');
 const large=Buffer.from(png);large.writeUInt32BE(100000,16);large.writeUInt32BE(100000,20);assert.equal(rasterType(large),null);
 assert.equal(rasterType(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')),null);
 const gif=Buffer.alloc(30);gif.write('GIF89a');gif.writeUInt16LE(65535,6);gif.writeUInt16LE(65535,8);assert.equal(rasterType(gif),null);gif.writeUInt16LE(1,6);gif.writeUInt16LE(1,8);assert.equal(rasterType(gif).type,'image/gif');
 const fakeJpeg=Buffer.alloc(30);fakeJpeg[0]=255;fakeJpeg[1]=216;fakeJpeg[2]=255;assert.equal(rasterType(fakeJpeg),null);
 assert.equal(storedServerImage('https://fixture.supabase.co/storage/v1/object/public/server-media/6myr996/abcdef0123456789.png'),true);
 assert.equal(storedServerImage('https://fixture.supabase.co.evil.example/storage/v1/object/public/server-media/6myr996/abcdef0123456789.png'),false);
 await assert.rejects(fetchServerImage('https://127.0.0.1/image.png',{fetchImpl:()=>{throw new Error('Must not fetch an arbitrary host');}}),{status:400});
 await assert.rejects(fetchServerImage('https://i.imgur.com/image.png',{fetchImpl:async()=>new Response(png,{headers:{'content-length':String(2*1024*1024+1)}})}),{status:422});
 const image=await fetchServerImage('https://i.imgur.com/image.png',{fetchImpl:async(url,options)=>{assert.equal(options.redirect,'error');return new Response(png);}});assert.equal(image.type,'image/png');
}));


test('public Discord invite validation uses a fixed unauthenticated endpoint and distinguishes invalid from unavailable',async()=>{
 const attempts=[];
 const fetcher=(payload,status=200)=>async(url,options)=>{attempts.push({url,options});return response(payload,status);};
 const valid=await validatePublicDiscordInvite('https://discord.gg/real_invite',{fetchImpl:fetcher({type:0,guild:{id:guildId,name:'A real community'}})});
 assert.deepEqual(valid,{status:'valid',guildName:'A real community'});
 assert.equal(attempts[0].url,'https://discord.com/api/v10/invites/real_invite');
 assert.equal(attempts[0].options.headers.Authorization,undefined);assert.equal(attempts[0].options.redirect,'error');assert.ok(attempts[0].options.signal instanceof AbortSignal);
 assert.equal((await validatePublicDiscordInvite('https://discord.gg/expired',{fetchImpl:fetcher({code:10006},404)})).status,'invalid');
 assert.equal((await validatePublicDiscordInvite('https://discord.gg/retry',{fetchImpl:fetcher({retry_after:3},429)})).status,'unavailable');
 assert.equal((await validatePublicDiscordInvite('https://discord.gg/retry',{fetchImpl:async()=>{throw new DOMException('timeout','TimeoutError');}})).status,'unavailable');
 assert.equal((await validatePublicDiscordInvite('https://discord.gg/group',{fetchImpl:fetcher({type:1})})).status,'invalid');
 assert.equal((await validatePublicDiscordInvite('https://discord.gg/malformed',{fetchImpl:fetcher({unexpected:'shape'})})).status,'unavailable');
 let fetched=false;
 for(const url of ['https://discord.gg.evil.example/path','https://discord.gg/invite?url=http://127.0.0.1','https://discord.gg/%2f..%2fusers','https://evil.example/@discord.gg/fixture']){
  assert.equal((await validatePublicDiscordInvite(url,{fetchImpl:async()=>{fetched=true;}})).status,'invalid');
 }
 assert.equal(fetched,false);
 assert.equal((await validatePublicDiscordInvite('https://discord.gg/oversized',{fetchImpl:async()=>new Response('{}',{headers:{'content-length':String(128*1024+1)}})})).status,'unavailable');
});

test('staff fetch removes dead Discord invites but retains inconclusive links for review',async()=>{
 for(const status of [404,200,429])await backend(({url,body,options})=>{
  if(url.pathname.endsWith('/rpc/staff_fivem_candidates'))return response({items:[],total:0});
  if(url.hostname==='frontend.cfx-services.net'){const fixture=source();fixture.Data.vars.discord='https://discord.gg/fixture';return response(fixture);}
  if(url.hostname==='discord.com'){assert.equal(url.pathname,'/api/v10/invites/fixture');assert.equal(options.headers.Authorization,undefined);return response(status===200?{type:0,guild:{id:guildId,name:'Fixture guild'}}:{code:10006},status);}
  if(url.pathname.endsWith('/rpc/service_stage_fivem_candidate')){
   const candidate=body.p_candidate;
   assert.equal(candidate.discordUrl,status===404?null:'https://discord.gg/fixture');
   if(status===200){assert.equal(candidate.evidence.find(item=>item.field==='links.communityGuildName').value,'Fixture guild');assert.equal(Object.hasOwn(candidate,'verificationStatus'),false);}
   else assert.ok(candidate.warnings.some(item=>item.code===(status===404?'invalid_discord_invite':'unverified_discord_invite')));
   return response({id:candidateId,candidate});
  }
 },async()=>{
  const result=await staffFiveM(req('POST',{action:'fetch',inputs:['6myr996']}),res(),'request-fixture');assert.equal(result.candidates.length,1);assert.deepEqual(result.errors,[]);
 });
});
