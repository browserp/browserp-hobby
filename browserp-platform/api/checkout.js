import { randomUUID } from "node:crypto";
import { endpoint, ok } from "../lib/api.js";
import { appUrl, stripeConfig } from "../lib/config.js";
import { promotionPacks } from "../lib/catalog.js";
import { readBody } from "../lib/http.js";
import { rateLimit } from "../lib/rate-limit.js";
import { getSession } from "../lib/supabase.js";
import { stripeRequest } from "../lib/stripe.js";

export default endpoint("POST", async (req, res) => {
  const session = await getSession(req, res, { required: true });
  await rateLimit(req, "checkout", 5, 300, session.accessToken);
  const body = await readBody(req, 16_384);
  const pack = promotionPacks[String(body.pack || "")];
  const quantity = Number(body.quantity || 1);
  if (!pack || !Number.isInteger(quantity) || quantity < 1 || quantity > pack.maxQuantity) throw Object.assign(new Error("Choose a valid promotion pack and quantity."), { status: 400 });
  if (body.authorizedPurchase !== true) throw Object.assign(new Error("Confirm that you are authorized to make this purchase, including guardian permission where required."), { status: 400 });

  const stripe = stripeConfig();
  const price = stripe.prices[pack.key];
  if (!stripe.secretKey || !price) throw Object.assign(new Error("Checkout is not available until the payment catalog is connected."), { status: 503 });
  const attemptId = /^[0-9a-f-]{36}$/i.test(String(body.attemptId || "")) ? String(body.attemptId) : randomUUID();
  const baseUrl = appUrl(req);
  const checkout = await stripeRequest("checkout/sessions", {
    method: "POST",
    idempotencyKey: `browserp:${session.user.id}:${attemptId}`,
    body: {
      mode: "payment",
      success_url: `${baseUrl}/dashboard?checkout=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${baseUrl}/dashboard?checkout=cancelled`,
      client_reference_id: session.user.id,
      customer_email: session.user.email || undefined,
      "line_items[0][price]": price,
      "line_items[0][quantity]": quantity,
      "metadata[user_id]": session.user.id,
      "metadata[product_key]": pack.key,
      "metadata[credits_per_unit]": pack.credits,
      "metadata[checkout_attempt_id]": attemptId,
      "payment_intent_data[metadata][user_id]": session.user.id,
      "payment_intent_data[metadata][product_key]": pack.key,
      "consent_collection[terms_of_service]": "required",
      "custom_text[submit][message]": "Promotion credits are fixed-value, non-transferable, and have no cash value. By paying, you confirm you are authorized to purchase."
    }
  });
  return ok(res, { checkoutUrl: checkout.url, sessionId: checkout.id }, 201);
});
