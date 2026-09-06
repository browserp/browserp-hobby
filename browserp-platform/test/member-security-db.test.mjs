// Runs migrated RPCs in disposable PostgreSQL; no hosted data or network access.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import test from "node:test";
import developersApi from "../api/developers.js";
import resourcesApi from "../api/resources.js";
const { PGlite } = await import(process.env.PGLITE_MODULE ? pathToFileURL(process.env.PGLITE_MODULE).href : "@electric-sql/pglite");
const db = new PGlite();
const read = file => readFileSync(new URL(`../supabase/migrations/${file}`, import.meta.url), "utf8");
const core = read("202608180001_browserp_core.sql"), ops = read("20260819192413_platform_operations_and_trust.sql"), profile = read("20260820023114_profile_avatar_immediate_name_filter.sql"), claims = read("20260904002113_fivem_imports_and_server_claims.sql");
const member = "00000000-0000-4000-8000-000000000001", other = "00000000-0000-4000-8000-000000000002";
const sid = "aaaaaaaa-0000-4000-8000-000000000001", otherSid = "bbbbbbbb-0000-4000-8000-000000000002";
const server = "00000000-0000-4000-8000-000000000101", asset = "00000000-0000-4000-8000-000000000201";
const secondServer = "00000000-0000-4000-8000-000000000102";
const avatarUrl = `https://kywabzfgjoqiznnxygbq.supabase.co/storage/v1/object/public/profile-media/${member}/fixture.png`;
const fn = (source, name) => source.match(new RegExp(`create or replace function ${name.replaceAll(".", "\\.")}\\([\\s\\S]*?\\n\\$\\$;`))[0];
const table = (source, name) => source.match(new RegExp(`create table (?:if not exists )?public\\.${name} \\([\\s\\S]*?\\n\\);`))[0];
async function admin(sql) { await db.exec("reset role"); return db.exec(sql); }
async function login(id = member, session = sid) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)", [id || "", JSON.stringify({ sub: id, session_id: session, app_metadata: { provider: "discord" }, aal: "aal2", amr: [{ method: "oauth" }, { method: "totp" }] })]);
  await db.exec("set role authenticated");
}
const call = async (expression, args = []) => (await db.query(`select public.${expression} value`, args)).rows[0].value;
const writes = () => [
  ["grant_daily_boost($1)", [server]],
  ["mark_notifications_read()", []],
  ["member_server_claim($1,$2,null,$3)", [server, "I own this fixture community and can provide ownership evidence.", crypto.randomUUID()]],
  ["member_server_interaction($1,'comment',$2,null)", [server, "A helpful fixture comment."]],
  ["member_set_profile_avatar($1,$2)", [avatarUrl, asset]],
  ["member_update_profile('Fixture member','A useful member biography.','public')", []],
  ["toggle_favorite($1)", [server]]
];
const privateTables = ["profiles", "reports", "bans", "ban_appeals", "uploaded_assets", "server_endpoints", "account_trust", "favorites", "notifications", "staff_memberships", "promotion_orders", "promotion_credit_ledger", "boosts", "ad_campaigns", "applications", "server_submissions"];
const reads = ["daily_boost_balance()", "promotion_credit_balance()", "member_favorite_ids()", "member_dashboard_overview()", "member_server_claims()"];

