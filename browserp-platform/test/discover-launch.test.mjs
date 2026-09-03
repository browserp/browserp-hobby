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
  vm.runInNewContext(source.replace('  if (page === "home") home();', '  window.testDirectory = { loadPlatforms, readFilters, renderSearchSuggestions, state };\n  if (page === "home") home();'), context);
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

test("old upcoming-game Discover URLs fall back to All games and preserve other filters", () => {
  for (const platform of [...launchIds, "forza", "dayz", "unknown"]) {
    const { readFilters, state } = directoryHarness(`?platform=${platform}&q=county&region=Europe&verified=true`);
    readFilters();
    assert.equal(state.filters.platform, launchIds.includes(platform) ? platform : "all");
    assert.equal(state.filters.query, "county");
    assert.equal(state.filters.region, "Europe");
    assert.equal(state.filters.verified, true);
  }
});

test("Discover suggestions omit upcoming games and keep useful initial categories", () => {
  const { renderSearchSuggestions, Element, nodes } = directoryHarness();
  const input = new Element();
  input.setAttribute("aria-controls", "suggestions");
  const list = new Element();
  nodes.set("suggestions", list);
  renderSearchSuggestions(input, "");
  assert.deepEqual(list.children.map((item) => item.children[1].textContent), ["FiveM roleplay", "Roblox roleplay", "QBCore", "ESX", "serious roleplay", "United Kingdom", "United States"]);
  renderSearchSuggestions(input, "roleplay");
  assert.deepEqual(list.children.map((item) => item.dataset.platform).filter(Boolean), launchIds);
  for (const query of ["Forza", "Garry", "DayZ", "Euro Truck", "ARMA", "VRChat", "Zomboid", "Assetto", "BeamNG"]) {
    renderSearchSuggestions(input, query);
    assert.equal(list.hidden, true, `${query} must not be offered`);
    assert.equal(input.getAttribute("aria-expanded"), "false");
  }
});
