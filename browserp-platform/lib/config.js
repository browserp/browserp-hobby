export function env(name, { required = false } = {}) {
  const value = String(process.env[name] || "").trim();
  if (required && !value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export function appUrl(req) {
  const configured = env("APP_URL");
  if (configured) return configured.replace(/\/$/, "");
  const forwardedHost = String(req?.headers?.["x-forwarded-host"] || req?.headers?.host || "localhost:8080");
  const forwardedProto = String(req?.headers?.["x-forwarded-proto"] || "http").split(",")[0];
  return `${forwardedProto}://${forwardedHost}`;
}

export function supabaseConfig() {
  const url = env("SUPABASE_URL").replace(/\/$/, "");
  const publishableKey = env("SUPABASE_PUBLISHABLE_KEY");
  return { url, publishableKey, configured: Boolean(url && publishableKey) };
}

export function stripeConfig() {
  const prices = {
    starter: env("STRIPE_PRICE_STARTER"),
    growth: env("STRIPE_PRICE_GROWTH"),
    launch: env("STRIPE_PRICE_LAUNCH")
  };
  return {
    secretKey: env("STRIPE_SECRET_KEY"),
    webhookSecret: env("STRIPE_WEBHOOK_SECRET"),
    prices,
    configured: Boolean(env("STRIPE_SECRET_KEY") && Object.values(prices).every(Boolean))
  };
}
