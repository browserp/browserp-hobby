import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
const source = readFileSync(new URL("../public/recommendations.js", import.meta.url), "utf8");
const A = "00000000-0000-4000-8000-000000000001";
const tick = () => new Promise(resolve => setImmediate(resolve));
const preference = (choice, version) => ({ schemaVersion: 1, accountId: A, choice, version });
const server = { slug: "only-local-interest", platform_id: "fivem", region: "UK" };
function page(t, resolve) {
  const dom = new JSDOM('<body><div data-recommendation-settings></div><footer class="footer-v3"><a href="/legal#cookies">Cookies</a></footer></body>', {
    url: "https://browserp.test/profile", runScripts: "outside-only", pretendToBeVisual: true
  });
  t.after(() => dom.window.close()); const w = dom.window, calls = [];
  w.fetch = async (url, options) => { calls.push({ url, options }); return { ok: true, json: async () => resolve(url, options) }; };
  w.eval(source); w.document.dispatchEvent(new w.Event("DOMContentLoaded"));
  return { w, model: w.BrowseRPRecommendations, calls };
}
const session = { authenticated: true, user: { id: A }, csrfToken: "csrf-fixture" };

test("actual public model refuses views until account and preference both resolve", async t => {
  let resolve; const h = page(t, url => url === "/api/auth/session" ? session : new Promise(r => { resolve = r; }));
  assert.equal(h.model.record(server), false); await tick(); assert.equal(h.model.read().enabled, false);
  resolve(preference("accepted", 2)); await tick();
  assert.equal(h.model.record(server), true); assert.equal(h.model.read().views.length, 1);
  assert.doesNotMatch(JSON.stringify(h.calls), /only-local-interest|region|slug|views/);
});

test("visibility and session ending gate real reads, ranking and writes immediately", async t => {
  const h = page(t, url => url === "/api/auth/session" ? session : preference("accepted", 2)); await tick();
  assert.equal(h.model.record(server), true);
  Object.defineProperty(h.w.document, "hidden", { configurable: true, value: true });
  h.w.document.dispatchEvent(new h.w.Event("visibilitychange"));
  assert.equal(h.model.read().enabled, false); assert.equal(h.model.read().views.length, 0); assert.equal(h.model.record(server), false);
  Object.defineProperty(h.w.document, "hidden", { configurable: true, value: false });
  h.w.document.dispatchEvent(new h.w.Event("visibilitychange")); await tick(); assert.equal(h.model.read().enabled, true);
  h.w.dispatchEvent(new h.w.Event("browserp:session-ended"));
  assert.equal(h.model.read().enabled, false); assert.equal(h.w.localStorage.getItem("browserp-recommendations-v1"), null);
});

test("profile acceptance stays off while saving and uses the confirmed account and CSRF", async t => {
  let finish; const h = page(t, (url, options) => url === "/api/auth/session" ? session : options.method === "POST" ? new Promise(r => { finish = r; }) : preference(null, 0)); await tick();
  const input = h.w.document.querySelector("input"); input.checked = true; input.dispatchEvent(new h.w.Event("change"));
  assert.equal(h.model.record(server), false); assert.match(h.w.document.querySelector("[role=status]").textContent, /being|saved/);
  const write = h.calls.find(c => c.options.method === "POST");
  assert.equal(write.options.headers["X-BrowseRP-Account"], A); assert.equal(write.options.headers["X-BrowseRP-CSRF"], "csrf-fixture");
  assert.deepEqual(JSON.parse(write.options.body), { schemaVersion: 1, choice: "accepted", expectedVersion: 0 });
  await tick();
  finish(preference("accepted", 1)); await tick(); assert.equal(h.model.read().enabled, true);
});
