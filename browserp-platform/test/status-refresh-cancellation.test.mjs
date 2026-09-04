import test from 'node:test';
import assert from 'node:assert/strict';
import {getEventListeners,once} from 'node:events';
import {createServer as createHttpServer} from 'node:http';
import {createServer as createTcpServer,createConnection} from 'node:net';
import {createSocket} from 'node:dgram';
import {rpc} from '../lib/supabase.js';
import {fetchCfxServer} from '../lib/fivem-import.js';
import {refreshCfxCode} from '../lib/fivem-workflow.js';
import {fetchMinecraftServer,minecraftDestination,parseMinecraftAddress} from '../lib/minecraft-import.js';
import {refreshMinecraftCode} from '../lib/minecraft-workflow.js';

const reason=()=>new DOMException('Scheduled refresh deadline reached','TimeoutError');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const json=data=>new Response(JSON.stringify(data),{headers:{'content-type':'application/json'}});
async function environment(fetcher,run){
 const oldFetch=globalThis.fetch,values={SUPABASE_URL:'https://fixture.supabase.co',SUPABASE_PUBLISHABLE_KEY:'sb_publishable_fixture',SUPABASE_SECRET_KEY:'sb_secret_fixture'};
 const previous=new Map(Object.keys(values).map(k=>[k,process.env[k]]));Object.assign(process.env,values);if(fetcher)globalThis.fetch=fetcher;
 try{return await run(oldFetch);}finally{globalThis.fetch=oldFetch;for(const[k,v]of previous)v===undefined?delete process.env[k]:process.env[k]=v;}
}

test('external cancellation stops Supabase RPC before fetch and while reading a real response body',async()=>{
 let called=false;const aborted=new AbortController(),cancelled=reason();aborted.abort(cancelled);
 await environment(async()=>{called=true;},async()=>{await assert.rejects(()=>rpc('fixture',{},undefined,{useSecret:true,signal:aborted.signal}),e=>e===cancelled);assert.equal(called,false);});
 let received;const arrived=new Promise(resolve=>{received=resolve;});
 const server=createHttpServer((_req,res)=>{res.writeHead(200,{'Content-Type':'application/json'});res.write('{"still":');received();});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const realFetch=globalThis.fetch,controller=new AbortController();
 try{await environment((url,options)=>{assert.match(String(url),/rest\/v1\/rpc\/fixture$/);assert.ok(options.signal instanceof AbortSignal);return realFetch(`http://127.0.0.1:${server.address().port}/`,options);},async()=>{
  const pending=rpc('fixture',{},undefined,{useSecret:true,signal:controller.signal});await arrived;controller.abort(cancelled);await assert.rejects(pending,e=>e===cancelled);
 });}finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});

test('Cfx cancellation interrupts a real streaming body and remains distinct from an upstream timeout',async()=>{
 let received;const arrived=new Promise(resolve=>{received=resolve;});
 const server=createHttpServer((_req,res)=>{res.writeHead(200,{'Content-Type':'application/json'});res.write('{"Data":');received();});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const controller=new AbortController(),cancelled=reason();
 try{
  const pending=fetchCfxServer('abc123',{signal:controller.signal,fetchImpl:(url,options)=>{assert.equal(url,'https://frontend.cfx-services.net/api/servers/single/abc123');return fetch(`http://127.0.0.1:${server.address().port}/`,options);}});
  await arrived;controller.abort(cancelled);await assert.rejects(pending,e=>e===cancelled);
 }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});

test('Minecraft cancellation stops pending SRV and address lookups and removes its abort listeners',async()=>{
 for(const edition of ['java','bedrock']){
  const controller=new AbortController(),cancelled=reason();let laterReject,calls=0;
  const stalled=()=>{calls++;return new Promise((_resolve,reject)=>{laterReject=reject;});};
  const pending=minecraftDestination(parseMinecraftAddress('play.example.com',edition),{signal:controller.signal,resolveSrvImpl:stalled,resolve4Impl:stalled,resolve6Impl:async()=>[]});
  assert.equal(getEventListeners(controller.signal,'abort').length,1);controller.abort(cancelled);await assert.rejects(pending,e=>e===cancelled);
  assert.equal(getEventListeners(controller.signal,'abort').length,0);laterReject(new Error('Late DNS rejection'));await tick();assert.equal(calls,1);
 }
 const controller=new AbortController();controller.abort(reason());let called=false;
 await assert.rejects(()=>minecraftDestination(parseMinecraftAddress('play.example.com'),{signal:controller.signal,resolveSrvImpl:async()=>{called=true;}}));assert.equal(called,false);
});

