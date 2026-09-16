import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const csstree = require("css-tree");
const read = file => readFileSync(new URL(`../public/${file}`, import.meta.url), "utf8");
const tick = () => new Promise(resolve => setImmediate(resolve));

function appearance(t, page = "overview", theme) {
  const dom = new JSDOM(read(`staffpanel-${page}.html`), { url: `https://browserp.test/staffpanel/${page}`, runScripts: "outside-only" });
  t.after(() => dom.window.close());
  const w = dom.window;
  if (theme !== undefined) w.localStorage.setItem("browserp-appearance-v2", theme);
  const requests = [];
  w.fetch = async path => { requests.push(path); throw new Error("Appearance must not fetch"); };
  w.eval(read("appearance.js"));
  w.eval(read("staff-workspace.js"));
  w.BrowseRPStaffAppearance.mount();
  return { w, requests };
}

test("staff appearance preserves the current default and explicit device choice without fetching or resetting storage", t => {
  for (const saved of [undefined, "default", "light", "dark", "invalid"]) {
    const { w, requests } = appearance(t, "overview", saved);
    assert.equal(w.document.documentElement.dataset.theme, ["dark", "light"].includes(saved) ? saved : "default");
    assert.equal(w.localStorage.getItem("browserp-appearance-v2"), saved ?? null);
    const theme = w.document.documentElement.dataset.theme;
    const choices = w.document.querySelector(".staff-theme-options");
    assert.equal(choices.dataset.activeTheme, theme);
    assert.equal(choices.style.getPropertyValue("--appearance-index"), String(["default", "dark", "light"].indexOf(theme)));
    assert.deepEqual(requests, []);
    assert.equal(w.document.querySelector(".public-header-v6"), null);
    assert.equal(w.document.querySelector("#staff-app-v3").hidden, true);
    assert.equal(w.document.querySelector("#staff-app-v3").hasAttribute("inert"), true);
  }
});

test("staff workspace pages change appearance without remounting pending forms, selections or feedback", t => {
  for (const page of ["overview", "moderation"]) {
    const { w, requests } = appearance(t, page, "dark");
    const main = w.document.querySelector("main");
    const form = w.document.createElement("form"); form.setAttribute("aria-busy", "true");
    form.innerHTML = '<textarea name="reason">Keep this unsaved review</textarea><input type="checkbox" checked><button disabled>Saving…</button><p role="status">Waiting for a confirmed decision</p>';
    main.append(form);
    w.document.querySelector('[data-staff-theme="light"]').click();
    assert.equal(w.document.documentElement.dataset.theme, "light");
    assert.equal(w.localStorage.getItem("browserp-appearance-v2"), "light");
    assert.equal(w.document.querySelector(".staff-theme-options").style.getPropertyValue("--appearance-index"), "2");
    assert.equal(form, main.lastElementChild);
    assert.equal(form.querySelector("textarea").value, "Keep this unsaved review");
    assert.equal(form.querySelector("input").checked, true);
    assert.equal(form.querySelector("button").disabled, true);
    assert.equal(form.getAttribute("aria-busy"), "true");
    assert.match(form.textContent, /Waiting for a confirmed decision/);
    w.dispatchEvent(new w.StorageEvent("storage", { key: "browserp-appearance-v2", newValue: "dark" }));
    assert.equal(w.document.documentElement.dataset.theme, "dark");
    assert.equal(form, main.lastElementChild);
    assert.equal(w.document.querySelector('[data-staff-theme="dark"]').getAttribute("aria-pressed"), "true");
    assert.deepEqual(requests, []);
  }
});

test("overview and moderation use the same Menu controller including theme controls in focus containment", async t => {
  for (const page of ["overview", "moderation"]) {
    const { w } = appearance(t, page, "light");
    const media = new w.EventTarget(); media.matches = true; w.matchMedia = () => media;
    w.fetch = async () => ({ ok: true, json: async () => ({ authenticated: true, provider: "discord", staffAccess: true, staff: true, mfa: { required: false }, csrfToken: "fixture" }) });
    w.eval(read("staffpanel-v3.js")); await tick();
    const menu = w.document.querySelector("#staff-menu-v3");
    assert.equal(menu.classList.contains("ds-menu-button"), true);
    const sidebar = w.document.querySelector(".staff-sidebar-v3");
    for (const item of sidebar.querySelectorAll("a,button")) item.getClientRects = () => [{ width: 100, height: 44 }];
    menu.click();
    assert.equal(menu.getAttribute("aria-expanded"), "true");
    assert.equal(w.document.querySelector("main").inert, true);
    const last = [...sidebar.querySelectorAll("button")].at(-1);
    last.focus(); w.document.dispatchEvent(new w.KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true }));
    assert.equal(w.document.activeElement, menu);
    w.document.dispatchEvent(new w.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    assert.equal(menu.getAttribute("aria-expanded"), "false");
    assert.equal(sidebar.inert, true);
    assert.equal(w.document.querySelector("main").inert, false);
    assert.equal(w.document.documentElement.dataset.theme, "light");
    assert.equal(sidebar.querySelectorAll(".staff-appearance").length, 1);
  }
});

test("staff CSS parses complete selectors and preserves native hidden control display", t => {
  for (const file of ["staff-design.css", "staff-layout.css"]) {
    const errors = [];
    const ast = csstree.parse(read(file), { onParseError: error => errors.push(error.message) });
    assert.deepEqual(errors, [], file);
    const dom = new JSDOM(`<style>${read(file)}</style><body class="staff-v3"><input type="hidden" value="bound-record-id"><button hidden>Pending action</button>`);
    t.after(() => dom.window.close());
    assert.equal(dom.window.getComputedStyle(dom.window.document.querySelector("input")).display, "none");
    assert.equal(dom.window.getComputedStyle(dom.window.document.querySelector("button")).display, "none");
    csstree.walk(ast, { visit: "Rule", enter(rule) {
      if (rule.prelude?.type !== "SelectorList") return;
      const text = csstree.generate(rule.prelude);
      assert.doesNotThrow(() => csstree.parse(text, { context: "selectorList" }), `${file}: ${text}`);
    } });
  }
});

test("staff text-fit rules keep long operational copy readable and full tables scrollable", t => {
  const css = read("staff-design.css");
  const ast = csstree.parse(css);
  const media = [];
  csstree.walk(ast, { visit: "Atrule", enter(rule) {
    if (rule.name === "media") media.push(csstree.generate(rule.prelude));
  } });
  assert.ok(media.some(query => query.includes("max-width:920px") && query.includes("min-width:761px")), "tablet composition rule");
  for (const width of [760, 460, 360]) {
    assert.ok(media.some(query => query.includes(`max-width:${width}px`)), `${width}px fit rule`);
  }
  const dom = new JSDOM(`<style>${css}</style><body class="staff-v3"><nav class="staff-nav-v3"><a href="/staffpanel/overview">A very long workspace label</a></nav><div class="staff-work-copy"><strong>A long review title withoutspaces0123456789</strong></div><div class="staff-table-wrap-v3"><table class="staff-table-v3"><tbody><tr><td>A long member ID withoutspaces0123456789</td></tr></tbody></table></div>`);
  t.after(() => dom.window.close());
  const { document } = dom.window;
  const style = selector => dom.window.getComputedStyle(document.querySelector(selector));
  assert.equal(style(".staff-nav-v3 a").whiteSpace, "normal");
  assert.equal(style(".staff-work-copy strong").overflowWrap, "anywhere");
  assert.equal(style(".staff-table-wrap-v3").overflowX, "auto");
  assert.equal(style(".staff-table-v3 td").overflowWrap, "anywhere");
});
