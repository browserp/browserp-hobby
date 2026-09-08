import { createHash } from "node:crypto";
import { assertCsrf, assertSameOrigin, readBody } from "./http.js";
import { getSession, rpc } from "./supabase.js";
import { rateLimit } from "./rate-limit.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail = (message, status) => Object.assign(new Error(message), { status });

// A report is evidence for review, never authority to erase. No execution,
// acknowledgement, policy override or request-fulfilment action is accepted.
export async function staffAccountErasurePreflight(req, res) {
  if (req.method !== "POST") throw fail("Method not allowed.", 405);
  assertSameOrigin(req);
  assertCsrf(req);
  const session = await getSession(req, res, { required: true, provider: "discord" });
  if (typeof req.headers?.["x-browserp-account"] !== "string" || req.headers["x-browserp-account"] !== session.user.id) {
    throw fail("Your account has changed. Refresh before reviewing account removal.", 401);
  }
  if (session.aal !== "aal2") throw fail("Verify your authenticator before reviewing account removal.", 403);
  const body = await readBody(req, 2048);
  if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some(key => !["requestId", "version"].includes(key))
    || !UUID.test(String(body.requestId || "")) || !Number.isSafeInteger(body.version) || body.version < 1) {
    throw fail("Choose a current deletion request and refresh its version before reviewing it.", 400);
  }
  await rateLimit(req, "account-erasure-preflight", 10, 600);
  const report = await rpc("staff_account_erasure_preflight", { p_request_id: body.requestId, p_expected_version: body.version }, session.accessToken);
  if (report?.contractVersion !== 1 || report?.mode !== "read-only" || report?.executionEnabled !== false
    || report?.request?.id !== body.requestId || report?.request?.version !== body.version) {
    throw fail("The account-removal review could not be verified. Refresh and try again.", 503);
  }
  // A scan can overlap revocation or withdrawal. Release even count-only
  // private evidence only after another current permission/version check.
  const check = await rpc("staff_account_erasure_preflight_access", { p_request_id: body.requestId, p_expected_version: body.version }, session.accessToken);
  if (check !== true) throw fail("Refresh and verify your access before reviewing account removal.", 403);
  return {
    ...report,
    reportSha256: createHash("sha256").update(JSON.stringify(report)).digest("hex"),
    stages: accountErasureReviewStages(report)
  };
}

export function accountErasureReviewStages(report) {
  const complete = report?.coverage?.boundedCountsComplete === true && report?.coverage?.dependencyGraphComplete === true;
  return [
    { id: "inventory", state: complete ? "review_required" : "incomplete", evidence: "Fresh dependency counts and schema actions; manual evidence and external inventory remain required." },
    { id: "policy_and_ownership", state: "blocked", evidence: "Approve the retention scope, evidence handling, shared ownership and backup treatment before implementation of removal." },
    { id: "freeze_and_revoke", state: "not_implemented", evidence: "Revalidate the request, stop new writes and revoke sessions before any future erasure operation." },
    { id: "retained_evidence", state: "not_implemented", evidence: "Apply an approved minimisation and retention plan without disabling immutable-record safeguards." },
    { id: "media", state: "not_implemented", evidence: "Use the Storage API with a durable per-object retry ledger and readback; resolve shared media first." },
    { id: "application_and_auth", state: "not_implemented", evidence: "Resolve all restrictive references and remove Auth last, with durable retries and residual checks." },
    { id: "verification_and_follow_up", state: "not_implemented", evidence: "Verify remaining evidence and external copies; keep manual request fulfilment separate." }
  ];
}
