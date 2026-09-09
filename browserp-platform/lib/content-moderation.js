import { createHash, randomUUID } from "node:crypto";
import { classifyContent } from "./content-classifier.js";
import { supabaseConfig } from "./config.js";
import { assertSameOrigin, readBody } from "./http.js";
import { assessContent, assessDisplayName, sanitizePlainText } from "./moderation.js";
import { rateLimit } from "./rate-limit.js";
import { rasterType, staticServerPng } from "./server-media.js";
import { getSession, rest, rpc, uploadStorageObject } from "./supabase.js";

const MAX_IMAGE = 1_048_576;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const id = value => { if (!UUID.test(String(value || ""))) throw fail("Choose a valid content submission."); return value; };
const version = value => { if (!Number.isSafeInteger(value) || value < 1) throw fail("Reload this submission before deciding.", 409); return value; };
const service = { useSecret: true };

export function contentSignals(input) {
  const signals = [];
  if (input.duplicate) signals.push({ code: "duplicate", level: "review", reason: "Repeated comments need a staff review before publication." });
  if (input.kind === "display_name") {
    const assessment = assessDisplayName(input.text);
    if (!assessment.allowed) signals.push({ code: "name_rule", level: "review", reason: assessment.reason });
  }
  if (input.kind !== "avatar") {
    const assessment = assessContent({ text: input.text });
    if (assessment.action !== "accept") signals.push({ code: "content_rule", level: "review", reason: assessment.reasons.join(" ").slice(0, 500) });
  }
  return signals;
}

async function boundedBytes(response, maximum = MAX_IMAGE) {
  if (!response.ok || !response.body || Number(response.headers.get("content-length")) > maximum) {
    await response.body?.cancel(); throw fail("This picture is unavailable or too large.", 422);
  }
  const chunks = []; let length = 0;
  for await (const chunk of response.body) {
    length += chunk.byteLength;
    if (length > maximum) throw fail("This picture is too large.", 422);
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

export async function freezeOAuthPicture(value, { fetchImpl = fetch, signal } = {}) {
  signal?.throwIfAborted();
  let url; try { url = new URL(value); } catch { throw fail("The imported picture needs a new upload.", 422); }
  if (url.protocol !== "https:" || url.username || url.password || url.port
    || !["cdn.discordapp.com", "lh3.googleusercontent.com"].includes(url.hostname)) throw fail("The imported picture needs a new upload.", 422);
  const response = await fetchImpl(url.href, { redirect: "error", signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(4000)]) : AbortSignal.timeout(4000), headers: { Accept: "image/png,image/jpeg,image/webp" } });
  let bytes = await boundedBytes(response);
  const format = rasterType(bytes);
  if (!format || !["image/png", "image/jpeg", "image/webp"].includes(format.type)) throw fail("Upload a static PNG, JPEG or WebP picture.", 422);
  if (format.type === "image/png") bytes = staticServerPng(bytes);
  return { bytes, mimeType: format.type, extension: format.extension };
}

export async function registerPrivateAvatar(ownerId, bytes, mimeType = "image/png", deps = {}) {
  id(ownerId);
  deps.signal?.throwIfAborted();
  const extension = ({ "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" })[mimeType];
  if (!extension || !Buffer.isBuffer(bytes) || bytes.length < 24 || bytes.length > MAX_IMAGE) throw fail("Choose a prepared profile picture under 1 MB.", 422);
  const assetId = randomUUID(), path = `${ownerId}/${assetId}.${extension}`;
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  // Register before upload: even an interrupted write has a private owner record.
  await (deps.rest || rest)("uploaded_assets", { method: "POST", ...service, signal: deps.signal, body: {
    id: assetId, owner_id: ownerId, bucket: "uploads-quarantine", object_path: path,
    media_type: "avatar", mime_type: mimeType, byte_size: bytes.length, sha256,
    moderation_status: "quarantined", moderation_result: { source: "private-content-submission" }
  } });
  deps.signal?.throwIfAborted();
  await (deps.upload || uploadStorageObject)("uploads-quarantine", path, bytes, mimeType, { signal: deps.signal });
  return { id: assetId, sha256, byteSize: bytes.length };
}

