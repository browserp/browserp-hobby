import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";

const read = file => readFileSync(new URL(`../public/${file}`, import.meta.url), "utf8");
const serverId = "22222222-2222-4222-8222-222222222222";
const feature = (extra = {}) => ({ canManage: true, active: null, version: 0, servers: [{ id: serverId, name: "First RP" }], ...extra });
const tick = async () => { await new Promise(resolve => setImmediate(resolve)); };
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const error = status => Object.assign(new Error(`Fixture failure ${status}`), { status });
function harness(t, respond = async () => ({ feature: feature() })) {
  const dom = new JSDOM(read("staffpanel-overview.html"), { url: "https://browserp.test/staffpanel/overview", runScripts: "outside-only", pretendToBeVisual: true });
  t.after(() => dom.window.close());
  const w = dom.window, root = w.document.getElementById("overview-featured-boost"), calls = [];
  w.eval(read("staff-featured-boost.js"));
  const api = async (path, options = {}) => { calls.push({ path, options }); return respond(path, options); };
  const get = name => root.querySelector(`[data-boost-${name}]`);
  return { w, root, calls, api, get, init: () => w.BrowseRPStaffFeaturedBoost.init({ api }) };
}
function draft(h) { h.get("server").value = serverId; h.get("duration").value = "24"; h.get("reason").value = "A reviewed homepage feature"; }

test("Boost stays unavailable before permission verification, on denial and on malformed responses", async t => {
  const waiting = deferred(); const h = harness(t, () => waiting.promise);
  assert.equal(h.root.hidden, true); assert.equal(h.root.hasAttribute("inert"), true);
  const init = h.init();
  h.get("start").dispatchEvent(new h.w.Event("click")); assert.equal(h.calls.length, 1);
  waiting.resolve({ feature: { canManage: false } }); await init;
  assert.equal(h.root.hidden, true); assert.equal(h.get("start").disabled, true); assert.equal(h.get("server").options.length, 1);
  for (const value of [null, {}, feature({ version: null }), feature({ active: { serverId, expiresAt: "invalid" } })]) {
    const broken = harness(t, async () => ({ feature: value })); await broken.init();
    assert.equal(broken.get("start").disabled, true); assert.equal(broken.get("retry").hidden, false);
  }
});

test("failed initial load can retry safely and renders server names as text", async t => {
  let failed = true;
  const h = harness(t, async () => { if (failed) throw error(503); return { feature: feature({ servers: [{ id: serverId, name: '<img src=x onerror="bad()">' }] }) }; });
  await h.init(); assert.equal(h.get("start").disabled, true); assert.equal(h.get("retry").hidden, false);
  h.get("start").dispatchEvent(new h.w.Event("click")); assert.equal(h.calls.length, 1);
  failed = false; h.get("retry").click(); await tick();
  assert.equal(h.get("start").disabled, false); assert.equal(h.root.querySelector("img"), null);
  assert.match(h.get("server").textContent, /<img/);
});

test("start uses the selected duration and version, prevents duplicates and reloads saved state", async t => {
  const pending = deferred(); let saved = false;
  const h = harness(t, async (_, options) => {
    if (options.method === "POST") { await pending.promise; saved = true; return { result: { version: 1 } }; }
    return { feature: feature(saved ? { version: 1, active: { serverId, name: "First RP", expiresAt: new Date(Date.now() + 86400000).toISOString() } } : {}) };
  });
  await h.init(); draft(h); h.get("start").click(); h.get("start").dispatchEvent(new h.w.Event("click"));
  assert.equal(h.calls.filter(c => c.options.method === "POST").length, 1);
  assert.equal(h.get("reason").disabled, true);
  assert.deepEqual(JSON.parse(h.calls.at(-1).options.body), { action: "start", serverId, durationHours: 24, expectedVersion: 0, reason: "A reviewed homepage feature" });
  pending.resolve(); await tick();
  assert.equal(h.get("reason").value, ""); assert.equal(h.get("end").hidden, false); assert.equal(h.get("start").disabled, false);
  assert.match(h.get("status").textContent, /is boosted until/);
});

test("version conflicts keep the draft but require fresh state before another write", async t => {
  let reads = 0;
  const h = harness(t, async (_, options) => {
    if (options.method === "POST") throw error(409);
    return { feature: feature({ version: reads++ ? 4 : 2 }) };
  });
  await h.init(); draft(h); h.get("start").click(); await tick();
  assert.equal(h.get("reason").value, "A reviewed homepage feature"); assert.equal(h.get("start").disabled, true);
  h.get("start").dispatchEvent(new h.w.Event("click")); assert.equal(h.calls.filter(c => c.options.method === "POST").length, 1);
  h.get("retry").click(); await tick();
  assert.equal(h.get("server").value, serverId); assert.equal(h.get("duration").value, "24");
  h.get("start").click(); await tick(); assert.equal(JSON.parse(h.calls.at(-1).options.body).expectedVersion, 4);
});

