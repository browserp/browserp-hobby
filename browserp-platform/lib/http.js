import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { env } from "./config.js";

export function requestId(req) {
  return String(req.headers?.["x-vercel-id"] || req.headers?.["x-request-id"] || randomUUID()).slice(0, 160);
}

export function json(res, status, payload, extraHeaders = {}) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  for (const [name, value] of Object.entries(extraHeaders)) res.setHeader(name, value);
  res.end(JSON.stringify(payload));
}

export function publicJson(res, payload, maxAge = 30) {
  const ttl = Math.min(Math.max(Number(maxAge) || 30, 1), 300);
  return json(res, 200, payload, {
    "Cache-Control": `public, max-age=0, s-maxage=${ttl}, stale-while-revalidate=${ttl * 4}`
  });
}

export function redirect(res, location, status = 302) {
  res.statusCode = status;
  res.setHeader("Location", location);
  res.setHeader("Cache-Control", "no-store");
  res.end();
}

export function only(req, res, methods) {
  const allowed = Array.isArray(methods) ? methods : [methods];
  if (allowed.includes(req.method)) return true;
  res.setHeader("Allow", allowed.join(", "));
  json(res, 405, { error: "Method not allowed." });
  return false;
}

export async function readBody(req, maxBytes = 64 * 1024) {
  if (req.body && typeof req.body === "object" && !Buffer.isBuffer(req.body)) return req.body;
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw Object.assign(new Error("Payload too large."), { status: 413 });
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw Object.assign(new Error("Invalid JSON."), { status: 400 });
  }
}

export async function readRawBody(req, maxBytes = 512 * 1024) {
  if (Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === "string") return Buffer.from(req.body);
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw Object.assign(new Error("Payload too large."), { status: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export function parseCookies(req) {
  const header = String(req.headers?.cookie || "");
  return Object.fromEntries(header.split(";").map((part) => part.trim()).filter(Boolean).map((part) => {
    const index = part.indexOf("=");
    const key = index < 0 ? part : part.slice(0, index);
    const value = index < 0 ? "" : part.slice(index + 1);
    try { return [key, decodeURIComponent(value)]; } catch { return [key, value]; }
  }));
}

export function cookie(name, value, options = {}) {
  const attributes = [`${name}=${encodeURIComponent(value)}`, `Path=${options.path || "/"}`];
  if (options.maxAge !== undefined) attributes.push(`Max-Age=${Math.max(0, Math.floor(options.maxAge))}`);
  if (options.httpOnly !== false) attributes.push("HttpOnly");
  if (options.secure !== false && process.env.NODE_ENV !== "development") attributes.push("Secure");
  attributes.push(`SameSite=${options.sameSite || "Lax"}`);
  if (options.domain) attributes.push(`Domain=${options.domain}`);
  return attributes.join("; ");
}

export function setCookies(res, values) {
  res.setHeader("Set-Cookie", values);
}

export function clientSignal(req) {
  const forwarded = String(req.headers?.["x-forwarded-for"] || "").split(",")[0].trim();
  const raw = forwarded || String(req.socket?.remoteAddress || "unknown");
  const configuredSecret = env("PRIVACY_HASH_SECRET");
  const production = process.env.VERCEL === "1" || process.env.NODE_ENV === "production";
  if (!configuredSecret && production) {
    throw Object.assign(new Error("Server privacy hashing is not configured."), {
      status: 503,
      code: "PRIVACY_HASH_NOT_CONFIGURED"
    });
  }
  const secret = configuredSecret || "browserp-development-only";
  return createHmac("sha256", secret).update(raw).digest("hex");
}

export function safeReturnPath(value, fallback = "/dashboard") {
  const candidate = String(value || "");
  return /^\/[a-zA-Z0-9/_?=&.-]{0,240}$/.test(candidate) && !candidate.startsWith("//") ? candidate : fallback;
}

export function secureEqual(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && timingSafeEqual(a, b);
}

export function handleError(res, error, id = randomUUID()) {
  const status = Number(error?.status) || 500;
  if (status >= 500) console.error(JSON.stringify({ requestId: id, message: error?.message, stack: error?.stack }));
  return json(res, status, {
    error: status >= 500 ? "An unexpected error occurred." : error.message,
    requestId: id
  });
}
