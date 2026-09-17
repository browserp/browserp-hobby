import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";

const source = readFileSync(new URL("../public/staff-workspace.js", import.meta.url), "utf8");
const controller = readFileSync(new URL("../public/staffpanel-v3.js", import.meta.url), "utf8")
  .replace("  async function init(){", "  window.__checkBoostNavigation = checkBoostNavigation; window.__staffState = state;\n  async function init(){")
  .replace("  init();\n})();", "})();");

test("staff tool search finds existing destinations without exposing hidden or external links", t => {
  const dom = new JSDOM(`<body class="staff-v3"><aside class="staff-sidebar-v3">
    <a class="logo-v3" href="/">BrowseRP</a>
    <nav class="staff-nav-v3"><a href="/staffpanel/overview">Overview</a><a href="/staffpanel/moderation">Moderation</a><a href="/">View website</a></nav>
    <nav id="moderation-tabs"><a href="/staffpanel/moderation#reports">Reports</a><a href="https://evil.example/staffpanel/moderation#reports">Offsite reports</a></nav>
  </aside></body>`, { url: "https://browserp.test/staffpanel/moderation", runScripts: "outside-only" });
  t.after(() => dom.window.close());
  const w = dom.window;
  w.BrowseRPTheme = { get: () => "dark", apply: () => "dark", choices: [], syncControls() {} };
  w.eval(source);
  w.BrowseRPStaffAppearance.mount();
  const input = w.document.querySelector("#staff-tool-search-input");
  const results = w.document.querySelector("#staff-tool-search-results");
  const status = w.document.querySelector(".staff-tool-search-status");
  assert.equal(w.document.querySelector('label[for="staff-tool-search-input"]').textContent, "Find a staff tool");
  assert.equal(input.getAttribute("tabindex"), "0");
  const search = query => { input.value = query; input.dispatchEvent(new w.Event("input", { bubbles: true })); };
  search("reports");
  assert.deepEqual([...results.querySelectorAll("a")].map(link => link.getAttribute("href")), ["/staffpanel/moderation#reports"]);
  assert.equal(status.textContent, "1 matching tool");
  search("blog");
  assert.deepEqual([...results.querySelectorAll("a")].map(link => link.getAttribute("href")), ["/staffpanel/overview#overview-publishing"]);
  search("boost");
  assert.equal(results.querySelector("a"), null, "the initially hidden Boost tool stays out of search");
  assert.equal(status.textContent, "No matching staff tools");
  search("website");
  assert.equal(results.querySelector("a"), null, "the public website is outside staff tool search");
  search("reports");
  input.dispatchEvent(new w.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
  assert.equal(input.value, ""); assert.equal(results.hidden, true);
  assert.equal(w.document.querySelectorAll(".staff-nav-v3 a").length, 3, "existing navigation remains intact");
});

test("Moderation shows Boost in tool search only after its authoritative capability read", async t => {
  const page = readFileSync(new URL("../public/staffpanel-moderation.html", import.meta.url), "utf8");
  const dom = new JSDOM(page, { url: "https://browserp.test/staffpanel/moderation", runScripts: "outside-only" });
  t.after(() => dom.window.close());
  const w = dom.window;
  w.BrowseRPTheme = { get: () => "dark", apply: () => "dark", choices: [], syncControls() {} };
  w.eval(source); w.BrowseRPStaffAppearance.mount(); w.eval(controller);
  const root = w.document.querySelector("#staff-app-v3");
  root.hidden = false; root.inert = false; root.removeAttribute("inert");
  w.__staffState.authorized = true;
  w.__staffState.session = { user: { id: "staff-fixture" } };
  const link = w.document.querySelector('[data-overview-tool="overview-featured-boost"]');
  const input = w.document.querySelector("#staff-tool-search-input");
  const findBoost = () => { input.value = "boost"; input.dispatchEvent(new w.Event("input")); return w.document.querySelector(".staff-tool-search-results a"); };
  assert.equal(link.hidden, true);
  assert.equal(findBoost(), null);
  const requested = [];
  let canManage = true;
  w.fetch = async path => { requested.push(path); return { ok: true, status: 200, json: async () => ({ feature: { canManage } }) }; };
  await w.__checkBoostNavigation();
  assert.deepEqual(requested, ["/api/admin/featured-boost"]);
  assert.equal(link.hidden, false);
  assert.equal(findBoost()?.getAttribute("href"), "/staffpanel/overview#overview-featured-boost");
  assert.equal(w.document.querySelector("#overview-featured-boost"), null, "Moderation never mounts the protected Boost controls");
  canManage = false;
  await w.__checkBoostNavigation();
  assert.equal(link.hidden, true);
  assert.equal(findBoost(), null);
});