test("a saved mutation followed by failed refresh is reported accurately and remains locked", async t => {
  let saved = false;
  const h = harness(t, async (_, options) => {
    if (options.method === "POST") { saved = true; return { result: { version: 1 } }; }
    if (saved) throw error(503);
    return { feature: feature() };
  });
  await h.init(); draft(h); h.get("start").click(); await tick();
  assert.match(h.get("status").textContent, /was saved.*could not be loaded/);
  assert.equal(h.get("start").disabled, true); assert.equal(h.get("retry").hidden, false);
});

test("ended sessions and page exits clear private drafts and ignore late reads or writes", async t => {
  for (const event of ["browserp:session-ended", "pagehide"]) {
    for (const phase of ["read", "write"]) await t.test(`${event} during ${phase}`, async t => {
      const pending = deferred();
      const h = harness(t, async (_, options) => phase === "read" || options.method === "POST" ? pending.promise : { feature: feature() });
      const init = h.init();
      if (phase === "write") { await init; draft(h); h.get("start").click(); }
      h.w.dispatchEvent(new h.w.Event(event));
      assert.equal(h.root.hidden, true); assert.equal(h.get("reason").value, ""); assert.equal(h.get("server").options.length, 1);
      pending.resolve(phase === "read" ? { feature: feature() } : { result: {} }); await init; await tick();
      assert.equal(h.root.hidden, true); assert.equal(h.get("start").disabled, true); assert.equal(h.get("server").options.length, 1);
      assert.equal(h.calls.length, phase === "read" ? 1 : 2, "late mutations must not reload private data");
    });
  }
});

test("a previous initialization cannot overwrite the next authorized initialization", async t => {
  const pending = deferred(); let reads = 0;
  const h = harness(t, async () => ++reads === 1 ? pending.promise : { feature: feature({ version: 7 }) });
  const old = h.init(); await h.init(); pending.resolve({ feature: feature({ version: 1 }) }); await old;
  draft(h); h.get("start").click(); await tick();
  assert.equal(JSON.parse(h.calls.find(c => c.options.method === "POST").options.body).expectedVersion, 7);
});

test("expiry updates controls automatically and long durations use bounded timers", async t => {
  let now = Date.now(), timer;
  const h = harness(t, async () => ({ feature: feature({ version: 1, active: { serverId, name: "First RP", expiresAt: new Date(now + 30 * 86400000).toISOString() } }) }));
  h.w.Date.now = () => now; h.w.setTimeout = (fn, delay) => { timer = { fn, delay }; return 1; }; h.w.clearTimeout = () => {};
  await h.init(); assert.equal(timer.delay, 2147483647); assert.equal(h.get("end").hidden, false);
  now += 31 * 86400000; timer.fn();
  assert.equal(h.get("end").hidden, true); assert.equal(h.get("end").disabled, true); assert.match(h.get("status").textContent, /No server is currently boosted/);
  draft(h); h.get("end").dispatchEvent(new h.w.Event("click")); assert.equal(h.calls.length, 1);
});

test("real shared client keeps Overview-only staff signed in but clears it on genuine Boost denial", async t => {
  for (const denied of [false, true]) await t.test(denied ? "revoked Boost access" : "Overview-only staff", async t => {
    const h = harness(t), w = h.w; let ended = 0;
    w.matchMedia = () => ({ matches: false });
    w.addEventListener("browserp:session-ended", () => ended++);
    w.BrowseRPStaffOverview = { init: async ({ onLoad }) => onLoad({ permissions: {} }) };
    w.BrowseRPStaffAdverts = w.BrowseRPStaffPublishing = { init: async () => {} };
    w.fetch = async path => {
      const status = path === "/api/admin/featured-boost" && denied ? 403 : 200;
      const payload = path === "/api/auth/session" ? { authenticated: true, provider: "discord", staffAccess: true, staff: true, user: { id: "staff-one" }, mfa: { required: false }, csrfToken: "fixture-csrf" }
        : path === "/api/admin/presence" ? { online: true } : denied ? { error: "Staff access revoked" } : { feature: { canManage: false } };
      return { ok: status === 200, status, json: async () => payload };
    };
    w.eval(read("staffpanel-v3.js")); await tick();
    assert.equal(ended, denied ? 1 : 0);
    assert.equal(h.root.isConnected, !denied); assert.equal(h.root.hidden, true);
    assert.equal(w.document.querySelectorAll(".staff-login-card-v3").length, denied ? 1 : 0);
  });
});
