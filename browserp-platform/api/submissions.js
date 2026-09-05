import { createHash } from "node:crypto";
import { isIP } from "node:net";
import { endpoint, ok } from "../lib/api.js";
import {
  CURRENT_LISTING_STANDARDS_VERSION,
  CURRENT_TERMS_VERSION,
  supabaseConfig
} from "../lib/config.js";
import { assertSameOrigin, readBody } from "../lib/http.js";
import { assessContent, sanitizePlainText } from "../lib/moderation.js";
import { rateLimit } from "../lib/rate-limit.js";
import { getSession, rest, rpc } from "../lib/supabase.js";

// Retained for the v1 contract and rollback compatibility. New writes use the
// additive v2 RPC so production can accept idempotency and legal-version data
// without altering the already-applied function signature.
export const SERVER_SUBMISSION_RPC = "create_server_submission_server";
export const SERVER_SUBMISSION_V2_RPC = "create_server_submission_server_v2";
export const SERVER_SUBMISSION_CORRECTION_RPC = "resubmit_server_submission_server";
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

const SHORTENER_HOSTS = new Set([
  "bit.ly", "buff.ly", "cutt.ly", "goo.gl", "is.gd", "ow.ly", "rb.gy",
  "rebrand.ly", "shorturl.at", "t.co", "tiny.one", "tinyurl.com"
]);
const RESERVED_HOST_SUFFIXES = [
  ".arpa", ".example", ".home", ".internal", ".invalid", ".lan",
  ".local", ".localdomain", ".localhost", ".onion", ".test"
];

export function canonicalCommunityUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  if (raw.length > 300) {
    throw Object.assign(new Error("Community links must be 300 characters or fewer."), { status: 400 });
  }

  let parsed;
  try { parsed = new URL(raw); }
  catch { throw Object.assign(new Error("Enter a valid HTTPS community link."), { status: 400 }); }

  const hostname = parsed.hostname.toLowerCase().replace(/\.$/, "");
  if (parsed.protocol !== "https:" || raw.includes("#")
      || parsed.username || parsed.password || parsed.hash || parsed.port
      || !hostname || isIP(hostname)
      || hostname === "localhost"
      || RESERVED_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix))) {
    throw Object.assign(new Error("Use a public HTTPS link without credentials, fragments or custom ports."), { status: 400 });
  }
  if (SHORTENER_HOSTS.has(hostname) || [...SHORTENER_HOSTS].some((host) => hostname.endsWith(`.${host}`))) {
    throw Object.assign(new Error("Link shorteners are not accepted. Use the final community address."), { status: 400 });
  }

  const labels = hostname.split(".");
  if (labels.length < 2
      || hostname.length > 253
      || labels.some((label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label))
      || !/^(?:[a-z]{2,63}|xn--[a-z0-9-]{2,59})$/i.test(labels.at(-1))) {
    throw Object.assign(new Error("Use a normal public website, Discord invite, or Cfx join link."), { status: 400 });
  }

  const path = parsed.pathname.replace(/\/+$/, "");
  if (hostname === "discord.gg") {
    const match = path.match(/^\/([A-Za-z0-9_-]{2,64})$/);
    if (!match || parsed.search) throw Object.assign(new Error("Use a direct Discord invite link."), { status: 400 });
    return `https://discord.gg/${match[1]}`;
  }
  if (hostname === "discord.com" || hostname === "www.discord.com") {
    const match = path.match(/^\/invite\/([A-Za-z0-9_-]{2,64})$/i);
    if (!match || parsed.search) throw Object.assign(new Error("Use a direct Discord invite link."), { status: 400 });
    return `https://discord.gg/${match[1]}`;
  }
  if (hostname === "cfx.re" || hostname === "www.cfx.re") {
    const match = path.match(/^\/join\/([A-Za-z0-9]{3,32})$/i);
    if (!match || parsed.search) throw Object.assign(new Error("Use a direct Cfx join link."), { status: 400 });
    return `https://cfx.re/join/${match[1]}`;
  }

  parsed.hostname = hostname;
  const canonical = parsed.toString();
  if (canonical.length > 300) {
    throw Object.assign(new Error("Community links must be 300 characters or fewer."), { status: 400 });
  }
  return canonical;
}

