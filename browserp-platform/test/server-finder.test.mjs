import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";

const read = file => readFileSync(new URL(`../public/${file}`, import.meta.url), "utf8");
const settle = async () => { for (let turn = 0; turn < 4; turn++) await new Promise(resolve => setImmediate(resolve)); };
const facets = (region = "United Kingdom", feature = "economy") => ({ region: [{ value: region, count: 4 }], feature: [{ value: feature, count: 3 }] });

function harness(t, { platform = "", model = true } = {}) {
  const dom = new JSDOM(read("find-server.html"), { url: `https://browserp.test/find-server${platform ? `?platform=${platform}` : ""}`, runScripts: "outside-only" });
  const w = dom.window, requests = [], timers = new Map(); let timerId = 0;
  w.setTimeout = callback => { timers.set(++timerId, callback); return timerId; }; w.clearTimeout = id => timers.delete(id);
  w.fetch = (url, options) => new Promise(resolve => { requests.push({ url, options, resolve }); });
  for (const storage of [w.localStorage, w.sessionStorage]) storage.setItem = () => { throw new Error("Finder must not persist preferences"); };
  if (model) w.eval(read("discovery-model.js"));
  w.eval(read("server-finder.js"));
  t.after(() => w.close());
  const $ = selector => w.document.querySelector(selector);
  const select = (name, value) => {
    const input = [...w.document.querySelectorAll(`input[name="${name}"]`)].find(item => item.value === value);
    assert.ok(input, `Available ${name}=${value}`); input.checked = true; input.dispatchEvent(new w.Event("change", { bubbles: true })); return input;
  };
  const resolve = async (index, value = facets(), ok = true) => { requests[index].resolve({ ok, json: async () => ({ facets: value }) }); await settle(); };
  return { w, $, requests, timers, select, resolve, values: name => [...w.document.querySelectorAll(`input[name="${name}"]`)].map(input => input.value) };
}

test("finder asks four native-radio questions and only requests the existing discovery endpoint", async t => {
  const h = harness(t); await h.resolve(0);
  assert.equal(h.$("[data-finder-steps]").hidden, false);
  assert.deepEqual([...h.w.document.querySelectorAll("[data-finder-question]")].map(panel => [panel.dataset.finderQuestion, panel.hidden]), [["platform", false], ["region", true], ["access", true], ["feature", true]]);
  assert.deepEqual(h.values("platform").filter(value => value !== "all").sort(), Object.keys(h.w.BrowseRPDiscovery.games).sort());
  assert.equal(h.requests.length, 1);
  const url = new URL(h.requests[0].url, h.w.location);
  assert.equal(url.pathname, "/api/servers"); assert.equal(url.searchParams.get("discover"), "true"); assert.equal(url.searchParams.get("limit"), "1");
  assert.equal(h.$("form").action, "https://browserp.test/servers"); assert.equal(h.$("form").method, "get");
  assert.ok(!h.$("[data-finder-summary]").textContent.includes("%"));
});

test("selections become supported directory filters and keyboard-style submit advances without auto-navigation", async t => {
  const h = harness(t); await h.resolve(0);
  h.select("platform", "fivem"); await h.resolve(1);
  h.$("[data-finder-next]").click();
  assert.equal(h.w.document.activeElement.tagName, "LEGEND");
  h.select("region", "United Kingdom"); await h.resolve(2);
  const early = new h.w.Event("submit", { bubbles: true, cancelable: true }); h.$("form").dispatchEvent(early);
  assert.equal(early.defaultPrevented, true); assert.equal(h.$('[data-finder-question="access"]').hidden, false);
  h.select("access", "whitelisted"); await h.resolve(3);
  h.$("[data-finder-next]").click(); h.select("feature", "economy");
  const final = new h.w.Event("submit", { bubbles: true, cancelable: true }); h.$("form").dispatchEvent(final);
  assert.equal(final.defaultPrevented, false, "Final navigation uses normal native GET submission");
  assert.deepEqual(Object.fromEntries(new h.w.FormData(h.$("form"))), { platform: "fivem", region: "United Kingdom", access: "whitelisted", feature: "economy" });
  assert.equal(h.requests.length, 4, "Selecting a final feature does not make another discovery request");
  const query = new URL(h.requests[3].url, h.w.location).searchParams;
  assert.equal(query.get("platform"), "fivem"); assert.equal(query.get("region"), "United Kingdom"); assert.equal(query.get("access"), "whitelisted"); assert.equal(query.has("feature"), false);
  h.$("[data-finder-back]").click(); assert.equal(h.$('input[name="access"][value="whitelisted"]').checked, true);
});

