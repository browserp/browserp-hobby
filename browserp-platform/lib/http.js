import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { appUrl, env, isProductionRuntime } from "./config.js";

const JSON_MIME = /^application\/json(?:\s*;\s*charset=(?:utf-8|"utf-8"))?$/i;
const STATE_CHANGING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export function requestId(_req) {
  // Request identifiers are generated inside the trust boundary. Forwarded
  // headers are useful for provider diagnostics, but callers can spoof them.
  return randomUUID();
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
  const limit = Math.min(Math.max(Number(maxBytes) || 64 * 1024, 1), 1024 * 1024);
  const contentType = String(req.headers?.["content-type"] || "").trim();
  if (!JSON_MIME.test(contentType)) {
    throw Object.assign(new Error("Content-Type must be application/json."), { status: 415 });
  }
  const declaredLength = Number(req.headers?.["content-length"]);
  if (Number.isFinite(declaredLength) && declaredLength > limit) {
    throw Object.assign(new Error("Payload too large."), { status: 413 });
  }

  if (req.body !== undefined && req.body !== null) {
    let parsed = req.body;
    let encoded;
    try {
      if (Buffer.isBuffer(parsed)) encoded = parsed;
      else if (typeof parsed === "string") encoded = Buffer.from(parsed, "utf8");
      else encoded = Buffer.from(JSON.stringify(parsed), "utf8");
    } catch {
      throw Object.assign(new Error("Invalid JSON."), { status: 400 });
    }
    if (encoded.length > limit) throw Object.assign(new Error("Payload too large."), { status: 413 });
    if (Buffer.isBuffer(parsed) || typeof parsed === "string") {
      try { parsed = JSON.parse(encoded.toString("utf8")); }
      catch { throw Object.assign(new Error("Invalid JSON."), { status: 400 }); }
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw Object.assign(new Error("JSON body must be an object."), { status: 400 });
    }
    return parsed;
  }

  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw Object.assign(new Error("Payload too large."), { status: 413 });
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  let parsed;
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw Object.assign(new Error("Invalid JSON."), { status: 400 });
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw Object.assign(new Error("JSON body must be an object."), { status: 400 });
  }
  return parsed;
}

export async function readRawBody(req, maxBytes = 512 * 1024) {
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

export function cookieName(baseName) {
  return isProductionRuntime() ? `__Host-${baseName}` : baseName;
}

export function cookieNames(baseName) {
  return [...new Set([cookieName(baseName), `__Host-${baseName}`, baseName])];
}

export function cookieValue(cookies, baseName) {
  for (const name of cookieNames(baseName)) {
    if (cookies?.[name]) return String(cookies[name]);
  }
  return "";
}

export function cookie(name, value, options = {}) {
  const hostOnly = String(name).startsWith("__Host-");
  const path = hostOnly ? "/" : options.path || "/";
  const attributes = [`${name}=${encodeURIComponent(value)}`, `Path=${path}`];
  if (options.maxAge !== undefined) attributes.push(`Max-Age=${Math.max(0, Math.floor(options.maxAge))}`);
  if (options.httpOnly !== false) attributes.push("HttpOnly");
  if (hostOnly || options.secure === true || (options.secure !== false && isProductionRuntime())) attributes.push("Secure");
  attributes.push(`SameSite=${options.sameSite || "Lax"}`);
  if (options.domain && !hostOnly) attributes.push(`Domain=${options.domain}`);
  return attributes.join("; ");
}

export function setCookies(res, values) {
  const existing = typeof res.getHeader === "function" ? res.getHeader("Set-Cookie") : undefined;
  const current = Array.isArray(existing) ? existing : existing ? [existing] : [];
  res.setHeader("Set-Cookie", [...current, ...values]);
}

export function clientSignal(req) {
  const vercelForwarded = String(req.headers?.["x-vercel-forwarded-for"] || "").split(",")[0].trim();
  const standardForwarded = String(req.headers?.["x-forwarded-for"] || "").split(",")[0].trim();
  const realIp = String(req.headers?.["x-real-ip"] || "").trim();
  const raw = vercelForwarded || (process.env.VERCEL === "1" ? standardForwarded : realIp) || String(req.socket?.remoteAddress || "unknown");
  const configuredSecret = env("PRIVACY_HASH_SECRET");
  if (!configuredSecret && isProductionRuntime()) {
    throw Object.assign(new Error("Server privacy hashing is not configured."), {
      status: 503,
      code: "PRIVACY_HASH_NOT_CONFIGURED"
    });
  }
  const secret = configuredSecret || "browserp-development-only";
  return createHmac("sha256", secret).update(raw).digest("hex");
}

export function assertSameOrigin(req) {
  const expected = new URL(appUrl(req)).origin;
  const requestOrigin = String(req.headers?.origin || "");
  if (requestOrigin && requestOrigin !== expected) {
    throw Object.assign(new Error("Cross-origin account actions are not allowed."), { status: 403 });
  }
  const fetchSite = String(req.headers?.["sec-fetch-site"] || "").toLowerCase();
  if (fetchSite && !["same-origin", "same-site", "none"].includes(fetchSite)) {
    throw Object.assign(new Error("Cross-origin account actions are not allowed."), { status: 403 });
  }
}

export function assertCsrf(req) {
  if (!STATE_CHANGING_METHODS.has(String(req.method || "").toUpperCase())) return;
  const cookies = parseCookies(req);
  const cookieToken = cookieValue(cookies, "brp_csrf");
  const headerToken = String(req.headers?.["x-browserp-csrf"] || "").trim();
  if (!/^[A-Za-z0-9_-]{43,128}$/.test(cookieToken)
      || !/^[A-Za-z0-9_-]{43,128}$/.test(headerToken)
      || !secureEqual(cookieToken, headerToken)) {
    throw Object.assign(new Error("Your security token expired. Refresh the page and try again."), {
      status: 403,
      code: "CSRF_TOKEN_INVALID"
    });
  }
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
