import { BlockList, isIP, SocketAddress } from "node:net";
import { env } from "./config.js";

// Official Cloudflare edge CIDRs, checked 2026-09-04 against
// https://api.cloudflare.com/client/v4/ips (etag 38f79d050aa027e3be3865e495dcc9bc).
// Keep this reviewed snapshot local: request identity must never depend on a
// network lookup or a caller-provided list of trusted proxies.
const cloudflareEdges = new BlockList();
for (const cidr of [
  "173.245.48.0/20", "103.21.244.0/22", "103.22.200.0/22", "103.31.4.0/22",
  "141.101.64.0/18", "108.162.192.0/18", "190.93.240.0/20", "188.114.96.0/20",
  "197.234.240.0/22", "198.41.128.0/17", "162.158.0.0/15", "104.16.0.0/13",
  "104.24.0.0/14", "172.64.0.0/13", "131.0.72.0/22",
  "2400:cb00::/32", "2606:4700::/32", "2803:f800::/32", "2405:b500::/32",
  "2405:8100::/32", "2a06:98c0::/29", "2c0f:f248::/32"
]) {
  const [network, prefix] = cidr.split("/");
  cloudflareEdges.addSubnet(network, Number(prefix), isIP(network) === 6 ? "ipv6" : "ipv4");
}

function canonicalAddress(value) {
  // Reject duplicate/list headers, scoped interface names and oversized inputs.
  if (typeof value !== "string" || value.length > 64 || value.includes("%")) return null;
  const candidate = value.trim();
  const version = isIP(candidate);
  if (version === 4) return candidate;
  if (version !== 6) return null;
  const normalized = new SocketAddress({ address: candidate, family: "ipv6" }).address;
  const mapped = normalized.startsWith("::ffff:") ? normalized.slice(7) : "";
  return isIP(mapped) === 4 ? mapped : normalized;
}

export function requestAddress(req) {
  const socketPeer = canonicalAddress(req.socket?.remoteAddress);
  // Only Vercel's runtime can establish that this platform header is trusted.
  // Local or other deployments use the actual socket peer, regardless of flags.
  if (process.env.VERCEL !== "1") return socketPeer || "unknown";
  const ingress = canonicalAddress(req.headers?.["x-vercel-forwarded-for"]);
  if (!ingress) return socketPeer || "unknown";

  const forwardedHost = String(req.headers?.["x-forwarded-host"] || req.headers?.host || "")
    .split(",")[0].trim().toLowerCase().replace(/:\d+$/, "");
  const cloudflareRay = String(req.headers?.["cf-ray"] || "").trim();
  if (env("CLOUDFLARE_PROXY_ENABLED") === "1"
    && ["browserp.com", "www.browserp.com"].includes(forwardedHost)
    && /^[a-f0-9]{16,32}(?:-[a-z]{3})?$/i.test(cloudflareRay)
    && cloudflareEdges.check(ingress, isIP(ingress) === 6 ? "ipv6" : "ipv4")) {
    const client = canonicalAddress(req.headers?.["cf-connecting-ip"]);
    if (client) return client;
  }
  // Verified Proxy Lite can already replace the Cloudflare edge with the real
  // visitor in this authoritative header. Host/CF-Ray alone prove nothing.
  return ingress;
}
