import { createHmac } from "node:crypto";
import { developmentCatalogAllowed, env, supabaseConfig } from "./config.js";
import { clientSignal } from "./http.js";
import { rpc } from "./supabase.js";

const localBuckets = new Map();
const MEMBER_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function localLimit(key, limit, windowSeconds) {
  const now = Date.now();
  const bucket = localBuckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    localBuckets.set(key, { count: 1, resetAt: now + windowSeconds * 1000 });
    return true;
  }
  bucket.count += 1;
  return bucket.count <= limit;
}

async function consumeLimit(keyHash, action, limit, windowSeconds) {
  const database = supabaseConfig();
  try {
    const allowed = await rpc("consume_rate_limit", {
      p_key_hash: keyHash,
      p_action: action,
      p_limit: limit,
      p_window_seconds: windowSeconds
    }, undefined, { useSecret: database.privileged });
    if (!allowed) throw Object.assign(new Error("Too many requests. Please wait and try again."), { status: 429 });
  } catch (error) {
    if (!developmentCatalogAllowed() || !["BACKEND_NOT_CONFIGURED", "SERVER_BOUNDARY_NOT_CONFIGURED"].includes(error.code)) throw error;
    if (!localLimit(`${action}:${keyHash}`, limit, windowSeconds)) {
      throw Object.assign(new Error("Too many requests. Please wait and try again."), { status: 429 });
    }
  }
}

// Existing public, authentication and other callers keep their original IP quota.
export async function rateLimit(req, action, limit, windowSeconds) {
  return consumeLimit(clientSignal(req), action, limit, windowSeconds);
}

// Only pass a user ID obtained from getSession(), never a header/body/cookie ID.
// The endpoint chooses both caps explicitly; there is no client-controlled key.
export async function memberRateLimit(req, action, limit, windowSeconds, verifiedUserId, networkLimit) {
  if (typeof verifiedUserId !== "string" || !MEMBER_ID.test(verifiedUserId)) {
    throw Object.assign(new Error("A verified account is required."), { status: 403 });
  }
  if (typeof action !== "string" || !/^[a-z][a-z0-9_-]{0,79}$/.test(action)
      || !Number.isSafeInteger(limit) || limit < 1 || limit > 1000
      || !Number.isSafeInteger(windowSeconds) || windowSeconds < 1 || windowSeconds > 86400
      || !Number.isSafeInteger(networkLimit) || networkLimit < limit || networkLimit > 1000) {
    throw Object.assign(new Error("Invalid member rate-limit configuration."), { status: 500 });
  }
  // This retains trusted address handling and the existing production-secret gate.
  const networkKeyHash = clientSignal(req);
  const memberKeyHash = createHmac("sha256", env("PRIVACY_HASH_SECRET") || "browserp-development-only")
    .update("browserp:rate-limit:member:v1:")
    .update(verifiedUserId.toLowerCase())
    .digest("hex");

  // An already-throttled account cannot spend its neighbours' remaining quota.
  // The account quota also follows that account if it changes IP or session.
  await consumeLimit(memberKeyHash, action, limit, windowSeconds);
  // Keep the pre-existing network key/action so its bucket is not reset on rollout.
  await consumeLimit(networkKeyHash, action, networkLimit, windowSeconds);
}
