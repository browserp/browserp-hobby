import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { JSDOM } from "jsdom";
import { PGlite } from "@electric-sql/pglite";
import "../public/discovery-model.js";
const M = globalThis.BrowseRPDiscovery;
const read = file => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const sample = (slug, extra = {}) => ({ slug, name: slug, platform_id: "fivem", platform_name: "FiveM", region: "United States", framework: "vMenu", language: "English", access_type: "public", verified: true, beginner_friendly: true, online: false, tags: [], ...extra });
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
  assert.deepEqual(facets.mode, [{ value: "survival", count: 1 }, { value: "towny", count: 1 }]);
  assert.deepEqual(facets.feature, [{ value: "survival", count: 1 }]);
  assert.equal(M.matches(rows[0], { query: "QBCore custom cars" }), true);
  assert.equal(M.matches(rows[0], { query: "%" }), false);
  assert.equal(M.matches(sample("offline"), { online: true }), false);
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
  assert.match(h.$("#list").textContent, /blocks/); assert.ok([...h.$("#mode-filter").options].some(item => item.value === "towny" && !item.disabled)); assert.ok([...h.$("#mode-filter").options].some(item => item.value === "skyblock" && item.disabled));
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
  h.change("#mode-filter", "towny"); await pause(10);
  const link = new URL(h.$("#game-directory-link-v4").href);
  assert.equal(link.searchParams.get("platform"), "minecraft"); assert.equal(link.searchParams.get("mode"), "towny"); assert.equal(link.searchParams.get("region"), "Europe"); h.dom.window.close();
});

test("API failure preserves selected filters, exposes retry and clears busy state", async () => {
  let fail = true; const h = harness({ fetcher: async () => ({ ok: !fail, json: async () => payload() }) }); await pause(10);
  assert.equal(h.$("#count").textContent, "Servers unavailable"); assert.equal(h.$("#list").getAttribute("aria-busy"), "false");
  const retry = [...h.$("#empty").querySelectorAll("button")].find(item => item.textContent === "Try again"); assert.equal(retry.hidden, false); fail = false; retry.click(); await pause(10); assert.equal(h.$("#count").textContent, "3 servers"); h.dom.window.close();
});

