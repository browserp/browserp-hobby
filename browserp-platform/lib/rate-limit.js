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

export async function rateLimit(req, action, limit, windowSeconds, accessToken) {
  const key = `${action}:${clientSignal(req)}`;
  try {
    const allowed = await rpc("consume_rate_limit", {
      p_key_hash: key,
      p_action: action,
      p_limit: limit,
      p_window_seconds: windowSeconds
    }, accessToken);
    if (!allowed) throw Object.assign(new Error("Too many requests. Please wait and try again."), { status: 429 });
  } catch (error) {
    if (error.code !== "BACKEND_NOT_CONFIGURED" && error.status !== 404) throw error;
    if (!localLimit(key, limit, windowSeconds)) throw Object.assign(new Error("Too many requests. Please wait and try again."), { status: 429 });
  }
}
