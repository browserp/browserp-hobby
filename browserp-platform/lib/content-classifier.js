const POLICY_VERSION = "content-v1";
const MODEL = "omni-moderation-2024-09-26";
const ENDPOINT = "https://api.openai.com/v1/moderations";
const MAX_RESPONSE_BYTES = 64 * 1024;
const CATEGORIES = Object.freeze([
  "harassment", "harassment/threatening", "hate", "hate/threatening", "illicit", "illicit/violent",
  "self-harm", "self-harm/intent", "self-harm/instructions", "sexual", "sexual/minors", "violence", "violence/graphic"
]);
// https://developers.openai.com/api/docs/guides/moderation#review-supported-categories
const IMAGE_CATEGORIES = new Set(["self-harm", "self-harm/intent", "self-harm/instructions", "sexual", "violence", "violence/graphic"]);
// A broad violence/illicit/self-harm match is not enough to distinguish game
// discussion or help-seeking from content that violates the community policy.
const BLOCK_CATEGORIES = new Set(CATEGORIES.filter(category => !["violence", "illicit", "self-harm", "self-harm/intent"].includes(category)));
const MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const OVERRIDE_LANGUAGE = /(?:ignore|disregard|override)\s+(?:(?:all|the|any)\s+)?(?:(?:previous|prior|system|moderation|safety)\s+)+(?:instructions?|rules?|checks?|polic(?:y|ies))|(?:return|output|respond\s+with)\s+["'{\s]*(?:approved?|safe|allow)|(?:system|developer)\s*:/i;

class CheckFailure extends Error {
  constructor(code) { super("Content check could not be completed."); this.code = code; }
}
const fail = code => { throw new CheckFailure(code); };
const record = value => value !== null && typeof value === "object" && !Array.isArray(value);
const result = (decision, reason, checker, details = {}) => ({ decision, reason, policyVersion: POLICY_VERSION, checker, details });
const review = (code, checker = "local", details = {}) => result("review", "This content needs a staff review before publication.", checker, { ...details, code });

function readSetting(source, name) {
  const value = typeof source === "function" ? source(name) : source?.[name];
  if (value === undefined || value === null) return "";
  if (typeof value !== "string" && typeof value !== "number") fail("invalid_configuration");
  return String(value).trim();
}

function settingNumber(source, name, fallback, minimum, maximum) {
  const raw = readSetting(source, name);
  if (!raw) return fallback;
  if (!/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(raw)) fail("invalid_configuration");
  const value = Number(raw);
  if (!Number.isFinite(value) || value < minimum || value > maximum) fail("invalid_configuration");
  return value;
}

function validateSignals(signals) {
  if (!Array.isArray(signals) || signals.length > 16) fail("invalid_local_signals");
  for (const signal of signals) {
    if (!record(signal) || typeof signal.code !== "string" || !/^[a-z][a-z0-9_.-]{0,63}$/.test(signal.code)
      || !["block", "review"].includes(signal.level) || typeof signal.reason !== "string"
      || !signal.reason.trim() || signal.reason.length > 240 || /[<>\p{Cc}\p{Cf}]/u.test(signal.reason)) fail("invalid_local_signals");
  }
  // Reasons can accidentally contain submitted content. Never retain them or
  // provider messages; only these server-derived identifiers enter the audit.
  return [...new Set(signals.map(signal => signal.code))];
}

function prepareInput({ kind, text, imageBytes, mimeType }) {
  if (!["comment", "display_name", "avatar"].includes(kind)) fail("unsupported_content_kind");
  if (kind === "avatar") {
    if (!(imageBytes instanceof Uint8Array) || imageBytes.byteLength < 1 || imageBytes.byteLength > 1024 * 1024
      || !MIME_TYPES.has(mimeType) || (text !== undefined && text !== "")) fail("invalid_image_input");
    return [{ type: "image_url", image_url: { url: `data:${mimeType};base64,${Buffer.from(imageBytes).toString("base64")}` } }];
  }
  if (typeof text !== "string" || !text.trim() || text.length > 1000 || imageBytes !== undefined || mimeType !== undefined) fail("invalid_text_input");
  // Submitted text is data for a classifier, never a prompt or a configuration.
  return [{ type: "text", text }];
}

function exactCategories(value) {
  return record(value) && Object.keys(value).length === CATEGORIES.length && CATEGORIES.every(category => Object.hasOwn(value, category));
}

function validateProvider(payload, image) {
  if (!record(payload) || typeof payload.id !== "string" || !/^modr-[A-Za-z0-9_-]{1,160}$/.test(payload.id)
    || payload.model !== MODEL || !Array.isArray(payload.results) || payload.results.length !== 1) fail("invalid_provider_response");
  const item = payload.results[0];
  if (!record(item) || typeof item.flagged !== "boolean" || !exactCategories(item.categories)
    || !exactCategories(item.category_scores) || !exactCategories(item.category_applied_input_types)) fail("incomplete_provider_coverage");
  for (const category of CATEGORIES) {
    const score = item.category_scores[category], flag = item.categories[category], types = item.category_applied_input_types[category];
    if (typeof flag !== "boolean" || typeof score !== "number" || !Number.isFinite(score) || score < 0 || score > 1
      || !Array.isArray(types)) fail("invalid_provider_response");
    const expected = image ? (IMAGE_CATEGORIES.has(category) ? "image" : null) : "text";
    if (expected ? types.length !== 1 || types[0] !== expected : types.length !== 0) fail("incomplete_provider_coverage");
    // Unsupported image scores cannot establish a policy violation or safety.
    if (!expected && flag) fail("incomplete_provider_coverage");
  }
  if (item.flagged !== CATEGORIES.some(category => item.categories[category])) fail("inconsistent_provider_response");
  return item;
}

async function readResponse(response, signal) {
  if (!response || response.ok !== true || response.redirected === true) fail("provider_unavailable");
  if (!/^application\/json(?:\s*;|$)/i.test(response.headers?.get("content-type") || "")) fail("invalid_provider_response");
  const declared = response.headers.get("content-length");
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > MAX_RESPONSE_BYTES)) fail("provider_response_too_large");
  const reader = response.body?.getReader();
  if (!reader) fail("invalid_provider_response");
  const chunks = [];
  let length = 0, complete = false;
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener("abort", cancel, { once: true });
  try {
    if (signal.aborted) fail("provider_timeout");
    for (;;) {
      const { value, done } = await reader.read();
      if (signal.aborted) fail("provider_timeout");
      if (done) { complete = true; break; }
      if (!(value instanceof Uint8Array)) fail("invalid_provider_response");
      length += value.byteLength;
      if (length > MAX_RESPONSE_BYTES) fail("provider_response_too_large");
      chunks.push(Buffer.from(value));
    }
    try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks))); }
    catch { fail("invalid_provider_response"); }
  } finally {
    signal.removeEventListener("abort", cancel);
    if (!complete) cancel();
    reader.releaseLock();
  }
}

