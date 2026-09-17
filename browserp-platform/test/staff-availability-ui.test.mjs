import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";

const source = readFileSync(new URL("../public/staff-duty.js", import.meta.url), "utf8");
const overviewHtml = readFileSync(new URL("../public/staffpanel-overview.html", import.meta.url), "utf8");
const accountId = "11111111-1111-4111-8111-111111111111";
const tick = () => new Promise(resolve => setImmediate(resolve));

function harness(t) {
  const dom = new JSDOM('<section id="overview-duty"><p data-duty-live role="status"></p><div data-duty-content></div></section>', { url: "https://browserp.test/staffpanel/overview", runScripts: "outside-only" });
  t.after(() => dom.window.close());
  const { window } = dom;
  const calls = [];
  const api = async (path, options = {}) => {
    calls.push({ path, options });
    if (path === "/api/auth/session") return { authenticated: true, staff: true, user: { id: accountId } };
    if (path.startsWith("/api/admin/duty") && options.method === "POST") return { changed: true };
    const view = new URL(path, "https://browserp.test").searchParams.get("view");
    if (view === "self") return { duty: { availability: "away" } };
    if (view === "availability") return { availability: [{ userId: accountId, displayName: "Sam", availability: "away", updatedAt: "2026-09-17T10:00:00Z" }], nextAfterUserId: null };
    throw new Error(`Unexpected request: ${path}`);
  };
  window.eval(source);
  const root = window.document.querySelector("#overview-duty");
  return { window, root, calls, init: () => window.BrowseRPStaffDuty.init({ api, root }) };
}

test("staff availability keeps only Available, Busy and Away controls without duty-session displays", async t => {
  const app = harness(t);
  const controller = await app.init();
  assert.match(app.root.textContent, /Your availability.*Away/s);
  assert.match(app.root.textContent, /Team availability/);
  assert.doesNotMatch(app.root.textContent, /Clock in|Clock out|work session|Confirmed time|Needs review|staff hours/i);
  const labels = [...app.root.querySelectorAll("button.staff-duty-choice")].map(button => button.textContent.trim());
  assert.deepEqual(labels, ["Available", "Busy", "Away"]);
  app.root.querySelector("button.staff-duty-choice:nth-child(2)").click();
  await tick();
  const mutation = app.calls.find(call => call.options.method === "POST");
  assert.deepEqual(JSON.parse(mutation.options.body).action, "set_availability");
  assert.equal(JSON.parse(mutation.options.body).availability, "busy");
  assert.equal(JSON.parse(mutation.options.body).userId, undefined);
  assert.equal(app.calls.filter(call => call.path.startsWith("/api/admin/duty")).every(call => call.options.headers["X-BrowseRP-Account"] === accountId), true);
  controller.destroy();
});

test("Overview no longer repeats queue footer links or duty-session wording", () => {
  assert.match(overviewHtml, /<h2 id="staff-duty-title">Availability<\/h2>/);
  assert.match(overviewHtml, /available, busy or away/i);
  assert.doesNotMatch(overviewHtml, /staff-panel-links/);
  assert.doesNotMatch(overviewHtml, /Record confirmed work sessions|Duty &amp; availability/i);
  assert.doesNotMatch(source, /clock_in|clock_out|confirmedSeconds|correct_session|staff-duty-session/);
});
