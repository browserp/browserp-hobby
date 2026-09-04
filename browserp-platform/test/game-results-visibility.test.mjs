import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";

const read = path => readFileSync(new URL(`../public/${path}`, import.meta.url), "utf8");
const tick = async () => { for (let n = 0; n < 4; n++) await new Promise(resolve => setImmediate(resolve)); };
const servers = Array.from({ length: 24 }, (_, index) => ({
  slug: `fixture-community-${index}`, name: `Fixture community ${index + 1}`, platform_id: "fivem",
  description: "A synthetic reviewed community used to test a full page of search results.",
  region: "United Kingdom", language: "French", framework: "QBCore", access_type: "allowlisted",
  online: true, players: index, capacity: 64, tags: ["roleplay"]
}));

async function harness(t, { reduced = false, observerAvailable = true } = {}) {
  const dom = new JSDOM(read("game.html"), { url: "https://browserp.test/games/fivem?platform=redm", runScripts: "outside-only", pretendToBeVisual: true });
  t.after(() => dom.window.close());
  const w = dom.window, requests = [], observers = [];
  // Use the real visibility rules without asking JSDOM to implement unrelated modern colour functions.
  const style = w.document.createElement("style");
  style.textContent = [...read("browserp-v3.css").matchAll(/\.(?:reveal-v3(?:\.is-revealed)?|reveal-on-scroll)\s*\{[^}]*\}/g)].slice(0, 3).map(match => match[0]).join("\n");
  w.document.head.append(style);
  w.matchMedia = () => ({ matches: reduced, addEventListener() {} });
  if (observerAvailable) w.IntersectionObserver = class {
    constructor(callback, options) { this.callback = callback; this.options = options; this.targets = new Set(); observers.push(this); }
    observe(target) { this.targets.add(target); }
    unobserve(target) { this.targets.delete(target); }
    disconnect() { this.targets.clear(); }
    deliver(target, intersectionRatio, isIntersecting = intersectionRatio > 0) {
      if (this.targets.has(target)) this.callback([{ target, intersectionRatio, isIntersecting }]);
    }
  };
  let releaseResults;
  w.fetch = async path => {
    requests.push(path);
    if (path.startsWith("/api/servers?")) return await new Promise(resolve => { releaseResults = payload => resolve({ ok: true, json: async () => payload }); });
    return { ok: true, json: async () => path === "/api/auth/session" ? { authenticated: false } : {} };
  };
  for (const script of ["browserp-platforms.js", "browserp-v3.js", "discovery-model.js", "smart-search.js", "browserp-games.js"]) w.eval(read(script));
  await tick();
  return { w, requests, observers, $: selector => w.document.querySelector(selector), async loaded() {
    assert.equal(typeof releaseResults, "function", "The real game page must start its search request");
    releaseResults({ servers, total: 32, facets: { platform: [{ value: "fivem", count: 32 }], region: [{ value: "United Kingdom", count: 24 }] }, nextOffset: 24 });
    await tick();
  } };
}

test("a full asynchronous FiveM page renders real cards and has a reachable reveal boundary for a section taller than the viewport", async t => {
  const h = await harness(t);
  const results = h.$("#game-results-v4"), observer = h.observers.find(item => item.targets.has(results));
  assert.ok(observer, "The actual reveal module must observe the results section");
  assert.equal(h.$("#game-server-list-v4").children.length, 0, "Exercise the empty-to-full async layout change");
  observer.deliver(results, 0, false);
  assert.equal(h.w.getComputedStyle(results).opacity, "0");
  await h.loaded();
  assert.equal(new URL(h.requests.find(path => path.startsWith("/api/servers?")), "https://browserp.test").searchParams.get("platform"), "fivem", "The route's game must override an unrelated query-string game");
  assert.equal(h.$("#game-result-count").textContent, "32 servers · Showing 24");
  assert.equal(h.$("#game-server-list-v4").children.length, 24);
  assert.equal(h.$("#game-server-list-v4").getAttribute("aria-busy"), "false");
  assert.equal(h.$("#game-server-empty-v4").hidden, true);
  assert.deepEqual([...h.$(".platform-meta-v5").children].map(item => item.getAttribute("aria-label")), ["Game: FiveM", "Region: United Kingdom", "Language: French", "Server setup: QBCore", "Access: Approval required"]);
  const thresholds = Array.isArray(observer.options.threshold) ? observer.options.threshold : [observer.options.threshold ?? 0];
  // This is the measured failing shape: 7,170px of results in an 814px viewport.
  // A percentage of the whole result set must not be required before it becomes visible.
  assert.ok(Math.min(...thresholds) <= 1 / 7170, "One visible pixel must reach the reveal threshold even for thousands of pixels of results");
  observer.deliver(results, 1 / 7170);
  assert.equal(h.w.getComputedStyle(results).opacity, "1");
  assert.equal(observer.targets.has(results), false, "Visible results should stop being observed");
  const heading = h.$("#game-results-v4 .section-head-v3");
  observer.deliver(heading, 0.01);
  assert.equal(h.w.getComputedStyle(heading).opacity, "1", "The nested result heading must also reveal");
});

test("reduced-motion game pages display asynchronous results without relying on an observer", async t => {
  const h = await harness(t, { reduced: true });
  await h.loaded();
  assert.equal(h.observers.length, 0);
  for (const selector of ["#game-results-v4", "#game-results-v4 .section-head-v3"]) assert.equal(h.w.getComputedStyle(h.$(selector)).opacity, "1", selector);
  assert.equal(h.$("#game-server-list-v4").children.length, 24);
});

test("a browser without IntersectionObserver still renders its game results visibly", async t => {
  const h = await harness(t, { observerAvailable: false });
  await h.loaded();
  assert.equal(h.$("#game-server-list-v4").children.length, 24);
  assert.equal(h.w.getComputedStyle(h.$("#game-results-v4")).opacity, "1");
  assert.equal(h.w.getComputedStyle(h.$("#game-results-v4 .section-head-v3")).opacity, "1");
});
