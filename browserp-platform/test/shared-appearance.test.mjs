import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { JSDOM } from "jsdom";

const read = name => readFileSync(new URL(`../public/${name}`, import.meta.url), "utf8");
const source = read("appearance.js");
const key = "browserp-appearance-v2";
const legacyKey = "browserp-theme";
const stored = w => Object.fromEntries(Object.keys(w.localStorage).map(key => [key, w.localStorage.getItem(key)]));
function page(t, { route = "/", setup = () => {} } = {}) {
  const dom = new JSDOM('<head><meta name="theme-color"></head><body><form><input name="draft" value="Unsaved draft"></form></body>', {
    url: `https://browserp.test${route}`, runScripts: "outside-only"
  });
  t.after(() => dom.window.close());
  const w = dom.window;
  setup(w);
  let requests = 0;
  w.fetch = () => { requests++; throw Error("Appearance must not make a network request"); };
  w.eval(source);
  return { w, requests: () => requests };
}

test("existing device choices migrate to the same appearance without changing stored data on arrival", t => {
  for (const [old, current, expected] of [
    [undefined, undefined, "default"], ["dark", undefined, "default"], ["light", undefined, "light"],
    ["invalid", undefined, "default"], ["light", "default", "default"], ["dark", "dark", "dark"],
    ["dark", "light", "light"], ["light", "invalid", "light"]
  ]) {
    let before;
    const { w } = page(t, { setup(w) {
      if (old !== undefined) w.localStorage.setItem(legacyKey, old);
      if (current !== undefined) w.localStorage.setItem(key, current);
      before = stored(w);
    } });
    assert.equal(w.BrowseRPTheme.get(), expected);
    assert.equal(w.document.documentElement.dataset.theme, expected);
    assert.equal(w.document.documentElement.style.colorScheme, expected === "light" ? "light" : "dark");
    assert.deepEqual(stored(w), before);
    assert.deepEqual(Array.from(w.BrowseRPTheme.choices, choice => choice.label), ["Default", "Dark", "Light"]);
  }
});

for (const route of ["/profile", "/staffpanel", "/staffpanel/moderation"]) {
  test(`all themes on ${route} preserve unsaved inputs, focus, session, preferences and motion choice`, t => {
    const { w, requests } = page(t, { route, setup(w) {
      w.localStorage.setItem(legacyKey, "light");
      w.localStorage.setItem("browserp-compare", "fixture shortlist");
      w.localStorage.setItem("browserp-brand-motion", "off");
      w.localStorage.setItem("browserp-cookie-choice-v1", "rejected");
      w.document.cookie = "fixture-session=unchanged";
    } });
    const input = w.document.querySelector("input");
    input.value = "Still editing";
    input.focus();
    const before = stored(w), cookies = w.document.cookie, themes = [];
    w.addEventListener("browserp:theme-changed", event => themes.push(event.detail.theme));
    for (const theme of ["dark", "light", "default", "dark"]) {
      assert.equal(w.BrowseRPTheme.set(theme), theme);
      assert.equal(w.document.documentElement.dataset.theme, theme);
      assert.equal(w.document.documentElement.style.colorScheme, theme === "light" ? "light" : "dark");
      assert.equal(w.document.querySelector("input"), input);
      assert.equal(input.value, "Still editing");
      assert.equal(w.document.activeElement, input);
      assert.equal(w.document.cookie, cookies);
      assert.deepEqual(stored(w), { ...before, [key]: theme });
      assert.equal(w.document.documentElement.dataset.brandMotion, "off");
    }
    assert.deepEqual(themes, ["dark", "light", "default", "dark"]);
    assert.equal(requests(), 0);
    assert.equal(w.document.querySelector("link[data-public-theme]"), null);
  });
}

