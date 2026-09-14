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
  let width = 320, resize, disconnected = 0, nextFrame = 0;
  const frames = new Map();
  dom.window.requestAnimationFrame = callback => { frames.set(++nextFrame, callback); return nextFrame; };
  dom.window.cancelAnimationFrame = id => frames.delete(id);
  Object.defineProperty(root.querySelector("[data-history-chart]"), "clientWidth", { get: () => width });
  dom.window.ResizeObserver = class { constructor(callback) { resize = callback; } observe() {} disconnect() { disconnected++; } };
  dom.window.eval(read("public/player-history.js"));
  return {
    dom, root, select: root.querySelector("select"), resize: next => { width = next; resize(); }, disconnected: () => disconnected,
    pendingFrames: () => frames.size,
    flushFrame: () => { const callbacks = [...frames.values()]; frames.clear(); for (const callback of callbacks) callback(); }
  };
}

test("default 8h preserves same-origin preview access and measured responsive dots with accessible observations", async () => {
  const calls = [], { dom, root, select } = setup(async (url, opts) => { calls.push({ url, opts }); return answer(payload()); });
  try {
    await settle();
    assert.equal(select.value, "8h"); assert.deepEqual([...select.options].map(option => option.text), ["1 hour", "8 hours", "12 hours", "24 hours"]);
    assert.equal(select.hasAttribute("data-native-select"), false); assert.equal(calls[0].opts.credentials, "same-origin"); assert.match(calls[0].url, /^\/api\/servers\?/); assert.match(calls[0].url, /history=8h/);
    const svg = root.querySelector("svg"); assert.equal(svg.getAttribute("viewBox"), "0 0 320 240");
    assert.equal(svg.querySelectorAll(".player-history-point").length, 2); assert.equal(svg.querySelectorAll("path,polyline").length, 0);
    assert.ok(Number([...svg.querySelectorAll(".player-history-point")].at(-1).getAttribute("cx")) < 300, "Last point is not extended to now");
    assert.match(root.textContent, /Hover or drag across the graph/);
    assert.match(root.querySelector("[data-history-status]").textContent, /Last reading: .*Times are local\. Gaps have no reading to show\./);
    assert.doesNotMatch(root.querySelector("[data-history-status]").textContent, /observations|Coverage|selection/);
    assert.doesNotMatch(root.querySelector("[data-history-status]").textContent, /Showing/);
    const details = root.querySelector("details"); details.open = true; details.dispatchEvent(new dom.window.Event("toggle"));
    assert.equal(root.querySelectorAll("tbody tr").length, 2); assert.equal(root.querySelector("tbody time").dateTime, payload().lastAt);
    assert.match(root.querySelector("[data-history-table]").textContent, /Coverage is incomplete/);
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
    await settle();
    assert.match(root.querySelector("[data-history-status]").textContent, /Showing selected readings\. Showing the latest available readings\./);
    const details = root.querySelector("details"); details.open = true; details.dispatchEvent(new dom.window.Event("toggle"));
    assert.match(root.querySelector("[data-history-table]").textContent, /observation limit was reached/); assert.match(root.querySelector("svg").getAttribute("aria-label"), /24 hours/);
    pending[0].resolve(answer(payload())); await settle();
    assert.match(root.querySelector("svg").getAttribute("aria-label"), /24 hours/); assert.equal(root.getAttribute("aria-busy"), "false");
  } finally { dom.window.close(); }
});

test("empty, unsupported Roblox and Minecraft network histories have honest distinct wording", async () => {
  for (const data of [payload("8h", { points: [], observations: 0, firstAt: null, lastAt: null }), payload("8h", { supported: false, platform: "roblox", points: [], observations: 0, firstAt: null, lastAt: null }), payload("8h", { scope: "network", platform: "minecraft" })]) {
    const { dom, root, select } = setup(async () => answer(data));
    try {
      await settle();
      if (!data.supported) { assert.match(root.textContent, /not available for this community/); assert.equal(select.disabled, true); assert.equal(root.querySelector("svg"), null); }
      else if (!data.points.length) { assert.match(root.textContent, /No counts recorded/); assert.equal(select.disabled, false); }
      else assert.match(root.textContent, /including lobbies and other worlds/);
    } finally { dom.window.close(); }
  }
});

