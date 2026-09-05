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
  w.fetch = async () => ({ ok: true, json: async () => ({ authenticated: true, provider: "discord", staffAccess: true, mfa: { required: false }, csrfToken: "fixture" }) });
  w.eval(read("staffpanel-v3.js")); await tick();
  const button = w.document.querySelector("#staff-menu-v3"); const sidebar = w.document.querySelector(".staff-sidebar-v3"); const main = w.document.querySelector("main");
  return { w, media, button, sidebar, main };
}

test("staff mobile navigation hides inactive links from keyboard access and Escape returns focus", async t => {
  const h = await harness(t);
  assert.equal(h.sidebar.inert, true); assert.equal(h.sidebar.getAttribute("aria-hidden"), "true"); assert.equal(h.main.inert, false);
  h.button.click();
  assert.equal(h.sidebar.inert, false); assert.equal(h.sidebar.hasAttribute("aria-hidden"), false); assert.equal(h.main.inert, true); assert.equal(h.button.getAttribute("aria-expanded"), "true");
  h.sidebar.querySelector("a").focus(); h.w.document.dispatchEvent(new h.w.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
  assert.equal(h.w.document.activeElement, h.button); assert.equal(h.sidebar.inert, true); assert.equal(h.main.inert, false); assert.equal(h.button.getAttribute("aria-expanded"), "false");
});

test("staff mobile menu contains keyboard focus and restores content after a navigation choice", async t => {
  const h = await harness(t); const links = [...h.sidebar.querySelectorAll("a")];
  for (const link of links) link.getClientRects = () => [{ width: 100, height: 44 }];
  h.button.click(); links.at(-1).focus();
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

test("staff finishing styles load last on every staff entry point and stay off public pages", () => {
  const files = readdirSync(new URL("../public", import.meta.url)).filter(file => file.endsWith(".html"));
  for (const file of files) {
    const html = read(file); const links = [...html.matchAll(/<link\b[^>]*rel="stylesheet"[^>]*href="([^"]+)"[^>]*>/g)].map(match => match[1]);
    if (file.startsWith("staff")) assert.equal(links.at(-1), "/staff-layout.css?v=2.12.0", file);
    else assert.equal(links.some(link => link.startsWith("/staff-layout.css")), false, file);
  }
});
