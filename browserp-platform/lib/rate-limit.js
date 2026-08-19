import { developmentCatalogAllowed, supabaseConfig } from "./config.js";
import { clientSignal } from "./http.js";
import { rpc } from "./supabase.js";

const localBuckets = new Map();

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

export async function rateLimit(req, action, limit, windowSeconds) {
  const keyHash = clientSignal(req);
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
