import { createHash } from "node:crypto";
import { endpoint, ok } from "../lib/api.js";
import { appUrl, RELEASE_VERSION, stripeConfig } from "../lib/config.js";
import { promotionPacks } from "../lib/catalog.js";
import { assertSameOrigin, readBody } from "../lib/http.js";
import { rateLimit } from "../lib/rate-limit.js";
import { getSession } from "../lib/supabase.js";
import {
  checkoutMetadataSignature,
  stripeCatalogPriceMatches,
  stripePrice,
  stripeRequest
} from "../lib/stripe.js";

export function integrationIdentifier(seed) {
  const alphabet = "abcdefghijklmnopqrstuvwxyz";
  const bytes = createHash("sha256").update(String(seed)).digest().subarray(0, 8);
  return `browserp_web_${[...bytes].map((value) => alphabet[value % alphabet.length]).join("")}`;
}

export default endpoint("POST", async (req, res, requestId) => {
  assertSameOrigin(req);
  const stripe = stripeConfig();
  if (!stripe.enabled) {
    return ok(res, {
      error: "Payments are currently disabled while BrowseRP completes its launch checks.",
      requestId
    }, 503);
  }
  if (!stripe.checkoutReady || !stripe.fulfillmentReady) {
    return ok(res, {
      error: "Checkout is not ready. No payment has been started.",
      requestId
    }, 503);
  }

  const session = await getSession(req, res, { required: true });
  await rateLimit(req, "checkout", 5, 300);
  const body = await readBody(req, 16_384);
  const pack = promotionPacks[String(body.pack || "")];
  const quantity = Number(body.quantity ?? 1);
  if (!pack || !Number.isInteger(quantity) || quantity < 1 || quantity > pack.maxQuantity) {
    throw Object.assign(new Error("Choose a valid promotion pack and quantity."), { status: 400 });
  }
  if (body.authorizedPurchase !== true) {
    throw Object.assign(new Error("Confirm that you are authorized to make this purchase."), { status: 400 });
  }

  const price = stripe.prices[pack.key];
  const attemptId = String(body.attemptId || "").toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(attemptId)) {
    throw Object.assign(new Error("Start a new checkout attempt and try again."), { status: 400 });
  }
  const baseUrl = appUrl(req);
  const metadata = {
    browserp_integration: "browserp_checkout_v1",
    user_id: session.user.id,
    product_key: pack.key,
    price_id: price,
    quantity: String(quantity),
    credits_per_unit: String(pack.credits),
    unit_amount: String(pack.unitAmount),
    currency: pack.currency,
    checkout_attempt_id: attemptId,
    browserp_release: RELEASE_VERSION,
    catalog_version: "1"
  };
  metadata.checkout_signature = checkoutMetadataSignature(metadata, stripe.fulfillmentSecret);

  const configuredPrice = await stripePrice(price);
  if (!stripeCatalogPriceMatches(configuredPrice, {
    priceId: price,
    productKey: pack.key,
    unitAmount: pack.unitAmount,
    currency: pack.currency,
    credits: pack.credits
  })) {
    throw Object.assign(new Error("The payment catalog is not ready. No payment has been started."), { status: 503 });
  }

  const checkout = await stripeRequest("checkout/sessions", {
    method: "POST",
    idempotencyKey: `browserp:${session.user.id}:${attemptId}`,
    body: {
      mode: "payment",
      integration_identifier: integrationIdentifier(`${session.user.id}:${attemptId}`),
      success_url: `${baseUrl}/dashboard?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/dashboard?checkout=cancelled`,
      client_reference_id: session.user.id,
      customer_email: session.user.email || undefined,
      line_items: [{ price, quantity }],
      metadata,
      payment_intent_data: { metadata },
      consent_collection: { terms_of_service: "required" },
      custom_text: {
        submit: {
          message: "Promotion credits are fixed-value, non-transferable and have no cash value. By paying, you confirm you are authorized to purchase."
        }
      },
      submit_type: "pay"
    }
  });
  if (!checkout?.id || !checkout?.url) {
    throw Object.assign(new Error("The payment provider did not return a checkout page."), { status: 502 });
  }
  return ok(res, { checkoutUrl: checkout.url, sessionId: checkout.id }, 201);
});
