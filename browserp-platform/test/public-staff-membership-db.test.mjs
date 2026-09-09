import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { privacyFileFixture } from "./privacy-file-fixture.mjs";

const hierarchy = readFileSync(new URL("../supabase/migrations/20260909105431_staff_capability_hierarchy.sql", import.meta.url), "utf8");
const helper = hierarchy.match(/create function private\.is_active_staff_member\(p_user uuid\)[\s\S]*?revoke all on function private\.is_active_staff_member\(uuid\)[^;]+;/)[0];
assert.equal(createHash("sha256").update(helper).digest("hex"), "75cffed8faef83aae82e58805c4768ea0504db58273ebce7ab3980a66708f109");
const migration = readFileSync(new URL("../supabase/migrations/20260909162257_canonical_public_staff_roster.sql", import.meta.url), "utf8");

test("the service roster uses unchanged canonical staff eligibility before limiting its display projection", async t => {
  const { db, owner, admin } = await privacyFileFixture(t);
  await admin(helper);
  const originalHelper = (await db.query("select pg_get_functiondef('private.is_active_staff_member(uuid)'::regprocedure) value")).rows[0].value;
  await db.exec(migration);
  const roster = async () => {
    await admin("set role service_role");
    try { return (await db.query("select public.service_public_staff_memberships() value")).rows[0].value; }
    finally { await admin(); }
  };
  const memberIds = async () => (await roster()).map(row => row.user_id);
  const restriction = (starts, ends, revoked = "null") => `insert into public.security_bans
    (user_id,target_type,target_hash,public_reference,reason_code,reason,actor_id,starts_at,ends_at,revoked_at)
    values('${owner}','account',repeat('a',64),'BRP-1234567890','fixture','A bounded roster fixture restriction',
      '${owner}',${starts},${ends},${revoked})`;

  await t.test("only service can call the bounded projection and helper ACLs remain private", async () => {
    const rows = await roster();
    assert.deepEqual(rows.map(row => row.user_id), [owner]);
    assert.deepEqual(Object.keys(rows[0]).sort(), ["granted_at", "role_key", "status", "user_id"]);
    assert.equal(rows[0].status, "active");
    assert.equal(rows[0].role_key, "owner");
    assert.equal((await db.query("select pg_get_functiondef('private.is_active_staff_member(uuid)'::regprocedure) value")).rows[0].value, originalHelper);
    for (const role of ["anon", "authenticated", "service_role"]) {
      const grants = (await db.query(`select
        has_function_privilege($1,'public.service_public_staff_memberships()','execute') roster,
        has_function_privilege($1,'private.is_active_staff_member(uuid)','execute') helper`, [role])).rows[0];
      assert.deepEqual(grants, { roster: role === "service_role", helper: false });
      if (role !== "service_role") {
        await admin(`set role ${role}`);
        try { await assert.rejects(db.query("select public.service_public_staff_memberships()"), { code: "42501" }); }
        finally { await admin(); }
      }
    }
  });

  const invalidations = [
    ["suspended membership", `update public.staff_memberships set status='suspended' where user_id='${owner}'`],
    ["revoked membership", `update public.staff_memberships set status='revoked' where user_id='${owner}'`],
    ["missing Discord identity", `delete from auth.identities where user_id='${owner}'`],
    ["extra identity", `insert into auth.identities(user_id,provider,provider_id) values('${owner}','google','extra-fixture-identity')`],
    ["disabled allowlist", "update private.discord_owner_allowlist set enabled=false"],
    ["mismatched allowlist role", "update private.discord_owner_allowlist set role_key='helper'"],
    ["deleted account", `update auth.users set deleted_at=clock_timestamp() where id='${owner}'`],
    ["anonymous account", `update auth.users set is_anonymous=true where id='${owner}'`],
    ["current account restriction", restriction("clock_timestamp()-interval '1 hour'", "clock_timestamp()+interval '1 hour'")]
  ];
  for (const [label, sql] of invalidations) await t.test(label, async () => {
    await admin("begin");
    try {
      await db.exec(sql);
      assert.deepEqual(await memberIds(), []);
      assert.equal((await db.query("select private.is_active_staff_member($1) value", [owner])).rows[0].value, false);
      if (!["suspended membership", "revoked membership"].includes(label)) {
        assert.equal((await db.query("select count(*)::int n from public.staff_memberships where user_id=$1 and status='active'", [owner])).rows[0].n, 1,
          "the retained active row which caused the original roster mismatch is still present");
      }
    } finally { await admin("rollback"); }
    assert.deepEqual(await memberIds(), [owner]);
  });

  await t.test("offline staff and private profiles stay listed; future, expired and revoked restrictions do not hide them", async () => {
    for (const sql of [
      restriction("clock_timestamp()+interval '1 hour'", "clock_timestamp()+interval '2 hours'"),
      restriction("clock_timestamp()-interval '2 hours'", "clock_timestamp()-interval '1 hour'"),
      restriction("clock_timestamp()-interval '1 hour'", "null", "clock_timestamp()")
    ]) {
      await admin("begin");
      try {
        await db.exec(`delete from auth.sessions; update public.profiles set profile_visibility='private' where id='${owner}'; ${sql}`);
        assert.deepEqual(await memberIds(), [owner]);
      } finally { await admin("rollback"); }
    }
  });

  await t.test("ineligible earlier memberships cannot exhaust the limit and eligible results remain capped at 100", async () => {
    await admin("begin");
    try {
      await db.exec(`
        insert into auth.users(id)
        select ('10000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid from generate_series(1,101) n;
        insert into public.profiles(id,username,display_name)
        select id,'roster_'||right(id::text,12),'Roster fixture' from auth.users where id::text like '10000000-%';
        insert into public.staff_memberships(user_id,role_key,reason,granted_at)
        select id,'helper','Bounded roster fixture','2020-01-01' from auth.users where id::text like '10000000-%';
      `);
      assert.deepEqual(await memberIds(), [owner], "eligibility must be evaluated before LIMIT");
      await db.exec(`
        insert into auth.identities(user_id,provider,provider_id)
        select id,'discord','roster-'||id from auth.users where id::text like '10000000-%';
        insert into private.discord_owner_allowlist(discord_user_id,enabled,role_key)
        select 'roster-'||id,true,'helper' from auth.users where id::text like '10000000-%';
      `);
      const rows = await roster();
      assert.equal(rows.length, 100);
      assert.deepEqual(rows.map(row => row.user_id), Array.from({ length: 100 }, (_, index) => `10000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`));
      assert.ok(rows.every(row => Object.keys(row).sort().join(",") === "granted_at,role_key,status,user_id"));
    } finally { await admin("rollback"); }
  });
});
