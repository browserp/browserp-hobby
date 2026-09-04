import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";

const source = name => readFileSync(new URL(`../public/${name}`, import.meta.url), "utf8");
const settle = () => new Promise(resolve => setImmediate(resolve));
const initialTime = Date.parse("2026-09-04T12:00:00Z");
const row = (index, extra = {}) => ({
  id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
  slug: `cali-${index}`, name: `Cali community ${index}`, platform_id: "fivem", platform_name: "FiveM",
  region: "United States", language: "English", framework: "vMenu", access_type: "public",
  imported: true, online: true, players: 97, capacity: 350,
  checked_at: new Date(initialTime).toISOString(), tags: [], ...extra
});
const response = (servers, { total = servers.length, nextOffset = null } = {}) => ({
  ok: true, json: async () => ({ servers, total, nextOffset, facets: {} })
});

function harness({ url = "https://browserp.test/servers?q=cali", fetcher = () => response([row(1)]) } = {}) {
  const dom = new JSDOM('<body data-page="servers"><div id="controls"></div><p id="count"></p><div id="list"></div><div id="empty"><h3></h3><p></p></div></body>', { url, runScripts: "outside-only", pretendToBeVisual: true });
  const w = dom.window;
  let now = initialTime, hidden = false, sequence = 0, handler = fetcher;
  const timers = new Map(), requests = [], renders = [];
  w.Date.now = () => now;
  Object.defineProperty(w.document, "hidden", { configurable: true, get: () => hidden });
  Object.defineProperty(w.document, "visibilityState", { configurable: true, get: () => hidden ? "hidden" : "visible" });
  const schedule = (fn, delay, interval) => {
    const id = ++sequence;
    timers.set(id, { fn, at: now + Number(delay || 0), interval });
    return id;
  };
  w.setTimeout = (fn, delay) => schedule(fn, delay, 0);
  w.setInterval = (fn, delay) => schedule(fn, delay, Number(delay));
  w.clearTimeout = w.clearInterval = id => timers.delete(id);
  w.BrowseRPPlatforms = { theme() {} };
  w.fetch = async (path, options) => {
    const request = { path, options, params: new URL(path, w.location).searchParams };
    requests.push(request);
    return handler(request);
  };
  w.eval(source("discovery-model.js"));
  w.eval(source("smart-search.js"));
  const $ = selector => w.document.querySelector(selector);
  const api = w.BrowseRPSearch.mount({ root: $("#controls"), list: $("#list"), count: $("#count"), empty: $("#empty"), render(list, servers) {
    renders.push(servers.map(server => ({ ...server })));
    list.replaceChildren(...servers.map(server => {
      const card = w.document.createElement("a"); card.className = "server-card";
      card.href = `/server/${server.slug}`; card.textContent = server.name;
      const status = w.document.createElement("span");
      status.textContent = server.online === true && Number.isInteger(server.players) ? `${server.players} / ${server.capacity} players` : "Player count unavailable";
      card.append(status); return card;
    }));
  } });
  async function advance(milliseconds) {
    const target = now + milliseconds;
    for (;;) {
      const due = [...timers].filter(([, timer]) => timer.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      const [id, timer] = due; now = timer.at;
      if (timer.interval) timer.at += timer.interval; else timers.delete(id);
      timer.fn(); await settle();
    }
    now = target; await settle();
  }
  function visibility(value) {
    hidden = value;
    w.document.dispatchEvent(new w.Event("visibilitychange"));
  }
  return { dom, w, $, api, requests, renders, advance, visibility, now: () => now, setFetcher: value => { handler = value; }, close: () => dom.window.close() };
}

test("visible search recovers unavailable counts without another user search", async t => {
  const h = harness({ fetcher: () => response([row(1, { online: false, players: null, capacity: null })]) });
  t.after(h.close); await settle();
  assert.match(h.$("#list").textContent, /Player count unavailable/);
  h.setFetcher(() => response([row(1, { checked_at: new Date(h.now()).toISOString() })]));
  await h.advance(59_999); assert.equal(h.requests.length, 1);
  await h.advance(1);
  assert.equal(h.requests.length, 2);
  assert.match(h.$("#list").textContent, /97 \/ 350 players/);
  assert.equal(h.api.getFilters().query, "cali");
});

test("background refresh waits for visibility and never overlaps another request", async t => {
  let finish;
  const h = harness({ fetcher: () => new Promise(resolve => { finish = resolve; }) });
  t.after(h.close);
  await h.advance(60_000); assert.equal(h.requests.length, 1, "initial request is still active");
  finish(response([row(1)])); await settle();
  h.visibility(true); await h.advance(120_000);
  assert.equal(h.requests.length, 1, "hidden pages do not poll");
  h.visibility(false); await settle();
  assert.equal(h.requests.length, 2, "an overdue visible page refreshes");
  h.visibility(false); await h.advance(60_000);
  assert.equal(h.requests.length, 2, "visibility events and timer cannot overlap a refresh");
  finish(response([row(1, { checked_at: new Date(h.now()).toISOString() })])); await settle();
});

test("refresh preserves already loaded pages, selected filters and focused listing", async t => {
  const all = Array.from({ length: 60 }, (_, index) => row(index));
  const h = harness({ url: "https://browserp.test/servers?q=cali&platform=fivem&region=United+States&access=public&sort=players", fetcher: ({ params }) => {
    const offset = Number(params.get("offset") || 0), limit = Number(params.get("limit") || 24);
    return response(all.slice(offset, offset + limit), { total: all.length, nextOffset: offset + limit < all.length ? offset + limit : null });
  } });
  t.after(h.close); await settle();
  h.$(".smart-load-more").click(); await settle();
  assert.equal(h.$("#list").children.length, 48);
  const anchor = h.$('#list a[href="/server/cali-30"]'); anchor.focus();
  const previousUrl = h.w.location.href;
  await h.advance(60_000);
  assert.equal(h.$("#list").children.length, 48);
  assert.equal(new Set([...h.$("#list").querySelectorAll("a")].map(a => a.href)).size, 48);
  assert.equal(h.w.document.activeElement?.getAttribute("href"), "/server/cali-30");
  assert.equal(h.w.location.href, previousUrl);
  assert.equal(h.$("#directory-search").value, "cali");
  for (const request of h.requests.slice(2)) {
    assert.equal(request.params.get("query"), "cali");
    assert.equal(request.params.get("platform"), "fivem");
    assert.equal(request.params.get("region"), "United States");
    assert.equal(request.params.get("access"), "public");
    assert.equal(request.params.get("sort"), "players");
  }
  assert.equal(h.$(".smart-load-more").hidden, false);
});

test("a failed background refresh keeps still-valid cards and pagination", async t => {
  const h = harness({ fetcher: () => response([row(1)], { total: 25, nextOffset: 24 }) });
  t.after(h.close); await settle();
  const card = h.$("#list").firstElementChild;
  h.setFetcher(() => ({ ok: false })); await h.advance(60_000);
  assert.equal(h.$("#list").firstElementChild, card);
  assert.match(h.$("#list").textContent, /97 \/ 350 players/);
  assert.equal(h.$(".smart-load-more").hidden, false);
  assert.equal(h.$(".smart-load-more").disabled, false);
  assert.equal(h.$("#empty").hidden, true);
  assert.equal(h.$("#list").getAttribute("aria-busy"), "false");
  assert.doesNotMatch(h.$("#count").textContent, /Servers unavailable/);
});

test("repeated refresh errors never leave expired imported counts labelled live", async t => {
  const h = harness(); t.after(h.close); await settle();
  h.setFetcher(() => ({ ok: false })); await h.advance(360_000);
  assert.equal(h.$("#list").children.length, 1);
  assert.match(h.$("#list").textContent, /Player count unavailable/);
  assert.doesNotMatch(h.$("#list").textContent, /97 \/ 350/);
  const last = h.renders.at(-1)[0];
  assert.notEqual(last.online, true);
  assert.equal(last.players, null);
});

test("a late background response cannot replace a newer debounced search", async t => {
  const h = harness(); t.after(h.close); await settle();
  let finishRefresh;
  h.setFetcher(() => new Promise(resolve => { finishRefresh = resolve; }));
  await h.advance(60_000);
  const input = h.$("#directory-search"); input.value = "minecraft";
  input.dispatchEvent(new h.w.Event("input", { bubbles: true }));
  h.setFetcher(() => response([row(2, { slug: "minecraft", name: "Minecraft world" })]));
  finishRefresh(response([row(1, { players: 100 })])); await settle();
  assert.doesNotMatch(h.$("#list").textContent, /100 \/ 350/);
  await h.advance(220);
  assert.equal(h.api.getFilters().query, "minecraft");
  assert.match(h.$("#list").textContent, /Minecraft world/);
  assert.doesNotMatch(h.$("#list").textContent, /Cali community/);
});
