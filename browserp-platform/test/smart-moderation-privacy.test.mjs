import test, { before, after, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { evaluateSyntheticContent, evaluationCli, readSyntheticFixtures } from "../scripts/evaluate-content-classifier.mjs";

const privacy = readFileSync(new URL("../public/privacy.html", import.meta.url), "utf8");
const operators = readFileSync(new URL("../docs/SMART_MODERATION_PRIVACY.md", import.meta.url), "utf8");
const section = privacy.match(/<section id="content-review">[\s\S]*?<\/section>/)?.[0];

test("release disclosure remains truthful before and after deliberate external activation", () => {
  assert.ok(section);
  assert.equal((privacy.match(/id="content-review"/g) || []).length, 1);
  assert.match(section, /When automatic checks are enabled, BrowseRP sends submitted comments, proposed display names and profile pictures to OpenAI/);
  assert.match(section, /names and pictures imported when you sign in/);
  assert.match(section, /without adding your account details or browsing history/);
  assert.match(section, /submitted content may itself contain personal information/);
  assert.match(section, /If automatic checks are disabled or cannot finish, new submissions wait privately for staff review/);
  assert.doesNotMatch(section, /not enabled at present|does not currently send|currently sends|automatic checks are currently enabled/i);
  assert.match(section, /Uncertain results and unavailable or failed checks go to staff review/);
  assert.match(section, /With automatic checks enabled, clearly acceptable comments and names can be published/);
  assert.match(section, /Profile pictures need staff approval before publication, even when an automatic check finds no concern/);
  assert.match(section, /Applications remain manually reviewed/);
  assert.doesNotMatch(section, /<script|<img|<iframe|OPENAI_API_KEY|CONTENT_MODERATION_PROVIDER|uploads-quarantine|omni-moderation|storage\/v1/i);
});

test("moderation disclosure keeps appeal, identity, legacy-media and erasure limits explicit", () => {
  assert.match(section, /Pending or blocked submissions and appeal statements[\s\S]*not published to visitors/);
  assert.match(section, /previously approved name or picture stays in use/);
  assert.match(section, /free staff review/);
  assert.match(section, /do not charge for an appeal or put a public warning label/);
  assert.match(section, /separate from optional recommendations/);
  assert.match(section, /does not make previously published copies or older public image links private/);
  assert.match(section, /does not itself confirm their deletion/);
  assert.doesNotMatch(section, /(?:deleted|removed|retained) (?:after|for|within) \d+ days|zero.retention|all images (?:are|will be) safe/i);
  assert.match(privacy, /href="\/profile#your-data"/);
  assert.match(privacy, /href="\/appeal"/);
});

test("operator guidance separates documentation from activation and addresses missing data coverage", () => {
  assert.match(operators, /Publish it only together with the working private-submission/);
  assert.match(operators, /Update the public notice \*\*before\*\* live external transmission/);
  assert.match(operators, /installs no provider, configures no key, changes no billing/);
  assert.match(operators, /not anonymisation/);
  assert.match(operators, /export\/erasure mappings/);
  assert.match(operators, /No duration or automatic deletion promise/);
  assert.match(operators, /https:\/\/developers\.openai\.com\/api\/docs\/guides\/your-data/);
  assert.match(operators, /https:\/\/developers\.openai\.com\/api\/docs\/guides\/moderation#review-supported-categories/);
  assert.match(operators, /Unsupported image categories can have zero scores/);
  assert.match(operators, /Local patterns cannot approve or block content/);
  assert.doesNotMatch(operators, /a locally established block can remain blocked/);
});

let unexpectedNetworkCalls = 0;
before(() => {
  mock.method(globalThis, "fetch", () => {
    unexpectedNetworkCalls++;
    throw new Error("Live network requests are forbidden in this offline test.");
  });
});
after(() => {
  mock.restoreAll();
  assert.equal(unexpectedNetworkCalls, 0);
});

const categories = ["harassment", "harassment/threatening", "hate", "hate/threatening", "illicit", "illicit/violent", "self-harm", "self-harm/intent", "self-harm/instructions", "sexual", "sexual/minors", "violence", "violence/graphic"];
const syntheticEnv = Object.freeze({ OPENAI_API_KEY: "offline-fixture-key", CONTENT_MODERATION_PROVIDER: "not-enabled" });
function moderationResponse(block = false) {
  return new Response(JSON.stringify({
    id: "modr-offline-fixture", model: "omni-moderation-2024-09-26", results: [{
      flagged: block,
      categories: Object.fromEntries(categories.map(category => [category, block && category === "harassment/threatening"])),
      category_scores: Object.fromEntries(categories.map(category => [category, block && category === "harassment/threatening" ? 0.99 : 0.001])),
      category_applied_input_types: Object.fromEntries(categories.map(category => [category, ["text"]]))
    }]
  }), { headers: { "Content-Type": "application/json" } });
}
function assertPrivateReceipt(result) {
  assert.deepEqual(Object.keys(result).sort(), ["complete", "durationMs", "error", "passed", "results"]);
  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes(syntheticEnv.OPENAI_API_KEY), false);
  for (const fixture of readSyntheticFixtures()) assert.equal(serialized.includes(fixture.text), false);
  for (const row of result.results) {
    assert.deepEqual(Object.keys(row).sort(), ["decision", "durationMs", "error", "expected", "id"]);
    assert.ok(Number.isInteger(row.durationMs) && row.durationMs >= 0);
  }
}

test("synthetic evaluator uses actual classifier and local signals once per bundled text fixture", async () => {
  const fixtures = readSyntheticFixtures();
  assert.ok(fixtures.length > 0 && fixtures.length <= 20);
  let calls = 0, active = 0, maximumActive = 0;
  const result = await evaluateSyntheticContent({ env: syntheticEnv, fetchImpl: async (url, options) => {
    const fixture = fixtures[calls++];
    active++; maximumActive = Math.max(maximumActive, active);
    try {
      assert.equal(url, "https://api.openai.com/v1/moderations");
      assert.equal(options.method, "POST"); assert.equal(options.redirect, "error");
      assert.equal(options.headers.Authorization, "Bearer " + syntheticEnv.OPENAI_API_KEY);
      assert.deepEqual(JSON.parse(options.body), { model: "omni-moderation-2024-09-26", input: [{ type: "text", text: fixture.text }] });
      await Promise.resolve();
      return moderationResponse(fixture.expected.includes("block"));
    } finally { active--; }
  } });
  assert.equal(result.complete, true); assert.equal(result.passed, true); assert.equal(result.error, null);
  assert.equal(calls, fixtures.length); assert.equal(maximumActive, 1);
  assert.equal(syntheticEnv.CONTENT_MODERATION_PROVIDER, "not-enabled");
  assert.equal(result.results.find(row => row.id === "duplicate_comment").decision, "review");
  assert.equal(result.results.find(row => row.id === "instruction_override").decision, "review");
  assertPrivateReceipt(result);
});

test("evaluator completes routing mismatches without retries and CLI returns failure", async () => {
  let calls = 0, output = "";
  const exitCode = await evaluationCli(["--run"], { env: syntheticEnv, fetchImpl: async () => {
    calls++; return moderationResponse();
  }, write: value => { output += value; } });
  const result = JSON.parse(output);
  assert.equal(exitCode, 1); assert.equal(result.complete, true); assert.equal(result.passed, false);
  assert.equal(result.error, "routing_mismatch");
  assert.equal(calls, readSyntheticFixtures().length);
  assert.equal(result.results.find(row => row.id === "direct_violent_threat").error, "unexpected_route");
  assertPrivateReceipt(result);
});

test("evaluator stops at the first provider failure and never copies error bodies or keys", async () => {
  const secretBody = "private-provider-body " + syntheticEnv.OPENAI_API_KEY;
  for (const fetchImpl of [
    async () => { throw new Error(secretBody); },
    async () => new Response(secretBody, { status: 401 }),
    async () => new Response(secretBody, { status: 429 }),
    async () => new Response(JSON.stringify({ error: secretBody }), { headers: { "Content-Type": "application/json" } })
  ]) {
    let calls = 0;
    const result = await evaluateSyntheticContent({ env: syntheticEnv, fetchImpl: async (...args) => { calls++; return fetchImpl(...args); } });
    assert.equal(calls, 1); assert.equal(result.complete, false); assert.equal(result.passed, false);
    assert.ok(["provider_unavailable", "invalid_provider_response"].includes(result.error));
    assert.equal(result.results.length, 1);
    assert.equal(JSON.stringify(result).includes(secretBody), false);
    assertPrivateReceipt(result);
  }
});

test("evaluator inherits classifier deadline and stricter settings without changing them", async () => {
  let calls = 0;
  const timeoutResult = await evaluateSyntheticContent({
    env: { ...syntheticEnv, CONTENT_MODERATION_TIMEOUT_MS: "50" },
    fetchImpl: async () => { calls++; return new Promise(() => {}); }
  });
  assert.equal(calls, 1); assert.equal(timeoutResult.error, "provider_timeout");
  assert.ok(timeoutResult.durationMs < 1000);
  const strictResult = await evaluateSyntheticContent({
    env: { ...syntheticEnv, CONTENT_MODERATION_SAFE_THRESHOLD: "0" },
    fetchImpl: async () => moderationResponse()
  });
  assert.equal(strictResult.results[0].decision, "review");
  assert.equal(strictResult.results[0].error, "unexpected_route");
  assertPrivateReceipt(timeoutResult); assertPrivateReceipt(strictResult);
});

test("evaluator requires explicit CLI execution, a key and valid classifier configuration", async () => {
  let calls = 0;
  const fetchImpl = async () => { calls++; throw new Error("Must not reach provider."); };
  for (const args of [[], ["--help"], ["--run", "--input", "private-command-content"], ["--fixtures=private-path"]]) {
    let output = "";
    const exitCode = await evaluationCli(args, { env: syntheticEnv, fetchImpl, write: value => { output += value; } });
    assert.equal(exitCode, args.length === 0 || args[0] === "--help" ? 0 : 2);
    assert.match(output, /Usage:/);
    assert.doesNotMatch(output, /private-command-content|private-path|offline-fixture-key/);
  }
  const missing = await evaluateSyntheticContent({ env: {}, fetchImpl });
  assert.equal(missing.error, "missing_key"); assert.equal(missing.results.length, 0);
  const invalid = await evaluateSyntheticContent({ env: { ...syntheticEnv, CONTENT_MODERATION_SAFE_THRESHOLD: "0.5" }, fetchImpl });
  assert.equal(invalid.error, "invalid_configuration");
  assert.equal(calls, 0);
  assertPrivateReceipt(missing); assertPrivateReceipt(invalid);
});
