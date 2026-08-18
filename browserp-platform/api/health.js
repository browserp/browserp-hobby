import { endpoint, ok } from "../lib/api.js";
import { supabaseConfig, stripeConfig } from "../lib/config.js";
import { authCapabilities } from "../lib/supabase.js";

export default endpoint("GET", async (_req, res) => {
  const supabase = supabaseConfig();
  const stripe = stripeConfig();
  let discord = "awaiting-backend";
  if (supabase.configured) {
    try {
      discord = (await authCapabilities()).discord ? "configured" : "provider-disabled";
    } catch {
      discord = "backend-unreachable";
    }
  }
  return ok(res, {
    status: "ok",
    service: "browserp",
    version: "1.1.0",
    time: new Date().toISOString(),
    integrations: {
      database: supabase.configured ? "configured" : "awaiting-new-project",
      discord,
      payments: stripe.configured ? "configured" : "awaiting-prices"
    }
  });
});