/** Signals must be derived by the server, never copied from a submitted body.
 * The current local detectors are contextual regex/duplicate hints, so neither
 * approval nor blocking is possible from them alone, regardless of their level.
 * A future deterministic block detector requires an explicit policy change.
 * This module never persists,
 * logs, retries, configures a provider, or sends text alongside avatar bytes.
 */
export async function classifyContent(input = {}, deps = {}) {
  let checker = "local", controller, timer;
  try {
    if (!record(input)) return review("invalid_input");
    const { kind, text, signals = [] } = input;
    const providerInput = prepareInput(input);
    const signalCodes = validateSignals(signals);
    const localDetails = { signalCodes };
    const source = deps.env ?? process.env;
    if (readSetting(source, "CONTENT_MODERATION_PROVIDER") !== "openai") return review("provider_not_enabled", checker, localDetails);
    const key = readSetting(source, "OPENAI_API_KEY");
    if (!key) return review("provider_not_configured", checker, localDetails);
    if (key.length > 512 || /\s/.test(key)) return review("invalid_configuration", checker, localDetails);
    const safeThreshold = settingNumber(source, "CONTENT_MODERATION_SAFE_THRESHOLD", 0.01, 0, 0.01);
    const blockThreshold = settingNumber(source, "CONTENT_MODERATION_BLOCK_THRESHOLD", 0.95, 0.95, 1);
    const timeout = settingNumber(source, "CONTENT_MODERATION_TIMEOUT_MS", 4000, 50, 4000);
    if (!Number.isInteger(timeout) || safeThreshold >= blockThreshold) return review("invalid_configuration", checker, localDetails);
    const fetcher = deps.fetch ?? globalThis.fetch;
    if (typeof fetcher !== "function") return review("provider_unavailable", checker, localDetails);
    checker = `openai:${MODEL}`;
    controller = new AbortController();
    const deadline = new Promise((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new CheckFailure("provider_timeout")); }, timeout);
    });
    const operation = (async () => {
      const response = await fetcher(ENDPOINT, {
        method: "POST", redirect: "error", signal: controller.signal,
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ model: MODEL, input: providerInput })
      });
      return readResponse(response, controller.signal);
    })();
    const payload = await Promise.race([operation, deadline]);
    const item = validateProvider(payload, kind === "avatar");
    const covered = kind === "avatar" ? [...IMAGE_CATEGORIES] : CATEGORIES;
    const high = covered.filter(category => item.categories[category] && item.category_scores[category] >= blockThreshold && BLOCK_CATEGORIES.has(category));
    const details = { ...localDetails, safeThreshold, blockThreshold, coveredCategories: covered.length, code: "provider_uncertain" };
    if (high.length) return result("block", "The content check detected a clear policy violation.", checker, { ...details, code: "provider_policy_block", categories: high });
    if (kind === "avatar") return review("image_policy_coverage_incomplete", checker, details);
    // Legacy detectors sometimes call a broad string match a block. That is not
    // evidence of intent: anti-scam warnings and quotations can match as well.
    // Never trust an arbitrary signal code/level to authorize a local block.
    if (signals.length) return review("local_review_required", checker, details);
    if (/[\p{Cf}]|[\u0300-\u036f]{3,}/u.test(text) || OVERRIDE_LANGUAGE.test(text)) return review("ambiguous_or_obfuscated_text", checker, details);
    if (!item.flagged && CATEGORIES.every(category => item.category_scores[category] <= safeThreshold)) {
      return result("approve", "The available content checks found no policy concern.", checker, { ...details, code: "provider_low_risk" });
    }
    return review("provider_uncertain", checker, details);
  } catch (error) {
    return review(error instanceof CheckFailure ? error.code : "provider_unavailable", checker);
  } finally {
    clearTimeout(timer);
    controller?.abort();
  }
}
