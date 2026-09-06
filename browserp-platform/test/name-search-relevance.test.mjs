import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { localDiscovery } from "../lib/discovery.js";
import { nameSearchRelevance } from "../lib/ranking.js";

const migrations = new URL("../supabase/migrations/", import.meta.url);
const migration = suffix => readFileSync(new URL(readdirSync(migrations).find(name => name.endsWith(suffix)), migrations), "utf8").replace(/\r\n/g, "\n");
const sample = (id, name, quality, players) => ({ id, name, slug: name.toLowerCase().replaceAll(" ", "-"),
  platform_id: "fivem", description: "Everyday roleplay with cars", region: "Europe", language: "English", framework: "vMenu",
  access_type: "public", tags: [], quality_score: quality, engagement_score: quality, uptime_percent: 100,
  boost_score: 0, players, capacity: 200, online: true, verified: false, created_at: "2026-09-01T00:00:00Z" });

test("name searches prioritize the requested community without changing explicit player sort or empty search", () => {
  const rows = [sample("1", "HighLife", 100, 150), sample("2", "Everyday Roleplay", 5, 90),
    sample("3", "Everyday", 0, 20), sample("4", "The Everyday Community", 20, 40)];
  const names = filters => localDiscovery(rows, filters).servers.map(x => x.name);
  assert.deepEqual(names({query:"EVERYDAY"}), ["Everyday", "Everyday Roleplay", "The Everyday Community", "HighLife"]);
  assert.equal(names({query:"everyday", sort:"players"})[0], "HighLife");
  assert.equal(names({query:""})[0], "HighLife");
  assert.deepEqual(names({query:"  everyday_roleplay  "}), ["Everyday Roleplay", "HighLife", "The Everyday Community", "Everyday"]);
  const page1 = localDiscovery(rows, {query:"everyday", limit:2});
  const page2 = localDiscovery(rows, {query:"everyday", limit:2, offset:2});
  assert.equal(page1.total,4); assert.equal(new Set([...page1.servers,...page2.servers].map(x=>x.id)).size,4);
});

