import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
const read = name => readFileSync(new URL(`../public/${name}`, import.meta.url), "utf8");
const flush = () => new Promise(resolve => setImmediate(resolve));
const website = (range = "30d") => ({ overview: { website: { generatedAt: "2026-09-14T12:00:00Z", metrics: { totalUsers: 42, publishedServers: 9, publishedBlogs: 2, activeStaff: 4 }, permissions: { manageBlogs: true }, users: { range, total: 42, newUsers: 1, series: [{ date: "2026-09-14", newUsers: 1, totalUsers: 42 }], granularity: "day" } } } });
const dashboard = () => ({ overview: {
  role: { key: "owner", name: "Owner" }, permissions: [], pendingSubmissions: 3, openReports: 7, securityAlerts: 0,
  listingQueue: [{ id: "listing-a", name: "Override-granted listing", status: "pending_review", created_at: "2026-09-14T11:00:00Z" }],
  reportQueue: [{ id: "report-a", category: "A report for review", status: "open", created_at: "2026-09-14T10:00:00Z" }],
  recentAudit: [{ id: "audit-a", action: "server.approved", created_at: "2026-09-14T09:00:00Z" }]
} });
const access = capabilities => ({ summary: { generatedAt: "2026-09-14T12:00:00Z", permissions: { keys: [] }, capabilities: { readListings: true, readReports: true, readSecurity: true, readAudit: true, ...capabilities } } });
function harness(t, handlers = {}) {
  const dom = new JSDOM(read("staffpanel-overview.html"), { url: "https://browserp.test/staffpanel/overview", runScripts: "outside-only" });
  const w = dom.window; t.after(() => w.close());
  const calls = [];
  const api = async (path, options) => {
    calls.push({ path, options });
    if (path === "/api/admin/overview") return (handlers.dashboard || dashboard)();
    if (path === "/api/admin/moderation?view=summary") return (handlers.access || access)();
    if (path === "/api/admin/content-moderation?kind=message-count") return (handlers.messageReviews || (() => ({ pendingCount: 0 })))();
    if (path.startsWith("/api/admin/overview?range=")) return (handlers.website || website)(path.split("=")[1]);
    throw new Error(`Unexpected endpoint ${path}`);
  };
  w.eval(read("staff-overview.js"));
  return { w, calls, init: extra => w.BrowseRPStaffOverview.init({ api, ...extra }), node: selector => w.document.querySelector(selector), text: selector => w.document.querySelector(selector)?.textContent || "" };
}

test("real website-only ranged response and separate dashboard populate priorities, previews and audit", async t => {
  const app = harness(t); assert.equal(app.calls.length, 0);
  const controller = await app.init(); t.after(() => controller.destroy());
  assert.deepEqual(app.calls.map(call => call.path).sort(), ["/api/admin/moderation?view=summary", "/api/admin/overview", "/api/admin/overview?range=30d"].sort());
  assert.equal(app.calls.find(call => call.path.includes("view=summary")).options.optionalOverviewCapabilities, true);
  assert.equal(app.node("#overview-priorities").hidden, false);
  assert.equal(app.text('[data-overview-priority="pendingSubmissions"]'), "3");
  assert.equal(app.text('[data-overview-priority="openReports"]'), "7");
  assert.match(app.text("#overview-work-queue"), /Override-granted listing/);
  assert.match(app.text("#overview-audit-list"), /server approved/);
  assert.equal(app.text("#overview-users-total"), "42");
  assert.match(app.text("#overview-live-status"), /^Website totals updated/);
  assert.match(app.text("#overview-work-status"), /Review queues and audit received/);
  app.node('[data-overview-range="90d"]').click(); await flush();
  assert.equal(app.calls.filter(call => call.path === "/api/admin/overview").length, 1, "changing chart period does not remount/refetch review work");
  assert.equal(app.node('[data-overview-priority="pendingSubmissions"]').textContent, "3");
});