test("request failure/malformed observations clear stale chart data and expose a working retry", async () => {
  let calls = 0;
  const { dom, root } = setup(async () => ++calls === 1 ? answer(payload("8h", { points: [{ at: payload().lastAt, players: null, capacity: 128 }] })) : answer(payload()));
  try {
    await settle(); assert.match(root.textContent, /history is unavailable/); assert.equal(root.querySelector("svg"), null);
    root.querySelector("[data-history-retry]").click(); await settle();
    assert.equal(calls, 2); assert.equal(root.querySelectorAll(".player-history-point").length, 2); assert.equal(root.querySelector("[data-history-retry]").hidden, true);
    dom.window.dispatchEvent(new dom.window.Event("pagehide")); assert.equal(root.getAttribute("aria-busy"), "false");
  } finally { dom.window.close(); }
});

function pointer(dom, target, type, x, y = 100, pointerType = "mouse", pointerId = 1) {
  const event = new dom.window.Event(type, { bubbles: true, cancelable: true });
  for (const [key, value] of Object.entries({ clientX: x, clientY: y, pointerType, pointerId, button: 0, isPrimary: true })) Object.defineProperty(event, key, { value });
  target.dispatchEvent(event); return event;
}
function surfaceFor(root, width = 320, height = 240) {
  const surface = root.querySelector(".player-history-inspector"), svg = surface.querySelector("svg");
  svg.getBoundingClientRect = () => ({ left: 0, top: 0, width, height });
  let captured = false;
  surface.setPointerCapture = () => { captured = true; };
  surface.hasPointerCapture = () => captured;
  surface.releasePointerCapture = () => { captured = false; };
  return { surface, svg, captured: () => captured };
}

test("hover selects exact zero/count timestamps, gaps hide the guide, and keyboard visits only real readings", async () => {
  const { dom, root } = setup(async () => answer(payload()));
  try {
    await settle(); const { surface, svg } = surfaceFor(root);
    const points = [...svg.querySelectorAll(".player-history-point")];
    pointer(dom, surface, "pointermove", Number(points[0].getAttribute("cx")));
    assert.equal(root.querySelector(".player-history-tooltip strong").textContent, "0 players");
    assert.equal(root.querySelector(".player-history-tooltip time").dateTime, payload().firstAt);
    assert.equal(root.querySelector(".player-history-guide").getAttribute("x1"), points[0].getAttribute("cx"));
    pointer(dom, surface, "pointermove", 179);
    assert.match(root.querySelector(".player-history-tooltip").textContent, /No reading to show here/);
    assert.equal(surface.getAttribute("aria-valuetext"), "No reading to show at this position");
    assert.equal(root.querySelector(".player-history-selection").getAttribute("visibility"), "hidden");
    surface.focus();
    const key = value => surface.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: value, bubbles: true, cancelable: true }));
    key("End"); assert.equal(surface.getAttribute("aria-valuenow"), "2");
    assert.match(surface.getAttribute("aria-valuetext"), /30 players, recorded/);
    assert.equal(root.querySelector(".player-history-tooltip time").dateTime, payload().lastAt);
    key("ArrowRight"); assert.equal(surface.getAttribute("aria-valuenow"), "2");
    key("Home"); assert.equal(surface.getAttribute("aria-valuenow"), "1");
    key("Escape"); assert.equal(root.querySelector(".player-history-tooltip").hidden, true);
  } finally { dom.window.close(); }
});

