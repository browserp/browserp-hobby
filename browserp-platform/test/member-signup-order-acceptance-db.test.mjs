import test from "node:test";
import assert from "node:assert/strict";
import { staffHierarchyFixture, read } from "./staff-hierarchy-fixture.mjs";

const acceptance = read("20260917034343_accept_retained_member_signup_order.sql");
const id = n => `77777777-0000-4000-8000-${String(n).padStart(12, "0")}`;

async function fixture(t) {
  const h = await staffHierarchyFixture(t), { db, admin, call } = h;
  await admin(read("202608180001_browserp_core.sql").match(/insert into public\.badges \(key, name, description, icon_key, color, system_managed\) values[\s\S]*?;/)[0]);
  await admin(read("20260909163000_member_badges.sql"));
  const profile = async who => {
    await admin();
    await db.query("insert into public.profiles(id,username,display_name) values($1,$2,'BrowseRP member')", [who, `signup_${who.slice(-12)}`]);
  };
  const signup = async (who, { anonymous = false, withProfile = true } = {}) => {
    await admin();
    await db.query("insert into auth.users(id,is_anonymous) values($1,$2)", [who, anonymous]);
    if (withProfile) await profile(who);
  };
  const awards = async who => {
    await admin();
    return (await db.query(`select b.key from public.user_badges u join public.badges b on b.id=u.badge_id
      where u.user_id=$1 and b.key in ('first_100','first_500') order by b.key`, [who])).rows.map(row => row.key);
  };
  const publicBadges = async who => {
    await admin(); await db.exec("set role anon");
    return call("member_badges", [who], "uuid");
  };
  const counter = async () => {
    await admin();
    return (await db.query("select * from private.member_signup_counter")).rows[0];
  };
  const order = async () => {
    await admin();
    return (await db.query("select user_id,signup_ordinal,ordering_unambiguous,recorded_at from private.member_signup_order order by signup_ordinal")).rows;
  };
  return { ...h, signup, profile, awards, publicBadges, counter, order };
}

