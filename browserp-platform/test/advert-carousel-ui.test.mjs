import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";

const read = file => readFileSync(new URL(`../public/${file}`, import.meta.url), "utf8");
const tick = async () => { for (let i = 0; i < 4; i += 1) await new Promise(resolve => setImmediate(resolve)); };
const artwork = ["serious-roleplay", "custom-cars", "community-stories"].map(name => `/assets/adverts/${name}.jpg`);
const adverts = artwork.map((imageUrl, i) => ({ headline: `Reviewed advert ${i + 1}`, body: `Community information ${i + 1}`, imageUrl, destinationUrl: `/servers?campaign=${i + 1}`, ctaLabel: "Explore" }));

async function harness(t, { outcomes = {}, reduced = false, decoding = false } = {}) {
  const dom = new JSDOM('<body><aside class="side-ad-v3" data-ad-placement="side" hidden></aside></body>', { url: "https://browserp.test/", runScripts: "outside-only" });
  const w = dom.window; t.after(() => w.close());
  const style = w.document.createElement("style");
  style.textContent = read("browserp-v3.css").split("\n").filter(line => /^\.side-ad-(?:stage|copy)-v3 \{/.test(line) || line.includes("artwork-unavailable") || line.startsWith(".side-ad-image-notice-v3")).join("\n");
  w.document.head.append(style);
  w.matchMedia = () => ({ matches: reduced });
  const requests = [], images = [], decodes = [], timers = new Map(); let timerId = 0;
  w.setInterval = (callback, delay) => { timers.set(++timerId, { callback, delay }); return timerId; };
  w.clearInterval = id => timers.delete(id);
  w.Image = function () {
    const image = w.document.createElement("img"); let complete = false, width = 0;
    image.finishPendingLoad = () => { complete = true; width = 800; image.dispatchEvent(new w.Event("load")); };
    if (decoding) image.decode = () => new Promise((resolve, reject) => {
      decodes.push({ image, fail() { complete = true; width = 0; reject(new w.DOMException("Image request failed", "EncodingError")); }, succeed() { complete = true; width = 800; resolve(); } });
    });
    Object.defineProperties(image, {
      complete: { get: () => complete }, naturalWidth: { get: () => width },
      src: { get: () => image.getAttribute("src") || "", set(value) {
        image.setAttribute("src", value); const outcome = outcomes[value] || "load";
        complete = outcome !== "pending"; width = ["load", "cached", "hidden"].includes(outcome) ? 800 : 0;
        if (!image.classList.contains("side-ad-image-v3")) return;
        requests.push({ image, src: value });
        if (outcome === "hidden") image.style.display = "none";
        else image.style.removeProperty("display");
        // Synchronous events ensure handlers exist before assigning the source.
        if (outcome === "error") image.dispatchEvent(new w.Event("error"));
        if (outcome === "load" || outcome === "hidden") image.dispatchEvent(new w.Event("load"));
      } }
    });
    images.push(image); return image;
  };
  let release;
  w.fetch = async path => {
    if (path.startsWith("/api/public/adverts?")) return new Promise(resolve => { release = items => resolve({ ok: true, json: async () => ({ adverts: items }) }); });
    return { ok: true, json: async () => ({ authenticated: false }) };
  };
  const root = w.document.querySelector("aside");
  const activeListeners = new Map();
  const add = root.addEventListener.bind(root), remove = root.removeEventListener.bind(root);
  root.addEventListener = (type, callback, options) => { if (!activeListeners.has(type)) activeListeners.set(type, new Set()); activeListeners.get(type).add(callback); add(type, callback, options); };
  root.removeEventListener = (type, callback, options) => { activeListeners.get(type)?.delete(callback); remove(type, callback, options); };
  w.eval(read("browserp-v3.js")); await tick();
  assert.equal(typeof release, "function");
  return { w, root, requests, images, decodes, timers, activeListeners, $: selector => root.querySelector(selector), async hydrate(items = adverts) { release(items); await tick(); } };
}

test("blocked artwork renders a compact labelled advert, does not retry failures, and recovers on a healthy slide", async t => {
  const h = await harness(t, { outcomes: { [artwork[0]]: "error" } }); await h.hydrate();
  const image = h.$("img"), firstRequests = h.requests.filter(request => request.image === image && request.src === artwork[0]).length;
  assert.equal(firstRequests, 1);
  assert.equal(h.root.hidden, false);
  assert.equal(h.root.classList.contains("artwork-unavailable"), true);
  assert.equal(h.w.getComputedStyle(h.$(".side-ad-stage-v3")).minHeight, "0px");
  assert.equal(h.w.getComputedStyle(h.$(".side-ad-copy-v3")).position, "static");
  assert.equal(h.$(".ad-label-v3").textContent, "Advertisement");
  assert.equal(h.$(".side-ad-image-notice-v3").hidden, false);
  assert.equal(h.$(".side-ad-image-notice-v3 img").getAttribute("src"), "/assets/browserp-logo-v5.png");
  assert.equal(h.$(".side-ad-image-notice-v3 img").alt, "BrowseRP");
  assert.equal(h.$(".side-ad-image-notice-v3 .visually-hidden").textContent, "Advertisement shown without artwork.");
  assert.equal(h.root.textContent.includes("Artwork unavailable"), false);
  assert.equal(h.$("[data-ad-copy] strong").textContent, "Reviewed advert 1");
  assert.equal(h.$("[data-ad-copy] a").getAttribute("href"), "/servers?campaign=1");
  assert.equal(image.classList.contains("is-changing"), false);
  const controls = h.$('.ad-controls-v3'), pause = h.$('.ad-pause-v7');
  assert.equal(controls.getAttribute('role'), 'group');
  assert.equal(controls.getAttribute('aria-label'), 'Advertisement controls');
  assert.equal(controls.firstElementChild, h.$('.ad-dots-v3'));
  assert.equal(controls.lastElementChild, pause);
  pause.click(); assert.equal(pause.textContent, 'Resume rotation'); assert.equal(pause.getAttribute('aria-pressed'), 'true');
  pause.click(); assert.equal(pause.textContent, 'Pause rotation'); assert.equal(pause.getAttribute('aria-pressed'), 'false');
  h.$('[data-ad-direction="next"]').click();
  assert.equal(h.root.classList.contains("artwork-unavailable"), false);
  assert.equal(h.w.getComputedStyle(h.$(".side-ad-stage-v3")).minHeight, "570px");
  assert.equal(h.$(".side-ad-image-notice-v3").hidden, true);
  assert.equal(image.getAttribute("src"), artwork[1]);
  assert.equal(h.$("[data-ad-copy] strong").textContent, "Reviewed advert 2");
  h.$('[data-ad-direction="previous"]').click();
  assert.equal(h.root.classList.contains("artwork-unavailable"), true);
  assert.equal(h.requests.filter(request => request.image === image && request.src === artwork[0]).length, firstRequests);
  assert.ok(h.requests.every(request => artwork.includes(request.src)), "No alternate paths or hosts bypass artwork blocking");
});

test("house advert wording describes the four current launch games", async t => {
  const h = await harness(t);
  assert.equal(h.$("[data-ad-copy] span").textContent, "Compare FiveM, RedM, Roblox and Minecraft communities in one place.");
  assert.equal(h.root.textContent.includes("racing and simulation"), false);
  await h.hydrate();
});

test("the fallback uses the existing wordmark only when needed and remains usable if branding is blocked too", async t => {
  const h = await harness(t, { outcomes: { [artwork[1]]: "error" } }); await h.hydrate();
  const brand = h.$(".side-ad-image-notice-v3 img");
  assert.equal(brand.hasAttribute("src"), false, "Healthy artwork does not request an extra fallback image");
  h.$('[data-ad-direction="next"]').click();
  const source = brand.getAttribute("src");
  assert.equal(source, "/assets/browserp-logo-v5.png");
  brand.dispatchEvent(new h.w.Event("error"));
  assert.equal(brand.hidden, true, "A blocked wordmark cannot leave a second broken image");
  h.$('[data-ad-direction="previous"]').click();
  h.$('[data-ad-direction="next"]').click();
  assert.equal(brand.hidden, true);
  assert.equal(brand.getAttribute("src"), source);
  assert.equal(h.$(".ad-label-v3").textContent, "Advertisement");
  assert.equal(h.$("[data-ad-copy] strong").textContent, "Reviewed advert 2");
  assert.equal(h.$("[data-ad-copy] a").getAttribute("href"), "/servers?campaign=2");
});

test("reviewed advert links are sponsored while house links retain their ordinary relationship", async t => {
  const h = await harness(t);
  assert.equal(h.$("[data-ad-copy] a").relList.contains("sponsored"), false);
  await h.hydrate([{ ...adverts[0], destinationUrl: "https://community.example/join" }, adverts[1]]);
  assert.equal(h.$("[data-ad-copy] a").rel, "sponsored noopener noreferrer");
  h.$('[data-ad-direction="next"]').click();
  assert.equal(h.$("[data-ad-copy] a").rel, "sponsored");
});

test("already-cached images complete without a load event and cosmetic image blocking keeps the compact fallback", async t => {
  const h = await harness(t, { outcomes: { [artwork[0]]: "cached", [artwork[1]]: "hidden" } }); await h.hydrate();
  assert.equal(h.root.classList.contains("artwork-unavailable"), false);
  assert.equal(h.$("img").classList.contains("is-changing"), false);
  h.$('[data-ad-direction="next"]').click();
  assert.equal(h.$("img").naturalWidth, 800);
  assert.equal(h.w.getComputedStyle(h.$("img")).display, "none", "The carousel respects external hiding styles");
  assert.equal(h.root.classList.contains("artwork-unavailable"), true);
  assert.equal(h.$("[data-ad-copy] strong").textContent, "Reviewed advert 2");
  h.$('[data-ad-direction="next"]').click();
  assert.equal(h.root.classList.contains("artwork-unavailable"), false);
});

test("an image that fails without an error event uses the labelled fallback and never retries its address", async t => {
  const h = await harness(t, { decoding: true, outcomes: { [artwork[0]]: "pending" } }); await h.hydrate();
  const image = h.$("img");
  h.decodes.findLast(item => item.image === image).fail(); await tick();
  assert.equal(image.complete, true); assert.equal(image.naturalWidth, 0);
  assert.equal(h.root.classList.contains("artwork-unavailable"), true);
  assert.equal(h.$(".side-ad-image-notice-v3").hidden, false);
  assert.equal(h.$("[data-ad-copy] strong").textContent, "Reviewed advert 1");
  const requests = h.requests.length;
  h.$('[data-ad-direction="next"]').click();
  assert.equal(h.root.classList.contains("artwork-unavailable"), false);
  h.$('[data-ad-direction="previous"]').click();
  assert.equal(h.root.classList.contains("artwork-unavailable"), true);
  assert.equal(h.requests.length, requests + 1, "Only the healthy next slide starts a new request");
});

test("late image decoding cannot change a newer slide or a replacement carousel", async t => {
  const h = await harness(t, { decoding: true, outcomes: { [artwork[0]]: "pending" } });
  const houseDecode = h.decodes.at(-1); await h.hydrate();
  houseDecode.fail(); await tick();
  assert.equal(h.root.classList.contains("artwork-unavailable"), false);
  const currentDecode = h.decodes.at(-1);
  h.$('[data-ad-direction="next"]').click(); currentDecode.fail(); await tick();
  assert.equal(h.root.classList.contains("artwork-unavailable"), false);
  assert.equal(h.$(".side-ad-image-notice-v3").hidden, true);
  assert.equal(h.$("[data-ad-copy] strong").textContent, "Reviewed advert 2");
});

test("a late load from another slide cannot reveal old artwork over a failed current slide", async t => {
  const h = await harness(t, { outcomes: { [artwork[0]]: "error", [artwork[1]]: "pending" } }); await h.hydrate();
  h.$('[data-ad-direction="next"]').click();
  h.$('[data-ad-direction="previous"]').click();
  h.$("img").finishPendingLoad();
  assert.equal(h.$("[data-ad-copy] strong").textContent, "Reviewed advert 1");
  assert.equal(h.root.classList.contains("artwork-unavailable"), true);
  assert.equal(h.$(".side-ad-image-notice-v3").hidden, false);
});

test("replacing the initial house carousel removes old keyboard, focus, hover and image handlers", async t => {
  const h = await harness(t); const previousImage = h.$("img");
  assert.equal(h.timers.size, 1); await h.hydrate();
  for (const type of ["keydown", "mouseenter", "mouseleave", "focusin", "focusout"]) assert.equal(h.activeListeners.get(type).size, 1, type);
  assert.equal(previousImage.onload, null); assert.equal(previousImage.onerror, null);
  assert.equal(h.timers.size, 1);
  const before = h.requests.length;
  const key = new h.w.KeyboardEvent("keydown", { key: "ArrowRight", cancelable: true }); h.root.dispatchEvent(key);
  assert.equal(key.defaultPrevented, true);
  assert.equal(h.requests.length, before + 1, "One key must not also load a slide in the detached carousel");
  assert.equal(h.requests.at(-1).image, h.$("img"));
  assert.equal(h.$("[data-ad-copy] strong").textContent, "Reviewed advert 2");
  assert.equal(h.$(".ad-dots-v3").children[1].getAttribute("aria-current"), "true");
  h.root.dispatchEvent(new h.w.Event("mouseenter")); assert.equal(h.timers.size, 0);
  h.root.dispatchEvent(new h.w.Event("mouseleave")); assert.equal(h.timers.size, 1);
  h.root.dispatchEvent(new h.w.Event("focusin")); assert.equal(h.timers.size, 0);
  h.root._browserpAdvertCleanup(); h.root.dispatchEvent(new h.w.Event("focusout"));
  assert.equal(h.timers.size, 0);
  for (const listeners of h.activeListeners.values()) assert.equal(listeners.size, 0);
});

test("reduced motion keeps failed-image adverts manually navigable without an autoplay timer", async t => {
  const h = await harness(t, { reduced: true, outcomes: Object.fromEntries(artwork.map(src => [src, "error"])) }); await h.hydrate();
  assert.equal(h.timers.size, 0);
  h.$(".ad-dots-v3").children[2].click();
  assert.equal(h.$("[data-ad-copy] strong").textContent, "Reviewed advert 3");
  assert.equal(h.root.classList.contains("artwork-unavailable"), true);
  assert.equal(h.timers.size, 0);
  assert.equal(h.$(".ad-label-v3").textContent, "Advertisement");
});
