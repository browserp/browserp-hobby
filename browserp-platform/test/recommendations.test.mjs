import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { JSDOM } from "jsdom";

const source = readFileSync(new URL("../public/recommendations.js", import.meta.url), "utf8");
const context = vm.createContext({}); vm.runInContext(source, context);
const { create, key } = context.BrowseRPRecommendationModel;
const day = 86_400_000, instant = Date.UTC(2026, 8, 6, 12);
const plain = value => JSON.parse(JSON.stringify(value));
const tick = () => new Promise(resolve => setImmediate(resolve));
function memory(initial = {}) {
  const values = new Map(Object.entries(initial)), writes = [];
  return { values, writes, getItem: name => values.get(name) ?? null,
    setItem(name, value) { values.set(name, String(value)); writes.push(["set", name]); },
    removeItem(name) { values.delete(name); writes.push(["remove", name]); } };
}
const server = (slug, region = "United Kingdom", game = "fivem") => ({ slug, region, platform_id: game });
const view = (slug, region = "United Kingdom", game = "fivem", at = instant) => ({ slug, region, game, at });
const seed = views => JSON.stringify({ enabled: true, views });

test("recommendations are opt-in and never import pre-existing browser or site history", () => {
  const storage = memory({ "browserp-history": JSON.stringify([server("previous-uk")]), browsingHistory: "United Kingdom" });
  const model = create(storage, () => instant);
  assert.deepEqual(plain(model.read()), { enabled: false, views: [] });
  assert.equal(model.record(server("before-consent")), false);
  model.prune(); assert.equal(storage.writes.length, 0);
  assert.equal(model.enable(true), true);
  assert.deepEqual(plain(model.read()), { enabled: true, views: [] });
  assert.equal(model.record(server("after-consent")), true);
  assert.equal(model.read().views.length, 1);
  assert.equal(model.read().views[0].slug, "after-consent");
  assert.equal(storage.values.get("browsingHistory"), "United Kingdom");
});

test("history removes invalid, future and 30-day-old views and retains at most 80", () => {
  const views = [view("expired", "UK", "fivem", instant - 30 * day), view("future", "UK", "fivem", instant + 1),
    ...Array.from({ length: 85 }, (_, i) => view(`server-${i}`, "UK", "fivem", instant - i * 3_600_000)),
    view("unsupported", "UK", "unknown"), view("bad-region", "<script>alert(1)</script>")];
  const storage = memory({ [key]: seed(views) }), model = create(storage, () => instant);
  model.prune(); const data = model.read();
  assert.equal(data.views.length, 80);
  assert.equal(data.views[0].slug, "server-0"); assert.equal(data.views.at(-1).slug, "server-79");
  assert.equal(data.views.every(item => item.region === "United Kingdom"), true);
  assert.equal(JSON.parse(storage.values.get(key)).views.length, 80);
  assert.deepEqual(Object.keys(plain(data.views[0])).sort(), ["at", "game", "region", "slug"]);
});

test("frequent UK viewing ranks UK communities first without replacing explicit searches or sorting", () => {
  const storage = memory({ [key]: seed([view("uk-one", "GB"), view("uk-two", "UK"), view("us-one", "US")]) });
  const model = create(storage, () => instant);
  const servers = [server("us-first", "United States"), server("uk-first"), server("uk-second", "UK"), server("us-last", "USA")];
  assert.equal(model.preferred("fivem"), "United Kingdom");
  assert.deepEqual(plain(model.rank(servers, { platform: "fivem", sort: "recommended" })).map(item => item.slug), ["uk-first", "uk-second", "us-first", "us-last"]);
  assert.equal(servers[0].slug, "us-first", "ranking never mutates the fetched directory");
  for (const filters of [{ query: "police" }, { sort: "newest" }, { region: "United States" }, { sort: "votes" }, { platform: "minecraft" }]) {
    assert.deepEqual(plain(model.rank(servers, filters)), servers, JSON.stringify(filters));
  }
});

test("recommendations need enough observations and recent interests outweigh stale views", () => {
  const model = create(memory({ [key]: seed([view("uk-one"), view("uk-two")]) }), () => instant);
  assert.equal(model.preferred(), "");
  const recency = create(memory({ [key]: seed([view("old-uk-1", "UK", "fivem", instant - 28 * day), view("old-uk-2", "UK", "fivem", instant - 27 * day), view("fresh-us", "US")]) }), () => instant);
  assert.equal(recency.preferred(), "United States");
});

test("refreshing the same server repeatedly does not manufacture browsing preference", () => {
  let now = instant; const storage = memory(), model = create(storage, () => now); model.enable(true);
  assert.equal(model.record(server("uk-one")), true);
  now += 10 * 60_000; assert.equal(model.record(server("uk-one")), false);
  now += 19 * 60_000; assert.equal(model.record(server("uk-one")), false);
  assert.equal(model.read().views.length, 1);
  now += 60_000; assert.equal(model.record(server("uk-one")), true);
  assert.equal(model.read().views.length, 2);
});

test("malformed or inaccessible storage cannot enable tracking or crash discovery", () => {
  for (const invalid of ["{bad JSON", "null", "[]", '{"enabled":"true","views":[]}', seed([null, {}, view("bad/slug"), view("okay", "unknown"), view("okay", "UK", "forza")])]) {
    const model = create(memory({ [key]: invalid }), () => instant);
    assert.deepEqual(plain(model.read().views), []);
    assert.equal(model.preferred(), "");
  }
  const unavailable = create({ getItem() { throw Error("Disabled"); }, setItem() { throw Error("Disabled"); }, removeItem() { throw Error("Disabled"); } });
  assert.equal(unavailable.read().enabled, false);
  assert.equal(unavailable.enable(true), false);
  assert.equal(unavailable.record(server("not-recorded")), false);
  assert.equal(unavailable.enable(false), false);
});

