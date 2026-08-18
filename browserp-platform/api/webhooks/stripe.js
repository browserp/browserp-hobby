import { endpoint, ok } from "../../lib/api.js";
import { env, stripeConfig } from "../../lib/config.js";
import { promotionPacks } from "../../lib/catalog.js";
import { readRawBody } from "../../lib/http.js";
import { rpc } from "../../lib/supabase.js";
import { checkoutLineItems, verifyStripeSignature } from "../../lib/stripe.js";

export const config = { api: { bodyParser: false } };

export default endpoint("POST", async (req, res) => {
  const raw = await readRawBody(req);
  const stripe = stripeConfig();
  if (!verifyStripeSignature(raw, req.headers["stripe-signature"], stripe.webhookSecret)) throw Object.assign(new Error("Invalid webhook signature."), { status: 400 });
  const event = JSON.parse(raw.toString("utf8"));
  if (!["checkout.session.completed", "checkout.session.async_payment_succeeded"].includes(event.type)) return ok(res, { received: true });
  const session = event.data?.object;
  if (!session || session.payment_status !== "paid") return ok(res, { received: true, pending: true });

  const userId = String(session.client_reference_id || session.metadata?.user_id || "");
  const productKey = String(session.metadata?.product_key || "");
  const pack = promotionPacks[productKey];
  if (!/^[0-9a-f-]{36}$/i.test(userId) || !pack) throw Object.assign(new Error("Checkout metadata is invalid."), { status: 400 });

  const lineItems = await checkoutLineItems(session.id);
  const matchingItem = lineItems.data?.find((item) => item.price?.id === stripe.prices[productKey]);
  const quantity = Number(matchingItem?.quantity || 0);
  if (!quantity || quantity > pack.maxQuantity) throw Object.assign(new Error("Checkout line items do not match the product catalog."), { status: 400 });

  await rpc("fulfill_stripe_checkout", {
    p_fulfillment_secret: env("SUPABASE_FULFILLMENT_SECRET", { required: true }),
    p_stripe_event_id: String(event.id),
    p_stripe_session_id: String(session.id),
    p_user_id: userId,
    p_product_key: productKey,
    p_quantity: quantity,
    p_amount_total: Number(session.amount_total || 0),
    p_currency: String(session.currency || "").toLowerCase(),
    p_metadata: session.metadata || {}
  });
  return ok(res, { received: true, fulfilled: true });
});
