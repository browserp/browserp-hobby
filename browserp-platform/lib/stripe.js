import { createHmac, timingSafeEqual } from "node:crypto";
import { stripeConfig } from "./config.js";

function encodeForm(fields, prefix = "") {
  const params = new URLSearchParams();
  const visit = (value, key) => {
    if (value === undefined || value === null) return;
    if (typeof value === "object" && !Array.isArray(value)) {
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
  const headers = { Authorization: `Bearer ${config.secretKey}` };
  if (body !== undefined) headers["Content-Type"] = "application/x-www-form-urlencoded";
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
  const response = await fetch(`https://api.stripe.com/v1/${path.replace(/^\//, "")}`, {
    method,
    headers,
    body: body === undefined ? undefined : encodeForm(body)
  });
  const payload = await response.json();
  if (!response.ok) throw Object.assign(new Error(payload?.error?.message || "Payment provider request failed."), { status: response.status, payload });
  return payload;
}

export function verifyStripeSignature(rawBody, signatureHeader, secret, toleranceSeconds = 300) {
  const parts = String(signatureHeader || "").split(",").map((part) => part.trim().split("="));
  const timestamp = parts.find(([key]) => key === "t")?.[1];
  const signatures = parts.filter(([key]) => key === "v1").map(([, value]) => value);
  if (!timestamp || !signatures.length || !secret) return false;
  if (Math.abs(Math.floor(Date.now() / 1000) - Number(timestamp)) > toleranceSeconds) return false;
  const expected = createHmac("sha256", secret).update(`${timestamp}.${rawBody.toString("utf8")}`).digest("hex");
  const expectedBuffer = Buffer.from(expected);
  return signatures.some((candidate) => {
    const candidateBuffer = Buffer.from(candidate);
    return candidateBuffer.length === expectedBuffer.length && timingSafeEqual(candidateBuffer, expectedBuffer);
  });
}

export async function checkoutLineItems(sessionId) {
  return stripeRequest(`checkout/sessions/${encodeURIComponent(sessionId)}/line_items?limit=10`);
}
