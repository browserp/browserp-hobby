import { createHmac, timingSafeEqual } from "node:crypto";
import { stripeConfig } from "./config.js";

const CHECKOUT_SIGNATURE_FIELDS = [
  "browserp_integration",
  "user_id",
  "product_key",
  "price_id",
  "quantity",
  "credits_per_unit",
  "unit_amount",
  "currency",
  "checkout_attempt_id",
  "browserp_release",
  "catalog_version"
];

function checkoutSignaturePayload(metadata) {
  return CHECKOUT_SIGNATURE_FIELDS
    .map((key) => `${key}=${String(metadata?.[key] ?? "")}`)
    .join("\n");
}

export function checkoutMetadataSignature(metadata, secret) {
  if (!secret) throw new Error("Checkout metadata signing is not configured.");
  return createHmac("sha256", secret)
    .update(`browserp-checkout-v1\n${checkoutSignaturePayload(metadata)}`)
    .digest("hex");
}

export function verifyCheckoutMetadataSignature(metadata, secret) {
  const supplied = String(metadata?.checkout_signature || "");
  if (!/^[0-9a-f]{64}$/i.test(supplied) || !secret) return false;
  const expected = checkoutMetadataSignature(metadata, secret);
  return timingSafeEqual(Buffer.from(supplied, "hex"), Buffer.from(expected, "hex"));
}

export function encodeForm(fields, prefix = "") {
  const params = new URLSearchParams();
  const visit = (value, key) => {
    if (value === undefined || value === null) return;
    if (Array.isArray(value)) {
      value.forEach((child, index) => visit(child, `${key}[${index}]`));
      return;
    }
    if (typeof value === "object") {
      for (const [childKey, child] of Object.entries(value)) visit(child, key ? `${key}[${childKey}]` : childKey);
      return;
    }
    params.append(key, String(value));
  };
  visit(fields, prefix);
  return params;
}

export async function stripeRequest(path, { method = "GET", body, idempotencyKey } = {}) {
  const config = stripeConfig();
  if (!config.secretKey) throw Object.assign(new Error("Payments are not configured yet."), { status: 503 });
  const headers = {
    Authorization: `Bearer ${config.secretKey}`,
    "Stripe-Version": "2026-06-24.dahlia",
    "User-Agent": "BrowseRP/1.3.0"
  };
  if (body !== undefined) headers["Content-Type"] = "application/x-www-form-urlencoded";
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
  const response = await fetch(`https://api.stripe.com/v1/${path.replace(/^\//, "")}`, {
    method,
    headers,
    body: body === undefined ? undefined : encodeForm(body)
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw Object.assign(new Error(payload?.error?.message || "Payment provider request failed."), {
      status: response.status,
      payload
    });
  }
  return payload;
}

export async function stripePrice(priceId) {
  return stripeRequest(`prices/${encodeURIComponent(priceId)}?expand[]=product`);
}

export function stripeCatalogPriceMatches(price, expected) {
  const product = price?.product && typeof price.product === "object" ? price.product : null;
  return Boolean(
    price?.id === expected.priceId
    && price.active === true
    && price.type === "one_time"
    && Number(price.unit_amount) === expected.unitAmount
    && String(price.currency || "").toLowerCase() === expected.currency
    && product?.active === true
    && String(product.metadata?.browserp_product_key || "") === expected.productKey
    && String(product.metadata?.browserp_credit_amount || "") === String(expected.credits)
  );
}

export function verifyStripeSignature(rawBody, signatureHeader, secret, toleranceSeconds = 300) {
  const parts = String(signatureHeader || "").split(",").map((part) => part.trim().split("="));
  const timestamp = parts.find(([key]) => key === "t")?.[1];
  const signatures = parts.filter(([key]) => key === "v1").map(([, value]) => value);
  if (!timestamp || !signatures.length || !secret) return false;
  if (!/^\d{10,}$/.test(timestamp)) return false;
  if (Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp)) > toleranceSeconds) return false;
  const expected = createHmac("sha256", secret).update(`${timestamp}.${rawBody.toString("utf8")}`).digest("hex");
  const expectedBuffer = Buffer.from(expected);
  return signatures.some((candidate) => {
    if (!/^[0-9a-f]{64}$/i.test(candidate)) return false;
    const candidateBuffer = Buffer.from(candidate);
    return candidateBuffer.length === expectedBuffer.length && timingSafeEqual(candidateBuffer, expectedBuffer);
  });
}

export async function checkoutLineItems(sessionId) {
  return stripeRequest(`checkout/sessions/${encodeURIComponent(sessionId)}/line_items?limit=10&expand[]=data.price.product`);
}
