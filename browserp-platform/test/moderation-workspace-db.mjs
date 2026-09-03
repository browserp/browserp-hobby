// Disposable PostgreSQL tests. Uses no production connection or live fixtures.
// PGLITE_MODULE=/absolute/path/to/@electric-sql/pglite/dist/index.js node --test test/moderation-workspace-db.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";
const { PGlite } = await import(process.env.PGLITE_MODULE ? pathToFileURL(process.env.PGLITE_MODULE).href : "@electric-sql/pglite");
const db = new PGlite();
const root = resolve(import.meta.dirname, "../supabase/migrations");
const read = (name) => readFileSync(resolve(root, name), "utf8");
const core = read("202608180001_browserp_core.sql");
const ops = read("20260819192413_platform_operations_and_trust.sql");
const workspace = read("20260903233151_unified_moderation_workspace.sql");
const sqlFunction = (sql, name) => sql.match(new RegExp(`create or replace function ${name.replaceAll(".", "\\.")}\\([\\s\\S]*?\\n\\$\\$;`))[0];
const owner = "00000000-0000-4000-8000-000000000001";
const admin = "00000000-0000-4000-8000-000000000002";
const reader = "00000000-0000-4000-8000-000000000003";
const member = "00000000-0000-4000-8000-000000000004";
const server = "00000000-0000-4000-8000-000000000101";
const report = "00000000-0000-4000-8000-000000000201";

async function login(id = owner, aal = "aal2") {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)", [id, JSON.stringify({ sub: id, app_metadata: { provider: "discord" }, aal, amr: [{ method: "oauth" }, ...(aal === "aal2" ? [{ method: "totp" }] : [])] })]);
  await db.exec("set role authenticated");
}
async function records(kind, filters = {}, cursor = null, limit = 25) {
  return (await db.query("select public.staff_moderation_records($1,$2::jsonb,$3::jsonb,$4) value", [kind, JSON.stringify(filters), cursor && JSON.stringify(cursor), limit])).rows[0].value;
}
async function summary() { return (await db.query("select public.staff_moderation_summary() value")).rows[0].value; }
async function mutate(kind, id, data, version = 1, action = "edit", request = crypto.randomUUID()) {
  return (await db.query("select public.staff_moderation_mutate($1,$2::uuid,$3,$4::jsonb,$5::bigint,$6,$7) value", [kind, id, action, JSON.stringify(data), version, "Moderation integration check", request])).rows[0].value;
}
const editServer = { name: "Updated FiveM community", description: "A carefully reviewed community description with enough useful detail for players.", platform: "fivem", region: "Europe", language: "French", framework: "QBCore", access: "application", communityUrl: "https://discord.gg/example", websiteUrl: "https://example.com", cfxJoinUrl: "https://cfx.re/join/example", status: "published", verified: true, beginnerFriendly: true };

