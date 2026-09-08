import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const sql = name => readFileSync(new URL(`../supabase/migrations/${name}.sql`, import.meta.url), "utf8");
const member = sql("20260904092528_enforce_member_security_boundaries");
const factor = sql("20260905200710_serialize_staff_authenticator_management");
const migration = sql("20260908100259_explicit_staff_duty_sessions");
const definition = (source, name) => source.match(new RegExp(`create or replace function ${name.replaceAll(".", "\\.")}\\([\\s\\S]*?\\n\\$\\$;`))[0];
const worker = "00000000-0000-4000-8000-000000000001";
const manager = "00000000-0000-4000-8000-000000000002";
const outsider = "00000000-0000-4000-8000-000000000003";
const sid = id => id.replace(/^00000000/, "11111111");
const db = new PGlite();
async function admin(query, params = []) { await db.exec("reset role"); return db.query(query, params); }
async function login(id = worker, extra = {}) {
  await db.exec("reset role");
  const claims = { sub: id, session_id: sid(id), app_metadata: { provider: "discord" }, aal: "aal2", amr: [{ method: "oauth" }, { method: "totp" }], ...extra };
  await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)", [id, JSON.stringify(claims)]);
  await db.exec("set role authenticated");
}
async function mutate(action, options = {}) {
  return (await db.query("select public.staff_duty_mutate($1,$2,$3,$4,$5,$6,$7,$8,$9) value", [action, options.key || randomUUID(), options.availability ?? null,
    options.sessionId ?? null, options.version ?? null, options.startedAt ?? null, options.endedAt ?? null, options.reason ?? null, options.confirmed ?? false])).rows[0].value;
}
async function read(view = "self", options = {}) {
  return (await db.query("select public.staff_duty_read($1,$2,$3,$4,$5,$6,$7,$8) value", [view, options.from ?? new Date(Date.now()-30*86400000).toISOString(),
    options.to ?? new Date(Date.now()+1000).toISOString(), options.limit ?? 25, options.before ?? null, options.beforeId ?? null, options.userId ?? null, options.afterUserId ?? null])).rows[0].value;
}
async function seed(userId, startHours, endHours = null, status = endHours === null ? "open" : "confirmed") {
  const row = (await admin("insert into private.staff_work_sessions(user_id,started_at,ended_at,status) values($1,now()-($2*interval '1 hour'),case when $3::numeric is null then null else now()-($3*interval '1 hour') end,$4) returning *", [userId,startHours,endHours,status])).rows[0];
  await login(userId); return row;
}
async function setup() {
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth; create schema private; revoke all on schema private from public;
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
    create table auth.users(id uuid primary key,deleted_at timestamptz,is_anonymous boolean default false);
    create table auth.sessions(id uuid primary key,user_id uuid,not_after timestamptz);
    create table auth.identities(user_id uuid,provider text,provider_id text,identity_data jsonb default '{}');
    create table public.profiles(id uuid primary key,display_name text);
    create table public.security_bans(user_id uuid,target_type text,revoked_at timestamptz,starts_at timestamptz,ends_at timestamptz);
    create table public.staff_memberships(user_id uuid primary key,role_key text,status text default 'active');
    create table public.staff_role_permissions(role_key text,permission_key text);
    create table public.staff_permission_overrides(user_id uuid,permission_key text,allowed boolean);
    create table private.discord_owner_allowlist(discord_user_id text,enabled boolean,role_key text);
    create table private.platform_security_settings(singleton boolean,staff_mfa_required boolean);
    create table public.staff_audit_events(actor_id uuid,action text,target_type text,target_id text,reason text,request_id text,before_state jsonb,after_state jsonb);
    create function private.fixture_duty_boundary(p_boundary text) returns void language plpgsql as $$
    declare actor uuid:=auth.uid(); change text:=current_setting('fixture.duty_change',true);
    begin
      if current_setting('fixture.duty_boundary',true) is distinct from p_boundary then return; end if;
      if change='revoke' then delete from auth.sessions where user_id=actor;
      elsif change='suspend' then update public.staff_memberships set status='suspended' where user_id=actor;
      elsif change='role' then
        update public.staff_memberships set role_key='support' where user_id=actor;
        update private.discord_owner_allowlist set role_key='support' where discord_user_id='discord-'||actor;
      elsif change='permission' then insert into public.staff_permission_overrides values(actor,'staff.manage',false);
      elsif change in ('session_expiry','scheduled_ban','delay') then perform pg_catalog.pg_sleep(0.2);
      end if;
    end;$$;
    create function public.consume_rate_limit(text,text,integer,integer) returns boolean language plpgsql as $$
    begin
      perform private.fixture_duty_boundary('quota');
      return current_setting('fixture.limit',true) is distinct from 'deny';
    end;$$;
    create function private.fixture_duty_audit_boundary() returns trigger language plpgsql as $$
    begin perform private.fixture_duty_boundary('audit'); return new; end;$$;
    create trigger fixture_duty_audit_boundary before insert on public.staff_audit_events
      for each row execute function private.fixture_duty_audit_boundary();
    insert into public.staff_role_permissions values('custom_manager','staff.manage');
    insert into private.platform_security_settings values(true,true);
  `);
  for (const [id, name, role] of [[worker,"Support member","support"],[manager,"Direct manager","custom_manager"],[outsider,"Ordinary member",null]]) {
    await db.query("insert into auth.users(id) values($1);", [id]);
    await db.query("insert into auth.sessions(id,user_id) values($1,$2)", [sid(id),id]);
    await db.query("insert into auth.identities(user_id,provider,provider_id) values($1,'discord',$2)", [id,`discord-${id}`]);
    await db.query("insert into public.profiles values($1,$2)", [id,name]);
    if (role) {
      await db.query("insert into public.staff_memberships values($1,$2,'active')", [id,role]);
      await db.query("insert into private.discord_owner_allowlist values($1,true,$2)", [`discord-${id}`,role]);
    }
  }
  await db.exec(sql("20260905195616_enforce_auth_session_expiry"));
  for (const name of ["private.member_access_allowed","private.require_active_member","private.enforce_member_rate_limit","public.has_staff_permission","public.staff_mfa_enrollment_allowed"]) await db.exec(definition(member,name));
  await db.exec(definition(factor,"public.staff_authenticator_access"));
  // PGlite runs one connection. Inject immediately after the real advisory-lock
  // statements to exercise their continuation paths; this is boundary fault
  // injection, not a claim that separate PostgreSQL transactions ran concurrently.
  let instrumented=migration;
  for (const boundary of ['request','user']) {
    const lock=`perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('staff-duty-${boundary}:'||${boundary==='request'?'actor':'target'}::text,0));`;
    assert.equal(instrumented.split(lock).length,2,`one ${boundary} lock must be instrumented`);
    instrumented=instrumented.replace(lock,`${lock}\n  perform private.fixture_duty_boundary('${boundary}');`);
  }
  await db.exec(instrumented);
}

test("private staff duty and work sessions enforce real PostgreSQL boundaries", async t => {
  try {
    await setup();
    await t.test("ordinary, expired, revoked, banned, mixed-provider and low-MFA sessions fail", async () => {
      await login(outsider); await assert.rejects(read(), /active verified staff/);
      for (const extra of [{aal:"aal1"},{amr:[{method:"oauth"}]},{app_metadata:{provider:"google"}},{session_id:sid(manager)}]) {
        await login(worker,extra); await assert.rejects(mutate("clock_in"), /active verified staff/);
      }
      await admin("update auth.sessions set not_after=now()-interval '1 second' where user_id=$1", [worker]);
      await login(); await assert.rejects(read(), /active verified staff/);
      await admin("update auth.sessions set not_after=null");
      await admin("insert into public.security_bans values($1,'account',null,now(),null)", [worker]);
      await login(); await assert.rejects(read(), /active verified staff/);
      await admin("delete from public.security_bans");
      await admin("insert into auth.identities(user_id,provider) values($1,'google')", [worker]);
      await login(); await assert.rejects(read(), /active verified staff/);
      await admin("delete from auth.identities where provider='google'");
      await login(); assert.equal((await read()).canManageTeam,false);
    });
    await t.test("authorization is refreshed after waits, including cached retries and the final write", async t => {
      for (const boundary of ['request','user','quota','audit']) {
        for (const change of ['revoke','suspend','role','permission','session_expiry','scheduled_ban']) {
          await t.test(`${change} at ${boundary} denies the correction without releasing a result`, async () => {
            await admin('begin');
            try {
              const session=await seed(worker,4,3);
              await login(manager);
              const options={key:randomUUID(),sessionId:session.id,version:1,startedAt:session.started_at,
                endedAt:session.ended_at,reason:'Management verified the actual support session',confirmed:true};
              // The request-lock cases must exercise the exact-key early return.
              if (boundary==='request') assert.equal((await mutate('correct_session',options)).changed,true);
              if (change==='session_expiry') {
                await admin("update auth.sessions set not_after=clock_timestamp()+interval '0.1 seconds' where user_id=$1",[manager]);
              } else if (change==='scheduled_ban') {
                await admin("insert into public.security_bans values($1,'account',null,clock_timestamp()+interval '0.1 seconds',null)",[manager]);
              }
              await login(manager);
              await db.query("select set_config('fixture.duty_boundary',$1,true),set_config('fixture.duty_change',$2,true)",[boundary,change]);
              await assert.rejects(mutate('correct_session',options),change==='role'||change==='permission'?/Staff-management permission/:/active verified staff/);
            } finally {
              await db.exec('rollback');
            }
            assert.equal((await admin('select count(*)::int value from private.staff_work_sessions')).rows[0].value,0);
            assert.equal((await admin('select count(*)::int value from private.staff_duty_requests')).rows[0].value,0);
            assert.equal((await admin('select count(*)::int value from public.staff_audit_events')).rows[0].value,0);
          });
        }
      }
      await t.test('clock-in records the time after a quota delay',async () => {
        await admin('begin');
        try {
          await login();
          await db.query("select set_config('fixture.duty_boundary','quota',true),set_config('fixture.duty_change','delay',true)");
          const before=(await db.query('select clock_timestamp() value')).rows[0].value;
          const result=await mutate('clock_in');
          assert.ok(new Date(result.session.startedAt)-new Date(before)>=190);
        } finally { await db.exec('rollback'); }
      });
    });
    await t.test("self availability is explicit and private team availability exposes no hours", async () => {
      await login(); const key=randomUUID();
      const changed=await mutate("set_availability",{key,availability:"away"});
      assert.equal(changed.duty.availability,"away"); assert.equal(changed.duty.openSession,null);
      assert.deepEqual(await mutate("set_availability",{key,availability:"away"}),changed);
      await assert.rejects(mutate("set_availability",{key,availability:"available"}),/request key was already used/);
      const roster=await read("availability",{limit:1}); assert.equal(roster.availability.length,1); assert.ok(roster.nextAfterUserId);
      assert.doesNotMatch(JSON.stringify(roster),/confirmedSeconds|startedAt|endedAt|sessionId/);
      const next=await read("availability",{limit:1,afterUserId:roster.nextAfterUserId}); assert.equal(next.availability.length,1); assert.notEqual(next.availability[0].userId,roster.availability[0].userId);
    });
    await t.test("retries and queued requests produce one open session and one clock-out", async () => {
      await login(); const key=randomUUID();
      const first=await mutate("clock_in",{key});
      const results=await Promise.all([mutate("clock_in",{key}),mutate("clock_in"),mutate("clock_in")]);
      assert.ok(results.every(result=>result.session.id===first.session.id));
      await admin("update private.staff_work_sessions set started_at=now()-interval '2 hours' where id=$1",[first.session.id]);
      await login(); const closeKey=randomUUID();
      const closed=await mutate("clock_out",{key:closeKey,sessionId:first.session.id,version:1});
      assert.equal(closed.duty.availability,"off_duty"); assert.ok(closed.session.confirmedSeconds>=7199);
      assert.deepEqual(await mutate("clock_out",{key:closeKey,sessionId:first.session.id,version:1}),closed);
      const newer=await mutate("clock_in");
      const retry=await mutate("clock_out",{sessionId:first.session.id,version:1});
      assert.equal(retry.changed,false); assert.equal(retry.duty.openSession.id,newer.session.id);
      await admin("delete from private.staff_work_sessions where id=$1",[newer.session.id]);
      const audits=(await admin("select action from public.staff_audit_events where action like 'staff.duty.clock_%'")).rows;
      assert.equal(audits.filter(x=>x.action==='staff.duty.clock_out').length,1);
    });
    await t.test("stale and open intervals add no hours until actual completion is confirmed", async () => {
      const stale=await seed(worker,15); const status=await read();
      assert.equal(status.duty.openSession.needsReview,true); assert.equal(status.duty.openSession.confirmedSeconds,0);
      const before=status.totals.confirmedSeconds;
      const closed=await mutate("clock_out",{sessionId:stale.id,version:1});
      assert.equal(closed.session.status,"needs_review"); assert.equal((await read()).totals.confirmedSeconds,before);
      const end=new Date(Date.now()-13*3600000).toISOString();
      const options={sessionId:stale.id,version:2,endedAt:end,reason:"Forgot to close after the support session",confirmed:true,key:randomUUID()};
      const confirmed=await mutate("confirm_session",options);
      assert.equal(confirmed.session.status,"confirmed"); assert.ok(confirmed.session.confirmedSeconds>=7199 && confirmed.session.confirmedSeconds<7202);
      assert.deepEqual(await mutate("confirm_session",options),confirmed);
      assert.equal((await read()).totals.pendingReviewCount,0);
      await assert.rejects(mutate("correct_session",{sessionId:stale.id,version:3,startedAt:stale.started_at,endedAt:end,reason:"A sufficient correction reason",confirmed:true}),/Staff-management permission/);
    });
    await t.test("team hours and corrections obey management permission, never a display role or owner test", async () => {
      await login(); await assert.rejects(read("team"),/Staff-management permission/);
      await assert.rejects(read("self",{userId:manager}),/Staff-management permission/);
      await login(manager); const team=await read("team"); assert.equal(team.canManageTeam,true); assert.ok(team.teamTotals.length);
      const target=team.sessions.find(row=>row.status==='confirmed');
      const opts={sessionId:target.id,version:target.version,startedAt:target.startedAt,endedAt:target.endedAt,reason:"Manager verified the recorded support shift",confirmed:true,key:randomUUID()};
      const corrected=await mutate("correct_session",opts); assert.equal(corrected.session.version,target.version+1);
      assert.deepEqual(await mutate("correct_session",opts),corrected);
      await assert.rejects(mutate("correct_session",{...opts,key:randomUUID()}),/session changed/);
      await admin("insert into public.staff_permission_overrides values($1,'staff.manage',false)",[manager]);
      await login(manager); await assert.rejects(read("team"),/Staff-management permission/);
      await assert.rejects(mutate("correct_session",opts),/Staff-management permission/);
      assert.equal((await mutate("set_availability",{availability:"available"})).duty.availability,"available");
      await admin("delete from public.staff_permission_overrides");
    });
    await t.test("future, reversed, overlapping, and unconfirmed corrections are rejected; manager can confirm long real shifts", async () => {
      const long=await seed(manager,60,30,"needs_review");
      const options={sessionId:long.id,version:1,startedAt:long.started_at,endedAt:long.ended_at,reason:"Management confirmed this exceptional long session",confirmed:true};
      await assert.rejects(mutate("confirm_session",options),/longer than 24 hours/);
      for (const patch of [{endedAt:new Date(Date.now()+3600000).toISOString()},{endedAt:new Date(Date.now()-70*3600000).toISOString()},{confirmed:false},{reason:""}]) {
        await assert.rejects(mutate("correct_session",{...options,...patch}),/actual start|Confirm actual/);
      }
      const earlier=await seed(manager,65,61); await login(manager);
      await assert.rejects(mutate("correct_session",{...options,startedAt:earlier.started_at}),/overlap/);
      const fixed=await mutate("correct_session",options); assert.equal(fixed.session.confirmedSeconds,30*3600);
    });
    await t.test("self reads and session IDs cannot expose or mutate another staff member's work", async () => {
      await login(manager); const foreign=(await read()).sessions[0]; assert.ok(foreign);
      await login(); const own=await read(); assert.ok(own.sessions.every(row=>row.userId===worker));
      for (const action of ["clock_out","confirm_session"]) await assert.rejects(mutate(action,{sessionId:foreign.id,version:foreign.version,
        endedAt:foreign.endedAt,reason:"Attempted foreign session change",confirmed:true}),/Work session not found/);
      await admin("delete from auth.sessions where user_id=$1",[worker]); await login(); await assert.rejects(read(),/active verified staff/);
      await admin("insert into auth.sessions(id,user_id) values($1,$2)",[sid(worker),worker]);
    });
    await t.test("narrow ranges clip confirmed totals and pages preserve the complete timestamp cursor", async () => {
      await login(manager); const from=new Date(Date.now()-50*3600000).toISOString(), to=new Date(Date.now()-40*3600000).toISOString();
      const narrow=await read("team",{from,to,userId:manager}); assert.equal(narrow.totals.confirmedSeconds,10*3600);
      const page=await read("team",{limit:1}); assert.equal(page.sessions.length,1); assert.ok(page.next);
      const second=await read("team",{limit:1,...page.next}); assert.notEqual(second.sessions[0].id,page.sessions[0].id);
      await assert.rejects(read("team",{from:"2020-01-01T00:00:00Z",to:"2022-01-01T00:00:00Z"}),/93 days/);
      await assert.rejects(read("team",{limit:101}),/page size/);
    });
    await t.test("direct table/helper access is denied and RLS remains a second barrier if a read grant is accidentally added", async () => {
      for (const role of ["anon","authenticated","service_role"]) {
        await db.exec(`reset role;set role ${role}`);
        for (const table of ["staff_work_sessions","staff_duty_state","staff_duty_requests"]) {
          await assert.rejects(db.query(`select * from private.${table}`),/permission denied/);
          await assert.rejects(db.query(`delete from private.${table}`),/permission denied/);
        }
        await assert.rejects(db.query("select private.require_staff_duty()"),/permission denied/);
        if (role!=='authenticated') await assert.rejects(read(),/permission denied/);
      }
      await db.exec("reset role;grant usage on schema private to authenticated;grant select on private.staff_work_sessions to authenticated");
      await login(); assert.equal((await db.query("select * from private.staff_work_sessions")).rows.length,0);
      await db.exec("reset role;revoke usage on schema private from authenticated;revoke select on private.staff_work_sessions from authenticated");
      const flags=(await db.query("select relrowsecurity from pg_class where relname in ('staff_work_sessions','staff_duty_state','staff_duty_requests')")).rows;
      assert.equal(flags.length,3); assert.ok(flags.every(row=>row.relrowsecurity));
    });
    await t.test("unique open-session constraint and failed audit roll back state and request ledger together", async () => {
      await admin("delete from private.staff_work_sessions where ended_at is null");
      await login(); const first=await mutate("clock_in");
      await assert.rejects(admin("insert into private.staff_work_sessions(user_id) values($1)",[worker]),/unique constraint/);
      await admin("delete from private.staff_work_sessions where id=$1",[first.session.id]);
      await db.exec(`create function private.fixture_fail_duty_audit() returns trigger language plpgsql as $$begin if current_setting('fixture.audit',true)='fail' then raise exception 'Fixture audit failure'; end if; return new; end;$$;
        create trigger fixture_duty_audit before insert on public.staff_audit_events for each row execute function private.fixture_fail_duty_audit();`);
      await db.query("select set_config('fixture.audit','fail',false)"); await login(); const key=randomUUID();
      await assert.rejects(mutate("clock_in",{key}),/Fixture audit failure/);
      const sessions=(await admin("select * from private.staff_work_sessions where ended_at is null")).rows; assert.equal(sessions.length,0);
      assert.equal((await admin("select * from private.staff_duty_requests where request_key=$1",[key])).rows.length,0);
      await db.query("select set_config('fixture.audit','',false)"); await login(); assert.equal((await mutate("clock_in",{key})).changed,true);
      await admin("update public.staff_memberships set status='suspended' where user_id=$1",[worker]); await login();
      await assert.rejects(mutate("clock_in",{key}),/active verified staff/);
      await login(manager); assert.ok((await read("availability")).availability.every(row=>row.userId!==worker));
    });
  } finally { await db.close(); }
});