test("database discovery counts beyond page size and excludes private, adult and disabled listings", async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role; create schema private;
      create table public.platforms(id text primary key,name text,short_name text,enabled boolean);
      create table public.servers(id uuid primary key,name text,slug text,platform_id text,description text,region text,language text,framework text,access_type text,verified boolean,beginner_friendly boolean,community_url text,quality_score numeric,engagement_score numeric,theme_start text,theme_end text,created_at timestamptz,status text,age_rating text);
      create table public.server_status_snapshots(id bigint generated always as identity,server_id uuid,online boolean,players integer,capacity integer,checked_at timestamptz,provider_status text);
      create table public.server_import_sources(server_id uuid primary key,keywords text[],last_checked_at timestamptz,last_error_at timestamptz);
      create table public.boosts(server_id uuid,amount integer,created_at timestamptz);
      create table public.server_tags(server_id uuid,tag text,relevance_score integer);
      insert into public.platforms values('fivem','FiveM','5M',true),('minecraft','Minecraft','MC',true),('redm','RedM','RM',false);
      insert into public.servers select md5(i::text)::uuid,'Community '||i,'community-'||i,'fivem','City roleplay community with custom cars and jobs','Europe','English','QBCore','public',true,true,'https://example.com',50,50,'#000000','#ffffff',now(),'published','general' from generate_series(1,125) i;
      insert into public.server_tags select id,'custom-cars',80 from public.servers;
      update public.servers set framework='QB-Core' where name like 'Community 1%';
      insert into public.server_tags select id,'CUSTOM_VEHICLES',60 from public.servers where name='Community 1';
      insert into public.servers select md5('private')::uuid,'Private','private','fivem','Private data','Europe','English','Hidden setup','public',true,true,null,50,50,null,null,now(),'draft','general';
      insert into public.servers select md5('adult')::uuid,'Adult','adult','fivem','Adult data','Europe','English','Hidden setup','public',true,true,null,50,50,null,null,now(),'published','adult';
      insert into public.servers select md5('disabled')::uuid,'Disabled','disabled','redm','Disabled game','Europe','English','Hidden setup','public',true,true,null,50,50,null,null,now(),'published','general';`);
    const migrations = readdirSync(new URL("../supabase/migrations", import.meta.url));
    const importSQL = read(`supabase/migrations/${migrations.find(name => name.endsWith("_fivem_imports_and_server_claims.sql"))}`);
    await db.exec(importSQL.match(/create or replace view private\.effective_server_status[\s\S]*?revoke all on private\.effective_server_status[^;]*;/)[0]);
    for (const suffix of ["_searchable_import_keywords.sql", "_tailored_game_discovery_filters.sql", "_public_whitelisted_discovery_filters.sql"]) await db.exec(read(`supabase/migrations/${migrations.find(name => name.endsWith(suffix))}`));
    const query = async filters => (await db.query("select public.search_public_directory($1::jsonb) as result", [JSON.stringify(filters)])).rows[0].result;
    const first = await query({ platform: "fivem", feature: "custom cars", limit: 24 });
    assert.equal(first.total, 125); assert.equal(first.servers.length, 24); assert.deepEqual(first.facets.mode, [{ value: "qbcore", count: 125 }]);
    const second = await query({ platform: "fivem", limit: 24, offset: 24 }); assert.equal(new Set([...first.servers, ...second.servers].map(row => row.id)).size, 48);
    assert.equal((await query({ query: "%" })).total, 0); assert.equal((await query({ query: "QBCore custom cars" })).total, 125);
    assert.equal((await query({ platform: "minecraft" })).total, 0);
    assert.equal((await query({ platform: "fivem", mode: "QB-Core", feature: "CUSTOM_VEHICLES" })).total, 125);
    assert.equal(first.facets.feature.find(item => item.value === "custom cars").count, 125);
    assert.equal((await query({ query: "qb core custom vehicles" })).total, 125);
    assert.ok(first.servers.every(row => !Object.hasOwn(row, "mismatches") && !Object.hasOwn(row, "owner_id")));
    const acl = (await db.query("select has_function_privilege('anon','public.search_public_directory(jsonb)','execute') as allowed")).rows[0]; assert.equal(acl.allowed, true);
    await db.exec(`insert into public.platforms values('roblox','Roblox','RB',true);
      insert into public.servers select md5('minecraft-mode')::uuid,'Block stories','block-stories','minecraft','A roleplay world','Europe','English',null,'public',false,false,null,50,50,null,null,now(),'published','general';
      insert into public.server_tags values(md5('minecraft-mode')::uuid,'Sky Block',60),(md5('minecraft-mode')::uuid,'skyblock',50),(md5('minecraft-mode')::uuid,'Java Edition',50);
      insert into public.servers select md5('roblox-mode')::uuid,'School stories','school-stories','roblox','A school roleplay experience','Europe','English',null,'public',false,false,null,50,50,null,null,now(),'published','general';
      insert into public.server_tags values(md5('roblox-mode')::uuid,'School Roleplay',60);
      insert into public.servers select md5('vmenu-mode')::uuid,'County stories','county-stories','fivem','A county roleplay community','Europe','English','vMenu','public',false,false,null,50,50,null,null,now(),'published','general';`);
    const minecraft = await query({ platform: 'minecraft', mode: 'sky_block', feature: 'java' });
    assert.equal(minecraft.total,1);assert.deepEqual(minecraft.facets.mode,[{value:'skyblock',count:1}]);
    assert.equal((await query({platform:'roblox',mode:'school rp'})).total,1);
    assert.equal((await query({platform:'minecraft',mode:'school rp'})).total,0);
    const popular = await query({platform:'fivem'});assert.deepEqual(popular.facets.mode,[{value:'qbcore',count:125},{value:'vmenu',count:1}]);
    assert.ok(popular.servers.every(row=>!Object.hasOwn(row,'mode_values')&&!Object.hasOwn(row,'feature_values')));
    await db.exec(`update public.servers set access_type='application' where slug='community-1';
      update public.servers set access_type='allowlisted',region='United States' where slug='community-2';
      update public.servers set access_type='unknown' where slug='community-3';`);
    for (const alias of ['whitelisted','allowlisted','application','whitelist','allowlist','application_required','Approval Required']) {
      const whitelist = await query({platform:'fivem',access:alias});
      assert.equal(whitelist.total,2,alias);
      assert.deepEqual(whitelist.servers.map(row=>row.access_type).sort(),['allowlisted','application']);
      const canonical = (await db.query("select private.discovery_game_value('fivem','access',$1) as value",[alias])).rows[0].value;
      assert.equal(canonical,M.canonical('access',alias),'SQL and JS must agree on '+alias);
    }
    assert.equal((await query({platform:'fivem',access:'whitelisted',region:'Europe'})).total,1);
    assert.equal((await query({platform:'minecraft',access:'whitelisted'})).total,0);
    assert.equal((await query({platform:'fivem',access:'public'})).total,123);
    const accessFacets = (await query({platform:'fivem'})).facets.access;
    assert.deepEqual(accessFacets,[{value:'public',count:123},{value:'whitelisted',count:2},{value:'unknown',count:1}]);
    assert.equal((await query({platform:'fivem',access:'unknown'})).servers[0].access_type,'unknown');
    assert.equal((await db.query("select has_function_privilege('anon','private.discovery_game_value(text,text,text)','execute') as allowed")).rows[0].allowed,false);
    await db.exec('set role anon');assert.equal((await query({platform:'fivem',mode:'QBCore'})).total,125);
  } finally { await db.close(); }
});

test("Public and Whitelisted group old joining values without reclassifying unknown or changing raw metadata", () => {
  const fixtures = [sample('open'),sample('applied',{access_type:'application'}),sample('approved',{access_type:'allowlisted'}),sample('uncertain',{access_type:'unknown'})];
  for (const alias of ['whitelisted','allowlisted','application','Whitelist','allowlist','application_required','approval-required']) {
    assert.equal(M.normalize({access:alias}).access,'whitelisted');
    assert.deepEqual(fixtures.filter(row=>M.matches(row,{access:alias})).map(row=>row.slug),['applied','approved']);
    assert.equal(M.params({access:alias}).get('access'),'whitelisted');
  }
  assert.deepEqual(fixtures.filter(row=>M.matches(row,{access:'open'})).map(row=>row.slug),['open']);
  assert.deepEqual(M.facets(fixtures,{}).access,[{value:'whitelisted',count:2},{value:'unknown',count:1},{value:'public',count:1}]);
  assert.deepEqual(fixtures.map(row=>row.access_type),['public','application','allowlisted','unknown']);
  assert.equal(M.display('access','application'),'Whitelisted');assert.equal(M.display('access','public'),'Public');
});

test("visible joining choices work on Discover and game pages, restore old URLs, and never display facet counts", async () => {
  const fixtures=[sample('open'),sample('applied',{access_type:'application'}),sample('approved',{access_type:'allowlisted'}),sample('uncertain',{access_type:'unknown'})];
  for (const fixedGame of [undefined,'fivem']) {
    const h=harness({url:`https://browserp.test/${fixedGame?'games/fivem':'servers'}?access=application`,fixedGame,fetcher:async url=>{
      const filters=Object.fromEntries(new URL(url,'https://browserp.test').searchParams);
      const servers=fixtures.filter(row=>M.matches(row,filters));
      return {ok:true,json:async()=>({servers,total:servers.length,facets:M.facets(fixtures,filters),nextOffset:null})};
    }});
    await pause(10);
    assert.equal(h.$('#access-whitelisted').checked,true);
    assert.equal(h.$('#access-filter').closest('.smart-refinements'),null);
    assert.equal(h.$('#access-filter').tagName,'FIELDSET');
    assert.equal(h.$('#access-filter').getAttribute('aria-describedby'),'access-filter-help');
    assert.equal(h.$('#list').textContent,'applied,approved');
    assert.deepEqual([...h.w.document.querySelectorAll('.smart-access-choice span')].map(x=>x.textContent),['All','Public','Whitelisted','Not confirmed']);
    h.$('#access-public').click();await pause(10);
    assert.equal(h.$('#list').textContent,'open');assert.equal(new URLSearchParams(h.w.location.search).get('access'),'public');
    h.$('#access-unknown').click();await pause(10);assert.equal(h.$('#list').textContent,'uncertain');
    h.w.history.replaceState(null,'',`${h.w.location.pathname}?access=allowlisted`);h.w.dispatchEvent(new h.w.PopStateEvent('popstate'));await pause(10);
    assert.equal(h.$('#access-whitelisted').checked,true);assert.equal(h.$('#list').textContent,'applied,approved');
    h.$('[aria-label="Remove How to join: Whitelisted"]').click();await pause(10);assert.equal(h.$('#access-all').checked,true);
    h.dom.window.close();
  }
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

