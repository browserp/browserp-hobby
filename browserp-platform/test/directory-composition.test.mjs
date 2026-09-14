import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";

const read = name => readFileSync(new URL(`../public/${name}`, import.meta.url), "utf8");
const tick = async () => { for (let i = 0; i < 8; i++) await new Promise(resolve => setImmediate(resolve)); };
const server = i => ({ slug: `community-${i}`, name: `Community ${i}`, platform_id: "fivem", description: "A community for roleplay.", region: "Not confirmed", language: "English", framework: "Unknown", access_type: "application", tags: ["economy", "jobs", "cars"], online: false });

async function harness(t, { realSearch = false, deferInitial = false, prerendered = false } = {}) {
  const dom = new JSDOM(read("servers.html"), { url: "https://browserp.test/servers", runScripts: "outside-only", pretendToBeVisual: true });
  t.after(() => dom.window.close());
  const w = dom.window;
  if (prerendered) {
    const list = w.document.getElementById("server-list");
    const card = w.document.createElement("a"); card.className = "server-card"; card.href = "/server/already-rendered"; card.textContent = "Already rendered community";
    list.replaceChildren(card); list.dataset.publicRendered = "true";
  }
  let rows = Array.from({ length: 8 }, (_, i) => server(i)), fail = false;
  let releaseInitial;
  w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  w.IntersectionObserver = class { observe() {} unobserve() {} disconnect() {} };
  w.fetch = async url => {
    if (url.startsWith("/api/servers?")) {
      if (deferInitial) await new Promise(resolve => { releaseInitial = resolve; });
      return { ok: !fail, json: async () => ({ servers: rows, total: rows.length, facets: {}, nextOffset: null }) };
    }
    if (url.startsWith("/api/public/adverts?")) return { ok: true, json: async () => ({ adverts: [1, 2, 3].map(i => ({ headline: `Advert ${i}`, body: "Sponsored community information", imageUrl: `/assets/adverts/${i}.jpg`, destinationUrl: `/servers?campaign=${i}`, ctaLabel: "Explore" })) }) };
    return { ok: true, json: async () => ({ authenticated: false }) };
  };
  for (const file of ["browserp-platforms.js", "discovery-model.js", "directory-controls.js", "server-compare.js", "server-shortlist.js"]) w.eval(read(file));
  if (realSearch) w.eval(read("smart-search.js"));
  else w.BrowseRPSearch = { mount() {} };
  w.eval(read("browserp-directory.js")); w.eval(read("browserp-v3.js")); await tick();
  return { w, doc: w.document, list: w.document.getElementById("server-list"), ad: w.document.getElementById("directory-advert"), setRows(value) { rows = value; }, setFail(value) { fail = value; }, release() { deferInitial = false; releaseInitial(); } };
}

test("static first-load skeletons precede requests and clear for success, empty or error without replacing SSR", async t => {
  const initial = new JSDOM(read("servers.html"));
  assert.equal(initial.window.document.querySelectorAll(".directory-initial-skeleton").length, 3);
  assert.ok(initial.window.document.querySelector("[data-directory-loading-controls]"));
  assert.equal(initial.window.document.querySelector(".directory-initial-skeleton a, .directory-initial-skeleton button, .directory-initial-skeleton input"), null);
  initial.window.close();
  for (const outcome of ["success", "empty", "error", "ssr-error"]) {
    const h = await harness(t, { realSearch: true, deferInitial: true, prerendered: outcome === "ssr-error" });
    assert.equal(h.doc.querySelector("[data-directory-loading-controls]"), null);
    assert.equal(h.list.querySelectorAll(".directory-initial-skeleton").length, outcome === "ssr-error" ? 0 : 3);
    assert.ok(h.doc.getElementById("sort-filter").closest(".result-bar-v3"));
    if (outcome === "empty") h.setRows([]);
    if (outcome.endsWith("error")) h.setFail(true);
    h.release(); await tick();
    assert.equal(h.list.getAttribute("aria-busy"), "false");
    if (outcome === "success") {
      assert.equal(h.list.querySelectorAll(".directory-initial-skeleton").length, 0);
      assert.equal(h.list.querySelectorAll(".server-card").length, 8);
    } else if (outcome === "ssr-error") {
      assert.match(h.list.textContent, /Already rendered community/);
      assert.equal(h.list.hidden, false);
    } else {
      assert.equal(h.list.hidden, true);
      assert.equal(h.doc.getElementById("directory-empty").hidden, false);
    }
  }
});

