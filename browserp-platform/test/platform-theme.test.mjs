import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
class Element {
  constructor(tag) { this.tagName = tag; this.children = []; this.dataset = {}; this.attributes = {}; this.textContent = ""; }
  append(...children) { this.children.push(...children); }
  setAttribute(key, value) { this.attributes[key] = value; }
}
const context = { window: {}, document: { createElement: (tag) => new Element(tag), createElementNS: (_, tag) => new Element(tag), createTextNode: (text) => ({ textContent: text }) } };
vm.runInNewContext(read("public/browserp-platforms.js"), context);
const platforms = context.window.BrowseRPPlatforms;
const text = (node) => node.textContent + (node.children || []).map(text).join("");

test("platform labels resolve safely across IDs, names, aliases and unknown games", () => {
  for (const [id, name] of Object.entries(platforms.names)) {
    assert.equal(platforms.resolve(id), id);
    assert.equal(platforms.resolve(name), id);
  }
  assert.equal(platforms.resolve("Garry’s Mod"), "gmod");
  assert.equal(platforms.resolve("Euro Truck Simulator"), "ets2");
  assert.equal(platforms.resolve('<img src=x onerror=alert(1)>'), "other");
  const badge = platforms.badge('" data-platform="redm', '<b>Community</b>');
  assert.equal(badge.dataset.platform, "other");
  assert.equal(text(badge), '<b>Community</b>');
});

test("rendered info cards and compact metadata retain platform region language framework access order", () => {
  const server = { platform_id: "redm", platform_name: "RedM", region: "Europe", language: "French", framework: "VORP", online: false };
  const engagement = { accessType: "Whitelist" };
  const facts = platforms.facts(server, engagement);
  assert.deepEqual(Array.from(facts.children, (card) => text(card.children[0])), ["Game", "Region", "Language", "Server setup", "Access", "Player status"]);
  assert.deepEqual(Array.from(facts.children, (card) => text(card.children[1])), ["RedM", "Europe", "French", "VORP", "Whitelist", "Status unavailable"]);
  assert.deepEqual(Array.from(platforms.metadata(server, engagement).children, text), ["RedM", "Europe", "French", "VORP", "Whitelist"]);
  assert.equal(text(platforms.facts({ platform_id: "minecraft" }).children[2].children[1]), "Not specified");
});

test("all game accents are distinct and meet AA contrast on info cards and badges", () => {
  const css = read("public/browserp-v3.css");
  const luminance = (rgb) => rgb.map((v) => v / 255).map((v) => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
  const rgb = (hex) => hex.match(/../g).map((part) => parseInt(part, 16));
  const accents = new Set();
  for (const id of Object.keys(platforms.names)) {
    const match = css.match(new RegExp(`\\[data-platform="${id}"\\] \\{ --platform-accent: #(\\w{6});`));
    assert.ok(match, `${id} has a theme`);
    accents.add(match[1]);
    const foreground = rgb(match[1]);
    // Selected controls use the strongest tint (13% accent over the panel).
    const background = rgb("100d13").map((v, i) => v * .87 + foreground[i] * .13);
    assert.ok((luminance(foreground) + .05) / (luminance(background) + .05) >= 4.5, `${id} contrast`);
  }
  assert.equal(accents.size, Object.keys(platforms.names).length);
});

test("theme helper loads before consumers and showcase facts have the same order", () => {
  for (const page of ["index", "servers", "game", "server", "example-server", "list-server"]) {
    const html = read(`public/${page}.html`);
    assert.ok(html.indexOf("browserp-platforms.js") < html.indexOf("browserp-v3.js"), `${page} loads helper first`);
  }
  const labels = [...read("public/example-server.html").matchAll(/<dt>(.*?)<\/dt>/g)].map((match) => match[1]);
  assert.deepEqual(labels, ["Game", "Region", "Language", "Server setup", "Access", "Player status"]);
});

test("suggestions stay open for keyboard focus and close only after focus leaves the widget", () => {
  const source = read("public/browserp-directory.js");
  const start = source.indexOf("  function bindSuggestionKeyboard(");
  const end = source.indexOf("  function home()", start);
  const callbacks = [];
  const input = { handlers: {}, attributes: {}, setAttribute(key, value) { this.attributes[key] = value; }, addEventListener(event, handler) { this.handlers[event] = handler; } };
  const option = {};
  const list = { ...input, handlers: {}, attributes: {}, hidden: false, inert: false, contains: (node) => node === option, classList: { remove() {} } };
  const document = { activeElement: input };
  const scope = { document, setTimeout: (fn) => callbacks.push(fn), input, list };
  vm.runInNewContext(`${source.slice(start, end)}\nbindSuggestionKeyboard(input, list);`, scope);
  input.handlers.blur();
  document.activeElement = option;
  callbacks.shift()();
  assert.equal(list.hidden, false);
  list.handlers.focusout();
  document.activeElement = {};
  callbacks.shift()();
  assert.equal(list.hidden, true);
  assert.equal(list.inert, true);
  assert.equal(input.attributes['aria-expanded'], 'false');
});
