import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { privacyFileFixture } from "./privacy-file-fixture.mjs";

const migration = readFileSync(new URL("../supabase/migrations/20260908101606_account_erasure_preflight.sql", import.meta.url), "utf8");

test("account erasure preflight reports dependencies without changing account or evidence", async t => {
  const { db, a, b, owner, sid, admin, login, call } = await privacyFileFixture(t);
  await admin(migration);
  await login(a);
  const deletion = (await call("member_data_requests", ["create", "delete", "Remove my account after the required review.", randomUUID()])).request;
  const copy = (await call("member_data_requests", ["create", "copy", "An account copy for the fixture.", randomUUID()])).request;
  const scan = (row=deletion) => call("staff_account_erasure_preflight", [row.id, row.version]);

  await t.test("owner, permission, current session, allowlist and TOTP are independently enforced", async () => {
    for (const [user, extra] of [[a, {}], [owner, { aal: "aal1" }], [owner, { amr: [{ method: "oauth" }] }]]) {
      await login(user, extra); await assert.rejects(scan(), /active owner account/);
    }
    await admin(`insert into public.staff_memberships(user_id,role_key,reason) values('${b}','helper','Fixture helper');
      insert into private.discord_owner_allowlist values('helper-discord',true,'helper');
      update auth.identities set provider='discord',provider_id='helper-discord' where user_id='${b}';
      insert into public.staff_permission_overrides values('${b}','privacy.requests.manage',true),('${b}','privacy.requests.fulfill',true);`);
    await login(b, { aal: "aal2", app_metadata: { provider: "discord" } });
    await assert.rejects(scan(), /active owner account/);
    for (const [change, restore] of [
      [`delete from auth.sessions where id='${sid(owner)}'`, `insert into auth.sessions(id,user_id) values('${sid(owner)}','${owner}')`],
      [`update auth.sessions set not_after=now()-interval '1 second' where user_id='${owner}'`, `update auth.sessions set not_after=null where user_id='${owner}'`],
      ["update private.discord_owner_allowlist set enabled=false where discord_user_id='owner-discord'", "update private.discord_owner_allowlist set enabled=true where discord_user_id='owner-discord'"],
      [`insert into public.staff_permission_overrides values('${owner}','privacy.requests.fulfill',false)`, `delete from public.staff_permission_overrides where user_id='${owner}'`],
      [`update auth.users set is_anonymous=true where id='${owner}'`, `update auth.users set is_anonymous=false where id='${owner}'`]
    ]) {
      await admin(change); await login(owner); await assert.rejects(scan(), /active owner account/); await admin(restore);
    }
    await login(owner, { session_id: sid(a) }); await assert.rejects(scan(), /active owner account/);
    await login(owner); assert.equal(await call("staff_account_erasure_preflight_access", [deletion.id, deletion.version]), true);
  });

  await t.test("request identity, current version and open deletion kind are mandatory", async () => {
    await login(owner);
    await assert.rejects(scan(copy), /Deletion request not found/);
    await assert.rejects(scan({ id: randomUUID(), version: 1 }), /Deletion request not found/);
    await assert.rejects(scan({ ...deletion, version: 0 }), /current deletion request/);
    await assert.rejects(scan({ ...deletion, version: deletion.version + 1 }), /changed or closed/);
  });

  let first;
  await t.test("count-only report finds restrictive immutable evidence and non-FK activity, never private content", async () => {
    await login(owner); first = await scan();
    assert.equal(first.mode, "read-only"); assert.equal(first.executionEnabled, false);
    assert.equal(first.subjectId, a); assert.equal(first.coverage.fullErasureInventory, false);
    const request = first.dependencies.find(x => x.relation === "private.account_data_requests" && x.category === "account");
    assert.equal(request.count, 2); assert.equal(request.via.at(-1).deleteAction, "no_action");
    const history = first.dependencies.find(x => x.relation === "private.account_data_request_history" && x.category === "account");
    assert.equal(history.count, 2); assert.ok(history.triggers.includes("immutable_data_request_history"));
    assert.equal(first.dependencies.find(x => x.category === "security_activity" && !x.via.length).count, 1);
    assert.equal(first.dependencies.find(x => x.category === "auth_sessions" && !x.via.length).count, 1);
    assert.doesNotMatch(JSON.stringify(first), /FORBIDDEN|OTHER_PRIVATE|Own notice|My private biography|Remove my account/);
    assert.ok(first.policyDecisions.find(x => x.id === "backups"));
    assert.ok(first.coverage.missingRelations.find(x => x.relation === "private.staff_work_sessions" && x.optional));
    await admin();
    assert.equal((await db.query("select status,version from private.account_data_requests where id=$1", [deletion.id])).rows[0].status, "submitted");
    assert.equal((await db.query("select count(*)::int n from auth.users")).rows[0].n, 3);
    assert.equal((await db.query("select count(*)::int n from auth.sessions")).rows[0].n, 3);
    assert.equal((await db.query("select count(*)::int n from public.staff_audit_events")).rows[0].n, 0);
    await db.exec("begin");
    await assert.rejects(db.query("delete from auth.users where id=$1", [a]), /foreign key constraint/);
    await db.exec("rollback");
  });

  await t.test("installed duty, fresh foreign keys and orphan storage paths are discovered on every scan", async () => {
    await admin(`create table private.staff_duty_state(user_id uuid primary key references public.profiles(id) on delete cascade);
      create table private.staff_work_sessions(id uuid primary key,user_id uuid references public.profiles(id) on delete cascade);
      create table private.staff_duty_requests(actor_id uuid references public.profiles(id) on delete cascade);
      create table private.member_recommendation_preferences(user_id uuid primary key references auth.users(id) on delete cascade,choice text);
      create table private.erasure_fixture_evidence(id uuid primary key,session_id uuid references private.staff_work_sessions(id) on delete restrict);
      insert into private.staff_duty_state values('${a}');
      insert into private.staff_work_sessions values('dddddddd-0000-4000-8000-000000000001','${a}');
      insert into private.staff_duty_requests values('${a}');
      insert into private.member_recommendation_preferences values('${a}','rejected');
      insert into private.erasure_fixture_evidence values(gen_random_uuid(),'dddddddd-0000-4000-8000-000000000001');
      insert into storage.objects(bucket_id,name,owner_id) values('profile-media','${a}/orphan.png',null),('advertisements','staff/${a}/own.png',null),('profile-media','${b}/other.png',null);
      insert into public.staff_audit_events(actor_id,action,target_type,target_id,reason,before_state)
      values('${owner}','staff.work.corrected','staff_work_session','dddddddd-0000-4000-8000-000000000001','Fixture correction',jsonb_build_object('userId','${a}','privateText','FORBIDDEN_CORRECTION'));`);
    await login(owner); const result = await scan();
    assert.equal(result.dependencies.find(x => x.category === "staff_work_sessions" && !x.via.length).count, 1);
    assert.equal(result.dependencies.find(x => x.category === "member_optional_preference" && !x.via.length).count, 1);
    assert.ok(result.dependencies.find(x => x.relation === "private.erasure_fixture_evidence" && x.count === 1 && x.via.at(-1).deleteAction === "restrict"));
    assert.equal(result.summary.storedObjects, 2);
    assert.equal(result.dependencies.find(x => x.category === "audit_account_reference" && !x.via.length).count, 1);
    assert.doesNotMatch(JSON.stringify(result), /orphan.png|FORBIDDEN_CORRECTION|other.png/);
    assert.equal(result.coverage.missingRelations.some(x => x.relation === "private.staff_work_sessions"), false);
    await admin(); assert.equal((await db.query("select count(*)::int n from storage.objects")).rows[0].n, 3);
  });

  await t.test("bounded counts are explicitly lower bounds and never presented as a complete erasure inventory", async () => {
    await admin(`insert into public.account_activity(user_id,event_type) select '${a}','auth.signed_in' from generate_series(1,1001)`);
    await login(owner); const result = await scan();
    const activity = result.dependencies.find(x => x.category === "security_activity" && !x.via.length);
    assert.equal(activity.count, 1000); assert.equal(activity.countIsLowerBound, true);
    assert.equal(result.coverage.boundedCountsComplete, false); assert.equal(result.executionEnabled, false);
  });

  await t.test("a cyclic dependency is bounded and marked incomplete rather than being silently ignored", async () => {
    await admin("alter table private.erasure_fixture_evidence add column previous_id uuid references private.erasure_fixture_evidence(id)");
    await login(owner); const result = await scan();
    assert.equal(result.coverage.dependencyGraphComplete, false);
    assert.ok(result.coverage.dependencyPathsInspected <= result.coverage.maxPaths);
    assert.equal(result.coverage.fullErasureInventory, false);
  });

  await t.test("read-only transaction succeeds and withdrawn requests invalidate access and scans", async () => {
    await login(owner); await db.exec("begin read only"); await scan(); await db.exec("commit");
    await login(a); await call("member_data_requests", ["withdraw", null, null, null, deletion.id, deletion.version]);
    await login(owner); await assert.rejects(scan(), /changed or closed/);
    await assert.rejects(call("staff_account_erasure_preflight_access", [deletion.id, deletion.version]), /changed or closed/);
  });

  await t.test("anonymous/service roles cannot call the report or internal guard", async () => {
    for (const role of ["anon", "service_role"]) {
      await admin(`set role ${role}`); await assert.rejects(scan(), /permission denied/);
      await assert.rejects(call("staff_account_erasure_preflight_access", [deletion.id, deletion.version]), /permission denied/);
    }
    await login(owner);
    await assert.rejects(db.query("select private.require_account_erasure_review($1,$2)", [deletion.id, deletion.version]), /permission denied/);
  });
});
