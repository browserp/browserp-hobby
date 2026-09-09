import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
const read = path => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const end = Date.parse("2026-09-09T12:00:00Z");
function payload(range = "8h", overrides = {}) {
  const points = [{ at: new Date(end - 7 * 3600000).toISOString(), players: 0, capacity: 128 }, { at: new Date(end - 3600000).toISOString(), players: 30, capacity: 128 }];
  return { slug: "county-rp", range, platform: "fivem", scope: "server", supported: true, startAt: new Date(end - ({ "1h": 1, "8h": 8, "12h": 12, "24h": 24 }[range]) * 3600000).toISOString(), endAt: new Date(end).toISOString(), points, firstAt: points[0].at, lastAt: points.at(-1).at, observations: 2, sampled: false, truncated: false, partial: true, ...overrides };
}
const answer = body => ({ ok: true, text: async () => JSON.stringify(body) });
const settle = async () => { await new Promise(resolve => setImmediate(resolve)); await new Promise(resolve => setImmediate(resolve)); };
function setup(fetch) {
  const dom = new JSDOM(read("public/server.html"), { url: "https://www.browserp.com/server/county-rp", runScripts: "outside-only" });
  dom.window.fetch = fetch;
  const root = dom.window.document.getElementById("player-history");
  Object.defineProperty(root.querySelector("[data-history-chart]"), "clientWidth", { value: 320 });
  dom.window.eval(read("public/player-history.js"));
  return { dom, root, select: root.querySelector("select") };
}

test("default 8h uses the existing select contract, anonymous fetch and measured responsive dots with accessible observations", async () => {
  const calls = [], { dom, root, select } = setup(async (url, opts) => { calls.push({ url, opts }); return answer(payload()); });
  try {
    await settle();
    assert.equal(select.value, "8h"); assert.deepEqual([...select.options].map(option => option.text), ["1 hour", "8 hours", "12 hours", "24 hours"]);
    assert.equal(select.hasAttribute("data-native-select"), false); assert.equal(calls[0].opts.credentials, "omit"); assert.match(calls[0].url, /history=8h/);
    const svg = root.querySelector("svg"); assert.equal(svg.getAttribute("viewBox"), "0 0 320 240");
    assert.equal(svg.querySelectorAll("circle").length, 2); assert.equal(svg.querySelectorAll("path,polyline").length, 0);
    assert.ok(Number(svg.querySelector("circle:last-child").getAttribute("cx")) < 300, "Last point is not extended to now");
    assert.match(root.textContent, /Coverage is incomplete/);
    const details = root.querySelector("details"); details.open = true; details.dispatchEvent(new dom.window.Event("toggle"));
    assert.equal(root.querySelectorAll("tbody tr").length, 2); assert.equal(root.querySelector("time").dateTime, payload().lastAt);
    assert.deepEqual([...root.querySelectorAll("tbody td:last-child")].map(cell => cell.textContent), ["30", "0"]);
    assert.equal(calls.length, 1);
  } finally { dom.window.close(); }
});

test("changing ranges cancels old loads and out-of-order completion cannot replace the selected history", async () => {
  const pending = [], { dom, root, select } = setup((url, opts) => new Promise(resolve => pending.push({ url, opts, resolve })));
  try {
    select.value = "24h"; select.dispatchEvent(new dom.window.Event("change"));
    assert.equal(pending.length, 2); assert.equal(pending[0].opts.signal.aborted, true);
    pending[1].resolve(answer(payload("24h", { truncated: true, sampled: true })));
    await settle(); assert.match(root.textContent, /observation limit was reached/); assert.match(root.querySelector("svg").getAttribute("aria-label"), /24 hours/);
    pending[0].resolve(answer(payload())); await settle();
    assert.match(root.querySelector("svg").getAttribute("aria-label"), /24 hours/); assert.equal(root.getAttribute("aria-busy"), "false");
  } finally { dom.window.close(); }
});

test("empty, unsupported Roblox and Minecraft network histories have honest distinct wording", async () => {
  for (const data of [payload("8h", { points: [], observations: 0, firstAt: null, lastAt: null }), payload("8h", { supported: false, platform: "roblox", points: [], observations: 0, firstAt: null, lastAt: null }), payload("8h", { scope: "network", platform: "minecraft" })]) {
    const { dom, root, select } = setup(async () => answer(data));
    try {
      await settle();
      if (!data.supported) { assert.match(root.textContent, /not provided for this community/); assert.equal(select.disabled, true); assert.equal(root.querySelector("svg"), null); }
      else if (!data.points.length) { assert.match(root.textContent, /No player observations/); assert.equal(select.disabled, false); }
      else assert.match(root.textContent, /including lobbies and other worlds/);
    } finally { dom.window.close(); }
  }
});

test("request failure/malformed observations clear stale chart data and expose a working retry", async () => {
  let calls = 0;
  const { dom, root } = setup(async () => ++calls === 1 ? answer(payload("8h", { points: [{ at: payload().lastAt, players: null, capacity: 128 }] })) : answer(payload()));
  try {
    await settle(); assert.match(root.textContent, /temporarily unavailable/); assert.equal(root.querySelector("svg"), null);
    root.querySelector("[data-history-retry]").click(); await settle();
    assert.equal(calls, 2); assert.equal(root.querySelectorAll("circle").length, 2); assert.equal(root.querySelector("[data-history-retry]").hidden, true);
    dom.window.dispatchEvent(new dom.window.Event("pagehide")); assert.equal(root.getAttribute("aria-busy"), "false");
  } finally { dom.window.close(); }
});
