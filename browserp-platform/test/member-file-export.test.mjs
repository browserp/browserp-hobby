import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readMemberFileChunk, FILE_EXPORT_CHUNK_BYTES as chunkSize } from "../lib/member-file-export.js";
const hash = value => createHash("sha256").update(value).digest("hex");
const bytes = Buffer.alloc(chunkSize + 17, 37);
const file = { id: "file", bucket: "profile-media", objectPath: "member/avatar.png", filename: "avatar-fixture.png", byteSize: bytes.length, sha256: hash(bytes) };
function fixture({ rpc, fetch } = {}) {
  const requests = [], calls = [];
  return { requests, calls, deps: { config: () => ({ url: "https://storage.example.test", secretKey: "private-secret" }),
    rpc: async (...args) => { calls.push(args); return rpc ? rpc(...args) : file; },
    fetch: async (url, options) => { requests.push({ url, options }); if (fetch) return fetch(url, options);
      const [, start, end] = options.headers.Range.match(/bytes=(\d+)-(\d+)/).map(Number);
      return new Response(bytes.subarray(start, end + 1), { status: 206, headers: { "Content-Range": `bytes ${start}-${end}/${bytes.length}` } });
    } } };
}
const read = (h, offset = 0) => readMemberFileChunk({ exportId: "copy", fileId: "file", offset }, "member-token", h.deps);

test("file chunks use the approved private object and check current authorization again before release", async () => {
  const h = fixture(), first = await read(h), last = await read(h, chunkSize);
  assert.equal(first.nextOffset, chunkSize); assert.equal(last.nextOffset, null);
  assert.deepEqual(Buffer.concat([Buffer.from(first.content, "base64"), Buffer.from(last.content, "base64")]), bytes);
  assert.equal(hash(Buffer.from(first.content, "base64")), first.chunkSha256);
  assert.equal(h.calls.length, 4); assert.ok(h.calls.every(c => c[2] === "member-token"));
  assert.ok(h.requests.every(r => r.options.redirect === "error" && r.options.headers.apikey === "private-secret"));
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
  for (const bad of [{ ...file, objectPath: "../other/private.png" }, { ...file, bucket: "private-evidence" }, { ...file, byteSize: 10485761 }, { ...file, filename: "unsafe.html" }]) {
    const h = fixture({ rpc: async () => bad }); await assert.rejects(read(h)); assert.equal(h.requests.length, 0);
  }
  const h = fixture(); for (const offset of [-1, 1, bytes.length, Infinity]) await assert.rejects(read(h, offset));
  assert.equal(h.requests.length, 0);
  const denied = fixture({ rpc: async () => { throw new Error("Copy not found"); } }); await assert.rejects(read(denied)); assert.equal(denied.requests.length, 0);
});
test("partial ranges, oversized bodies and provider failures fail closed without provider error leakage", async () => {
  for (const response of [new Response("secret provider body", { status: 403 }), new Response("retry", { status: 429 }),
    new Response("short", { status: 206, headers: { "Content-Range": `bytes 0-${chunkSize - 1}/${bytes.length}` } }),
    new Response(Buffer.alloc(chunkSize + 1), { status: 206, headers: { "Content-Range": `bytes 0-${chunkSize - 1}/${bytes.length}` } }),
    new Response("wrong", { status: 206, headers: { "Content-Range": "bytes 9-13/14" } })]) {
    const h = fixture({ fetch: async () => response }); await assert.rejects(read(h), error => error.status === 503 && !/secret|retry/.test(error.message));
  }
});
test("gateways without Range work only when full-file length and SHA match", async () => {
  const h = fixture({ fetch: async () => new Response(bytes) }); assert.equal((await read(h, chunkSize)).content, bytes.subarray(chunkSize).toString("base64"));
  const broken = fixture({ fetch: async () => new Response(Buffer.alloc(bytes.length, 0)) }); await assert.rejects(read(broken));
});