test("mouse hover recovers after an uncaptured drag ends outside, while captured horizontal scrubbing survives leaving", async () => {
  const { dom, root } = setup(async () => answer(payload()));
  try {
    await settle(); const { surface, svg, captured } = surfaceFor(root);
    const [first, last] = [...svg.querySelectorAll(".player-history-point")].map(point => Number(point.getAttribute("cx")));
    pointer(dom, surface, "pointerdown", first, 100);
    pointer(dom, surface, "pointermove", first + 1, 125);
    assert.equal(captured(), false);
    pointer(dom, surface, "pointerleave", first + 1, 250);
    pointer(dom, dom.window.document, "pointerup", first + 1, 250);
    pointer(dom, surface, "pointermove", last);
    assert.equal(root.querySelector(".player-history-tooltip").hidden, false);
    assert.equal(root.querySelector(".player-history-tooltip strong").textContent, "30 players");
    assert.equal(root.querySelector(".player-history-tooltip time").dateTime, payload().lastAt);

    pointer(dom, surface, "pointerdown", last, 100);
    pointer(dom, surface, "pointermove", last - 10, 101);
    assert.equal(captured(), true);
    pointer(dom, surface, "pointerleave", 330, 101);
    assert.equal(captured(), true, "Leaving must preserve captured horizontal scrubbing");
    const move = pointer(dom, surface, "pointermove", first, 101);
    assert.equal(move.defaultPrevented, true);
    assert.equal(root.querySelector(".player-history-tooltip strong").textContent, "0 players");
    pointer(dom, surface, "pointerup", first, 101);
    assert.equal(captured(), false);
  } finally { dom.window.close(); }
});

test("horizontal finger scrubbing captures only after intent, suppresses its click, and vertical/cancel gestures stay scrollable", async () => {
  const { dom, root } = setup(async () => answer(payload()));
  try {
    await settle(); const { surface, svg, captured } = surfaceFor(root);
    const x = Number(svg.querySelector(".player-history-point").getAttribute("cx"));
    pointer(dom, surface, "pointerdown", x - 10, 100, "touch"); assert.equal(captured(), false);
    const move = pointer(dom, surface, "pointermove", x, 101, "touch");
    assert.equal(move.defaultPrevented, true); assert.equal(captured(), true);
    assert.equal(root.querySelector(".player-history-tooltip time").dateTime, payload().firstAt);
    pointer(dom, surface, "pointerup", x, 101, "touch"); assert.equal(captured(), false);
    const click = new dom.window.MouseEvent("click", { bubbles: true, cancelable: true });
    surface.dispatchEvent(click); assert.equal(click.defaultPrevented, true);
    pointer(dom, surface, "pointerdown", x, 100, "touch");
    const vertical = pointer(dom, surface, "pointermove", x + 1, 125, "touch");
    assert.equal(vertical.defaultPrevented, false); assert.equal(captured(), false);
    pointer(dom, surface, "pointercancel", x + 1, 125, "touch");
    assert.equal(root.querySelector(".player-history-tooltip").hidden, true);
    assert.match(read("public/player-history.css"), /touch-action: pan-y pinch-zoom/);
    assert.match(read("public/player-history.css"), /max-width: calc\(100% - 16px\)/);
  } finally { dom.window.close(); }
});