test("member RPCs enforce session, account-ban, ownership and rate boundaries in PostgreSQL", async t => {
  try {
    await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create schema private;create schema extensions;
      revoke all on schema private from public;
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
      create function extensions.gen_random_uuid() returns uuid language sql as $$select pg_catalog.gen_random_uuid()$$;
      create table auth.users(id uuid primary key,deleted_at timestamptz,is_anonymous boolean default false);
      create table auth.sessions(id uuid primary key,user_id uuid not null);
      create table auth.identities(user_id uuid,provider text,provider_id text,identity_data jsonb default '{}');
    `);
    for (const statement of core.matchAll(/create table public\.\w+ \([\s\S]*?\n\);/g)) await db.exec(statement[0]);
    for (const name of ["security_bans", "server_votes", "server_comments"]) await db.exec(table(ops, name));
    await db.exec(table(claims, "server_claim_requests"));
    await db.exec(`alter table public.servers alter column owner_id drop not null;
      alter table public.servers add access_type text default 'public',add cfx_join_url text,add animated_media_enabled boolean default false;
      alter table public.profiles add avatar_review_status text default 'not_set',add approved_avatar_url text,add bio_review_status text default 'pending_review',add approved_bio text default '';
      create table public.staff_permission_overrides(user_id uuid,permission_key text,allowed boolean);
      create table private.discord_owner_allowlist(discord_user_id text,enabled boolean,role_key text);
      create table private.platform_security_settings(singleton boolean,staff_mfa_required boolean);
      insert into private.platform_security_settings values(true,true);
      insert into auth.users(id) values('${member}'),('${other}');
      insert into auth.sessions values('${sid}','${member}'),('${otherSid}','${other}');
      insert into public.profiles(id,username,display_name) values('${member}','fixture_member','Fixture member'),('${other}','fixture_other','Other member');
      insert into auth.identities(user_id,provider,provider_id) values('${member}','discord','111111111111111111');
      insert into public.platforms(id,name,short_name) values('fivem','FiveM','FiveM');
      insert into public.servers(id,platform_id,name,slug,description,status,region,language) values('${server}','fivem','Fixture community','fixture-community','A useful fixture community description for this security regression.','published','Europe','English');
      insert into public.servers(id,platform_id,name,slug,description,status,region,language) values('${secondServer}','fivem','Second fixture community','second-fixture-community','Another useful community description for the account-wide rate regression.','published','Europe','English');
      insert into public.uploaded_assets(id,owner_id,bucket,object_path,media_type,mime_type,byte_size,sha256) values('${asset}','${member}','profile-media','${member}/fixture.png','avatar','image/png',100,'fixture');
      insert into public.notifications(user_id,kind,title,body) values('${member}','fixture','Fixture notification','A notification for the current member'),('${other}','fixture','Other notification','Keep this unread');
    `);
    await db.exec(fn(core, "public.consume_rate_limit"));
    await db.exec("revoke all on function public.consume_rate_limit(text,text,integer,integer) from public,anon,authenticated");
    await db.exec(fn(profile, "private.profile_display_name_allowed"));
    await db.exec(fn(profile, "private.queue_profile_review"));
    await db.exec("create trigger profile_review before insert or update on public.profiles for each row execute function private.queue_profile_review()");
    await db.exec(fn(claims, "private.server_claim_json"));
    await db.exec(fn(ops, "public.public_server_engagement"));
    // This is the direct-RPC bypass that triggered the member migration.
    await db.exec(fn(ops, "public.member_server_interaction"));
    await login();
    await admin(`delete from auth.sessions where id='${sid}'`); await login();
    assert.equal((await call("member_server_interaction($1,'vote')", [server])).voted, true, "baseline permits a revoked token to write directly");
    await admin(`insert into auth.sessions values('${sid}','${member}')`);
    await db.exec(read("20260904091734_enforce_staff_session_revocation.sql"));
    await db.exec(read("20260904092528_enforce_member_security_boundaries.sql"));
    await db.exec("alter table auth.sessions add column not_after timestamptz");
    await db.exec(read("20260905195616_enforce_auth_session_expiry.sql"));

    // Mirror the confirmed hosted grants and exact old RLS policies. The
    // migration must protect these tables without relying on empty fixtures.
    const publicTables = ["developer_profiles", "resources", "platforms"];
    await db.exec("grant usage on schema auth to anon,authenticated; alter role service_role bypassrls");
    for (const name of [...privateTables, ...publicTables]) {
      await db.exec(`grant ${privateTables.includes(name) ? "all" : "select"} on public.${name} to anon,authenticated,service_role; alter table public.${name} enable row level security`);
      for (const policy of core.matchAll(new RegExp(`create policy [^;]+ on public\\.${name} for select [^;]+;`, "g"))) await db.exec(policy[0]);
    }
    await db.exec("grant select(bio),update(bio) on public.profiles to authenticated;grant select(review_note) on public.server_submissions to anon");
    // Favorites originally had a broad ALL policy, replaced by this read-only one.
    await db.exec("create policy favorites_self_read on public.favorites for select to authenticated using(user_id=(select auth.uid()))");
    for (const name of ["developer_directory", "resource_directory"]) {
      await db.exec(core.match(new RegExp(`create or replace view public\\.${name}[\\s\\S]*?;`))[0]);
      await db.exec(`grant select on public.${name} to anon,authenticated,service_role`);
    }
    await db.exec(`update public.profiles set profile_visibility='private',bio='Private draft biography that must not be public.' where id='${member}';
      update public.profiles set avatar_url='https://example.test/unreviewed.png',bio='A pending biography that must not leak.' where id='${other}';
      update public.profiles set avatar_review_status='pending_review',approved_avatar_url='https://example.test/old-approved.png' where id='${other}';
      insert into public.developer_profiles(user_id,headline,about,status,verified) values
        ('${member}','Private fixture developer','A private developer biography with enough descriptive text.','published',true),
        ('${other}','Public fixture developer','A public developer biography with enough descriptive text.','published',false);
      insert into public.platforms(id,name,short_name,enabled) values('fixture-disabled','Disabled platform','Disabled',false);
      insert into public.resources(author_id,platform_id,title,slug,summary,body_markdown,resource_type,status,published_at) values
        ('${member}','fivem','Hidden-author resource','hidden-author-resource','A public item whose author chose a private profile.','A detailed resource document for the isolated privacy fixture.','guide','published',now()),
        ('${other}','fivem','Public fixture resource','public-fixture-resource','A useful public resource summary for this fixture.','A detailed resource document for the isolated privacy fixture.','guide','published',now()),
        ('${other}','fixture-disabled','Disabled-platform resource','disabled-platform-resource','This item must not expose disabled platform information.','A detailed resource document for the isolated privacy fixture.','guide','published',now()-interval '1 day'),
        ('${other}','fivem','Unpublished fixture resource','unpublished-fixture-resource','This draft must never appear in the public directory.','A detailed resource document for the isolated privacy fixture.','guide','draft',null);
    `);
    const viewColumns = (await db.query("select table_name,column_name,data_type,ordinal_position from information_schema.columns where table_schema='public' and table_name in('developer_directory','resource_directory') order by table_name,ordinal_position")).rows;
    await t.test("the old grants reproduce stale private profile and unreviewed public-avatar reads", async () => {
      await admin(`delete from auth.sessions where id='${sid}'`); await login();
      assert.match((await db.query("select bio from public.profiles where id=$1",[member])).rows[0].bio,/Private draft/);
      await assert.rejects(call("member_dashboard_overview()"),/active, unrestricted/);
      await login(null,null);await db.exec("reset role;set role anon");
      assert.equal((await db.query("select avatar_url from public.developer_directory")).rows[0].avatar_url,"https://example.test/unreviewed.png");
      await admin(`insert into auth.sessions(id,user_id) values('${sid}','${member}')`);
    });
    await admin(read("20260906012500_restrict_private_record_reads.sql"));

    await t.test("ownership retries use the same claim, reject changed evidence and remain bound to a live member session", async () => {
      const key = crypto.randomUUID();
      const args = [server, "I own this community and can provide its hosting records.", "https://example.test/ownership", key];
      await login();
      const first = await call("member_server_claim($1,$2,$3,$4)", args);
      assert.equal((await call("member_server_claim($1,$2,$3,$4)", args)).id, first.id);
      for (const replacement of [[secondServer, ...args.slice(1)], [server, "Different ownership evidence that must not replace the request.", ...args.slice(2)], [server, args[1], "https://example.test/different", key]]) {
        await assert.rejects(call("member_server_claim($1,$2,$3,$4)", replacement), /request identifier was already used/);
      }
      await login(other, otherSid);
      const second = await call("member_server_claim($1,$2,$3,$4)", args);
      assert.notEqual(second.id, first.id, "another member cannot receive the original member's replay");
      await admin(`delete from auth.sessions where id='${sid}'`); await login();
      await assert.rejects(call("member_server_claim($1,$2,$3,$4)", args), /active, unrestricted/);
      await admin(`insert into auth.sessions(id,user_id) values('${sid}','${member}')`);
      assert.equal((await db.query("select count(*)::int n from public.server_claim_requests where request_id=$1", [key])).rows[0].n, 2);
      await db.query("delete from public.server_claim_requests where request_id=$1", [key]);
    });

    await t.test("all sixteen raw-table privileges are denied to guests and valid or stale members while service reads survive", async () => {
      for (const role of ["anon", "authenticated"]) {
        await login();await db.exec(`reset role;set role ${role}`);
        for (const name of privateTables) await assert.rejects(db.query(`select * from public.${name} limit 0`),/permission denied/,`${role}:${name}`);
      }
      await admin(`delete from auth.sessions where id='${sid}'`);await login();
      for (const name of privateTables) await assert.rejects(db.query(`select * from public.${name} limit 0`),/permission denied/,name);
      await assert.rejects(call("member_dashboard_overview()"),/active, unrestricted/);
      await assert.rejects(db.query("update public.profiles set bio='forged' where id=$1",[member]),/permission denied/);
      await assert.rejects(db.query("select review_note from public.server_submissions"),/permission denied/);
      await admin(`insert into auth.sessions(id,user_id) values('${sid}','${member}')`);
      await db.exec("set role service_role");
      for (const name of privateTables) await db.query(`select * from public.${name} limit 0`);
      await admin("");
      const grants=(await db.query("select n,has_table_privilege('anon','public.'||n,'SELECT') a,has_any_column_privilege('anon','public.'||n,'SELECT') ac,has_table_privilege('authenticated','public.'||n,'SELECT') m,has_any_column_privilege('authenticated','public.'||n,'SELECT') mc,has_table_privilege('authenticated','public.'||n,'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') mw,has_table_privilege('service_role','public.'||n,'SELECT') s from unnest($1::text[]) n",[privateTables])).rows;
      assert.equal(grants.length,16);for(const grant of grants)assert.deepEqual([grant.a,grant.ac,grant.m,grant.mc,grant.mw,grant.s],[false,false,false,false,false,true],grant.n);
    });
    await t.test("unchanged public views return only published public-profile fields and approved artwork",async()=>{
      await login(null,null);await db.exec("reset role;set role anon");
      const devs=(await db.query("select * from public.developer_directory order by verified desc,created_at desc limit 50")).rows;
      assert.equal(devs.length,1);assert.equal(devs[0].id,other);assert.equal(devs[0].avatar_url,null);
      assert.deepEqual(Object.keys(devs[0]),["id","display_name","username","avatar_url","headline","specialties","portfolio_url","verified","created_at"]);
      assert.ok(!JSON.stringify(devs).includes("biography"));
      const resources=(await db.query("select * from public.resource_directory order by published_at desc limit 50")).rows;
      assert.equal(resources.length,2);assert.equal(resources[0].title,"Public fixture resource");assert.equal(resources[1].platform_name,null);
      assert.deepEqual(Object.keys(resources[0]),["id","title","slug","summary","resource_type","downloads","published_at","platform_name","author_name"]);
      for (const name of ["developer_directory","resource_directory"]) await assert.rejects(db.query(`delete from public.${name}`),/permission denied|cannot delete from view/);
      await admin(`update public.profiles set avatar_review_status='approved',approved_avatar_url='https://example.test/approved.png' where id='${other}'`);
      await login(null,null);await db.exec("reset role;set role anon");
      assert.equal((await db.query("select avatar_url from public.developer_directory")).rows[0].avatar_url,"https://example.test/approved.png");
      await admin("");
      assert.deepEqual((await db.query("select table_name,column_name,data_type,ordinal_position from information_schema.columns where table_schema='public' and table_name in('developer_directory','resource_directory') order by table_name,ordinal_position")).rows,viewColumns);
      const options=(await db.query("select relname,reloptions from pg_class where oid in('public.developer_directory'::regclass,'public.resource_directory'::regclass)")).rows;
      for(const row of options){assert.ok(row.reloptions.includes("security_invoker=false"));assert.ok(row.reloptions.includes("security_barrier=true"));}
      const viewWrites=(await db.query("select bool_or(has_table_privilege(role,view,'INSERT,UPDATE,DELETE')) allowed from unnest(array['anon','authenticated']) role cross join unnest(array['public.developer_directory','public.resource_directory']) view")).rows[0];assert.equal(viewWrites.allowed,false);
    });
    await t.test("public projection never widens for a signed-in owner and caller predicates cannot inspect hidden rows",async()=>{
      await admin(`create function public.fixture_visibility_probe(value text) returns boolean language plpgsql volatile cost 0.00001 as $$begin if value='Fixture member' then raise exception 'Hidden profile leaked';end if;return true;end;$$;`);
      await login();
      assert.deepEqual((await db.query("select id from public.developer_directory where public.fixture_visibility_probe(display_name)")).rows.map(x=>x.id),[other]);
      assert.equal((await db.query("select title from public.resource_directory where public.fixture_visibility_probe(author_name)")).rows.length,2);
      await admin(`update public.profiles set profile_visibility='members' where id='${other}'`);await login();
      assert.equal((await db.query("select * from public.developer_directory")).rows.length,0);assert.equal((await db.query("select * from public.resource_directory")).rows.length,0);
      await admin(`update public.profiles set profile_visibility='public' where id='${other}';update public.developer_profiles set status='suspended' where user_id='${other}'`);await login();
      assert.equal((await db.query("select * from public.developer_directory")).rows.length,0);
      await admin(`update public.developer_profiles set status='published' where user_id='${other}'`);
    });
    await t.test("existing API handlers read the new projections with their original URL, array shape and cache contract",async()=>{
      const before=Object.fromEntries(["SUPABASE_URL","SUPABASE_PUBLISHABLE_KEY","NODE_ENV","VERCEL"].map(k=>[k,process.env[k]]));const originalFetch=globalThis.fetch;
      Object.assign(process.env,{SUPABASE_URL:"https://fixture.supabase.co",SUPABASE_PUBLISHABLE_KEY:"sb_publishable_fixture",NODE_ENV:"production",VERCEL:"0"});
      globalThis.fetch=async(value,options)=>{
        const url=new URL(value);assert.equal(options.headers.apikey,"sb_publishable_fixture");assert.equal(options.headers.Authorization,undefined);
        const name=url.pathname.split('/').at(-1);assert.ok(["developer_directory","resource_directory"].includes(name));
        assert.equal(url.searchParams.get("select"),"*");assert.equal(url.searchParams.get("limit"),"50");
        const order=name==="developer_directory"?"verified.desc,created_at.desc":"published_at.desc";assert.equal(url.searchParams.get("order"),order);
        await login(null,null);await db.exec("reset role;set role anon");
        const rows=(await db.query(`select * from public.${name} order by ${name==="developer_directory"?"verified desc,created_at desc":"published_at desc"} limit 50`)).rows;
        return new Response(JSON.stringify(rows),{status:200,headers:{"content-type":"application/json"}});
      };
      try{
        for(const [handler,key] of [[developersApi,"developers"],[resourcesApi,"resources"]]){
          const headers=new Map();const result={setHeader:(k,v)=>headers.set(k,v),getHeader:k=>headers.get(k),end(body){this.body=JSON.parse(body);}};
          await handler({method:"GET",headers:{}},result);assert.equal(result.statusCode,200);assert.ok(Array.isArray(result.body[key]));assert.equal(result.body[key].length,key==="developers"?1:2);
          assert.match(headers.get("Cache-Control"),/public/);assert.doesNotMatch(JSON.stringify(result.body),/Private draft|pending biography|unreviewed.png/);
        }
      }finally{globalThis.fetch=originalFetch;for(const [key,value]of Object.entries(before))value===undefined?delete process.env[key]:process.env[key]=value;await admin("");}
    });

    await t.test("all seven legitimate member mutation workflows still succeed", async () => {
      await login();
      for (const [expression, args] of writes()) assert.notEqual(await call(expression, args), null, expression);
      assert.equal((await call("member_server_interaction($1,'report',$2,'spam')", [server, "A detailed fixture report for staff to review."])).status, "open");
      for (const expression of reads) assert.notEqual(await call(expression), null, expression);
      await admin("");
      assert.equal((await db.query("select read_at from public.notifications where user_id=$1", [other])).rows[0].read_at, null);
      assert.equal((await db.query("select status from public.server_comments limit 1")).rows[0].status, "pending_review");
      assert.equal((await db.query("select bio_review_status from public.profiles where id=$1", [member])).rows[0].bio_review_status, "pending_review");
    });
    await t.test("a revoked token cannot call any member mutation or private read", async () => {
      await admin(`delete from auth.sessions where id='${sid}'`); await login();
      for (const [expression, args] of writes()) await assert.rejects(call(expression, args), /active, unrestricted sign-in/);
      for (const expression of reads) await assert.rejects(call(expression), /active, unrestricted sign-in/);
      await admin(`insert into auth.sessions values('${sid}','${member}')`);
    });
    await t.test("an active account ban also denies a newly issued valid session", async () => {
      await admin(`insert into public.security_bans(user_id,target_type,target_hash,public_reference,reason_code,reason,actor_id)
        values('${member}','account',repeat('a',64),'BRP-1234567890','fixture','A confirmed account restriction','${other}')`);
      await login();
      for (const [expression, args] of writes()) await assert.rejects(call(expression, args), /active, unrestricted sign-in/);
      for (const expression of reads) await assert.rejects(call(expression), /active, unrestricted sign-in/);
      await admin("update public.security_bans set revoked_at=now()"); await login();
      assert.equal(await call("mark_notifications_read()"), 0);
    });
    await t.test("expired and future account bans preserve legitimate access", async () => {
      for (const schedule of ["starts_at=now()-interval '2 days',ends_at=now()-interval '1 day'", "starts_at=now()+interval '1 day',ends_at=null"]) {
        await admin(`update public.security_bans set revoked_at=null,${schedule}`); await login();
        assert.equal(await call("mark_notifications_read()"), 0);
      }
      await admin("update public.security_bans set revoked_at=now()");
    });
    await t.test("another user's session, deleted users and anonymous Auth identities cannot mutate", async () => {
      await login(member, otherSid); await assert.rejects(call("mark_notifications_read()"), /active, unrestricted sign-in/);
      for (const change of ["deleted_at=now()", "deleted_at=null,is_anonymous=true"]) {
        await admin(`update auth.users set ${change} where id='${member}'`); await login();
        await assert.rejects(call("mark_notifications_read()"), /active, unrestricted sign-in/);
      }
      await admin(`update auth.users set deleted_at=null,is_anonymous=false where id='${member}'`);
    });
    await t.test("direct comment/report spam hits the account-wide DB limit across server IDs", async () => {
      await admin("delete from public.rate_limit_buckets"); await login();
      for (let i = 0; i < 20; i++) await call("member_server_interaction($1,'report',$2,'spam')", [i % 2 ? secondServer : server, `Fixture moderation report number ${i} with details.`]);
      await assert.rejects(call("member_server_interaction($1,'comment','Another fixture comment')", [server]), error => error.code === "PT429");
      await login(other, otherSid); assert.equal((await call("member_server_interaction($1,'comment','A separate member comment')", [server])).status, "pending_review");
      await admin("update public.rate_limit_buckets set window_started_at=now()-interval '6 minutes'"); await login();
      assert.equal((await call("member_server_interaction($1,'comment','Allowed after the time window')", [server])).status, "pending_review");
    });
    await t.test("member RPCs cannot reuse another account's media or change private rate counters", async () => {
      await login(other, otherSid);
      await assert.rejects(call("member_set_profile_avatar($1,$2)", [avatarUrl, asset]), /Invalid profile-media upload/);
      await assert.rejects(db.query("select private.require_active_member()"), /permission denied/);
      await assert.rejects(call("consume_rate_limit('forged','member-db:server-interaction',1000,1)"), /permission denied/);
    });
    await t.test("staff accounts cannot recover authority while account-banned", async () => {
      await admin(`insert into public.staff_roles values('reviewer','Reviewer','Fixture review role',50,false);
        insert into public.permissions values('reports.read','Read reports'),('profiles.review','Review profiles');insert into public.staff_role_permissions values('reviewer','reports.read'),('reviewer','profiles.review');
        insert into public.staff_memberships(user_id,role_key,reason) values('${member}','reviewer','Fixture approved reviewer');
        insert into private.discord_owner_allowlist values('111111111111111111',true,'reviewer');`);
      await db.exec(fn(ops, "public.staff_profile_review_queue"));
      await db.exec("revoke all on function public.staff_profile_review_queue() from public,anon,authenticated,service_role;grant execute on function public.staff_profile_review_queue() to authenticated");
      await login(); assert.equal(await call("has_staff_permission('reports.read')"), true);
      assert.ok((await call("staff_profile_review_queue()")).some(p=>p.userId===member));
      await assert.rejects(db.query("select * from public.profiles"),/permission denied/);
      await db.query("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:member,session_id:sid,app_metadata:{provider:"discord"},aal:"aal1",amr:[{method:"oauth"}]})]);
      assert.equal(await call("staff_profile_review_queue()"),null);
      await admin(`delete from auth.sessions where id='${sid}'`);await login();assert.equal(await call("staff_profile_review_queue()"),null);
      await admin(`insert into auth.sessions(id,user_id) values('${sid}','${member}')`);await login();
      await admin("update public.security_bans set revoked_at=null,starts_at=now()-interval '1 minute',ends_at=null"); await login();
      assert.equal(await call("has_staff_permission('reports.read')"), false); assert.equal(await call("staff_mfa_enrollment_allowed()"), false);
    });
    await t.test("anonymous published reads remain available but private helpers and mutations do not", async () => {
      await login(null, null); await db.exec("reset role;set role anon");
      assert.equal((await call("public_server_engagement('fixture-community')")).serverId, server);
      assert.equal(await call("has_staff_permission('reports.read')"), false);
      for (const [expression, args] of writes()) await assert.rejects(call(expression, args), /permission denied/);
      await assert.rejects(db.query("select private.require_active_member()"), /permission denied/);
      await assert.rejects(call("consume_rate_limit('forged','member-db:server-interaction',1000,1)"), /permission denied/);
    });
  } finally { await db.close(); }
});
