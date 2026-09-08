import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";

const read = path => readFileSync(new URL(path, import.meta.url), "utf8");
const recommendations = read("../public/recommendations.js");
const appearanceCss = read("../public/first-visit-appearance.css");
// Exercise the actual public theme controller without booting unrelated page UI.
const publicSource = read("../public/browserp-v3.js");
const controllerEnd = publicSource.indexOf("  function initials(value) {");
assert.ok(controllerEnd > 0, "the public theme controller remains available");
const themeController = publicSource.slice(0, controllerEnd) + "})();";
const themeKey = "browserp-theme", choiceKey = "browserp-cookie-choice-v1";
const recommendationKey = "browserp-recommendations-v1";

async function page(t, { setup = () => {}, controller = true } = {}) {
  const dom = new JSDOM('<head><meta name="theme-color" content="#050507"></head><body><footer class="footer-v3"><a href="/legal#cookies">Cookie policy</a></footer></body>', { url: "https://browserp.test/legal", runScripts: "outside-only", pretendToBeVisual: true });
  t.after(() => dom.window.close());
  const w = dom.window, requests = [];
  w.fetch = async (url, options) => { requests.push({ url, options }); return { ok: true, json: async () => ({ authenticated: false }) }; };
  setup(w);
  if (controller) w.eval(themeController);
  w.eval(recommendations);
  w.document.dispatchEvent(new w.Event("DOMContentLoaded"));
  await new Promise(resolve => setImmediate(resolve));
  const styles = w.document.createElement("style"); styles.textContent = appearanceCss; w.document.head.append(styles);
  const prompt = w.document.querySelector("[data-cookie-prompt]");
  const appearance = prompt?.querySelector(".first-visit-appearance");
  return { w, requests, prompt, appearance, choice: theme => appearance.querySelector(`[data-appearance-choice="${theme}"]`) };
}
const stored = w => Object.fromEntries(Object.keys(w.localStorage).map(key => [key, w.localStorage.getItem(key)]));

test("first visit defaults to dark in a separate nonmodal keyboard-accessible Appearance group", async t => {
  const { w, prompt, appearance, choice } = await page(t);
  assert.equal(w.document.querySelector("dialog"), null);
  assert.equal(w.document.activeElement, w.document.body);
  assert.equal(appearance.getAttribute("role"), "group");
  assert.equal(w.document.getElementById(appearance.getAttribute("aria-labelledby")).textContent, "Appearance");
  assert.match(w.document.getElementById(appearance.getAttribute("aria-describedby")).textContent, /separate from recommendation preferences/);
  assert.equal(choice("dark").getAttribute("aria-pressed"), "true");
  assert.equal(choice("light").getAttribute("aria-pressed"), "false");
  assert.equal(w.localStorage.getItem(themeKey), null, "no choice is written on arrival");
  assert.equal(w.localStorage.getItem(choiceKey), null);
  assert.equal(w.localStorage.getItem(recommendationKey), null);
  for (const theme of ["dark", "light"]) {
    const button = choice(theme);
    assert.equal(button.tagName, "BUTTON"); assert.equal(button.type, "button"); assert.equal(button.tabIndex, 0);
    button.focus(); assert.equal(w.document.activeElement, button);
    assert.equal(w.getComputedStyle(button).minHeight, "44px");
    assert.equal(button.closest(".cookie-prompt-actions-v3"), null, "theme is outside consent actions");
  }
  assert.equal(w.getComputedStyle(appearance).gridTemplateColumns, "minmax(0, 1fr) auto");
  const [accept, reject] = prompt.querySelector(".cookie-prompt-actions-v3").children;
  assert.equal(accept.className, reject.className, "consent choices retain equal treatment");
  assert.equal(w.document.querySelectorAll("link[data-first-visit-appearance]").length, 1);
});

