import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

function render(pathname) {
  class Element {
    constructor(tag = "div", text = "") { this.tagName = tag; this.textContent = text; this.children = []; this.dataset = {}; this.attributes = {}; this.hidden = false; this.classList = { add() {} }; }
    append(...items) { this.children.push(...items); }
    prepend(...items) { this.children.unshift(...items); }
    replaceChildren(...items) { this.children = items; }
    setAttribute(name, value) { this.attributes[name] = value; }
  }
  const nodes = new Map();
  const document = { title: "", querySelector(selector) { if (!nodes.has(selector)) nodes.set(selector, new Element()); return nodes.get(selector); }, createElement: (tag) => new Element(tag), createElementNS: (_, tag) => new Element(tag) };
  const requests = [];
  const context = { document, location: { pathname, search: "" }, URLSearchParams, window: { BrowseRPPlatforms: { theme(element, id) { element.dataset.platform = id; } } }, fetch: async(url) => { requests.push(url); return { ok: true, json: async() => ({ servers: [] }) }; } };
  vm.runInNewContext(readFileSync(new URL("../public/browserp-games.js", import.meta.url), "utf8"), context);
  return { nodes, document, requests };
}

test("games hub offers exactly the four launch games in the requested order", () => {
  const { nodes } = render("/games");
  const cards = nodes.get("#game-hub-grid-v4").children;
  assert.deepEqual(cards.map((card) => card.dataset.platform), ["fivem", "redm", "roblox", "minecraft"]);
  assert.ok(cards.every((card) => card.tagName === "a" && card.href.startsWith("/games/")));
  assert.equal(nodes.get("#game-page-nav-v4").hidden, true);
  const upcoming = nodes.get("#game-upcoming-grid-v5").children;
  assert.equal(upcoming.length, 9);
  const forza = upcoming.find((card) => card.dataset.platform === "forza");
  assert.equal(forza.children[0].children[0].src, "/assets/games/forza-roleplay.webp");
  assert.ok(upcoming.every((card) => card.tagName === "article" && !card.href && card.children.at(-1).textContent === "Coming soon"));
  const html = readFileSync(new URL("../public/game.html", import.meta.url), "utf8");
  assert.match(html, /<details class="game-upcoming-v5" id="game-upcoming-v5">/);
  assert.doesNotMatch(html, /<details[^>]*\bopen\b/);
});

test("upcoming game URLs show coming soon without loading a server directory", () => {
  const { document, nodes, requests } = render("/games/forza");
  assert.equal(document.title, "Forza — Coming soon | BrowseRP");
  assert.equal(nodes.get("#game-page-title-v4").textContent, "Forza is coming soon.");
  assert.equal(nodes.get("#game-page-actions-v4").children[0].href, "/games");
  assert.deepEqual(requests, []);
});

test("available game URLs keep their selected navigation and filtered server requests", () => {
  const { nodes, requests } = render("/games/roblox");
  const links = nodes.get("#game-page-nav-v4").children;
  assert.equal(links.length, 4);
  assert.equal(links.find((link) => link.dataset.game === "roblox").attributes["aria-current"], "page");
  assert.match(requests[0], /platform=roblox/);
  assert.equal(nodes.get("#game-directory-link-v4").href, "/servers?platform=roblox");
});
