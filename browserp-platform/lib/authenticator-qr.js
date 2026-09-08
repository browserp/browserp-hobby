const MAX_QR_BYTES = 200_000;

// Auth's SVGo renderer prefixes its SVG with an XML declaration and a comment.
// Render only an SVG image data URI; never insert provider markup into the DOM.
export function qrCodeDataUri(value) {
  if (typeof value !== "string" || Buffer.byteLength(value, "utf8") > MAX_QR_BYTES) return null;
  const source = value.trim();
  if (/^data:image\/svg\+xml(?:;base64)?,/i.test(source)) return source;
  const svg = source
    .replace(/^<\?xml\s[^?]*\?>\s*/i, "")
    .replace(/^(?:<!--[\s\S]*?-->\s*)+/, "");
  if (!/^<svg[\s>]/i.test(svg)) return null;
  return `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`;
}
