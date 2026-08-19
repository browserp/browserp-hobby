import assert from "node:assert/strict";
import test from "node:test";
import { createHmac } from "node:crypto";
import { filterServers } from "../lib/directory.js";
import { servers } from "../lib/catalog.js";
import { assessContent, sanitizePlainText } from "../lib/moderation.js";
import { calculateDiscoveryScore } from "../lib/ranking.js";
import {
  checkoutMetadataSignature,
  stripeCatalogPriceMatches,
  verifyCheckoutMetadataSignature,
  verifyStripeSignature
} from "../lib/stripe.js";
import { generateNames, joaat } from "../lib/tools.js";
import { clientSignal } from "../lib/http.js";
import { currentIdentityProvider } from "../lib/supabase.js";
import { integrationIdentifier } from "../api/checkout.js";
import { stripeConfig } from "../lib/config.js";

test("JOAAT produces the expected unsigned hash", () => {
  assert.equal(joaat("adder"), 3078201489);
});

test("name generation is deterministic and local", () => {
  const first = generateNames({ platform: "fivem", theme: "city", style: "serious" });
  const second = generateNames({ platform: "fivem", theme: "city", style: "serious" });
  assert.deepEqual(first, second);
  assert.equal(first.length, 5);
});

test("directory filtering and ranking preserve organic weight", () => {
  const results = filterServers(servers, { platform: "minecraft", beginner: "true" });
  assert.equal(results.length, 1);
  assert.equal(results[0].slug, "everwild-realms");
  const weakButBoosted = { quality_score: 10, engagement_score: 10, uptime_percent: 50, players: 1, capacity: 100, verified: false, boost_score: 100 };
  const strongOrganic = { quality_score: 95, engagement_score: 90, uptime_percent: 99, players: 80, capacity: 100, verified: true, boost_score: 0 };
  assert.ok(calculateDiscoveryScore(strongOrganic) > calculateDiscoveryScore(weakButBoosted));
});

test("content moderation blocks credential theft patterns", () => {
  const result = assessContent({ description: "Please share your password and send your recovery code to verify." });
  assert.equal(result.confidence, "blocked");
  assert.equal(result.action, "reject");
  assert.equal(sanitizePlainText("<b>Hello</b>\u0000", 50), "bHello/b");
});

test("Stripe webhook verification checks timestamp and HMAC", () => {
  const body = Buffer.from('{"id":"evt_test"}');
  const secret = "whsec_test";
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
  assert.equal(verifyStripeSignature(body, `t=${timestamp},v1=${signature}`, secret), true);
  assert.equal(verifyStripeSignature(body, `t=${timestamp},v1=bad`, secret), false);
});

test("Checkout metadata is server-signed and fails closed after tampering", () => {
  const metadata = {
    browserp_integration: "browserp_checkout_v1",
    user_id: "00000000-0000-4000-8000-000000000001",
    product_key: "starter",
    price_id: "price_test",
    quantity: "1",
    credits_per_unit: "5",
    unit_amount: "500",
    currency: "gbp",
    checkout_attempt_id: "00000000-0000-4000-8000-000000000002",
    browserp_release: "1.3.0",
    catalog_version: "1"
  };
  metadata.checkout_signature = checkoutMetadataSignature(metadata, "test-fulfillment-secret");
  assert.equal(verifyCheckoutMetadataSignature(metadata, "test-fulfillment-secret"), true);
  assert.equal(verifyCheckoutMetadataSignature({ ...metadata, quantity: "2" }, "test-fulfillment-secret"), false);
  assert.equal(verifyCheckoutMetadataSignature(metadata, "wrong-secret"), false);
});

