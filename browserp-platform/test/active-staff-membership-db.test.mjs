import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { privacyFileFixture } from "./privacy-file-fixture.mjs";

const source = readFileSync(new URL("../supabase/migrations/20260909105431_staff_capability_hierarchy.sql", import.meta.url), "utf8");
const helper = source.match(/create function private\.is_active_staff_member\(p_user uuid\)[\s\S]*?revoke all on function private\.is_active_staff_member\(uuid\)[^;]+;/)[0];

test("the actual canonical staff helper binds persistent authority without session or badge dependence", async t => {
  const { db, owner, a, admin } = await privacyFileFixture(t);
  await admin(helper);
  const eligible = async user => (await db.query("select private.is_active_staff_member($1) value", [user])).rows[0].value;
  assert.equal(await eligible(owner), true);
  assert.equal(await eligible(a), false);
  assert.equal(await eligible(null), false);
  const changes = [
    ["suspended membership", `update public.staff_memberships set status='suspended' where user_id='${owner}'`],
    ["revoked membership", `update public.staff_memberships set status='revoked' where user_id='${owner}'`],
    ["disabled allowlist", "update private.discord_owner_allowlist set enabled=false"],
    ["mismatched actual role", "update private.discord_owner_allowlist set role_key='helper'"],
    ["deleted auth user", `update auth.users set deleted_at=now() where id='${owner}'`],
    ["anonymous auth user", `update auth.users set is_anonymous=true where id='${owner}'`],
    ["second identity", `insert into auth.identities(user_id,provider,provider_id) values('${owner}','google','extra-fixture-identity')`],
    ["active account restriction", `insert into public.security_bans(user_id,target_type,target_hash,public_reference,reason_code,reason,actor_id,starts_at,ends_at) values('${owner}','account',repeat('a',64),'BRP-1234567890','fixture','An active fixture restriction','${owner}',clock_timestamp()-interval '1 hour',clock_timestamp()+interval '1 hour')`]
  ];
  for (const [label, sql] of changes) await t.test(label, async () => {
    await admin("begin");
    try { await db.exec(sql); assert.equal(await eligible(owner), false); }
    finally { await db.exec("rollback"); }
    assert.equal(await eligible(owner), true);
  });
  await t.test("expired/revoked restrictions and being offline do not mislabel current staff", async () => {
    await admin("begin");
    try {
      await db.exec(`delete from auth.sessions;insert into public.security_bans(user_id,target_type,target_hash,public_reference,reason_code,reason,actor_id,starts_at,ends_at)
        values('${owner}','account',repeat('a',64),'BRP-1234567890','fixture','An expired fixture restriction','${owner}',clock_timestamp()-interval '2 hours',clock_timestamp()-interval '1 hour');`);
      assert.equal(await eligible(owner), true);
      await db.exec("update public.security_bans set ends_at=null,revoked_at=clock_timestamp()");
      assert.equal(await eligible(owner), true);
    } finally { await db.exec("rollback"); }
  });
  await t.test("raw clients cannot call the internal predicate", async () => {
    for (const role of ["anon", "authenticated", "service_role"]) {
      await admin(`set role ${role}`);
      await assert.rejects(eligible(owner), /permission denied/);
    }
  });
  t.diagnostic(`Canonical helper SHA-256: ${createHash("sha256").update(helper).digest("hex")}`);
});
