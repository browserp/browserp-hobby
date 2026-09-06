import { assertCsrf, assertSameOrigin, readBody } from "./http.js";
import { getSession, rpc } from "./supabase.js";
import { rateLimit } from "./rate-limit.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail = message => Object.assign(new Error(message), { status: 400 });
function id(value) { if (!UUID.test(String(value || ""))) throw fail("Refresh the request before trying again."); return value; }
function version(value) { if (!Number.isSafeInteger(value) || value < 1) throw fail("Refresh the request before saving."); return value; }
function details(value) {
  if (value !== undefined && typeof value !== "string") throw fail("Use plain text for your request.");
  const text = (value || "").trim();
  if (text.length > 1000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(text)) throw fail("Keep the request under 1,000 characters, without attachments or private codes.");
  return text;
}
async function sessionFor(req, res, staff) {
  if (!["GET", "POST"].includes(req.method)) throw Object.assign(new Error("Method not allowed."), { status: 405 });
  if (req.method === "POST") { assertSameOrigin(req); assertCsrf(req); }
  // The invoked database functions independently check the live session,
  // membership and permission. No service credential reads these request rows.
  const session = await getSession(req, res, { required: true, ...(staff ? { provider: "discord" } : {}) });
  // A form opened under a different account must never act as the newly
  // signed-in account after another tab changes the shared cookies.
  const expected = req.headers?.["x-browserp-account"];
  if (typeof expected !== "string" || expected !== session.user.id) throw Object.assign(new Error("Your account has changed. Refresh and sign in again before viewing private requests."), { status: 401 });
  return session;
}

export async function memberPrivacyRequests(req, res) {
  const session = await sessionFor(req, res, false);
  if (req.method === "GET") {
    const query = new URL(req.url, "https://browserp.invalid").searchParams;
    if (query.has("id")) return rpc("member_data_request_history", { p_id: id(query.get("id")), p_before_version: query.has("beforeVersion") ? version(Number(query.get("beforeVersion"))) : null }, session.accessToken);
    return rpc("member_data_requests", { p_action: "list" }, session.accessToken);
  }
  const body = await readBody(req, 8192);
  if (!["create", "update", "withdraw"].includes(body.action)) throw fail("Choose a request action.");
  const values = { p_action: body.action };
  if (body.action === "create") {
    if (!["copy", "delete", "correction"].includes(body.kind)) throw fail("Choose what you need help with.");
    Object.assign(values, { p_kind: body.kind, p_details: details(body.details), p_key: id(body.key) });
  } else Object.assign(values, { p_id: id(body.id), p_expected_version: version(body.version), ...(body.action === "update" ? { p_details: details(body.details) } : {}) });
  await rateLimit(req, "member-data-requests", 12, 3600);
  return rpc("member_data_requests", values, session.accessToken);
}

export async function staffPrivacyRequests(req, res) {
  const session = await sessionFor(req, res, true);
  const params = new URL(req.url, "https://browserp.invalid").searchParams;
  if (req.method === "GET" && params.get("access") === "1") return { canReview: session.aal === "aal2" && await rpc("staff_data_request_access", {}, session.accessToken) === true };
  if (session.aal !== "aal2") throw Object.assign(new Error("Verify your authenticator before reviewing private requests."), { status: 403 });
  if (req.method === "GET") {
    if (params.has("id")) return rpc("staff_data_request_history", { p_id: id(params.get("id")), p_before_version: params.has("beforeVersion") ? version(Number(params.get("beforeVersion"))) : null }, session.accessToken);
    const status = params.get("status") || "open", kind = params.get("kind") || null;
    if (!["open", "all", "submitted", "reviewing", "information_needed", "ready", "declined", "withdrawn", "fulfilled"].includes(status) || (kind && !["copy", "delete", "correction"].includes(kind))) throw fail("Choose valid request filters.");
    const time = params.get("before"), beforeId = params.get("beforeId");
    if (Boolean(time) !== Boolean(beforeId) || (time && (time.length > 40 || !Number.isFinite(Date.parse(time))))) throw fail("Refresh the request queue.");
    return rpc("staff_data_requests", { p_status: status, p_kind: kind, p_before_time: time ? new Date(time).toISOString() : null, p_before_id: beforeId ? id(beforeId) : null, p_limit: 25 }, session.accessToken);
  }
  const body = await readBody(req, 8192);
  if (body.action === "fulfill") {
    const result = details(body.result), evidence = details(body.evidence);
    const completed = typeof body.completedAt === "string" && body.completedAt.length <= 40 ? new Date(body.completedAt) : null;
    if (body.confirmed !== true || result.length < 30 || evidence.length < 20 || !["secure_delivery", "data_correction", "account_erasure"].includes(body.method)
      || !completed || !Number.isFinite(completed.getTime()) || completed.getTime() > Date.now()) throw fail("Describe the completed result and private reference, give its actual date, and confirm the follow-up was completed.");
    const values = { p_id: id(body.id), p_result: result, p_method: body.method, p_evidence: evidence, p_completed_at: completed.toISOString(), p_expected_version: version(body.version), p_key: id(body.key), p_confirmed: true };
    await rateLimit(req, "staff-data-request-completion", 10, 600);
    return rpc("staff_fulfill_data_request", values, session.accessToken);
  }
  if (body.action && body.action !== "review") throw fail("Choose a valid request action.");
  if (!["reviewing", "information_needed", "ready", "declined"].includes(body.status)) throw fail("Choose a review decision. Requests are not fulfilled automatically.");
  const values = { p_id: id(body.id), p_status: body.status, p_reply: details(body.reply), p_expected_version: version(body.version), p_key: id(body.key) };
  await rateLimit(req, "staff-data-requests", 40, 600);
  return rpc("staff_review_data_request", values, session.accessToken);
}
