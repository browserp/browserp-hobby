import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";

const source = readFileSync(new URL("../public/staff-roles.js", import.meta.url), "utf8");
const tick = () => new Promise(resolve => setImmediate(resolve));
const settle = async () => { for (let index = 0; index < 8; index += 1) await tick(); };
const roles = [
  { key: "owner", name: "Owner", description: "Protected root role", rank: 1000, custom: false, version: 1, memberCount: 1, permissions: ["staff.manage"], assignable: false, editable: false },
  { key: "administrator", name: "Admin", description: "Higher operational role", rank: 800, custom: false, version: 2, memberCount: 1, permissions: ["staff.manage"], assignable: false, editable: false },
  { key: "support", name: "Support", description: "Help members safely", rank: 100, custom: false, version: 3, memberCount: 2, permissions: ["reports.read"], assignable: true, editable: true }
];
const control = (overrides = {}) => ({
  actorRank: 500, canAssign: false, canEditRoles: false, canRequest: false, canReviewRequests: false,
  roles, effectivePermissions: ["staff.read"], permissions: [
    { key: "staff.manage", description: "Manage lower-ranked staff." },
    { key: "reports.read", description: "Read member reports." }
  ], ...overrides
});
const members = [
  { userId: "11111111-1111-4111-8111-111111111111", discordUserId: "11111111111111111", displayName: "Manageable Sam", roleKey: "support", roleName: "Support", status: "active", version: 7, rank: 100, manageable: true },
  { userId: "22222222-2222-4222-8222-222222222222", discordUserId: "22222222222222222", displayName: "Peer Pat", roleKey: "administrator", roleName: "Admin", status: "active", version: 9, rank: 800, manageable: false }
];

async function harness(t, { localPermissions = { readStaff: true }, roleControl = control(), staffMembers = members, requests = [], post } = {}) {
  const dom = new JSDOM('<section id="overview-roles"></section>', { url: "https://browserp.test/staffpanel/moderation#staff", runScripts: "outside-only" });
  t.after(() => dom.window.close());
  const w = dom.window, calls = [];
  Object.defineProperty(w.crypto, "randomUUID", { configurable: true, value: () => "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" });
  const api = async (path, options = {}) => {
    calls.push({ path, options, body: options.body ? JSON.parse(options.body) : null });
    if (options.method === "POST") return post ? post(path, calls.at(-1).body) : { result: { version: 8 }, request: {} };
    if (path === "/api/admin/roles") return { control: roleControl };
    if (path === "/api/admin/staff") return { staff: { members: staffMembers, roles: roleControl.roles } };
    if (path === "/api/admin/staff?view=requests") return { requests };
    throw new Error(`Unexpected fixture route ${path}`);
  };
  w.eval(source); await w.BrowseRPStaffRoles.init({ api, permissions: localPermissions }); await settle();
  const root = w.document.querySelector("#overview-roles");
  return { w, root, calls, button: label => [...root.querySelectorAll("button")].find(item => item.textContent === label) };
}

test("staff readers get the complete role catalogue without browser-inferred write controls", async t => {
  const malicious = roles.map(role => role.key === "support" ? { ...role, description: '<img src=x onerror="bad()">Help members' } : role);
  const h = await harness(t, { roleControl: control({ roles: malicious }) });
  assert.match(h.root.textContent, /read-only access to the staff catalogue/i);
  assert.match(h.root.textContent, /Owner.*Admin.*Support/s);
  assert.match(h.root.textContent, /Read member reports/);
  assert.equal(h.root.querySelector("img,script"), null);
  assert.equal(h.root.querySelector("form"), null);
  assert.equal(h.button("Edit role"), undefined);
  assert.deepEqual(h.calls.filter(call => !call.options.method).map(call => call.path), ["/api/admin/roles", "/api/admin/staff", "/api/admin/staff?view=requests"]);
});

test("direct assignment offers only server-marked people and roles and preserves the current version", async t => {
  const h = await harness(t, { localPermissions: { readStaff: true, manageStaff: true }, roleControl: control({ canAssign: true }) });
  const form = h.root.querySelector(".staff-role-direct-v3 form"); assert.ok(form);
  const person = form.elements.member, role = form.elements.roleKey, action = form.elements.action;
  assert.deepEqual([...person.options].map(option => option.textContent), ["Add a staff member", "Manageable Sam · 11111111111111111"]);
  assert.deepEqual([...role.options].map(option => option.value), ["support"]);
  person.value = members[0].discordUserId; person.dispatchEvent(new h.w.Event("change"));
  assert.deepEqual([...action.options].map(option => option.value), ["change_role", "suspend", "revoke"]);
  action.value = "suspend"; action.dispatchEvent(new h.w.Event("change")); assert.equal(role.disabled, true);
  form.elements.reason.value = "Pause access while the incident is reviewed.";
  form.dispatchEvent(new h.w.Event("submit", { bubbles: true, cancelable: true })); await settle();
  const write = h.calls.find(call => call.options.method === "POST");
  assert.deepEqual(write.body, { discordUserId: members[0].discordUserId, action: "suspend", roleKey: null, expectedVersion: 7, reason: "Pause access while the incident is reviewed." });
  assert.doesNotMatch(JSON.stringify(write.body), /Peer Pat|owner|manageable/);
});

test("higher-role requests and independent decisions use idempotency and record versions", async t => {
  const requestRows = [
    { id: "33333333-3333-4333-8333-333333333333", discordUserId: members[0].discordUserId, action: "change_role", roleKey: "administrator", reason: "Broader launch responsibility", status: "pending", version: 2, requestedByMe: true, canReview: false, createdAt: "2026-09-09T10:00:00Z" },
    { id: "44444444-4444-4444-8444-444444444444", discordUserId: members[1].discordUserId, action: "change_role", roleKey: "support", reason: "Move support coverage", status: "pending", version: 5, requestedByMe: false, canReview: true, createdAt: "2026-09-09T10:05:00Z" }
  ];
  const h = await harness(t, { roleControl: control({ canRequest: true, canReviewRequests: true }), requests: requestRows });
  const requestForm = h.root.querySelector(".staff-role-request-form-v3");
  requestForm.elements.person.value = members[0].discordUserId; requestForm.elements.person.dispatchEvent(new h.w.Event("change"));
  requestForm.elements.roleKey.value = "administrator"; requestForm.elements.reason.value = "Request broader launch responsibility.";
  requestForm.dispatchEvent(new h.w.Event("submit", { bubbles: true, cancelable: true })); await settle();
  const created = h.calls.find(call => call.options.method === "POST").body;
  assert.deepEqual(created, { requestAction: "create", requestKey: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", discordUserId: members[0].discordUserId, action: "change_role", roleKey: "administrator", expectedVersion: 7, reason: "Request broader launch responsibility." });

  const review = await harness(t, { roleControl: control({ canRequest: true, canReviewRequests: true }), requests: requestRows });
  assert.equal([...review.root.querySelectorAll("button")].filter(item => item.textContent === "Approve change").length, 1, "own requests cannot be approved in the browser");
  const decision = review.root.querySelector(".staff-role-request-decision-v3"); decision.elements.reason.value = "Authority and current evidence checked.";
  const approve = review.button("Approve change");
  decision.dispatchEvent(new review.w.SubmitEvent("submit", { bubbles: true, cancelable: true, submitter: approve })); await settle();
  const decided = review.calls.find(call => call.options.method === "POST").body;
  assert.deepEqual(decided, { requestAction: "decide", id: requestRows[1].id, expectedVersion: 5, approved: true, reason: "Authority and current evidence checked." });
});
