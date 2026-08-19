export const RELEASE_VERSION = "1.3.0";

export function env(name, { required = false } = {}) {
  const value = String(process.env[name] || "").trim();
  if (required && !value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

export function booleanEnv(name, fallback = false) {
  const value = env(name).toLowerCase();
  if (!value) return fallback;
  return ["1", "true", "yes", "on"].includes(value);
}

export function isProductionRuntime() {
  return process.env.VERCEL === "1" || process.env.NODE_ENV === "production";
}

function firstHeader(value) {
  return String(value || "").split(",")[0].trim();
}

function trustedRequestHost(host) {
  const normalized = String(host || "").toLowerCase().replace(/\.$/, "");
  if (/^(?:www\.)?browserp\.com$/.test(normalized)) return true;
  if (/^browserp-hobby(?:-[a-z0-9-]+)?(?:-jacks-projects-9abbb7ab)?\.vercel\.app$/.test(normalized)) return true;
  if (/^(?:localhost|127\.0\.0\.1)(?::\d{1,5})?$/.test(normalized)) return true;
  return false;
}

export function appUrl(req) {
  const requestHost = firstHeader(req?.headers?.["x-forwarded-host"] || req?.headers?.host);
  if (trustedRequestHost(requestHost)) {
    const forwardedProto = firstHeader(req?.headers?.["x-forwarded-proto"]);
    const protocol = forwardedProto === "https" || forwardedProto === "http"
      ? forwardedProto
      : isProductionRuntime() ? "https" : "http";
    return `${protocol}://${requestHost}`;
  }

  const configured = env("APP_URL");
  if (configured) {
    try {
      const parsed = new URL(configured);
      if (parsed.protocol === "https:" || (!isProductionRuntime() && parsed.protocol === "http:")) {
        return parsed.origin;
      }
    } catch {
      // Fall through to a safe local origin.
    }
  }
  return "http://localhost:8080";
}

export function supabaseConfig() {
  const url = env("SUPABASE_URL").replace(/\/$/, "");
  const publishableKey = env("SUPABASE_PUBLISHABLE_KEY");
  const secretKey = env("SUPABASE_SECRET_KEY");
  return {
    url,
    publishableKey,
    secretKey,
    configured: Boolean(url && publishableKey),
    privileged: Boolean(url && secretKey)
  };
}

export function stripeConfig() {
  const prices = {
    starter: env("STRIPE_PRICE_STARTER"),
    growth: env("STRIPE_PRICE_GROWTH"),
    launch: env("STRIPE_PRICE_LAUNCH")
  };
  const secretKey = env("STRIPE_SECRET_KEY");
  const webhookSecret = env("STRIPE_WEBHOOK_SECRET");
  const fulfillmentSecret = env("SUPABASE_FULFILLMENT_SECRET");
  const enabled = booleanEnv("PAYMENTS_ENABLED", false);
  const fulfillmentEnabled = booleanEnv("STRIPE_FULFILLMENT_ENABLED", true);
  const catalogReady = Object.values(prices).every(Boolean);
  const keyMode = /^(?:sk|rk)_live_/.test(secretKey)
    ? "live"
    : /^(?:sk|rk)_test_/.test(secretKey) ? "test" : null;
  const productionDeployment = process.env.VERCEL_ENV === "production"
    || (process.env.NODE_ENV === "production" && !process.env.VERCEL_ENV);
  const expectedKeyMode = productionDeployment ? "live" : "test";
  const modeReady = keyMode === expectedKeyMode;
  const rawBodyReady = env("NODEJS_HELPERS") === "0";
  return {
    enabled,
    fulfillmentEnabled,
    secretKey,
    webhookSecret,
    fulfillmentSecret,
    prices,
    catalogReady,
    liveMode: keyMode === "live",
    expectedLiveMode: productionDeployment,
    modeReady,
    rawBodyReady,
    checkoutReady: Boolean(enabled && secretKey && catalogReady && modeReady),
    fulfillmentReady: Boolean(fulfillmentEnabled && secretKey && webhookSecret && fulfillmentSecret && modeReady && rawBodyReady && supabaseConfig().privileged)
  };
}

export function developmentCatalogAllowed() {
  return !isProductionRuntime() && !supabaseConfig().configured;
}
