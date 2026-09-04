import { createHash } from "node:crypto";
import { safeFiveMImageUrl } from "./fivem-import.js";
import { supabaseConfig } from "./config.js";
import { uploadStorageObject } from "./supabase.js";

const MAX_BYTES = 2 * 1024 * 1024;
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const PNG_CRC_TABLE = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0);
  return value >>> 0;
});
function pngCrc(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) value = (value >>> 8) ^ PNG_CRC_TABLE[(value ^ byte) & 255];
  return (value ^ 0xffffffff) >>> 0;
}

// APNG always carries an ordinary PNG default image in IDAT. Preserve that
// compressed image and its original chunks/CRCs; do not composite later frames.
export function staticServerPng(bytes) {
  const invalid = () => { throw Object.assign(new Error("The PNG has invalid image data. Replace it with a valid static image."), { status: 422 }); };
  if (!Buffer.isBuffer(bytes) || bytes.length > MAX_BYTES || !bytes.subarray(0, 8).equals(PNG_SIGNATURE) || rasterType(bytes)?.extension !== "png") invalid();
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
  const bitDepth = bytes[24], colorType = bytes[25];
  if (!({ 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] }[colorType]?.includes(bitDepth)) || bytes[26] !== 0 || bytes[27] !== 0 || bytes[28] > 1) invalid();
  const kept = [bytes.subarray(0, 8)];
  let offset = 8, seenIdat = false, endedIdat = false, imageBytes = 0, seenEnd = false, palette = false;
  let animationFrames = null, frameCount = 0, sequence = 0, frame = null, animation = false;
  while (offset < bytes.length) {
    if (bytes.length - offset < 12) invalid();
    const length = bytes.readUInt32BE(offset), end = offset + length + 12;
    if (length > MAX_BYTES || end > bytes.length) invalid();
    const type = bytes.toString("latin1", offset + 4, offset + 8), data = bytes.subarray(offset + 8, end - 4);
    if (!/^[A-Za-z]{2}[A-Z][A-Za-z]$/.test(type) || pngCrc(bytes.subarray(offset + 4, end - 4)) !== bytes.readUInt32BE(end - 4)) invalid();
    if (offset === 8 ? type !== "IHDR" || length !== 13 : type === "IHDR") invalid();
    if (/^[A-Z]/.test(type) && !["IHDR", "PLTE", "IDAT", "IEND"].includes(type)) invalid();
    if (seenIdat && type !== "IDAT") endedIdat = true;
    if (type === "PLTE") {
      if (palette || seenIdat || !length || length > 768 || length % 3 || [0, 4].includes(colorType)) invalid();
      palette = true;
    } else if (type === "IDAT") {
      if (endedIdat || colorType === 3 && !palette) invalid();
      seenIdat = true; imageBytes += length;
      if (frame?.usesIdat) frame.bytes += length;
    } else if (type === "acTL") {
      if (animationFrames !== null || seenIdat || length !== 8 || !data.readUInt32BE(0)) invalid();
      animationFrames = data.readUInt32BE(0); animation = true;
    } else if (type === "fcTL") {
      if (length !== 26 || data.readUInt32BE(0) !== sequence++ || frame && !frame.bytes) invalid();
      const frameWidth = data.readUInt32BE(4), frameHeight = data.readUInt32BE(8), x = data.readUInt32BE(12), y = data.readUInt32BE(16);
      if (!frameWidth || !frameHeight || x + frameWidth > width || y + frameHeight > height || data[24] > 2 || data[25] > 1) invalid();
      if (!seenIdat && (frameWidth !== width || frameHeight !== height || x || y)) invalid();
      frame = { usesIdat: !seenIdat, bytes: 0 }; frameCount++; animation = true;
    } else if (type === "fdAT") {
      if (length < 4 || !seenIdat || !frame || frame.usesIdat || data.readUInt32BE(0) !== sequence++) invalid();
      frame.bytes += length - 4; animation = true;
    } else if (type === "IEND") {
      if (length !== 0 || end !== bytes.length || !seenIdat || !imageBytes) invalid();
      seenEnd = true;
    }
    if (!["acTL", "fcTL", "fdAT"].includes(type)) kept.push(bytes.subarray(offset, end));
    offset = end;
  }
  if (!seenEnd || animation && (animationFrames === null || frameCount !== animationFrames || !frame?.bytes)) invalid();
  return animation ? Buffer.concat(kept) : bytes;
}

