import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
const read = file => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const account = "00000000-0000-4000-8000-000000000001";
const other = "00000000-0000-4000-8000-000000000002";
const row = { id: "22222222-0000-4000-8000-000000000002", kind: "copy", status: "submitted", details: "Private account request fixture", staffReply: "", version: 1, accountId: account, displayName: "Fixture member", createdAt: "2026-09-05T10:00:00Z", updatedAt: "2026-09-05T10:00:00Z" };
const tick = () => new Promise(resolve => setImmediate(resolve));
const settle = async () => { for (let i = 0; i < 6; i++) await tick(); };
function dom(t, page, hash = "") {
  const app = new JSDOM(read(`public/${page}.html`), { url: `https://browserp.test/${page === "staffpanel-moderation" ? "staffpanel/moderation" : page}${hash}`, runScripts: "outside-only" });
  t.after(() => app.window.close());
  app.window.eval(read("public/privacy-requests.js"));
  return app.window;
}
function profile(t, hash = "", override = () => undefined) {
  const w = dom(t, "profile", hash), calls = [];
  w.fetch = async (path, options = {}) => {
    calls.push({ path, options }); const result = await override(path, options); if (result !== undefined) return result;
    const body = path === "/api/auth/session" ? { authenticated: true, csrfToken: "fixture-csrf", user: { id: account } }
      : path === "/api/public/content" ? { content: {} }
        : path === "/api/me/profile" ? { profile: { display_name: "Fixture member" } }
          : path === "/api/me/overview" ? { overview: {} }
            : path === "/api/me/data-requests" ? { items: [row] }
              : path === "/api/auth/providers" ? { providers: { discord: true } } : {};
    return { ok: true, json: async () => body };
  };
  w.eval(read("public/browserp-portal-v2.js"));
  return { w, doc: w.document, calls };
}
function moderation(t, override = () => undefined, hash = "#data-requests") {
  const w = dom(t, "staffpanel-moderation", hash), calls = [];
  w.eval(read("public/staff-moderation-filter.js")); w.eval(read("public/staff-moderation.js"));
  const api = async (path, options = {}) => {
    calls.push({ path, options }); const result = await override(path, options); if (result !== undefined) return result;
    if (path === "/api/admin/moderation?view=summary") return { summary: { generatedAt: row.createdAt, counts: {}, capabilities: {}, permissions: { keys: [] } } };
    if (path === "/api/admin/data-requests?access=1") return { canReview: true };
    if (path.startsWith("/api/admin/data-requests")) return { items: [row] };
    throw new Error(`Unexpected fixture route ${path}`);
  };
  return { w, doc: w.document, calls, init: extra => w.BrowseRPStaffModeration.init({ api, accountId: account, ...extra }) };
}

test("Profile loads Your data on demand, carries the displayed account and opens the policy deep link", async t => {
  const h = profile(t); await settle();
  const section = h.doc.querySelector("#your-data"); assert.ok(section); assert.equal(section.open, false);
  assert.equal(h.calls.some(call => call.path === "/api/me/data-requests"), false);
  section.open = true; section.dispatchEvent(new h.w.Event("toggle")); await settle();
  assert.match(section.textContent, /Private account request fixture/);
  assert.equal(h.calls.find(call => call.path === "/api/me/data-requests").options.headers["X-BrowseRP-Account"], account);
  const direct = profile(t, "#your-data"); await settle(); assert.equal(direct.doc.querySelector("#your-data").open, true);
  for (const page of ["privacy", "legal"]) {
    const policy = new JSDOM(read(`public/${page}.html`)); assert.ok(policy.window.document.querySelector('a[href="/profile#your-data"]')); policy.window.close();
  }
});

