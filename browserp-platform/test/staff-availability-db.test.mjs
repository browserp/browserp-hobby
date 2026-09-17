import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { staffHierarchyFixture, read, fn } from "./staff-hierarchy-fixture.mjs";

const migration = read("20260917025113_staff_availability_without_work_sessions.sql");
test("staff availability replaces work-session operations without weakening staff security", async t => {
  const { db, admin, login, call, ids, sid, restrict } = await staffHierarchyFixture(t);
  await admin(fn(read("20260905200710_serialize_staff_authenticator_management.sql"), "public.staff_authenticator_access"));
  await admin(read("20260908100259_explicit_staff_duty_sessions.sql"));
  const mutate = (availability = "busy", key = randomUUID(), action = "set_availability") => call("staff_duty_mutate", [action, key, availability], "text,uuid,text");
  const view = (kind = "self", limit = 25, cursor = null) => call("staff_duty_read", [kind, null, null, limit, null, null, null, cursor], "text,timestamptz,timestamptz,integer,timestamptz,uuid,uuid,uuid");
  const historicalRows = async () => {
    await admin();
    return (await db.query(`select
      (select jsonb_agg(to_jsonb(s) order by id) from private.staff_work_sessions s) sessions,
      (select jsonb_agg(to_jsonb(s) order by actor_id,request_key) from private.staff_duty_requests s) requests,
      (select jsonb_agg(to_jsonb(s) order by id) from public.staff_audit_events s) audits,
      (select jsonb_agg(to_jsonb(s) order by user_id) from private.staff_duty_state s) availability`)).rows[0];
  };
  await login();
  const oldClockKey = randomUUID(), oldAvailabilityKey = randomUUID();
  await call("staff_duty_mutate", ["clock_in", oldClockKey], "text,uuid");
  const oldReceipt = await mutate("available", oldAvailabilityKey);
  assert.ok(oldReceipt.duty.openSession);
  await admin(`insert into private.staff_duty_state(user_id,availability) values('${ids.support}','off_duty');
    insert into private.staff_work_sessions(user_id,started_at,ended_at,status)
      values('${ids.support}',now()-interval '2 days',now()-interval '1 day','confirmed');`);
  const before = await historicalRows();

  // Fault injection runs immediately after the actual lock statement. PGlite
  // uses one connection, so this tests continuation guards, not real concurrency.
  await admin(`create function private.fixture_availability_wait() returns void language plpgsql as $$
    begin if current_setting('fixture.expire_after_lock',true)='yes' then
      update auth.sessions set not_after=clock_timestamp()-interval '1 second' where user_id=auth.uid();
    end if;end;$$;`);
  const lock = "perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('staff-duty-request:'||actor::text,0));";
  assert.equal(migration.split(lock).length, 2);
  await admin(migration.replace(lock, `${lock}\n  perform private.fixture_availability_wait();`));

  await t.test("migration preserves every historical record and exposes only availability", async () => {
    assert.deepEqual(await historicalRows(), before);
    await login("support");
    const self = await view(); assert.equal(self.duty.availability, "away");
    assert.deepEqual(Object.keys(self.duty).sort(), ["availability", "updatedAt"]);
    assert.doesNotMatch(JSON.stringify(self), /openSession|confirmedSeconds|startedAt|endedAt|sessions|totals/);
    assert.equal(self.canManageTeam, false);
    const roster = await view("availability", 2);
    assert.equal(roster.availability.length, 2); assert.ok(roster.nextAfterUserId);
    const next = await view("availability", 2, roster.nextAfterUserId);
    assert.ok(next.availability.every(row => row.userId > roster.nextAfterUserId));
    assert.doesNotMatch(JSON.stringify(roster), /email|session|hours/i);
  });
  await t.test("legacy retries return no work data and retired operations cannot change old rows", async () => {
    await login();
    const receipt = await mutate("available", oldAvailabilityKey);
    assert.deepEqual(receipt.duty, { availability: "available", updatedAt: oldReceipt.duty.updatedAt });
    assert.doesNotMatch(JSON.stringify(receipt), /openSession|session|confirmedSeconds/);
    for (const action of ["clock_in", "clock_out", "confirm_session", "correct_session"]) {
      await assert.rejects(mutate(null, oldClockKey, action), /Work sessions are no longer available/);
    }
    await assert.rejects(view("team"), /hours are no longer available/);
    await assert.rejects(call("staff_duty_read", ["self", null, null, 25, null, null, ids.support], "text,timestamptz,timestamptz,integer,timestamptz,uuid,uuid"), /hours are no longer available/);
    assert.deepEqual(await historicalRows(), before);
  });
  await t.test("availability changes only the caller, stays audited and remains retry-safe", async () => {
    await login("support"); const key = randomUUID(), result = await mutate("busy", key);
    assert.equal(result.duty.availability, "busy"); assert.equal(result.changed, true);
    assert.deepEqual(await mutate("busy", key), result);
    await assert.rejects(mutate("away", key), /already used/);
    for (const value of ["away", "available"]) assert.equal((await mutate(value)).duty.availability, value);
    await assert.rejects(mutate("off_duty"), /Available, Busy or Away/);
    await assert.rejects(call("staff_duty_mutate", ["set_availability", randomUUID(), "busy", randomUUID()], "text,uuid,text,uuid"), /valid request key/);
    await admin();
    const audits = (await db.query("select actor_id,target_id,before_state,after_state from public.staff_audit_events where request_id=$1", [key])).rows;
    assert.equal(audits.length, 1); assert.equal(audits[0].actor_id, ids.support); assert.equal(audits[0].target_id, ids.support);
    assert.equal(audits[0].after_state.availability, "busy");
    assert.doesNotMatch(JSON.stringify(audits), /openSession|confirmedSeconds/);
    assert.deepEqual((await historicalRows()).sessions, before.sessions);
  });
  await t.test("real staff actions require their capability but never a work session", async () => {
    await login("moderator"); await admin("begin");
    try {
      await db.exec("set role authenticated");
      assert.ok((await restrict(ids.member, 60)).id);
      await admin();
      assert.equal((await db.query("select count(*)::int n from private.staff_work_sessions where user_id=$1", [ids.moderator])).rows[0].n, 0);
      assert.ok((await db.query("select count(*)::int n from public.staff_audit_events where actor_id=$1", [ids.moderator])).rows[0].n > 0);
    } finally { await db.exec("rollback"); }
    await login("support"); await assert.rejects(restrict(ids.member, 60), /permit/);
  });
  await t.test("ordinary, invalid-provider, low-MFA, expired and suspended sessions remain denied", async () => {
    await login("member"); await assert.rejects(view(), /active verified staff/);
    for (const extra of [{ aal: "aal1" }, { amr: [{ method: "oauth" }] }, { app_metadata: { provider: "google" } }, { session_id: sid(ids.owner) }]) {
      await login("support", extra); await assert.rejects(view(), /active verified staff/); await assert.rejects(mutate(), /active verified staff/);
    }
    for (const change of [
      `update auth.sessions set not_after=clock_timestamp()-interval '1 second' where user_id='${ids.support}'`,
      `delete from auth.sessions where user_id='${ids.support}'`,
      `update public.staff_memberships set status='suspended' where user_id='${ids.support}'`,
      `update private.discord_owner_allowlist set enabled=false where role_key='support'`
    ]) {
      await admin(`begin;${change}`);
      try { await login("support"); await assert.rejects(view(), /active verified staff/); }
      finally { await db.exec("rollback"); }
    }
    await admin("begin");
    try { await login(); await restrict(ids.support, 60); await login("support"); await assert.rejects(mutate(), /active verified staff/); }
    finally { await db.exec("rollback"); }
  });
  await t.test("rate-limit denial and audit failure roll back availability and retry state", async () => {
    const snapshot = await historicalRows();
    await admin();
    const bucket = (await db.query("select request_count from public.rate_limit_buckets where key_hash=md5('member:'||$1::text) and action='member-db:staff-duty'", [ids.support])).rows[0];
    await db.query("update public.rate_limit_buckets set request_count=60 where key_hash=md5('member:'||$1::text) and action='member-db:staff-duty'", [ids.support]);
    await login("support"); await assert.rejects(mutate(), /Too many|rate limit/i);
    assert.deepEqual(await historicalRows(), snapshot);
    await admin();
    await db.query("update public.rate_limit_buckets set request_count=$2 where key_hash=md5('member:'||$1::text) and action='member-db:staff-duty'", [ids.support, bucket.request_count]);
    await admin(`create function private.fixture_availability_audit() returns trigger language plpgsql as $$
      begin if current_setting('fixture.expire_at_audit',true)='yes' then
        update auth.sessions set not_after=clock_timestamp()-interval '1 second' where user_id=auth.uid();
      else raise exception 'Fixture audit failure';end if;return new;end;$$;
      create trigger fixture_availability_audit before insert on public.staff_audit_events
        for each row execute function private.fixture_availability_audit();`);
    await login("support"); await assert.rejects(mutate(), /Fixture audit failure/);
    assert.deepEqual(await historicalRows(), snapshot);
    await admin("select set_config('fixture.expire_at_audit','yes',false)");
    await login("support"); await assert.rejects(mutate(), /active verified staff/);
    assert.deepEqual(await historicalRows(), snapshot);
    await admin("drop trigger fixture_availability_audit on public.staff_audit_events");
  });
  await t.test("a cached retry still checks session expiry after its lock", async () => {
    await admin("select set_config('fixture.expire_after_lock','yes',false)");
    await login(); await assert.rejects(mutate("available", oldAvailabilityKey), /active verified staff/);
    await admin("select set_config('fixture.expire_after_lock','',false)");
  });
  await t.test("direct private data and anonymous/service RPC access stay denied", async () => {
    await login();
    for (const table of ["staff_duty_state", "staff_work_sessions", "staff_duty_requests"]) {
      await assert.rejects(db.query(`select * from private.${table}`), /permission denied/);
    }
    await assert.rejects(db.query("select private.staff_duty_json(auth.uid())"), /permission denied/);
    for (const role of ["anon", "service_role"]) {
      await admin(`set role ${role}`); await assert.rejects(view(), /permission denied/); await assert.rejects(mutate(), /permission denied/);
    }
  });
});
