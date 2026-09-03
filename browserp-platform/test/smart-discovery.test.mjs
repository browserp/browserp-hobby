import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { JSDOM } from "jsdom";
import { PGlite } from "@electric-sql/pglite";
import "../public/discovery-model.js";
const M = globalThis.BrowseRPDiscovery;
const read = file => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const sample = (slug, extra = {}) => ({ ...M.showcase, slug, name: slug, showcase: false, ...extra });
const rows = [sample("city", { framework: "QBCore", region: "Europe", online: true, tags: ["custom-cars", "economy"] }), sample("blocks", { platform_id: "minecraft", platform_name: "Minecraft", framework: "Towny", region: "Europe", tags: ["survival"] }), sample("frontier", { platform_id: "redm", platform_name: "RedM", framework: "VORP", region: "United States", tags: ["economy"] })];
function payload(filters = {}) {
  const matches = rows.filter(row => M.matches(row, filters));
  return { servers: matches, total: matches.length, facets: M.facets(rows, filters), nextOffset: null };
}
function harness({ url = "https://browserp.test/servers", fetcher, fixedGame } = {}) {
  const dom = new JSDOM('<body data-page="servers"><div id="controls"></div><p id="count"></p><div id="list"></div><div id="empty"><h3></h3><p></p></div><a id="game-directory-link-v4"></a></body>', { url, runScripts: "outside-only" });
  const w = dom.window; const requests = [];
  w.BrowseRPPlatforms = { theme() {} };
  w.fetch = async (url, options) => { requests.push({ url, options }); return fetcher ? fetcher(url, options) : { ok: true, json: async () => payload(M.normalize(Object.fromEntries(new URL(url, "https://browserp.test").searchParams))) }; };
  w.eval(read("public/discovery-model.js")); w.eval(read("public/smart-search.js"));
  const $ = selector => w.document.querySelector(selector);
  const api = w.BrowseRPSearch.mount({ root: $("#controls"), list: $("#list"), count: $("#count"), empty: $("#empty"), fixedGame, render: (list, servers) => { list.textContent = servers.map(server => server.slug).join(","); } });
  const change = (selector, value) => { const control = $(selector); if (control.type === "checkbox") control.checked = value; else control.value = value; control.dispatchEvent(new w.Event(control.type === "search" ? "input" : "change", { bubbles: true })); };
  return { dom, w, $, requests, api, change };
}

test("full dataset facets follow game and region, and literal multiword search normalizes feature names", () => {
  const facets = M.facets(rows, { platform: "minecraft", region: "Europe" });
  assert.deepEqual(facets.mode, [{ value: "Towny", count: 1 }]);
  assert.deepEqual(facets.feature, [{ value: "survival", count: 1 }]);
  assert.equal(M.matches(rows[0], { query: "QBCore custom cars" }), true);
  assert.equal(M.matches(rows[0], { query: "%" }), false);
  assert.equal(M.matches(M.showcase, { online: true }), false);
  const state = M.normalize({ platform: "forza", sort: "invalid", region: "Unknown", offset: -20 });
  assert.equal(state.platform, "all"); assert.equal(state.sort, "recommended"); assert.equal(state.region, "Unknown"); assert.equal(state.offset, 0);
});