export function buildServerSubmissionRpcPayload(userId, input, moderation) {
  return {
    p_user_id: userId,
    p_name: input.name,
    p_platform_id: input.platform,
    p_region: input.region,
    p_language: input.language,
    p_framework: input.framework || null,
    p_description: input.description,
    p_community_url: input.communityUrl || null,
    p_moderation_confidence: moderation.confidence,
    p_moderation_score: moderation.score,
    p_moderation_reasons: moderation.reasons
  };
}

function idempotencyHash(req, userId, requestId) {
  const raw = String(req.headers?.["idempotency-key"] || requestId).trim();
  if (!/^[A-Za-z0-9._:-]{8,200}$/.test(raw)) {
    throw Object.assign(new Error("Start a new submission attempt and try again."), { status: 400 });
  }
  return createHash("sha256").update(`${userId}\0${raw}`).digest("hex");
}

function buildV2Payload(userId, input, moderation, req, requestId) {
  return {
    ...buildServerSubmissionRpcPayload(userId, input, moderation),
    p_request_id: requestId,
    p_idempotency_key: idempotencyHash(req, userId, requestId),
    p_terms_version: CURRENT_TERMS_VERSION,
    p_standards_version: CURRENT_LISTING_STANDARDS_VERSION
  };
}

function acceptedAgreement(body) {
  return body.agreement === true || (
    body.authorizedListing === true
    && body.acceptedTerms === true
    && body.acceptedStandards === true
  );
}

function submissionInput(body) {
  const tags = Array.isArray(body.tags)
    ? [...new Set(body.tags.map((tag) => sanitizePlainText(tag, 40).toLowerCase()).filter(Boolean))]
    : [];
  if (tags.length > 8 || tags.some((tag) => !/^[a-z0-9-]{2,40}$/.test(tag))) {
    throw Object.assign(new Error("Choose up to eight valid server tags."), { status: 400 });
  }
  const accessType = sanitizePlainText(body.accessType || "public", 20).toLowerCase();
  if (!["public", "allowlisted", "application"].includes(accessType)) {
    throw Object.assign(new Error("Choose a valid server access type."), { status: 400 });
  }
  const cfxJoinUrl = canonicalCommunityUrl(body.cfxJoinUrl);
  if (cfxJoinUrl && !/^https:\/\/cfx\.re\/join\/[A-Za-z0-9]{3,32}\/?$/.test(cfxJoinUrl)) {
    throw Object.assign(new Error("Use a direct cfx.re/join link."), { status: 400 });
  }
  const input = {
    name: sanitizePlainText(body.name, 80),
    platform: sanitizePlainText(body.platform, 40),
    region: sanitizePlainText(body.region, 60),
    language: sanitizePlainText(body.language, 60),
    framework: sanitizePlainText(body.framework, 80),
    description: sanitizePlainText(body.description, 1_500),
    communityUrl: canonicalCommunityUrl(body.communityUrl),
    accessType,
    tags,
    cfxJoinUrl
  };
  if (!input.name || !input.platform || !input.region || !input.language || input.description.length < 40) {
    throw Object.assign(new Error("A name, platform, region, language and fuller description are required."), { status: 400 });
  }
  return input;
}

