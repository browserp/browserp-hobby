// Runs migrated RPCs in disposable PostgreSQL; no hosted data or network access.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import test from "node:test";
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
        insert into public.permissions values('reports.read','Read reports');insert into public.staff_role_permissions values('reviewer','reports.read');
        insert into public.staff_memberships(user_id,role_key,reason) values('${member}','reviewer','Fixture approved reviewer');
        insert into private.discord_owner_allowlist values('111111111111111111',true,'reviewer');`);
      await login(); assert.equal(await call("has_staff_permission('reports.read')"), true);
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
