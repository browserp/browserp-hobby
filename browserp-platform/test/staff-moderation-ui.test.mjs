import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
const filterSource = readFileSync(new URL("../public/staff-moderation-filter.js", import.meta.url), "utf8");
const source = readFileSync(new URL("../public/staff-moderation.js", import.meta.url), "utf8");
function filters() { const window = {}; vm.runInNewContext(filterSource, { window, URLSearchParams, Date }); return window.BrowseRPModerationFilters; }
const capabilities = { readMembers: true, editMembers: true, readServers: true, editServers: true, readReports: true, manageReports: true, readListings: true, readQueue: true, manageQueue: true, readActivity: true, readAudit: true, readSecurity: true, manageBans: true, reviewAppeals: true, reviewProfiles: true, manageStaff: false, manageRoles: false };
const summary = (overrides = {}) => ({ generatedAt: "2026-09-04T11:00:00Z", counts: { members: 4, servers: 3, reports: 2, listings: 1, queue: 1, security: 0 }, capabilities: { ...capabilities, ...overrides }, permissions: { keys: ["reports.resolve", "servers.review", "moderation.resolve", "accounts.sessions.revoke", "security.network.request"], isOwner: false } });
const server = { id: "server-1", version: 8, name: "Sample Roleplay", description: "A long enough synthetic server description for moderation editing checks.", platform: "fivem", region: "United Kingdom", language: "French", framework: "QBCore", access: "allowlisted", status: "published", slug: "sample-roleplay", createdAt: "2026-09-01T12:00:00Z", verified: true, beginnerFriendly: false };
const workspace = (items = [], extra = {}) => ({ kind: "servers", items, total: items.length, nextCursor: null, generatedAt: "2026-09-04T11:00:00Z", permissions: capabilities, facets: { platform: [{ value: "fivem", label: "FiveM", count: 3 }], region: [{ value: "United Kingdom", label: "United Kingdom", count: 2 }], mode: [{ value: "QBCore", label: "QBCore", count: 2 }] }, ...extra });

function harness(api, hash = "#servers") {
  let document;
  function matches(element, selector) {
    if (selector.includes(",")) return selector.split(",").some((part) => matches(element, part.trim()));
    if (selector.startsWith("#")) return element.id === selector.slice(1);
    if (selector.startsWith(".")) return String(element.className || "").split(" ").includes(selector.slice(1));
    const named = selector.match(/^\[name="([^"]+)"\]$/); if (named) return element.name === named[1];
    return element.tagName?.toLowerCase() === selector;
  }
  class Element {
    constructor(tag = "div") { this.tagName = tag.toUpperCase(); this.children = []; this.attributes = {}; this.dataset = {}; this.style = {}; this.events = new Map(); this.hidden = false; this.textContent = ""; this.value = ""; this.className = ""; this.isConnected = true; }
    get childElementCount() { return this.children.length; }
    append(...children) { children.forEach((child) => { child.parent = this; this.children.push(child); }); }
    replaceChildren(...children) { this.children = []; this.append(...children); }
    setAttribute(name, value) { this.attributes[name] = value; }
    removeAttribute(name) { delete this.attributes[name]; }
    querySelector(selector) { for (const child of this.children) { if (matches(child, selector)) return child; const next = child.querySelector?.(selector); if (next) return next; } return null; }
    querySelectorAll(selector) { return this.children.flatMap((child) => [...(matches(child, selector) ? [child] : []), ...child.querySelectorAll(selector)]); }
    closest(selector) { return matches(this, selector) ? this : this.parent?.closest(selector); }
    addEventListener(type, handler) { if (!this.events.has(type)) this.events.set(type, []); this.events.get(type).push(handler); }
    removeEventListener(type, handler) { this.events.set(type, (this.events.get(type) || []).filter((item) => item !== handler)); }
    emit(type, event = {}) { return Promise.all((this.events.get(type) || []).map((handler) => handler({ preventDefault() {}, ...event }))); }
    focus() { document.activeElement = this; }
    showModal() { this.open = true; }
    close() { this.open = false; }
    remove() { if (this.parent) this.parent.children = this.parent.children.filter((child) => child !== this); this.isConnected = false; }
    reportValidity() { return true; }
  }
  document = new Element("document"); document.body = new Element("body"); document.append(document.body); document.activeElement = null;
  for (const id of ["moderation-workspace", "moderation-tabs", "moderation-live-status", "moderation-refresh", "moderation-content", "staff-status-v3"]) { const element = new Element(); element.id = id; document.body.append(element); }
  document.createElement = (tag) => new Element(tag);
  const window = new Element("window"); const location = { hash, pathname: "/staffpanel/moderation", search: "", origin: "https://example.com" };
  const timers = new Map(); let nextTimer = 0;
  const context = { window, document, location, history: { replaceState(_, __, url) { location.hash = url.slice(url.indexOf("#")); } }, Intl, Date, URL, URLSearchParams, setTimeout(callback) { timers.set(++nextTimer, callback); return nextTimer; }, clearTimeout(id) { timers.delete(id); } };
  vm.runInNewContext(filterSource, context); vm.runInNewContext(source, context);
  return { document, window, location, init: (extra = {}) => window.BrowseRPStaffModeration.init({ api, ...extra }), root: document.querySelector("#moderation-content"), nodes: (selector) => document.querySelectorAll(selector), button: (label) => document.querySelectorAll("button").find((item) => item.textContent === label) };
}
const flush = async () => { for (let i = 0; i < 15; i += 1) await Promise.resolve(); };
const text = (element) => [element.textContent, ...element.children.map(text)].join(" ");

