import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { deflateSync, inflateSync } from 'node:zlib';
import { persistServerImage, staticServerPng } from '../lib/server-media.js';

const signature = Buffer.from([137,80,78,71,13,10,26,10]);
function crc(bytes) { let value=0xffffffff; for(const byte of bytes) { value^=byte; for(let bit=0;bit<8;bit++) value=(value>>>1)^((value&1)?0xedb88320:0); } return (value^0xffffffff)>>>0; }
function chunk(type,data=Buffer.alloc(0)) { const out=Buffer.alloc(data.length+12);out.writeUInt32BE(data.length);out.write(type,4);data.copy(out,8);out.writeUInt32BE(crc(out.subarray(4,-4)),out.length-4);return out; }
const header=Buffer.alloc(13);header.writeUInt32BE(1);header.writeUInt32BE(1,4);header[8]=8;header[9]=6;
const pixels=Buffer.from([0,255,32,64,255]);
const compressed=deflateSync(pixels);
const ihdr=chunk('IHDR',header),text=chunk('tEXt',Buffer.from('Comment\0Original community artwork')),idat=chunk('IDAT',compressed),end=chunk('IEND');
const original=Buffer.concat([signature,ihdr,text,idat,end]);
function control(sequence,changes={}) { const b=Buffer.alloc(26);b.writeUInt32BE(sequence);b.writeUInt32BE(changes.width??1,4);b.writeUInt32BE(changes.height??1,8);b.writeUInt32BE(changes.x??0,12);b.writeUInt32BE(changes.y??0,16);b.writeUInt16BE(1,20);b.writeUInt16BE(10,22);return chunk('fcTL',b); }
function animation({poster=false,firstControl=control(0),image=idat}={}) { const ac=Buffer.alloc(8);ac.writeUInt32BE(poster?1:2);const later=Buffer.concat([Buffer.from([0,0,0,poster?1:2]),deflateSync(Buffer.from([0,0,255,0,255]))]);return Buffer.concat([signature,ihdr,text,chunk('acTL',ac),...poster?[]:[firstControl],image,control(poster?0:1),chunk('fdAT',later),end]); }
function chunks(bytes) { const out=[];for(let pos=8;pos<bytes.length;){const size=bytes.readUInt32BE(pos);out.push({type:bytes.toString('ascii',pos+4,pos+8),bytes:bytes.subarray(pos,pos+size+12),data:bytes.subarray(pos+8,pos+8+size)});pos+=size+12;}return out; }

test('APNG storage keeps the original static image bytes and every retained chunk CRC',()=>{
 const input=animation(),copy=Buffer.from(input),result=staticServerPng(input);
 assert.deepEqual(result,original);assert.deepEqual(input,copy);
 assert.deepEqual(chunks(result).map(c=>c.type),['IHDR','tEXt','IDAT','IEND']);
 assert.deepEqual(inflateSync(Buffer.concat(chunks(result).filter(c=>c.type==='IDAT').map(c=>c.data))),pixels);
 for(const c of chunks(result))assert.equal(c.bytes.readUInt32BE(c.bytes.length-4),crc(c.bytes.subarray(4,-4)));
 assert.equal(staticServerPng(original),original);
});

test('a standalone default poster and split IDAT stream are retained without borrowing animation frame data',()=>{
 assert.deepEqual(staticServerPng(animation({poster:true})),original);
 const split=Buffer.concat([chunk('IDAT',compressed.subarray(0,4)),chunk('IDAT',compressed.subarray(4))]);
 const result=staticServerPng(animation({image:split}));
 assert.deepEqual(chunks(result).filter(c=>c.type==='IDAT').map(c=>c.bytes),chunks(Buffer.concat([signature,split])).map(c=>c.bytes));
 assert.deepEqual(inflateSync(Buffer.concat(chunks(result).filter(c=>c.type==='IDAT').map(c=>c.data))),pixels);
});

test('malformed PNG structures fail rather than inventing a still image',()=>{
 const damagedCRC=Buffer.from(animation());damagedCRC[45]^=1;
 const tooLong=Buffer.from(animation());tooLong.writeUInt32BE(0xffffffff,33);
 const noEnd=animation().subarray(0,-12);
 const badSequence=animation().map((v)=>v);const seqChunk=chunks(badSequence).find(c=>c.type==='fdAT');const changed=Buffer.from(seqChunk.data);changed.writeUInt32BE(8);const wrongOrder=Buffer.concat(chunks(badSequence).map(c=>c.type==='fdAT'?chunk('fdAT',changed):c.bytes));
 for(const bytes of [damagedCRC,tooLong,noEnd,Buffer.concat([animation(),Buffer.from([0])]),animation({image:Buffer.alloc(0)}),animation({image:chunk('IDAT')}),animation({firstControl:control(0,{x:1})}),Buffer.concat([signature,wrongOrder]),Buffer.alloc(2*1024*1024+1)])assert.throws(()=>staticServerPng(bytes),{status:422});
 const nonconsecutive=Buffer.concat([signature,ihdr,chunk('IDAT',compressed.subarray(0,4)),text,chunk('IDAT',compressed.subarray(4)),end]);assert.throws(()=>staticServerPng(nonconsecutive),{status:422});
});

test('persistence uploads and hashes the static bytes while GIF bytes keep existing behavior',async()=>{
 const prior={SUPABASE_URL:process.env.SUPABASE_URL,SUPABASE_SECRET_KEY:process.env.SUPABASE_SECRET_KEY};const previousFetch=globalThis.fetch;
 Object.assign(process.env,{SUPABASE_URL:'https://fixture.supabase.co',SUPABASE_SECRET_KEY:'sb_secret_fixture'});
 const uploads=[];let source=animation();
 globalThis.fetch=async(url,options={})=>{if(String(url).startsWith('https://frontend.cfx-services.net/'))return new Response(source);uploads.push({url:String(url),bytes:options.body,type:options.headers['Content-Type']});return new Response('{}',{headers:{'content-type':'application/json'}});};
 try{
  const url=await persistServerImage('https://frontend.cfx-services.net/api/servers/icon/abc123/42.png','abc123');
  const hash=createHash('sha256').update(original).digest('hex');assert.equal(url,`https://fixture.supabase.co/storage/v1/object/public/server-media/abc123/${hash}.png`);assert.deepEqual(uploads[0].bytes,original);assert.equal(uploads[0].type,'image/png');
  source=Buffer.alloc(30);source.write('GIF89a');source.writeUInt16LE(1,6);source.writeUInt16LE(1,8);
  await persistServerImage('https://frontend.cfx-services.net/api/servers/icon/abc123/43.png','abc123');assert.deepEqual(uploads[1].bytes,source);assert.equal(uploads[1].type,'image/gif');
 }finally{globalThis.fetch=previousFetch;for(const[k,v]of Object.entries(prior))v===undefined?delete process.env[k]:process.env[k]=v;}
});