test("the selected versioned theme survives reload and synchronises between tabs without resetting legacy choice", t => {
  const { w } = page(t, { setup: w => w.localStorage.setItem(legacyKey, "light") });
  w.BrowseRPTheme.set("dark");
  const next = page(t, { setup(next) { for (const [key, value] of Object.entries(stored(w))) next.localStorage.setItem(key, value); } }).w;
  assert.equal(next.BrowseRPTheme.get(), "dark");
  next.localStorage.setItem(key, "default");
  next.dispatchEvent(new next.StorageEvent("storage", { key, newValue: "default" }));
  assert.equal(next.BrowseRPTheme.get(), "default");
  next.dispatchEvent(new next.StorageEvent("storage", { key: legacyKey, newValue: "dark" }));
  assert.equal(next.BrowseRPTheme.get(), "default", "an older open tab cannot override a new explicit choice");
  next.localStorage.removeItem(key);
  next.dispatchEvent(new next.StorageEvent("storage", { key, newValue: null }));
  assert.equal(next.BrowseRPTheme.get(), "light");
  next.localStorage.clear();
  next.dispatchEvent(new next.StorageEvent("storage", { key: null }));
  assert.equal(next.BrowseRPTheme.get(), "default");
});

test("storage failures leave all appearance choices usable for the current page", t => {
  const { w } = page(t, { setup(w) {
    w.Storage.prototype.getItem = () => { throw Error("Unavailable"); };
    w.Storage.prototype.setItem = () => { throw Error("Unavailable"); };
  } });
  for (const theme of ["dark", "light", "default"]) {
    assert.equal(w.BrowseRPTheme.set(theme), theme);
    assert.equal(w.document.documentElement.dataset.theme, theme);
  }
});

test("the motion clock loads once for every appearance, including a Default-only visit", t => {
  for (const first of ["default", "dark", "light"]) {
    const { w } = page(t);
    const form = w.document.querySelector("form");
    w.document.dispatchEvent(new w.Event("DOMContentLoaded"));
    assert.equal(w.document.querySelectorAll("script[data-theme-motion]").length, 1);
    w.BrowseRPTheme.set(first);
    assert.equal(w.document.querySelectorAll("script[data-theme-motion]").length, 1, first);
    for (const theme of ["default", "dark", "light", "default"]) w.BrowseRPTheme.set(theme);
    assert.equal(w.document.querySelectorAll("script[data-theme-motion]").length, 1);
    assert.match(w.document.querySelector("script[data-theme-motion]").src, /primary-motion\.js/);
    assert.equal(w.document.querySelector("form"), form);
  }
  const { w } = page(t, { setup: w => w.localStorage.setItem(key, "light") });
  w.document.dispatchEvent(new w.Event("DOMContentLoaded"));
  assert.equal(w.document.querySelectorAll("script[data-theme-motion]").length, 1, "a saved Light preference loads its motion on arrival");
});

test("all selector indicators track the selected theme without replacing buttons or stealing focus", t => {
  const { w } = page(t, { setup: w => w.localStorage.setItem(key, "light") });
  const selectors = [
    ["navigation-theme-choices-v6", "themeChoiceV6"],
    ["first-visit-appearance-choices", "appearanceChoice"],
    ["staff-theme-options", "staffTheme"]
  ];
  const groups = selectors.map(([className, attribute]) => {
    const group = w.document.createElement("div");
    group.className = className;
    for (const theme of ["default", "dark", "light"]) {
      const button = w.document.createElement("button");
      button.type = "button";
      button.textContent = theme;
      button.dataset[attribute] = theme;
      button.addEventListener("click", () => w.BrowseRPTheme.set(theme));
      group.append(button);
    }
    w.BrowseRPTheme.syncControls(group);
    assert.equal(group.dataset.activeTheme, "light", "detached selectors start at the saved choice");
    assert.equal(group.style.getPropertyValue("--appearance-index"), "2");
    assert.equal(group.lastElementChild.getAttribute("aria-pressed"), "true");
    w.document.body.append(group);
    return group;
  });
  const buttons = groups.map(group => [...group.children]);
  for (const [index, theme] of ["default", "dark", "light"].entries()) {
    const focused = buttons[index][index];
    focused.focus(); focused.click();
    for (const [groupIndex, group] of groups.entries()) {
      assert.equal(group.dataset.activeTheme, theme);
      assert.equal(group.style.getPropertyValue("--appearance-index"), String(index));
      assert.deepEqual([...group.children], buttons[groupIndex]);
      assert.deepEqual([...group.children].map(button => button.getAttribute("aria-pressed")), [0, 1, 2].map(value => String(value === index)));
    }
    assert.equal(w.document.activeElement, focused);
  }
  w.dispatchEvent(new w.StorageEvent("storage", { key, newValue: "dark" }));
  for (const group of groups) {
    assert.equal(group.style.getPropertyValue("--appearance-index"), "1", "other-tab selection moves every thumb");
    assert.equal(group.dataset.activeTheme, "dark");
  }
});

