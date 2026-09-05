import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";

const source = readFileSync(new URL("../public/browserp-v3.js", import.meta.url), "utf8");
const start = source.indexOf("  function touchPolish() {");
const end = source.indexOf("\n  async function init()", start);
assert.ok(start >= 0 && end > start);
function harness(t, { coarse = true, reduced = false } = {}) {
  const dom = new JSDOM('<div id="scroller"><button class="button-primary-v3"><span>Search</span></button></div>', { runScripts: "outside-only" });
  const w = dom.window; t.after(() => w.close()); const frames = new Map(); let serial = 0;
  const queries = new Map();
  w.requestAnimationFrame = callback => { const id = ++serial; frames.set(id, callback); return id; };
  w.cancelAnimationFrame = id => frames.delete(id);
  w.matchMedia = query => {
    if (!queries.has(query)) {
      const media = new w.EventTarget(); media.matches = query.includes("reduced-motion") ? reduced : coarse; queries.set(query, media);
    }
    return queries.get(query);
  };
  const button = w.document.querySelector("button"), child = button.querySelector("span");
  button.getBoundingClientRect = () => ({ left: 10, right: 210, top: 10, bottom: 60 });
  w.eval(source.slice(start, end) + "\ntouchPolish();");
  const pointer = (type, properties = {}, target = child) => {
    const event = new w.MouseEvent(type, { clientX: 100, clientY: 30, bubbles: true, cancelable: true, ...properties });
    Object.defineProperties(event, { pointerId: { value: properties.pointerId ?? 7 }, pointerType: { value: properties.pointerType ?? "touch" }, isPrimary: { value: properties.isPrimary ?? true } });
    target.dispatchEvent(event); return event;
  };
  const frame = () => { const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback()); };
  const media = (name, matches) => { const target = [...queries].find(([query]) => query.includes(name))[1]; target.matches = matches; target.dispatchEvent(new w.Event("change")); };
  const shining = () => button.classList.contains("touch-sweep-v3");
  return { w, button, pointer, frame, frames, media, shining };
}

test("a normal touch tap retains its sweep and native click, then cleans up when the animation ends", t => {
  const h = harness(t); let clicks = 0; h.button.addEventListener("click", () => clicks++);
  assert.equal(h.pointer("pointerdown").defaultPrevented, false);
  assert.equal(h.frames.size, 1);
  assert.equal(h.pointer("pointerup").defaultPrevented, false); h.button.click();
  h.frame(); h.frame(); assert.equal(h.shining(), true); assert.equal(clicks, 1);
  const end = new h.w.Event("animationend", { bubbles: true }); Object.defineProperty(end, "animationName", { value: "touch-sweep-v3" });
  h.button.dispatchEvent(end); assert.equal(h.shining(), false); assert.equal(h.frames.size, 0);
});

for (const completedFrames of [0, 1, 2]) test(`pointercancel clears feedback after ${completedFrames} queued frames and it cannot restart`, t => {
  const h = harness(t); h.pointer("pointerdown"); for (let i = 0; i < completedFrames; i++) h.frame();
  assert.equal(h.pointer("pointercancel").defaultPrevented, false);
  assert.equal(h.frames.size, 0); assert.equal(h.shining(), false);
  h.frame(); h.frame(); assert.equal(h.shining(), false);
});

test("a pan cancels the pending sweep without preventing native movement, while small touch jitter is tolerated", t => {
  const h = harness(t); h.pointer("pointerdown"); h.pointer("pointermove", { clientX: 104, clientY: 32 });
  assert.equal(h.frames.size, 1);
  const movement = h.pointer("pointermove", { clientX: 100, clientY: 42 });
  assert.equal(movement.defaultPrevented, false); assert.equal(h.frames.size, 0);
  h.pointer("pointerup", { clientY: 42 }); h.frame(); h.frame(); assert.equal(h.shining(), false);
});

test("dragging outside or releasing outside a button resets feedback even before a browser cancellation", t => {
  for (const event of ["pointermove", "pointerup"]) {
    const h = harness(t); h.pointer("pointerdown", { clientX: 12 }); h.frame(); h.frame(); assert.equal(h.shining(), true);
    h.pointer(event, { clientX: 8 }); assert.equal(h.shining(), false);
  }
});

test("page or nested-container scrolling cancels both pending and running feedback", t => {
  for (const target of ["window", "scroller"]) for (const running of [false, true]) {
    const h = harness(t); h.pointer("pointerdown");
    if (running) { h.frame(); h.frame(); }
    const scrollTarget = target === "window" ? h.w : h.w.document.querySelector("#scroller");
    scrollTarget.dispatchEvent(new h.w.Event("scroll")); h.frame(); h.frame();
    assert.equal(h.shining(), false); assert.equal(h.frames.size, 0);
  }
});

test("reduced motion, desktop mouse and disabled controls never start a touch sweep", t => {
  for (const options of [{ reduced: true }, { coarse: false }, { pointerType: "mouse" }, { disabled: true }, { ariaDisabled: true }, { isPrimary: false }]) {
    const h = harness(t, options); h.button.disabled = Boolean(options.disabled);
    if (options.ariaDisabled) h.button.setAttribute("aria-disabled", "true");
    h.pointer("pointerdown", options); h.frame(); h.frame();
    assert.equal(h.shining(), false); assert.equal(h.frames.size, 0);
  }
});

test("changing motion preference, disabling a queued button and leaving the window clean up feedback", t => {
  for (const action of ["reduce", "disable", "blur"]) {
    const h = harness(t); h.pointer("pointerdown"); h.frame();
    if (action === "reduce") h.media("reduced-motion", true);
    if (action === "disable") h.button.disabled = true;
    if (action === "blur") h.w.dispatchEvent(new h.w.Event("blur"));
    h.frame(); h.frame(); assert.equal(h.shining(), false); assert.equal(h.frames.size, 0);
  }
});

test("unrelated pointers do not cancel a valid tap, and a new press clears the previous sweep", t => {
  const h = harness(t); h.pointer("pointerdown"); h.pointer("pointercancel", { pointerId: 8 });
  h.frame(); h.frame(); assert.equal(h.shining(), true);
  h.pointer("pointerdown"); assert.equal(h.shining(), false);
  h.pointer("pointercancel"); h.frame(); h.frame(); assert.equal(h.shining(), false);
});
