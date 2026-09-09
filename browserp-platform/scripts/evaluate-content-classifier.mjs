import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { classifyContent } from "../lib/content-classifier.js";
import { contentSignals } from "../lib/content-moderation.js";

const FIXTURE_URL = new URL("../test/fixtures/content-classifier-synthetic.json", import.meta.url);
const MAX_CASES = 20;
const DECISIONS = new Set(["approve", "review", "block"]);
const COMPLETED_CODES = new Set([
  "provider_low_risk", "provider_policy_block", "provider_uncertain",
  "local_review_required", "ambiguous_or_obfuscated_text"
]);
const ERROR_CODES = new Set([
  "invalid_input", "unsupported_content_kind", "invalid_text_input", "invalid_local_signals",
  "provider_not_enabled", "provider_not_configured", "invalid_configuration",
  "provider_unavailable", "provider_timeout", "provider_response_too_large",
  "invalid_provider_response", "incomplete_provider_coverage", "inconsistent_provider_response"
]);
const SETTING_NAMES = [
  "OPENAI_API_KEY", "CONTENT_MODERATION_SAFE_THRESHOLD",
  "CONTENT_MODERATION_BLOCK_THRESHOLD", "CONTENT_MODERATION_TIMEOUT_MS"
];
const USAGE = "Usage: node scripts/evaluate-content-classifier.mjs --run\n"
  + "Uses only the bundled synthetic text fixtures and a securely supplied OPENAI_API_KEY.\n"
  + "Writes a JSON routing receipt. Does not change the website provider setting.\n";

export function readSyntheticFixtures() {
  const source = readFileSync(FIXTURE_URL, "utf8");
  if (source.length > 32_768) throw new Error("Invalid synthetic fixtures.");
  const data = JSON.parse(source);
  if (!data || Object.keys(data).sort().join(",") !== "cases,provenance,schemaVersion"
    || data.schemaVersion !== 1 || data.provenance !== "handwritten_synthetic"
    || !Array.isArray(data.cases) || !data.cases.length || data.cases.length > MAX_CASES) {
    throw new Error("Invalid synthetic fixtures.");
  }
  const ids = new Set();
  for (const item of data.cases) {
    if (!item || typeof item !== "object" || Array.isArray(item)
      || Object.keys(item).some(key => !["id", "kind", "text", "expected", "duplicate"].includes(key))
      || typeof item.id !== "string" || !/^[a-z][a-z0-9_]{1,63}$/.test(item.id) || ids.has(item.id)
      || !["comment", "display_name"].includes(item.kind)
      || typeof item.text !== "string" || !item.text.trim() || item.text.length > 1000
      || !Array.isArray(item.expected) || !item.expected.length || item.expected.length > 2
      || new Set(item.expected).size !== item.expected.length || item.expected.some(value => !DECISIONS.has(value))
      || (Object.hasOwn(item, "duplicate") && (item.duplicate !== true || item.kind !== "comment"))) {
      throw new Error("Invalid synthetic fixtures.");
    }
    ids.add(item.id);
    Object.freeze(item.expected);
    Object.freeze(item);
  }
  return Object.freeze(data.cases);
}

function receipt(started, results, error = null, complete = false) {
  return {
    complete,
    passed: complete && error === null && results.every(item => item.error === null),
    error,
    durationMs: Math.max(0, Math.round(performance.now() - started)),
    results
  };
}

/** One pass over fixed synthetic text. No database, image, CLI content or file-path inputs. */
export async function evaluateSyntheticContent({ env = {}, fetchImpl = globalThis.fetch } = {}) {
  const started = performance.now(), results = [];
  let fixtures;
  try { fixtures = readSyntheticFixtures(); }
  catch { return receipt(started, results, "invalid_fixture_set"); }

  // This explicit dependency applies only to these classifier calls. Never set
  // process.env or the deployed CONTENT_MODERATION_PROVIDER to run an evaluation.
  let classifierEnv;
  try {
    if (!env || typeof env !== "object" || typeof fetchImpl !== "function") {
      return receipt(started, results, "invalid_configuration");
    }
    if (typeof env.OPENAI_API_KEY !== "string" || !env.OPENAI_API_KEY.trim()) {
      return receipt(started, results, "missing_key");
    }
    classifierEnv = Object.freeze({
      ...Object.fromEntries(SETTING_NAMES.filter(name => Object.hasOwn(env, name)).map(name => [name, env[name]])),
      CONTENT_MODERATION_PROVIDER: "openai"
    });
  } catch { return receipt(started, results, "invalid_configuration"); }

  for (const fixture of fixtures) {
    const caseStarted = performance.now();
    let assessment, requested = false;
    try {
      assessment = await classifyContent({
        kind: fixture.kind, text: fixture.text,
        signals: contentSignals({ kind: fixture.kind, text: fixture.text, duplicate: fixture.duplicate === true })
      }, {
        env: classifierEnv,
        fetch: async (...args) => {
          if (requested) throw new Error("Only one request per fixture is permitted.");
          requested = true;
          return fetchImpl(...args);
        }
      });
    } catch { return receipt(started, results, "evaluation_failed"); }

    const code = assessment?.details?.code;
    const failure = !requested || !DECISIONS.has(assessment?.decision) || !COMPLETED_CODES.has(code)
      ? ERROR_CODES.has(code) ? code : "evaluation_failed"
      : null;
    const decision = DECISIONS.has(assessment?.decision) ? assessment.decision : null;
    const mismatch = !failure && !fixture.expected.includes(decision);
    results.push({
      id: fixture.id,
      expected: fixture.expected,
      decision,
      durationMs: Math.max(0, Math.round(performance.now() - caseStarted)),
      error: failure || (mismatch ? "unexpected_route" : null)
    });
    // A timeout, denied key, rate limit or malformed response is not evaluation
    // evidence. Stop immediately; there is no retry or later background pass.
    if (failure) return receipt(started, results, failure);
  }
  return receipt(started, results, results.some(item => item.error) ? "routing_mismatch" : null, true);
}

export async function evaluationCli(args, { env = {}, fetchImpl = globalThis.fetch, write = value => process.stdout.write(value) } = {}) {
  if (args.length === 0 || (args.length === 1 && args[0] === "--help")) {
    write(USAGE); return 0;
  }
  if (args.length !== 1 || args[0] !== "--run") {
    write(USAGE); return 2;
  }
  const result = await evaluateSyntheticContent({ env, fetchImpl });
  write(JSON.stringify(result, null, 2) + "\n");
  return result.passed ? 0 : 1;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  process.exitCode = await evaluationCli(process.argv.slice(2), { env: process.env });
}
