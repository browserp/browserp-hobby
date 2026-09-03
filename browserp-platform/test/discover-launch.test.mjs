import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../public/browserp-directory.js", import.meta.url), "utf8");
const launchIds = ["fivem", "redm", "roblox", "minecraft"];

function directoryHarness(search = "") {
  class Element {
    constructor() { this.children = []; this.dataset = {}; this.attributes = {}; this.classList = { add() {}, remove() {} }; }
    append(...children) { this.children.push(...children); }
    replaceChildren(...children) { this.children = children; }
    setAttribute(name, value) { this.attributes[name] = value; }
    getAttribute(name) { return this.attributes[name]; }
    addEventListener() {}
  }
  const nodes = new Map();
  const names = { fivem: "FiveM", redm: "RedM", roblox: "Roblox", minecraft: "Minecraft", forza: "Forza", dayz: "DayZ" };
  const platforms = Object.entries(names).reverse().map(([id, name]) => ({ id, name }));
  const context = {
    document: { body: { dataset: {} }, createElement: () => new Element(), getElementById: (id) => nodes.get(id) },
    location: { search }, URLSearchParams,
    window: { BrowseRPPlatforms: { theme(node, id) { node.dataset.platform = id; } } },
    requestAnimationFrame: (callback) => callback(),
    fetch: async () => ({ ok: true, json: async () => ({ platforms }) })
  };
  vm.runInNewContext(source.replace('  if (page === "home") home();', '  window.testDirectory = { loadPlatforms, state };\n  if (page === "home") home();'), context);
  return { ...context.window.testDirectory, Element, nodes, platforms };
}

test("Discover exposes the four launch games in its strip and dropdown while preserving the full listing catalog", async () => {
  const html = readFileSync(new URL("../public/servers.html", import.meta.url), "utf8");
  assert.deepEqual([...html.matchAll(/data-game="([^"]+)"/g)].map((match) => match[1]), ["all", ...launchIds]);
  const { loadPlatforms, Element, platforms } = directoryHarness();
  const discoverSelect = new Element();
  await loadPlatforms(discoverSelect, true, true);
  assert.deepEqual(discoverSelect.children.map((option) => option.value), ["all", ...launchIds]);
  const listingSelect = new Element();
  await loadPlatforms(listingSelect);
  assert.deepEqual(listingSelect.children.map((option) => option.value), platforms.map((platform) => platform.id));
});

test("old upcoming-game URLs normalize to All games and preserve other filters", async () => {
  await import("../public/discovery-model.js");
  for (const platform of [...launchIds, "forza", "dayz", "unknown"]) {
    const state = globalThis.BrowseRPDiscovery.normalize({ platform, q: "county", region: "Europe", verified: "true" });
    assert.equal(state.platform, launchIds.includes(platform) ? platform : "all");
    assert.equal(state.query, "county"); assert.equal(state.region, "Europe"); assert.equal(state.verified, true);
  }
});
