import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

function fixture(range = "30d", total = 42) {
  return { overview: { metrics: { pendingSubmissions: 3 }, website: { generatedAt: "2026-09-03T12:15:00Z", metrics: { totalUsers: total, publishedServers: 9, publishedBlogs: 2, activeStaff: 4 }, permissions: { manageRoles: true, manageBlogs: true, manageAnnouncements: true }, users: { range, startDate: "2026-09-02", endDate: "2026-09-03", granularity: "day", bucketDays: 1, total, newUsers: 2, series: [{ date: "2026-09-02", endDate: "2026-09-02", newUsers: 1, totalUsers: total - 1 }, { date: "2026-09-03", endDate: "2026-09-03", newUsers: 1, totalUsers: total }] } } } };
}

function harness(api) {
  let document;
  class Element {
    constructor(tag = "div") { this.tagName = tag; this.children = []; this.attributes = {}; this.dataset = {}; this.style = {}; this.events = new Map(); this.hidden = false; this.textContent = ""; }
    append(...children) { children.forEach((child) => { child.parent = this; this.children.push(child); }); }
    replaceChildren(...children) { this.children = []; this.append(...children); }
    setAttribute(name, value) { this.attributes[name] = value; }
    getBoundingClientRect() { return { width: 900, left: 0 }; }
    contains(element) { return element === this || this.children.some((child) => child.contains?.(element)); }
    addEventListener(type, handler) { if (!this.events.has(type)) this.events.set(type, []); this.events.get(type).push(handler); }
    removeEventListener(type, handler) { this.events.set(type, (this.events.get(type) || []).filter((item) => item !== handler)); }
    emit(type, event = {}) { for (const handler of this.events.get(type) || []) handler({ preventDefault() {}, ...event }); }
    focus() { document.activeElement = this; this.emit("focus"); }
  }
  const nodes = new Map();
  const metrics = ["totalUsers", "publishedServers", "publishedBlogs", "activeStaff"].map((key) => { const element = new Element("strong"); element.dataset.overviewMetric = key; return element; });
  const queues = ["pendingSubmissions", "openReports", "openReports"].map((key) => { const element = new Element("span"); element.dataset.overviewQueue = key; return element; });
  const ranges = ["30d", "90d", "180d", "1y", "max"].map((key) => { const element = new Element("button"); element.dataset.overviewRange = key; return element; });
  document = new Element("document"); document.hidden = false; document.activeElement = null;
  document.querySelector = (selector) => { if (!nodes.has(selector)) nodes.set(selector, new Element()); return nodes.get(selector); };
  document.querySelectorAll = (selector) => selector === "[data-overview-metric]" ? metrics : selector === "[data-overview-queue]" ? queues : selector === "[data-overview-range]" ? ranges : [];
  document.createElement = (tag) => new Element(tag);
  document.createElementNS = (_, tag) => new Element(tag);
  const window = new Element("window"); const timers = [];
  const context = { document, window, Intl, Date, setInterval(callback, delay) { timers.push({ callback, delay, cleared: false }); return timers.length - 1; }, clearInterval(id) { if (timers[id]) timers[id].cleared = true; } };
  vm.runInNewContext(readFileSync(new URL("../public/staff-overview.js", import.meta.url), "utf8"), context);
  return { init: (extra = {}) => window.BrowseRPStaffOverview.init({ api, ...extra }), document, window, nodes, metrics, queues, ranges, timers };
}

const flush = async () => { for (let index = 0; index < 8; index += 1) await Promise.resolve(); };
const allText = (element) => [element.textContent, ...element.children.map(allText)].join(" ");

test("overview updates every queue badge, including reports, zero counts and expired access", async () => {
  let data = fixture(); data.overview.metrics.openReports = 7;
  let expired = false;
  const app = harness(async () => { if (expired) throw Object.assign(new Error("Staff access denied"), { status: 403 }); return data; });
  const controller = await app.init({ onAuthFailure() {} });
  assert.deepEqual(app.queues.map(queue => queue.textContent), ["3 pending", "7 open", "7 open"]);
  data = fixture(); data.overview.metrics.openReports = 0;
  await controller.refresh(); assert.deepEqual(app.queues.map(queue => queue.textContent), ["3 pending", "0 open", "0 open"]);
  delete data.overview.metrics.openReports;
  await controller.refresh(); assert.deepEqual(app.queues.map(queue => queue.textContent), ["3 pending", "", ""]);
  data.overview.openReports = 2;
  await controller.refresh(); assert.deepEqual(app.queues.map(queue => queue.textContent), ["3 pending", "2 open", "2 open"]);
  expired = true; await controller.refresh(); assert.deepEqual(app.queues.map(queue => queue.textContent), ["", "", ""]);
  controller.destroy();
});