test("every public and staff page loads the early shared controller and the final theme layer", () => {
  for (const file of readdirSync(new URL("../public/", import.meta.url)).filter(file => file.endsWith(".html"))) {
    const html = read(file);
    if (!/\/(?:navigation|staff-workspace|browserp-v3)\.js/.test(html)) continue;
    const dom = new JSDOM(html);
    const doc = dom.window.document;
    const scripts = [...doc.querySelectorAll("script[src]")];
    assert.ok(scripts[0].getAttribute("src").startsWith("/appearance.js?"), file);
    assert.equal(scripts[0].hasAttribute("defer"), false, file);
    const styles = [...doc.querySelectorAll('link[rel="stylesheet"]')];
    assert.ok(styles.at(-2).getAttribute("href").startsWith("/appearance-themes.css?"), file);
    assert.ok(styles.at(-1).getAttribute("href").startsWith("/appearance-controls.css?"), file);
    dom.window.close();
  }
});

test("switching themes keeps the homepage collage and every current game destination in the same place", t => {
  const dom = new JSDOM(read("index.html"), { url: "https://browserp.test/", runScripts: "outside-only" });
  t.after(() => dom.window.close());
  const w = dom.window;
  w.eval(source);
  const main = w.document.querySelector("main"), markup = main.innerHTML;
  const collage = main.querySelector(".home-hero-visual");
  const parent = collage.parentElement, previous = collage.previousElementSibling;
  const links = [...collage.querySelectorAll("a")];
  assert.deepEqual(links.map(link => link.getAttribute("href")), ["/games/fivem", "/games/redm", "/games/roblox", "/games/minecraft"]);
  for (const theme of ["dark", "light", "default"]) {
    w.BrowseRPTheme.set(theme);
    assert.equal(main.innerHTML, markup);
    assert.equal(main.querySelector(".home-hero-visual"), collage);
    assert.equal(collage.parentElement, parent);
    assert.equal(collage.previousElementSibling, previous);
    assert.deepEqual([...collage.querySelectorAll("a")], links);
  }
});

