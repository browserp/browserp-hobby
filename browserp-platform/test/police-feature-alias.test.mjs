import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { localDiscovery } from "../lib/discovery.js";

const M = globalThis.BrowseRPDiscovery;
const migrationFiles = new URL("../supabase/migrations/", import.meta.url);
const migration = suffix => readFileSync(new URL(readdirSync(migrationFiles).find(name => name.endsWith(suffix)), migrationFiles), "utf8");
const sample = (slug, tags, extra = {}) => ({ slug, name: slug, platform_id: "fivem", platform_name: "FiveM", description: "Character stories", region: "United States", language: "English", framework: "Qbox", access_type: "public", tags, ...extra });
const fixtures = [
  sample("legacy-legit", ["police", "economy"], { access_type: "allowlisted" }),
  sample("legacy-summit", ["police", "custom cars"], { framework: "QBCore" }),
  sample("canonical", ["police rp", "POLICE", "law enforcement", "POLICE_RP"]),
  sample("civilian", ["businesses", "civilian jobs"]),
  sample("frontier", ["police"], { platform_id: "redm", platform_name: "RedM" })
];

test("Police RP finds established police tags through filters, text search and legacy URLs", () => {
  for (const alias of ["police", "POLICE", "police-rp", "Police RP", "law enforcement", "leo"]) {
    const result = localDiscovery(fixtures, { platform: "fivem", feature: alias });
    assert.deepEqual(result.servers.map(row => row.slug).sort(), ["canonical", "legacy-legit", "legacy-summit"]);
    assert.equal(M.params({ platform: "fivem", feature: alias }).get("feature"), "police rp");
  }
  assert.equal(localDiscovery(fixtures, { platform: "fivem", query: "police roleplay" }).total, 3);
  assert.deepEqual(localDiscovery(fixtures, { platform: "fivem", feature: "police rp", access: "whitelisted" }).servers.map(row => row.slug), ["legacy-legit"]);
  assert.deepEqual(fixtures[0].tags, ["police", "economy"], "Matching must not rewrite reviewed metadata");
});

test("canonical Police RP popularity counts each community once even with several equivalent tags", () => {
  const facets = M.facets(fixtures, { platform: "fivem" });
  assert.deepEqual(facets.feature[0], { value: "police rp", count: 3 });
  assert.equal(facets.feature.some(row => row.value === "police"), false);
  assert.equal(M.values(fixtures[2], "feature").length, 1);
  const options = M.options("feature", facets, { platform: "fivem", feature: "all" });
  assert.deepEqual(options[0], { value: "police rp", count: 3 });
  assert.equal(options.filter(row => M.display("feature", row.value, "fivem") === "Police RP").length, 1);
  const page = localDiscovery(fixtures, { platform: "fivem", feature: "police rp", limit: 1 });
  assert.equal(page.total, 3); assert.equal(page.servers.length, 1);
  assert.equal(page.facets.feature.find(row => row.value === "police rp").count, 3);
});

test("the alias is FiveM-specific and does not invent stronger unrelated feature claims", () => {
  assert.equal(M.canonical("feature", "police", "redm"), "police");
  assert.equal(M.matches(fixtures[4], { platform: "redm", feature: "police rp" }), false);
  assert.equal(M.canonical("feature", "businesses", "fivem"), "businesses", "Businesses alone do not prove player ownership");
  // These owner-form spellings already share the established discovery meaning.
  for (const [input, value] of [["serious-roleplay", "serious rp"], ["semi-serious", "semi serious rp"], ["custom-cars", "custom cars"], ["player-businesses", "player owned businesses"]]) {
    assert.equal(M.canonical("feature", input, "fivem"), value);
  }
});

