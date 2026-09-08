import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";

const source = readFileSync(new URL("../public/staff-duty.js", import.meta.url), "utf8");
const accountId = "11111111-1111-4111-8111-111111111111";
const asOf = "2026-09-08T12:00:00Z";

function selfFixture(overrides = {}) {
  return {
    view: "self",
    from: "2026-08-09T12:00:00Z",
    to: asOf,
    asOf,
    canManageTeam: false,
    duty: { availability: "away", updatedAt: asOf, openSession: null },
    sessions: [
      { id: "session-confirmed", userId: accountId, displayName: "Sam", startedAt: "2026-09-07T10:00:00Z", endedAt: "2026-09-07T12:00:00Z", status: "confirmed", version: 2, needsReview: false, confirmedSeconds: 7200 },
      { id: "session-review", userId: accountId, displayName: "Sam", startedAt: "2026-09-06T10:00:00Z", endedAt: null, status: "needs_review", version: 3, needsReview: true, confirmedSeconds: 0 }
    ],
    next: null,
    totals: { confirmedSeconds: 7200, pendingReviewCount: 1, openSessionCount: 1 },
    teamTotals: null,
    nextAfterUserId: null,
    ...overrides
  };
}

function availabilityFixture(overrides = {}) {
  return {
    view: "availability",
    asOf,
    canManageTeam: false,
    availability: [
      { userId: accountId, displayName: "Sam", availability: "away", updatedAt: asOf },
      { userId: "22222222-2222-4222-8222-222222222222", displayName: "Alex", availability: "available", updatedAt: asOf }
    ],
    nextAfterUserId: null,
    ...overrides
  };
}

function teamFixture() {
  return {
    ...selfFixture({ view: "team", canManageTeam: true }),
    sessions: [{ id: "team-session", userId: "22222222-2222-4222-8222-222222222222", displayName: "Alex", startedAt: "2026-09-08T09:00:00Z", endedAt: "2026-09-08T10:30:00Z", status: "confirmed", version: 4, needsReview: false, confirmedSeconds: 5400 }],
    teamTotals: [{ userId: "22222222-2222-4222-8222-222222222222", displayName: "Alex", confirmedSeconds: 5400, pendingReviewCount: 0 }]
  };
}

function harness(t, handler, { self = selfFixture(), availability = availabilityFixture(), team = null } = {}) {
  const dom = new JSDOM('<section id="overview-duty" aria-busy="true"><p data-duty-live role="status"></p><div data-duty-content></div></section>', { url: "https://browserp.test/staffpanel/overview", runScripts: "outside-only", pretendToBeVisual: true });
  t.after(() => dom.window.close());
  const { window } = dom;
  window.eval(source);
  const calls = [];
  const api = async (path, options = {}) => {
    calls.push({ path, options });
    if (handler) {
      const result = await handler(path, options, calls);
      if (result !== undefined) return result;
    }
    if (path === "/api/auth/session") return { authenticated: true, staff: true, user: { id: accountId } };
    if (path.startsWith("/api/admin/duty") && options.method === "POST") return { changed: true };
    const view = new URL(path, "https://browserp.test").searchParams.get("view");
    if (view === "self") return structuredClone(self);
    if (view === "availability") return structuredClone(availability);
    if (view === "team" && team) return structuredClone(team);
    throw new Error("Unexpected duty request.");
  };
  const root = window.document.querySelector("#overview-duty");
  return { window, root, calls, init: extra => window.BrowseRPStaffDuty.init({ api, root, ...extra }) };
}

const settle = async () => { for (let index = 0; index < 12; index += 1) await new Promise(resolve => setImmediate(resolve)); };
const button = (root, text) => [...root.querySelectorAll("button")].find(item => item.textContent.trim() === text);

test("duty view binds private reads to the confirmed account and separates reviewed time", async t => {
  const app = harness(t);
  const controller = await app.init();
  assert.equal(app.calls[0].path, "/api/auth/session");
  const dutyReads = app.calls.filter(call => call.path.startsWith("/api/admin/duty"));
  assert.equal(dutyReads.length, 2);
  assert.equal(dutyReads.every(call => call.options.headers["X-BrowseRP-Account"] === accountId), true);
  assert.match(app.root.textContent, /Confirmed time2h/);
  assert.match(app.root.textContent, /Needs review1/);
  assert.match(app.root.textContent, /contributes 0m until its actual interval is confirmed/);
  assert.equal(app.root.querySelectorAll(".staff-duty-session").length, 2);
  assert.ok(button(app.root, "Clock in"));
  assert.equal(app.root.querySelector("[data-duty-live]").dataset.state, "live");
  controller.destroy();
});

test("availability and clock actions use fresh request keys without target overrides", async t => {
  const posts = [];
  const app = harness(t, (path, options) => {
    if (path === "/api/admin/duty" && options.method === "POST") {
      posts.push({ body: JSON.parse(options.body), headers: options.headers });
      return { changed: true };
    }
  });
  await app.init();
  button(app.root, "Available").click();
  await settle();
  button(app.root, "Clock in").click();
  await settle();
  assert.deepEqual(posts.map(post => post.body.action), ["set_availability", "clock_in"]);
  assert.equal(posts[0].body.availability, "available");
  assert.equal(posts.every(post => /^[a-f0-9-]{36}$/i.test(post.body.requestKey)), true);
  assert.notEqual(posts[0].body.requestKey, posts[1].body.requestKey);
  assert.equal(posts.every(post => post.body.userId === undefined), true);
  assert.equal(posts.every(post => post.headers["X-BrowseRP-Account"] === accountId), true);
});

test("an uncertain mutation retry preserves the exact idempotent request body", async t => {
  const bodies = [];
  const app = harness(t, (path, options) => {
    if (path !== "/api/admin/duty" || options.method !== "POST") return undefined;
    bodies.push(options.body);
    if (bodies.length === 1) throw new Error("Connection dropped after sending");
    return { changed: true };
  });
  await app.init();
  button(app.root, "Clock in").click();
  await settle();
  const retry = button(app.root, "Retry clock in");
  assert.ok(retry);
  retry.click();
  await settle();
  assert.equal(bodies.length, 2);
  assert.equal(bodies[1], bodies[0]);
});

test("team managers can submit a confirmed correction without a target account", async t => {
  let posted;
  const self = selfFixture({ canManageTeam: true });
  const availability = availabilityFixture({ canManageTeam: true });
  const app = harness(t, (path, options) => {
    if (path === "/api/admin/duty" && options.method === "POST") { posted = JSON.parse(options.body); return { changed: true }; }
  }, { self, availability, team: teamFixture() });
  await app.init();
  assert.match(app.root.textContent, /Management viewTeam work sessions/);
  const form = [...app.root.querySelectorAll(".staff-duty-correction form")].at(-1);
  assert.ok(form);
  form.elements.startedAt.value = "2026-09-08T09:15";
  form.elements.endedAt.value = "2026-09-08T10:45";
  form.elements.reason.value = "Corrected from the staff work record.";
  form.elements.confirmed.checked = true;
  form.dispatchEvent(new app.window.Event("submit", { bubbles: true, cancelable: true }));
  await settle();
  assert.equal(posted.action, "correct_session");
  assert.equal(posted.sessionId, "team-session");
  assert.equal(posted.version, 4);
  assert.equal(posted.confirmed, true);
  assert.equal(posted.userId, undefined);
  assert.match(posted.startedAt, /^2026-09-08T/);
  assert.match(posted.endedAt, /^2026-09-08T/);
});