test("theme selection uses the app controller and changes no consent, account, cookie or network state", async t => {
  const { w, requests, prompt, choice } = await page(t, { setup(w) {
    w.localStorage.setItem("sb-test-auth-token", "fixture-session");
    w.localStorage.setItem("browserp-compare", "existing shortlist");
    w.document.cookie = "brp_csrf=fixture-session";
    for (const theme of ["dark", "light"]) {
      const button = w.document.createElement("button"); button.dataset.themeChoiceV6 = theme; w.document.body.prepend(button);
    }
  } });
  const before = stored(w), cookies = w.document.cookie, events = [];
  requests.length = 0;
  w.addEventListener("browserp:theme-changed", event => events.push(event.detail.theme));
  choice("light").focus(); choice("light").click();
  assert.deepEqual(stored(w), { ...before, [themeKey]: "light" });
  assert.equal(w.document.cookie, cookies);
  assert.equal(w.document.documentElement.dataset.theme, "light");
  assert.equal(w.document.documentElement.style.colorScheme, "light");
  assert.equal(w.document.querySelector('meta[name="theme-color"]').content, "#f8f5f8");
  assert.equal(w.document.querySelector('[data-theme-choice-v6="light"]').getAttribute("aria-pressed"), "true");
  assert.equal(choice("light").getAttribute("aria-pressed"), "true");
  assert.equal(w.document.activeElement, choice("light"));
  assert.equal(prompt.hidden, false);
  assert.equal(w.BrowseRPRecommendations.read().enabled, false);
  assert.deepEqual(events, ["light"]);
  assert.deepEqual(requests, []);
  [...prompt.querySelectorAll("button")].find(button => button.textContent === "Reject recommendations").click();
  assert.equal(prompt.hidden, true);
  assert.equal(w.localStorage.getItem(choiceKey), "rejected");
  assert.equal(w.localStorage.getItem(themeKey), "light", "consent does not override appearance");
});

test("saved appearance and changes from the existing menu or another tab stay in sync", async t => {
  const { w, choice } = await page(t, { setup: w => w.localStorage.setItem(themeKey, "light") });
  assert.equal(choice("light").getAttribute("aria-pressed"), "true");
  w.BrowseRPTheme.set("dark");
  assert.equal(choice("dark").getAttribute("aria-pressed"), "true");
  w.dispatchEvent(new w.StorageEvent("storage", { key: themeKey, newValue: "light" }));
  assert.equal(choice("light").getAttribute("aria-pressed"), "true");
  assert.equal(w.localStorage.getItem(choiceKey), null);
  assert.equal(w.BrowseRPRecommendations.read().enabled, false);
  const next = await page(t, { setup(w) { w.localStorage.setItem(themeKey, "light"); w.localStorage.setItem(choiceKey, "rejected"); } });
  assert.equal(next.prompt, null, "returning visitors get no extra appearance prompt");
  assert.equal(next.w.document.querySelector("link[data-first-visit-appearance]"), null);
  assert.equal(next.w.localStorage.getItem(themeKey), "light");
});

test("appearance remains usable without the page controller or writable storage and never grants consent", async t => {
  for (const blocked of [false, true]) {
    const { w, requests, prompt, choice } = await page(t, { controller: false, setup(w) {
      if (blocked) w.Storage.prototype.setItem = () => { throw Error("Storage blocked"); };
    } });
    const events = [];
    w.addEventListener("browserp:theme-changed", event => events.push(event.detail.theme));
    requests.length = 0;
    choice("light").click();
    assert.equal(w.document.documentElement.dataset.theme, "light");
    assert.equal(w.document.documentElement.style.colorScheme, "light");
    assert.equal(choice("light").getAttribute("aria-pressed"), "true");
    assert.equal(w.localStorage.getItem(themeKey), blocked ? null : "light");
    assert.equal(w.localStorage.getItem(choiceKey), null);
    assert.equal(w.localStorage.getItem(recommendationKey), null);
    assert.equal(w.BrowseRPRecommendations.read().enabled, false);
    assert.equal(prompt.hidden, false);
    assert.deepEqual(events, ["light"]);
    assert.deepEqual(requests, []);
  }
});
