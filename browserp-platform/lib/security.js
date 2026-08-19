import { createCipheriv, createDecipheriv, createHmac, randomBytes } from "node:crypto";
import { isIP } from "node:net";
import { env, isProductionRuntime } from "./config.js";
import { cookie, cookieName, cookieValue, parseCookies, setCookies } from "./http.js";
import { rpc } from "./supabase.js";

const DEVICE_TOKEN = /^[A-Za-z0-9_-]{43,128}$/;

function privacySecret() {
  const value = env("PRIVACY_HASH_SECRET");
  if (!value && isProductionRuntime()) {
    throw Object.assign(new Error("Security hashing is not configured."), {
      status: 503,
      code: "PRIVACY_HASH_NOT_CONFIGURED"
    });
  }
  return value || "browserp-development-only";
}

function evidenceKey() {
  const raw = env("NETWORK_EVIDENCE_KEY");
  if (!raw) {
    if (isProductionRuntime()) {
      throw Object.assign(new Error("Protected network evidence is not configured."), {
        status: 503,
        code: "NETWORK_EVIDENCE_NOT_CONFIGURED"
      });
    }
    return createHmac("sha256", "browserp-local-network-evidence").update("development").digest();
  }
  const key = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw Object.assign(new Error("Protected network evidence key is invalid."), {
      status: 503,
      code: "NETWORK_EVIDENCE_INVALID"
    });
  }
  return key;
}

function requestAddress(req) {
  const candidates = [];
  const forwardedHost = String(req.headers?.["x-forwarded-host"] || req.headers?.host || "")
    .split(",")[0].trim().toLowerCase().replace(/:\d+$/, "");
  const cloudflareRay = String(req.headers?.["cf-ray"] || "").trim();
  if (env("CLOUDFLARE_PROXY_ENABLED") === "1"
    && ["browserp.com", "www.browserp.com"].includes(forwardedHost)
    && /^[a-f0-9]{16,32}(?:-[a-z]{3})?$/i.test(cloudflareRay)) {
    candidates.push(String(req.headers?.["cf-connecting-ip"] || "").trim());
  }
  if (process.env.VERCEL === "1") {
    candidates.push(String(req.headers?.["x-vercel-forwarded-for"] || "").split(",")[0].trim());
    candidates.push(String(req.headers?.["x-forwarded-for"] || "").split(",")[0].trim());
  }
  candidates.push(String(req.headers?.["x-real-ip"] || "").trim());
  candidates.push(String(req.socket?.remoteAddress || "").trim());
  for (let candidate of candidates) {
    if (candidate.startsWith("::ffff:")) candidate = candidate.slice(7);
    if (isIP(candidate)) return candidate.toLowerCase();
  }
  return "unknown";
}

function maskedAddress(address) {
  if (isIP(address) === 4) {
    const parts = address.split(".");
    return `${parts[0]}.${parts[1]}.${parts[2]}.0/24`;
  }
  if (isIP(address) === 6) {
    const visible = address.split(":").filter(Boolean).slice(0, 3).join(":");
    return `${visible || "0"}::/48`;
  }
  return null;
}

function family(patterns, fallback) {
  for (const [pattern, label] of patterns) if (pattern.test(fallback)) return label;
  return "Other";
}

