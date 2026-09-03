// Isolated PostgreSQL integration checks; never connects to the live database.
// Install @electric-sql/pglite@0.3.14 in a temporary directory, then run:
// PGLITE_MODULE=/absolute/path/node_modules/@electric-sql/pglite/dist/index.js node --test test/website-overview-db.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

const root = resolve(import.meta.dirname, "..");
const { PGlite } = await import(process.env.PGLITE_MODULE ? pathToFileURL(process.env.PGLITE_MODULE).href : "@electric-sql/pglite");
const db = new PGlite();
const owner = "00000000-0000-4000-8000-000000000001";
const member = "00000000-0000-4000-8000-000000000002";
const helperSource = readFileSync(resolve(root, "supabase/migrations/20260819192413_platform_operations_and_trust.sql"), "utf8");
const helper = helperSource.match(/create or replace function public\.has_staff_permission\(p_permission text\)[\s\S]*?\$\$;/)[0];
const enrollmentHelper = helperSource.match(/create or replace function public\.staff_mfa_enrollment_allowed\(\)[\s\S]*?\$\$;/)[0];
const policyMigration = readFileSync(resolve(root, "supabase/migrations/20260903225826_staff_mfa_policy.sql"), "utf8");
const migration = readFileSync(resolve(root, "supabase/migrations/20260903225222_website_overview_announcements.sql"), "utf8");
const roleMigration = readFileSync(resolve(root, "supabase/migrations/20260903225214_custom_staff_roles.sql"), "utf8");
const accessSource = readFileSync(resolve(root, "supabase/migrations/20260819174759_discord_staff_role_allowlist.sql"), "utf8");
const accessSnapshot = accessSource.match(/create or replace function private\.staff_access_snapshot\(p_discord_user_id text\)[\s\S]*?\$\$;/)[0];

async function login(user = owner, aal = "aal2") {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub', $1, false), set_config('request.jwt.claims', $2, false)", [user, JSON.stringify({ sub: user, app_metadata: { provider: "discord" }, aal, amr: [{ method: "oauth" }, ...(aal === "aal2" ? [{ method: "totp" }] : [])] })]);
  await db.exec("set role authenticated");
}
async function overview(range) {
  return (await db.query("select public.staff_website_overview($1) value", [range])).rows[0].value;
}
async function mutate(overrides = {}) {
  const a = { id: null, action: "publish", title: "BrowseRP update", body: "A useful public update.", level: "info", startsAt: null, endsAt: null, expectedVersion: null, reason: "Integration check", requestId: crypto.randomUUID(), ...overrides };
  return (await db.query("select public.staff_mutate_announcement($1::uuid,$2,$3,$4,$5,$6::timestamptz,$7::timestamptz,$8::bigint,$9,$10) value", [a.id, a.action, a.title, a.body, a.level, a.startsAt, a.endsAt, a.expectedVersion, a.reason, a.requestId])).rows[0].value;
}
async function active() {
  return (await db.query("select public.public_active_announcements() value")).rows[0].value;
}
async function saveRole(overrides = {}) {
  const a = { key: "", name: "Website Editor", description: "Website publishing and overview", permissions: ["website.overview.read", "announcements.manage"], expectedVersion: 0, reason: "Integration check", requestId: crypto.randomUUID(), ...overrides };
  return (await db.query("select public.staff_mutate_role($1,$2,$3,$4::text[],$5::bigint,$6,$7) value", [a.key, a.name, a.description, a.permissions, a.expectedVersion, a.reason, a.requestId])).rows[0].value;
}
async function assignRole(roleKey, overrides = {}) {
  const a = { discordId: "223456789012345678", action: "assign", version: 0, requestId: crypto.randomUUID(), ...overrides };
  return (await db.query("select public.staff_mutate_access($1,$2,$3,$4,$5::bigint,$6) value", [a.discordId, a.action, roleKey, "Integration check", a.version, a.requestId])).rows[0].value;
}

