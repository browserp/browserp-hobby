import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";

const source = readFileSync(new URL("../public/staffpanel-v3.js", import.meta.url), "utf8");
const instrumented = source.replace(
  /\r?\n  init\(\);\r?\n\}\)\(\);\s*$/,
  '\n  state.authorized = true; state.session = { aal: "aal2", mfa: { enrolled: true } }; window.__staffPermissionActions = { applyBan, securityControls };\n})();'
);
assert.notEqual(instrumented, source);
const json = (value, status = 200) => ({ ok: status < 400, status, json: async () => value });
const tick = () => new Promise(resolve => setImmediate(resolve));
const settle = async () => { for (let index = 0; index < 6; index += 1) await tick(); };

function harness(t, { access = {}, status = {}, requests = [] } = {}) {
  const dom = new JSDOM('<p id="staff-status-v3"></p><main id="mount"></main>', { url: "https://browserp.test/staffpanel/moderation", runScripts: "outside-only" });
  t.after(() => dom.window.close());
  const w = dom.window, calls = [];
  w.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  w.HTMLDialogElement.prototype.close = function () { this.open = false; };
  w.fetch = async (path, options = {}) => {
    calls.push({ path, options, body: options.body ? JSON.parse(options.body) : null });
    if (path === "/api/admin/bans?view=access") return json({ access });
    if (path === "/api/admin/security?view=status") return json({ status });
    if (path === "/api/admin/security?view=policy") return json({ policy: { staffMfaRequired: false } });
    if (path === "/api/admin/security?view=requests") return json({ revealRequests: requests });
    if (path === "/api/admin/security?view=retention") return json({ retention: [] });
    if (path === "/api/admin/bans" && options.method === "POST") return json({ result: { reference: "BRP-FIXTURE" } });
    return json({});
  };
  w.eval(instrumented);
  return { w, calls, mount: w.document.querySelector("#mount"), actions: w.__staffPermissionActions,
    button: label => [...w.document.querySelectorAll("button")].find(item => item.textContent === label) };
}

test("restriction choices exactly follow each server-returned staff cap", async t => {
  for (const [access, expected] of [
    [{ rank: 300, maxMinutes: 2880, canIndefinite: false, canDeviceNetwork: false }, ["2880"]],
    [{ rank: 500, maxMinutes: 4320, canIndefinite: false, canDeviceNetwork: false }, ["2880", "4320"]],
    [{ rank: 800, maxMinutes: 10080, canIndefinite: false, canDeviceNetwork: true }, ["2880", "4320", "10080"]],
    [{ rank: 850, maxMinutes: 43200, canIndefinite: false, canDeviceNetwork: true }, ["2880", "4320", "10080", "43200"]],
    [{ rank: 900, maxMinutes: null, canIndefinite: true, canDeviceNetwork: true }, ["2880", "4320", "10080", "43200", "unlimited"]]
  ]) {
    const h = harness(t, { access }); const pending = h.actions.applyBan({ id: 42, browser: "Fixture Browser", device: "Fixture device" }, { kind: "activity" }); await settle();
    const dialog = h.w.document.querySelector("dialog"), duration = dialog.querySelector('[name="duration"]'), target = dialog.querySelector('[name="targetType"]');
    assert.deepEqual([...duration.options].map(option => option.value), expected);
    assert.deepEqual([...target.options].map(option => option.value), access.canDeviceNetwork ? ["account", "device", "network_prefix"] : ["account"]);
    h.button("Cancel").click(); await pending;
  }
  const inconsistent = harness(t, { access: { rank: 850, maxMinutes: null, canIndefinite: false, canDeviceNetwork: true } });
  await inconsistent.actions.applyBan({ id: 42 }, { kind: "activity" });
  assert.equal(inconsistent.w.document.querySelector("dialog"), null);
  assert.match(inconsistent.w.document.querySelector("#staff-status-v3").textContent, /higher-authority staff member/);
});

test("member and activity restrictions send explicit duration payloads without a permanent or browser-authority flag", async t => {
  const member = harness(t, { access: { rank: 300, maxMinutes: 2880, canIndefinite: false, canDeviceNetwork: false } });
  const memberPending = member.actions.applyBan({ userId: "11111111-1111-4111-8111-111111111111", browser: "Untrusted browser label" }, { kind: "members" }); await settle();
  const memberForm = member.w.document.querySelector("dialog form");
  assert.equal(memberForm.querySelector('[name="targetType"]'), null);
  memberForm.elements.reason.value = "Apply a bounded account restriction after review.";
  memberForm.dispatchEvent(new member.w.Event("submit", { bubbles: true, cancelable: true })); await memberPending;
  const memberWrite = member.calls.find(call => call.options.method === "POST").body;
  assert.deepEqual(memberWrite, { action: "restrict_account", userId: "11111111-1111-4111-8111-111111111111", minutes: 2880, reasonCode: "platform-abuse", reason: "Apply a bounded account restriction after review." });

  const activity = harness(t, { access: { rank: 900, maxMinutes: null, canIndefinite: true, canDeviceNetwork: true } });
  const activityPending = activity.actions.applyBan({ id: 77 }, { kind: "activity" }); await settle();
  const activityForm = activity.w.document.querySelector("dialog form"); activityForm.elements.targetType.value = "network_prefix"; activityForm.elements.duration.value = "unlimited"; activityForm.elements.reason.value = "Apply an indefinite network restriction after evidence review.";
  activityForm.dispatchEvent(new activity.w.Event("submit", { bubbles: true, cancelable: true })); await activityPending;
  const activityWrite = activity.calls.find(call => call.options.method === "POST").body;
  assert.deepEqual(activityWrite, { action: "apply", activityId: 77, targetType: "network_prefix", scope: "platform", minutes: null, reasonCode: "platform-abuse", reason: "Apply an indefinite network restriction after evidence review." });
  assert.equal(Object.hasOwn(activityWrite, "permanent"), false);
});

test("MFA and protected-network decisions use returned capabilities rather than owner identity", async t => {
  const request = { requestId: "22222222-2222-4222-8222-222222222222", requesterName: "Reviewer", maskedNetwork: "203.0.113.x", status: "pending", reason: "Investigate repeated access", createdAt: "2026-09-09T10:00:00Z" };
  const delegated = harness(t, { status: { canRequireMfa: false, canApproveNetwork: true, sessionAal: "aal2", totpVerified: true }, requests: [request] });
  await delegated.actions.securityControls(delegated.mount, { readSecurity: true, keys: ["security.network.approve"], isOwner: false });
  assert.equal(delegated.button("Require two-factor verification"), undefined);
  assert.match(delegated.mount.textContent, /cannot make two-factor verification mandatory/);
  assert.ok(delegated.button("Approve one-time view"), "the backend approval capability enables the decision without owner identity");

  const settingsManager = harness(t, { status: { canRequireMfa: true, canApproveNetwork: false, sessionAal: "aal2", totpVerified: true } });
  await settingsManager.actions.securityControls(settingsManager.mount, { readSecurity: true, keys: ["settings.manage"], isOwner: false });
  assert.ok(settingsManager.button("Require two-factor verification"));
});
