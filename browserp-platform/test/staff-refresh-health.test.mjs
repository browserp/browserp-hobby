import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { createBrowseRPServer } from "../dev-server.mjs";
const source = readFileSync(new URL("../public/staff-refresh-health.js", import.meta.url), "utf8");
const now = "2026-09-04T11:00:00.000Z";
function fixture() {
  const run = { startedAt: "2026-09-04T10:59:00.000Z", finishedAt: "2026-09-04T10:59:04.000Z", requested: 55, checked: 55, refreshed: 40, unchanged: 15, unavailable: 0, failed: 0, skipped: 0, deferred: 0, durationMs: 4000 };
  return { checkedAt: now, freshnessSeconds: 300, scheduler: { enabled: true, intervalSeconds: 60, lastDispatchedAt: run.startedAt, lastDeliveryStatus: 200, lastDeliveryTimedOut: false }, lastRun: run, lastCompletedRun: run, lastSuccessfulRunAt: run.finishedAt, sources: { total: 55, fresh: 55, stale: 0, unavailable: 0, neverChecked: 0, oldestObservationAt: run.startedAt, newestObservationAt: run.finishedAt }, platforms: [{ platform: "fivem", total: 32, fresh: 32, stale: 0 }, { platform: "redm", total: 20, fresh: 20, stale: 0 }, { platform: "minecraft", total: 3, fresh: 3, stale: 0 }], recentRuns: [run] };
}
async function harness(api = async () => ({ health: fixture() })) {
  const dom = new JSDOM('<body class="staff-v3"><section id="health" data-refresh-health></section></body>', { runScripts: "outside-only", pretendToBeVisual: true, url: "https://browserp.test/staffpanel/overview" });
  dom.window.eval(source); const root = dom.window.document.querySelector("section");
  const instance = await dom.window.BrowseRPStaffRefreshHealth.init({ api, root });
  return { dom, root, instance, close() { instance.destroy(); dom.window.close(); } };
}
test("refresh health renders actual run counts, accessible history and per-game freshness", async () => {
  const calls = []; const h = await harness(async (...args) => { calls.push(args); return { health: fixture() }; });
  try {
    assert.match(h.root.textContent, /Automatic checks are healthy/);
    assert.match(h.root.textContent, /55 \/ 55/); assert.match(h.root.textContent, /15 observations were unchanged/);
    assert.equal(h.root.querySelectorAll(".refresh-health-game").length, 3);
    assert.equal(h.root.querySelector("table caption").textContent, "Recent automatic check runs · UTC");
    assert.equal(h.root.querySelectorAll("th[scope=col]").length, 8);
    assert.equal(h.root.querySelector(".refresh-health-state").getAttribute("role"), "status");
    const details = h.root.querySelector("details"); assert.equal(details.open, false); details.open = true; details.querySelector("summary").focus();
    await h.instance.refresh(); assert.equal(h.root.querySelector("details").open, true);
    assert.equal(h.dom.window.document.activeElement, h.root.querySelector("summary"));
    assert.deepEqual(calls, [["/api/admin/refresh-health"], ["/api/admin/refresh-health"]], "the update action only rereads health");
    assert.equal(h.root.getAttribute("aria-busy"), "false");
  } finally { h.close(); }
});
test("health states distinguish source lag, worker errors, paused scheduling and incomplete data", async () => {
  const h = await harness(); const describe = h.dom.window.BrowseRPStaffRefreshHealth.describeHealth;
  try {
    const lag = fixture(); lag.sources.fresh = 53; lag.sources.stale = 2; assert.equal(describe(lag).label, "Some source observations are unavailable");
    const failed = fixture(); failed.lastCompletedRun.failed = 1; assert.equal(describe(failed).label, "The latest check run needs attention");
    const paused = fixture(); paused.scheduler.enabled = false; assert.equal(describe(paused).label, "Automatic checks are paused");
    const delayed = fixture(); delayed.scheduler.lastDispatchedAt = "2026-09-04T10:55:00Z"; assert.equal(describe(delayed).label, "Automatic checks are delayed");
    const incomplete = fixture(); incomplete.lastCompletedRun.failed = null; assert.equal(describe(incomplete).label, "Check-run details are incomplete");
    const active = fixture(); active.lastRun = { startedAt: now, finishedAt: null }; assert.equal(describe(active).label, "Automatic checks are running");
    const delivery = fixture(); delivery.scheduler.lastDeliveryStatus = 503; assert.equal(describe(delivery).tone, "error");
    const empty = fixture(); empty.lastRun = null; empty.lastCompletedRun = null; empty.lastSuccessfulRunAt = null; assert.equal(describe(empty).label, "Waiting for a completed check run");
  } finally { h.close(); }
});
test("failed status reads retain clearly dated data and lost authorization hides it", async () => {
  let mode = "ok";
  const h = await harness(async () => { if (mode !== "ok") throw { status: Number(mode), message: "SECRET BACKEND ERROR" }; return { health: fixture() }; });
  try {
    mode = "503"; await h.instance.refresh(); assert.match(h.root.textContent, /These figures may have changed/); assert.match(h.root.textContent, /55 \/ 55/); assert.doesNotMatch(h.root.textContent, /SECRET/);
    mode = "403"; await h.instance.refresh(); assert.match(h.root.textContent, /Your role cannot view refresh health/); assert.equal(h.root.querySelector(".refresh-health-metrics"), null);
    assert.match(h.root.textContent, /hidden until your access is restored/);
  } finally { h.close(); }
});
test("hidden pages do not poll and destroyed components ignore delayed results", async () => {
  let calls = 0, resolve;
  const h = await harness(async () => { calls++; if (calls === 1) return { health: fixture() }; return new Promise(done => { resolve = done; }); });
  try {
    Object.defineProperty(h.dom.window.document, "visibilityState", { configurable: true, value: "hidden" });
    h.dom.window.document.dispatchEvent(new h.dom.window.Event("visibilitychange")); assert.equal(calls, 1);
    Object.defineProperty(h.dom.window.document, "visibilityState", { configurable: true, value: "visible" });
    h.dom.window.document.dispatchEvent(new h.dom.window.Event("visibilitychange")); assert.equal(calls, 2);
    const before = h.root.textContent; h.instance.destroy(); const changed = fixture(); changed.sources.total = 999;
    resolve({ health: changed }); await new Promise(done => setTimeout(done, 0)); assert.equal(h.root.textContent, before);
  } finally { h.close(); }
});
test("both authorized staff pages load the reusable health panel", () => {
  for (const page of ["overview", "scrapers"]) {
    const html = readFileSync(new URL(`../public/staffpanel-${page}.html`, import.meta.url), "utf8");
    assert.match(html, /data-refresh-health/); assert.match(html, /staff-refresh-health\.css/);
    assert.ok(html.indexOf("staff-refresh-health.js") < html.indexOf("staffpanel-v3.js"));
  }
});
test("refresh health HTTP route is read-only, requires sign-in and is never cached", async () => {
  const server = createBrowseRPServer(); await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    const response = await fetch(`${origin}/api/admin/refresh-health`); assert.equal(response.status, 401); assert.equal(response.headers.get("cache-control"), "no-store"); assert.equal((await response.json()).health, undefined);
    const post = await fetch(`${origin}/api/admin/refresh-health`, { method: "POST" }); assert.equal(post.status, 405);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
