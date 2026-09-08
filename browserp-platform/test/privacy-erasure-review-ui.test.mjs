import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";

const source = readFileSync(new URL("../public/privacy-requests.js", import.meta.url), "utf8");
const tick = () => new Promise(resolve => setImmediate(resolve));
const endpoint = "/api/admin/account-erasure-preflight";
const item = { id: "22222222-0000-4000-8000-000000000002", accountId: "33333333-0000-4000-8000-000000000003", kind: "delete", status: "submitted", version: 4, details: "PRIVATE_ERASURE_REQUEST_TEXT", staffReply: "", createdAt: "2026-09-08T10:00:00Z", updatedAt: "2026-09-08T10:00:00Z" };
const report = () => ({
  contractVersion: 1, mode: "read-only", executionEnabled: false, asOf: "2026-09-08T11:00:00Z",
  request: { id: item.id, version: item.version, status: item.status }, subjectId: item.accountId,
  coverage: { fullErasureInventory: false, boundedCountsComplete: false, dependencyGraphComplete: true, countLimit: 1000, dependencyPathsInspected: 37, missingRelations: [{ relation: "FORBIDDEN_MISSING_TABLE" }] },
  summary: { ownedServers: 1000, ownedServersCountIsLowerBound: true, otherOwnersAdvertsUsingUploads: 2, sharedAdvertsCountIsLowerBound: false, storedObjects: 1000, activeStaff: true },
  dependencies: [{ category: "stored_objects", via: [], count: 1000, countIsLowerBound: true, relation: "FORBIDDEN_RELATION", triggers: ["FORBIDDEN_TRIGGER"], objectPath: "FORBIDDEN_OBJECT_PATH" }],
  stages: [
    { id: "inventory", state: "incomplete" }, { id: "policy_and_ownership", state: "blocked" },
    ...["freeze_and_revoke", "retained_evidence", "media", "application_and_auth", "verification_and_follow_up"].map(id => ({ id, state: "not_implemented", evidence: '<img src=x onerror="FORBIDDEN_SCRIPT">' }))
  ],
  policyDecisions: [{ decision: "FORBIDDEN_PRIVATE_DECISION" }], technicalBlockers: [{ detail: "FORBIDDEN_PRIVATE_DETAIL" }], warnings: ["FORBIDDEN_WARNING"], reportSha256: "FORBIDDEN_DIGEST", privateMetadata: "FORBIDDEN_METADATA"
});

async function harness(t, { isOwner = true, canFulfill = true, staff = true, allowed = true, items = [item], preflight = async () => report() } = {}) {
  const dom = new JSDOM('<section id="root"></section>', { url: "https://browserp.test/staff/moderation", runScripts: "outside-only" });
  t.after(() => dom.window.close());
  const w = dom.window, root = w.document.querySelector("#root"), calls = [], failures = [];
  w.eval(source);
  const controller = w.BrowseRPPrivacyRequests[staff ? "initStaff" : "initMember"]({
    root, isOwner, allowed, accountId: "owner-account", onAuthFailure: error => failures.push(error.status),
    api: async (path, options) => { calls.push({ path, options }); return path === endpoint ? preflight() : { items, canFulfill }; }
  });
  await tick();
  return { w, root, controller, calls, failures, text: () => root.textContent,
    button: text => [...root.querySelectorAll("button")].find(button => button.textContent === text),
    section: () => root.querySelector(".privacy-request-erasure-review") };
}

test("owner review renders bounded counts and fixed stage labels without report metadata or completion writes", async t => {
  const h = await harness(t);
  assert.equal(h.calls.filter(call => call.path === endpoint).length, 0, "opening the queue does not run a scan");
  h.button("Check current account records").click(); await tick();
  const call = h.calls.find(call => call.path === endpoint);
  assert.equal(call.options.method, "POST");
  assert.deepEqual(JSON.parse(call.options.body), { requestId: item.id, version: item.version });
  assert.equal(call.options.headers["X-BrowseRP-Account"], "owner-account");
  assert.match(h.text(), /Owned listings: At least 1,000/);
  assert.match(h.text(), /Stored files: At least 1,000/);
  assert.match(h.text(), /Other owners’ adverts using this account’s uploads: 2/);
  assert.match(h.text(), /37 record links checked/);
  assert.match(h.text(), /Counts can overlap/);
  assert.match(h.text(), /database check is incomplete/);
  assert.match(h.text(), /Some record types are absent/);
  assert.match(h.text(), /Check the account inventory: Incomplete/);
  assert.match(h.text(), /Decide retention and shared ownership: Awaiting decisions/);
  assert.match(h.text(), /Remove uploaded files: Not available/);
  assert.match(h.text(), /No data was deleted and the request remains open/);
  assert.doesNotMatch(h.text(), /FORBIDDEN_|<img/);
  assert.equal(h.root.querySelector("img,script,pre"), null);
  assert.equal(h.calls.filter(call => call.options.method === "POST").length, 1);
  assert.ok(h.button("Record review"), "existing request review remains available");
});