function homeHarness(fetcher) {
  const dom = new JSDOM(read("public/index.html"), { url: "https://browserp.test/", runScripts: "outside-only" });
  const w = dom.window, destinations = [];
  w.BrowseRPPlatforms = { theme() {} };
  w.fetch = fetcher || (async url => ({ ok: true, json: async () => payload(Object.fromEntries(new URL(url, w.location).searchParams)) }));
  w.testNavigation = { pathname: "/", search: "", assign: url => destinations.push(new URL(url, w.location)) };
  w.eval(read("public/discovery-model.js"));
  w.eval(`((location) => { ${read("public/smart-search.js")} })(window.testNavigation);`);
  w.BrowseRPSearch.home();
  const $ = selector => w.document.querySelector(selector);
  const change = async (selector, value) => { $(selector).value = value; $(selector).dispatchEvent(new w.Event("change")); await pause(10); };
  const submit = () => $("#home-search-form").dispatchEvent(new w.Event("submit", { cancelable: true }));
  return { dom, w, $, destinations, change, submit };
}

test("homepage ordinary searches do not require a game selection", async () => {
  const h = homeHarness(); await pause(10);
  assert.equal(h.$("#home-game-filters").hidden, true);
  assert.equal(h.w.document.querySelectorAll(".game-grid-v3 [data-platform]").length, 4);
  h.$("#home-search").value = "San Andreas"; h.submit();
  assert.equal(h.destinations.at(-1).searchParams.get("q"), "San Andreas");
  assert.equal(h.destinations.at(-1).searchParams.has("platform"), false);
  h.dom.window.close();
});

