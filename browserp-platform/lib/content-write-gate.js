import { booleanEnv } from "./config.js";
import { json } from "./http.js";

// This deployment-local pause is one part of the controlled content rollout.
// It cannot retire older deployments that do not contain this check.
export function contentWritePaused(res) {
  if (!booleanEnv("CONTENT_WRITES_PAUSED", false)) return false;
  json(res, 503, {
    error: "Profile changes and comments are temporarily paused. Please try again shortly.",
    code: "CONTENT_WRITES_PAUSED"
  }, { "Retry-After": "60" });
  return true;
}
