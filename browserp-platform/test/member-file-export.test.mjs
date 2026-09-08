import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readMemberFileChunk, FILE_EXPORT_CHUNK_BYTES as chunkSize } from "../lib/member-file-export.js";
const hash = value => createHash("sha256").update(value).digest("hex");
const bytes = Buffer.alloc(chunkSize + 17, 37);
const chunkHashes = [hash(bytes.subarray(0, chunkSize)), hash(bytes.subarray(chunkSize))];
const file = { id: "file", assetId: "asset", bucket: "profile-media", objectPath: "member/avatar.png", filename: "avatar-fixture.png", byteSize: bytes.length, sha256: hash(bytes) };
function fixture({ rpc, fetch, prepared = false } = {}) {
  const requests = [], calls = [];
  let storedChunks = prepared ? chunkHashes : null;
  return { requests, calls, deps: { config: () => ({ url: "https://storage.example.test", secretKey: "private-secret" }),
    rpc: async (...args) => {
      calls.push(args);
      if (rpc) return rpc(...args);
      if (args[0] === "service_prepare_data_export_file_chunks") { storedChunks = args[1].p_chunk_sha256; return true; }
      return { ...file, chunkSha256: storedChunks };
    },
    fetch: async (url, options) => { requests.push({ url, options }); if (fetch) return fetch(url, options);
      const [, start, end] = options.headers.Range.match(/bytes=(\d+)-(\d+)/).map(Number);
      return new Response(bytes.subarray(start, end + 1), { status: 206, headers: { "Content-Range": `bytes ${start}-${end}/${bytes.length}` } });
    } } };
}
const read = (h, offset = 0) => readMemberFileChunk({ exportId: "copy", fileId: "file", offset }, "member-token", h.deps);

