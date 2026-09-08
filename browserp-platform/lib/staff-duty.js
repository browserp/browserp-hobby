import { assertCsrf, assertSameOrigin, readBody } from "./http.js";
import { getSession, rpc } from "./supabase.js";
import { memberRateLimit } from "./rate-limit.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const id = value => { if (typeof value !== "string" || !UUID.test(value)) throw fail("Refresh the duty record before trying again."); return value.toLowerCase(); };
const timestamp = value => {
  if (typeof value !== "string" || value.length > 40 || !/^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(value) || !Number.isFinite(Date.parse(value))) throw fail("Choose a valid date and time, including its time zone.");
  return value; // Keep PostgreSQL cursor microseconds intact.
};
const defaults = { getSession, rpc, memberRateLimit, now: () => Date.now() };

// The database independently checks current staff access and management ACLs.
// No service credential reads or writes duty records.
export async function staffDuty(req, res, dependencies = defaults) {
  const deps = { ...defaults, ...dependencies };
  if (!["GET", "POST"].includes(req.method)) throw fail("Method not allowed.", 405);
  if (req.method === "POST") { assertSameOrigin(req); assertCsrf(req); }
  const session = await deps.getSession(req, res, { required: true, provider: "discord" });
  if (!session?.accessToken || !session.user?.id || req.headers?.["x-browserp-account"] !== session.user.id) throw fail("Your account changed. Refresh before viewing or changing staff duty.", 401);
  if (session.aal !== "aal2") throw fail("Verify your staff authenticator before viewing duty records.", 403);
  if (req.method === "GET") {
    const query = new URL(req.url, "https://browserp.invalid").searchParams;
    const view = query.get("view") || "self";
    if (!["self", "team", "availability"].includes(view)) throw fail("Choose a duty view.");
    const to = query.has("to") ? timestamp(query.get("to")) : new Date(deps.now()).toISOString();
    const from = query.has("from") ? timestamp(query.get("from")) : new Date(Date.parse(to) - 30 * 86400000).toISOString();
    if (Date.parse(to) <= Date.parse(from) || Date.parse(to) - Date.parse(from) > 93 * 86400000) throw fail("Choose a date range of up to 93 days.");
    const limit = query.has("limit") ? Number(query.get("limit")) : 25;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw fail("Choose between 1 and 100 records.");
    if (query.has("before") !== query.has("beforeId")) throw fail("Refresh the duty page cursor.");
    if (view !== "team" && query.has("userId")) throw fail("Only management can select another member's hours.", 403);
    return deps.rpc("staff_duty_read", {
      p_view: view, p_from: from, p_to: to, p_limit: limit,
      p_before: query.has("before") ? timestamp(query.get("before")) : null,
      p_before_id: query.has("beforeId") ? id(query.get("beforeId")) : null,
      p_user_id: query.has("userId") ? id(query.get("userId")) : null,
      p_after_user_id: query.has("afterUserId") ? id(query.get("afterUserId")) : null
    }, session.accessToken);
  }
  const body = await readBody(req, 4096);
  const actions = ["set_availability", "clock_in", "clock_out", "confirm_session", "correct_session"];
  if (!actions.includes(body.action)) throw fail("Choose a duty action.");
  const values = { p_action: body.action, p_key: id(body.requestKey), p_availability: null, p_session_id: null,
    p_version: null, p_started_at: null, p_ended_at: null, p_reason: null, p_confirmed: false };
  if (body.action === "set_availability") {
    if (!["available", "away", "off_duty"].includes(body.availability)) throw fail("Choose Available, Away or Off duty.");
    values.p_availability = body.availability;
  }
  if (["clock_out", "confirm_session", "correct_session"].includes(body.action)) {
    values.p_session_id = id(body.sessionId);
    if (!Number.isSafeInteger(body.version) || body.version < 1) throw fail("Refresh the work session before saving.");
    values.p_version = body.version;
  }
  if (["confirm_session", "correct_session"].includes(body.action)) {
    const reason = typeof body.reason === "string" ? body.reason.trim() : "";
    if (reason.length < 10 || reason.length > 500 || /[\u0000-\u001f\u007f]/.test(reason) || body.confirmed !== true) throw fail("Confirm the actual worked time and give a reason of 10–500 characters.");
    values.p_reason = reason; values.p_confirmed = true; values.p_ended_at = timestamp(body.endedAt);
    if (body.action === "correct_session") values.p_started_at = timestamp(body.startedAt);
  }
  await deps.memberRateLimit(req, "staff-duty", 60, 300, session.user.id, 300);
  return deps.rpc("staff_duty_mutate", values, session.accessToken);
}