test("message review priority calls the count-only route for effective reviewers", async t => {
  const reviewerAccess = () => { const result = access(); result.summary.permissions.keys = ["moderation.resolve"]; return result; };
  const app = harness(t, { access: reviewerAccess, messageReviews: () => ({ pendingCount: 4 }) });
  const controller = await app.init(); t.after(() => controller.destroy());
  const card = app.node('[data-overview-priority-card="messages.review"]');
  assert.equal(card.hidden, false);
  assert.equal(app.text('[data-overview-priority="pendingMessages"]'), "4");
  assert.equal(card.getAttribute("href"), "/staffpanel/moderation#content?kind=message");
  assert.equal(app.calls.filter(call => call.path === "/api/admin/content-moderation?kind=message-count").length, 1);

  const noPermission = harness(t, { messageReviews: () => { throw new Error("The count route must not be requested"); } });
  const noPermissionController = await noPermission.init(); t.after(() => noPermissionController.destroy());
  assert.equal(noPermission.node('[data-overview-priority-card="messages.review"]').hidden, true);
  assert.equal(noPermission.calls.some(call => call.path === "/api/admin/content-moderation?kind=message-count"), false);
});

test("message review count remains unavailable rather than becoming zero after a failed read", async t => {
  const reviewerAccess = () => { const result = access(); result.summary.permissions.keys = ["moderation.resolve"]; return result; };
  const app = harness(t, { access: reviewerAccess, messageReviews: () => { throw Object.assign(new Error("Count service unavailable"), { status: 503 }); } });
  const controller = await app.init(); t.after(() => controller.destroy());
  assert.equal(app.node('[data-overview-priority-card="messages.review"]').hidden, false);
  assert.equal(app.text('[data-overview-priority="pendingMessages"]'), "Unavailable");
});

test("raw role defaults cannot suppress effective override grants or expose override-denied previews", async t => {
  let denied = false;
  const app = harness(t, { dashboard: () => { const data = dashboard(); data.overview.permissions = denied ? ["servers.review", "reports.read", "security.read", "audit.read"] : []; return data; }, access: () => access({ readListings: !denied, readReports: !denied, readSecurity: !denied, readAudit: !denied }) });
  const controller = await app.init(); t.after(() => controller.destroy());
  assert.equal(app.node("#overview-priorities").hidden, false);
  assert.match(app.text("#overview-work-queue"), /Override-granted listing/);
  denied = true; await controller.refresh();
  assert.equal(app.node("#overview-priorities").hidden, true);
  assert.doesNotMatch(app.text("#overview-work-queue"), /Override-granted listing|A report for review/);
  assert.doesNotMatch(app.text("#overview-audit-list"), /server approved/);
  assert.equal(app.text('[data-overview-queue="pendingSubmissions"]'), "");
});

test("website-shaped dashboard response fails visibly instead of claiming an empty current work queue", async t => {
  const app = harness(t, { dashboard: () => website() });
  const controller = await app.init(); t.after(() => controller.destroy());
  assert.equal(app.text("#overview-users-total"), "42");
  assert.equal(app.node("#overview-priorities").hidden, true);
  assert.equal(app.node("#overview-work-status").dataset.state, "error");
  assert.match(app.text("#overview-work-status"), /could not refresh/);
  assert.doesNotMatch(app.text("#overview-work-queue"), /No recent items/);
});

test("website and review failures keep independent freshness and never turn unavailable data into zero", async t => {
  let failWebsite = true, failDashboard = false;
  const app = harness(t, {
    website: range => { if (failWebsite) throw new Error("Chart unavailable"); return website(range); },
    dashboard: () => { if (failDashboard) throw new Error("Dashboard unavailable"); return dashboard(); }
  });
  const controller = await app.init(); t.after(() => controller.destroy());
  assert.equal(app.node("#overview-live-status").dataset.state, "error");
  assert.equal(app.node("#overview-work-status").dataset.state, "live");
  assert.match(app.text("#overview-work-queue"), /Override-granted listing/);
  failWebsite = false; failDashboard = true; await controller.refresh();
  assert.equal(app.node("#overview-live-status").dataset.state, "live");
  assert.equal(app.node("#overview-work-status").dataset.state, "error");
  assert.match(app.text("#overview-work-status"), /Last successfully received/);
  assert.doesNotMatch(app.text("#overview-work-queue"), /Override-granted listing/);
  assert.equal(app.node("#overview-priorities").hidden, true);
  assert.equal(app.text("#overview-users-total"), "42");
});