test("overview waits for authorised init and renders exact API counts with keyboard chart inspection", async () => {
  const requests = []; const loaded = [];
  const app = harness(async (url) => { requests.push(url); return fixture(); });
  assert.deepEqual(requests, []);
  const controller = await app.init({ onLoad: (website) => loaded.push(website) });
  assert.deepEqual(requests, ["/api/admin/overview?range=30d"]);
  assert.equal(app.metrics[0].textContent, "42");
  assert.equal(app.metrics[1].textContent, "9");
  assert.equal(app.nodes.get("#overview-users-total").textContent, "42");
  assert.equal(loaded[0].permissions.manageRoles, true);
  const chart = app.nodes.get("#overview-chart").children[0];
  assert.equal(chart.attributes.role, "slider");
  assert.equal(chart.attributes["aria-valuenow"], "1");
  assert.match(chart.attributes["aria-valuetext"], /3 Sept 2026: 42 registered users; 1 new users/);
  chart.emit("keydown", { key: "ArrowLeft" });
  assert.equal(chart.attributes["aria-valuenow"], "0");
  assert.match(chart.attributes["aria-valuetext"], /41 registered users/);
  chart.emit("keydown", { key: "Home" });
  assert.equal(chart.attributes["aria-valuenow"], "0");
  chart.emit("keydown", { key: "End" });
  assert.equal(chart.attributes["aria-valuenow"], "1");
  assert.equal(app.nodes.get("#overview-user-data").children.length, 2);
  assert.equal(controller.website.users.total, 42);
  controller.destroy();
});

test("switching ranges never replaces the current chart with an older in-flight response", async () => {
  const pending = new Map(); const requests = [];
  const app = harness((url) => { requests.push(url); if (url.endsWith("30d")) return Promise.resolve(fixture()); return new Promise((resolve) => pending.set(url, resolve)); });
  const controller = await app.init();
  app.ranges[1].emit("click"); app.ranges[2].emit("click");
  assert.equal(app.nodes.get("#overview-range-label").textContent, "180 days");
  assert.match(allText(app.nodes.get("#overview-chart")), /Loading this time frame/);
  pending.get("/api/admin/overview?range=180d")(fixture("180d", 70)); await flush();
  pending.get("/api/admin/overview?range=90d")(fixture("90d", 60)); await flush();
  assert.equal(controller.website.users.range, "180d");
  assert.equal(app.nodes.get("#overview-users-total").textContent, "70");
  assert.equal(app.ranges[2].attributes["aria-pressed"], "true");
  assert.equal(app.ranges[1].attributes["aria-pressed"], "false");
  controller.destroy();
});

test("live refresh pauses in hidden tabs and retains dated totals on a network failure", async () => {
  let calls = 0; let failure = false;
  const app = harness(async () => { calls += 1; if (failure) throw new Error("Network unavailable"); return fixture(); });
  const controller = await app.init();
  assert.equal(app.timers[0].delay, 30000);
  app.document.hidden = true; app.timers[0].callback(); await flush(); assert.equal(calls, 1);
  app.document.hidden = false; app.document.emit("visibilitychange"); await flush(); assert.equal(calls, 2);
  failure = true; app.timers[0].callback(); await flush();
  assert.equal(app.metrics[0].textContent, "42");
  assert.equal(app.nodes.get("#overview-live-status").dataset.state, "error");
  assert.match(app.nodes.get("#overview-live-status").textContent, /Last successful update:.*UTC/);
  assert.equal(app.nodes.get("#overview-refresh").disabled, false);
  controller.destroy(); assert.equal(app.timers[0].cleared, true);
});

test("invalid history is not drawn and expired staff access clears protected totals", async () => {
  const invalid = fixture(); invalid.overview.website.users.series[0].newUsers = -1;
  const badApp = harness(async () => invalid); const badController = await badApp.init();
  assert.equal(badApp.metrics[0].textContent, "");
  assert.match(allText(badApp.nodes.get("#overview-chart")), /unavailable/);
  badController.destroy();
  let expired = false; let authFailures = 0;
  const app = harness(async () => { if (expired) throw Object.assign(new Error("Staff access denied"), { status: 403 }); return fixture(); });
  const controller = await app.init({ onAuthFailure: () => { authFailures += 1; } });
  expired = true; await controller.refresh();
  assert.equal(authFailures, 1); assert.equal(app.metrics[0].textContent, "—");
  assert.match(allText(app.nodes.get("#overview-chart")), /staff session has ended/);
  assert.equal(app.timers[0].cleared, true);
});

test("aggregated periods expose their full UTC date range and preserve zero counts", async () => {
  const data = fixture(); Object.assign(data.overview.website.users, { granularity: "week", total: 0, newUsers: 0, series: [{ date: "2026-08-28", endDate: "2026-09-03", newUsers: 0, totalUsers: 0 }] }); data.overview.website.metrics.totalUsers = 0;
  const app = harness(async () => data); const controller = await app.init();
  assert.equal(app.metrics[0].textContent, "0");
  const chart = app.nodes.get("#overview-chart").children[0];
  assert.match(chart.attributes["aria-valuetext"], /28 Aug 2026 – 3 Sept 2026: 0 registered users/);
  assert.match(app.nodes.get("#overview-chart-caption").textContent, /Weekly counts in UTC/);
  controller.destroy();
});
