import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";

const source = readFileSync(new URL("../public/member-connections.js", import.meta.url), "utf8");
const tick = () => new Promise(resolve => setImmediate(resolve));
const providers = [{ provider: "discord", connected: true, enabled: true, canConnect: false }, { provider: "google", connected: false, enabled: true, canConnect: true }];
const accountId = "00000000-0000-4000-8000-000000000001";
function harness(t, query = "") {
  const dom = new JSDOM('<section id="connections"></section>', { url: `https://browserp.test/profile${query}`, runScripts: "outside-only" }); t.after(() => dom.window.close()); dom.window.eval(source);
  const root = dom.window.document.querySelector("#connections");
  return { root, w: dom.window, init: api => dom.window.BrowseRPMemberConnections.init({ root, api }) };
}

test("connections render actual connected providers and hide actions for staff or disabled providers", async t => {
  const h = harness(t);
  await h.init(async () => ({ connections: { canManage: false, message: "Staff accounts use dedicated Discord sign-in.", providers } }));
  assert.equal(h.root.querySelectorAll("button").length, 0); assert.match(h.root.textContent, /Staff accounts/); assert.match(h.root.textContent, /Connected/);
  await h.init(async () => ({ connections: { canManage: true, providers: providers.map(item => ({ ...item, enabled: false, canConnect: false })) } }));
  assert.equal(h.root.querySelectorAll("button").length, 0); assert.equal(h.root.hasAttribute("aria-busy"), false);
});

test("manual-linking failure remains readable and repeated clicks start only one connection request", async t => {
  const h = harness(t); let reject; const posts = [];
  await h.init(async (path, options) => {
    if (!options) return { connections: { accountId, canManage: true, providers } };
    posts.push({ path, options }); return new Promise((_resolve, rejectPromise) => { reject = rejectPromise; });
  });
  const button = h.root.querySelector("button"); button.click(); button.click(); assert.equal(posts.length, 1); assert.equal(button.disabled, true);
  assert.deepEqual(JSON.parse(posts[0].options.body), { provider: "google", accountId, returnTo: "/profile" });
  reject(new Error("Connecting another account is temporarily unavailable. Your current sign-in still works.")); await tick();
  assert.equal(button.disabled, false); assert.match(h.root.querySelector('[role="status"]').textContent, /temporarily unavailable/); assert.match(h.root.textContent, /DiscordConnected/);
});

test("untrusted connection redirects never become navigations and a query flag cannot invent a connected account", async t => {
  const h = harness(t, "?connections=linked");
  await h.init(async (_path, options) => options ? { authorizationUrl: "https://accounts.google.com.evil.example/o/oauth2/v2/auth" } : { connections: { canManage: true, providers } });
  assert.doesNotMatch(h.root.textContent, /connection was completed/); h.root.querySelector("button").click(); await tick(); assert.match(h.root.textContent, /invalid connection page/);
  assert.equal(h.w.location.hostname, "browserp.test");
  for (const value of ["javascript:alert(1)", "https://user@accounts.google.com/o/oauth2/auth", "https://accounts.google.com/o/oauth2/auth#payload", "https://discord.com/oauth2/authorize"]) assert.equal(h.w.BrowseRPMemberConnections.safeAuthorizationUrl(value, "google"), null);
});

test("connection load failures provide retry without removing the profile and use safe text rendering", async t => {
  const h = harness(t); let attempts = 0;
  const api = async () => { attempts++; if (attempts === 1) throw new Error("<img src=x onerror=alert(1)> network failure"); return { connections: { canManage: true, providers } }; };
  await h.init(api); assert.equal(h.root.querySelector("img"), null); assert.match(h.root.textContent, /network failure/);
  h.root.querySelector("button").click(); await tick(); assert.equal(attempts, 2); assert.match(h.root.textContent, /Connect Google/);
});

