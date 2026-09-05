import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";

const read = file => readFileSync(new URL(`../public/${file}`, import.meta.url), "utf8");
const settle = async () => { for (let i = 0; i < 5; i++) await new Promise(resolve => setImmediate(resolve)); };

test("changing the listing game updates setup examples, suggestion types and connect-link visibility", async t => {
  const dom = new JSDOM(read("list-server.html"), { url: "https://browserp.test/list-server", runScripts: "outside-only", pretendToBeVisual: true });
  const w = dom.window; t.after(() => w.close());
  w.fetch = async path => ({ ok: true, json: async () => path === "/api/platforms"
    ? { platforms: ["fivem", "redm", "roblox", "minecraft"].map(id => ({ id, name: id })) }
    : { authenticated: true, csrfToken: "fixture", user: { profile: { display_name: "Owner" } } } });
  w.eval(read("browserp-directory.js")); await settle();
  const form = w.document.querySelector("#listing-form"), platform = form.elements.platform, setup = form.elements.framework;
  for (const [game, label, example, kind, first] of [
    ["fivem", "Server setup", /QBCore.*ESX.*vMenu/, "Server setup", "QBCore"],
    ["redm", "Server setup", /VORP.*RedEM:RP.*RSG Core/, "Server setup", "VORP"],
    ["roblox", "Roblox experience", /Brookhaven.*Emergency Response: Liberty County/, "Experience", "Brookhaven"],
    ["minecraft", "Modpack or game mode", /Fantasy SMP.*Towny.*modpack/, "Game mode / setup", "Vanilla roleplay"]
  ]) {
    setup.value = "Previous game's setup"; platform.value = game; platform.dispatchEvent(new w.Event("change", { bubbles: true }));
    assert.equal(setup.value, ""); assert.equal(setup.parentElement.querySelector("span").textContent, label); assert.match(setup.placeholder, example);
    const cfx = form.querySelector("[data-cfx-field]"); assert.equal(cfx.hidden, !["fivem", "redm"].includes(game));
    setup.focus(); setup.dispatchEvent(new w.Event("input", { bubbles: true }));
    const suggestions = form.querySelector("#framework-suggestions-v3");
    assert.equal(suggestions.hidden, false); assert.equal(suggestions.querySelector(".search-suggestion-kind-v3").textContent, kind);
    assert.equal(suggestions.querySelector("strong").textContent, first);
    suggestions.querySelector("button").click(); assert.equal(setup.value, first); assert.equal(suggestions.hidden, true);
  }
});
