import { createHash } from "node:crypto";
import { supabaseConfig } from "./config.js";
import { rpc } from "./supabase.js";

export const FILE_EXPORT_CHUNK_BYTES = 524_288;
const MAX_FILE_BYTES = 10_485_760;
const BUCKETS = new Set(["profile-media", "server-media", "uploads-quarantine", "advertisements"]);
const unavailable = () => Object.assign(new Error("This file could not be verified. Try again, or ask staff to check your copy request."), { status: 503 });
const digest = bytes => createHash("sha256").update(bytes).digest("hex");

function checkedFile(file) {
  if (!file || !BUCKETS.has(file.bucket) || typeof file.objectPath !== "string"
    || !/^[a-zA-Z0-9_./-]+$/.test(file.objectPath) || file.objectPath.startsWith("/") || file.objectPath.includes("..")
    || !/^[a-zA-Z0-9_-]+\.(?:png|jpg|webp|bin)$/.test(file.filename || "")
    || !/^[a-f0-9]{64}$/.test(file.sha256 || "") || !Number.isSafeInteger(file.byteSize)
    || file.byteSize < 1 || file.byteSize > MAX_FILE_BYTES) throw unavailable();
  return file;
}

async function boundedBytes(response, limit) {
  const stated = response.headers.get("content-length");
  if (stated && (!/^\d+$/.test(stated) || Number(stated) > limit)) { await response.body?.cancel(); throw unavailable(); }
  if (!response.body) throw unavailable();
  const reader = response.body.getReader(), parts = []; let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) { await reader.cancel(); throw unavailable(); }
      parts.push(Buffer.from(value));
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(parts, size);
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
  if (offset >= file.byteSize) throw Object.assign(new Error("Restart the file download."), { status: 400 });
  const end = Math.min(offset + FILE_EXPORT_CHUNK_BYTES, file.byteSize) - 1;
  const config = (deps.config || supabaseConfig)();
  if (!config.url || !config.secretKey) throw unavailable();
  const headers = { apikey: config.secretKey, Range: `bytes=${offset}-${end}`, "Accept-Encoding": "identity" };
  if (config.secretKey.split(".").length === 3) headers.Authorization = `Bearer ${config.secretKey}`;
  let response, bytes;
  try {
    response = await fetchImpl(`${config.url}/storage/v1/object/authenticated/${encodeURIComponent(file.bucket)}/${file.objectPath.split("/").map(encodeURIComponent).join("/")}`, {
      headers, redirect: "error", signal: AbortSignal.timeout(12_000)
    });
    if (response.status === 206) {
      if (response.headers.get("content-range") !== `bytes ${offset}-${end}/${file.byteSize}`) { await response.body?.cancel(); throw unavailable(); }
      bytes = await boundedBytes(response, end - offset + 1);
      if (bytes.length !== end - offset + 1) throw unavailable();
    } else if (response.status === 200) {
      // Some compatible Storage gateways ignore Range. A bounded full response
      // is acceptable only after its entire length and SHA-256 match the copy.
      const whole = await boundedBytes(response, file.byteSize);
      if (whole.length !== file.byteSize || digest(whole) !== file.sha256) throw unavailable();
      bytes = whole.subarray(offset, end + 1);
    } else { await response.body?.cancel(); throw unavailable(); }
  } catch { throw unavailable(); }
  const current = checkedFile(await call("member_read_data_export_file", values, accessToken));
  if (["id", "bucket", "objectPath", "filename", "byteSize", "sha256"].some(key => current[key] !== file[key])) throw unavailable();
  return { fileId, offset, nextOffset: end + 1 < file.byteSize ? end + 1 : null,
    byteSize: file.byteSize, sha256: file.sha256, chunkSha256: digest(bytes), content: bytes.toString("base64") };
}
