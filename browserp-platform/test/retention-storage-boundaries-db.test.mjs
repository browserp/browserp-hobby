// Disposable PostgreSQL regression: no hosted data, accounts, or Storage objects.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import test from "node:test";
const { PGlite } = await import(process.env.PGLITE_MODULE ? pathToFileURL(process.env.PGLITE_MODULE).href : "@electric-sql/pglite");
const read = name => readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), "utf8");
const core = read("202608180001_browserp_core.sql");
const retention = read("20260819214000_profile_retention_security.sql");
const migration = read("20260905192015_review_inactive_accounts_and_close_unused_uploads.sql");
const table = (source, name) => source.match(new RegExp(`create table (?:if not exists )?public\\.${name} \\([\\s\\S]*?\\n\\);`))[0];
const owner = "00000000-0000-4000-8000-000000000001";
const staff = "00000000-0000-4000-8000-000000000002";
const recent = "00000000-0000-4000-8000-000000000003";
const warning = "00000000-0000-4000-8000-000000000004";
const server = "00000000-0000-4000-8000-000000000101";
const ban = "00000000-0000-4000-8000-000000000201";

test("inactivity remains a review process and unused direct uploads are closed", async t => {
  const db = new PGlite();
  const run = async () => (await db.query("select private.run_account_retention() as result")).rows[0].result;
  async function login(id = owner, role = "authenticated") {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [id]);
    await db.exec(`set role ${role}`);
  }
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create schema private; create schema extensions; create schema storage;
      revoke all on schema private from public;
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      create function extensions.gen_random_uuid() returns uuid language sql as $$select pg_catalog.gen_random_uuid()$$;
      create function public.has_staff_permission(text) returns boolean language sql as $$select false$$;
      create function storage.foldername(text) returns text[] language sql immutable as $$select string_to_array($1,'/')$$;
      create table auth.users(id uuid primary key,created_at timestamptz not null,last_sign_in_at timestamptz,deleted_at timestamptz,is_anonymous boolean default false);
      create table auth.sessions(id uuid primary key,user_id uuid references auth.users(id) on delete cascade);
      create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
      create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text references storage.buckets(id),name text,unique(bucket_id,name));
      alter table storage.objects enable row level security;
      grant usage on schema auth,storage to anon,authenticated,service_role;
      grant select,insert on storage.objects to anon,authenticated,service_role;
      grant select on storage.buckets to anon,authenticated,service_role;
    `);
    for (const name of ["platforms", "profiles", "staff_roles", "staff_memberships", "servers", "bans", "ban_appeals", "notifications", "uploaded_assets"]) await db.exec(table(core, name));
    await db.exec(table(retention, "account_retention_flags"));
    await db.exec(`
      create table public.account_activity(user_id uuid,created_at timestamptz,metadata jsonb default '{}');
      create table public.promotion_orders(user_id uuid);
      create table public.promotion_credit_ledger(user_id uuid);
      create table public.payment_attempts(user_id uuid);
      insert into auth.users(id,created_at) values
        ('${owner}',now()-interval '90 days'),('${staff}',now()-interval '100 days'),
        ('${recent}',now()-interval '2 days'),('${warning}',now()-interval '50 days');
      insert into public.profiles(id,username,display_name) values
        ('${owner}','fixture_owner','Fixture owner'),('${staff}','fixture_staff','Fixture staff'),
        ('${recent}','fixture_recent','Recent member'),('${warning}','fixture_warning','Absent member');
      insert into auth.sessions values('aaaaaaaa-0000-4000-8000-000000000001','${owner}');
      insert into public.staff_roles values('owner','Owner','Fixture owner',100,true);
      insert into public.staff_memberships(user_id,role_key,reason) values('${staff}','owner','Fixture active staff');
      insert into public.platforms(id,name,short_name) values('fivem','FiveM','FiveM');
      insert into public.servers(id,owner_id,platform_id,name,slug,description,region,language,status)
      values('${server}','${owner}','fivem','Fixture community','fixture-community','A real owner relationship for the inactivity regression.','Europe','English','published');
      insert into public.bans(id,user_id,actor_id,scope,reason_code,reason)
      values('${ban}','${owner}','${staff}','account','fixture','A fixture restriction with an unresolved appeal.');
      insert into public.ban_appeals(ban_id,appellant_id,statement,status)
      values('${ban}','${owner}','This fixture appeal is still being reviewed and must never disappear because its account was inactive.','under_review');
      insert into public.account_activity(user_id,created_at,metadata) values('${owner}',now()-interval '90 days','{"fixture":true}');
      insert into public.notifications(user_id,kind,title,body) values('${warning}','account_retention','Your BrowseRP account is inactive','Sign in before the date shown in your account to keep your profile and community posts.');
      insert into public.account_retention_flags(user_id,status,last_active_at,due_at)
      values('${warning}','warning',now()-interval '50 days',now()+interval '10 days');
    `);
    await db.exec(read("202608180002_storage.sql"));
    await db.exec(retention.match(/create or replace function private\.run_account_retention\(\)[\s\S]*?\n\$\$;/)[0]);

    await t.test("reproduces deletion of a first-observed overdue owner and open appeal in a rollback-only fixture", async () => {
      await db.exec("begin");
      const result = await run();
      assert.equal(result.deleted, 1);
      assert.equal((await db.query("select count(*)::int as count from auth.users where id=$1", [owner])).rows[0].count, 0);
      assert.equal((await db.query("select owner_id from public.servers where id=$1", [server])).rows[0].owner_id, null);
      assert.equal((await db.query("select count(*)::int as count from public.ban_appeals")).rows[0].count, 0);
      await db.exec("rollback");
    });
    await t.test("reproduces the old direct upload policy ignoring a ban and an ended session", async () => {
      await db.exec("begin;delete from auth.sessions");
      await login();
      await db.query("insert into storage.objects(bucket_id,name) values('uploads-quarantine',$1)", [`${owner}/baseline.png`]);
      await db.exec("reset role;rollback");
    });

    await db.exec(migration);

    await t.test("keeps an overdue first-observed owner's account, sessions, ownership, activity, and appeal intact", async () => {
      const result = await run();
      assert.equal(result.mode, "review-only"); assert.equal(result.deleted, 0); assert.equal(result.reviewDue, 1); assert.equal(result.warned, 1);
      assert.equal((await db.query("select count(*)::int as count from auth.users")).rows[0].count, 4);
      assert.equal((await db.query("select count(*)::int as count from auth.sessions where user_id=$1", [owner])).rows[0].count, 1);
      assert.equal((await db.query("select owner_id from public.servers where id=$1", [server])).rows[0].owner_id, owner);
      assert.equal((await db.query("select appellant_id,status from public.ban_appeals")).rows[0].appellant_id, owner);
      assert.equal((await db.query("select status from public.ban_appeals")).rows[0].status, "under_review");
      assert.equal((await db.query("select metadata from public.account_activity where user_id=$1", [owner])).rows[0].metadata.fixture, true);
      const flags = (await db.query("select user_id,status from public.account_retention_flags order by user_id")).rows;
      assert.deepEqual(flags, [{ user_id: owner, status: "due" }, { user_id: warning, status: "warning" }]);
    });
    await t.test("repeated checks do not duplicate notices and old unread deletion notices are corrected", async () => {
      assert.equal((await run()).warned, 0);
      const notices = (await db.query("select body,action_url from public.notifications where kind='account_retention'")).rows;
      assert.equal(notices.length, 2);
      for (const item of notices) { assert.match(item.body, /Inactivity does not automatically delete your data/); assert.equal(item.action_url, "/dashboard"); }
    });
    await t.test("recent activity clears only the review flag, while records and older notices remain", async () => {
      await db.query("update auth.users set last_sign_in_at=now() where id=$1", [owner]);
      const result = await run(); assert.equal(result.reviewDue, 0); assert.equal(result.deleted, 0);
      assert.equal((await db.query("select count(*)::int as count from public.account_retention_flags where user_id=$1", [owner])).rows[0].count, 0);
      assert.equal((await db.query("select owner_id from public.servers where id=$1", [server])).rows[0].owner_id, owner);
      assert.equal((await db.query("select count(*)::int as count from public.notifications where user_id=$1", [owner])).rows[0].count, 1);
    });
    await t.test("direct quarantine uploads are denied for ordinary, banned, and revoked-session callers", async () => {
      for (const [id, description] of [[recent, "ordinary"], [owner, "banned"]]) {
        await login(id);
        await assert.rejects(db.query("insert into storage.objects(bucket_id,name) values('uploads-quarantine',$1)", [`${id}/${description}.png`]), /row-level security/);
      }
      await db.exec("reset role;delete from auth.sessions"); await login(owner);
      await assert.rejects(db.query("insert into storage.objects(bucket_id,name) values('uploads-quarantine',$1)", [`${owner}/revoked.png`]), /row-level security/);
      await login("", "anon");
      await assert.rejects(db.query("insert into storage.objects(bucket_id,name) values('uploads-quarantine','anonymous.png')"), /row-level security/);
      await db.exec("reset role");
    });
    await t.test("server-managed media uploads and private review permissions remain unchanged", async () => {
      await db.exec("set role service_role");
      await db.query("insert into storage.objects(bucket_id,name) values('server-media',$1)", [`${server}/reviewed.png`]);
      await assert.rejects(db.query("select private.run_account_retention()"), /permission denied/);
      await login(); await assert.rejects(db.query("select private.run_account_retention()"), /permission denied/);
      await login("", "anon");
      assert.equal((await db.query("select name from storage.objects where bucket_id='server-media'")).rows[0].name, `${server}/reviewed.png`);
      await assert.rejects(db.query("select private.run_account_retention()"), /permission denied/);
    });
  } finally { await db.close(); }
});
