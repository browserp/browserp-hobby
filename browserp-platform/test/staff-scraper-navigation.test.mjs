import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";

const read = file => readFileSync(new URL(`../public/${file}`, import.meta.url), "utf8");
const settle = async () => { for (let i = 0; i < 5; i += 1) await new Promise(resolve => setTimeout(resolve, 0)); };
async function harness(t, platform, post = async () => ({ candidates: [], errors: [] })) {
  const dom = new JSDOM(read("staffpanel-scrapers.html"), { url: `https://browserp.test/staffpanel/scrapers#${platform}`, runScripts: "outside-only" });
  const w = dom.window; t.after(() => w.close());
  w.HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  w.HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
  const calls = [];
  const api = async (path, options = {}) => {
    calls.push({ path, method: options.method || "GET" });
    if (options.body) return post(path, JSON.parse(options.body));
    const game = new URL(path, w.location.origin).pathname.split("/").at(-1);
    return { workspace: { canManage: true, total: 1, items: [{ id: `${game}-fixture`, joinCode: "abc123", status: "pending", version: 1, candidate: { name: `${game} fixture`, description: "A synthetic community used to check safe review navigation.", region: "Europe", language: "English", framework: game === "minecraft" ? "Java" : "QBCore", accessType: "unknown", address: "play.example.com", edition: "java" } }] } };
  };
  for (const file of ["staff-fivem.js", "staff-minecraft.js", "staff-scrapers.js"]) w.eval(read(file));
  w.BrowseRPStaffScrapers.init({ api }); await settle();
  const $ = selector => w.document.querySelector(selector);
  const click = selector => { const element = $(selector); assert.ok(element, selector); element.click(); };
  const submit = selector => $(selector).dispatchEvent(new w.Event("submit", { bubbles: true, cancelable: true }));
  async function edit() {
    click(".fivem-item button"); await settle();
    const name = $('[name="name"]'); name.value = "Unsaved review draft"; name.dispatchEvent(new w.Event("input", { bubbles: true }));
    return name;
  }
  return { w, $, click, submit, edit, calls };
}

test("Roblox shows the accepted application direction while its tools remain in development", async t => {
  const h = await harness(t, "roblox");
  assert.equal(h.$(".staff-scraper-preview h2").textContent, "Roblox applications");
  assert.equal(h.$(".staff-scraper-plan summary").textContent, "Application workflow — in development");
  assert.match(h.$(".staff-scraper-preview").textContent, /Application tools are not active yet/);
  assert.doesNotMatch(h.$("#scrapers-content").textContent, /awaiting agreement|proposed Roblox pilot/);
  assert.ok(h.$(".staff-scraper-source-grid a")); assert.ok(h.$(".staff-scraper-plan li"));
  assert.deepEqual(h.calls, [], "Planning has no pretend import action or hidden import request");
});

for (const [platform, destination] of [["fivem", "redm"], ["redm", "minecraft"], ["minecraft", "fivem"]]) {
  test(`${platform} review keeps edits when navigation is cancelled and leaves only after explicit discard`, async t => {
    const h = await harness(t, platform); const name = await h.edit();
    h.click(`.staff-scraper-card[data-platform="${destination}"]`); await settle();
    assert.equal(h.w.location.hash, `#${platform}`);
    assert.equal(h.$(".fivem-editor").hidden, false);
    assert.equal(h.$('[name="name"]'), name);
    assert.equal(name.value, "Unsaved review draft");
    assert.match(h.$("dialog[open]").textContent, /Discard unsaved review edits/);
    assert.equal(h.calls.some(call => call.path.startsWith(`/api/admin/${destination}`)), false);
    const unload = new h.w.Event("beforeunload", { cancelable: true }); h.w.dispatchEvent(unload);
    assert.equal(unload.defaultPrevented, true);
    h.click("dialog button[type=button]"); await settle();
    assert.equal(h.w.document.activeElement, name);
    assert.equal(h.w.location.hash, `#${platform}`);
    assert.equal(name.value, "Unsaved review draft");
    h.click(`.staff-scrapers-link[data-platform="${destination}"]`); await settle();
    h.submit("dialog form"); await settle();
    assert.equal(h.w.location.hash, `#${destination}`);
    assert.equal(h.$("#scrapers-content > section").dataset.platform, destination);
    assert.equal(h.$("dialog"), null);
    assert.equal(h.$(".fivem-editor").hidden, true);
    const cleanUnload = new h.w.Event("beforeunload", { cancelable: true }); h.w.dispatchEvent(cleanUnload);
    assert.equal(cleanUnload.defaultPrevented, false, "The old editor unload guard is removed after discard");
    assert.ok(h.calls.every(call => call.method === "GET"), "Navigation never publishes the draft");
  });
}

test("browser Back and direct hash navigation restore the draft, coalesce rapid attempts, and support Escape", async t => {
  const h = await harness(t, "fivem");
  h.click('.staff-scraper-card[data-platform="redm"]'); await settle();
  const name = await h.edit();
  h.w.history.back(); await settle();
  assert.equal(h.w.location.hash, "#redm");
  h.w.location.hash = "#minecraft"; await settle();
  assert.equal(h.w.location.hash, "#redm");
  assert.equal(h.w.document.querySelectorAll("dialog[open]").length, 1);
  h.$("dialog").dispatchEvent(new h.w.Event("cancel", { cancelable: true })); await settle();
  assert.equal(h.$('[name="name"]'), name);
  assert.equal(name.value, "Unsaved review draft");
  assert.equal(h.$("dialog"), null);
  h.w.location.hash = "#minecraft"; await settle(); h.submit("dialog form"); await settle();
  assert.equal(h.w.location.hash, "#minecraft");
  assert.equal(h.$("#scrapers-content > section").dataset.platform, "minecraft");
});

test("a running import finishes before switching tabs, then ordinary clean navigation works", async t => {
  let release;
  const h = await harness(t, "minecraft", () => new Promise(resolve => { release = resolve; }));
  h.$('[name="inputs"]').value = "play.example.com"; h.submit(".fivem-fetch form"); await settle();
  h.click('.staff-scraper-card[data-platform="redm"]'); await settle();
  assert.equal(h.w.location.hash, "#minecraft");
  assert.match(h.$("#scrapers-content .fivem-status").textContent, /Wait for the current import action/);
  assert.equal(h.$("dialog"), null);
  release({ candidates: [], errors: [] }); await settle();
  h.click('.staff-scraper-card[data-platform="redm"]'); await settle();
  assert.equal(h.w.location.hash, "#redm");
  assert.equal(h.$("#scrapers-content > section").dataset.platform, "redm");
});
