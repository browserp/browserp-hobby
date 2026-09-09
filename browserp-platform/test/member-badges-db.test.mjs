import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { staffHierarchyFixture, read } from "./staff-hierarchy-fixture.mjs";

const migration = readFileSync(new URL("../supabase/migrations/20260909163000_member_badges.sql", import.meta.url), "utf8");
const hierarchyUrl = new URL("../supabase/migrations/20260909105431_staff_capability_hierarchy.sql", import.meta.url);
const hierarchy = readFileSync(hierarchyUrl, "utf8");
const activeStaffHelper = hierarchy.match(/create function private\.is_active_staff_member\(p_user uuid\)[\s\S]*?revoke all on function private\.is_active_staff_member\(uuid\)[^;]+;/)[0];
assert.equal(createHash("sha256").update(activeStaffHelper).digest("hex"), "75cffed8faef83aae82e58805c4768ea0504db58273ebce7ab3980a66708f109", "badge tests must use Chat 6's frozen active-staff helper");
const sessionSource = readFileSync(new URL("../supabase/migrations/20260905195616_enforce_auth_session_expiry.sql", import.meta.url), "utf8");
const memberSource = readFileSync(new URL("../supabase/migrations/20260904092528_enforce_member_security_boundaries.sql", import.meta.url), "utf8");
const functionAndRevoke = (source, name) => source.match(new RegExp(`create or replace function ${name.replaceAll(".", "\\.")}\\([\\s\\S]*?revoke all on function ${name.replaceAll(".", "\\.")}\\([^;]+;`))[0];
const currentSessionHelper = functionAndRevoke(sessionSource, "private.has_current_auth_session");
const memberAccessHelper = functionAndRevoke(memberSource, "private.member_access_allowed");
const id = number => `00000000-0000-4000-8000-${String(number).padStart(12, "0")}`;
const sid = number => `aaaaaaaa-0000-4000-8000-${String(number).padStart(12, "0")}`;