test("touch scrubbing survives bubbled child capture loss and stops only when its own pointer loses capture", async () => {
  const { dom, root } = setup(async () => answer(payload()));
  try {
    await settle(); const { surface, svg, captured } = surfaceFor(root);
    const [first, last] = [...svg.querySelectorAll(".player-history-point")].map(point => Number(point.getAttribute("cx")));
    pointer(dom, svg, "pointerdown", first - 10, 100, "touch");
    pointer(dom, svg, "pointermove", first, 101, "touch");
    assert.equal(captured(), true);
    assert.equal(root.querySelector(".player-history-tooltip strong").textContent, "0 players");
    pointer(dom, svg, "lostpointercapture", first, 101, "touch");
    const gapMove = pointer(dom, surface, "pointermove", 179, 101, "touch");
    assert.equal(gapMove.defaultPrevented, true);
    assert.equal(root.querySelector(".player-history-tooltip strong").textContent, "No reading to show here");
    pointer(dom, surface, "lostpointercapture", 179, 101, "touch", 2);
    pointer(dom, surface, "pointermove", last, 101, "touch");
    assert.equal(root.querySelector(".player-history-tooltip strong").textContent, "30 players");
    surface.releasePointerCapture(1);
    pointer(dom, surface, "lostpointercapture", last, 101, "touch");
    const afterLoss = pointer(dom, surface, "pointermove", first, 101, "touch");
    assert.equal(afterLoss.defaultPrevented, false);
    assert.equal(root.querySelector(".player-history-tooltip strong").textContent, "30 players");
  } finally { dom.window.close(); }
});

test("deferred resize coalesces widths and preserves latest selection/focus; range changes and pagehide cancel redraws", async () => {
  const h = setup(async url => answer(payload(new URL(url, "https://example.invalid").searchParams.get("history"))));
  const { dom, root, select } = h;
  try {
    await settle(); const original = surfaceFor(root).surface;
    original.focus();
    h.resize(600);
    h.resize(640);
    assert.equal(root.querySelector(".player-history-inspector"), original, "ResizeObserver must not rebuild synchronously");
    assert.equal(h.pendingFrames(), 1, "Width changes share one scheduled redraw");
    original.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "End", bubbles: true }));
    h.flushFrame();
    const resized = root.querySelector(".player-history-inspector");
    assert.notEqual(resized, original); assert.equal(dom.window.document.activeElement, resized);
    assert.equal(resized.querySelector("svg").getAttribute("viewBox"), "0 0 640 240");
    assert.equal(resized.getAttribute("aria-valuenow"), "2");
    assert.equal(root.querySelector(".player-history-tooltip time").dateTime, payload().lastAt);
    original.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Home", bubbles: true }));
    assert.equal(original.getAttribute("aria-valuenow"), "2", "Detached inspector no longer handles keys");
    assert.equal(resized.getAttribute("aria-valuenow"), "2");
    h.resize(700); assert.equal(h.pendingFrames(), 1);
    select.value = "24h"; select.dispatchEvent(new dom.window.Event("change"));
    assert.equal(h.pendingFrames(), 0, "New loads cancel a pending redraw of the old range");
    await settle();
    const replacement = root.querySelector(".player-history-inspector"); assert.notEqual(replacement, resized);
    h.flushFrame(); assert.equal(root.querySelector(".player-history-inspector"), replacement);
    resized.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "Home", bubbles: true }));
    assert.equal(resized.getAttribute("aria-valuenow"), "2", "Old range listeners are removed");
    assert.equal(replacement.getAttribute("aria-valuenow"), "1");
    replacement.focus(); assert.match(root.querySelector(".player-history-tooltip time").textContent, /·.*·/);
    h.resize(720); assert.equal(h.pendingFrames(), 1);
    dom.window.dispatchEvent(new dom.window.Event("pagehide")); assert.equal(h.disconnected(), 1);
    assert.equal(h.pendingFrames(), 0, "Page exit cancels its scheduled redraw");
    h.resize(740); assert.equal(h.pendingFrames(), 0, "Late observer callbacks cannot schedule a closed page");
    replacement.dispatchEvent(new dom.window.KeyboardEvent("keydown", { key: "End", bubbles: true }));
    assert.equal(replacement.getAttribute("aria-valuenow"), "1");
    assert.equal(root.querySelector(".player-history-tooltip").hidden, true);
    const restored = new dom.window.Event("pageshow"); Object.defineProperty(restored, "persisted", { value: true });
    dom.window.dispatchEvent(restored); await settle();
    assert.notEqual(root.querySelector(".player-history-inspector"), replacement, "Back-forward cache restore mounts a fresh inspector");
  } finally { dom.window.close(); }
});
