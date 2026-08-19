import { endpoint, ok } from "../../lib/api.js";
import { stripeConfig } from "../../lib/config.js";
import { readRawBody } from "../../lib/http.js";
import { rpc } from "../../lib/supabase.js";
import {
  checkoutLineItems,
  verifyCheckoutMetadataSignature,
  verifyStripeSignature
} from "../../lib/stripe.js";

export const config = { api: { bodyParser: false } };

const COMPLETION_EVENTS = new Set([
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded"
]);

export default endpoint("POST", async (req, res) => {
  const raw = await readRawBody(req);
  const stripe = stripeConfig();
  if (!stripe.webhookSecret) {
    throw Object.assign(new Error("Payment webhook verification is not configured."), { status: 503 });
  }
  if (!verifyStripeSignature(raw, req.headers["stripe-signature"], stripe.webhookSecret)) {
    throw Object.assign(new Error("Invalid webhook signature."), { status: 400 });
  }

  let event;
  try { event = JSON.parse(raw.toString("utf8")); }
  catch { throw Object.assign(new Error("Invalid webhook payload."), { status: 400 }); }
  if (!COMPLETION_EVENTS.has(event.type)) return ok(res, { received: true, ignored: true });

  const session = event.data?.object;
  if (!session || session.object !== "checkout.session") {
    throw Object.assign(new Error("Checkout session payload is missing."), { status: 400 });
  }
  if (session.metadata?.browserp_integration !== "browserp_checkout_v1") {
    return ok(res, { received: true, ignored: true });
  }
  if (typeof event.livemode !== "boolean" || event.livemode !== stripe.liveMode) {
    throw Object.assign(new Error("Stripe event mode does not match the configured account."), { status: 400 });
  }
  if (typeof session.livemode !== "boolean" || session.livemode !== event.livemode) {
    throw Object.assign(new Error("Checkout session mode does not match its Stripe event."), { status: 400 });
  }
  if (!stripe.fulfillmentReady) {
    throw Object.assign(new Error("Payment fulfillment is not configured."), { status: 503 });
  }
  if (session.mode !== "payment" || session.payment_status !== "paid") {
    return ok(res, { received: true, pending: true });
  }

  const userId = String(session.client_reference_id || "");
  const metadataUser = String(session.metadata?.user_id || "");
  const productKey = String(session.metadata?.product_key || "");
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId)
    || metadataUser !== userId
    || !/^[a-z0-9_]{2,50}$/.test(productKey)
  ) {
    throw Object.assign(new Error("Checkout identity or product metadata is invalid."), { status: 400 });
  }
  if (!verifyCheckoutMetadataSignature(session.metadata, stripe.fulfillmentSecret)) {
    throw Object.assign(new Error("Checkout metadata signature is invalid."), { status: 400 });
  }

  const expectedPrice = String(session.metadata?.price_id || "");
  const quantity = Number(session.metadata?.quantity || 0);
  const creditsPerUnit = Number(session.metadata?.credits_per_unit || 0);
  const unitAmount = Number(session.metadata?.unit_amount || 0);
  const currency = String(session.metadata?.currency || "").toLowerCase();
  const attemptId = String(session.metadata?.checkout_attempt_id || "");
  const expectedTotal = unitAmount * quantity;
  if (
    !/^price_[A-Za-z0-9_]+$/.test(expectedPrice)
    || !Number.isInteger(quantity) || quantity < 1 || quantity > 10
    || !Number.isSafeInteger(creditsPerUnit) || creditsPerUnit < 1
    || !Number.isSafeInteger(unitAmount) || unitAmount < 1
    || !Number.isSafeInteger(expectedTotal) || expectedTotal < 1
    || !/^[a-z]{3}$/.test(currency)
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(attemptId)
    || String(session.metadata?.catalog_version || "") !== "1"
  ) {
    throw Object.assign(new Error("Checkout catalog metadata does not match BrowseRP."), { status: 400 });
  }

  const lineItems = await checkoutLineItems(session.id);
  const items = Array.isArray(lineItems?.data) ? lineItems.data : [];
  if (items.length !== 1) {
    throw Object.assign(new Error("Checkout contains an unexpected number of line items."), { status: 400 });
  }
  const item = items[0];
  const lineItemQuantity = Number(item.quantity || 0);
  if (
    item.price?.id !== expectedPrice ||
    lineItemQuantity !== quantity ||
    Number(item.price?.unit_amount || 0) !== unitAmount ||
    Number(item.amount_total || 0) !== expectedTotal ||
    String(item.currency || item.price?.currency || "").toLowerCase() !== currency ||
    Number(session.amount_total || 0) !== expectedTotal ||
    String(session.currency || "").toLowerCase() !== currency
  ) {
    throw Object.assign(new Error("Checkout line items do not match the fixed BrowseRP catalog."), { status: 400 });
  }

  const result = await rpc("fulfill_stripe_checkout", {
    p_fulfillment_secret: stripe.fulfillmentSecret,
    p_stripe_event_id: String(event.id),
    p_stripe_session_id: String(session.id),
    p_user_id: userId,
    p_product_key: productKey,
    p_quantity: quantity,
    p_amount_total: expectedTotal,
    p_currency: currency,
    p_metadata: {
      checkout_attempt_id: attemptId,
      browserp_release: session.metadata?.browserp_release || null,
      price_id: expectedPrice,
      credits_per_unit: creditsPerUnit,
      catalog_version: "1"
    }
  }, undefined, { useSecret: true });
  return ok(res, { received: true, fulfilled: true, idempotent: Boolean(result?.idempotent) });
});
