import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";

const summaryPath = "/api/admin/moderation?view=summary";
const optional = { optionalOverviewCapabilities: true };
const read = file => readFileSync(new URL(`../public/${file}`, import.meta.url), "utf8");
const tick = () => new Promise(resolve => setImmediate(resolve));
const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
const session = { authenticated: true, provider: "discord", staffAccess: true, staff: true, user: { id: "staff-one" }, mfa: { required: false }, csrfToken: "initial-csrf" };
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

async function harness(t, { page = "overview", initial = session, revalidate = async () => json(session), respond = async () => json({ error: "Moderation permission required" }, 403) } = {}) {
  const dom = new JSDOM(read(`staffpanel-${page}.html`), { url: `https://browserp.test/staffpanel/${page}`, runScripts: "outside-only" });
  t.after(() => dom.window.close());
  const w = dom.window;
  w.matchMedia = () => ({ matches: false });
  const calls = [];
  let sessionReads = 0, ended = 0, api;
  w.addEventListener("browserp:session-ended", () => { ended++; });
  const init = async options => { api = options.api; };
  w.BrowseRPStaffOverview = { init };
  w.BrowseRPStaffModeration = { init };
  w.fetch = async (path, options) => {
    calls.push({ path, options });
    if (path === "/api/auth/session") return ++sessionReads === 1 ? json(initial) : revalidate();
    if (path === "/api/admin/presence") return json({ online: true });
    return respond(path, options);
  };
  w.eval(read("staffpanel-v3.js"));
  await tick();
  assert.equal(typeof api, "function", "authorized page receives its API client");
  const form = w.document.createElement("form");
  form.setAttribute("aria-busy", "true");
  form.innerHTML = '<textarea name="reason">Unsaved decision</textarea><input type="hidden" name="record" value="record-7"><button disabled>Saving…</button>';
  w.document.querySelector("main").append(form);
  return { w, api, calls, form, sessionReads: () => sessionReads, ended: () => ended };
}

test("optional Overview capability denial preserves the same staff draft only after fresh validation", async t => {
  const h = await harness(t, {
    revalidate: async () => json({ ...session, csrfToken: "fresh-csrf" }),
    respond: async path => path === summaryPath ? json({ error: "No moderation sections assigned" }, 403) : json({ saved: true })
  });
  const root = h.w.document.querySelector("#staff-app-v3");
  h.w.document.dispatchEvent(new h.w.Event("visibilitychange"));
  assert.equal(root.hidden, true, "hidden tab masks its private workspace");
  await assert.rejects(h.api(summaryPath, optional), error => error.status === 403 && error.sectionUnavailable === true && error.message === "No moderation sections assigned");
  assert.equal(h.sessionReads(), 2);
  assert.equal(h.ended(), 0);
  assert.equal(h.form.isConnected, true);
  assert.equal(h.form.querySelector("textarea").value, "Unsaved decision");
  assert.equal(h.form.querySelector("input").value, "record-7");
  assert.equal(h.form.querySelector("button").disabled, true);
  assert.equal(h.form.getAttribute("aria-busy"), "true");
  assert.equal(root.hidden, true, "a capability recheck must not reveal a hidden tab");
  assert.equal(root.hasAttribute("inert"), true);
  await h.api("/api/admin/fixture-save", { method: "POST", body: "{}" });
  assert.equal(h.calls.at(-1).options.headers["X-BrowseRP-CSRF"], "fresh-csrf");
  for (const call of h.calls) {
    assert.equal(Object.hasOwn(call.options, "optionalOverviewCapabilities"), false);
    assert.equal(call.options.credentials, "same-origin");
    assert.equal(call.options.cache, "no-store");
  }
});

test("successful optional reads preserve the real capability payload without a session recheck", async t => {
  const payload = { summary: { capabilities: { readReports: false, readListings: true }, permissions: { keys: ["servers.review"] } } };
  const h = await harness(t, { respond: async () => json(payload) });
  assert.equal(await h.api(summaryPath, optional), payload);
  assert.equal(h.sessionReads(), 1);
  assert.equal(h.ended(), 0);
});