test("a signed-out privacy link returns to Your data after sign-in instead of losing the requested section", async t => {
  const h = profile(t, "#your-data", path => path === "/api/auth/session" ? { ok: true, json: async () => ({ authenticated: false }) } : undefined);
  await settle();
  const login = h.doc.querySelector('#portal-root a[href^="/api/auth/discord"]'); assert.ok(login);
  assert.equal(new URL(login.href).searchParams.get("returnTo"), "/profile?section=your-data");
  assert.equal(h.calls.some(call => call.path === "/api/me/data-requests"), false);
  const resumed = profile(t, "?section=your-data"); await settle(); assert.equal(resumed.doc.querySelector("#your-data").open, true);
});

test("the actual Profile mount clears after account changes and late responses cannot restore its private request", async t => {
  let changed = false, release;
  const h = profile(t, "#your-data", (path, options) => {
    if (path !== "/api/me/data-requests") return;
    if (changed) return { ok: false, status: 401, json: async () => ({ error: "Your account has changed." }) };
    return new Promise(resolve => { release = () => resolve({ ok: true, json: async () => ({ items: [row] }) }); });
  });
  await settle(); h.w.dispatchEvent(new h.w.CustomEvent("browserp:session-ended", { detail: { reason: "connection-removed", remainingProviders: ["discord"] } })); release(); await settle();
  assert.equal(h.doc.querySelector("#your-data"), null); assert.doesNotMatch(h.doc.body.textContent, /Private account request fixture/);
  const switched = profile(t, "#your-data", path => path === "/api/me/data-requests" && changed ? { ok: false, status: 401, json: async () => ({ error: "Your account has changed." }) } : undefined);
  await settle(); const oldForm = switched.doc.querySelector("#your-data form"); changed = true;
  [...switched.doc.querySelectorAll("#your-data button")].find(button => button.textContent === "Refresh requests").click(); await settle();
  assert.equal(switched.doc.querySelector("#your-data"), null); assert.doesNotMatch(switched.doc.body.textContent, /Private account request fixture/);
  const before = switched.calls.length; oldForm.dispatchEvent(new switched.w.Event("submit", { bubbles: true, cancelable: true })); await settle(); assert.equal(switched.calls.length, before);
});

test("Moderation independently gates the private queue and tears it down on navigation and refreshed permission", async t => {
  let permitted = false;
  const h = moderation(t, path => path === "/api/admin/data-requests?access=1" ? { canReview: permitted } : undefined);
  const controller = await h.init(); await settle();
  assert.equal(h.doc.querySelector('#moderation-tabs a[href="#data-requests"]'), null);
  assert.equal(h.calls.some(call => call.path.includes("?kind=")), false);
  permitted = true; await controller.refresh(); await settle();
  assert.ok(h.doc.querySelector('#moderation-tabs a[href="#data-requests"]'));
  assert.match(h.doc.querySelector("#moderation-content").textContent, /Private account request fixture/);
  assert.equal(h.calls.find(call => call.path.includes("?kind=")).options.headers["X-BrowseRP-Account"], account);
  const form = h.doc.querySelector("article form");
  h.w.location.hash = "#summary"; h.w.dispatchEvent(new h.w.Event("hashchange")); await settle();
  assert.doesNotMatch(h.doc.querySelector("#moderation-content").textContent, /Private account request fixture/);
  const before = h.calls.length; form.dispatchEvent(new h.w.Event("submit", { bubbles: true, cancelable: true })); await settle(); assert.equal(h.calls.length, before);
  h.w.location.hash = "#data-requests"; h.w.dispatchEvent(new h.w.Event("hashchange")); await settle();
  permitted = false; await controller.refresh(); await settle();
  assert.equal(h.doc.querySelector('#moderation-tabs a[href="#data-requests"]'), null);
  assert.doesNotMatch(h.doc.body.textContent, /Private account request fixture/);
});

