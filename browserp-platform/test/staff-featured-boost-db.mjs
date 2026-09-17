import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { read, staffHierarchyFixture } from "./staff-hierarchy-fixture.mjs";

test("staff featured Boost uses real permissions, sessions, audit and listing state", async t => {
  const { db, admin, login, call, ids, sid } = await staffHierarchyFixture(t);
  await admin(read("20260916130000_staff_featured_boost.sql"));
  const first = "22222222-2222-4222-8222-222222222222", second = "33333333-3333-4333-8333-333333333333";
  await admin("insert into public.platforms(id,name,short_name) values('fivem','FiveM','FiveM')");
  await db.query(`insert into public.servers(id,platform_id,name,slug,description,region,status,published_at)
    values($1,'fivem','First RP','first-rp',repeat('Roleplay ',8),'Europe','published',now()),
          ($2,'fivem','Second RP','second-rp',repeat('Roleplay ',8),'Europe','published',now())`, [first, second]);
  await db.query("insert into public.boosts(server_id,actor_id,source,amount) values($1,$2,'daily_free',1),($1,$2,'promotion_credit',3)", [first, ids.member]);
  const change = (overrides = {}) => {
    const x = { action: "start", server: first, hours: 1, version: 0, reason: "Staff-curated homepage feature", request: randomUUID(), ...overrides };
    return call("staff_set_featured_boost", [x.action, x.server, x.hours, x.version, x.reason, x.request], "text,uuid,integer,bigint,text,text");
  };
  const rejected = async (operation, expected) => {
    await db.exec("savepoint expected_rejection");
    try { await assert.rejects(operation, expected); }
    finally { await db.exec("rollback to savepoint expected_rejection; release savepoint expected_rejection"); }
  };
  const scenario = (name, run) => t.test(name, async () => {
    await admin("begin");
    try { await login(); await run(); }
    finally { await db.exec("rollback; reset role"); }
  });
  const memberRows = async () => { await admin(); return (await db.query("select * from public.boosts order by id")).rows; };

  await scenario("start, replace and end preserve member boosts and record the actual target", async () => {
    const before = await memberRows(); await login();
    const started = await change(); assert.equal(started.version, 1);
    assert.equal((Date.parse(started.expiresAt) - Date.parse(started.startsAt)) / 3_600_000, 1);
    const publicFeature = await call("public_featured_boost");
    assert.deepEqual(Object.keys(publicFeature).sort(), ["expiresAt", "slug"]); assert.equal(publicFeature.slug, "first-rp");
    const replaced = await change({ server: second, hours: 720, version: 1 });
    assert.equal((Date.parse(replaced.expiresAt) - Date.parse(replaced.startsAt)) / 3_600_000, 720);
    const control = await call("staff_featured_boost_control");
    assert.equal(control.canManage, true); assert.equal(control.active.serverId, second);
    // A direct caller cannot mislabel the ended server by supplying a different ID.
    await change({ action: "end", server: first, hours: null, version: 2 });
    assert.equal(await call("public_featured_boost"), null);
    await admin();
    const events = (await db.query("select * from public.staff_audit_events where action like 'featured_boost.%' order by id")).rows;
    assert.equal(events.length, 3); assert.equal(events[2].target_id, second);
    assert.equal(events[2].before_state.serverId, second); assert.equal(events[2].after_state.serverId, second);
    assert.equal(events[2].after_state.version, 3); assert.equal(events[0].actor_id, ids.owner);
    assert.deepEqual(await memberRows(), before);
  });
  await scenario("Overview-only staff receive no management data, while members and anonymous writes fail", async () => {
    await change(); await login("support");
    assert.deepEqual(await call("staff_featured_boost_control"), { canManage: false });
    await rejected(() => change({ version: 1 }), /permit|permission/i);
    await rejected(() => db.query("select * from private.staff_featured_boost"), /permission denied/i);
    await login("member");
    await rejected(() => call("staff_featured_boost_control"), /permission/i);
    await rejected(() => change({ version: 1 }), /permit|permission/i);
    await admin("set role anon");
    assert.equal((await call("public_featured_boost")).slug, "first-rp");
    await rejected(() => call("staff_featured_boost_control"), /permission denied/i);
    await rejected(() => change({ version: 1 }), /permission denied/i);
    await admin("set role service_role");
    await rejected(() => change({ version: 1 }), /permission denied/i);
  });
  await scenario("null action, invalid duration, missing version and malformed requests cannot mutate", async () => {
    await change();
    for (const overrides of [
      { action: null }, { action: "remove" }, { hours: null }, { hours: 0 }, { hours: -1 }, { hours: 721 },
      { server: null }, { server: randomUUID() }, { version: null }, { version: -1 },
      { reason: "four" }, { reason: "x".repeat(501) }, { request: null }, { request: "bad-id" }
    ]) await rejected(() => change({ version: 1, ...overrides }), { code: "22023" });
    assert.equal((await call("staff_featured_boost_control")).version, 1);
  });
  await scenario("version conflicts and replayed requests cannot replace a newer feature", async () => {
    const request = randomUUID(); const started = await change({ request });
    assert.deepEqual(await change({ request }), started);
    await rejected(() => change({ server: second }), { code: "PT409" });
    await admin(); assert.equal((await db.query("select count(*)::int n from public.staff_audit_events where action like 'featured_boost.%'")).rows[0].n, 1);
  });
  await scenario("expiry and a future start suppress the public feature automatically", async () => {
    await change();
    await admin("update private.staff_featured_boost set starts_at=now()-interval '2 hours',ends_at=now()-interval '1 hour'"); await login();
    assert.equal(await call("public_featured_boost"), null);
    assert.equal((await call("staff_featured_boost_control")).active, null);
    await rejected(() => change({ action: "end", version: 1 }), /no active/i);
    await change({ server: second, version: 1 });
    await admin("update private.staff_featured_boost set starts_at=now()+interval '1 hour',ends_at=now()+interval '2 hours'"); await login();
    assert.equal(await call("public_featured_boost"), null);
    assert.equal((await call("staff_featured_boost_control")).active, null);
  });
  await scenario("suspended and unpublished listings disappear and cannot receive a boost", async () => {
    await change();
    for (const assignment of ["status='suspended'", "status='draft'", "status='published',published_at=null"]) {
      await admin(`update public.servers set ${assignment} where id='${first}'`); await login();
      assert.equal(await call("public_featured_boost"), null);
      const control = await call("staff_featured_boost_control");
      assert.equal(control.active, null); assert.equal(control.servers.some(s => s.id === first), false);
      await rejected(() => change({ version: 1 }), /published server/i);
    }
  });
  await scenario("deleting a featured listing hides it without recycling an old slot version", async () => {
    await change({ server: second }); await admin(`delete from public.servers where id='${second}'`); await login();
    assert.equal(await call("public_featured_boost"), null);
    assert.equal((await call("staff_featured_boost_control")).version, 1);
    await rejected(() => change(), { code: "PT409" });
    assert.equal((await change({ version: 1 })).version, 2);
  });
  await scenario("ended, expired, missing and wrong-account sessions deny reads and writes", async () => {
    await change();
    for (const session_id of ["", "malformed", randomUUID(), sid(ids.member)]) {
      await login("owner", { session_id });
      await rejected(() => call("staff_featured_boost_control"), /permission/i);
      await rejected(() => change({ version: 1 }), /sign-in|session|permission/i);
    }
    for (const sql of [
      `update auth.sessions set not_after=clock_timestamp()-interval '1 second' where id='${sid(ids.owner)}'`,
      `delete from auth.sessions where id='${sid(ids.owner)}'`
    ]) {
      await admin(sql); await login();
      await rejected(() => call("staff_featured_boost_control"), /permission/i);
      await rejected(() => change({ version: 1 }), /sign-in|session|permission/i);
    }
  });
  await scenario("revoked staff or a deleted account cannot retain Boost authority", async () => {
    await change();
    await admin(`update public.staff_memberships set status='revoked' where user_id='${ids.owner}'`); await login();
    await rejected(() => change({ version: 1 }), /permit|permission/i);
    await rejected(() => call("staff_featured_boost_control"), /permission/i);
    await admin(`update public.staff_memberships set status='active' where user_id='${ids.owner}'; update auth.users set deleted_at=now() where id='${ids.owner}'`); await login();
    await rejected(() => change({ version: 1 }), /sign-in|session|permission/i);
    await rejected(() => call("staff_featured_boost_control"), /permission/i);
  });
  await scenario("effective permission denial overrides the role grant", async () => {
    await admin(`insert into public.staff_permission_overrides(user_id,permission_key,allowed,reason,changed_by) values('${ids.owner}','settings.manage',false,'Fixture override','${ids.owner}')`); await login();
    assert.deepEqual(await call("staff_featured_boost_control"), { canManage: false });
    await rejected(() => change(), /permit|permission/i);
  });
  await scenario("audit failure rolls the entire mutation back", async () => {
    const before = await memberRows();
    await admin(`create function private.reject_boost_audit() returns trigger language plpgsql as $$begin raise exception 'Fixture audit unavailable'; end;$$;
      create trigger reject_boost_audit before insert on public.staff_audit_events for each row when(new.action like 'featured_boost.%') execute function private.reject_boost_audit();`);
    await login(); await rejected(() => change(), /audit unavailable/i);
    assert.equal((await call("staff_featured_boost_control")).version, 0);
    assert.equal(await call("public_featured_boost"), null); assert.deepEqual(await memberRows(), before);
  });
});