async function fixture(t) {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth; create schema private; revoke all on schema private from public;
    create function auth.uid() returns uuid language sql stable as
      $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create function auth.jwt() returns jsonb language sql stable as
      $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
    create table auth.users(
      id uuid primary key, created_at timestamptz, deleted_at timestamptz,
      is_anonymous boolean not null default false
    );
    create table auth.sessions(id uuid primary key,user_id uuid not null,not_after timestamptz);
    create table auth.identities(
      user_id uuid not null references auth.users(id) on delete cascade,
      provider text not null, provider_id text, identity_data jsonb not null default '{}',
      created_at timestamptz not null default now()
    );
    create table public.profiles(
      id uuid primary key references auth.users(id) on delete cascade,
      profile_visibility text not null default 'public', display_name text not null,
      avatar_review_status text not null default 'not_set', approved_avatar_url text
    );
    create table public.staff_roles(key text primary key,name text not null,rank integer not null);
    create table public.staff_memberships(
      user_id uuid primary key references public.profiles(id) on delete cascade,
      role_key text not null references public.staff_roles(key),status text not null default 'active'
    );
    create table private.discord_owner_allowlist(
      discord_user_id text primary key,enabled boolean not null,role_key text not null
    );
    create table public.security_bans(
      id uuid primary key default gen_random_uuid(),user_id uuid,target_type text,
      starts_at timestamptz not null default now(),ends_at timestamptz,revoked_at timestamptz
    );
    create table public.badges(
      id uuid primary key default gen_random_uuid(),key text not null unique,name text not null,
      description text not null,icon_key text not null,color text not null,
      system_managed boolean not null default false,enabled boolean not null default true
    );
    create table public.user_badges(
      user_id uuid not null references public.profiles(id) on delete cascade,
      badge_id uuid not null references public.badges(id) on delete cascade,
      awarded_by uuid,reason text not null default 'System award',awarded_at timestamptz not null default now(),
      expires_at timestamptz,primary key(user_id,badge_id)
    );
    create table public.servers(
      id uuid primary key default gen_random_uuid(),owner_id uuid,slug text not null,status text not null,
      age_rating text not null,community_url text,access_type text,cfx_join_url text,
      animated_media_enabled boolean not null default false
    );
    create table public.server_claim_requests(
      id uuid primary key default gen_random_uuid(),server_id uuid not null,claimant_id uuid,
      status text not null,verification_status text not null,verified_at timestamptz,community_url text
    );
    create table public.server_votes(server_id uuid not null);
    create table public.server_comments(
      id uuid primary key default gen_random_uuid(),server_id uuid not null,author_id uuid not null,
      body text not null,status text not null,created_at timestamptz not null default now(),
      edited_at timestamptz,parent_comment_id uuid
    );
    insert into public.badges(key,name,description,icon_key,color,system_managed) values
      ('new_joiner','New Joiner','Displayed for the first five days after joining.','spark','#625bf6',true),
      ('verified_owner','Verified server owner','Old owner description.','shield-check','#248b67',true),
      ('verified_developer','Verified developer','Developer identity reviewed.','code-check','#3676bc',true),
      ('community_helper','Community helper','Constructive participation.','heart','#b05e88',false);
  `);
  await db.exec(currentSessionHelper);
  await db.exec(memberAccessHelper);
  await db.exec(activeStaffHelper);
  const users = Array.from({ length: 503 }, (_, index) => {
    const number = index + 1;
    const second = number >= 99 && number <= 101 ? 100 : number;
    return `('${id(number)}','2026-01-01T00:00:00Z'::timestamptz+interval '${second} seconds',false)`;
  });
  await db.exec(`insert into auth.users(id,created_at,is_anonymous) values ${users.join(",")};`);
  await db.exec(`insert into auth.sessions(id,user_id) values
    ('${sid(2)}','${id(2)}'),('${sid(3)}','${id(3)}'),('${sid(4)}','${id(4)}'),
    ('${sid(5)}','${id(5)}'),('${sid(502)}','${id(502)}');`);
  await db.exec(`insert into public.profiles(id,display_name,profile_visibility) values
    ('${id(1)}','First member','public'),('${id(2)}','Staff member','public'),
    ('${id(3)}','Verified member','public'),('${id(4)}','Listing owner','public'),
    ('${id(5)}','Recognised member','public'),('${id(98)}','Member 98','public'),
    ('${id(99)}','Tied member 99','public'),('${id(100)}','Tied member 100','public'),
    ('${id(101)}','Tied member 101','public'),('${id(102)}','Member 102','public'),('${id(500)}','Member 500','public'),
    ('${id(501)}','Member 501','public'),('${id(502)}','Private member','private'),
    ('${id(503)}','Spoofed member','public');
    insert into public.staff_roles values('moderator','Moderator',300);
    insert into public.staff_memberships values('${id(2)}','moderator','active');
    insert into auth.identities(user_id,provider,provider_id,identity_data) values
      ('${id(2)}','discord','20000000000000002','{"email":"staff@example.test","email_verified":true}'),
      ('${id(3)}','discord','20000000000000003','{"email":"member@example.test","email_verified":true}'),
      ('${id(4)}','discord','20000000000000004','{"email":"owner@example.test","email_verified":false}');
    insert into private.discord_owner_allowlist values('20000000000000002',true,'moderator');
    insert into public.servers(id,owner_id,slug,status,age_rating,community_url,access_type)
      values('10000000-0000-4000-8000-000000000001','${id(4)}','verified-listing','published','general','https://discord.gg/verified','public'),
      ('10000000-0000-4000-8000-000000000002','${id(5)}','submitted-listing','published','general','https://discord.gg/submitted','public');
    insert into public.server_claim_requests(server_id,claimant_id,status,verification_status,verified_at,community_url)
      values('10000000-0000-4000-8000-000000000001','${id(4)}','approved','verified',now(),'https://discord.gg/verified');
  `);
  await db.exec(migration);
  const badgeId = async key => (await db.query("select id from public.badges where key=$1", [key])).rows[0].id;
  await db.query("insert into public.user_badges(user_id,badge_id,reason) values($1,$2,$3)", [id(5), await badgeId("community_helper"), "Helpful launch feedback"]);
  await db.query("insert into public.user_badges(user_id,badge_id,reason) values($1,$2,$3)", [id(503), await badgeId("browserp_staff"), "Attempted manual staff mark"]);
  await db.query("insert into public.user_badges(user_id,badge_id,reason) values($1,$2,$3)", [id(503), await badgeId("verified_owner"), "Attempted manual owner mark"]);
  const call = async (user, role = "anon", asUser = null) => {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)",
      [asUser || "", JSON.stringify(asUser ? { sub: asUser, session_id: sid(Number(asUser.slice(-12))) } : {})]);
    await db.exec(`set role ${role}`);
    return (await db.query("select public.member_badges($1) value", [user])).rows[0].value;
  };
  return { db, call, badgeId };
}

test("member badges derive current facts without exposing private evidence", async t => {
  const { db, call, badgeId } = await fixture(t);

  await t.test("seeds fixed public names and returns only bounded display fields", async () => {
    const staff = await call(id(2));
    assert.equal(staff.staffRole, "Moderator");
    assert.deepEqual(staff.badges.map(item => item.kind), ["browserp_staff", "discord_verified_email"]);
    assert.equal(staff.badges[0].label, "BrowseRP Staff");
    assert.equal(staff.badges[1].label, "Verified Member");
    assert.ok(staff.badges.every(item => Object.keys(item).sort().join() === "description,iconKey,kind,label"));
    assert.doesNotMatch(JSON.stringify(staff), /staff@example|20000000000000002|reason|awardedAt|source/i);
    const owner = await call(id(4));
    assert.deepEqual(owner.badges.map(item => item.kind), ["verified_owner"]);
    assert.equal(owner.badges[0].label, "Verified Server Owner");
    assert.match(owner.badges[0].description, /not a safety or quality guarantee/i);
  });

  await t.test("staff badge and separate rank disappear with every authority revocation fact", async () => {
    const changed = async (sql, expected = ["discord_verified_email"]) => {
      await db.exec("reset role;begin");
      try {
        await db.exec(sql); await db.exec("set local role anon");
        const value = (await db.query("select public.member_badges($1) value", [id(2)])).rows[0].value;
        assert.equal(value.staffRole, null); assert.deepEqual(value.badges.map(item => item.kind), expected);
      } finally { await db.exec("rollback"); }
    };
    await changed(`update public.staff_memberships set status='revoked' where user_id='${id(2)}'`);
    await changed("update private.discord_owner_allowlist set enabled=false");
    await changed("update private.discord_owner_allowlist set role_key='other'");
    await changed(`insert into auth.identities(user_id,provider,provider_id) values('${id(2)}','google','extra')`);
    await changed(`insert into public.security_bans(user_id,target_type) values('${id(2)}','account')`);
  });

  await t.test("verified member follows current Discord verified-email evidence only", async () => {
    assert.ok((await call(id(3))).badges.some(item => item.kind === "discord_verified_email"));
    for (const sql of [
      `update auth.identities set identity_data='{"email":"member@example.test","email_verified":false}' where user_id='${id(3)}'`,
      `update auth.identities set identity_data='{"email_verified":true}' where user_id='${id(3)}'`,
      `delete from auth.identities where user_id='${id(3)}'`
    ]) {
      await db.exec("reset role;begin");
      try {
        await db.exec(sql); await db.exec("set local role anon");
        assert.ok(!(await db.query("select public.member_badges($1) value", [id(3)])).rows[0].value.badges.some(item => item.kind === "discord_verified_email"));
      } finally { await db.exec("rollback"); }
    }
  });

  await t.test("verified owner requires current reviewed control and the current published owner", async () => {
    for (const sql of [
      "update public.server_claim_requests set status='denied'",
      "update public.server_claim_requests set verification_status='not_owner'",
      "update public.server_claim_requests set verified_at=null",
      "update public.server_claim_requests set community_url='https://discord.gg/old'",
      `update public.servers set owner_id='${id(3)}'`,
      "update public.servers set status='suspended'"
    ]) {
      await db.exec("reset role;begin");
      try {
        await db.exec(sql); await db.exec("set local role anon");
        assert.ok(!(await db.query("select public.member_badges($1) value", [id(4)])).rows[0].value.badges.some(item => item.kind === "verified_owner"));
      } finally { await db.exec("rollback"); }
    }
  });

  await t.test("cohorts stay fixed, suppress First 500, and do not guess across a tied boundary", async () => {
    await db.exec("reset role");
    assert.equal((await db.query(`select count(*)::int value from public.user_badges u join public.badges b on b.id=u.badge_id
      where b.key in ('first_100','first_500')`)).rows[0].value, 0, "historical cohort awards default off");
    await db.exec(`update private.member_signup_order set cohort_confirmed=true where user_id='${id(1)}';
      select private.award_member_signup_badges('${id(1)}')`);
    await db.exec("set role anon");
    assert.deepEqual((await db.query("select public.member_badges($1) value", [id(1)])).rows[0].value.badges, [], "one row cannot bypass the global evidence gate");
    await db.exec("reset role");
    await assert.rejects(db.exec("update private.member_signup_counter set chronology_confirmed=true where singleton"), /check constraint/);
    await db.exec(`update private.member_signup_counter set chronology_confirmed=true,confirmed_at=now(),
      evidence_reference='Fixture authoritative lifetime chronology' where singleton;
      update private.member_signup_order set cohort_confirmed=ordering_unambiguous;
      select private.award_member_signup_badges(user_id) from private.member_signup_order
        where cohort_confirmed and signup_ordinal<=500;`);
    await db.exec("set role anon");
    assert.deepEqual((await call(id(1))).badges.map(item => item.kind), ["first_100"]);
    assert.deepEqual((await call(id(98))).badges.map(item => item.kind), ["first_100"]);
    for (const number of [99, 100, 101]) assert.deepEqual((await call(id(number))).badges, []);
    assert.deepEqual((await call(id(102))).badges.map(item => item.kind), ["first_500"]);
    assert.deepEqual((await call(id(500))).badges.map(item => item.kind), ["first_500"]);
    assert.deepEqual((await call(id(501))).badges, []);
    await db.exec("reset role");
    assert.deepEqual((await db.query(`select b.key from public.user_badges u join public.badges b on b.id=u.badge_id
      where u.user_id=$1 and b.key in ('first_100','first_500') order by b.key`, [id(98)])).rows.map(row => row.key), ["first_100", "first_500"]);
    assert.deepEqual((await db.query(`select signup_ordinal,cohort_confirmed from private.member_signup_order
      where user_id in ($1,$2,$3) order by signup_ordinal`, [id(99), id(100), id(101)])).rows.map(row => row.cohort_confirmed), [false, false, false]);
    await db.query("delete from auth.users where id=$1", [id(1)]);
    await db.exec("set role anon");
    assert.deepEqual((await db.query("select public.member_badges($1) value", [id(102)])).rows[0].value.badges.map(item => item.kind), ["first_500"]);
    await db.exec("reset role");
    await db.query("insert into auth.users(id,created_at) values($1,now())", [id(504)]);
    assert.equal((await db.query("select signup_ordinal from private.member_signup_order where user_id=$1", [id(504)])).rows[0].signup_ordinal, 504);
  });

  await t.test("manual recognition is visible but manual system-badge rows cannot spoof trust", async () => {
    assert.deepEqual((await call(id(5))).badges.map(item => item.kind), ["first_100", "community_helper"]);
    const spoofed = await call(id(503));
    assert.deepEqual(spoofed.badges, []); assert.equal(spoofed.staffRole, null);
    await db.exec("reset role");
    await db.query("update public.user_badges set expires_at=now()-interval '1 second' where user_id=$1 and badge_id=$2", [id(5), await badgeId("community_helper")]);
    await db.exec("set role anon");
    assert.ok(!(await db.query("select public.member_badges($1) value", [id(5)])).rows[0].value.badges.some(item => item.kind === "community_helper"));
  });

  await t.test("public badge count and text stay bounded", async () => {
    await db.exec("reset role;begin");
    try {
      for (let number = 0; number < 20; number += 1) {
        const key = `manual_${String(number).padStart(2, "0")}`;
        const badge = (await db.query(`insert into public.badges(key,name,description,icon_key,color)
          values($1,repeat('N',100),repeat('D',500),repeat('I',100),'#000000') returning id`, [key])).rows[0].id;
        await db.query("insert into public.user_badges(user_id,badge_id) values($1,$2)", [id(5), badge]);
      }
      await db.exec("set local role anon");
      const value = (await db.query("select public.member_badges($1) value", [id(5)])).rows[0].value;
      assert.equal(value.badges.length, 12);
      assert.ok(value.badges.every(item => item.label.length <= 60 && item.description.length <= 240 && item.iconKey.length <= 50));
    } finally { await db.exec("rollback"); }
  });

  await t.test("profile visibility applies to the direct badge projection", async () => {
    assert.equal(await call(id(502)), null);
    assert.notEqual(await call(id(502), "authenticated", id(502)), null);
    await db.exec("reset role"); await db.query("update auth.sessions set not_after=now()-interval '1 second' where id=$1", [sid(502)]);
    assert.equal(await call(id(502), "authenticated", id(502)), null, "an expired session cannot read a private profile badge");
    await db.exec("reset role"); await db.query("update auth.sessions set not_after=null where id=$1", [sid(502)]);
    await db.query("insert into public.security_bans(user_id,target_type) values($1,'account')", [id(502)]);
    assert.equal(await call(id(502), "authenticated", id(502)), null, "a restricted account cannot read a private profile badge");
    await db.exec("reset role"); await db.query("delete from public.security_bans where user_id=$1", [id(502)]);
    await db.query("delete from auth.sessions where id=$1", [sid(502)]);
    assert.equal(await call(id(502), "authenticated", id(502)), null, "a revoked session cannot read a private profile badge");
    await db.exec("reset role"); await db.query("update auth.users set deleted_at=now() where id=$1", [id(3)]);
    await db.exec("set role anon");
    assert.deepEqual((await db.query("select public.member_badges($1) value", [id(3)])).rows[0].value, { badges: [], staffRole: null });
  });

  await t.test("raw cohort evidence and private projections stay inaccessible", async () => {
    for (const role of ["anon", "authenticated", "service_role"]) {
      await db.exec(`reset role;set role ${role}`);
      await assert.rejects(db.query("select * from private.member_signup_order"), /permission denied/);
      await assert.rejects(db.query("select private.member_badge_projection($1)", [id(2)]), /permission denied/);
    }
    await db.exec("reset role;set role service_role");
    await assert.rejects(db.query("select public.member_badges($1)", [id(2)]), /permission denied/);
  });

  await t.test("public comments reuse the canonical badge and rank projection", async () => {
    await db.exec("reset role");
    await db.exec(`insert into public.server_comments(server_id,author_id,body,status)
      values('10000000-0000-4000-8000-000000000001','${id(2)}','A staff comment.','published');
      set role anon;`);
    const value = (await db.query("select public.public_server_engagement('verified-listing') value")).rows[0].value;
    assert.equal(value.comments[0].staffRole, "Moderator");
    assert.deepEqual(value.comments[0].badges.map(item => item.kind), ["browserp_staff", "discord_verified_email", "first_100"]);
  });
});

test("badges integrate with the complete hierarchy and guarded moderation chain", async t => {
  const h = await staffHierarchyFixture(t), { db, admin, login, call, ids, restrict } = h;
  const core = read("202608180001_browserp_core.sql");
  await admin(core.match(/insert into public\.badges \(key, name, description, icon_key, color, system_managed\) values[\s\S]*?;/)[0]);
  const helperBefore = (await db.query("select pg_get_functiondef('private.is_active_staff_member(uuid)'::regprocedure) definition")).rows[0].definition;
  const rolesBefore = (await db.query("select key,name,rank from public.staff_roles order by rank")).rows;
  const grantsBefore = (await db.query("select role_key,permission_key from public.staff_role_permissions order by role_key,permission_key")).rows;
  // Hosted public-schema defaults can grant table access independently of RLS;
  // column grants also survive a table-only revoke. Exercise both explicitly.
  await admin(`alter table public.user_badges enable row level security;
    grant select on public.user_badges to anon,authenticated,service_role;
    grant select(reason,awarded_by) on public.user_badges to authenticated;`);
  await admin(core.match(/create policy user_badges_public_read[^;]+;/)[0]);
  await admin(migration);
  const publicBadges = async who => {
    await admin(); await db.exec("set role anon");
    return call("member_badges", [who], "uuid");
  };

  await t.test("migration preserves the canonical helper, roles and permissions and leaves cohorts disabled", async () => {
    await admin();
    assert.equal((await db.query("select pg_get_functiondef('private.is_active_staff_member(uuid)'::regprocedure) definition")).rows[0].definition, helperBefore);
    assert.deepEqual((await db.query("select key,name,rank from public.staff_roles order by rank")).rows, rolesBefore);
    assert.deepEqual((await db.query("select role_key,permission_key from public.staff_role_permissions order by role_key,permission_key")).rows, grantsBefore);
    assert.deepEqual((await db.query("select chronology_confirmed,confirmed_at,evidence_reference from private.member_signup_counter")).rows, [{ chronology_confirmed: false, confirmed_at: null, evidence_reference: null }]);
    assert.equal((await db.query("select count(*)::int n from private.member_signup_order where cohort_confirmed")).rows[0].n, 0);
    for (const role of Object.keys(h.discord)) {
      const value = await publicBadges(ids[role]);
      assert.equal(value.staffRole, rolesBefore.find(item => item.key === role).name);
      assert.deepEqual(value.badges.map(item => item.kind), ["browserp_staff"]);
    }
  });

  await t.test("stored recognition cannot promote members or bypass the real staff action guard", async () => {
    await admin(`insert into public.user_badges(user_id,badge_id,awarded_by,reason)
      select '${ids.member}',id,'${ids.owner}','Private manual spoof evidence' from public.badges
      where key in ('browserp_staff','verified_owner','first_100','first_500','discord_verified_email');`);
    assert.deepEqual(await publicBadges(ids.member), { badges: [], staffRole: null });
    await login("member", { aal: "aal1", app_metadata: { provider: "google" } });
    await assert.rejects(call("staff_role_control"), /permission|staff|session/i);
    await assert.rejects(restrict(ids.otherMember, 60), /permission|staff|session/i);
    await admin();
    const exported = (await db.query("select private.member_export_records($1) value", [ids.member])).rows[0].value;
    assert.ok(Array.isArray(exported.collections.contentModeration));
    assert.ok(Array.isArray(exported.collections.staffAccessRequests));
    assert.ok(Array.isArray(exported.collections.badges));
    assert.doesNotMatch(JSON.stringify(exported.collections.badges), /Private manual spoof evidence|awarded_by/);
  });

  await t.test("legacy raw award grants cannot expose evidence outside the safe projection", async () => {
    await admin();
    for (const role of ["anon", "authenticated"]) {
      const acl = (await db.query(`select
        has_table_privilege($1,'public.user_badges','select') table_read,
        has_column_privilege($1,'public.user_badges','reason','select') reason_read,
        has_column_privilege($1,'public.user_badges','awarded_by','select') actor_read`, [role])).rows[0];
      assert.deepEqual(acl, { table_read: false, reason_read: false, actor_read: false });
      await db.exec(`set role ${role}`);
      await assert.rejects(db.query("select reason,awarded_by from public.user_badges"), /permission denied/);
      await admin();
    }
    assert.equal((await db.query("select has_table_privilege('service_role','public.user_badges','select') allowed")).rows[0].allowed, true);
    assert.deepEqual((await db.query("select relrowsecurity from pg_class where oid in ('private.member_signup_order'::regclass,'private.member_signup_counter'::regclass)")).rows.map(row => row.relrowsecurity), [true, true]);
    assert.equal((await publicBadges(ids.moderator)).staffRole, "Moderator");
  });

  await t.test("new signup and delayed profile triggers obey evidence gating and remain idempotent", async () => {
    await admin("begin");
    try {
      const pending = id(601), confirmed = id(602);
      const before = (await db.query("select last_ordinal from private.member_signup_counter")).rows[0].last_ordinal;
      await db.query("insert into auth.users(id,is_anonymous) values($1,true)", [pending]);
      assert.equal((await db.query("select count(*)::int n from private.member_signup_order where user_id=$1", [pending])).rows[0].n, 0);
      await db.query("update auth.users set is_anonymous=false where id=$1", [pending]);
      await db.query("insert into public.profiles(id,username,display_name) values($1,'badge_pending','BrowseRP member')", [pending]);
      assert.deepEqual((await db.query("select signup_ordinal,cohort_confirmed from private.member_signup_order where user_id=$1", [pending])).rows[0], { signup_ordinal: before + 1, cohort_confirmed: false });
      assert.equal((await db.query("select count(*)::int n from public.user_badges where user_id=$1", [pending])).rows[0].n, 0);
      // Activation exists only inside this rolled-back fixture transaction.
      await db.exec("update private.member_signup_counter set chronology_confirmed=true,confirmed_at=now(),evidence_reference='Isolated trigger fixture only'");
      await db.query("insert into auth.users(id) values($1)", [confirmed]);
      assert.equal((await db.query("select count(*)::int n from public.user_badges where user_id=$1", [confirmed])).rows[0].n, 0, "awards wait for the profile FK");
      await db.query("insert into public.profiles(id,username,display_name) values($1,'badge_confirmed','BrowseRP member')", [confirmed]);
      await db.query("update auth.users set is_anonymous=false where id=$1", [confirmed]);
      await db.query("select private.award_member_signup_badges($1)", [confirmed]);
      assert.deepEqual((await db.query("select b.key from public.user_badges ub join public.badges b on b.id=ub.badge_id where ub.user_id=$1 order by b.key", [confirmed])).rows.map(row => row.key), ["first_100", "first_500"]);
      assert.equal((await db.query("select last_ordinal from private.member_signup_counter")).rows[0].last_ordinal, before + 2);
      assert.deepEqual((await publicBadges(confirmed)).badges.map(item => item.kind), ["first_100"]);
    } finally { await db.exec("rollback"); }
    await admin();
    assert.equal((await db.query("select chronology_confirmed from private.member_signup_counter")).rows[0].chronology_confirmed, false);
  });

  await t.test("the public badge disappears after a real staff restriction and returns at expiry", async () => {
    await admin("begin");
    try {
      await login("owner");
      const restriction = await restrict(ids.moderator, 60);
      assert.deepEqual(await publicBadges(ids.moderator), { badges: [], staffRole: null });
      await admin(`update public.security_bans set starts_at=clock_timestamp()-interval '2 hours',
        ends_at=clock_timestamp()-interval '1 hour' where id='${restriction.id}';`);
      assert.equal((await publicBadges(ids.moderator)).staffRole, "Moderator");
      await admin();
      assert.equal((await db.query("select revoked_at from public.security_bans where id=$1", [restriction.id])).rows[0].revoked_at, null, "badge recovery uses expiry, not a cleanup job");
    } finally { await db.exec("rollback"); }
  });

  await t.test("comment review and edit versioning stay effective after adding canonical badges", async () => {
    const server = randomUUID(), comment = randomUUID();
    await admin(`insert into public.platforms(id,name,short_name) values('fivem','FiveM','FiveM');
      insert into public.servers(id,owner_id,platform_id,name,slug,description,region,status)
      values('${server}','${ids.member}','fivem','Badge fixture RP','badge-fixture-rp','A welcoming roleplay community for badge integration checks.','Europe','published');
      insert into public.server_comments(id,server_id,author_id,body,status)
      values('${comment}','${server}','${ids.moderator}','First reviewed staff comment.','published');`);
    await db.exec("set role anon");
    assert.deepEqual((await call("public_server_engagement", ["badge-fixture-rp"])).comments, [], "new content cannot publish just by requesting published status");
    await admin();
    const initial = (await db.query("select id,version from private.content_submissions where target_id=$1", [comment])).rows[0];
    await login("community_moderator");
    await call("staff_decide_content", [initial.id, initial.version, "approve", "Reviewed integration comment.", randomUUID()], "uuid,bigint,text,text,text");
    await admin(); await db.exec("set role anon");
    let result = await call("public_server_engagement", ["badge-fixture-rp"]);
    assert.equal(result.comments[0].staffRole, "Moderator");
    assert.deepEqual(result.comments[0].badges.map(item => item.kind), ["browserp_staff"]);
    assert.equal(result.comments[0].body, "First reviewed staff comment.");
    assert.equal(result.comments[0].avatarUrl, null);
    assert.doesNotMatch(JSON.stringify(result), /111111|permission|Private manual spoof evidence|identity_data|content_submissions/);
    await admin(`update public.server_comments set body='Edited comment awaiting a fresh decision.' where id='${comment}'`);
    await db.exec("set role anon");
    assert.deepEqual((await call("public_server_engagement", ["badge-fixture-rp"])).comments, []);
    await login("community_moderator");
    await assert.rejects(call("staff_decide_content", [initial.id, initial.version, "approve", "Attempting the stale review.", randomUUID()], "uuid,bigint,text,text,text"), /changed|stale|current|superseded/i);
    await admin();
    const current = (await db.query("select id,version from private.content_submissions where target_id=$1 and status='pending_review'", [comment])).rows[0];
    await login("community_moderator");
    await call("staff_decide_content", [current.id, current.version, "approve", "Reviewed current edited comment.", randomUUID()], "uuid,bigint,text,text,text");
    await admin(); await db.exec("set role anon");
    result = await call("public_server_engagement", ["badge-fixture-rp"]);
    assert.equal(result.comments[0].body, "Edited comment awaiting a fresh decision.");
    assert.deepEqual(result.comments[0].badges.map(item => item.kind), ["browserp_staff"]);
  });
});