test("accepted retained signup order activates normal badges for every qualifying member", async t => {
  const h = await fixture(t), { db, admin, ids, signup, profile, awards, publicBadges, counter, order } = h;
  const publicMember = id(1001), pending = id(1002), deleted = id(1003);
  const changedToAnonymous = id(1004), anonymous = id(1005), deletedPending = id(1006);
  for (const who of [publicMember, deleted, changedToAnonymous]) await signup(who);
  for (const who of [pending, deletedPending]) await signup(who, { withProfile: false });
  await signup(anonymous, { anonymous: true });
  await admin();
  await db.query("update auth.users set deleted_at=now() where id in ($1,$2)", [deleted, deletedPending]);
  await db.query("update auth.users set is_anonymous=true where id=$1", [changedToAnonymous]);
  await db.query("update public.profiles set profile_visibility='private' where id=$1", [ids.otherMember]);

  const orderBefore = await order(), counterBefore = await counter();
  const catalogueBefore = (await db.query("select * from public.badges order by key")).rows;
  const definitionsBefore = (await db.query(`select p.oid::regprocedure::text name,pg_get_functiondef(p.oid) definition
    from pg_proc p where p.oid in ('private.is_active_staff_member(uuid)'::regprocedure,
      'private.record_member_signup_order()'::regprocedure,'private.member_badge_projection(uuid)'::regprocedure)
    order by name`)).rows;
  const rolesBefore = (await db.query("select * from public.staff_roles order by key")).rows;
  const permissionsBefore = (await db.query("select * from public.staff_role_permissions order by role_key,permission_key")).rows;
  assert.deepEqual(await awards(publicMember), []);
  await admin(acceptance);

  await t.test("records honest private acceptance without renumbering or changing the catalogue", async () => {
    const current = await counter();
    assert.equal(current.chronology_confirmed, true);
    assert.ok(current.confirmed_at);
    assert.equal(current.last_ordinal, counterBefore.last_ordinal);
    assert.match(current.evidence_reference, /George-authorized acceptance of retained signup order, 2026-09-17/);
    assert.match(current.evidence_reference, /all qualifying registered members, including public signups/);
    assert.match(current.evidence_reference, /not recovered; complete lifetime chronology is not asserted/);
    assert.doesNotMatch(current.evidence_reference, /development badge|staff-only/i);
    assert.deepEqual(await order(), orderBefore);
    assert.deepEqual((await db.query("select * from public.badges order by key")).rows, catalogueBefore);
    for (const who of [ids.owner, ids.member, ids.otherMember, publicMember]) {
      assert.deepEqual(await awards(who), ["first_100", "first_500"]);
    }
    for (const who of [pending, deleted, deletedPending, changedToAnonymous, anonymous]) {
      assert.deepEqual(await awards(who), []);
    }
  });

  await t.test("public output keeps the normal names, strongest milestone, and profile visibility", async () => {
    const value = await publicBadges(publicMember);
    assert.deepEqual(value, { badges: [{ kind: "first_100", label: "First 100",
      description: "One of the first 100 BrowseRP members.", iconKey: "milestone-100" }], staffRole: null });
    assert.doesNotMatch(JSON.stringify(value), /George|retained|ordinal|evidence|development/i);
    assert.equal(await publicBadges(ids.otherMember), null);
    await h.login("otherMember");
    assert.deepEqual((await h.call("member_badges", [ids.otherMember], "uuid")).badges.map(b => b.kind), ["first_100"]);
    for (const who of [deleted, changedToAnonymous, anonymous]) {
      assert.deepEqual(await publicBadges(who), { badges: [], staffRole: null });
    }
  });

  await t.test("late profiles and anonymous conversion award once, while inactive accounts stay ineligible", async () => {
    await profile(pending);
    assert.deepEqual(await awards(pending), ["first_100", "first_500"]);
    await profile(deletedPending);
    await admin();
    for (const who of [pending, deleted, deletedPending, changedToAnonymous]) {
      await db.query("select private.award_member_signup_badges($1)", [who]);
    }
    assert.deepEqual(await awards(pending), ["first_100", "first_500"]);
    for (const who of [deleted, deletedPending, changedToAnonymous]) assert.deepEqual(await awards(who), []);
    const before = await counter();
    await db.query("update auth.users set is_anonymous=false where id=$1", [anonymous]);
    assert.deepEqual(await awards(anonymous), ["first_100", "first_500"]);
    assert.equal((await db.query("select signup_ordinal from private.member_signup_order where user_id=$1", [anonymous])).rows[0].signup_ordinal, before.last_ordinal + 1);
  });

  await t.test("replay preserves the confirmation, ordinal allocation, and existing award timestamps", async () => {
    const before = await counter(), beforeOrder = await order();
    const beforeAwards = (await db.query("select * from public.user_badges order by user_id,badge_id")).rows;
    await admin(acceptance);
    assert.deepEqual(await counter(), before);
    assert.deepEqual(await order(), beforeOrder);
    assert.deepEqual((await db.query("select * from public.user_badges order by user_id,badge_id")).rows, beforeAwards);
  });

  await t.test("private evidence and helper remain inaccessible and staff authority is unchanged", async () => {
    await admin();
    assert.deepEqual((await db.query(`select p.oid::regprocedure::text name,pg_get_functiondef(p.oid) definition
      from pg_proc p where p.oid in ('private.is_active_staff_member(uuid)'::regprocedure,
        'private.record_member_signup_order()'::regprocedure,'private.member_badge_projection(uuid)'::regprocedure)
      order by name`)).rows, definitionsBefore);
    assert.deepEqual((await db.query("select * from public.staff_roles order by key")).rows, rolesBefore);
    assert.deepEqual((await db.query("select * from public.staff_role_permissions order by role_key,permission_key")).rows, permissionsBefore);
    assert.deepEqual((await db.query("select relrowsecurity from pg_class where oid in ('private.member_signup_order'::regclass,'private.member_signup_counter'::regclass)")).rows.map(row => row.relrowsecurity), [true, true]);
    for (const role of ["anon", "authenticated", "service_role"]) {
      const acl = (await db.query(`select
        has_table_privilege($1,'private.member_signup_order','select') ledger_read,
        has_table_privilege($1,'private.member_signup_counter','select') evidence_read,
        has_function_privilege($1,'private.award_member_signup_badges(uuid)','execute') award`, [role])).rows[0];
      assert.deepEqual(acl, { ledger_read: false, evidence_read: false, award: false });
      await db.exec(`set role ${role}`);
      await assert.rejects(db.query("select evidence_reference from private.member_signup_counter"), /permission denied/);
      await assert.rejects(db.query("select private.award_member_signup_badges($1)", [publicMember]), /permission denied/);
      await admin();
    }
    await h.login("member");
    await assert.rejects(h.call("staff_role_control"), /permission|staff|session/i);
  });

  await t.test("future signups respect 100 and 500 and deleted slots are never reused", async () => {
    const start = (await counter()).last_ordinal + 1;
    await db.query(`insert into auth.users(id)
      select ('77777777-1111-4000-8000-'||lpad(n::text,12,'0'))::uuid
      from generate_series($1::int,501) n order by n`, [start]);
    await db.exec(`insert into public.profiles(id,username,display_name)
      select u.id,'future_'||right(u.id::text,12),'BrowseRP member'
      from auth.users u where u.id::text like '77777777-1111-%' order by u.id`);
    const lookup = async ordinal => {
      await admin();
      return (await db.query("select user_id from private.member_signup_order where signup_ordinal=$1", [ordinal])).rows[0].user_id;
    };
    const hundred = await lookup(100), hundredOne = await lookup(101), fiveHundred = await lookup(500), fiveHundredOne = await lookup(501);
    for (const [who, stored, displayed] of [
      [hundred, ["first_100", "first_500"], ["first_100"]],
      [hundredOne, ["first_500"], ["first_500"]],
      [fiveHundred, ["first_500"], ["first_500"]],
      [fiveHundredOne, [], []]
    ]) {
      assert.deepEqual(await awards(who), stored);
      assert.deepEqual((await publicBadges(who)).badges.map(b => b.kind), displayed);
    }
    await admin();
    await db.query("delete from auth.users where id in ($1,$2)", [hundred, fiveHundredOne]);
    await signup(id(9000));
    assert.equal((await counter()).last_ordinal, 502);
    assert.equal((await db.query("select signup_ordinal from private.member_signup_order where user_id=$1", [id(9000)])).rows[0].signup_ordinal, 502);
    assert.deepEqual(await awards(id(9000)), []);
    assert.deepEqual((await publicBadges(hundredOne)).badges.map(b => b.kind), ["first_500"]);
    await admin();
    assert.equal((await db.query("select count(*)=count(distinct signup_ordinal) unique_ordinals from private.member_signup_order")).rows[0].unique_ordinals, true);
    assert.equal((await db.query("select count(*)::int n from private.member_signup_order where signup_ordinal in (100,501)")).rows[0].n, 0);
  });
});