export default endpoint(["GET", "POST", "PATCH"], async (req, res, requestId) => {
  if (req.method !== "GET") assertSameOrigin(req);
  const session = await getSession(req, res, { required: true });
  const database = supabaseConfig();
  if (!database.privileged) {
    throw Object.assign(new Error("Listing submission is waiting for the server-only database boundary."), { status: 503 });
  }

  if (req.method === "GET") {
    await rateLimit(req, "owner-submissions-read", 30, 60);
    const id = new URL(req.url, "http://local").searchParams.get("id");
    if (id !== null) {
      if (!UUID.test(id)) throw Object.assign(new Error("Choose a valid submission from My account."), { status: 400 });
      const account = new URL(req.url, "http://local").searchParams.get("account");
      if (account !== null && account !== session.user.id) throw Object.assign(new Error("Your signed-in account changed. Sign in again to continue this correction."), { status: 401 });
      return ok(res, await rpc("member_server_submission", { p_submission_id: id }, session.accessToken));
    }
    const access = await rpc("member_connection_status", {}, session.accessToken);
    if (access?.active !== true || access.userId !== session.user.id) {
      throw Object.assign(new Error("Sign in again to view your submissions."), { status: 401 });
    }
    const submissions = await rest(
      `server_submissions?select=id,name,platform_id,region,language,framework,description,community_url,tags,access_type,cfx_join_url,status,review_note,terms_version,standards_version,created_at,updated_at&submitted_by=eq.${encodeURIComponent(session.user.id)}&order=created_at.desc&limit=50`,
      { useSecret: true }
    );
    return ok(res, { submissions: Array.isArray(submissions) ? submissions : [] });
  }

  await rateLimit(req, req.method === "PATCH" ? "submission-corrections" : "server-submission", req.method === "PATCH" ? 15 : 3, 3600);
  const body = await readBody(req);
  if (!acceptedAgreement(body)) {
    throw Object.assign(new Error("Confirm that you are authorised to list the server and accept the current terms and listing standards."), { status: 400 });
  }

  const input = submissionInput(body);
  const moderation = assessContent(input);
  if (moderation.action === "reject") {
    throw Object.assign(new Error("This submission contains a high-risk link or pattern and cannot be accepted."), { status: 422 });
  }

  if (req.method === "PATCH") {
    if (body.expectedAccountId !== session.user.id) {
      throw Object.assign(new Error("Your signed-in account changed. Sign in again to continue this correction."), { status: 401 });
    }
    if (!UUID.test(String(body.submissionId || "")) || !Number.isSafeInteger(body.expectedVersion) || body.expectedVersion < 1
        || !Number.isSafeInteger(body.expectedQueueVersion) || body.expectedQueueVersion < 0
        || !req.headers?.["idempotency-key"]) {
      throw Object.assign(new Error("Open the original submission from My account before sending corrections."), { status: 400 });
    }
    const access = await rpc("member_connection_status", {}, session.accessToken);
    if (access?.active !== true || access.userId !== session.user.id || !UUID.test(String(access.sessionId || ""))) {
      throw Object.assign(new Error("Sign in again before correcting your submission."), { status: 401 });
    }
    const submission = await rpc(SERVER_SUBMISSION_CORRECTION_RPC, {
      p_user_id: session.user.id,
      p_session_id: access.sessionId,
      p_submission_id: body.submissionId,
      p_expected_version: body.expectedVersion,
      p_expected_queue_version: body.expectedQueueVersion,
      p_idempotency_key: idempotencyHash(req, session.user.id, requestId),
      p_data: input,
      p_moderation_confidence: moderation.confidence,
      p_moderation_score: moderation.score,
      p_moderation_reasons: moderation.reasons,
      p_terms_version: CURRENT_TERMS_VERSION,
      p_standards_version: CURRENT_LISTING_STANDARDS_VERSION
    }, undefined, { useSecret: true });
    return ok(res, { submission }, 202);
  }

  const submission = await rpc(
    SERVER_SUBMISSION_V2_RPC,
    buildV2Payload(session.user.id, input, moderation, req, requestId),
    undefined,
    { useSecret: true }
  );
  const metadataFingerprint = createHash("sha256").update(JSON.stringify({
    tags: input.tags,
    accessType: input.accessType,
    cfxJoinUrl: input.cfxJoinUrl
  })).digest("hex");
  const metadata = await rpc("attach_server_submission_metadata_server", {
    p_user_id: session.user.id,
    p_submission_id: submission.id,
    p_tags: input.tags,
    p_access_type: input.accessType,
    p_cfx_join_url: input.cfxJoinUrl,
    p_metadata_fingerprint: metadataFingerprint
  }, undefined, { useSecret: true });
  return ok(res, { submission: { ...submission, ...metadata } }, 202);
});
