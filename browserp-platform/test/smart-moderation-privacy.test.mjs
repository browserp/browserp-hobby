import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const privacy = readFileSync(new URL("../public/privacy.html", import.meta.url), "utf8");
const operators = readFileSync(new URL("../docs/SMART_MODERATION_PRIVACY.md", import.meta.url), "utf8");
const section = privacy.match(/<section id="content-review">[\s\S]*?<\/section>/)?.[0];

test("release disclosure distinguishes inactive external classification from private review", () => {
  assert.ok(section);
  assert.equal((privacy.match(/id="content-review"/g) || []).length, 1);
  assert.match(section, /external AI checker is not enabled at present/);
  assert.match(section, /does not currently send submissions to OpenAI/);
  assert.match(section, /Uncertain results and unavailable or failed checks go to staff review/);
  assert.match(section, /When automated approval is available/);
  assert.match(section, /Pictures still need staff review where automated checks do not cover all relevant risks/);
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
});
