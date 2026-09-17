import test from "node:test";
import assert from "node:assert/strict";
import { staffHierarchyFixture, read, fn } from "./staff-hierarchy-fixture.mjs";

test("source failures retry through existing leases and surface private staff alerts", async t => {
  const { db, admin, login, call, ids, sid } = await staffHierarchyFixture(t);
  const cfx = "22222222-2222-4222-8222-222222222222", minecraft = "33333333-3333-4333-8333-333333333333";
  await admin(`create schema cron; create schema net;
    create table cron.job(jobname text,active boolean,schedule text);
    create table net._http_response(id bigint,status_code integer,timed_out boolean);
    create table private.server_status_refresh_runs(id uuid,started_at timestamptz,finished_at timestamptz,summary jsonb);
    create table private.server_status_refresh_control(singleton boolean,last_dispatched_at timestamptz,last_request_id bigint);
    create table public.server_import_sources(server_id uuid primary key references public.servers(id),platform text,join_code text,last_checked_at timestamptz,last_error_at timestamptz,next_refresh_at timestamptz default now());
    create table public.minecraft_import_sources(server_id uuid primary key references public.servers(id),join_code text,address text,last_checked_at timestamptz,last_error_at timestamptz,next_refresh_at timestamptz default now());
    insert into public.platforms(id,name,short_name) values('fivem','FiveM','FiveM'),('minecraft','Minecraft','MC');
    insert into public.servers(id,platform_id,name,slug,description,region,status,published_at) values
      ('${cfx}','fivem','First RP','first-rp',repeat('Roleplay ',8),'Europe','published',now()),
      ('${minecraft}','minecraft','Second RP','second-rp',repeat('Roleplay ',8),'Europe','published',now());
    insert into public.server_import_sources(server_id,platform,join_code,last_checked_at) values('${cfx}','fivem','abc123',now()-interval '1 minute');
    insert into public.minecraft_import_sources(server_id,join_code,address,last_checked_at) values('${minecraft}','abcdef012345','PRIVATE_NETWORK_ADDRESS',now()-interval '1 minute');
    insert into public.server_status_snapshots(server_id,online,players,capacity,checked_at) values('${cfx}',true,0,64,now()-interval '1 minute');`);
  for (const [file, names] of [
    ["20260904013820_redm_reviewed_cfx_imports.sql", ["service_claim_cfx_refresh", "service_mark_cfx_unavailable", "service_refresh_cfx_snapshot"]],
    ["20260904013852_minecraft_reviewed_imports.sql", ["service_claim_minecraft_refresh", "service_mark_minecraft_unavailable", "service_refresh_minecraft_snapshot"]]
  ]) for (const name of names) await admin(fn(read(file), `public.${name}`));
  await admin(read("20260917021311_source_refresh_retry_alerts.sql"));
  const health = async () => { await login(); return call("staff_refresh_health"); };
  const markCfx = async () => { await admin(); return call("service_mark_cfx_unavailable", ["fivem", "abc123"]); };
  const claimCfx = async () => { await admin(); return call("service_claim_cfx_refresh", ["fivem", "abc123"]); };
  const failure = async id => { await admin(); return (await db.query("select * from private.source_refresh_failures where server_id=$1", [id])).rows[0]; };

  await t.test("first failure leaves the real zero-player snapshot intact and schedules a five-minute retry", async () => {
    assert.equal(await claimCfx(), true); assert.equal(await markCfx(), true);
    const f = await failure(cfx); assert.equal(f.attempts, 1);
    assert.equal((Date.parse(f.next_retry_at) - Date.parse(f.last_failed_at)) / 1000, 300);
    assert.equal(await claimCfx(), false, "manual and scheduled requests use the same lease");
    const h = await health(); assert.equal(h.sourceRetries.pending, 1); assert.equal(h.sourceRetries.needsAttention, 0);
    assert.equal(h.sources.unavailable, 1);
    await admin(); const snapshots = (await db.query("select online,players from public.server_status_snapshots where server_id=$1", [cfx])).rows;
    assert.deepEqual(snapshots, [{ online: true, players: 0 }], "failure must not manufacture an offline snapshot");
  });
  await t.test("two retries over ten minutes create one alert; repeated failures keep a five-minute cadence", async () => {
    // Advance persisted fixture timestamps instead of waiting on real clocks.
    for (const elapsed of [5, 10]) {
      await admin(`update private.source_refresh_failures set first_failed_at=now()-interval '${elapsed} minutes',last_failed_at=now()-interval '5 minutes' where server_id='${cfx}';
        update public.server_import_sources set next_refresh_at=now()-interval '1 second' where server_id='${cfx}';`);
      assert.equal(await claimCfx(), true); await markCfx(); assert.equal(await claimCfx(), false);
      const h = await health(); assert.equal(h.sourceRetries.needsAttention, elapsed === 10 ? 1 : 0);
    }
    const h = await health(), alert = h.sourceRetries.alerts[0];
    assert.equal(alert.serverId, cfx); assert.equal(alert.attempts, 3); assert.equal(alert.platform, "fivem");
    assert.deepEqual(Object.keys(alert).sort(), ["attempts","firstFailedAt","lastCheckedAt","lastFailedAt","name","nextRetryAt","platform","serverId","slug"]);
    assert.doesNotMatch(JSON.stringify(h), /PRIVATE_NETWORK_ADDRESS|joinCode|rawError|address|Authorization/);
    assert.equal((await failure(cfx)).attempts, 3);
  });
  await t.test("a successful current observation clears the alert and preserves a genuine zero", async () => {
    await admin(); const at = (await db.query("select now()+interval '1 second' as observed_at")).rows[0].observed_at;
    const result = await call("service_refresh_cfx_snapshot", ["fivem", "abc123", true, 0, 64, at], "text,text,boolean,integer,integer,timestamptz");
    assert.equal(result.players, 0); assert.equal(result.online, true); assert.equal(await failure(cfx), undefined);
    const h = await health(); assert.equal(h.sourceRetries.needsAttention, 0); assert.equal(h.sourceRetries.pending, 0);
  });
  await t.test("Minecraft uses the same retry policy; rapid failures alone do not claim ten minutes of evidence", async () => {
    for (let attempt = 0; attempt < 3; attempt++) { await new Promise(resolve => setTimeout(resolve, 2)); await admin(); await call("service_mark_minecraft_unavailable", ["abcdef012345"]); }
    assert.equal((await failure(minecraft)).attempts, 3);
    await admin(); assert.equal(await call("service_claim_minecraft_refresh", ["abcdef012345"]), false);
    const h = await health(); assert.equal(h.sourceRetries.needsAttention, 0); assert.equal(h.sourceRetries.pending, 1);
    await admin(`update private.source_refresh_failures set first_failed_at=now()-interval '10 minutes' where server_id='${minecraft}'`);
    assert.equal((await health()).sourceRetries.alerts[0].platform, "minecraft");
  });
  await t.test("unpublished, mismatched or unknown sources do not appear as staff alerts", async () => {
    await admin(`update public.servers set status='suspended' where id='${minecraft}'`);
    assert.equal((await health()).sourceRetries.needsAttention, 0);
    await admin(); assert.equal(await call("service_mark_cfx_unavailable", ["redm", "abc123"]), false);
    assert.equal(await call("service_mark_cfx_unavailable", ["fivem", "unknown"]), false);
    assert.equal((await db.query("select count(*)::int n from private.source_refresh_failures")).rows[0].n, 1);
  });
  await t.test("private telemetry remains behind the existing real staff permission and session boundary", async () => {
    await login("support"); assert.ok(await call("staff_refresh_health"));
    await assert.rejects(db.query("select * from private.source_refresh_failures"), /permission denied/i);
    await assert.rejects(db.query("select private.source_refresh_alert_summary()"), /permission denied/i);
    await login("member"); await assert.rejects(call("staff_refresh_health"), /permission/i);
    await login("owner", { session_id: sid(ids.member) }); await assert.rejects(call("staff_refresh_health"), /permission/i);
    await admin("set role anon"); await assert.rejects(call("staff_refresh_health"), /permission denied/i);
    await admin();
    const functions = (await db.query("select proname from pg_proc p join pg_namespace n on p.pronamespace=n.oid where n.nspname='public' and proname like '%refresh%alert%'")).rows;
    assert.deepEqual(functions, [], "no new public RPC exposes retry state");
  });
});