test("database Police RP membership, canonical counts and helper permissions agree with the public model", async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role; create schema private;
      create table public.platforms(id text primary key,name text,short_name text,enabled boolean);
      create table public.servers(id uuid primary key,name text,slug text,platform_id text,description text,region text,language text,framework text,access_type text,verified boolean,beginner_friendly boolean,community_url text,quality_score numeric,engagement_score numeric,theme_start text,theme_end text,created_at timestamptz,status text,age_rating text);
      create table public.server_status_snapshots(id bigint generated always as identity,server_id uuid,online boolean,players integer,capacity integer,checked_at timestamptz,provider_status text);
      create table public.server_import_sources(server_id uuid primary key,keywords text[],last_checked_at timestamptz,last_error_at timestamptz);
      create table public.minecraft_import_sources(server_id uuid primary key,keywords text[],last_checked_at timestamptz,last_error_at timestamptz);
      create table public.boosts(server_id uuid,amount integer,created_at timestamptz);
      create table public.server_tags(server_id uuid,tag text,relevance_score integer);
      insert into public.platforms values('fivem','FiveM','5M',true),('redm','RedM','RM',true),('minecraft','Minecraft','MC',false);`);
    for (const row of fixtures) {
      await db.query(`insert into public.servers values(md5($1)::uuid,$1,$1,$2,$3,$4,$5,$6,$7,false,false,'https://example.org',50,50,null,null,now(),'published','general')`, [row.slug,row.platform_id,row.description,row.region,row.language,row.framework,row.access_type]);
      for (const tag of row.tags) await db.query("insert into public.server_tags values(md5($1)::uuid,$2,50)", [row.slug,tag]);
    }
    await db.exec(`insert into public.servers select md5(n)::uuid,n,n,p,'Hidden listing','United States','English','Qbox','public',false,false,null,100,100,null,null,now(),s,a
      from (values('hidden-draft','fivem','draft','general'),('hidden-adult','fivem','published','adult'),('hidden-game','minecraft','published','general')) x(n,p,s,a);
      insert into public.server_tags select id,'police',50 from public.servers where slug like 'hidden-%';
      insert into public.server_status_snapshots(server_id,online,players,capacity,checked_at,provider_status)
        select id,true,125,150,now(),'online' from public.servers;`);
    const minecraftSQL = migration("_minecraft_reviewed_imports.sql");
    await db.exec(minecraftSQL.match(/create or replace view private\.effective_server_status[\s\S]*?revoke all on private\.effective_server_status[^;]*;/)[0]);
    for (const suffix of ["_searchable_import_keywords.sql", "_tailored_game_discovery_filters.sql", "_public_whitelisted_discovery_filters.sql"]) await db.exec(migration(suffix));
    // Exercise the current full directory projection, then current name ordering.
    await db.exec(minecraftSQL.match(/create or replace function public\.search_public_directory\([\s\S]*?\$\$;/)[0]);
    await db.exec(migration("_directory_name_relevance.sql"));
    const readTaxonomy = async () => (await db.query("select private.discovery_taxonomy() value")).rows[0].value;
    const original = await readTaxonomy();
    const functionBefore = (await db.query("select pg_get_functiondef('public.search_public_directory(jsonb)'::regprocedure) value")).rows[0].value;
    const change = migration("_canonical_police_feature_alias.sql");
    await db.exec(change);
    const updated = await readTaxonomy();
    const expected = structuredClone(original); expected.fivem.feature.police = "police rp";
    assert.deepEqual(updated, expected, "Only the reviewed FiveM alias may change");
    await db.exec(change);
    assert.deepEqual(await readTaxonomy(), updated, "Reapplication must be harmless");
    assert.equal((await db.query("select pg_get_functiondef('public.search_public_directory(jsonb)'::regprocedure) value")).rows[0].value, functionBefore, "Do not replace ranking, freshness or visibility logic");
    const query = async filters => (await db.query("select public.search_public_directory($1::jsonb) value", [JSON.stringify(filters)])).rows[0].value;
    for (const alias of ["police", "POLICE", "police-rp", "Police RP", "law enforcement", "leo"]) {
      const result = await query({ platform: "fivem", feature: alias });
      assert.equal(result.total, 3, alias);
      assert.deepEqual(result.servers.map(row => row.slug).sort(), ["canonical", "legacy-legit", "legacy-summit"]);
      assert.ok(result.servers.every(row => row.players === 125 && row.capacity === 150));
      assert.deepEqual(result.facets.feature.find(row => row.value === "police rp"), { value: "police rp", count: 3 });
      assert.equal(result.facets.feature.some(row => row.value === "police"), false);
      const sqlValue = (await db.query("select private.discovery_game_value('fivem','feature',$1) value", [alias])).rows[0].value;
      assert.equal(sqlValue, M.canonical("feature", alias, "fivem"));
    }
    const page = await query({ platform: "fivem", feature: "police rp", limit: 1 });
    assert.equal(page.servers.length, 1); assert.equal(page.total, 3);
    assert.deepEqual(page.facets.feature[0], { value: "police rp", count: 3 });
    assert.equal((await query({ platform: "fivem", query: "police roleplay" })).total, 3);
    assert.equal((await query({ platform: "fivem", feature: "police rp", access: "whitelisted" })).total, 1);
    assert.equal((await query({ platform: "redm", feature: "police rp" })).total, 0);
    assert.deepEqual((await db.query("select private.discovery_game_values('fivem','feature',null,'[\"police\",\"Police RP\",\"law enforcement\"]'::jsonb) value")).rows[0].value, ["police rp"]);
    const acl = (await db.query("select has_function_privilege('anon','private.discovery_taxonomy()','execute') allowed,prosecdef,provolatile,proparallel,proconfig from pg_proc where oid='private.discovery_taxonomy()'::regprocedure")).rows[0];
    assert.equal(acl.allowed, false); assert.equal(acl.prosecdef, false); assert.equal(acl.provolatile, "i"); assert.equal(acl.proparallel, "s"); assert.deepEqual(acl.proconfig, ['search_path=""']);
    await db.exec("set role anon"); assert.equal((await query({ platform: "fivem", feature: "police" })).total, 3);
  } finally { await db.close(); }
});
