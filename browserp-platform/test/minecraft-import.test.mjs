import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMinecraftAddress, publicMinecraftIp, minecraftDestination, encodeVarInt, decodeVarInt, normalizeMinecraftStatus, minecraftFavicon, fetchMinecraftServer, parseBedrockPong } from '../lib/minecraft-import.js';
import { minecraftCandidate } from '../lib/minecraft-workflow.js';

test('Minecraft addresses have canonical identities and separate edition defaults',()=>{
  const a=parseMinecraftAddress('PLAY.Example.COM'),b=parseMinecraftAddress('play.example.com:25565');assert.equal(a.sourceKey,b.sourceKey);assert.equal(a.port,25565);assert.equal(parseMinecraftAddress('play.example.com','bedrock').port,19132);
  for(const input of ['https://play.example.com','localhost','127.0.0.1:25565','10.1.2.3','169.254.169.254','192.168.1.1','2130706433','0177.0.0.1','foo.local','foo.invalid','x.com:80','x.com:65536','evil.com/path','user@host.com','host.com?address=10.0.0.1'])assert.throws(()=>parseMinecraftAddress(input));
});
test('Minecraft blocks reserved networks and IPv4 mapped IPv6 without blocking public IPs',()=>{
  for(const ip of ['127.0.0.1','100.64.1.1','198.18.1.1','192.0.2.1','224.0.0.1','::1','::ffff:127.0.0.1','::ffff:8.8.8.8','fc00::1','fe80::1','2002:7f00:1::1'])assert.equal(publicMinecraftIp(ip),false,ip);
  for(const ip of ['8.8.8.8','202.165.124.222','2606:4700:4700::1111'])assert.equal(publicMinecraftIp(ip),true,ip);
});
test('Minecraft DNS pins a validated public address and rejects mixed/private SRV results',async()=>{
  const input=parseMinecraftAddress('play.example.com');const empty=async()=>[];
  assert.equal((await minecraftDestination(input,{resolveSrvImpl:empty,resolve4Impl:async()=>['8.8.8.8'],resolve6Impl:empty})).ip,'8.8.8.8');
  await assert.rejects(()=>minecraftDestination(input,{resolveSrvImpl:empty,resolve4Impl:async()=>['8.8.8.8','127.0.0.1'],resolve6Impl:empty}),/public network/);
  await assert.rejects(()=>minecraftDestination(input,{resolveSrvImpl:async()=>[{name:'127.0.0.1',port:25565,priority:1,weight:1}],resolve4Impl:empty,resolve6Impl:empty}),/public Minecraft/);
  const checked=await minecraftDestination(input,{resolveSrvImpl:async()=>[{name:'backend.example.com.',port:25566,priority:1,weight:1}],resolve4Impl:async host=>{assert.equal(host,'backend.example.com');return['8.8.8.8'];},resolve6Impl:empty});assert.equal(checked.port,25566);
});
test('Minecraft bounded variable integers reject oversized malformed values',()=>{for(const n of [0,1,127,128,16384,131072,2147483647])assert.equal(decodeVarInt(encodeVarInt(n)).value,n);assert.equal(decodeVarInt(Buffer.from([128])),null);assert.throws(()=>decodeVarInt(Buffer.from([255,255,255,255,255,1])));});
test('Minecraft keeps successful zero separate from unavailable and drops player identities',()=>{
  const input=parseMinecraftAddress('play.example.com');const s=normalizeMinecraftStatus({players:{online:0,max:100,sample:[{name:'PrivatePlayer',id:'private-uuid'}]},description:{text:'§aRoleplay',extra:[{text:' world'}]},version:{name:'1.21'}},input);
  assert.equal(s.players,0);assert.equal(s.online,true);assert.equal(s.motd,'Roleplay world');assert.ok(!JSON.stringify(s).includes('PrivatePlayer'));const c=minecraftCandidate(s);assert.equal(c.language,'');assert.equal(c.countScope,'network');assert.equal(c.accessType,'unknown');assert.ok(!JSON.stringify(c).includes('private-uuid'));
  for(const p of [{online:'4',max:100},{online:-1,max:100},{online:101,max:100},{online:1,max:0},{online:1,max:100001},{}])assert.throws(()=>normalizeMinecraftStatus({players:p},input));
});
test('Minecraft favicon accepts bounded 64px PNG only, not remote URLs or HTML',()=>{
  assert.equal(minecraftFavicon('https://evil.invalid/picture.png'),null);assert.equal(minecraftFavicon('data:image/svg+xml;base64,PHN2Zz4='),null);const png=Buffer.alloc(33);Buffer.from([137,80,78,71,13,10,26,10]).copy(png);png.write('IHDR',12);png.writeUInt32BE(64,16);png.writeUInt32BE(64,20);assert.equal(minecraftFavicon(`data:image/png;base64,${png.toString('base64')}`).length,33);png.writeUInt32BE(100000,16);assert.equal(minecraftFavicon(`data:image/png;base64,${png.toString('base64')}`),null);
});
test('Minecraft edition dispatches only to the requested status adapter and failures propagate',async()=>{
  let calls=0;const opts={destinationImpl:async()=>({ip:'8.8.8.8',port:19132,family:4}),edition:'bedrock',javaImpl:async()=>{throw Error('wrong adapter');},bedrockImpl:async()=>{calls++;return{players:{online:2,max:20},description:'RP',version:{name:'1.21'}};}};
  assert.equal((await fetchMinecraftServer('play.example.com',opts)).players,2);assert.equal(calls,1);await assert.rejects(()=>fetchMinecraftServer('play.example.com',{...opts,bedrockImpl:async()=>{throw Error('timeout');}}),/timeout/);
});
test('Minecraft Bedrock pong validates nonce, magic, length and count fields',()=>{
  const nonce=Buffer.alloc(8,1),text=Buffer.from('MCPE;Roleplay;800;1.21;4;20;');const packet=Buffer.alloc(35+text.length);packet[0]=0x1c;nonce.copy(packet,1);Buffer.from('00ffff00fefefefefdfdfdfd12345678','hex').copy(packet,17);packet.writeUInt16BE(text.length,33);text.copy(packet,35);assert.equal(parseBedrockPong(packet,nonce).players.online,4);assert.throws(()=>parseBedrockPong(packet,Buffer.alloc(8,2)));packet[17]=1;assert.throws(()=>parseBedrockPong(packet,nonce));
});