test('Minecraft Java abort destroys the active TCP socket and removes cancellation listeners',async()=>{
 let arrived;const connected=new Promise(resolve=>{arrived=resolve;});
 const server=createTcpServer(socket=>{socket.on('data',()=>arrived());});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const controller=new AbortController(),cancelled=reason();let client;
 try{
  const pending=fetchMinecraftServer('play.example.com',{signal:controller.signal,destinationImpl:async(_input,{signal})=>{assert.equal(signal,controller.signal);return{ip:'127.0.0.1',port:server.address().port,family:4};},connectImpl:options=>(client=createConnection(options))});
  await connected;const closed=once(client,'close');controller.abort(cancelled);await assert.rejects(pending,e=>e===cancelled);await closed;
  assert.equal(client.destroyed,true);assert.equal(getEventListeners(controller.signal,'abort').length,0);
 }finally{client?.destroy();await new Promise(resolve=>server.close(resolve));}
});

test('Minecraft Bedrock abort closes its active UDP socket and removes cancellation listeners',async()=>{
 const server=createSocket('udp4');await new Promise(resolve=>server.bind(0,'127.0.0.1',resolve));
 const controller=new AbortController(),cancelled=reason();let client;
 try{
  const arrived=once(server,'message');const pending=fetchMinecraftServer('play.example.com',{edition:'bedrock',signal:controller.signal,destinationImpl:async()=>({ip:'127.0.0.1',port:server.address().port,family:4}),createSocketImpl:type=>(client=createSocket(type))});
  await arrived;const closed=once(client,'close');controller.abort(cancelled);await assert.rejects(pending,e=>e===cancelled);await closed;
  assert.equal(getEventListeners(controller.signal,'abort').length,0);assert.throws(()=>client.address(),{code:'ERR_SOCKET_DGRAM_NOT_RUNNING'});
 }finally{try{client?.close();}catch{}server.close();}
});

test('cancelled Cfx and Minecraft refreshes never write an unavailable observation or a new snapshot',async()=>{
 const serverId='00000000-0000-4000-8000-000000000101',joinCode='123456789abc';
 for(const platform of ['fivem','minecraft']){
  const controller=new AbortController(),cancelled=reason(),calls=[];let sourceStarted;
  const started=new Promise(resolve=>{sourceStarted=resolve;});
  const stalled=signal=>new Promise((_resolve,reject)=>{sourceStarted();signal.addEventListener('abort',()=>reject(signal.reason),{once:true});});
  await environment(async(value,options)=>{
   const url=new URL(value);calls.push(url.pathname);
   if(url.pathname.endsWith('/service_minecraft_sources'))return json([{serverId,joinCode,address:'play.example.com:25565',edition:'java'}]);
   if(url.pathname.endsWith('/service_claim_cfx_refresh')||url.pathname.endsWith('/service_claim_minecraft_refresh'))return json(true);
   if(url.hostname==='frontend.cfx-services.net')return stalled(options.signal);
   assert.fail(`Cancellation must not make a mutation: ${url.pathname}`);
  },async()=>{
   const pending=platform==='fivem'?refreshCfxCode('abc123',{platform,signal:controller.signal}):refreshMinecraftCode(joinCode,{serverId,signal:controller.signal,fetchServer:async(_address,{signal})=>{assert.equal(signal,controller.signal);return stalled(signal);}});
   await started;controller.abort(cancelled);await assert.rejects(pending,e=>e===cancelled);
   assert.equal(calls.some(path=>/mark_.*unavailable|refresh_.*snapshot/.test(path)),false);
  });
 }
});