test("homepage game cards reveal live, game-specific choices and clearing restores an ordinary search", async () => {
  const h = homeHarness(); await pause(10); h.$("#home-search").value = "San Andreas";
  const minecraft = h.$('.game-grid-v3 [data-platform="minecraft"]'); minecraft.focus();
  minecraft.dispatchEvent(new h.w.KeyboardEvent("keydown", { key: " ", cancelable: true })); await pause(10);
  assert.equal(h.$("#home-game-filters").hidden, false);
  assert.equal(minecraft.getAttribute("aria-pressed"), "true");
  assert.equal(h.$("#home-search").value, "San Andreas");
  assert.deepEqual([...h.$("#home-region-filter").options].map(item => item.value), ["all", "Europe"]);
  assert.equal(h.$("#home-mode-filter").parentElement.querySelector("span").textContent, "Game mode");
  assert.equal([...h.$("#home-mode-filter").options].some(item => item.value === "qbcore"), false);
  assert.equal(h.$(".home-game-filter-actions a").getAttribute("href"), "/games/minecraft");
  await h.change("#home-region-filter", "Europe"); await h.change("#home-mode-filter", "towny");
  h.$('.home-game-filter-actions [type="submit"]').click();
  const destination = h.destinations.at(-1);
  assert.equal(destination.searchParams.get("platform"), "minecraft");
  assert.equal(destination.searchParams.get("region"), "Europe");
  assert.equal(destination.searchParams.get("mode"), "towny");
  assert.equal(destination.searchParams.get("q"), "San Andreas");
  h.$(".home-game-filter-heading button").click(); await pause(10); h.submit();
  assert.equal(h.w.document.activeElement, minecraft);
  assert.equal(h.$("#home-game-filters").hidden, true);
  assert.deepEqual([...h.destinations.at(-1).searchParams], [["q", "San Andreas"]]);
  h.dom.window.close();
});

test("homepage game changes discard unrelated refinements and stale responses cannot replace current choices", async () => {
  const h = homeHarness(); await pause(10);
  h.$('.game-grid-v3 [data-platform="minecraft"]').click(); await pause(10);
  await h.change("#home-region-filter", "Europe"); await h.change("#home-mode-filter", "towny");
  const pending = []; h.w.fetch = url => new Promise(resolve => pending.push({ url, resolve }));
  h.$('.game-grid-v3 [data-platform="fivem"]').click();
  h.$('.game-grid-v3 [data-platform="redm"]').click();
  assert.equal(h.$("#home-mode-filter").value, "all"); assert.equal(h.$("#home-region-filter").value, "all");
  pending[1].resolve({ ok: true, json: async () => payload({ platform: "redm" }) }); await pause(10);
  pending[0].resolve({ ok: true, json: async () => payload({ platform: "fivem" }) }); await pause(10);
  assert.equal(h.$("#home-mode-filter").parentElement.querySelector("span").textContent, "Framework");
  assert.deepEqual([...h.$("#home-region-filter").options].map(item => item.value), ["all", "United States"]);
  assert.equal([...h.$("#home-mode-filter").options].find(item => item.value === "vorp").disabled, false);
  assert.equal([...h.$("#home-mode-filter").options].some(item => item.value === "qbcore"), false);
  h.submit(); assert.equal(h.destinations.at(-1).searchParams.get("platform"), "redm");
  assert.equal(h.destinations.at(-1).searchParams.has("mode"), false);
  h.dom.window.close();
});