test("database name ranking precedes pagination, preserves access/freshness/privacy, and matches local normalization", async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role; create schema private;
      create table public.platforms(id text primary key,name text,short_name text,enabled boolean);
      create table public.servers(id uuid primary key,name text,slug text,platform_id text,description text,region text,language text,framework text,access_type text,verified boolean,beginner_friendly boolean,community_url text,quality_score numeric,engagement_score numeric,theme_start text,theme_end text,created_at timestamptz,status text,age_rating text);
      create table public.server_status_snapshots(id bigint generated always as identity,server_id uuid,online boolean,players integer,capacity integer,checked_at timestamptz,provider_status text);
      create table public.server_import_sources(server_id uuid primary key,keywords text[],last_checked_at timestamptz,last_error_at timestamptz);
      create table public.boosts(server_id uuid,amount integer,created_at timestamptz);
      create table public.server_tags(server_id uuid,tag text,relevance_score integer);
      insert into public.platforms values('fivem','FiveM','5M',true),('redm','RedM','RM',false);
      insert into public.servers select md5(n)::uuid,n,lower(replace(n,' ','-')),'fivem','Everyday roleplay with cars','Europe','English','vMenu',a,false,false,'https://example.com',q,q,null,null,now(),'published','general'
        from (values('HighLife',100,'public'),('Everyday Roleplay',5,'application'),('Everyday',0,'public'),('The Everyday Community',20,'public'),('Everyday private',100,'public')) r(n,q,a);
      update public.servers set status='draft' where name='Everyday private';
      insert into public.server_status_snapshots(server_id,online,players,capacity,checked_at,provider_status)
        select id,true,case name when 'HighLife' then 150 else 90 end,200,now(),'online' from public.servers;`);
    await db.exec(migration("_fivem_imports_and_server_claims.sql").match(/create or replace view private\.effective_server_status[\s\S]*?revoke all on private\.effective_server_status[^;]*;/)[0]);
    for (const suffix of ["_searchable_import_keywords.sql", "_tailored_game_discovery_filters.sql", "_public_whitelisted_discovery_filters.sql", "_directory_name_relevance.sql"]) await db.exec(migration(suffix));
    const query = async filters => (await db.query("select public.search_public_directory($1::jsonb) as result", [JSON.stringify(filters)])).rows[0].result;
    const first = await query({query:"everyday",limit:2});
    const second = await query({query:"everyday",limit:2,offset:2});
    assert.deepEqual(first.servers.map(x=>x.name),["Everyday","Everyday Roleplay"]);
    assert.deepEqual(second.servers.map(x=>x.name),["The Everyday Community","HighLife"]);
    assert.equal(first.total,4);
    assert.equal(new Set([...first.servers,...second.servers].map(x=>x.id)).size,4);
    assert.equal((await query({query:"everyday",sort:"players"})).servers[0].name,"HighLife");
    assert.equal((await query({query:""})).servers[0].name,"HighLife");
    assert.equal((await query({query:"everyday",access:"whitelisted"})).servers[0].name,"Everyday Roleplay");
    assert.equal((await query({query:"%"})).total,0);
    assert.ok(first.servers.every(x=>x.players===90&&!Object.hasOwn(x,"mismatches")&&!Object.hasOwn(x,"owner_id")));
    assert.deepEqual(first.facets.access,[{value:"public",count:3},{value:"whitelisted",count:1}]);
    for (const [name,search] of [["Everyday Roleplay","  EVERYDAY_roleplay "],["The Everyday Community","everyday"],["HighLife","everyday"],["Everyday",""],["a_b","a-b"]]) {
      const row=(await db.query("select private.directory_name_relevance($1,$2) as score",[name,search])).rows[0];
      assert.equal(row.score,nameSearchRelevance(name,search));
    }
    assert.equal((await db.query("select has_function_privilege('anon','private.directory_name_relevance(text,text)','execute') as allowed")).rows[0].allowed,false);
    await db.exec("set role anon");assert.equal((await query({query:"everyday"})).total,4);
    await db.exec("reset role");
    await db.exec(`insert into public.servers select md5(n)::uuid,n,lower(replace(n,' ','-')),'fivem',description,'United States','English','vMenu','public',true,false,'https://example.com',q,q,null,null,now(),status,'general'
      from (values('Summit RP','Police and civilian community',10,'published'),('Legit RP','Established police community',20,'published'),
        ('Unrelated Mention','Our guide mentions SummitRP',100,'published'),('Summit PR','Different name',100,'published'),
        ('Summit RPA','Different name',100,'published'),('SummitRP','Private name fixture',100,'draft')) r(n,description,q,status);
      insert into public.server_tags(server_id,tag,relevance_score) select id,'police rp',100 from public.servers where region='United States';
      insert into public.server_status_snapshots(server_id,online,players,capacity,checked_at,provider_status)
        select id,true,case name when 'Unrelated Mention' then 150 else 80 end,200,now(),'online' from public.servers where region='United States';
      insert into public.server_import_sources(server_id,keywords) select id,array['LegitRP'] from public.servers where name='Legit RP';`);
    const before = await query({query:"SummitRP",platform:"fivem",feature:"police rp"});
    assert.deepEqual(before.servers.map(x=>x.name),["Unrelated Mention"]);
    assert.equal((await query({query:"LegitRP"})).servers[0].name,"Legit RP");
    await db.exec(migration("_joined_rp_name_search.sql"));
    const joined=await query({query:"SummitRP",platform:"fivem",feature:"police rp"}),spaced=await query({query:"Summit RP",platform:"fivem",feature:"police rp"});
    assert.deepEqual(joined.servers.map(x=>x.name),["Summit RP","Unrelated Mention"]);
    assert.equal(joined.total,2);assert.equal(spaced.total,4); // Existing separate-word searches remain broader.
    assert.deepEqual(joined.facets.feature,[{value:"police rp",count:2}]);
    assert.deepEqual(joined.facets.access,[{value:"public",count:2}]);
    assert.equal((await query({query:"SummitRP",platform:"redm",feature:"police rp"})).total,0);
    assert.equal((await query({query:"SummitRP",platform:"fivem",feature:"racing"})).total,0);
    assert.equal((await query({query:"SummitRP",region:"Europe"})).total,0);
    assert.equal((await query({query:"SummitRP",access:"whitelisted"})).total,0);
    assert.equal((await query({query:"SummitRP nonexistent"})).total,0);
    assert.ok((await query({query:"SummitRP police"})).servers.some(x=>x.name==="Summit RP"));
    assert.equal((await query({query:"SummitRP",sort:"players"})).servers[0].name,"Unrelated Mention");
    const paged1=await query({query:"SummitRP",limit:1}),paged2=await query({query:"SummitRP",limit:1,offset:1});
    assert.equal(paged1.total,2);assert.notEqual(paged1.servers[0].id,paged2.servers[0].id);
    assert.equal(joined.servers[0].players,80);assert.equal(joined.servers[0].name,"Summit RP");
    assert.ok(joined.servers.every(x=>!Object.hasOwn(x,"owner_id")&&!Object.hasOwn(x,"mismatches")));
    for(const [name,search,expected] of [["Summit RP","summitrp",true],["SummitRP","SUMMIT RP",true],["Legit-RP","LegitRP",true],
      ["Summit RP","mitrp",false],["Summit RP","SummitRPA",false],["Summit PR","SummitRP",false],["Summit Roleplay","SummitRP",false],
      ["Summit Valley RP","SummitValleyRP",false],["Other Name","SummitRP",false],["Ca RP","Carp",false],["Summit RP","%",false]]) {
      assert.equal((await db.query("select private.directory_joined_rp_match($1,$2) as matches",[name,search])).rows[0].matches,expected,`${name} / ${search}`);
    }
    assert.equal((await db.query("select private.directory_name_relevance('Summit RP','SummitRP') score")).rows[0].score,3);
    assert.equal((await db.query("select has_function_privilege('anon','private.directory_joined_rp_match(text,text)','execute') allowed")).rows[0].allowed,false);
    await db.exec("set role anon");assert.equal((await query({query:"SummitRP"})).servers[0].name,"Summit RP");
    const legacy=(await db.query("select public.search_server_directory(null,'SummitRP','fivem') servers")).rows[0].servers;
    assert.ok(legacy.some(x=>x.name==='Summit RP'));assert.ok(legacy.every(x=>x.name!=='SummitRP'));
  } finally {await db.close();}
});
