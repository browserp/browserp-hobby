import { assertCsrf, assertSameOrigin, readBody } from "./http.js";
import { getSession, rpc } from "./supabase.js";

const FIELDS = new Set(["schemaVersion", "choice", "expectedVersion"]);
const ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/;
const fail = (message, status = 400) => Object.assign(new Error(message), { status });

function preferenceResult(value, accountId) {
  const empty = value?.version === 0;
  if (!value || typeof value !== "object" || Array.isArray(value)
      || value.accountId !== accountId || value.schemaVersion !== 1
      || !Number.isSafeInteger(value.version) || value.version < 0
      || (empty ? value.choice !== null || value.updatedAt !== null
        : !["accepted", "rejected"].includes(value.choice)
          || typeof value.updatedAt !== "string" || !ISO_TIME.test(value.updatedAt) || !Number.isFinite(Date.parse(value.updatedAt)))) {
    throw fail("Your recommendation preference could not be verified. Please try again.", 503);
  }
  // Only the account-bound consent record crosses this boundary. No extra
  // backend field can become a collection instruction or leak into the client.
  return {
    accountId,
    schemaVersion: 1,
    choice: value.choice,
    version: value.version,
    updatedAt: value.updatedAt
  };
}

export async function memberPreferences(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (!["GET", "POST"].includes(req.method)) {
    res.setHeader("Allow", "GET, POST");
    throw fail("Method not allowed.", 405);
  }
  if (req.method === "POST") {
    assertSameOrigin(req);
    assertCsrf(req);
  }
  const session = await getSession(req, res, { required: true });
  const expectedAccount = req.headers?.["x-browserp-account"];
  if (typeof expectedAccount !== "string" || expectedAccount !== session.user.id) {
    throw fail("Your account changed. Refresh before viewing or changing recommendation preferences.", 401);
  }
  if (req.method === "GET") {
    return preferenceResult(await rpc("member_recommendation_preferences", {}, session.accessToken), session.user.id);
  }
  const body = await readBody(req, 1024);
  if (Object.keys(body).length !== FIELDS.size || Object.keys(body).some(key => !FIELDS.has(key))
      || body.schemaVersion !== 1 || !["accepted", "rejected"].includes(body.choice)
      || !Number.isSafeInteger(body.expectedVersion) || body.expectedVersion < 0) {
    throw fail("Choose a recommendation preference using the current saved version.");
  }
  const value = await rpc("member_set_recommendation_preferences", {
    p_schema_version: 1,
    p_choice: body.choice,
    p_expected_version: body.expectedVersion
  }, session.accessToken);
  const result = preferenceResult(value, session.user.id);
  if (result.choice !== body.choice || result.version === 0
      || (body.choice === "accepted" && result.version !== body.expectedVersion + 1)) {
    throw fail("Your recommendation preference could not be confirmed. Please try again.", 503);
  }
  return result;
}