for (const theme of ["default", "dark", "light"]) test(`${theme} hover eases the existing clock and respects motion-off across appearance changes`, t => {
  const { w } = page(t);
  const control = w.document.createElement("button");
  control.className = "button-primary-v3";
  w.document.body.append(control);
  w.BrowseRPTheme.set(theme);
  Object.defineProperty(w.document, "hidden", { value: false, configurable: true });
  const media = new w.EventTarget(); media.matches = true;
  w.matchMedia = () => media;
  let now = 0, serial = 0, hovered = false;
  const frames = new Map();
  w.performance.now = () => now;
  w.requestAnimationFrame = callback => { const id = ++serial; frames.set(id, callback); return id; };
  w.cancelAnimationFrame = id => frames.delete(id);
  const matches = control.matches.bind(control);
  control.matches = selector => selector === ":hover,:focus-visible" ? hovered : matches(selector);
  const animation = { animationName: "primary-colour-drift", playbackRate: 1, playState: "running", updatePlaybackRate(value) { this.playbackRate = value; } };
  Object.defineProperty(animation, "currentTime", { get: () => 4200, set() { throw Error("Hover must not reset the colour position"); } });
  w.Element.prototype.getAnimations = function () { return this === control ? [animation] : []; };
  function frame(advance = 0) {
    now += advance;
    const pending = [...frames.values()]; frames.clear();
    pending.forEach(callback => callback(now));
  }
  w.eval(read("primary-motion.js"));
  hovered = true;
  control.dispatchEvent(new w.MouseEvent("pointerover", { bubbles: true }));
  frame(); frame(240);
  assert.ok(animation.playbackRate > 1 && animation.playbackRate < 2.4, "speed changes gradually");
  frame(240);
  assert.equal(animation.playbackRate, 2.4);
  assert.equal(animation.currentTime, 4200);
  w.BrowseRPTheme.set("default"); frame(); frame(650);
  assert.equal(animation.playbackRate, 2.4, "Default shares the current colour clock without resetting the hovered rate");
  w.BrowseRPTheme.set(theme); frame(); frame(480);
  assert.equal(animation.playbackRate, 2.4, "returning to the selected theme restores the hovered rate smoothly");
  hovered = false;
  control.dispatchEvent(new w.MouseEvent("pointerout", { bubbles: true }));
  frame(); frame(650);
  assert.equal(animation.playbackRate, 1);
  hovered = true;
  w.document.documentElement.dataset.brandMotion = "off";
  w.dispatchEvent(new w.CustomEvent("browserp:brand-motion-changed")); frame(); frame(650);
  assert.equal(animation.playbackRate, 1);
  for (const next of ["default", "light", "dark", theme]) { w.BrowseRPTheme.set(next); frame(); }
  frame(650);
  assert.equal(animation.playbackRate, 1, "switching themes does not turn disabled motion back on");
  w.document.documentElement.dataset.brandMotion = "on";
  media.matches = false;
  media.dispatchEvent(new w.Event("change")); frame();
  assert.equal(animation.playbackRate, 1, "reduced motion never accelerates the animation");
  media.matches = true;
  media.dispatchEvent(new w.Event("change")); frame(240);
  assert.ok(animation.playbackRate > 1 && animation.playbackRate < 2.4);
  w.document.documentElement.dataset.brandMotion = "off";
  w.dispatchEvent(new w.CustomEvent("browserp:brand-motion-changed")); frame();
  assert.equal(animation.playbackRate, 1, "motion-off cancels an in-progress acceleration");
  frame(1000);
  assert.equal(animation.playbackRate, 1, "a cancelled ramp cannot resume itself");
  w.document.documentElement.dataset.brandMotion = "on";
  w.dispatchEvent(new w.CustomEvent("browserp:brand-motion-changed")); frame(); frame(480);
  assert.equal(animation.playbackRate, 2.4, "motion-on resumes the hovered rate without recreating the animation");
  w.dispatchEvent(new w.Event("pagehide")); frame(1000);
  assert.equal(animation.playbackRate, 1);
  assert.equal(w.document.documentElement.dataset.primaryMotion, "paused");
  w.dispatchEvent(new w.Event("pageshow")); frame(480);
  assert.equal(animation.playbackRate, 2.4);
  assert.equal(animation.currentTime, 4200, "preference and visibility changes preserve the colour phase");
});


test("legacy light stylesheet fallback always precedes the selectable theme layer", t => {
  const app = read("browserp-v3.js");
  const end = app.indexOf("  function initials(value) {");
  assert.ok(end > 0);
  for (const file of readdirSync(new URL("../public/", import.meta.url)).filter(file => file.endsWith(".html"))) {
    const html = read(file);
    if (!html.includes("/browserp-v3.js") || file.startsWith("staffpanel")) continue;
    const dom = new JSDOM(html, { url: `https://browserp.test/${file}`, runScripts: "outside-only" });
    t.after(() => dom.window.close());
    dom.window.eval(source);
    dom.window.BrowseRPTheme.set("light");
    dom.window.eval(app.slice(0, end) + "})();");
    const styles = [...dom.window.document.querySelectorAll('link[rel="stylesheet"]')];
    const index = name => styles.findIndex(link => link.getAttribute("href").startsWith(`/${name}`));
    assert.ok(index("theme.css") >= 0, `${file}: fallback is available`);
    assert.ok(index("theme.css") < index("appearance-themes.css"), `${file}: original palette cannot override selected Light`);
  }
});