test("inline advert survives redraws, pagination and empty results without losing controls, creative or pause state", async t => {
  const h = await harness(t);
  const draw = rows => h.w.BrowseRPDirectory.render(h.list, rows);
  const pause = h.ad.querySelector(".ad-pause-v7"), next = h.ad.querySelector('[data-ad-direction="next"]');
  assert.ok(pause); next.click(); pause.click(); pause.focus();
  const creative = h.ad.querySelector("[data-ad-copy]").textContent;
  const cleanup = h.ad._browserpAdvertCleanup;
  for (const n of [8, 24, 48, 3, 0, 7]) {
    draw(Array.from({ length: n }, (_, i) => server(i)));
    assert.equal(h.doc.querySelectorAll("#directory-advert").length, 1);
    assert.equal(h.ad.isConnected, true);
    assert.equal(h.list.children[Math.min(n, 6)], h.ad);
    assert.equal(h.list.querySelectorAll(".server-card").length, n);
    assert.equal(h.ad.querySelector(".ad-pause-v7"), pause);
    assert.equal(pause.getAttribute("aria-pressed"), "true");
    assert.equal(h.doc.activeElement, pause);
    assert.equal(h.ad.querySelector("[data-ad-copy]").textContent, creative);
    assert.equal(h.ad._browserpAdvertCleanup, cleanup);
  }
  next.click(); assert.notEqual(h.ad.querySelector("[data-ad-copy]").textContent, creative);
  assert.equal(pause.getAttribute("aria-pressed"), "true");
  const card = h.list.querySelector(".server-card");
  assert.doesNotMatch(card.querySelector(".server-meta").textContent, /Not confirmed|Unknown/);
  assert.match(card.textContent, /Application required/);
  assert.match(card.textContent, /Status unavailable/);
  assert.match(card.textContent, /Player count unavailable/);
  assert.equal(h.list.querySelectorAll(".server-shortlist-actions").length, 7);
  assert.equal(card.querySelector("button"), null, "Save/Compare stay outside the listing link");
});

test("visible sort/filter count and real empty/error/retry transitions retain the same inline carousel", async t => {
  const h = await harness(t, { realSearch: true });
  const sort = h.doc.getElementById("sort-filter"), panel = h.doc.getElementById("directory-filter-panel");
  assert.ok(sort.closest(".result-bar-v3")); assert.equal(panel.contains(sort), false);
  assert.equal(h.doc.getElementById("result-count").textContent, "8 servers");
  const pause = h.ad.querySelector(".ad-pause-v7"); pause.click();
  h.setRows([]);
  h.w.history.replaceState(null, "", "/servers?region=Europe&sort=newest"); h.w.dispatchEvent(new h.w.PopStateEvent("popstate")); await tick();
  assert.equal(h.list.hidden, true); assert.equal(h.doc.getElementById("directory-empty").hidden, false);
  assert.equal(h.doc.querySelector(".smart-filter-toggle").textContent, "Filters (1)");
  assert.equal(sort.value, "newest"); assert.equal(h.ad.querySelector(".ad-pause-v7"), pause);
  h.setFail(true); h.w.dispatchEvent(new h.w.PopStateEvent("popstate")); await tick();
  assert.equal(h.doc.getElementById("result-count").textContent, "Servers unavailable");
  assert.equal(h.list.hidden, true);
  h.setFail(false); h.setRows([server(1), server(2)]);
  [...h.doc.querySelectorAll("#directory-empty button")].find(button => button.textContent === "Try again").click(); await tick();
  assert.equal(h.list.hidden, false); assert.equal(h.list.children[2], h.ad);
  assert.equal(pause.getAttribute("aria-pressed"), "true");
  assert.equal(h.doc.getElementById("result-count").textContent, "2 servers");
});