function deviceSummary(req) {
  const ua = String(req.headers?.["user-agent"] || "").slice(0, 1000);
  const browser = family([
    [/Edg\//i, "Microsoft Edge"], [/OPR\//i, "Opera"], [/Firefox\//i, "Firefox"],
    [/Chrome\//i, "Chrome"], [/Safari\//i, "Safari"]
  ], ua);
  const os = family([
    [/Windows/i, "Windows"], [/Android/i, "Android"], [/(iPhone|iPad|iOS)/i, "iOS"],
    [/Mac OS X|Macintosh/i, "macOS"], [/Linux/i, "Linux"]
  ], ua);
  const device = /iPad|Tablet/i.test(ua) ? "Tablet" : /Mobile|Android|iPhone/i.test(ua) ? "Mobile" : "Desktop";
  return { ua, browser, os, device };
}

function sealAddress(address) {
  if (address === "unknown") return null;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", evidenceKey(), iv);
  cipher.setAAD(Buffer.from("browserp-network-evidence-v1", "utf8"));
  const ciphertext = Buffer.concat([cipher.update(address, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", iv.toString("base64url"), tag.toString("base64url"), ciphertext.toString("base64url")].join(".");
}

export function unsealAddress(value) {
  const parts = String(value || "").split(".");
  if (parts.length !== 4 || parts[0] !== "v1") throw Object.assign(new Error("Protected evidence is invalid."), { status: 500 });
  const [, ivRaw, tagRaw, ciphertextRaw] = parts;
  const decipher = createDecipheriv("aes-256-gcm", evidenceKey(), Buffer.from(ivRaw, "base64url"));
  decipher.setAAD(Buffer.from("browserp-network-evidence-v1", "utf8"));
  decipher.setAuthTag(Buffer.from(tagRaw, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextRaw, "base64url")),
    decipher.final()
  ]).toString("utf8");
}

export function ensureDeviceToken(req, res) {
  const cookies = parseCookies(req);
  let token = cookieValue(cookies, "brp_device");
  if (!DEVICE_TOKEN.test(token)) {
    token = randomBytes(32).toString("base64url");
    setCookies(res, [cookie(cookieName("brp_device"), token, {
      maxAge: 60 * 60 * 24 * 365,
      sameSite: "Lax"
    })]);
  }
  return token;
}

export function securityContext(req, res) {
  const address = requestAddress(req);
  const deviceToken = ensureDeviceToken(req, res);
  const device = deviceSummary(req);
  const secret = privacySecret();
  const fingerprint = {
    maskedNetwork: maskedAddress(address),
    networkHash: createHmac("sha256", secret).update(`network\0${address}`).digest("hex"),
    deviceHash: createHmac("sha256", secret).update(`device\0${deviceToken}`).digest("hex"),
    userAgentHash: createHmac("sha256", secret).update(`ua\0${device.ua}`).digest("hex"),
    browserFamily: device.browser,
    osFamily: device.os,
    deviceFamily: device.device
  };
  return {
    ...fingerprint,
    networkCiphertext: sealAddress(address),
  };
}

export function securityFingerprintContext(req, res) {
  const address = requestAddress(req);
  const deviceToken = ensureDeviceToken(req, res);
  const device = deviceSummary(req);
  const secret = privacySecret();
  return {
    maskedNetwork: maskedAddress(address),
    networkHash: createHmac("sha256", secret).update(`network\0${address}`).digest("hex"),
    deviceHash: createHmac("sha256", secret).update(`device\0${deviceToken}`).digest("hex"),
    userAgentHash: createHmac("sha256", secret).update(`ua\0${device.ua}`).digest("hex"),
    browserFamily: device.browser,
    osFamily: device.os,
    deviceFamily: device.device
  };
}

export async function recordAccountActivity(req, res, {
  userId,
  eventType,
  provider,
  requestId,
  metadata = {}
}) {
  const context = securityContext(req, res);
  return rpc("record_account_activity_server", {
    p_user_id: userId,
    p_event_type: eventType,
    p_provider: provider || null,
    p_masked_network: context.maskedNetwork,
    p_browser_family: context.browserFamily,
    p_os_family: context.osFamily,
    p_device_family: context.deviceFamily,
    p_request_id: requestId || null,
    p_network_ciphertext: context.networkCiphertext,
    p_network_hash: context.networkHash,
    p_device_hash: context.deviceHash,
    p_user_agent_hash: context.userAgentHash,
    p_metadata: metadata
  }, undefined, { useSecret: true });
}
