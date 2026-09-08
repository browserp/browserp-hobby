import { createHash } from "node:crypto";
import { supabaseConfig } from "./config.js";
import { rpc } from "./supabase.js";

export const FILE_EXPORT_CHUNK_BYTES = 524_288;
const MAX_FILE_BYTES = 10_485_760;
const BUCKETS = new Set(["profile-media", "server-media", "uploads-quarantine", "advertisements"]);
const unavailable = () => Object.assign(new Error("This file could not be verified. Try again, or ask staff to check your copy request."), { status: 503 });
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const IDENTITY = ["id", "assetId", "bucket", "objectPath", "filename", "byteSize", "sha256"];
const sameChunks = (a, b) => Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((value, index) => value === b[index]);

function checkedFile(file) {
  if (!file || typeof file.assetId !== "string" || !file.assetId || !BUCKETS.has(file.bucket) || typeof file.objectPath !== "string"
    || !/^[a-zA-Z0-9_./-]+$/.test(file.objectPath) || file.objectPath.startsWith("/") || file.objectPath.includes("..")
    || !/^[a-zA-Z0-9_-]+\.(?:png|jpg|webp|bin)$/.test(file.filename || "")
    || !/^[a-f0-9]{64}$/.test(file.sha256 || "") || !Number.isSafeInteger(file.byteSize)
    || file.byteSize < 1 || file.byteSize > MAX_FILE_BYTES
    || (file.chunkSha256 != null && (!Array.isArray(file.chunkSha256)
      || file.chunkSha256.length !== Math.ceil(file.byteSize / FILE_EXPORT_CHUNK_BYTES)
      || file.chunkSha256.some(value => typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value))))) throw unavailable();
  return file;
}

async function verifiedFileChunks(response, file, offset, end) {
  const stated = response.headers.get("content-length");
  if (stated && (!/^\d+$/.test(stated) || Number(stated) !== file.byteSize)) { await response.body?.cancel(); throw unavailable(); }
  if (!response.body) throw unavailable();
  // Hash the entire bounded object, retaining only the requested response chunk.
  // A newly calculated chunk hash cannot establish its approved-file provenance.
  const reader = response.body.getReader(), hash = createHash("sha256"), chunk = Buffer.alloc(end - offset + 1); let size = 0;
  const chunks = Array.from({ length: Math.ceil(file.byteSize / FILE_EXPORT_CHUNK_BYTES) }, () => createHash("sha256"));
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const start = size;
      size += value.byteLength;
      if (size > file.byteSize) { await reader.cancel(); throw unavailable(); }
      hash.update(value);
      for (let consumed = 0; consumed < value.byteLength;) {
        const absolute = start + consumed, index = Math.floor(absolute / FILE_EXPORT_CHUNK_BYTES);
        const length = Math.min(value.byteLength - consumed, (index + 1) * FILE_EXPORT_CHUNK_BYTES - absolute);
        chunks[index].update(value.subarray(consumed, consumed + length));
        consumed += length;
      }
      const from = Math.max(start, offset), to = Math.min(size, end + 1);
      if (from < to) chunk.set(value.subarray(from - start, to - start), from - offset);
    }
  } finally { reader.releaseLock(); }
  if (size !== file.byteSize || hash.digest("hex") !== file.sha256) throw unavailable();
  const chunkSha256 = chunks.map(value => value.digest("hex"));
  if (file.chunkSha256 != null && !sameChunks(file.chunkSha256, chunkSha256)) throw unavailable();
  return { bytes: chunk, chunkSha256 };
}

async function verifiedRange(response, length, sha256) {
  const stated = response.headers.get("content-length");
  if (stated && (!/^\d+$/.test(stated) || Number(stated) !== length)) { await response.body?.cancel(); throw unavailable(); }
  if (!response.body) throw unavailable();
  const reader = response.body.getReader(), bytes = Buffer.alloc(length); let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (size + value.byteLength > length) { await reader.cancel(); throw unavailable(); }
      bytes.set(value, size); size += value.byteLength;
    }
  } finally { reader.releaseLock(); }
  if (size !== length || digest(bytes) !== sha256) throw unavailable();
  return bytes;
}