export function storedServerImage(value) {
  const prefix = `${supabaseConfig().url}/storage/v1/object/public/server-media/`;
  return typeof value === "string" && prefix.startsWith("https://") && value.startsWith(prefix) && /^[a-z0-9]{6,12}\/[a-f0-9]{16,64}\.(png|jpg|jpeg|webp|gif)$/.test(value.slice(prefix.length));
}
export function rasterType(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 24) return null;
  const dimensionsAllowed = (width, height) => width > 0 && height > 0 && width * height <= 40_000_000;
  if (bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    if (bytes.length < 33 || bytes.readUInt32BE(8) !== 13 || bytes.toString("ascii", 12, 16) !== "IHDR") return null;
    return dimensionsAllowed(bytes.readUInt32BE(16), bytes.readUInt32BE(20)) ? { extension: "png", type: "image/png" } : null;
  }
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) {
    // Read the frame dimensions without decoding the compressed image.
    let offset = 2;
    while (offset + 4 <= bytes.length && bytes[offset] === 255) {
      while (bytes[offset] === 255) offset += 1;
      const marker = bytes[offset++];
      if (marker === 0xda || marker === 0xd9) return null;
      if (marker === 0x01 || marker >= 0xd0 && marker <= 0xd8) continue;
      if (offset + 2 > bytes.length) return null;
      const length = bytes.readUInt16BE(offset);
      if (length < 2 || offset + length > bytes.length) return null;
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
        return length >= 8 && dimensionsAllowed(bytes.readUInt16BE(offset + 5), bytes.readUInt16BE(offset + 3)) ? { extension: "jpg", type: "image/jpeg" } : null;
      }
      offset += length;
    }
    return null;
  }
  if (["GIF87a", "GIF89a"].includes(bytes.toString("ascii", 0, 6))) {
    return dimensionsAllowed(bytes.readUInt16LE(6), bytes.readUInt16LE(8)) ? { extension: "gif", type: "image/gif" } : null;
  }
  if (bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") {
    if (bytes.readUInt32LE(4) + 8 !== bytes.length || bytes.readUInt32LE(16) + 20 > bytes.length) return null;
    const format = bytes.toString("ascii", 12, 16); let width = 0, height = 0;
    if (format === "VP8X" && bytes.length >= 30) {
      width = bytes.readUIntLE(24, 3) + 1; height = bytes.readUIntLE(27, 3) + 1;
    } else if (format === "VP8L" && bytes.length >= 25 && bytes[20] === 0x2f) {
      const dimensions = bytes.readUInt32LE(21);
      width = (dimensions & 0x3fff) + 1; height = ((dimensions >>> 14) & 0x3fff) + 1;
    } else if (format === "VP8 " && bytes.length >= 30 && bytes.subarray(23, 26).equals(Buffer.from([0x9d, 0x01, 0x2a]))) {
      width = bytes.readUInt16LE(26) & 0x3fff; height = bytes.readUInt16LE(28) & 0x3fff;
    }
    return dimensionsAllowed(width, height) ? { extension: "webp", type: "image/webp" } : null;
  }
  return null;
}
export async function fetchServerImage(value, { fetchImpl = fetch } = {}) {
  const url = storedServerImage(value) ? value : safeFiveMImageUrl(value);
  if (!url) throw Object.assign(new Error("Use a supported HTTPS server image."), { status: 400 });
  let response;
  try { response = await fetchImpl(url, { redirect: "error", signal: AbortSignal.timeout(5000), headers: { Accept: "image/png,image/jpeg,image/webp,image/gif" } }); }
  catch { throw Object.assign(new Error("The server image could not be reached. Replace it or clear the image field."), { status: 422 }); }
  if (!response.ok || Number(response.headers.get("content-length")) > MAX_BYTES) { await response.body?.cancel(); throw Object.assign(new Error("The server image is unavailable or larger than 2 MB."), { status: 422 }); }
  if (!response.body) throw Object.assign(new Error("The server image was empty."), { status: 422 });
  const chunks = []; let length = 0;
  for await (const chunk of response.body) { length += chunk.length; if (length > MAX_BYTES) throw Object.assign(new Error("Choose a server image under 2 MB."), { status: 422 }); chunks.push(chunk); }
  const bytes = Buffer.concat(chunks); const format = rasterType(bytes);
  if (createHash("sha256").update(bytes).digest("hex") === "faa24ec881e6040655c187a681d6dc496eb8aa41e1bd0652a180b3a40b457187") throw Object.assign(new Error("The image host returned an unavailable-image placeholder. Replace it or clear the image field."), { status: 422 });
  if (!format) throw Object.assign(new Error("The link did not return a supported image. Use PNG, JPEG, WebP or GIF."), { status: 422 });
  return { bytes, ...format };
}
export async function persistServerImage(value, joinCode) {
  if (!value) return null;
  if (storedServerImage(value)) return value;
  const image = await fetchServerImage(value);
  const bytes = image.extension === "png" ? staticServerPng(image.bytes) : image.bytes;
  const digest = createHash("sha256").update(bytes).digest("hex");
  const path = `${joinCode}/${digest}.${image.extension}`;
  try { await uploadStorageObject("server-media", path, bytes, image.type); }
  catch (error) { if (Number(error.status) !== 409) throw error; }
  return `${supabaseConfig().url}/storage/v1/object/public/server-media/${path}`;
}
