import { assertCsrf, assertSameOrigin, readBody } from "./http.js";
import { getSession, rpc } from "./supabase.js";
import { rateLimit } from "./rate-limit.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail = message => Object.assign(new Error(message), { status: 400 });
const id = value => { if (!UUID.test(String(value || ""))) throw fail("Refresh the enquiry before trying again."); return value; };
const version = value => { if (!Number.isSafeInteger(value) || value < 1) throw fail("Refresh the enquiry before saving."); return value; };
function plain(value, minimum, maximum, label) {
  if (typeof value !== "string") throw fail(`Add ${label}.`);
  const result = value.trim();
  if (result.length < minimum || result.length > maximum || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(result)) throw fail(`Keep ${label} between ${minimum} and ${maximum} characters of plain text.`);
  return result;
}
export function advertisingDestination(value) {
  const text = plain(value, 10, 1000, "the destination link");
  let url;
  try { url = new URL(text); } catch { throw fail("Use a public HTTPS destination link."); }
  // Only a normal public DNS name is accepted; no provider fetch is performed.
  if (url.protocol !== "https:" || url.username || url.password || url.port || /[\s\\]/.test(text)
    || !/^https:\/\/[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?(?:[/?#]|$)/i.test(text)
    || !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(url.hostname)
    || /(?:^|\.)(?:localhost|local|internal|test|invalid|example|lan|home|onion)$/i.test(url.hostname)) throw fail("Use a public HTTPS destination link without a sign-in or local address.");
  return url.href;
}
async function sessionFor(req, res, staff) {
  if (!["GET", "POST"].includes(req.method)) throw Object.assign(new Error("Method not allowed."), { status: 405 });
  if (req.method === "POST") { assertSameOrigin(req); assertCsrf(req); }
  const session = await getSession(req, res, { required: true, ...(staff ? { provider: "discord" } : {}) });
  if (req.headers?.["x-browserp-account"] !== session.user.id) throw Object.assign(new Error("Your account changed. Sign in again before viewing enquiries."), { status: 401 });
  return session;
}
function cursor(req) {
  const params = new URL(req.url, "https://browserp.invalid").searchParams;
  const time = params.get("before"), beforeId = params.get("beforeId");
  if (Boolean(time) !== Boolean(beforeId) || (time && (time.length > 40 || !Number.isFinite(Date.parse(time))))) throw fail("Refresh the enquiry list.");
  // Keep the database timestamp intact: Date serialization drops microseconds.
  return { p_before_time: time || null, p_before_id: beforeId ? id(beforeId) : null, p_limit: 25 };
}
export async function memberAdvertisingEnquiries(req, res) {
  const session = await sessionFor(req, res, false);
  if (req.method === "GET") return rpc("member_advertising_enquiries", { p_action: "list", ...cursor(req) }, session.accessToken);
  const body = await readBody(req, 16384);
  let values;
  if (body.action === "create") {
    if (typeof body.subject !== "string" || /[\u0000-\u001f\u007f]/.test(body.subject)) throw fail("Use a short, single-line subject.");
    if (!["any", "homepage", "directory", "game_pages"].includes(body.placement)) throw fail("Choose a placement preference.");
    values = { p_action: "create", p_key: id(body.key), p_data: {
      subject: plain(body.subject, 3, 120, "the subject"), destinationUrl: advertisingDestination(body.destinationUrl),
      placement: body.placement, message: plain(body.message, 20, 2000, "your message")
    } };
  } else if (body.action === "withdraw") values = { p_action: "withdraw", p_id: id(body.id), p_expected_version: version(body.version), p_key: id(body.key) };
  else throw fail("Choose an enquiry action.");
  await rateLimit(req, "member-advertising-enquiries", 12, 3600);
  return rpc("member_advertising_enquiries", values, session.accessToken);
}
export async function staffAdvertisingEnquiries(req, res) {
  const session = await sessionFor(req, res, true);
  const params = new URL(req.url, "https://browserp.invalid").searchParams;
  if (req.method === "GET" && params.get("access") === "1") return { canReview: session.aal === "aal2" && await rpc("staff_advertising_enquiry_access", {}, session.accessToken) === true };
  if (session.aal !== "aal2") throw Object.assign(new Error("Verify your authenticator before reviewing enquiries."), { status: 403 });
  if (req.method === "GET") {
    const status = params.get("status") || "open";
    if (!["open", "all", "submitted", "reviewing", "replied", "closed", "withdrawn"].includes(status)) throw fail("Choose an enquiry filter.");
    return rpc("staff_advertising_enquiries", { p_status: status, ...cursor(req) }, session.accessToken);
  }
  const body = await readBody(req, 16384);
  if (body.action !== "review" || !["reviewing", "replied", "closed"].includes(body.status)) throw fail("Choose a review action.");
  const values = { p_id: id(body.id), p_expected_version: version(body.version), p_status: body.status,
    p_reply: plain(body.reply ?? "", 0, 2000, "the reply"), p_key: id(body.key) };
  await rateLimit(req, "staff-advertising-enquiries", 40, 600);
  return rpc("staff_review_advertising_enquiry", values, session.accessToken);
}