export async function readContentAsset(submissionId, assetId, deps = {}) {
  const metadata = await (deps.rpc || rpc)("service_content_asset", { p_id: id(submissionId), p_asset: id(assetId) }, undefined, { ...service, signal: deps.signal });
  if (!metadata || metadata.bucket !== "uploads-quarantine" || !UUID.test(metadata.ownerId)
    || !new RegExp(`^${metadata.ownerId}/[0-9a-f-]{36}\\.(png|jpg|webp)$`, "i").test(metadata.path)
    || !/^[a-f0-9]{64}$/.test(metadata.sha256) || metadata.byteSize > MAX_IMAGE || metadata.byteSize < 24) throw fail("The private picture is unavailable.", 404);
  const config = (deps.config || supabaseConfig)();
  if (!config.url || !config.secretKey) throw fail("Picture storage is temporarily unavailable.", 503);
  const headers = { apikey: config.secretKey };
  if (config.secretKey.split(".").length === 3) headers.Authorization = `Bearer ${config.secretKey}`;
  const response = await (deps.fetch || fetch)(`${config.url}/storage/v1/object/authenticated/uploads-quarantine/${metadata.path.split("/").map(encodeURIComponent).join("/")}`, {
    headers, redirect: "error", signal: deps.signal ? AbortSignal.any([deps.signal, AbortSignal.timeout(5000)]) : AbortSignal.timeout(5000)
  });
  const bytes = await boundedBytes(response);
  if (bytes.length !== metadata.byteSize || createHash("sha256").update(bytes).digest("hex") !== metadata.sha256
    || rasterType(bytes)?.type !== metadata.mimeType) throw fail("The picture changed and needs a new review.", 409);
  return { bytes, mimeType: metadata.mimeType };
}

// The browser submits content only. This service reads canonical private input,
// stores a bounded checker result, then the active member RPC applies it.
export async function processContentCheck(session, submissionId, deps = {}) {
  const rpcImpl = deps.rpc || rpc, signal = AbortSignal.timeout(12_000);
  const call = (name, args, token, options = {}) => rpcImpl(name, args, token, { ...options, signal });
  const itemArgs = { p_id: id(submissionId) };
  const readCurrent = () => rpcImpl("member_content_moderation_item", itemArgs, session.accessToken, { signal: AbortSignal.timeout(2000) });
  let item = await call("member_content_moderation_item", itemArgs, session.accessToken);
  if (item.status !== "pending_review") return item;
  let input;
  try {
    input = await call("service_content_check_input", { p_id: item.id, p_owner: session.user.id }, undefined, service);
    if (!input) return await readCurrent();
    let image;
    if (input.kind === "avatar") {
      if (!input.assetId && input.sourceUrl) {
        const frozen = await (deps.freeze || freezeOAuthPicture)(input.sourceUrl, { signal });
        const asset = await (deps.register || registerPrivateAvatar)(session.user.id, frozen.bytes, frozen.mimeType, { signal });
        const attached = await call("service_attach_content_asset", { p_id: input.id, p_owner: session.user.id, p_version: input.version, p_asset: asset.id }, undefined, service);
        if (!attached) return await readCurrent();
        input = await call("service_content_check_input", { p_id: input.id, p_owner: session.user.id }, undefined, service);
      }
      if (input?.assetId) image = await (deps.readAsset || readContentAsset)(input.id, input.assetId, { signal });
    }
    if (!input) return await readCurrent();
    const assessment = await (deps.classify || classifyContent)({ kind: input.kind, text: input.kind === "avatar" ? undefined : input.text, imageBytes: image?.bytes, mimeType: image?.mimeType, signals: contentSignals(input) });
    // A successful stale check cannot change a new version or a staff decision.
    const recorded = await call("service_record_content_check", {
      p_id: input.id, p_owner: session.user.id, p_version: input.version, p_fingerprint: input.fingerprint, p_result: assessment
    }, undefined, service);
    if (recorded) item = await call("member_apply_content_check", { p_id: input.id, p_version: input.version }, session.accessToken);
  } catch {
    // Record one failed attempt where possible: later sign-ins do not repeatedly
    // fetch an unavailable provider picture or retry an uncertain checker.
    if (input) {
      try {
        const recorded = await call("service_record_content_check", {
          p_id: input.id, p_owner: session.user.id, p_version: input.version, p_fingerprint: input.fingerprint,
          p_result: { decision: "review", reason: input.kind === "avatar"
            ? "This picture could not be prepared for review. Please upload a new profile picture."
            : "A content check could not finish. Staff will review this submission.",
            checker: "unavailable", policyVersion: "content-v1", details: { code: "check_unavailable" } }
        }, undefined, service);
        if (recorded) await call("member_apply_content_check", { p_id: input.id, p_version: input.version }, session.accessToken);
      } catch { /* The database still keeps this submission privately pending. */ }
    }
  }
  // Recheck active-session ownership after any external work and get fresh state.
  return await readCurrent();
}

