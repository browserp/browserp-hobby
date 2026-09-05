import test from "node:test";
import assert from "node:assert/strict";
import { deflateSync } from "node:zlib";
import { advertImage, cleanupAdvertMedia, staffAdvertMedia } from "../lib/staff-advert-media.js";

function chunk(type, data) {
  const result = Buffer.alloc(data.length + 12); result.writeUInt32BE(data.length); result.write(type, 4); data.copy(result, 8);
  let crc = 0xffffffff;
  for (const byte of result.subarray(4, -4)) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
  result.writeUInt32BE((crc ^ 0xffffffff) >>> 0, result.length - 4); return result;
}
function png(width = 320, height = 180, raw = Buffer.alloc(height * (width * 4 + 1)), extra = []) {
  const header = Buffer.alloc(13); header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk("IHDR", header), ...extra, chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
const dataUrl = bytes => `data:image/png;base64,${bytes.toString("base64")}`;
const userId = "00000000-0000-4000-8000-000000000001", csrf = "c".repeat(43);
function request(body, headers = {}) { return { method: "POST", headers: { host: "localhost:8080", "content-type": "application/json", cookie: `brp_csrf=${csrf}`, "x-browserp-csrf": csrf, ...headers }, body }; }
function output() { return { setHeader() {}, end(value) { this.value = JSON.parse(value); } }; }
function deps(overrides = {}) {
  return { getSession: async () => ({ user: { id: userId }, accessToken: "fixture", aal: "aal2" }), rpc: async () => true, rateLimit: async () => {}, rest: async () => {}, upload: async () => {}, cleanup: async () => 1, ...overrides };
}

test("advert artwork validates actual pixels, strips metadata, and rejects corrupt or oversized rasters", () => {
  const input = png(320,180,undefined,[chunk("tEXt", Buffer.from("private\0discard me"))]);
  const parsed = advertImage(dataUrl(input)); assert.equal(parsed.width,320); assert.equal(parsed.height,180);
  assert.ok(!parsed.bytes.includes(Buffer.from("discard me"))); assert.ok(parsed.bytes.length < input.length);
  for (const invalid of [dataUrl(png(319)),dataUrl(png(1601)),dataUrl(png(320,180,Buffer.alloc(1_000_000))),dataUrl(png(320,180,Buffer.alloc(12))),"data:image/svg+xml;base64,PHN2Zy8+", "https://example.com/image.png", dataUrl(Buffer.from("not an image"))]) assert.throws(() => advertImage(invalid), {status:422});
  const broken = png(); broken[broken.length-1] ^= 1; assert.throws(() => advertImage(dataUrl(broken)), {status:422});
  const filters = Buffer.alloc(180*(320*4+1)); filters[0]=5; assert.throws(() => advertImage(dataUrl(png(320,180,filters))), {status:422});
});

test("artwork denies CSRF, missing MFA, revoked permission, and rate limits before storage writes", async () => {
  let writes=0; const storage = {rest:async()=>writes++,upload:async()=>writes++};
  await assert.rejects(staffAdvertMedia(request({}, {"x-browserp-csrf":"wrong"}),output(),"fixture",deps(storage)), {status:403});
  await assert.rejects(staffAdvertMedia(request({}),output(),"fixture",deps({...storage,getSession:async()=>({aal:"aal1"})})), {status:403});
  await assert.rejects(staffAdvertMedia(request({}),output(),"fixture",deps({...storage,rpc:async()=>false})), {status:403});
  await assert.rejects(staffAdvertMedia(request({}),output(),"fixture",deps({...storage,rateLimit:async()=>{throw Object.assign(new Error("Limited"),{status:429});}})), {status:429});
  assert.equal(writes,0);
});

test("artwork records its server-owned path before upload and returns only the registered image", async () => {
  const events=[]; const res=output();
  await staffAdvertMedia(request({action:"upload",imageData:dataUrl(png()),objectPath:"attacker.svg",width:9999}),res,"fixture",deps({
    rest:async(path,options)=>events.push({path,options}),
    upload:async(bucket,path,bytes,type)=>events.push({bucket,path,bytes,type})
  }));
  assert.equal(events[0].path,"uploaded_assets"); assert.equal(events[0].options.body.moderation_status,"scanning");
  assert.match(events[1].path,new RegExp(`^staff/${userId}/[a-f0-9-]{36}\\.png$`)); assert.equal(events[1].type,"image/png");
  assert.equal(events[2].options.body.moderation_status,"approved"); assert.equal(res.value.asset.width,320); assert.equal(res.statusCode,201);
  assert.ok(!JSON.stringify(res.value).includes("fixture"));
});

test("failed uploads and permission changes keep cleanup registered and do not approve the image", async () => {
  for (const failure of ["upload","permission"]) {
    let lookups=0;const events=[];
    await assert.rejects(staffAdvertMedia(request({action:"upload",imageData:dataUrl(png())}),output(),"fixture",deps({
      rpc:async()=>++lookups===1||failure!=="permission",
      upload:async()=>{if(failure==="upload") throw Object.assign(new Error("storage rejected"), {status:422});},
      rest:async(path,options)=>events.push(options.body.moderation_status),
      cleanup:async({assetId,ownerId})=>{assert.ok(assetId);assert.equal(ownerId,userId);events.push("cleanup");}
    })));
    assert.deepEqual(events,["scanning","cleanup"]);
  }
});

test("a timed-out upload keeps its registration until cleanup can remove a late Storage write", async () => {
  let registered, completeProviderUpload, stored = false, immediateCleanup = false;
  await assert.rejects(staffAdvertMedia(request({action:"upload",imageData:dataUrl(png())}),output(),"fixture",deps({
    rest:async(path,options)=>{assert.equal(path,"uploaded_assets");registered=options.body;},
    upload:async()=>{completeProviderUpload=()=>{stored=true;};throw new DOMException("Storage response timed out","TimeoutError");},
    cleanup:async()=>{immediateCleanup=true;registered=null;}
  })), {name:"TimeoutError"});
  assert.equal(immediateCleanup,false);assert.equal(registered.moderation_status,"scanning");
  completeProviderUpload();assert.equal(stored,true);assert.ok(registered);
  const asset={id:registered.id,objectPath:registered.object_path};
  await cleanupAdvertMedia({
    rpcImpl:async name=>{if(name==="claim_advert_media_cleanup")return [asset];registered=null;return true;},
    removeImpl:async path=>{assert.equal(path,asset.objectPath);stored=false;}
  });
  assert.equal(stored,false);assert.equal(registered,null);
});

test("cleanup deletes Storage first and leaves retryable metadata when removal fails", async () => {
  const asset={id:"00000000-0000-4000-8000-000000000003",objectPath:`staff/${userId}/00000000-0000-4000-8000-000000000003.png`};
  const events=[];
  const rpcImpl=async name=>{events.push(name);return name==="claim_advert_media_cleanup"?[asset]:true;};
  await assert.rejects(cleanupAdvertMedia({rpcImpl,removeImpl:async()=>{events.push("storage");throw new Error("failed");}}));
  assert.deepEqual(events,["claim_advert_media_cleanup","storage"]);
  events.length=0; assert.equal(await cleanupAdvertMedia({rpcImpl,removeImpl:async()=>events.push("storage")}),1);
  assert.deepEqual(events,["claim_advert_media_cleanup","storage","complete_advert_media_cleanup"]);
});

test("cleanup shares the caller's deadline and leaves metadata intact if its budget ends after Storage removal", async () => {
  const controller=new AbortController();const events=[];
  const asset={id:"00000000-0000-4000-8000-000000000003",objectPath:`staff/${userId}/00000000-0000-4000-8000-000000000003.png`};
  const rpcImpl=async(name,body,token,options)=>{assert.equal(options.signal,controller.signal);events.push(name);return [asset];};
  await assert.rejects(cleanupAdvertMedia({signal:controller.signal,rpcImpl,removeImpl:async(path,{signal})=>{assert.equal(signal,controller.signal);assert.equal(path,asset.objectPath);events.push("storage");controller.abort();}}),{name:"AbortError"});
  assert.deepEqual(events,["claim_advert_media_cleanup","storage"]);
  const previous=events.length;await assert.rejects(cleanupAdvertMedia({signal:controller.signal,rpcImpl}),{name:"AbortError"});assert.equal(events.length,previous);
});
