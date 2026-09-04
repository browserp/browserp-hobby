import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
const db = new PGlite();
const read = name => readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), "utf8");
const fn = (sql, name) => sql.match(new RegExp(`create or replace function ${name.replaceAll(".", "\\.")}\\([\\s\\S]*?\\n\\$\\$;`))[0];
const owner = "00000000-0000-4000-8000-000000000001", reviewer = "00000000-0000-4000-8000-000000000002", member = "00000000-0000-4000-8000-000000000003";
const session = "11111111-0000-4000-8000-000000000001", reviewerSession = "22222222-0000-4000-8000-000000000002";
async function login(id = owner, sid = session, aal = "aal2") {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)", [id, JSON.stringify({ sub: id, session_id: sid, app_metadata: { provider: "discord" }, aal, amr: [{ method: "oauth" }, ...(aal === "aal2" ? [{ method: "totp" }] : [])] })]);
  await db.exec("set role authenticated");
}
const health = async () => (await db.query("select public.staff_refresh_health() value")).rows[0].value;
test("staff refresh health reads real telemetry with strict permissions and no sensitive payloads", async t => {
  try {
    await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create schema private;create schema cron;create schema net;
      revoke all on schema private,cron,net from public;
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
      create table auth.users(id uuid,deleted_at timestamptz,is_anonymous boolean default false);
      create table auth.sessions(id uuid,user_id uuid);
      create table auth.identities(user_id uuid,provider text,provider_id text,identity_data jsonb default '{}');
      create table public.staff_memberships(user_id uuid,role_key text,status text default 'active');
      create table public.staff_role_permissions(role_key text,permission_key text);
      create table public.staff_permission_overrides(user_id uuid,permission_key text,allowed boolean);
      create table private.discord_owner_allowlist(discord_user_id text,enabled boolean,role_key text);
      create table private.platform_security_settings(singleton boolean,staff_mfa_required boolean);
      create table public.security_bans(user_id uuid,target_type text,revoked_at timestamptz,starts_at timestamptz,ends_at timestamptz);
      insert into auth.users(id) values('${owner}'),('${reviewer}'),('${member}');
      insert into auth.sessions values('${session}','${owner}'),('${reviewerSession}','${reviewer}');
      insert into auth.identities(user_id,provider,provider_id) values('${owner}','discord','111111111111111111'),('${reviewer}','discord','222222222222222222');
      insert into public.staff_memberships(user_id,role_key) values('${owner}','owner'),('${reviewer}','reviewer');
      insert into public.staff_role_permissions values('owner','website.overview.read'),('reviewer','servers.review');
      insert into private.discord_owner_allowlist values('111111111111111111',true,'owner'),('222222222222222222',true,'reviewer');
      insert into private.platform_security_settings values(true,true);
      create table public.servers(id integer,platform_id text,status text,age_rating text);
      create table public.server_import_sources(server_id integer,platform text,last_checked_at timestamptz,last_error_at timestamptz);
      create table public.minecraft_import_sources(server_id integer,last_checked_at timestamptz,last_error_at timestamptz);
      create table private.server_status_refresh_runs(id uuid,started_at timestamptz,finished_at timestamptz,summary jsonb);
      create table private.server_status_refresh_control(singleton boolean,last_dispatched_at timestamptz,last_request_id bigint);
      create table cron.job(jobname text,active boolean,schedule text,command text);
      create table net._http_response(id bigint,status_code integer,timed_out boolean,content text,headers jsonb,error_msg text);
      insert into public.servers values(1,'fivem','published','general'),(2,'redm','published','general'),(3,'minecraft','published','general'),(4,'minecraft','published','general'),(5,'fivem','archived','general'),(6,'fivem','published','adult'),(7,'redm','published','general');
      insert into public.server_import_sources values(1,'fivem',now()-interval '1 minute',null),(2,'redm',now()-interval '6 minutes',null),(5,'fivem',now(),null),(6,'fivem',now(),null),(7,'fivem',now(),null);
      insert into public.minecraft_import_sources values(3,now()-interval '1 minute',now()),(4,null,null);
      insert into private.server_status_refresh_control values(true,now()-interval '30 seconds',42);
      insert into cron.job values('browserp-server-status-refresh',true,'* * * * *','SECRET SCHEDULER COMMAND');
      insert into net._http_response values(42,200,false,'SECRET RESPONSE BODY','{"Authorization":"SECRET TOKEN"}','SECRET NETWORK ADDRESS');
      insert into private.server_status_refresh_runs values
        ('aaaaaaaa-0000-4000-8000-000000000001',now()-interval '2 minutes',now()-interval '115 seconds','{"requested":4,"checked":3,"unchanged":1,"unavailable":0,"skipped":0,"failed":0,"deferred":0,"durationMs":5000}'),
        ('aaaaaaaa-0000-4000-8000-000000000002',now()-interval '1 minute',now()-interval '55 seconds','{"requested":4,"checked":1,"unchanged":1,"unavailable":1,"skipped":0,"failed":1,"deferred":0,"durationMs":5000,"secret":"SECRET RUN PAYLOAD"}');
    `);
    const staff = read("20260904091734_enforce_staff_session_revocation.sql"), memberSecurity = read("20260904092528_enforce_member_security_boundaries.sql");
    await db.exec(fn(staff, "private.has_current_auth_session"));
    await db.exec(fn(memberSecurity, "private.member_access_allowed"));
    await db.exec(fn(memberSecurity, "public.has_staff_permission"));
    await db.exec(read("20260904112122_staff_refresh_health.sql"));
    await t.test("anonymous, ordinary member, insufficient MFA and revoked staff sessions are denied", async () => {
      await db.exec("set role anon"); await assert.rejects(health(), /permission denied/);
      await login(member); await assert.rejects(health(), /Refresh-health permission/);
      await login(owner, session, "aal1"); await assert.rejects(health(), /Refresh-health permission/);
      await login(owner, "33333333-0000-4000-8000-000000000003"); await assert.rejects(health(), /Refresh-health permission/);
      await login(reviewer, reviewerSession); assert.equal((await health()).sources.total, 4);
    });
    await t.test("freshness counts include only matching, published, non-adult imported sources", async () => {
      await login(); const value = await health();
      assert.equal(value.sources.total, 4); assert.equal(value.sources.fresh, 1); assert.equal(value.sources.stale, 3); assert.equal(value.sources.unavailable, 2); assert.equal(value.sources.neverChecked, 1);
      assert.deepEqual(value.platforms.map(x => [x.platform,x.total,x.fresh,x.stale]), [["fivem",1,1,0],["minecraft",2,0,2],["redm",1,0,1]]);
      assert.equal(value.freshnessSeconds, 300); assert.equal(value.scheduler.enabled, true); assert.equal(value.scheduler.intervalSeconds, 60);
    });
    await t.test("last successful run remains distinct from latest completed failures", async () => {
      const value = await health();
      assert.ok(Date.parse(value.lastSuccessfulRunAt) < Date.parse(value.lastCompletedRun.finishedAt));
      assert.equal(value.lastRun.checked, 4); assert.equal(value.lastRun.refreshed, 1); assert.equal(value.lastRun.failed, 1); assert.equal(value.lastRun.unavailable, 1);
      assert.equal(value.scheduler.lastDeliveryStatus, 200); assert.equal(value.recentRuns.length, 2);
      assert.doesNotMatch(JSON.stringify(value), /SECRET|Authorization|last_request_id|command|error_msg|\bheaders\b|\bcontent\b/);
    });
    await t.test("incomplete runs have unknown counters and do not hide an older completion", async () => {
      await db.exec("reset role");
      await db.exec("insert into private.server_status_refresh_runs select gen_random_uuid(),now()+make_interval(secs=>n),null,null from generate_series(1,12) n");
      await login(); const value = await health();
      assert.equal(value.lastRun.finishedAt, null); assert.equal(value.lastRun.checked, null); assert.equal(value.lastRun.failed, null);
      assert.equal(value.lastCompletedRun.failed, 1); assert.equal(value.recentRuns.length, 10);
      await db.exec("reset role;update private.server_status_refresh_runs set summary='{\"requested\":4}' where finished_at is null");
      await login(); const partial = await health();
      assert.equal(partial.lastRun.checked, null, "Missing run counters are unknown, never an invented zero");
    });
    await t.test("missing delivery and paused schedule are represented explicitly", async () => {
      await db.exec("reset role;update cron.job set active=false;delete from net._http_response"); await login();
      const value = await health(); assert.equal(value.scheduler.enabled, false); assert.equal(value.scheduler.lastDeliveryStatus, null); assert.equal(value.scheduler.lastDeliveryTimedOut, null);
    });
  } finally { await db.close(); }
});