test("members, delegated nonowners, denied fulfilment and closed or nondelete requests never get the review control", async t => {
  for (const options of [
    { staff: false }, { allowed: false }, { isOwner: false }, { isOwner: "true" }, { canFulfill: false }, { canFulfill: "true" },
    ...["declined", "withdrawn", "fulfilled", "unknown"].map(status => ({ items: [{ ...item, status }] })),
    ...["copy", "correction"].map(kind => ({ items: [{ ...item, kind }] }))
  ]) {
    const h = await harness(t, options);
    assert.equal(h.section(), null); assert.equal(h.calls.some(call => call.path === endpoint), false);
  }
  for (const status of ["submitted", "reviewing", "information_needed", "ready"]) {
    const h = await harness(t, { items: [{ ...item, status }] });
    assert.ok(h.section());
    if (status === "ready") assert.ok(h.root.querySelector(".privacy-request-completion"), "independent completion form is preserved");
  }
});

test("complete bounded checks still require external review and missing storage is never invented as zero", async t => {
  const value = report(); value.coverage.boundedCountsComplete = true; value.coverage.missingRelations = [];
  value.summary.ownedServers = 0; value.summary.ownedServersCountIsLowerBound = false;
  value.summary.storedObjects = 0; value.dependencies = []; value.stages[0].state = "review_required";
  const h = await harness(t, { preflight: async () => value });
  h.button("Check current account records").click(); await tick();
  assert.match(h.text(), /Owned listings: 0/); assert.match(h.text(), /Stored files: Not fully checked/);
  assert.match(h.text(), /bounded database check finished/); assert.match(h.text(), /backups still need separate review/);
  assert.match(h.text(), /Check the account inventory: Review required/);
});

test("changed request bindings, execution claims and malformed or excessive data fail closed", async t => {
  const changes = [
    value => { value.request.version++; }, value => { value.request.id = "another-request"; },
    value => { value.request.status = "withdrawn"; }, value => { value.subjectId = "another-account"; },
    value => { value.executionEnabled = true; }, value => { value.summary.ownedServers = "FORBIDDEN_COUNT"; },
    value => { value.dependencies = Array(251).fill({}); }, value => { value.stages[1] = value.stages[0]; },
    value => { value.stages[0].state = "completed"; }, value => { value.coverage = null; }
  ];
  for (const change of changes) {
    const value = report(); change(value);
    const h = await harness(t, { preflight: async () => value });
    h.button("Check current account records").click(); await tick();
    assert.match(h.text(), /could not be verified/); assert.doesNotMatch(h.text(), /Snapshot counts|FORBIDDEN_|review loaded/);
  }
});

test("rechecking clears old evidence, prevents duplicate scans and uses safe retry messages", async t => {
  let calls = 0, reject;
  const h = await harness(t, { preflight: async () => ++calls === 1 ? report() : new Promise((resolve, fail) => { reject = fail; }) });
  const check = h.button("Check current account records"); check.click(); await tick(); assert.match(h.text(), /Snapshot counts/);
  check.click(); check.click(); await tick();
  assert.equal(calls, 2); assert.equal(check.disabled, true); assert.doesNotMatch(h.text(), /Snapshot counts/);
  reject(Object.assign(new Error("FORBIDDEN_PRIVATE_ERROR"), { status: 409 })); await tick();
  assert.match(h.text(), /request changed or closed/); assert.doesNotMatch(h.text(), /FORBIDDEN_|Snapshot counts/); assert.equal(check.disabled, false);
  for (const status of [429, 500]) {
    const failed = await harness(t, { preflight: async () => { throw Object.assign(new Error("FORBIDDEN_PRIVATE_ERROR"), { status }); } });
    failed.button("Check current account records").click(); await tick();
    assert.match(failed.text(), status === 429 ? /Wait a few minutes/ : /could not be loaded/); assert.doesNotMatch(failed.text(), /FORBIDDEN_/);
  }
});

test("permission or account loss clears request prose and any earlier report", async t => {
  for (const status of [401, 403]) {
    let denied = false;
    const h = await harness(t, { preflight: async () => { if (denied) throw Object.assign(new Error("FORBIDDEN_AUTH_ERROR"), { status }); return report(); } });
    h.button("Check current account records").click(); await tick(); assert.match(h.text(), /Snapshot counts/);
    denied = true; h.button("Check current account records").click(); await tick();
    assert.match(h.text(), /Sign in again/); assert.doesNotMatch(h.text(), /PRIVATE_ERASURE_REQUEST_TEXT|Snapshot counts|FORBIDDEN_/);
    assert.equal(h.section(), null); assert.deepEqual(h.failures, [status]);
  }
});

test("destroy, session end and page departure discard an in-flight report", async t => {
  for (const leave of [h => h.controller.destroy(), h => h.w.dispatchEvent(new h.w.Event("browserp:session-ended")), h => h.w.dispatchEvent(new h.w.Event("pagehide"))]) {
    let release;
    const h = await harness(t, { preflight: () => new Promise(resolve => { release = resolve; }) });
    h.button("Check current account records").click(); await tick(); leave(h); release(report()); await tick();
    assert.equal(h.text(), ""); assert.equal(h.section(), null);
  }
});

test("a report for a detached request card cannot reappear in the current queue", async t => {
  let release;
  const h = await harness(t, { preflight: () => new Promise(resolve => { release = resolve; }) });
  h.button("Check current account records").click(); await tick(); h.root.querySelector("article").remove();
  release(report()); await tick(); assert.doesNotMatch(h.text(), /Snapshot counts|review loaded/);
});
