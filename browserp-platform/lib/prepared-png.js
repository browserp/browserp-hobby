import { inflateSync } from "node:zlib";
import { staticServerPng } from "./server-media.js";

// Browser crop editors produce non-interlaced RGB/RGBA PNGs. Validate their
// compressed pixels within fixed dimensions before accepting them for storage.
export function preparedPngRaster(bytes, { minWidth, minHeight, maxWidth, maxHeight }) {
  const invalid = () => { throw Object.assign(new Error("The image could not be decoded. Choose another image and try again."), { status: 422 }); };
  let checked;
  try { checked = staticServerPng(bytes); } catch { invalid(); }
  const width = checked.readUInt32BE(16), height = checked.readUInt32BE(20);
  const channels = checked[25] === 2 ? 3 : checked[25] === 6 ? 4 : 0;
  if (width < minWidth || height < minHeight || width > maxWidth || height > maxHeight) {
    throw Object.assign(new Error(`Use an image at least ${minWidth} × ${minHeight} pixels and no larger than ${maxWidth} × ${maxHeight} pixels after preparation.`), { status: 422 });
  }
  if (checked[24] !== 8 || !channels || checked[28] !== 0) invalid();
  const chunks = [checked.subarray(0, 8)], compressed = [];
  for (let offset = 8; offset < checked.length;) {
    const size = checked.readUInt32BE(offset), end = offset + size + 12;
    const type = checked.toString("ascii", offset + 4, offset + 8);
    if (type === "IDAT") compressed.push(checked.subarray(offset + 8, end - 4));
    if (["IHDR", "IDAT", "IEND"].includes(type)) chunks.push(checked.subarray(offset, end));
    offset = end;
  }
  const packed = Buffer.concat(compressed), rowBytes = width * channels + 1, expected = height * rowBytes;
  try {
    const result = inflateSync(packed, { maxOutputLength: expected + 1, info: true });
    if (result.buffer.length !== expected || result.engine.bytesWritten !== packed.length) invalid();
    for (let offset = 0; offset < expected; offset += rowBytes) if (result.buffer[offset] > 4) invalid();
  } catch { invalid(); }
  return { bytes: Buffer.concat(chunks), width, height };
}