test("Moderation permission denial, sign-out and a late private load cannot leave request text or editable decisions", async t => {
  let denied = false;
  const h = moderation(t, path => {
    if (denied && path.includes("?kind=")) throw Object.assign(new Error("Permission removed"), { status: 403 });
  });
  await h.init(); await settle(); denied = true;
  [...h.doc.querySelectorAll("button")].find(button => button.textContent === "Refresh requests").click(); await settle();
  assert.equal(h.doc.querySelector('#moderation-tabs a[href="#data-requests"]'), null); assert.doesNotMatch(h.doc.body.textContent, /Private account request fixture/);
  let finish; const pending = moderation(t, path => path.includes("?kind=") ? new Promise(resolve => { finish = () => resolve({ items: [row] }); }) : undefined);
  await pending.init(); await settle(); pending.w.dispatchEvent(new pending.w.Event("browserp:session-ended")); finish(); await settle();
  assert.doesNotMatch(pending.doc.body.textContent, /Private account request fixture/); assert.equal(pending.doc.querySelector("article form"), null);
});

test("Data request routes retain private responses, reject a switched account before RPC, and match production/development routing", async t => {
  const { default: router } = await import("../api/router.js");
  const previous = { ...process.env }, originalFetch = globalThis.fetch; t.after(() => { globalThis.fetch = originalFetch; for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key]; Object.assign(process.env, previous); });
  Object.assign(process.env, { APP_URL: "http://localhost:8080", NODE_ENV: "test", VERCEL: "0", SUPABASE_URL: "https://fixture.supabase.co", SUPABASE_PUBLISHABLE_KEY: "sb_publishable_fixture", SUPABASE_SECRET_KEY: "sb_secret_fixture" });
  const token = `fixture.${Buffer.from(JSON.stringify({ sub: account, aal: "aal2" })).toString("base64url")}.fixture`;
  const user = { id: account, app_metadata: { provider: "discord", providers: ["discord"] }, identities: [{ provider: "discord", provider_id: "fixture" }] };
  let switched = false; const operations = [];
  globalThis.fetch = async (url, options) => {
    const path = new URL(url).pathname; operations.push(path);
    const value = path === "/auth/v1/user" ? { ...user, id: switched ? other : account }
      : path.endsWith("/rpc/check_security_ban_server") ? null
        : path.endsWith("/rpc/staff_data_request_access") ? true
          : path.endsWith("/rpc/member_data_requests") || path.endsWith("/rpc/staff_data_requests") ? { items: [row] } : undefined;
    assert.notEqual(value, undefined, path); return new Response(JSON.stringify(value), { status: 200, headers: { "Content-Type": "application/json" } });
  };
  async function call(route, method = "GET") {
    const headers = new Map(); let payload;
    const response = { setHeader: (key, value) => headers.set(key.toLowerCase(), value), getHeader: key => headers.get(key.toLowerCase()), end: value => { payload = JSON.parse(value); } };
    await router({ browserpRoute: route, method, url: `/api/${route}`, headers: { host: "localhost:8080", "x-browserp-account": account, cookie: `brp_access=${token}` }, socket: { remoteAddress: "127.0.0.1" } }, response);
    return { status: response.statusCode, headers, payload };
  }
  for (const route of ["me/data-requests", "admin/data-requests"]) {
    const result = await call(route); assert.equal(result.status, 200); assert.equal(result.payload.items[0].id, row.id); assert.match(result.headers.get("cache-control"), /no-store/);
    assert.equal((await call(route, "DELETE")).status, 405);
  }
  switched = true; operations.length = 0;
  assert.equal((await call("me/data-requests")).status, 401); assert.equal((await call("admin/data-requests")).status, 401);
  assert.equal(operations.some(path => /data_requests|data_request_access/.test(path)), false);
  const rewrites = JSON.parse(read("vercel.json")).rewrites, dev = read("dev-server.mjs");
  for (const route of ["me/data-requests", "admin/data-requests"]) {
    assert.ok(rewrites.some(rewrite => rewrite.source === `/api/${route}` && rewrite.destination === `/api/router?_route=${route}`));
    for (const method of ["GET", "POST"]) assert.ok(dev.includes(`["${method} /api/${route}", ["api/router.js", "${route}"]]`));
  }
});
