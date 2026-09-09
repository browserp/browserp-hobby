import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";

test("hero movement pauses offscreen, in hidden pages and for reduced motion, then resumes without duplicate artwork", t => {
  const dom = new JSDOM('<div class="home-hero-pattern" aria-hidden="true"></div>', { url: "https://browserp.test/", runScripts: "outside-only" });
  const w = dom.window, pattern = w.document.querySelector(".home-hero-pattern");
  t.after(() => w.close());
  let hidden = false, intersect, resized, disconnected = 0;
  Object.defineProperty(w.document, "hidden", { get: () => hidden });
  pattern.getBoundingClientRect = () => ({ width: 1440, height: 420, top: 0, bottom: 420 });
  const reduced = new w.EventTarget(); reduced.matches = false;
  w.matchMedia = () => reduced;
  w.IntersectionObserver = class { constructor(callback) { intersect = callback; } observe() {} disconnect() { disconnected++; } };
  w.ResizeObserver = class { constructor(callback) { resized = callback; } observe() {} disconnect() { disconnected++; } };
  // Keep unrelated account/advert requests outside this lifecycle check.
  w.fetch = () => new Promise(() => {});
  w.eval(readFileSync(new URL("../public/browserp-v3.js", import.meta.url), "utf8"));
  const rows = pattern.querySelectorAll(".home-hero-wordmark-row").length;
  assert.ok(rows > 0);
  const plane = pattern.querySelector(".home-hero-wordmarks");
  const waveDuration = parseFloat(plane.style.getPropertyValue("--wave-duration"));
  assert.ok(waveDuration > 10 && waveDuration < 17, "the visible wave returns at the calmer pace without waiting through overscan");
  assert.ok(Number(plane.style.getPropertyValue("--wave-start")) > 0, "the wave starts at visible rows, inside the overscan");
  assert.deepEqual([...plane.children].map(row => Number(row.style.getPropertyValue("--wave-index"))), Array.from({ length: rows }, (_, index) => index));
  assert.equal(pattern.getAttribute("aria-hidden"), "true");
  assert.equal(pattern.dataset.motion, "running");
  intersect([{ isIntersecting: false }]);
  assert.equal(pattern.dataset.motion, "paused");
  hidden = true; intersect([{ isIntersecting: true }]);
  assert.equal(pattern.dataset.motion, "paused");
  hidden = false; w.document.dispatchEvent(new w.Event("visibilitychange"));
  assert.equal(pattern.dataset.motion, "running");
  reduced.matches = true; reduced.dispatchEvent(new w.Event("change"));
  assert.equal(pattern.dataset.motion, "paused");
  reduced.matches = false; reduced.dispatchEvent(new w.Event("change"));
  assert.equal(pattern.dataset.motion, "running");
  w.dispatchEvent(new w.Event("pagehide"));
  w.document.dispatchEvent(new w.Event("visibilitychange"));
  assert.equal(pattern.dataset.motion, "paused");
  w.dispatchEvent(new w.Event("pageshow"));
  resized();
  assert.equal(pattern.dataset.motion, "running");
  assert.equal(pattern.querySelectorAll(".home-hero-wordmarks").length, 1);
  assert.equal(pattern.querySelectorAll(".home-hero-wordmark-row").length, rows);
  pattern.remove();
  w.BrowseRPWordmarks.mount();
  assert.equal(disconnected, 2, "Replacing account content releases both observers");
  assert.equal(pattern.dataset.motion, "paused");
  const replacement = w.document.createElement("div");
  replacement.className = "home-hero-pattern";
  replacement.getBoundingClientRect = pattern.getBoundingClientRect;
  w.document.body.append(replacement);
  w.BrowseRPWordmarks.mount();
  assert.equal(replacement.querySelectorAll(".home-hero-wordmarks").length, 1);
  assert.equal(replacement.dataset.motion, "running");
});

test("selected public introductions share one inert pattern while forms and staff pages stay undecorated", t => {
  for (const page of ["index", "servers", "game", "about", "advertise", "blog", "blog-post"]) {
    const dom = new JSDOM(readFileSync(new URL(`../public/${page}.html`, import.meta.url), "utf8"));
    t.after(() => dom.window.close());
    const d = dom.window.document;
    assert.equal(d.querySelectorAll('link[href^="/wordmark-pattern.css"]').length, 1, page);
    const patterns = d.querySelectorAll(".home-hero-pattern");
    assert.equal(patterns.length, 1, page);
    assert.equal(patterns[0].getAttribute("aria-hidden"), "true");
    assert.ok(patterns[0].parentElement.matches("[data-wordmark-surface]"));
    assert.equal(patterns[0].querySelectorAll("a,button,input,form").length, 0);
  }
  for (const page of ["profile", "list-server", "staffpanel"]) {
    const source = readFileSync(new URL(`../public/${page}.html`, import.meta.url), "utf8");
    assert.ok(!source.includes("wordmark-pattern.css") && !source.includes("home-hero-pattern"), page);
  }
});
