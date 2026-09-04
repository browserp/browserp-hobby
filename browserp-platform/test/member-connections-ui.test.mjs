import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";

const source = readFileSync(new URL("../public/member-connections.js", import.meta.url), "utf8");
const tick = () => new Promise(resolve => setImmediate(resolve));
const providers = [{ provider: "discord", connected: true, enabled: true, canConnect: false }, { provider: "google", connected: false, enabled: true, canConnect: true }];
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
    if (!options) return { connections: { canManage: true, providers } };
    posts.push({ path, options }); return new Promise((_resolve, rejectPromise) => { reject = rejectPromise; });
  });
  const button = h.root.querySelector("button"); button.click(); button.click(); assert.equal(posts.length, 1); assert.equal(button.disabled, true);
  assert.deepEqual(JSON.parse(posts[0].options.body), { provider: "google", returnTo: "/profile" });
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
