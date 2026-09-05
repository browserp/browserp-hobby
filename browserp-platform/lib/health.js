import { endpoint, ok } from "./api.js";
import { buildSha, env, RELEASE_VERSION, stripeConfig } from "./config.js";
import { authCapabilities, rest } from "./supabase.js";

export default endpoint("GET", async (_req, res) => {
  const stripe = stripeConfig();
  let backendStatus = "unavailable";
  let authenticationStatus = "unavailable";

  try {
    // This is deliberately a real, privileged and bounded read. A configured
    // environment alone must never make the health endpoint report readiness.
    await rest("platforms?select=id&limit=1", { useSecret: true });
    backendStatus = "ready";
  } catch { /* A high-level status is sufficient for a public health check. */ }

  try {
    const providers = await authCapabilities();
    authenticationStatus = providers.discord ? "ready" : "unavailable";
  } catch { /* Keep provider and configuration detail out of this response. */ }

  const evidenceKey = env("NETWORK_EVIDENCE_KEY");
  let evidenceReady = /^[0-9a-f]{64}$/i.test(evidenceKey);
  if (!evidenceReady && evidenceKey) {
    try { evidenceReady = Buffer.from(evidenceKey, "base64").length === 32; }
    catch { evidenceReady = false; }
  }
  const securityStatus = env("PRIVACY_HASH_SECRET") && evidenceReady ? "ready" : "unavailable";
  const coreReady = backendStatus === "ready"
    && authenticationStatus === "ready"
    && securityStatus === "ready";
  let paymentStatus = "disabled";
  if (stripe.enabled) paymentStatus = stripe.checkoutReady && stripe.fulfillmentReady ? "ready" : "unavailable";

  return ok(res, {
    status: coreReady ? "ok" : "degraded",
    service: "browserp",
    version: RELEASE_VERSION,
    buildSha: buildSha(),
    time: new Date().toISOString(),
    checks: {
      backend: backendStatus,
      authentication: authenticationStatus,
      security: securityStatus,
      payments: paymentStatus
    }
  });
});
