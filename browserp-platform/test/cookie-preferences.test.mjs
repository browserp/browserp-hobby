import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";

const source = readFileSync(new URL("../public/recommendations.js", import.meta.url), "utf8");
const key = "browserp-recommendations-v1";
const markup = '<body><footer class="footer-v3"><div class="footer-column-v3"><a href="/legal#cookies">Cookie policy</a></div></footer></body>';
function page(t, setup = () => {}) {
  const dom = new JSDOM(markup, { url: "https://browserp.test/legal", runScripts: "outside-only" });
  t.after(() => dom.window.close());
  const w = dom.window;
  w.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  w.HTMLDialogElement.prototype.close = function () { this.open = false; this.dispatchEvent(new w.Event("close")); };
  setup(w); w.eval(source); w.document.dispatchEvent(new w.Event("DOMContentLoaded"));
  const button = text => [...w.document.querySelectorAll("button")].find(item => item.textContent === text);
  return { w, button, open() { button("Cookie preferences").click(); return w.document.querySelector("dialog"); } };
}

test("footer preferences are opt-in, reopenable and restore focus without touching other storage or cookies", t => {
  const { w, button, open } = page(t, w => {
    w.localStorage.setItem("browserp-history", "existing shortcut");
    w.localStorage.setItem("browserp-compare", "existing shortlist");
    w.document.cookie = "brp_csrf=test-session";
  });
  assert.equal(w.document.querySelector("dialog"), null, "no forced popup");
  assert.equal(w.localStorage.getItem(key), null);
  const dialog = open();
  assert.equal(dialog.open, true); assert.equal(w.localStorage.getItem(key), null);
  assert.equal(w.document.getElementById(dialog.getAttribute("aria-labelledby")).textContent, "Cookie preferences");
  assert.equal(dialog.querySelector('a[href="/legal#cookies"]').textContent, "Cookie policy");
  assert.equal(dialog.querySelector('a[href="/privacy"]').textContent, "Privacy policy");
  button("Accept recommendations").click();
  assert.equal(w.BrowseRPRecommendations.read().enabled, true);
  w.BrowseRPRecommendations.record({ slug: "test-community", platform_id: "fivem", region: "UK" });
  assert.equal(w.BrowseRPRecommendations.read().views.length, 1);
  button("Close preferences").click(); assert.equal(w.document.activeElement, button("Cookie preferences"));
  open(); assert.match(dialog.querySelector('[role="status"]').textContent, /are on/);
  button("Reject recommendations").click();
  assert.equal(w.localStorage.getItem(key), null);
  assert.equal(w.BrowseRPRecommendations.record({ slug: "later-view", platform_id: "fivem", region: "UK" }), false);
  assert.match(dialog.querySelector('[role="status"]').textContent, /history has been cleared/);
  assert.equal(w.localStorage.getItem("browserp-history"), "existing shortcut");
  assert.equal(w.localStorage.getItem("browserp-compare"), "existing shortlist");
  assert.equal(w.document.cookie, "brp_csrf=test-session");
  button("Close preferences").click(); open(); assert.match(dialog.querySelector('[role="status"]').textContent, /are off/);
});

test("failed preference writes never display a saved choice and preserve the actual setting", t => {
  const { w, button, open } = page(t);
  open();
  const save = w.Storage.prototype.setItem;
  w.Storage.prototype.setItem = () => { throw Error("Storage blocked"); };
  button("Accept recommendations").click();
  assert.equal(w.BrowseRPRecommendations.read().enabled, false);
  assert.match(w.document.querySelector('[role="status"]').textContent, /could not save/);
  save.call(w.localStorage, key, JSON.stringify({ enabled: true, views: [] }));
  w.Storage.prototype.removeItem = () => { throw Error("Storage blocked"); };
  button("Reject recommendations").click();
  assert.equal(w.BrowseRPRecommendations.read().enabled, true);
  assert.match(w.document.querySelector('[role="status"]').textContent, /could not save/);
});

test("existing profile controls and cross-tab changes stay in sync with footer choices", t => {
  const { w, button, open } = page(t, w => {
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
