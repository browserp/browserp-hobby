import { endpoint, ok } from "../lib/api.js";
import { supabaseConfig, stripeConfig } from "../lib/config.js";

export default endpoint("GET", async (_req, res) => {
  const supabase = supabaseConfig();
  const stripe = stripeConfig();
  return ok(res, {
    status: "ok",
    service: "browserp",
    version: "1.0.0",
    time: new Date().toISOString(),
    integrations: {
      database: supabase.configured ? "configured" : "awaiting-new-project",
      payments: stripe.configured ? "configured" : "awaiting-prices"
    }
  });
});