test("first read persists verified digests and the next read fetches only its authorized range", async () => {
  const h = fixture(), first = await read(h), last = await read(h, chunkSize);
  assert.equal(first.nextOffset, chunkSize); assert.equal(last.nextOffset, null);
  assert.deepEqual(Buffer.concat([Buffer.from(first.content, "base64"), Buffer.from(last.content, "base64")]), bytes);
  assert.equal(hash(Buffer.from(first.content, "base64")), first.chunkSha256);
  const reads = h.calls.filter(c => c[0] === "member_read_data_export_file"), writes = h.calls.filter(c => c[0] === "service_prepare_data_export_file_chunks");
  assert.equal(reads.length, 5); assert.ok(reads.every(c => c[2] === "member-token"));
  assert.equal(writes.length, 1); assert.equal(writes[0][2], undefined); assert.deepEqual(writes[0][3], { useSecret: true });
  assert.deepEqual(writes[0][1], { p_id: "copy", p_file_id: "file", p_asset_id: "asset", p_bucket: file.bucket,
    p_object_path: file.objectPath, p_byte_size: file.byteSize, p_sha256: file.sha256, p_chunk_sha256: chunkHashes });
  assert.ok(h.requests.every(r => r.options.redirect === "error" && r.options.headers.apikey === "private-secret"));
  assert.deepEqual(h.requests.map(r => r.options.headers.Range), [`bytes=0-${bytes.length - 1}`, `bytes=${chunkSize}-${bytes.length - 1}`]);
  assert.match(h.requests[0].url, /\/object\/authenticated\/profile-media\/member\/avatar.png$/);
  assert.doesNotMatch(JSON.stringify(first), /private-secret|objectPath|storage.example|member-token/);
});
test("revoked or changed approval during storage I/O releases no bytes", async () => {
  let calls = 0;
  const revoked = fixture({ rpc: async () => { if (++calls === 2) throw Object.assign(new Error("Session revoked"), { status: 401 }); return file; } });
  await assert.rejects(read(revoked), /Session revoked/);
  calls = 0; const changed = fixture({ rpc: async () => ++calls === 2 ? { ...file, sha256: "0".repeat(64) } : file });
  await assert.rejects(read(changed), /could not be verified/);
});
test("unapproved reads, path traversal, unsafe buckets and invalid offsets never reach storage", async () => {
  for (const bad of [{ ...file, objectPath: "../other/private.png" }, { ...file, bucket: "private-evidence" }, { ...file, byteSize: 10485761 }, { ...file, filename: "unsafe.html" },
    { ...file, chunkSha256: [null, chunkHashes[1]] }, { ...file, chunkSha256: [] }]) {
    const h = fixture({ rpc: async () => bad }); await assert.rejects(read(h)); assert.equal(h.requests.length, 0);
  }
  const h = fixture(); for (const offset of [-1, 1, bytes.length, Infinity]) await assert.rejects(read(h, offset));
  assert.equal(h.requests.length, 0);
  const denied = fixture({ rpc: async () => { throw new Error("Copy not found"); } }); await assert.rejects(read(denied)); assert.equal(denied.requests.length, 0);
});
test("partial ranges, oversized bodies and provider failures fail closed without provider error leakage", async () => {
  for (const response of [new Response("secret provider body", { status: 403 }), new Response("retry", { status: 429 }),
    new Response("short", { status: 206, headers: { "Content-Range": `bytes 0-${bytes.length - 1}/${bytes.length}` } }),
    new Response(Buffer.alloc(bytes.length + 1), { status: 206, headers: { "Content-Range": `bytes 0-${bytes.length - 1}/${bytes.length}` } }),
    new Response("wrong", { status: 206, headers: { "Content-Range": "bytes 9-13/14" } })]) {
    const h = fixture({ fetch: async () => response }); await assert.rejects(read(h), error => error.status === 503 && !/secret|retry/.test(error.message));
  }
});
test("gateways without Range work only when full-file length and SHA match", async () => {
  const h = fixture({ fetch: async () => new Response(bytes) }); assert.equal((await read(h, chunkSize)).content, bytes.subarray(chunkSize).toString("base64"));
  const broken = fixture({ fetch: async () => new Response(Buffer.alloc(bytes.length, 0)) }); await assert.rejects(read(broken));
});
test("same-length altered objects cannot release even an unchanged requested chunk", async () => {
  for (const [offset, alteredAt] of [[0, bytes.length - 1], [chunkSize, 0]]) {
    const altered = Buffer.from(bytes); altered[alteredAt] ^= 1;
    const h = fixture({ fetch: async (_url, options) => {
      const [, start, end] = options.headers.Range.match(/bytes=(\d+)-(\d+)/).map(Number);
      return new Response(altered.subarray(start, end + 1), {
        status: 206, headers: { "Content-Range": `bytes ${start}-${end}/${altered.length}` }
      });
    } });
    await assert.rejects(read(h, offset), error => error.status === 503 && /could not be verified/.test(error.message));
    assert.equal(h.calls.some(c => c[0] === "service_prepare_data_export_file_chunks"), false);
  }
});
test("prepared ranges must match a trusted digest before any bytes are released", async () => {
  for (const offset of [0, chunkSize]) {
    const h = fixture({ prepared: true, fetch: async (_url, options) => {
      const [, start, end] = options.headers.Range.match(/bytes=(\d+)-(\d+)/).map(Number);
      const altered = Buffer.from(bytes.subarray(start, end + 1)); altered[0] ^= 1;
      return new Response(altered, { status: 206, headers: { "Content-Range": `bytes ${start}-${end}/${bytes.length}` } });
    } });
    await assert.rejects(read(h, offset), /could not be verified/);
    assert.equal(h.calls.some(c => c[0] === "service_prepare_data_export_file_chunks"), false);
  }
});
test("revocation or a rebound manifest after digest persistence releases no file bytes", async () => {
  for (const failure of ["revoked", "rebound", "unprepared", "wrong-digests"]) {
    let saved = false;
    const h = fixture({ rpc: async name => {
      if (name === "service_prepare_data_export_file_chunks") { saved = true; return true; }
      if (!saved) return { ...file, chunkSha256: null };
      if (failure === "revoked") throw Object.assign(new Error("Session revoked"), { status: 401 });
      if (failure === "rebound") return { ...file, assetId: "another-asset", chunkSha256: chunkHashes };
      if (failure === "unprepared") return { ...file, chunkSha256: null };
      return { ...file, chunkSha256: ["0".repeat(64), chunkHashes[1]] };
    } });
    await assert.rejects(read(h), failure === "revoked" ? /Session revoked/ : /could not be verified/);
    assert.equal(saved, true);
  }
});
test("digest persistence failure and changed trusted digests fail closed", async () => {
  const failure = fixture({ rpc: async name => name === "service_prepare_data_export_file_chunks" ? false : { ...file, chunkSha256: null } });
  await assert.rejects(read(failure), /could not be verified/);
  let reads = 0;
  const changed = fixture({ rpc: async () => ({ ...file, chunkSha256: ++reads === 1 ? chunkHashes : ["0".repeat(64), chunkHashes[1]] }) });
  await assert.rejects(read(changed), /could not be verified/);
});
test("streamed whole-file verification preserves chunks across storage stream boundaries", async () => {
  const h = fixture({ fetch: async () => new Response(new ReadableStream({
    start(controller) {
      for (let start = 0; start < bytes.length; start += 7919) controller.enqueue(bytes.subarray(start, start + 7919));
      controller.close();
    }
  }), { headers: { "Content-Length": String(bytes.length) } }) });
  for (const offset of [0, chunkSize]) {
    const result = await read(h, offset);
    assert.deepEqual(Buffer.from(result.content, "base64"), bytes.subarray(offset, offset + chunkSize));
  }
});