test("only positive live facet choices appear, feature aliases normalize and untrusted labels stay plain text", async t => {
  const h = harness(t, { platform: "fivem" });
  await h.resolve(0, { region: [{ value: "United Kingdom", count: 2 }, { value: "Never listed", count: 0 }, { value: "Infinite", count: Infinity }], feature: [{ value: "custom vehicles", count: 2 }, { value: "custom cars", count: 1 }, { value: "<img src=x onerror=alert(1)>", count: 1 }, { value: "housing", count: 0 }, { value: "x".repeat(81), count: 3 }] });
  assert.deepEqual(h.values("region"), ["all", "United Kingdom"]);
  assert.deepEqual(h.values("feature"), ["all", "custom cars", "<img src=x onerror=alert(1)>"]);
  assert.equal(h.$('[data-finder-options="feature"] img'), null);
  assert.equal(h.$('input[name="platform"][value="fivem"]').checked, true);
  assert.ok(!h.$('[data-finder-options="feature"]').textContent.includes("Serious RP"), "Taxonomy defaults cannot pretend an unlisted feature is available");
});

test("changing game clears dependent choices and late responses cannot replace the new game's options", async t => {
  const h = harness(t); await h.resolve(0);
  h.select("region", "United Kingdom"); await h.resolve(1);
  h.select("feature", "economy");
  h.select("platform", "fivem"); h.select("platform", "redm");
  assert.equal(h.requests[2].options.signal.aborted, true);
  await h.resolve(3, facets("United States", "ranching")); await h.resolve(2, facets("Old region", "custom cars"));
  assert.deepEqual(h.values("region"), ["all", "United States"]); assert.deepEqual(h.values("feature"), ["all", "ranching"]);
  assert.deepEqual(Object.fromEntries(new h.w.FormData(h.$("form"))), { platform: "redm", region: "all", access: "all", feature: "all" });
});

test("API failure offers retry without fake choices, and reset preserves a usable default search", async t => {
  const h = harness(t, { platform: "minecraft" }); await h.resolve(0, null, false);
  assert.equal(h.$("[data-finder-retry]").hidden, false); assert.match(h.$("[data-finder-status]").textContent, /couldn’t be loaded/);
  assert.deepEqual(h.values("region"), ["all"]); assert.deepEqual(h.values("feature"), ["all"]);
  h.$("[data-finder-retry]").click(); await h.resolve(1, facets("Europe", "bedrock"));
  assert.equal(h.$("[data-finder-retry]").hidden, true); h.select("feature", "bedrock");
  h.$('[data-finder-step="3"]').click(); h.$('button[type="reset"]').click();
  assert.equal(h.$('[data-finder-question="platform"]').hidden, false);
  assert.deepEqual(Object.fromEntries(new h.w.FormData(h.$("form"))), { platform: "all", region: "all", access: "all", feature: "all" });
  assert.equal(h.timers.size, 1, "Only the outstanding request's timeout remains");
});

test("missing JavaScript model leaves a normal visible form instead of a broken wizard", t => {
  const h = harness(t, { model: false });
  assert.equal(h.requests.length, 0); assert.equal(h.$("[data-finder-steps]").hidden, true); assert.equal(h.$("[data-finder-submit]").hidden, false);
  assert.ok([...h.w.document.querySelectorAll("fieldset")].every(fieldset => !fieldset.hidden && !fieldset.disabled));
  assert.equal(h.$("form").getAttribute("action"), "/servers");
});