test("clear preserves consent while disable erases history and prevents future recording", () => {
  const storage = memory({ [key]: seed([view("uk-one"), view("uk-two"), view("uk-three")]) }), model = create(storage, () => instant);
  assert.equal(model.clear(), true);
  assert.deepEqual(plain(model.read()), { enabled: true, views: [] });
  model.record(server("new-view")); assert.equal(model.enable(false), true);
  assert.equal(storage.values.has(key), false);
  assert.equal(model.record(server("after-disabling")), false);
  model.enable(true); assert.deepEqual(plain(model.read().views), []);
});

test("clearing without consent never creates optional preference storage", () => {
  const storage = memory(), model = create(storage, () => instant);
  assert.equal(model.clear(), true);
  assert.equal(storage.values.has(key), false);
  assert.equal(storage.writes.some(([operation]) => operation === "set"), false);
});

async function browser(t, fetcher, pathname = "/") {
  const dom = new JSDOM('<body data-page="home"><section><div id="featured-server-list"></div></section></body>', { url: `https://browserp.test${pathname}`, runScripts: "outside-only", pretendToBeVisual: true });
  t.after(() => dom.window.close()); const w = dom.window;
  w.localStorage.setItem(key, seed([view("uk-one", "UK", "fivem", Date.now()), view("uk-two", "UK", "fivem", Date.now()), view("uk-three", "UK", "fivem", Date.now())]));
  w.fetch = (url, options) => url === "/api/auth/session" ? Promise.resolve({ ok: true, json: async () => ({ authenticated: false }) }) : fetcher(url, options);
  w.BrowseRPDirectory = { render(root, servers) { root.replaceChildren(...servers.map(item => { const p = w.document.createElement("p"); p.textContent = item.slug; return p; })); } };
  w.eval(source); w.document.dispatchEvent(new w.Event("DOMContentLoaded")); await tick();
  return { w, $: selector => w.document.querySelector(selector) };
}
const response = servers => ({ ok: true, json: async () => ({ servers }) });

test("turning recommendations off clears visible results and rejects an in-flight response", async t => {
  let finish; const calls = [];
  const h = await browser(t, (url, options) => { calls.push({ url, options }); return new Promise(resolve => { finish = resolve; }); });
  assert.equal(calls.length, 1); assert.match(calls[0].url, /region=United\+Kingdom/);
  h.$("[data-reset-recommendations]").click();
  assert.equal(h.w.localStorage.getItem(key), null);
  assert.equal(calls[0].options.signal.aborted, true);
  finish(response([server("late-private-preference")])); await tick();
  assert.equal(h.$(".recommendation-results").hidden, true);
  assert.doesNotMatch(h.$(".recommendations-v7").textContent, /late-private-preference/);
});

test("clearing enabled history invalidates any outstanding recommendation response", async t => {
  let finish;
  const h = await browser(t, () => new Promise(resolve => { finish = resolve; }));
  h.w.BrowseRPRecommendations.clear(); h.w.dispatchEvent(new h.w.Event("browserp:recommendations-changed"));
  finish(response([server("late-old-history")])); await tick();
  assert.equal(h.$(".recommendation-results").childElementCount, 0);
  assert.match(h.$(".recommendation-message").textContent, /explore a few server pages/);
});

test("staff pages never activate browsing history or issue recommendation requests", async t => {
  let calls = 0;
  const h = await browser(t, async () => { calls++; return response([]); }, "/staffpanel/overview");
  assert.equal(h.w.BrowseRPRecommendations, undefined);
  assert.equal(calls, 0); assert.equal(h.$(".recommendations-v7"), null);
});

test("clearing all site storage in another tab immediately removes displayed recommendations", async t => {
  const h = await browser(t, async () => response([server("previous-interest")]));
  assert.match(h.$(".recommendation-results").textContent, /previous-interest/);
  h.w.localStorage.clear();
  h.w.dispatchEvent(new h.w.StorageEvent("storage", { key: null, storageArea: h.w.localStorage }));
  await tick();
  assert.equal(h.$(".recommendation-results").hidden, true);
  assert.equal(h.$(".recommendation-results").childElementCount, 0);
  assert.equal(h.$("[data-enable-recommendations]").hidden, false);
});

test("settings mount after asynchronous profile rendering and stay operable without duplicate controls", async t => {
  const h = await browser(t, async () => response([]));
  const profile = h.w.document.createElement("section"), settings = h.w.document.createElement("div");
  settings.dataset.recommendationSettings = ""; profile.append(settings); h.w.document.body.append(profile);
  h.w.BrowseRPRecommendations.mountSettings(profile); h.w.BrowseRPRecommendations.mountSettings(profile);
  const inputs = settings.querySelectorAll("input[type=checkbox]");
  assert.equal(inputs.length, 1); assert.equal(inputs[0].checked, true);
  settings.querySelector("button").click();
  assert.equal(h.w.BrowseRPRecommendations.read().views.length, 0);
  assert.equal(settings.querySelector("button").disabled, true);
  inputs[0].checked = false; inputs[0].dispatchEvent(new h.w.Event("change"));
  assert.equal(h.w.localStorage.getItem(key), null);
  assert.match(settings.querySelector("[role=status]").textContent, /off.*cleared/);
});

test("a storage failure during opt-out is explained rather than claiming history was cleared", async t => {
  const h = await browser(t, async () => response([]));
  h.w.Storage.prototype.removeItem = () => { throw Error("Storage is unavailable"); };
  h.$("[data-reset-recommendations]").click();
  assert.match(h.$(".recommendation-message").textContent, /could not clear/);
  assert.equal(h.w.BrowseRPRecommendations.read().enabled, false);
});
