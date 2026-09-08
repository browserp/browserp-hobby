import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";

const source = readFileSync(new URL("../public/recommendations.js", import.meta.url), "utf8");
const key = "browserp-recommendations-v1";
const choiceKey = "browserp-cookie-choice-v1";
const markup = '<body><footer class="footer-v3"><div class="footer-column-v3"><a href="/legal#cookies">Cookie policy</a></div></footer></body>';
async function page(t, setup = () => {}) {
  const dom = new JSDOM(markup, { url: "https://browserp.test/legal", runScripts: "outside-only", pretendToBeVisual: true });
  t.after(() => dom.window.close());
  const w = dom.window;
  w.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  w.HTMLDialogElement.prototype.close = function () { this.open = false; this.dispatchEvent(new w.Event("close")); };
  w.fetch = async () => ({ ok: true, json: async () => ({ authenticated: false }) });
  setup(w); w.eval(source); w.document.dispatchEvent(new w.Event("DOMContentLoaded"));
  await new Promise(resolve => setImmediate(resolve));
  const button = text => [...(w.document.querySelector("dialog[open]") || w.document).querySelectorAll("button")].find(item => item.textContent === text && !item.closest('[hidden]'));
  return { w, button, open() { button("Cookie preferences").click(); return w.document.querySelector("dialog"); } };
}

test("footer preferences are opt-in, reopenable and restore focus without touching other storage or cookies", async t => {
  const { w, button, open } = await page(t, w => {
    w.localStorage.setItem("browserp-history", "existing shortcut");
    w.localStorage.setItem("browserp-compare", "existing shortlist");
    w.document.cookie = "brp_csrf=test-session";
  });
  assert.equal(w.document.querySelector("dialog"), null, "the first-visit prompt is nonmodal");
  assert.equal(w.localStorage.getItem(key), null);
  const dialog = open();
  assert.equal(dialog.open, true); assert.equal(w.localStorage.getItem(key), null);
  assert.equal(w.document.getElementById(dialog.getAttribute("aria-labelledby")).textContent, "Cookie preferences");
  assert.equal(dialog.querySelector('a[href="/legal#cookies"]').textContent, "Cookie policy");
  assert.equal(dialog.querySelector('a[href="/privacy"]').textContent, "Privacy policy");
  button("Accept recommendations").click();
  assert.equal(w.BrowseRPRecommendations.read().enabled, true);
  assert.equal(w.localStorage.getItem(choiceKey), "accepted");
  w.BrowseRPRecommendations.record({ slug: "test-community", platform_id: "fivem", region: "UK" });
  assert.equal(w.BrowseRPRecommendations.read().views.length, 1);
  button("Close preferences").click(); assert.equal(w.document.activeElement, button("Cookie preferences"));
  open(); assert.match(dialog.querySelector('[role="status"]').textContent, /are on/);
  button("Reject recommendations").click();
  assert.equal(w.localStorage.getItem(key), null);
  assert.equal(w.localStorage.getItem(choiceKey), "rejected");
  assert.equal(w.BrowseRPRecommendations.record({ slug: "later-view", platform_id: "fivem", region: "UK" }), false);
  assert.match(dialog.querySelector('[role="status"]').textContent, /history has been cleared/);
  assert.equal(w.localStorage.getItem("browserp-history"), "existing shortcut");
  assert.equal(w.localStorage.getItem("browserp-compare"), "existing shortlist");
  assert.equal(w.document.cookie, "brp_csrf=test-session");
  button("Close preferences").click(); open(); assert.match(dialog.querySelector('[role="status"]').textContent, /are off/);
});