test("moderation filters round-trip privately, map both queues, and reset platform and region descendants", () => {
  const f = filters();
  assert.equal(f.parse("#content?status=open").view, "content");
  assert.match(f.query("content", { q: "private content" }), /^\/api\/admin\/moderation\?view=queue/);
  assert.match(f.query("queue"), /view=listings/);
  assert.match(f.query("reports", { status: "all" }), /status=all/);
  const original = { q: "story", platform: "fivem", region: "Europe", language: "English", mode: "QBCore", feature: "cars", access: "allowlisted", online: "true", verified: "true", beginner: "true" };
  assert.deepEqual(JSON.parse(JSON.stringify(f.change("servers", original, "platform", "redm"))), { q: "story", platform: "redm" });
  assert.deepEqual(JSON.parse(JSON.stringify(f.change("servers", original, "region", "United States"))), { q: "story", platform: "fivem", region: "United States" });
  const parsed = f.parse(f.serialize("servers", { q: "French & cars", mode: "QBCore", from: "2026-09-01", online: "false", arbitrary: "secret" }));
  assert.equal(parsed.filters.q, "French & cars"); assert.equal(parsed.filters.online, undefined); assert.equal(parsed.filters.arbitrary, undefined);
  const url = new URL(f.query("servers", parsed.filters, { createdAt: "2026-09-01", id: "a" }), "https://example.com");
  assert.equal(url.searchParams.get("from"), "2026-09-01T00:00:00.000Z"); assert.equal(JSON.parse(url.searchParams.get("cursor")).id, "a");
});

test("moderation does not request records before authorized init and hides unavailable views and editors", async () => {
  const requests = [];
  const app = harness(async (url) => { requests.push(url); return url.includes("view=summary") ? { summary: summary({ editServers: false, readMembers: false, readSecurity: false }) } : { workspace: workspace([server], { permissions: { ...capabilities, editServers: false, readMembers: false, readSecurity: false } }) }; });
  assert.deepEqual(requests, []); const controller = await app.init();
  assert.equal(requests.length, 2); assert.ok(requests.every((url) => url.startsWith("/api/admin/moderation")));
  assert.equal(app.button("Edit server"), undefined);
  assert.ok(!app.document.querySelector("#moderation-tabs").children.some((item) => item.href === "#members" || item.href === "#security"));
  assert.match(text(app.root), /French.*QBCore/); controller.destroy();
  const members = [
    { id: "member-1", displayName: "Member without a bio", bioStatus: "not_set", activeBans: 0, staffStatus: null },
    { id: "member-2", displayName: "Active staff member", bioStatus: "not_set", activeBans: 0, staffStatus: "active" },
    { id: "member-3", displayName: "Restricted staff member", bioStatus: "approved", activeBans: 1, staffStatus: "active" },
    { id: "member-4", displayName: "Explicit account status", bioStatus: "not_set", activeBans: 0, staffStatus: "active", status: "suspended" }
  ];
  const memberApp = harness(async (url) => url.includes("view=summary") ? { summary: summary() } : { workspace: workspace(members, { kind: "members" }) }, "#members");
  const memberController = await memberApp.init();
  assert.deepEqual(memberApp.nodes(".moderation-state").map((badge) => badge.dataset.state), ["active", "staff", "banned", "suspended"]);
  assert.ok(memberApp.nodes(".moderation-state").every((badge) => badge.textContent !== "not set"));
  memberController.destroy();
});

