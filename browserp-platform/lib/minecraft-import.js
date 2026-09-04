import { resolve4, resolve6, resolveSrv } from "node:dns/promises";
import { BlockList, isIP, createConnection } from "node:net";
import { createSocket } from "node:dgram";
import { createHash, randomBytes } from "node:crypto";

const deny = new BlockList();
for (const [ip, bits] of [["0.0.0.0",8],["10.0.0.0",8],["100.64.0.0",10],["127.0.0.0",8],["169.254.0.0",16],["172.16.0.0",12],["192.0.0.0",24],["192.0.2.0",24],["192.168.0.0",16],["198.18.0.0",15],["198.51.100.0",24],["203.0.113.0",24],["224.0.0.0",4],["240.0.0.0",4]]) deny.addSubnet(ip,bits,"ipv4");
for (const [ip,bits] of [["::",96],["64:ff9b::",96],["64:ff9b:1::",48],["100::",64],["2001::",23],["2001:db8::",32],["2002::",16],["fc00::",7],["fe80::",10],["ff00::",8]]) deny.addSubnet(ip,bits,"ipv6");
const error = (message, status=422) => Object.assign(new Error(message),{status});
export function publicMinecraftIp(ip) { const family=isIP(ip); return Boolean(family) && !(family===6 && ip.toLowerCase().startsWith("::ffff:")) && !deny.check(ip,family===4?"ipv4":"ipv6"); }
export function parseMinecraftAddress(value, edition="java") {
  if (!["java","bedrock"].includes(edition)) throw error("Choose Java or Bedrock.",400);
  const input=String(value||"").trim().toLowerCase();
  const match=input.match(/^([a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?)(?::([0-9]{2,5}))?$/);
  if (!match || !match[1].includes(".") || match[1].split(".").some(p=>!p||p.length>63||p.startsWith("-")||p.endsWith("-")) || /(?:^|\.)(localhost|local|internal|test|invalid|example|onion)$/.test(match[1])) throw error("Enter a publicly advertised Minecraft hostname and optional port, without a URL or path.",400);
  const host=match[1],port=Number(match[2]||(edition==="java"?25565:19132));
  if (port<1024||port>65535||isIP(host)&&!publicMinecraftIp(host)||/^[\d.]+$/.test(host)&&!isIP(host)) throw error("Use a public Minecraft server address and a port from 1024 to 65535.",400);
  const address=`${host}:${port}`;
  return {host,port,edition,address,explicitPort:Boolean(match[2]),sourceKey:createHash("sha256").update(`${edition}:${address}`).digest("hex").slice(0,12)};
}
const timeout = (promise,ms,signal) => new Promise((resolve,reject)=>{
  let done=false;
  const aborted=()=>finish(signal.reason);
  const timer=setTimeout(()=>finish(error("The server address lookup timed out.")),ms);
  function finish(err,value){if(done)return;done=true;clearTimeout(timer);signal?.removeEventListener("abort",aborted);err?reject(err):resolve(value);}
  // DNS promises cannot be cancelled individually; keep their rejection handled after the race ends.
  Promise.resolve(promise).then(value=>finish(null,value),finish);
  signal?.addEventListener("abort",aborted,{once:true});if(signal?.aborted)aborted();
});
export async function minecraftDestination(input,{resolve4Impl=resolve4,resolve6Impl=resolve6,resolveSrvImpl=resolveSrv,signal}={}) {
  signal?.throwIfAborted();
  let host=input.host,port=input.port;
  if(input.edition==="java"&&input.port===25565&&!isIP(host)) {
    let records=[];
    try {records=await timeout(resolveSrvImpl(`_minecraft._tcp.${host}`),2500,signal);} catch(e) {signal?.throwIfAborted();if(!["ENODATA","ENOTFOUND"].includes(e.code))throw e;}
    if(records.length){const item=records.sort((a,b)=>a.priority-b.priority||b.weight-a.weight)[0];const checked=parseMinecraftAddress(`${item.name.replace(/\.$/,"")}:${item.port}`,input.edition);host=checked.host;port=checked.port;}
  }
  let addresses=isIP(host)?[host]:[];
  signal?.throwIfAborted();
  if(!addresses.length){const answers=await timeout(Promise.allSettled([resolve4Impl(host),resolve6Impl(host)]),2500,signal);addresses=answers.flatMap(r=>r.status==="fulfilled"?r.value:[]);}
  signal?.throwIfAborted();
  if(!addresses.length||addresses.some(ip=>!publicMinecraftIp(ip)))throw error("The Minecraft address must resolve only to public network addresses.",400);
  return {ip:addresses[0],port,family:isIP(addresses[0])};
}
export function encodeVarInt(value){let n=value>>>0;const bytes=[];do{let b=n&127;n>>>=7;if(n)b|=128;bytes.push(b);}while(n);return Buffer.from(bytes);}
export function decodeVarInt(bytes,offset=0){let value=0;for(let i=0;i<5;i++){if(offset+i>=bytes.length)return null;const b=bytes[offset+i];if(i===4&&(b&0xf0))throw error("Invalid Minecraft response length.");value|=(b&127)<<(i*7);if(!(b&128))return{value:value>>>0,size:i+1};}throw error("Invalid Minecraft response length.");}
function textComponent(value,depth=0){if(depth>8)return"";if(typeof value==="string")return value.slice(0,2000);if(Array.isArray(value))return value.slice(0,40).map(v=>textComponent(v,depth+1)).join("").slice(0,2000);if(value&&typeof value==="object")return`${typeof value.text==="string"?value.text:""}${textComponent(value.extra,depth+1)}`.slice(0,2000);return"";}
export function minecraftFavicon(value){
  if(typeof value!=="string"||value.length>16000||!/^data:image\/png;base64,[a-zA-Z0-9+/]+={0,2}$/.test(value))return null;
  const bytes=Buffer.from(value.slice(22),"base64");
  if(bytes.length<33||!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))||bytes.toString("ascii",12,16)!=="IHDR"||bytes.readUInt32BE(16)!==64||bytes.readUInt32BE(20)!==64)return null;
  return bytes;
}
export function normalizeMinecraftStatus(raw,input,observedAt=new Date().toISOString()){
  if(!raw||typeof raw!=="object"||Array.isArray(raw))throw error("Minecraft returned an invalid status response.");
  const count=raw.players?.online,max=raw.players?.max;
  if(!Number.isSafeInteger(count)||!Number.isSafeInteger(max)||count<0||max<1||max>100000||count>max)throw error("Minecraft did not report a valid player count and capacity.");
  const motd=textComponent(raw.description).replace(/§[0-9a-fk-or]/gi,"").replace(/[\u0000-\u001f\u007f]/g," ").trim().slice(0,1000);
  const version=String(raw.version?.name||"").replace(/[\u0000-\u001f\u007f<>]/g,"").slice(0,100);
  // Deliberately discard player samples, UUIDs, plugins, and raw network data.
  return{...input,players:count,capacity:max,online:true,checkedAt:observedAt,version,motd,icon:minecraftFavicon(raw.favicon)};
}
async function javaStatus(input,destination,{connectImpl=createConnection,signal}={}){
  signal?.throwIfAborted();
  return new Promise((resolve,reject)=>{
    const socket=connectImpl({host:destination.ip,port:destination.port,family:destination.family});let all=Buffer.alloc(0),done=false;
    const timer=setTimeout(()=>finish(error("The Minecraft Java status check timed out.")),5500);
    const aborted=()=>finish(signal.reason);
    function finish(err,result){if(done)return;done=true;clearTimeout(timer);signal?.removeEventListener("abort",aborted);socket.destroy();err?reject(err):resolve(result);}
    socket.once("error",()=>finish(error("The Minecraft Java server did not answer its status check.")));
    socket.once("close",()=>{if(!done)finish(error("The Minecraft server closed its status response."));});
    socket.once("connect",()=>{if(done)return;const hostname=Buffer.from(input.host);const port=Buffer.alloc(2);port.writeUInt16BE(input.port);const packet=Buffer.concat([Buffer.from([0]),encodeVarInt(767),encodeVarInt(hostname.length),hostname,port,Buffer.from([1])]);socket.write(Buffer.concat([encodeVarInt(packet.length),packet,Buffer.from([1,0])]));});
    socket.on("data",chunk=>{try{if(done)return;if(all.length+chunk.length>128*1024)throw error("Minecraft returned an oversized status response.");all=Buffer.concat([all,chunk]);const size=decodeVarInt(all);if(!size)return;if(size.value>128*1024||size.value<3)throw error("Invalid Minecraft packet size.");if(all.length<size.size+size.value)return;const packet=all.subarray(size.size,size.size+size.value);const id=decodeVarInt(packet);if(!id||id.value!==0)throw error("Unexpected Minecraft status packet.");const jsonSize=decodeVarInt(packet,id.size);if(!jsonSize||jsonSize.value+id.size+jsonSize.size!==packet.length)throw error("Invalid Minecraft JSON length.");finish(null,JSON.parse(packet.subarray(id.size+jsonSize.size).toString("utf8")));}catch(e){finish(error(e.message));}});
    signal?.addEventListener("abort",aborted,{once:true});if(signal?.aborted)aborted();
  });
}
const MAGIC=Buffer.from("00ffff00fefefefefdfdfdfd12345678","hex");
export function parseBedrockPong(bytes,nonce){
  if(bytes.length<35||bytes[0]!==0x1c||!bytes.subarray(1,9).equals(nonce)||!bytes.subarray(17,33).equals(MAGIC)||bytes.readUInt16BE(33)!==bytes.length-35)throw error("Invalid Minecraft Bedrock status response.");
  const fields=bytes.subarray(35).toString("utf8").split(";");
  if(fields[0]!=="MCPE"||!/^\d{1,6}$/.test(fields[4])||!/^\d{1,6}$/.test(fields[5]))throw error("Invalid Minecraft Bedrock player counts.");
  return{description:fields[1],version:{name:fields[3]},players:{online:Number(fields[4]),max:Number(fields[5])}};
}
async function bedrockStatus(input,destination,{createSocketImpl=createSocket,signal}={}){
  signal?.throwIfAborted();
  return new Promise((resolve,reject)=>{
    const socket=createSocketImpl(destination.family===6?"udp6":"udp4"),nonce=randomBytes(8);let done=false;
    const timer=setTimeout(()=>finish(error("The Minecraft Bedrock status check timed out.")),5500);
    const aborted=()=>finish(signal.reason);
    function finish(e,v){if(done)return;done=true;clearTimeout(timer);signal?.removeEventListener("abort",aborted);try{socket.close();}catch{}e?reject(e):resolve(v);}
    socket.once("error",()=>finish(error("The Minecraft Bedrock server did not answer its status check.")));
    socket.on("message",(bytes,remote)=>{if(done||remote.address!==destination.ip||remote.port!==destination.port)return;try{if(bytes.length>4096)throw error("Oversized Bedrock response.");finish(null,parseBedrockPong(bytes,nonce));}catch(e){finish(e);}});
    signal?.addEventListener("abort",aborted,{once:true});if(signal?.aborted){aborted();return;}
    socket.send(Buffer.concat([Buffer.from([1]),nonce,MAGIC,randomBytes(8)]),destination.port,destination.ip,e=>{if(e)finish(error("The Minecraft Bedrock status check failed."));});
  });
}
export async function fetchMinecraftServer(value,{edition="java",destinationImpl=minecraftDestination,javaImpl=javaStatus,bedrockImpl=bedrockStatus,connectImpl,createSocketImpl,signal}={}){
  signal?.throwIfAborted();
  const input=parseMinecraftAddress(value,edition);const destination=await destinationImpl(input,{signal});
  signal?.throwIfAborted();
  const result=await(edition==="java"?javaImpl(input,destination,{connectImpl,signal}):bedrockImpl(input,destination,{createSocketImpl,signal}));
  signal?.throwIfAborted();
  return normalizeMinecraftStatus(result,input);
}