test("first visit offers equal choices without enabling storage and a rejection survives another page", async t => {
  const first = await page(t);
  const prompt = first.w.document.querySelector('[data-cookie-prompt]');
  assert.ok(prompt && !prompt.hidden);
  assert.equal(prompt.getAttribute("role"), "region");
  assert.equal(first.w.document.activeElement, first.w.document.body, "no automatic focus grab");
  assert.equal(first.w.localStorage.getItem(key), null);
  assert.equal(first.w.localStorage.getItem(choiceKey), null);
  const accept = first.button("Accept recommendations"), reject = first.button("Reject recommendations");
  assert.equal(accept.className, reject.className);
  assert.equal(prompt.querySelector('a[href="/privacy"]').textContent, "Privacy policy");
  reject.click();
  assert.equal(prompt.hidden, true);
  assert.equal(first.w.localStorage.getItem(key), null);
  const next = await page(t, w => w.localStorage.setItem(choiceKey, first.w.localStorage.getItem(choiceKey)));
  assert.ok(!next.w.document.querySelector('[data-cookie-prompt]') || next.w.document.querySelector('[data-cookie-prompt]').hidden);
  assert.equal(next.w.BrowseRPRecommendations.read().enabled, false);
});

test("acceptance persists and existing explicit recommendation opt-in is not prompted again", async t => {
  const first = await page(t); first.button("Accept recommendations").click();
  assert.equal(first.w.document.querySelector('[data-cookie-prompt]').hidden, true);
  assert.equal(first.w.BrowseRPRecommendations.read().enabled, true);
  for (const includeChoice of [true, false]) {
    const next = await page(t, w => {
      w.localStorage.setItem(key, first.w.localStorage.getItem(key));
      if (includeChoice) w.localStorage.setItem(choiceKey, "accepted");
    });
    assert.ok(!next.w.document.querySelector('[data-cookie-prompt]') || next.w.document.querySelector('[data-cookie-prompt]').hidden);
    assert.equal(next.w.BrowseRPRecommendations.read().enabled, true);
  }
});

test("blocked choice storage leaves a usable notice and never claims a remembered decision", async t => {
  const { w, button } = await page(t, w => { w.Storage.prototype.setItem = () => { throw Error("Storage blocked"); }; });
  button("Accept recommendations").click();
  assert.equal(w.BrowseRPRecommendations.read().enabled, false);
  button("Reject recommendations").click();
  const prompt = w.document.querySelector('[data-cookie-prompt]');
  assert.equal(prompt.hidden, false);
  assert.match(prompt.querySelector('[role="status"]').textContent, /could not remember/);
  assert.equal(w.localStorage.getItem(choiceKey), null);
  assert.equal(w.localStorage.getItem(key), null);
  button("Manage preferences").click();
  assert.equal(w.document.querySelector("dialog").open, true);
});

test("failed preference writes never display a saved choice and preserve the actual setting", async t => {
  const { w, button, open } = await page(t);
  open();
  const save = w.Storage.prototype.setItem;
  w.Storage.prototype.setItem = () => { throw Error("Storage blocked"); };
  button("Accept recommendations").click();
  assert.equal(w.BrowseRPRecommendations.read().enabled, false);
  assert.match(w.document.querySelector('dialog [role="status"]').textContent, /could not save/);
  save.call(w.localStorage, key, JSON.stringify({ enabled: true, views: [] }));
  w.Storage.prototype.removeItem = () => { throw Error("Storage blocked"); };
  button("Reject recommendations").click();
  assert.equal(w.BrowseRPRecommendations.read().enabled, false);
  assert.match(w.document.querySelector('dialog [role="status"]').textContent, /could not save/);
});

test("existing profile controls and cross-tab changes stay in sync with footer choices", async t => {
  const { w, button, open } = await page(t, w => {
    const profile = w.document.createElement("section"); profile.dataset.recommendationSettings = ""; w.document.body.prepend(profile);
  });
  open(); const input = w.document.querySelector('input[type="checkbox"]');
  button("Accept recommendations").click(); assert.equal(input.checked, true);
  button("Reject recommendations").click(); assert.equal(input.checked, false);
  input.checked = true; input.dispatchEvent(new w.Event("change"));
  assert.match(w.document.querySelector('.cookie-preferences-v3 [role="status"]').textContent, /are on/);
  w.localStorage.removeItem(key); w.dispatchEvent(new w.StorageEvent("storage", { key }));
  assert.equal(input.checked, false);
  assert.match(w.document.querySelector('.cookie-preferences-v3 [role="status"]').textContent, /are off/);
  w.BrowseRPRecommendations.mountCookiePreferences(w.document.querySelector("footer"));
  assert.equal(w.document.querySelectorAll("[data-cookie-preferences]").length, 1);
});