test("genuine authorised zero counts remain visible and are distinct from permission-source failure", async t => {
  let failure = false;
  const app = harness(t, { dashboard: () => ({ overview: { ...dashboard().overview, pendingSubmissions: 0, openReports: 0, securityAlerts: 0, listingQueue: [], reportQueue: [], recentAudit: [] } }), access: () => { if (failure) throw Object.assign(new Error("No review capability"), { status: 403, sectionUnavailable: true }); return access(); } });
  let expired = 0;
  const controller = await app.init({ onAuthFailure() { expired++; } }); t.after(() => controller.destroy());
  assert.equal(app.node("#overview-priorities").hidden, false);
  assert.equal(app.text('[data-overview-priority="pendingSubmissions"]'), "0");
  assert.match(app.text("#overview-work-queue"), /No recent items/);
  failure = true; await controller.refresh();
  assert.equal(app.node("#overview-priorities").hidden, true);
  assert.equal(app.node("#overview-work-status").dataset.state, "error");
  assert.match(app.text("#overview-work-status"), /current permissions/);
  assert.equal(app.text("#overview-users-total"), "42");
  assert.equal(expired, 0, "only a shared-client revalidated optional denial may reach this path");
});

test("an expired website read invalidates a late dashboard response before it can repaint private work", async t => {
  let expired = false, finishDashboard;
  const app = harness(t, { website: range => { if (expired) throw Object.assign(new Error("Session expired"), { status: 401 }); return website(range); }, dashboard: () => expired ? new Promise(resolve => { finishDashboard = resolve; }) : dashboard() });
  let failures = 0; const controller = await app.init({ onAuthFailure() { failures++; } }); t.after(() => controller.destroy());
  expired = true; const pending = controller.refresh(); await flush();
  assert.equal(failures, 1);
  assert.equal(app.text("#overview-users-total"), "—");
  finishDashboard(dashboard()); await pending;
  assert.doesNotMatch(app.text("#overview-work-queue"), /Override-granted listing/);
  assert.doesNotMatch(app.text("#overview-audit-list"), /server approved/);
  assert.equal(app.node("#overview-priorities").hidden, true);
});


test("an untagged permission denial remains an access failure", async t => {
  const app = harness(t, { access: () => { throw Object.assign(new Error("Access revoked"), { status: 403 }); } });
  let failures = 0; const controller = await app.init({ onAuthFailure() { failures++; } }); t.after(() => controller.destroy());
  assert.equal(failures, 1);
  assert.equal(app.text("#overview-users-total"), "—");
  assert.equal(app.node("#overview-priorities").hidden, true);
  assert.doesNotMatch(app.text("#overview-work-queue"), /Override-granted listing/);
});

test("review refreshes have their own latest-response guard", async t => {
  let calls = 0; const pending = [];
  const app = harness(t, { dashboard: () => ++calls === 1 ? dashboard() : new Promise(resolve => pending.push(resolve)) });
  const controller = await app.init(); t.after(() => controller.destroy());
  const older = controller.refresh(); const newer = controller.refresh(); await flush();
  const latest = dashboard(); latest.overview.pendingSubmissions = 12; latest.overview.listingQueue[0].name = "Newest queue record";
  pending[1](latest); await newer;
  pending[0](dashboard()); await older;
  assert.match(app.text("#overview-work-queue"), /Newest queue record/);
  assert.doesNotMatch(app.text("#overview-work-queue"), /Override-granted listing/);
  assert.equal(app.text('[data-overview-priority="pendingSubmissions"]'), "12");
});