test("Stripe mode configuration requires test keys outside production and live keys in production", () => {
  const names = [
    "STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "SUPABASE_FULFILLMENT_SECRET",
    "STRIPE_FULFILLMENT_ENABLED", "PAYMENTS_ENABLED", "NODEJS_HELPERS",
    "SUPABASE_URL", "SUPABASE_SECRET_KEY", "VERCEL_ENV", "NODE_ENV"
  ];
  const previous = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  try {
    delete process.env.NODE_ENV;
    process.env.VERCEL_ENV = "preview";
    process.env.STRIPE_SECRET_KEY = "sk_test_example";
    assert.equal(stripeConfig().modeReady, true);
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_example";
    process.env.SUPABASE_FULFILLMENT_SECRET = "fulfillment-example";
    process.env.STRIPE_FULFILLMENT_ENABLED = "true";
    process.env.PAYMENTS_ENABLED = "false";
    process.env.NODEJS_HELPERS = "0";
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SECRET_KEY = "sb_secret_example";
    assert.equal(stripeConfig().checkoutReady, false);
    assert.equal(stripeConfig().fulfillmentReady, true);
    process.env.STRIPE_SECRET_KEY = "sk_live_example";
    assert.equal(stripeConfig().modeReady, false);

    process.env.VERCEL_ENV = "production";
    assert.equal(stripeConfig().modeReady, true);
    process.env.STRIPE_SECRET_KEY = "sk_test_example";
    assert.equal(stripeConfig().modeReady, false);
  } finally {
    for (const [name, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

test("Stripe catalog preflight requires the exact active fixed-price product", () => {
  const expected = {
    priceId: "price_starter",
    productKey: "starter",
    unitAmount: 500,
    currency: "gbp",
    credits: 5
  };
  const price = {
    id: "price_starter",
    active: true,
    type: "one_time",
    unit_amount: 500,
    currency: "gbp",
    product: {
      active: true,
      metadata: { browserp_product_key: "starter", browserp_credit_amount: "5" }
    }
  };
  assert.equal(stripeCatalogPriceMatches(price, expected), true);
  assert.equal(stripeCatalogPriceMatches({ ...price, unit_amount: 501 }, expected), false);
  assert.equal(stripeCatalogPriceMatches({ ...price, product: { active: true, metadata: {} } }, expected), false);
});

test("Checkout integration identifiers are stable for the same attempt", () => {
  const first = integrationIdentifier("member:attempt");
  assert.equal(first, integrationIdentifier("member:attempt"));
  assert.notEqual(first, integrationIdentifier("member:another-attempt"));
  assert.match(first, /^browserp_web_[a-z]{8}$/);
});

test("staff provider detection rejects linked or inconsistent identities", () => {
  assert.equal(currentIdentityProvider({
    app_metadata: { provider: "discord", providers: ["discord"] },
    identities: [{ provider: "discord" }]
  }), "discord");
  assert.equal(currentIdentityProvider({
    app_metadata: { provider: "google", providers: ["google"] },
    identities: [{ provider: "google" }]
  }), "google");
  assert.equal(currentIdentityProvider({
    app_metadata: { provider: "discord", providers: ["discord", "google"] },
    identities: [{ provider: "discord" }, { provider: "google" }]
  }), null);
  assert.equal(currentIdentityProvider({
    app_metadata: { provider: "discord", providers: ["discord"] },
    identities: [{ provider: "google" }]
  }), null);
  assert.equal(currentIdentityProvider({
    app_metadata: { provider: "discord", providers: ["discord"] },
    identities: [{ provider: "discord" }, { provider: "discord" }]
  }), null);
});

test("production network-signal hashing fails closed without its secret", () => {
  const previousVercel = process.env.VERCEL;
  const previousSecret = process.env.PRIVACY_HASH_SECRET;
  try {
    process.env.VERCEL = "1";
    delete process.env.PRIVACY_HASH_SECRET;
    const request = { headers: { "x-forwarded-for": "192.0.2.10" }, socket: {} };
    assert.throws(() => clientSignal(request), /privacy hashing is not configured/i);
    process.env.PRIVACY_HASH_SECRET = "test-only-secret";
    assert.match(clientSignal(request), /^[a-f0-9]{64}$/);
  } finally {
    if (previousVercel === undefined) delete process.env.VERCEL;
    else process.env.VERCEL = previousVercel;
    if (previousSecret === undefined) delete process.env.PRIVACY_HASH_SECRET;
    else process.env.PRIVACY_HASH_SECRET = previousSecret;
  }
});