export async function processOAuthContent(session, deps = {}) {
  const call = deps.rpc || rpc;
  // Only the two most recent pending identity fields, once at sign-in. No polling.
  for (const kind of ["display_name", "avatar"]) {
    try {
      const item = await call("member_content_moderation_item", { p_target: session.user.id, p_kind: kind }, session.accessToken);
      if (item.status === "pending_review") await (deps.process || processContentCheck)(session, item.id);
    } catch { /* Signing in remains available while private review is pending. */ }
  }
}

function cursor(value) {
  if (!value) return null;
  if (value.length > 240) throw fail("Reload the content review list.");
  try {
    const result = JSON.parse(value);
    if (!result || Object.keys(result).sort().join(",") !== "createdAt,id" || !UUID.test(result.id)
      || typeof result.createdAt !== "string" || !Number.isFinite(Date.parse(result.createdAt))) throw new Error();
    return result;
  } catch { throw fail("Reload the content review list."); }
}

function contentPage(value) {
  return { items: Array.isArray(value?.items) ? value.items : [],
    nextBefore: value?.nextBefore ? JSON.stringify(value.nextBefore) : null };
}

export async function contentModeration(req, res, { staff = false, requestId, ...deps } = {}) {
  if (req.method === "POST") assertSameOrigin(req);
  const session = await (deps.getSession || getSession)(req, res, { required: true, ...(staff ? { provider: "discord" } : {}) });
  const call = deps.rpc || rpc, limit = deps.rateLimit || rateLimit;
  await limit(req, staff ? "staff-content-review" : "member-content-review", req.method === "GET" ? 60 : 20, 300);
  if (req.method === "GET") {
    const url = new URL(req.url, "http://browserp.local");
    const before = cursor(url.searchParams.get("before"));
    if (staff) {
      if (url.searchParams.has("id")) return { items: [await call("staff_content_moderation_item", { p_id: id(url.searchParams.get("id")) }, session.accessToken)], nextBefore: null };
      const kind = url.searchParams.get("kind") || "all";
      if (!["all", "comment", "display_name", "avatar"].includes(kind)) throw fail("Choose a valid content kind.");
      return contentPage(await call("staff_content_moderation", { p_kind: kind, p_before: before }, session.accessToken));
    }
    return contentPage(await call("member_content_moderation", { p_before: before }, session.accessToken));
  }
  const body = await readBody(req, 4096);
  const itemId = id(body.id), expectedVersion = version(body.expectedVersion);
  if (staff) {
    if (!["approve", "block"].includes(body.action)) throw fail("Choose a valid content decision.");
    const reason = sanitizePlainText(body.reason, 500);
    if (reason.length < 5) throw fail("Add a short reason of at least five characters.");
    return { item: await call("staff_decide_content", { p_id: itemId, p_version: expectedVersion, p_action: body.action, p_reason: reason, p_request_id: requestId }, session.accessToken) };
  }
  if (body.action !== "appeal") throw fail("Choose a valid appeal action.");
  const statement = sanitizePlainText(body.statement, 1000);
  if (statement.length < 5) throw fail("Explain your appeal in at least five characters.");
  return { item: await call("member_appeal_content", { p_id: itemId, p_version: expectedVersion, p_statement: statement }, session.accessToken) };
}

export async function contentAvatar(req, res, { publicImage = false, ...deps } = {}) {
  const url = new URL(req.url, "http://browserp.local"), itemId = id(url.searchParams.get("id"));
  const call = deps.rpc || rpc;
  let accessToken;
  if (!publicImage) accessToken = (await (deps.getSession || getSession)(req, res, { required: true })).accessToken;
  await (deps.rateLimit || rateLimit)(req, publicImage ? "public-profile-picture" : "private-profile-picture", 120, 300);
  const args = { p_id: itemId, p_public: publicImage };
  const access = await call("content_avatar_access", args, accessToken);
  if (!access?.assetId) throw fail("This picture is unavailable. Upload it again for review.", 404);
  const image = await (deps.readAsset || readContentAsset)(itemId, access.assetId);
  const current = await call("content_avatar_access", args, accessToken);
  if (current?.assetId !== access.assetId || current?.version !== access.version) throw fail("This picture changed. Reload it.", 409);
  res.setHeader("Content-Type", image.mimeType);
  res.setHeader("Content-Length", image.bytes.length);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Security-Policy", "default-src 'none'; sandbox");
  res.setHeader("Cache-Control", "private, no-store");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.statusCode = 200; res.end(image.bytes);
}
