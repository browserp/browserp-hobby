import { assertCsrf, assertSameOrigin, readBody } from "./http.js";
import { getSession, rpc } from "./supabase.js";
import { memberRateLimit } from "./rate-limit.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const id = value => { if (typeof value !== "string" || !UUID.test(value)) throw fail("Refresh staff availability before trying again."); return value.toLowerCase(); };
const defaults = { getSession, rpc, memberRateLimit };

// Keep the existing route for availability. Historical work records are retained
// privately; clock-in, hours and session corrections are no longer supported.
// The database independently checks current staff access using the caller token.
export async function staffDuty(req, res, dependencies = defaults) {
  const deps = { ...defaults, ...dependencies };
  if (!["GET", "POST"].includes(req.method)) throw fail("Method not allowed.", 405);
  if (req.method === "POST") { assertSameOrigin(req); assertCsrf(req); }
  const session = await deps.getSession(req, res, { required: true, provider: "discord" });
  if (!session?.accessToken || !session.user?.id || req.headers?.["x-browserp-account"] !== session.user.id) throw fail("Your account changed. Refresh before viewing or changing staff availability.", 401);
  if (session.aal !== "aal2") throw fail("Verify your staff authenticator before changing availability.", 403);
  if (req.method === "GET") {
    const query = new URL(req.url, "https://browserp.invalid").searchParams;
    const view = query.get("view") || "self";
    if (view === "team" || ["from", "to", "before", "beforeId", "userId"].some(key => query.has(key))) throw fail("Staff hours are no longer available.", 410);
    if (!["self", "availability"].includes(view)) throw fail("Choose an availability view.");
    const limit = query.has("limit") ? Number(query.get("limit")) : 25;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) throw fail("Choose between 1 and 100 records.");
    if (view !== "availability" && query.has("afterUserId")) throw fail("Choose the staff availability view to use a page cursor.");
    return deps.rpc("staff_duty_read", {
      p_view: view, p_limit: limit,
      p_after_user_id: query.has("afterUserId") ? id(query.get("afterUserId")) : null
    }, session.accessToken);
  }
  const body = await readBody(req, 4096);
  if (["clock_in", "clock_out", "confirm_session", "correct_session"].includes(body.action)) throw fail("Staff clock-in and work sessions are no longer available.", 410);
  if (body.action !== "set_availability") throw fail("Choose an availability action.");
  if (!["available", "busy", "away"].includes(body.availability)) throw fail("Choose Available, Busy or Away.");
  const values = { p_action: body.action, p_key: id(body.requestKey), p_availability: body.availability };
  await deps.memberRateLimit(req, "staff-duty", 60, 300, session.user.id, 300);
  return deps.rpc("staff_duty_mutate", values, session.accessToken);
}