test("the exception cannot apply to other calls, methods, pages or missing account identity", async t => {
  const cases = [
    ["unflagged request", {}, summaryPath, {}],
    ["false flag", {}, summaryPath, { optionalOverviewCapabilities: false }],
    ["different endpoint", {}, "/api/admin/overview", optional],
    ["additional query", {}, summaryPath + "&extra=1", optional],
    ["POST", {}, summaryPath, { ...optional, method: "POST", body: "{}" }],
    ["HEAD", {}, summaryPath, { ...optional, method: "HEAD" }],
    ["GET body", {}, summaryPath, { ...optional, body: "{}" }],
    ["Moderation page", { page: "moderation" }, summaryPath, optional],
    ["missing account ID", { initial: { ...session, user: {} } }, summaryPath, optional]
  ];
  for (const [name, settings, path, options] of cases) await t.test(name, async t => {
    const h = await harness(t, settings);
    await assert.rejects(h.api(path, options), error => error.status === 403 && error.sectionUnavailable !== true);
    assert.equal(h.sessionReads(), 1);
    assert.equal(h.form.isConnected, false);
    assert.equal(h.ended(), 1);
    assert.equal(h.calls.at(-1).options.optionalOverviewCapabilities, undefined);
  });
});

test("a summary401 still ends access immediately without optional revalidation", async t => {
  const h = await harness(t, { respond: async () => json({ error: "Sign in again" }, 401) });
  await assert.rejects(h.api(summaryPath, optional), error => error.status === 401 && error.sectionUnavailable !== true);
  assert.equal(h.sessionReads(), 1);
  assert.equal(h.ended(), 1);
  assert.equal(h.form.isConnected, false);
});

test("changed, revoked, signed-out and malformed revalidation cannot retain the workspace", async t => {
  const cases = [
    ["changed account", { ...session, user: { id: "staff-two" } }],
    ["revoked staff", { ...session, staff: false }],
    ["signed out", { authenticated: false, staff: false, user: null }],
    ["missing account", { ...session, user: null }],
    ["nonboolean staff", { ...session, staff: "true" }],
    ["malformed session", null]
  ];
  for (const [name, fresh] of cases) await t.test(name, async t => {
    const h = await harness(t, { revalidate: async () => json(fresh) });
    await assert.rejects(h.api(summaryPath, optional), error => error.status === 403 && error.sectionUnavailable !== true);
    assert.equal(h.form.isConnected, false);
    assert.equal(h.ended(), 1);
    const count = h.calls.length;
    await assert.rejects(h.api("/api/admin/fixture-save", { method: "POST", body: "{}" }), error => error.status === 403);
    assert.equal(h.calls.length, count, "unverified staff cannot issue another private request");
  });
});

test("failed session revalidation clears private content and remains an untagged failure", async t => {
  const cases = [
    ["session401", async () => json({ error: "Expired session" }, 401), 401],
    ["session403", async () => json({ error: "Staff access revoked" }, 403), 403],
    ["session503", async () => json({ error: "Session service unavailable" }, 503), 503],
    ["network failure", async () => { throw new Error("Connection interrupted"); }, undefined]
  ];
  for (const [name, revalidate, status] of cases) await t.test(name, async t => {
    const h = await harness(t, { revalidate });
    await assert.rejects(h.api(summaryPath, optional), error => error.status === status && error.sectionUnavailable !== true);
    assert.equal(h.form.isConnected, false);
    assert.equal(h.ended(), 1);
    if (status === 503 || status === undefined) assert.match(h.w.document.body.textContent, /Staff access could not be checked/);
  });
});

test("a late successful revalidation cannot resurrect an ended or departed staff view", async t => {
  for (const cause of ["ordinary denial", "pagehide"]) await t.test(cause, async t => {
    const fresh = deferred();
    const h = await harness(t, { revalidate: () => fresh.promise });
    const result = h.api(summaryPath, optional).catch(error => error);
    await tick();
    assert.equal(h.sessionReads(), 2);
    if (cause === "ordinary denial") await assert.rejects(h.api("/api/admin/ordinary-denial"), error => error.status === 403);
    else h.w.dispatchEvent(new h.w.PageTransitionEvent("pagehide", { persisted: true }));
    const root = h.w.document.querySelector("#staff-app-v3");
    const content = root.innerHTML;
    const ended = h.ended();
    fresh.resolve(json(session));
    const error = await result;
    assert.equal(error.status, 401);
    assert.equal(error.sectionUnavailable, undefined);
    assert.equal(h.form.isConnected, false);
    assert.equal(h.ended(), ended, "late callback does not mount a new access view");
    assert.equal(root.innerHTML, content);
  });
});

test("a stale summary denial never starts a fresh account read", async t => {
  const summary = deferred();
  const h = await harness(t, { respond: path => path === summaryPath ? summary.promise : json({ error: "Revoked" }, 403) });
  const result = h.api(summaryPath, optional).catch(error => error);
  await tick();
  await assert.rejects(h.api("/api/admin/ordinary-denial"), error => error.status === 403);
  summary.resolve(json({ error: "No moderation access" }, 403));
  const error = await result;
  assert.equal(error.status, 401);
  assert.equal(error.sectionUnavailable, undefined);
  assert.equal(h.sessionReads(), 1);
  assert.equal(h.form.isConnected, false);
});