test("unified moderation executes against real PostgreSQL permissions, data and mutations", async (t) => {
  await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create schema private;create schema extensions;
    revoke all on schema private from public;grant usage on schema auth to authenticated;
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
    create function extensions.gen_random_uuid() returns uuid language sql as $$select pg_catalog.gen_random_uuid()$$;
    create table auth.users(id uuid primary key,created_at timestamptz default now(),last_sign_in_at timestamptz,deleted_at timestamptz,is_anonymous boolean default false);
    create table auth.identities(user_id uuid,provider text,provider_id text,identity_data jsonb default '{}');
  `);
  for (const name of ["platforms", "profiles", "staff_roles", "permissions", "staff_role_permissions", "staff_memberships", "servers", "server_tags", "server_status_snapshots", "server_submissions", "reports", "moderation_queue", "security_events", "staff_audit_events", "blog_posts"]) {
    await db.exec(core.match(new RegExp(`create table public\\.${name} \\([\\s\\S]*?\\n\\);`))[0]);
  }
  for (const name of ["account_activity", "security_bans", "security_ban_appeals"]) {
    await db.exec(ops.match(new RegExp(`create table if not exists public\\.${name} \\([\\s\\S]*?\\n\\);`))[0]);
  }
  await db.exec(`
    alter table public.profiles add avatar_review_status text default 'not_set',add bio_review_status text default 'pending_review',add approved_bio text default '';
    alter table public.servers add source_submission_id uuid,add access_type text default 'public',add cfx_join_url text;
    alter table public.server_submissions add access_type text default 'public',add cfx_join_url text;
    create table public.staff_permission_overrides(user_id uuid,permission_key text,allowed boolean);
    create table private.discord_owner_allowlist(discord_user_id text primary key,role_key text,enabled boolean);
    create table private.platform_security_settings(singleton boolean,staff_mfa_required boolean);
    insert into private.platform_security_settings values(true,true);
    insert into public.staff_roles values('owner','Owner','Owner role',1000,true),('administrator','Administrator','Admin role',800,true),('reader','Reader','Read only staff',90,false);
    insert into auth.users(id) values('${owner}'),('${admin}'),('${reader}'),('${member}');
    insert into public.profiles(id,username,display_name) values('${owner}','owner','Owner'),('${admin}','admin','Admin'),('${reader}','reader','Reader'),('${member}','member','Ordinary member');
    insert into public.staff_memberships(user_id,role_key,reason) values('${owner}','owner','Test owner'),('${admin}','administrator','Test admin'),('${reader}','reader','Test reader');
    insert into auth.identities(user_id,provider,provider_id) values('${owner}','discord','111111111111111111'),('${admin}','discord','222222222222222222'),('${reader}','discord','333333333333333333');
    insert into private.discord_owner_allowlist values('111111111111111111','owner',true),('222222222222222222','administrator',true),('333333333333333333','reader',true);
    insert into public.permissions(key,description) select key,'Test permission' from unnest(array['reports.read','reports.resolve','accounts.read','servers.review','moderation.read','moderation.resolve','audit.read','security.read','bans.manage','appeals.review','profiles.review','staff.manage','staff.permissions.manage','adverts.manage','blogs.manage','website.overview.read']) key;
    insert into public.staff_role_permissions select 'owner',key from public.permissions;
    insert into public.staff_role_permissions values('reader','reports.read');
    insert into public.platforms(id,name,short_name) values('fivem','FiveM','FiveM'),('redm','RedM','RedM'),('roblox','Roblox','Roblox'),('minecraft','Minecraft','MC');
    insert into public.servers(id,owner_id,platform_id,name,slug,description,region,language,framework,status)
      values('${server}','${member}','fivem','Serious North American RP','serious-north-american-rp','A serious roleplay community with engaging jobs and a welcoming economy.','North America','English','QBCore','published'),
      ('00000000-0000-4000-8000-000000000102','${member}','redm','Frontier camp','frontier-camp','A frontier roleplay community with a welcoming camp and engaging stories.','Europe','German','VORP','draft');
    insert into public.server_tags values('${server}','player-owned-businesses','owner',80);
    insert into public.server_status_snapshots(server_id,online,players,capacity) values('${server}',true,14,64);
    insert into public.reports(id,reporter_id,target_type,target_id,category,details,status,created_at) values
      ('${report}','${member}','server','${server}','spam','Repeated advertising messages in community chats.','open','2026-01-01T00:00:00Z'),
      ('00000000-0000-4000-8000-000000000202','${member}','profile','${reader}','abuse','An abusive profile was investigated and resolved.','resolved','2026-01-02T00:00:00Z'),
      ('00000000-0000-4000-8000-000000000203','${member}','server','${server}','spam','Another spam report awaiting investigation.','triaged','2026-01-03T00:00:00Z');
    insert into public.account_activity(user_id,event_type,provider,masked_network,metadata) values('${member}','auth.signed_in','discord','192.0.*.*','{"networkCiphertext":"PRIVATE"}');
    insert into public.staff_audit_events(actor_id,action,target_type,target_id,reason,before_state,after_state,network_hash) values('${owner}','staff.test','profile','${member}','Audit fixture reason','{"secret":"PRIVATE"}','{"secret":"PRIVATE"}','PRIVATE');
    insert into public.security_events(severity,event_type,actor_id,network_hash,details) values('critical','firewall.site_attack','${member}','PRIVATE','{"ip":"PRIVATE","token":"PRIVATE","matchingRecentSubmissions":3}');
  `);
  await db.exec(sqlFunction(ops, "public.has_staff_permission"));
  await db.exec(sqlFunction(read("20260820023114_profile_avatar_immediate_name_filter.sql"), "private.profile_display_name_allowed"));
  await db.exec(sqlFunction(read("202608180005_staff_workspace.sql"), "public.staff_resolve_queue_item"));
  await db.exec(workspace);

  await t.test("anonymous, ordinary-member and insufficient-MFA requests are denied", async () => {
    await db.exec("set role anon");
    await assert.rejects(summary(), /permission denied/);
    await assert.rejects(records("members"), /permission denied/);
    await login(member);
    await assert.rejects(summary(), /permission required/);
    await assert.rejects(records("servers"), /Permission required/);
    await assert.rejects(mutate("server", server, editServer), /permission required/);
    await login(owner, "aal1");
    await assert.rejects(summary(), /permission required/);
    await login();
  });

  await t.test("all record kinds execute and summary counts are capability-filtered", async () => {
    for (const kind of ["reports", "members", "servers", "activity", "audit", "security", "bans", "appeals", "profiles", "listings", "queue"]) {
      const result = await records(kind);
      assert.equal(result.kind, kind);
      assert.ok(Array.isArray(result.items));
      assert.equal(typeof result.total, "number");
    }
    assert.equal((await summary()).counts.reports, 2);
    assert.equal((await summary()).counts.members, 4);
    await login(reader);
    const restricted = await summary();
    assert.equal(restricted.counts.reports, 2);
    assert.equal(restricted.counts.members, null);
    assert.equal(restricted.capabilities.editMembers, false);
    await assert.rejects(records("activity"), /Permission required/);
    await assert.rejects(mutate("report", report, {}, 1, "delete"), /permission required/);
    await login();
  });

  await t.test("search uses all normalized words with structured filters and exact facets", async () => {
    const matches = await records("servers", { q: "north-american PLAYER_owned", platform: "fivem", language: "english", mode: "qbcore", online: true, feature: "player owned businesses" });
    assert.equal(matches.total, 1);
    assert.equal(matches.items[0].id, server);
    assert.deepEqual(matches.facets.platform, [{ value: "fivem", label: "fivem", count: 1 }]);
    assert.equal((await records("servers", { q: "north missingword" })).total, 0);
    assert.equal((await records("servers", { platform: "redm", online: true })).total, 0);
    assert.deepEqual((await records("servers", { platform: "fivem" })).facets.platform.map((entry) => entry.value), ["fivem", "redm"]);
    assert.equal((await records("reports", { status: "history" })).total, 1);
    const first = await records("reports", { status: "all" }, null, 2);
    const second = await records("reports", { status: "all" }, first.nextCursor, 2);
    assert.equal(first.total, 3);
    assert.equal(second.total, 3);
    assert.equal(second.nextCursor, null);
    assert.equal(new Set([...first.items, ...second.items].map((item) => item.id)).size, 3);
    assert.equal((await records("reports", { status: "all", from: "2026-01-02", to: "2026-01-02" })).total, 1);
    const discord = await records("members", { q: "333333333333333333" });
    assert.equal(discord.total, 1); assert.equal(discord.items[0].discordId, "333333333333333333");
  });

  await t.test("keyset pagination retains timestamp microseconds without duplicates or omissions", async () => {
    await db.exec("reset role;begin;update public.reports set created_at='2026-01-01T00:00:00.000002Z'");
    await login();
    const ids = []; let cursor = null;
    do {
      const page = await records("reports", { status: "all" }, cursor, 1);
      ids.push(...page.items.map((item) => item.id));
      cursor = page.nextCursor;
      if (cursor) assert.ok(cursor.createdAt.includes(".000002"));
    } while (cursor && ids.length < 5);
    assert.equal(ids.length, 3); assert.equal(new Set(ids).size, 3);
    await db.exec("reset role;rollback"); await login();
  });

  await t.test("record inputs are bounded and logs do not disclose stored sensitive fields", async () => {
    await assert.rejects(records("anything"), /Choose a moderation section/);
    await assert.rejects(records("members", {}, null, 101), /page size/);
    await assert.rejects(records("members", { unknown: "oops" }), /Invalid moderation filter/);
    await assert.rejects(records("members", { from: "infinity" }), /valid dates/);
    await assert.rejects(records("members", {}, { id: "1", createdAt: "bad" }), /valid dates/);
    for (const kind of ["activity", "audit", "security"]) {
      const result = await records(kind, { status: "all" });
      assert.equal(result.total, 1);
      assert.ok(!JSON.stringify(result).includes("PRIVATE"));
    }
    assert.equal((await records("security")).items[0].eventType, "firewall.site_attack");
  });

  await t.test("member edits respect field allowlists, protected owner and concurrent updates", async () => {
    const data = { displayName: "Updated member", bio: "An updated biography.", visibility: "members" };
    await assert.rejects(mutate("member", member, { ...data, displayName: "BrowseRP Official" }), /display name/);
    await assert.rejects(mutate("member", member, { ...data, displayName: "www.example.com" }), /display name/);
    await assert.rejects(mutate("member", member, { ...data, role: "owner" }), /display name/);
    await login(admin);
    await assert.rejects(mutate("member", owner, data), /protected owner/);
    const saved = await mutate("member", member, data);
    assert.equal(saved.version, 2);
    assert.equal(saved.displayName, data.displayName);
    await assert.rejects(mutate("member", member, data), /record changed/);
    await db.exec("reset role");
    await db.query("update public.profiles set bio='Updated by the member' where id=$1", [member]);
    await login();
    await assert.rejects(mutate("member", member, data, 2), /record changed/);
  });

  await t.test("server edits preserve metadata order and deny unknown fields or unsafe URLs", async () => {
    await assert.rejects(mutate("server", server, { ...editServer, ownerId: owner }), /metadata/);
    await assert.rejects(mutate("server", server, { ...editServer, communityUrl: "javascript:alert(1)" }), /metadata/);
    const request = crypto.randomUUID();
    const saved = await mutate("server", server, editServer, 1, "edit", request);
    assert.equal(saved.version, 2);
    assert.deepEqual(await mutate("server", server, editServer, 1, "edit", request), saved);
    const item = (await records("servers", { q: "Updated FiveM" })).items[0];
    assert.equal(item.language, "French"); assert.equal(item.framework, "QBCore"); assert.equal(item.access, "application");
    await assert.rejects(mutate("server", server, editServer), /record changed/);
  });

  await t.test("reports soft-delete and restore with history, legacy protection and retention", async () => {
    const deleted = await mutate("report", report, {}, 1, "delete");
    assert.ok(deleted.deletedAt);
    assert.equal((await records("reports")).total, 1);
    assert.equal((await records("reports", { status: "history" })).total, 1);
    assert.equal((await records("reports", { status: "deleted" })).items[0].details, "Repeated advertising messages in community chats.");
    await assert.rejects(db.query("select public.staff_resolve_queue_item('report',$1,'resolved','A proper resolution',$2)", [report, crypto.randomUUID()]), /already closed/);
    const restored = await mutate("report", report, {}, deleted.version, "restore");
    assert.equal(restored.status, "open"); assert.equal(restored.deletedAt, null);
    await db.exec("reset role");
    await db.query("delete from auth.users where id=$1", [member]);
    await login();
    const retained = (await records("reports", { status: "all" })).items.find((item) => item.id === report);
    assert.equal(retained.reporterId, null);
    assert.equal(retained.reporterName, "Former member");
    assert.ok((await records("audit", { q: "moderation report" })).total >= 2);
  });
  await db.close();
});