test("website overview and announcements use real PostgreSQL security and aggregation", async (t) => {
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth; create schema private; create schema extensions;
    revoke all on schema private from public;
    grant usage on schema auth to authenticated;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
    create function extensions.gen_random_uuid() returns uuid language sql as $$ select pg_catalog.gen_random_uuid() $$;
    create table auth.users(id uuid primary key, created_at timestamptz, deleted_at timestamptz, is_anonymous boolean default false);
    create table auth.identities(user_id uuid, provider text, provider_id text, identity_data jsonb default '{}', created_at timestamptz default now());
    create table public.profiles(id uuid primary key, display_name text, avatar_url text);
    create table public.permissions(key text primary key, description text);
    create table public.staff_roles(key text primary key, name text unique, description text, rank integer unique, protected boolean not null default false);
    create table public.staff_memberships(user_id uuid primary key, role_key text, status text, granted_by uuid, reason text, updated_at timestamptz default now());
    create table public.staff_role_permissions(role_key text, permission_key text, primary key(role_key,permission_key));
    create table public.staff_permission_overrides(user_id uuid, permission_key text, allowed boolean);
    create table private.discord_owner_allowlist(discord_user_id text primary key, role_key text references public.staff_roles(key), enabled boolean, version bigint not null default 1, note text, updated_at timestamptz default now());
    create table private.platform_security_settings(singleton boolean, staff_mfa_required boolean);
    create table public.servers(status text, age_rating text);
    create table public.blog_posts(status text, published_at timestamptz);
    create table public.staff_audit_events(id bigint generated always as identity, actor_id uuid, action text, target_type text, target_id text, reason text, request_id text, before_state jsonb, after_state jsonb, metadata jsonb, unique(actor_id,request_id));
    insert into public.staff_roles values ('owner','Owner','Protected owner',1000,true),('administrator','Administrator','System administrator',800,true),('support','Support','Member support',100,false);
    insert into public.profiles(id) values ('${owner}'),('${member}');
    insert into public.staff_memberships(user_id,role_key,status) values ('${owner}','owner','active');
    insert into auth.identities(user_id,provider,provider_id) values ('${owner}','discord','123456789012345678'),('${member}','discord','223456789012345678');
    insert into private.discord_owner_allowlist(discord_user_id,role_key,enabled) values ('123456789012345678','owner',true);
    insert into private.platform_security_settings values (true,true);
    insert into public.staff_role_permissions values ('owner','staff.manage'),('owner','staff.permissions.manage'),('owner','blogs.manage');
    insert into auth.users values
      ('${owner}', (now() at time zone 'UTC')::date - interval '40 days',null,false),
      ('${member}', (now() at time zone 'UTC')::date - interval '29 days',null,false),
      ('00000000-0000-4000-8000-000000000003',now()-interval '1 minute',null,false),
      ('00000000-0000-4000-8000-000000000004',now()-interval '1 minute',null,true),
      ('00000000-0000-4000-8000-000000000005',now()-interval '1 minute',now(),false);
    insert into public.servers values ('published','teen'),('draft','teen'),('published','adult');
    insert into public.blog_posts values ('published',now()-interval '1 minute'),('draft',null),('published',now()+interval '1 day');
  `);
  await db.exec(helper);
  await db.exec(enrollmentHelper);
  await db.exec(accessSnapshot);
  await db.exec(roleMigration);
  await db.exec(migration);
  await db.exec(policyMigration);

  await t.test("anonymous and non-staff access is denied and private data stays private", async () => {
    await db.exec("set role anon");
    await assert.rejects(overview("30d"), /permission denied/);
    await assert.rejects(db.query("select * from private.site_announcements"), /permission denied/);
    assert.deepEqual(await active(), []);
    await login(member);
    await assert.rejects(overview("30d"), /permission required/);
    await assert.rejects(mutate(), /permission required/);
    await assert.rejects(db.query("select public.staff_announcement_control()"), /permission required/);
    await login(owner, "aal1");
    await assert.rejects(overview("30d"), /permission required/);
    await assert.rejects(mutate(), /permission required/);
    await login();
  });

  await t.test("UTC ranges include boundary registrations, fill empty days and reconcile totals", async () => {
    for (const range of ["30d", "90d", "180d", "1y", "max"]) {
      const result = await overview(range);
      assert.equal(result.metrics.totalUsers, 3);
      assert.equal(result.metrics.publishedServers, 1);
      assert.equal(result.metrics.publishedBlogs, 1);
      assert.equal(result.metrics.activeStaff, 1);
      assert.equal(result.users.total, result.users.baseline + result.users.newUsers);
      assert.equal(result.users.series.at(-1).totalUsers, result.users.total);
      assert.equal(result.users.series.reduce((sum, point) => sum + point.newUsers, 0), result.users.newUsers);
      assert.ok(result.users.series.length > 0 && result.users.series.length <= 366);
      assert.ok(result.users.series.some((point) => point.newUsers === 0));
      assert.equal(result.users.series[0].date, result.users.startDate);
      assert.equal(result.users.series.at(-1).endDate, result.users.endDate);
    }
    const monthly = await overview("30d");
    assert.equal(monthly.users.series.length, 30);
    assert.equal(monthly.users.series[0].newUsers, 1);
    assert.equal(monthly.users.newUsers, 2);
    assert.equal(monthly.users.baseline, 1);
    assert.deepEqual(monthly.permissions, { manageRoles: true, manageBlogs: true, manageAnnouncements: true });
    await assert.rejects(overview("bogus"), /Choose/);
  });

  await t.test("long histories remain bounded without losing accounts; empty sources remain zero", async () => {
    await db.exec("reset role");
    await db.exec(`update auth.users set created_at=now()-interval '50 years' where id='${owner}'`);
    await login();
    const long = await overview("max");
    assert.ok(long.users.series.length <= 366);
    assert.ok(long.users.bucketDays > 1);
    assert.equal(long.users.newUsers, 3);
    assert.equal(long.users.series.at(-1).totalUsers, 3);
    await db.exec("reset role; begin; update auth.users set deleted_at=now()");
    await login();
    const empty = await overview("max");
    assert.equal(empty.users.total, 0);
    assert.deepEqual(empty.users.series.map((p) => [p.newUsers, p.totalUsers]), [[0, 0]]);
    await db.exec("reset role; rollback");
    await login();
  });

  await t.test("announcements enforce content bounds, future/expired visibility and optimistic locking", async () => {
    await assert.rejects(mutate({ body: "<script>alert(1)</script>" }), /plain text/);
    await assert.rejects(mutate({ title: "no" }), /plain text/);
    await assert.rejects(mutate({ body: "x".repeat(1001) }), /plain text/);
    await assert.rejects(mutate({ endsAt: "2000-01-01T00:00:00Z" }), /schedule/);
    await assert.rejects(mutate({ requestId: "invalid" }), /request ID/);
    const draft = await mutate({ action: "save" });
    const future = await mutate({ startsAt: "2100-01-01T00:00:00Z" });
    await mutate({ startsAt: "2000-01-01T00:00:00Z", endsAt: "2000-01-02T00:00:00Z" });
    assert.deepEqual(await active(), []);
    const requestId = crypto.randomUUID();
    const published = await mutate({ id: draft.id, expectedVersion: draft.version, requestId });
    assert.equal(published.version, 2);
    assert.equal((await active()).length, 1);
    assert.deepEqual(await mutate({ id: draft.id, expectedVersion: draft.version, requestId }), published);
    await assert.rejects(mutate({ id: draft.id, expectedVersion: draft.version }), /changed since/);
    await mutate({ id: future.id, action: "archive", expectedVersion: future.version });
    await mutate({ id: published.id, action: "archive", expectedVersion: published.version });
    assert.deepEqual(await active(), []);
    await db.exec("reset role");
    assert.equal((await db.query("select count(*)::integer count from public.staff_audit_events where request_id=$1", [requestId])).rows[0].count, 1);
    await login();
  });

  await t.test("public projection is limited, strips private fields and hides disabled schedules", async () => {
    for (let i = 0; i < 7; i += 1) await mutate({ title: `Live announcement ${i}` });
    await db.exec("reset role; set role anon");
    const publicItems = await active();
    assert.equal(publicItems.length, 5);
    for (const item of publicItems) {
      assert.deepEqual(Object.keys(item).sort(), ["id", "title", "body", "level", "startsAt", "endsAt", "publishedAt"].sort());
    }
    await assert.rejects(db.query("select public.staff_announcement_control()"), /permission denied/);
    await login();
    const control = (await db.query("select public.staff_announcement_control() value")).rows[0].value;
    assert.equal(control.length, 10);
  });

  await t.test("custom roles enforce owner authority, protected permissions and versioned audited editing", async () => {
    await login(member);
    await assert.rejects(saveRole(), /Owner permission/);
    await assert.rejects(db.query("select public.staff_role_control()"), /Owner permission/);
    await login(owner, "aal1");
    await assert.rejects(saveRole(), /Owner permission/);
    await login();
    await assert.rejects(saveRole({ permissions: ["staff.manage"] }), /assignable permissions/);
    await assert.rejects(saveRole({ permissions: ["staff.permissions.manage"] }), /assignable permissions/);
    await assert.rejects(saveRole({ permissions: ["security.network.approve"] }), /assignable permissions/);
    await assert.rejects(saveRole({ permissions: ["invalid.permission"] }), /assignable permissions/);
    await assert.rejects(saveRole({ key: "owner", expectedVersion: 1 }), /Only custom roles/);
    await assert.rejects(saveRole({ key: "administrator", expectedVersion: 1 }), /Only custom roles/);
    const requestId = crypto.randomUUID();
    const created = await saveRole({ requestId });
    assert.equal(created.custom, true);
    assert.equal(created.version, 1);
    assert.equal(created.key, "custom_website_editor");
    assert.deepEqual(await saveRole({ requestId }), created);
    await assert.rejects(saveRole(), /already exists/);
    await assert.rejects(saveRole({ key: created.key, expectedVersion: 0 }), /changed/);
    const edited = await saveRole({ key: created.key, expectedVersion: 1, name: "Website team", permissions: ["website.overview.read", "announcements.manage", "announcements.manage"] });
    assert.equal(edited.version, 2);
    assert.equal(edited.permissions.length, 2);
    const control = (await db.query("select public.staff_role_control() value")).rows[0].value;
    assert.ok(control.roles.some((role) => role.key === edited.key));
    assert.ok(control.permissions.every((permission) => !["staff.manage", "staff.permissions.manage", "security.network.approve"].includes(permission.key)));
    await db.exec("reset role");
    assert.equal((await db.query("select count(*)::integer count from public.staff_audit_events where request_id=$1", [requestId])).rows[0].count, 1);
    await login();
  });

  await t.test("custom-role assignments take effect with least privilege and preserve owner protection", async () => {
    await assert.rejects(assignRole("owner"), /assignable staff role/);
    await assert.rejects(assignRole("unknown_role"), /assignable staff role/);
    await assert.rejects(assignRole("support", { discordId: "123456789012345678", action: "change_role", version: 1 }), /protected owner/);
    const requestId = crypto.randomUUID();
    const assignment = await assignRole("custom_website_editor", { requestId });
    assert.equal(assignment.roleKey, "custom_website_editor");
    assert.equal(assignment.status, "active");
    assert.deepEqual(await assignRole("custom_website_editor", { requestId }), assignment);
    const access = (await db.query("select public.staff_list_access() value")).rows[0].value;
    assert.ok(access.roles.some((role) => role.key === "custom_website_editor"));
    await login(member);
    assert.deepEqual((await overview("30d")).permissions, { manageRoles: false, manageBlogs: false, manageAnnouncements: true });
    await assert.rejects(saveRole(), /Owner permission/);
    await assert.rejects(assignRole("support", { discordId: "323456789012345678" }), /Owner permission/);
    await mutate({ action: "save", title: "Permitted custom role draft" });
    await login();
    await assignRole("custom_website_editor", { action: "revoke", version: assignment.version });
    await login(member);
    await assert.rejects(overview("30d"), /permission required/);
    await assert.rejects(mutate(), /permission required/);
  });
  await t.test("custom-role MFA policy is accurate before enrollment and private to eligible staff", async () => {
    await db.exec("reset role; set role anon");
    await assert.rejects(db.query("select public.staff_mfa_policy()"), /permission denied/);
    await login(member);
    await assert.rejects(db.query("select public.staff_mfa_policy()"), /permission required/);
    await login();
    await assignRole("custom_website_editor", { action: "reactivate", version: 2 });
    await login(member, "aal1");
    assert.deepEqual((await db.query("select public.staff_mfa_policy() value")).rows[0].value, { staffMfaRequired: true });
    await assert.rejects(overview("30d"), /permission required/);
    await db.exec("reset role; update private.platform_security_settings set staff_mfa_required=false");
    await login(member, "aal1");
    assert.deepEqual((await db.query("select public.staff_mfa_policy() value")).rows[0].value, { staffMfaRequired: false });
    assert.equal((await db.query("select public.has_staff_permission('reports.read') value")).rows[0].value, false);
    assert.equal((await overview("30d")).users.total, 3);
    await login("00000000-0000-4000-8000-000000000003");
    await assert.rejects(db.query("select public.staff_mfa_policy()"), /permission required/);
  });
  await db.close();
});