test("newer private searches win when responses arrive out of order", async () => {
  const pending = new Map();
  const app = harness((url) => { if (url.includes("view=summary")) return Promise.resolve({ summary: summary() }); const q = new URL(url, "https://example.com").searchParams.get("q"); return q ? new Promise((resolve) => pending.set(q, resolve)) : Promise.resolve({ workspace: workspace([server]) }); });
  const controller = await app.init();
  const form = app.root.querySelector("form"); const search = form.querySelector("input"); search.value = "first"; await form.emit("submit"); search.value = "second"; await form.emit("submit");
  pending.get("second")({ workspace: workspace([{ ...server, name: "Second result" }]) }); await flush();
  pending.get("first")({ workspace: workspace([{ ...server, name: "Outdated first result" }]) }); await flush();
  assert.match(text(app.root), /Second result/); assert.doesNotMatch(text(app.root), /Outdated first result/); assert.match(app.location.hash, /q=second/); controller.destroy();
});

test("server editor preserves platform, region, language, framework and access order with versioned save", async () => {
  const writes = [];
  const app = harness(async (url, options) => { if (options?.method === "POST") { writes.push(JSON.parse(options.body)); return { result: { ok: true } }; } return url.includes("view=summary") ? { summary: summary() } : { workspace: workspace([server]) }; });
  const controller = await app.init(); const editing = app.button("Edit server").emit("click"); await flush();
  const dialog = app.document.querySelector("dialog"); assert.ok(dialog);
  const controls = [...dialog.querySelectorAll("input"), ...dialog.querySelectorAll("select"), ...dialog.querySelectorAll("textarea")]; const named = (name) => controls.find((input) => input.name === name);
  const fieldGrid = dialog.querySelector(".moderation-editor-fields"); const order = fieldGrid.children.map((label) => label.children.find((item) => item.name)?.name).filter(Boolean);
  assert.deepEqual(order.slice(1, 6), ["platform", "region", "language", "framework", "access"]);
  assert.equal(named("language").value, "French"); assert.equal(named("framework").value, "QBCore"); named("reason").value = "Correct the reviewed server details.";
  await dialog.querySelector("form").emit("submit"); await editing;
  assert.equal(writes[0].kind, "server"); assert.equal(writes[0].expectedVersion, 8); assert.equal(writes[0].data.language, "French"); assert.equal(writes[0].data.framework, "QBCore"); controller.destroy();
});

test("deleted report restore is audited and conflicts keep edited text without silent overwrite", async () => {
  const writes = [];
  const report = { id: "report-1", category: "Incorrect server details", status: "open", deletedAt: "2026-09-03T00:00:00Z", deletedReason: "Duplicate report", version: 3 };
  const app = harness(async (url, options) => { if (options?.method === "POST") { writes.push(JSON.parse(options.body)); throw Object.assign(new Error("Concurrent change"), { status: 409 }); } return url.includes("view=summary") ? { summary: summary() } : { workspace: workspace([report], { kind: "reports", facets: { status: [{ value: "open", label: "Open", count: 1 }, { value: "resolved", label: "Resolved", count: 3 }] } }) }; }, "#reports?status=deleted");
  const controller = await app.init();
  const statusFilter = app.root.querySelectorAll("select").find((input) => input.name === "status");
  assert.deepEqual(statusFilter.children.map((option) => option.value), ["all", "active", "history", "deleted", "open", "resolved"]);
  assert.equal(app.button("Review report"), undefined); const editing = app.button("Restore report").emit("click"); await flush();
  const dialog = app.document.querySelector("dialog"); dialog.querySelector("textarea").value = "Restore after evidence was reviewed."; await dialog.querySelector("form").emit("submit");
  assert.equal(writes[0].action, "restore"); assert.equal(writes[0].expectedVersion, 3); assert.match(text(dialog), /record changed while you were editing/); assert.equal(dialog.querySelector("textarea").value, "Restore after evidence was reviewed.");
  await dialog.querySelectorAll("button").find((item) => item.textContent === "Cancel").emit("click"); await editing; controller.destroy();
});

test("security readers retain Resolve signal and failed loads never present old results as current", async () => {
  let failed = false; let resolved = null;
  const app = harness(async (url) => { if (url.includes("view=summary")) return { summary: summary() }; if (failed) throw new Error("Network unavailable"); return { workspace: workspace([{ id: "signal-1", eventType: "Repeated sign-in rejection", severity: "high", createdAt: "2026-09-03T00:00:00Z" }], { kind: "security" }) }; }, "#security");
  const controller = await app.init({ actions: { resolveSecurityFlag: async (item) => { resolved = item.id; } } });
  await app.button("Resolve signal").emit("click"); assert.equal(resolved, "signal-1");
  failed = true; await controller.refresh(); assert.match(text(app.root), /Records could not load/); assert.doesNotMatch(text(app.root), /Repeated sign in rejection/); controller.destroy();
});