test("acceptance fails closed on an incomplete order and preserves ambiguous-boundary safeguards", async t => {
  const h = await fixture(t), { db, admin, ids, counter, publicBadges, awards } = h;
  const initialCounter = await counter();
  await admin("update private.member_signup_counter set last_ordinal=0");
  await assert.rejects(admin(acceptance), /counter is behind/);
  await db.exec("rollback");
  assert.equal((await counter()).chronology_confirmed, false);
  await db.query("update private.member_signup_counter set last_ordinal=$1", [initialCounter.last_ordinal]);

  const retained = (await db.query("delete from private.member_signup_order where user_id=$1 returning *", [ids.member])).rows[0];
  await assert.rejects(admin(acceptance), /registered member is missing/);
  await db.exec("rollback");
  assert.equal((await counter()).evidence_reference, null);
  assert.deepEqual(await awards(ids.owner), []);
  await db.query(`insert into private.member_signup_order(user_id,signup_ordinal,ordering_unambiguous,cohort_confirmed,recorded_at)
    values($1,$2,$3,$4,$5)`, [retained.user_id, retained.signup_ordinal, retained.ordering_unambiguous, retained.cohort_confirmed, retained.recorded_at]);

  await db.query("update private.member_signup_order set ordering_unambiguous=false where user_id=$1", [ids.member]);
  await admin(acceptance);
  assert.deepEqual(await awards(ids.member), []);
  assert.deepEqual((await publicBadges(ids.member)).badges, []);
  assert.deepEqual(await awards(ids.otherMember), ["first_100", "first_500"]);
});
