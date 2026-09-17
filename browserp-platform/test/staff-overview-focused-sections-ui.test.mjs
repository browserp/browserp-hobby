import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";

const read = name => readFileSync(new URL(`../public/${name}`, import.meta.url), "utf8");
const tick = () => new Promise(resolve => setImmediate(resolve));
const controllerSource = read("staffpanel-v3.js")
  .replace("  async function init(){", "  window.__focusOverviewTool = focusOverviewTool; window.__updateModerationHeading = updateModerationHeading;\n  async function init(){")
  .replace("  init();\n})();", "})();");

test("overview tool links open one focused panel and Back restores the attention view", async t => {
  const dom = new JSDOM(read("staffpanel-overview.html"), { url: "https://browserp.test/staffpanel/overview", runScripts: "outside-only" });
  const w = dom.window; t.after(() => w.close());
  w.eval(read("staff-workspace.js")); w.BrowseRPStaffAppearance.mount();
  w.eval(controllerSource); w.__focusOverviewTool();
  const main = w.document.querySelector("#website-overview");
  const hidden = id => w.document.getElementById(id).dataset.overviewRouteHidden;
  assert.equal(main.dataset.overviewFocus, "home");
  assert.equal(hidden("overview-duty"), "false");
  assert.equal(hidden("overview-refresh-health"), "true");
  assert.equal(w.document.querySelector(".overview-work-grid").dataset.overviewRouteHidden, "false");
  assert.equal(w.document.querySelector("#overview-focus-back").hidden, true);

  w.document.querySelector('[data-overview-tool="overview-refresh-health"]').click(); await tick();
  assert.equal(w.location.hash, "#overview-refresh-health");
  assert.equal(main.dataset.overviewFocus, "health");
  assert.equal(main.querySelector("h1").textContent, "Listing checks");
  assert.equal(hidden("overview-refresh-health"), "false");
  assert.equal(hidden("overview-duty"), "true");
  assert.equal(w.document.querySelector(".overview-work-grid").dataset.overviewRouteHidden, "true");
  assert.equal(w.document.querySelector("#overview-focus-back").hidden, false);

  w.document.querySelector("#overview-focus-back").click(); await tick();
  assert.equal(main.dataset.overviewFocus, "home");
  assert.equal(hidden("overview-duty"), "false");
  assert.equal(hidden("overview-refresh-health"), "true");

  w.location.hash = "#advertising-enquiries"; w.dispatchEvent(new w.HashChangeEvent("hashchange"));
  assert.equal(main.dataset.overviewFocus, "adverts");
  assert.equal(main.querySelector("h1").textContent, "Adverts & enquiries");
  assert.equal(main.querySelector("h1 + p").textContent, "Manage website placements and advertising enquiries.");
  assert.equal(hidden("overview-adverts"), "false");
  assert.equal(hidden("overview-duty"), "true");

  w.document.querySelector("#overview-focus-back").click(); await tick();
  assert.equal(main.dataset.overviewFocus, "home");
  assert.equal(main.querySelector("h1").textContent, "Overview");
  assert.equal(main.querySelector("h1 + p").textContent, "Current attention, staff availability and recent activity.");
});

test("the moderation heading follows its active hash section and roles do not repeat it", () => {
  const dom = new JSDOM(read("staffpanel-moderation.html"), { url: "https://browserp.test/staffpanel/moderation", runScripts: "outside-only" });
  const w = dom.window; try {
    w.BrowseRPModerationFilters = { parse: hash => ({ view: hash.slice(1).split("?")[0] || "summary" }) };
    w.eval(controllerSource); w.__updateModerationHeading();
    const heading = w.document.querySelector(".staff-top-v3 h1");
    assert.equal(heading.textContent, "Moderation");
    w.location.hash = "#staff"; w.dispatchEvent(new w.HashChangeEvent("hashchange"));
    assert.equal(heading.textContent, "Staff & roles");
    w.location.hash = "#logs"; w.dispatchEvent(new w.HashChangeEvent("hashchange"));
    assert.equal(heading.textContent, "Staff action history");
    assert.doesNotMatch(read("staff-roles.js"), /root\.append\(node\("h2", "Staff & roles"\)/);
  } finally { w.close(); }
});