test("homepage search suggestions can select a game, and searching remains available when facets fail", async () => {
  const h = homeHarness(); await pause(10);
  h.$("#home-search").value = "Mine"; h.$("#home-search").focus();
  h.$("#home-search").dispatchEvent(new h.w.KeyboardEvent("keydown", { key: "ArrowDown", cancelable: true }));
  h.$("#home-search").dispatchEvent(new h.w.KeyboardEvent("keydown", { key: "Enter", cancelable: true })); await pause(10);
  assert.equal(h.$('.game-grid-v3 [data-platform="minecraft"]').getAttribute("aria-pressed"), "true");
  assert.equal(h.$("#home-search").value, "");
  h.w.fetch = async () => ({ ok: false });
  h.$('.game-grid-v3 [data-platform="fivem"]').click(); await pause(10);
  assert.match(h.$(".home-game-filter-status").textContent, /still search/);
  assert.equal(h.$("#home-region-filter").disabled, false);
  h.$("#home-search").value = "City Life"; h.submit();
  assert.equal(h.destinations.at(-1).searchParams.get("q"), "City Life");
  assert.equal(h.destinations.at(-1).searchParams.get("platform"), "fivem");
  h.dom.window.close();
});


test("launch-game taxonomy deduplicates aliases per server and ranks real usage without showcase inflation", () => {
  const fixtures = [
    sample("qb-one", { framework: "QB-Core", tags: ["CUSTOM_VEHICLES", "custom-cars", "SeriousRoleplay"] }),
    sample("qb-two", { framework: "qbcore", tags: ["custom cars", "serious-rp"] }),
    sample("menu", { framework: "vMenu", tags: ["racing"] }), sample("excluded-demo", { showcase: true })
  ];
  const facets = M.facets(fixtures, { platform: "fivem" });
  assert.deepEqual(facets.mode, [{ value: "qbcore", count: 2 }, { value: "vmenu", count: 1 }]);
  assert.equal(facets.feature.find(item => item.value === "custom cars").count, 2);
  assert.equal(M.matches(fixtures[0], { platform: "fivem", mode: "QBCore", feature: "custom_cars" }), true);
  assert.equal(M.matches(fixtures[0], { query: "qb core custom vehicles" }), true);
  assert.equal(facets.feature.find(item => item.value === "serious rp").count, 2);
  assert.equal(M.display("access", "unknown"), "Not confirmed");
  assert.equal(M.canonical("mode", "QBX_CORE", "fivem"), "qbox");
  assert.equal(M.canonical("mode", "RedEM:RP", "redm"), "redem rp");
  assert.equal(M.matches(sample("school", { platform_id: "roblox", framework: null, tags: ["School Roleplay"] }), { platform: "roblox", mode: "school rp" }), true);
  assert.equal(M.matches(sample("sky", { platform_id: "minecraft", framework: null, tags: ["Sky Block"] }), { platform: "minecraft", mode: "skyblock" }), true);
});

test("public game controls show tailored options sorted by usage without visible count labels", async () => {
  const fixtures = [sample("qb-one", { framework: "QB-Core" }), sample("qb-two", { framework: "QBCore" }), sample("menu", { framework: "vMenu" })];
  const h = harness({ url: "https://browserp.test/servers?platform=fivem", fetcher: async () => ({ ok: true, json: async () => ({ servers: fixtures, total: fixtures.length, facets: M.facets(fixtures, { platform: "fivem" }), nextOffset: null }) }) });
  await pause(10);
  const mode = h.$("#mode-filter");
  assert.equal(mode.parentElement.querySelector("span").textContent, "Framework");
  assert.deepEqual([...mode.options].slice(1, 3).map(item => item.textContent), ["QBCore", "vMenu"]);
  assert.equal([...mode.options].find(item => item.value === "vorp"), undefined);
  assert.equal([...mode.options].find(item => item.value === "esx").disabled, true);
  assert.ok([...h.$("#controls").querySelectorAll("option,.smart-checks span")].every(item => !/\(\d+\)/.test(item.textContent)));
  assert.equal(h.$("#count").textContent, "3 servers");
  h.dom.window.close();
  for (const [game, expected, option] of [["redm", "Framework", "vorp"], ["minecraft", "Game mode", "skyblock"], ["roblox", "Experience style", "school rp"]]) {
    const page = harness({ url: `https://browserp.test/games/${game}`, fixedGame: game }); await pause(10);
    assert.equal(page.$("#mode-filter").parentElement.querySelector("span").textContent, expected);
    assert.ok([...page.$("#mode-filter").options].some(item => item.value === option));page.dom.window.close();
  }
});