test("stale authentication offers only existing usable sign-ins before account changes", async t => {
  const h = harness(t);
  await h.init(async () => ({ connections: { accountId, canManage: true, reauthenticationRequired: true, message: "Sign in again before changing your connected accounts.", providers: providers.map(item => ({ ...item, canConnect: false })) } }));
  assert.equal(h.root.querySelectorAll("button").length, 0);
  assert.equal(h.root.querySelectorAll('a[href^="/api/auth/"]').length, 1);
  assert.equal(h.root.querySelector("a").getAttribute("href"), "/api/auth/discord?returnTo=%2Fprofile");
  await h.init(async (_path, options) => { if (options) throw Object.assign(new Error("Sign in again before changing your connected accounts."), { status: 428 }); return { connections: { accountId, canManage: true, providers } }; });
  h.root.querySelector("button").click(); await tick(); assert.equal(h.root.querySelectorAll("button").length, 0); assert.match(h.root.textContent, /Sign in with Discord/);
});

test("disconnect requires clear confirmation, sends exact identity once and reports session consequences", async t => {
  const h = harness(t); const posts = []; let finish;
  const connected = providers.map(item => ({ ...item, connected: true, canConnect: false, canDisconnect: item.provider === "google", identityId: `${item.provider}-owned-identity` }));
  await h.init(async (path, options) => {
    if (!options) return { connections: { accountId, canManage: true, providers: connected } };
    posts.push({ path, options }); return new Promise(resolve => { finish = resolve; });
  });
  const disconnect = h.root.querySelector("button"); disconnect.click();
  assert.equal(posts.length, 0); assert.match(h.root.textContent, /signed out on all devices.*Use Discord/);
  const keep = [...h.root.querySelectorAll("button")].find(button => button.textContent === "Keep connected"); assert.equal(h.w.document.activeElement, keep);
  keep.click(); assert.equal(posts.length, 0); assert.equal(h.w.document.activeElement, disconnect);
  disconnect.click(); const confirm = h.root.querySelector('.member-connection-confirmation button:last-child'); confirm.click(); confirm.click();
  assert.equal(posts.length, 1); assert.deepEqual(JSON.parse(posts[0].options.body), { action: "disconnect", accountId, provider: "google", identityId: "google-owned-identity" });
  finish({ disconnected: true, sessionsEnded: true, signInProviders: ["discord"] }); await tick();
  assert.match(h.root.textContent, /Google disconnected.*signed out on all devices/); assert.equal(h.root.querySelectorAll("button").length, 0); assert.match(h.root.querySelector("a").href, /\/api\/auth\/discord\?/);
});

test("a revoked session on initial load gives a direct configured sign-in path", async t => {
  const h = harness(t); const paths = [];
  await h.init(async path => {
    paths.push(path);
    if (path === "/api/me/connections") throw Object.assign(new Error("Sign in again to manage your connected accounts."), { status: 401 });
    return { providers: { discord: true, google: false } };
  });
  assert.deepEqual(paths, ["/api/me/connections", "/api/auth/providers"]);
  assert.equal(h.root.querySelectorAll("button").length, 0);
  assert.equal(h.root.querySelectorAll("a").length, 1);
  assert.equal(h.root.querySelector("a").getAttribute("href"), "/api/auth/discord?returnTo=%2Fprofile");
  assert.match(h.root.textContent, /already connected/);
  assert.equal(h.root.hasAttribute("aria-busy"), false);
});

test("an ambiguous disconnect offers the remaining provider, not the possibly removed login", async t => {
  const h = harness(t);
  const connected = providers.map(item => ({ ...item, connected: true, canConnect: false, canDisconnect: item.provider === "google", identityId: `${item.provider}-owned-identity` }));
  await h.init(async (_path, options) => {
    if (!options) return { connections: { accountId, canManage: true, providers: connected } };
    throw Object.assign(new Error("We couldn’t confirm the change. You’re signed out here. Sign in again to check your connected accounts."), { status: 401 });
  });
  h.root.querySelector("button").click(); h.root.querySelector('.member-connection-confirmation button:last-child').click(); await tick();
  assert.equal(h.root.querySelectorAll("button").length, 0);
  assert.equal(h.root.querySelectorAll("a").length, 1);
  assert.match(h.root.querySelector("a").textContent, /Discord/);
  assert.match(h.root.textContent, /couldn’t confirm/);
});
