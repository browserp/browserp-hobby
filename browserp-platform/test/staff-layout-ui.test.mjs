import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { JSDOM } from "jsdom";

const read = file => readFileSync(new URL(`../public/${file}`, import.meta.url), "utf8");
const tick = () => new Promise(resolve => setImmediate(resolve));
async function harness(t) {
  const dom = new JSDOM(read("staffpanel-scrapers.html"), { url: "https://browserp.test/staffpanel/scrapers#fivem", runScripts: "outside-only" });
  const w = dom.window; t.after(() => w.close());
  const media = new w.EventTarget(); media.matches = true; w.matchMedia = () => media;
  w.fetch = async () => ({ ok: true, json: async () => ({ authenticated: true, provider: "discord", staffAccess: true, staff: true, mfa: { required: false }, csrfToken: "fixture" }) });
  w.eval(read("staffpanel-v3.js")); await tick();
  const button = w.document.querySelector("#staff-menu-v3"); const sidebar = w.document.querySelector(".staff-sidebar-v3"); const main = w.document.querySelector("main");
  return { w, media, button, sidebar, main };
}

test("staff mobile navigation hides inactive links from keyboard access and Escape returns focus", async t => {
  const h = await harness(t);
  assert.equal(h.sidebar.inert, true); assert.equal(h.sidebar.getAttribute("aria-hidden"), "true"); assert.equal(h.main.inert, false);
  assert.equal(h.button.textContent, "Menu"); const closedIcon = h.button.querySelector("path").getAttribute("d");
  h.button.click();
  assert.equal(h.sidebar.inert, false); assert.equal(h.sidebar.hasAttribute("aria-hidden"), false); assert.equal(h.main.inert, true); assert.equal(h.button.getAttribute("aria-expanded"), "true");
  assert.equal(h.button.textContent, "Close"); assert.notEqual(h.button.querySelector("path").getAttribute("d"), closedIcon);
  assert.equal(h.w.document.activeElement, h.button);
  h.sidebar.querySelector("a").focus(); h.w.document.dispatchEvent(new h.w.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
  assert.equal(h.w.document.activeElement, h.button); assert.equal(h.sidebar.inert, true); assert.equal(h.main.inert, false); assert.equal(h.button.getAttribute("aria-expanded"), "false");
  assert.equal(h.button.textContent, "Menu"); assert.equal(h.button.querySelector("path").getAttribute("d"), closedIcon);
});

test("staff mobile menu contains keyboard focus and restores content after a navigation choice", async t => {
  const h = await harness(t); const links = [...h.sidebar.querySelectorAll("a")];
  for (const link of links) link.getClientRects = () => [{ width: 100, height: 44 }];
  h.button.click();
  h.w.document.dispatchEvent(new h.w.KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true })); assert.equal(h.w.document.activeElement, links[0]);
  links.at(-1).focus();
  h.w.document.dispatchEvent(new h.w.KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true })); assert.equal(h.w.document.activeElement, h.button);
  h.w.document.dispatchEvent(new h.w.KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true, cancelable: true })); assert.equal(h.w.document.activeElement, links.at(-1));
  // Prevent jsdom navigation while exercising the production delegated click listener.
  links[0].addEventListener("click", event => event.preventDefault()); links[0].click();
  assert.equal(h.main.inert, false); assert.equal(h.sidebar.inert, true); assert.equal(h.w.document.body.classList.contains("staff-menu-open"), false);
});

test("resizing staff navigation restores desktop access and skip link preserves the selected workspace", async t => {
  const h = await harness(t); h.button.click(); h.media.matches = false; h.media.dispatchEvent(new h.w.Event("change"));
  assert.equal(h.sidebar.inert, false); assert.equal(h.main.inert, false); assert.equal(h.sidebar.hasAttribute("aria-hidden"), false); assert.equal(h.button.getAttribute("aria-expanded"), "false");
  h.w.document.querySelector(".skip-link").click(); await tick();
  assert.equal(h.w.location.hash, "#fivem"); assert.equal(h.w.document.activeElement, h.main);
});

test("staff Overview shortcuts lead to sections that exist in the page", t => {
  const dom = new JSDOM(read("staffpanel-overview.html"), { url: "https://browserp.test/staffpanel/overview", runScripts: "outside-only" });
  t.after(() => dom.window.close());
  const { window: w } = dom;
  w.eval(read("staff-workspace.js"));
  w.BrowseRPStaffAppearance.mount();
  assert.equal(w.document.querySelector(".staff-workspace-label").textContent, "Staff panel");
  const shortcuts = [...w.document.querySelectorAll(".staff-local-nav a")];
  assert.ok(shortcuts.length > 0);
  for (const link of shortcuts) {
    const destination = new URL(link.href);
    assert.equal(destination.pathname, "/staffpanel/overview");
    assert.ok(w.document.getElementById(destination.hash.slice(1)), link.textContent);
  }
});

test("staff entry pages use one sidebar panel label and plain page headings", () => {
  const expectations = {
    "staffpanel-overview.html": "Overview",
    "staffpanel-moderation.html": "Moderation",
    "staffpanel-scrapers.html": "Import servers"
  };
  for (const [file, heading] of Object.entries(expectations)) {
    const html = read(file);
    assert.doesNotMatch(html, /staff-nav-group-v3">Workspace</, file);
    assert.doesNotMatch(html, /<span class="eyebrow-v3">Staff panel</, file);
    assert.match(html, new RegExp(`<h1[^>]*>${heading}</h1>`), file);
  }
});

test("staff finishing styles precede shared appearance layers on every private entry point and stay off public pages", () => {
  const files = readdirSync(new URL("../public", import.meta.url)).filter(file => file.endsWith(".html"));
  for (const file of files) {
    const html = read(file); const links = [...html.matchAll(/<link\b[^>]*rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/g)].map(match => match[1]);
    const staffWorkspace = /<body\b[^>]*\bdata-staff-page=/.test(html) || file.startsWith("staffpanel");
    if (staffWorkspace) assert.deepEqual(links.slice(-3).map(link => new URL(link, "https://browserp.com").pathname), ["/staff-design.css", "/appearance-themes.css", "/appearance-controls.css"], file);
    else assert.equal(links.some(link => link.startsWith("/staff-layout.css")), false, file);
  }
});
