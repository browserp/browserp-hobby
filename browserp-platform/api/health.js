import { endpoint, ok } from "../lib/api.js";
import { env, RELEASE_VERSION, stripeConfig, supabaseConfig } from "../lib/config.js";
import { authCapabilities } from "../lib/supabase.js";

export default endpoint("GET", async (_req, res) => {
  const database = supabaseConfig();
  const stripe = stripeConfig();
  const privacyHash = Boolean(env("PRIVACY_HASH_SECRET"));
  let providers = { discord: false, google: false };
  let authStatus = database.configured ? "backend-unreachable" : "awaiting-backend";
  if (database.configured) {
    try {
      providers = await authCapabilities();
      authStatus = providers.discord ? "configured" : "discord-disabled";
    } catch {
      authStatus = "backend-unreachable";
    }
  }

  const coreReady = Boolean(database.configured && database.privileged && privacyHash && providers.discord);
  let paymentStatus = "disabled";
  if (stripe.enabled) paymentStatus = stripe.checkoutReady && stripe.fulfillmentReady ? "ready" : "misconfigured";

  return ok(res, {
    status: coreReady ? "ok" : "degraded",
    service: "browserp",
    version: RELEASE_VERSION,
    time: new Date().toISOString(),
    integrations: {
      database: database.configured ? "ready" : "awaiting-project",
      serverBoundary: database.privileged ? "ready" : "awaiting-secret-key",
      privacyHash: privacyHash ? "ready" : "awaiting-secret",
      authentication: { status: authStatus, discord: providers.discord, google: providers.google },
      providers,
      payments: paymentStatus
    },
    features: {
      googleLogin: providers.google,
      paymentsEnabled: paymentStatus === "ready"
    }
  });
});