// Bounded chunks stay below the function response limit. Every chunk is bound
// to the recent member session and approved immutable copy, before and after I/O.
// No signed/public URL or storage credential is returned to the browser.
export async function readMemberFileChunk({ exportId, fileId, offset }, accessToken, deps = {}) {
  const call = deps.rpc || rpc, fetchImpl = deps.fetch || fetch;
  if (!Number.isSafeInteger(offset) || offset < 0 || offset % FILE_EXPORT_CHUNK_BYTES !== 0) {
    throw Object.assign(new Error("Restart the file download."), { status: 400 });
  }
  const values = { p_id: exportId, p_file_id: fileId };
  const file = checkedFile(await call("member_read_data_export_file", values, accessToken));
  if (file.id !== fileId) throw unavailable();
  if (offset >= file.byteSize) throw Object.assign(new Error("Restart the file download."), { status: 400 });
  const end = Math.min(offset + FILE_EXPORT_CHUNK_BYTES, file.byteSize) - 1;
  const config = (deps.config || supabaseConfig)();
  if (!config.url || !config.secretKey) throw unavailable();
  // The first read establishes trusted chunk digests against the approved whole
  // file. Later reads verify only the requested range; no private-byte cache.
  const prepared = file.chunkSha256 != null;
  const rangeStart = prepared ? offset : 0, rangeEnd = prepared ? end : file.byteSize - 1;
  const headers = { apikey: config.secretKey, Range: `bytes=${rangeStart}-${rangeEnd}`, "Accept-Encoding": "identity" };
  if (config.secretKey.split(".").length === 3) headers.Authorization = `Bearer ${config.secretKey}`;
  let response, bytes, chunkSha256 = file.chunkSha256;
  try {
    response = await fetchImpl(`${config.url}/storage/v1/object/authenticated/${encodeURIComponent(file.bucket)}/${file.objectPath.split("/").map(encodeURIComponent).join("/")}`, {
      headers, redirect: "error", signal: AbortSignal.timeout(12_000)
    });
    if (response.status === 206) {
      if (response.headers.get("content-range") !== `bytes ${rangeStart}-${rangeEnd}/${file.byteSize}`) { await response.body?.cancel(); throw unavailable(); }
    } else if (response.status !== 200) { await response.body?.cancel(); throw unavailable(); }
    if (prepared && response.status === 206) bytes = await verifiedRange(response, end - offset + 1, chunkSha256[offset / FILE_EXPORT_CHUNK_BYTES]);
    else ({ bytes, chunkSha256 } = await verifiedFileChunks(response, file, offset, end));
  } catch { throw unavailable(); }
  let current = checkedFile(await call("member_read_data_export_file", values, accessToken));
  if (IDENTITY.some(key => current[key] !== file[key])
    || (current.chunkSha256 != null && !sameChunks(current.chunkSha256, chunkSha256))
    || (prepared && current.chunkSha256 == null)) throw unavailable();
  if (current.chunkSha256 == null) {
    // Only verified server-generated hashes cross this privileged boundary.
    const stored = await call("service_prepare_data_export_file_chunks", { ...values,
      p_asset_id: file.assetId, p_bucket: file.bucket, p_object_path: file.objectPath,
      p_byte_size: file.byteSize, p_sha256: file.sha256, p_chunk_sha256: chunkSha256
    }, undefined, { useSecret: true });
    if (stored !== true) throw unavailable();
    current = checkedFile(await call("member_read_data_export_file", values, accessToken));
    if (IDENTITY.some(key => current[key] !== file[key]) || !sameChunks(current.chunkSha256, chunkSha256)) throw unavailable();
  }
  return { fileId, offset, nextOffset: end + 1 < file.byteSize ? end + 1 : null,
    byteSize: file.byteSize, sha256: file.sha256, chunkSha256: digest(bytes), content: bytes.toString("base64") };
}