test("game suggestions apply structured filters, keyboard selection keeps focus, regions update", async () => {
  const h = harness(); await pause(10);
  const search = h.$("#directory-search"); search.focus(); h.change("#directory-search", "Mine");
  search.dispatchEvent(new h.w.KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
  assert.equal(h.w.document.activeElement, search);
  assert.ok(search.getAttribute("aria-activedescendant"));
  search.dispatchEvent(new h.w.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  await pause(20);
  assert.equal(h.api.getFilters().platform, "minecraft"); assert.equal(search.value, "");
  assert.match(h.$("#list").textContent, /blocks/); assert.equal(h.$("#mode-filter").options.length, 2);
  assert.equal(h.$("#region-filter").options[1].value, "Europe");
  assert.match(h.w.location.search, /platform=minecraft/); assert.doesNotMatch(h.w.location.search, /q=/);
  search.focus(); search.dispatchEvent(new h.w.Event("focus")); search.dispatchEvent(new h.w.KeyboardEvent("keydown", { key: "Escape" })); assert.equal(search.getAttribute("aria-expanded"), "false");
  h.dom.window.close();
});

test("older requests cannot replace a newer selection, including while input is debounced", async () => {
  const pending = []; const h = harness({ fetcher: () => new Promise(resolve => pending.push(resolve)) });
  h.change("#directory-search", "blocks");
  pending[0]({ ok: true, json: async () => payload() }); await pause(20);
  assert.equal(h.$("#list").textContent, "");
  await pause(240); pending[1]({ ok: true, json: async () => payload({ query: "blocks" }) }); await pause(10);
  assert.equal(h.$("#list").textContent, "blocks"); h.dom.window.close();
});

test("unknown selected regions remain visible and removable; back navigation restores state", async () => {
  const h = harness({ url: "https://browserp.test/servers?platform=redm&region=Unknown&verified=true" }); await pause(10);
  assert.equal(h.$("#region-filter").value, "Unknown"); assert.equal(h.$("#empty").hidden, false);
  h.$('[aria-label="Remove Region: Unknown"]').click(); await pause(10);
  assert.equal(h.$("#region-filter").value, "all");
  h.w.history.replaceState(null, "", "/servers?platform=minecraft&region=Europe"); h.w.dispatchEvent(new h.w.PopStateEvent("popstate")); await pause(10);
  assert.equal(h.$("#platform-filter").value, "minecraft"); assert.equal(h.$("#list").textContent, "blocks"); h.dom.window.close();
});

test("game pages lock the game and carry refinements into the full directory", async () => {
  const h = harness({ url: "https://browserp.test/games/minecraft?region=Europe", fixedGame: "minecraft" }); await pause(10);
  assert.equal(h.$("#platform-filter").parentElement.hidden, true);
  h.change("#mode-filter", "Towny"); await pause(10);
  const link = new URL(h.$("#game-directory-link-v4").href);
  assert.equal(link.searchParams.get("platform"), "minecraft"); assert.equal(link.searchParams.get("mode"), "Towny"); assert.equal(link.searchParams.get("region"), "Europe"); h.dom.window.close();
});

test("API failure preserves selected filters, exposes retry and clears busy state", async () => {
  let fail = true; const h = harness({ fetcher: async () => ({ ok: !fail, json: async () => payload() }) }); await pause(10);
  assert.equal(h.$("#count").textContent, "Servers unavailable"); assert.equal(h.$("#list").getAttribute("aria-busy"), "false");
  const retry = [...h.$("#empty").querySelectorAll("button")].find(item => item.textContent === "Try again"); assert.equal(retry.hidden, false); fail = false; retry.click(); await pause(10); assert.equal(h.$("#count").textContent, "3 servers"); h.dom.window.close();
});

test("database discovery counts beyond page size and excludes private, adult and disabled listings", async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated;
      create table public.platforms(id text primary key,name text,short_name text,enabled boolean);
      create table public.servers(id uuid primary key,name text,slug text,platform_id text,description text,region text,language text,framework text,access_type text,verified boolean,beginner_friendly boolean,community_url text,quality_score numeric,engagement_score numeric,theme_start text,theme_end text,created_at timestamptz,status text,age_rating text);
      create table public.server_status_snapshots(server_id uuid,online boolean,players integer,capacity integer,checked_at timestamptz);
      create table public.boosts(server_id uuid,amount integer,created_at timestamptz);
      create table public.server_tags(server_id uuid,tag text,relevance_score integer);
      insert into public.platforms values('fivem','FiveM','5M',true),('minecraft','Minecraft','MC',true),('redm','RedM','RM',false);
      insert into public.servers select md5(i::text)::uuid,'Community '||i,'community-'||i,'fivem','City roleplay community with custom cars and jobs','Europe','English','QBCore','public',true,true,'https://example.com',50,50,'#000000','#ffffff',now(),'published','general' from generate_series(1,125) i;
      insert into public.server_tags select id,'custom-cars',80 from public.servers;
      insert into public.servers select md5('private')::uuid,'Private','private','fivem','Private data','Europe','English','Hidden setup','public',true,true,null,50,50,null,null,now(),'draft','general';
      insert into public.servers select md5('adult')::uuid,'Adult','adult','fivem','Adult data','Europe','English','Hidden setup','public',true,true,null,50,50,null,null,now(),'published','adult';
      insert into public.servers select md5('disabled')::uuid,'Disabled','disabled','redm','Disabled game','Europe','English','Hidden setup','public',true,true,null,50,50,null,null,now(),'published','general';`);
    const migration = readdirSync(new URL("../supabase/migrations", import.meta.url)).find(name => name.endsWith("_smart_public_directory.sql"));
    await db.exec(read(`supabase/migrations/${migration}`));
    const query = async filters => (await db.query("select public.search_public_directory($1::jsonb) as result", [JSON.stringify(filters)])).rows[0].result;
    const first = await query({ platform: "fivem", feature: "custom cars", limit: 24 });
    assert.equal(first.total, 125); assert.equal(first.servers.length, 24); assert.deepEqual(first.facets.mode, [{ value: "QBCore", count: 125 }]);
    const second = await query({ platform: "fivem", limit: 24, offset: 24 }); assert.equal(new Set([...first.servers, ...second.servers].map(row => row.id)).size, 48);
    assert.equal((await query({ query: "%" })).total, 0); assert.equal((await query({ query: "QBCore custom cars" })).total, 125);
    assert.equal((await query({ platform: "minecraft" })).total, 0);
    assert.ok(first.servers.every(row => !Object.hasOwn(row, "mismatches") && !Object.hasOwn(row, "owner_id")));
    const acl = (await db.query("select has_function_privilege('anon','public.search_public_directory(jsonb)','execute') as allowed")).rows[0]; assert.equal(acl.allowed, true);
  } finally { await db.close(); }
});

test("typing spaces preserves ordinary multiword searches and first ArrowUp selects the last choice", async () => {
  const h = harness(); await pause(10); const input = h.$("#directory-search"); input.focus();
  for (const character of "San Andreas") { input.value += character; input.dispatchEvent(new h.w.Event("input", { bubbles: true })); }
  assert.equal(input.value, "San Andreas"); assert.equal(new URLSearchParams(h.w.location.search).get("q"), "San Andreas");
  h.change("#directory-search", "");
  input.dispatchEvent(new h.w.KeyboardEvent("keydown", { key: "ArrowUp", cancelable: true }));
  const list = h.$("#directory-search-suggestions"); assert.equal(input.getAttribute("aria-activedescendant"), list.lastChild.id); h.dom.window.close();
});

test("retrying a failed second page keeps the first page and prevents duplicate cards", async () => {
  let call = 0; const h = harness({ fetcher: async () => { call++; return { ok: call !== 2, json: async () => ({ servers: [sample(call === 1 ? "first" : "second")], total: 25, facets: {}, nextOffset: call === 1 ? 24 : null }) }; } });
  await pause(10); h.$(".smart-load-more").click(); await pause(10);
  [...h.$("#empty").querySelectorAll("button")].find(item => item.textContent === "Try again").click(); await pause(10);
  assert.equal(h.$("#list").textContent, "first,second"); h.dom.window.close();
});

test("homepage game and region selectors share live facets and upcoming games stay absent", async () => {
  const dom = new JSDOM('<body data-page="home"><form id="home-search-form"><input id="home-search" type="search"></form></body>', { url: "https://browserp.test/", runScripts: "outside-only" });
  const w = dom.window; w.BrowseRPPlatforms = { theme() {} }; w.fetch = async url => ({ ok: true, json: async () => payload(Object.fromEntries(new URL(url, w.location).searchParams)) });
  w.eval(read("public/discovery-model.js")); w.eval(read("public/smart-search.js")); w.BrowseRPSearch.home(); await pause(10);
  const [game, region] = w.document.querySelectorAll("select"); assert.equal(game.options.length, 5);
  game.value = "minecraft"; game.dispatchEvent(new w.Event("change")); await pause(10);
  assert.deepEqual([...region.options].map(item => item.value), ["all", "Europe"]);
  dom.window.close();
});
