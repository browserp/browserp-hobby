import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migration = readFileSync(new URL("../supabase/migrations/20260907221756_staff_presence.sql", import.meta.url), "utf8");
const db = new PGlite();
const owner = "00000000-0000-4000-8000-000000000001";
const manager = "00000000-0000-4000-8000-000000000002";
const outsider = "00000000-0000-4000-8000-000000000003";
const ownerSession = "11111111-0000-4000-8000-000000000001";
const managerSession = "22222222-0000-4000-8000-000000000002";

async function login({ id = owner, session = ownerSession, aal = "aal2", provider = "discord", oauth = true, totp = aal === "aal2" } = {}) {
  await db.exec("reset role");
  const amr = [...(oauth ? [{ method: "oauth" }] : []), ...(totp ? [{ method: "totp" }] : [])];
  await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)", [id, JSON.stringify({ sub: id, session_id: session, app_metadata: { provider }, aal, amr })]);
  await db.exec("set role authenticated");
}

async function touch() {
  return (await db.query("select public.staff_presence_touch() value")).rows[0].value;
}

async function servicePresence() {
  await db.exec("reset role; set role service_role");
  return (await db.query("select public.service_public_staff_presence() value")).rows[0].value;
}

test("staff presence is session-bound, MFA-aware and exposes only a server-side boolean", async t => {
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role;
      create schema auth; create schema private;
      revoke all on schema private from public, anon, authenticated, service_role;
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
      $$;
      create function auth.jwt() returns jsonb language sql stable as $$
        select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
      $$;
      create table auth.sessions(id uuid primary key, user_id uuid not null);
      create table public.staff_memberships(user_id uuid primary key, role_key text not null, status text not null);
      create table private.platform_security_settings(singleton boolean primary key, staff_mfa_required boolean not null);
      insert into auth.sessions values ('${ownerSession}', '${owner}'), ('${managerSession}', '${manager}');
      insert into public.staff_memberships values
        ('${owner}', 'owner', 'active'),
        ('${manager}', 'custom_direct_manager', 'active');
      insert into private.platform_security_settings values (true, true);
      create function public.staff_mfa_enrollment_allowed()
      returns boolean language sql stable security definer set search_path = '' as $$
        select exists(
          select 1
          from public.staff_memberships sm
          join auth.sessions s on s.user_id = sm.user_id
          where sm.user_id = (select auth.uid())
            and sm.status = 'active'
            and s.id::text = coalesce((select auth.jwt())->>'session_id', '')
            and coalesce((select auth.jwt())->'app_metadata'->>'provider', '') = 'discord'
            and coalesce((select auth.jwt())->'amr', '[]'::jsonb) @> '[{"method":"oauth"}]'::jsonb
        )
      $$;
      revoke execute on function public.staff_mfa_enrollment_allowed() from public, anon, service_role;
      grant execute on function public.staff_mfa_enrollment_allowed() to authenticated;
    `);
    await db.exec(migration);

    await t.test("anonymous, ordinary, wrong-provider, low-assurance and revoked sessions cannot publish presence", async () => {
      await db.exec("set role anon");
      await assert.rejects(touch(), /permission denied/);
      await login({ id: outsider, session: "33333333-0000-4000-8000-000000000003" });
      await assert.rejects(touch(), /active verified staff session/);
      await login({ provider: "google" });
      await assert.rejects(touch(), /active verified staff session/);
      await login({ aal: "aal1", totp: false });
      await assert.rejects(touch(), /active verified staff session/);
      await db.exec("reset role; delete from auth.sessions where id = '" + ownerSession + "'");
      await login();
      await assert.rejects(touch(), /active verified staff session/);
      await db.exec("reset role; insert into auth.sessions values ('" + ownerSession + "', '" + owner + "')");
    });

    await t.test("active verified staff can touch only their own private presence row", async () => {
      await login();
      assert.equal(await touch(), true);
      await assert.rejects(db.query("select * from private.staff_presence"), /permission denied/);
      await login({ id: manager, session: managerSession });
      assert.equal(await touch(), true);
      await db.exec("reset role");
      assert.equal((await db.query("select count(*)::integer count from private.staff_presence")).rows[0].count, 2);
    });

    await t.test("only the server role can read current booleans and never receives timestamps", async () => {
      await db.exec("set role anon");
      await assert.rejects(db.query("select public.service_public_staff_presence()"), /permission denied/);
      await login();
      await assert.rejects(db.query("select public.service_public_staff_presence()"), /permission denied/);
      const current = await servicePresence();
      assert.equal(current.length, 2);
      assert.ok(current.every(row => Object.keys(row).sort().join(",") === "online,userId"));
      assert.ok(current.every(row => row.online === true));

      await db.exec("reset role; update private.staff_presence set last_seen_at = now() - interval '5 minutes' where user_id = '" + manager + "'");
      const aged = await servicePresence();
      assert.equal(aged.find(row => row.userId === manager).online, false);
      assert.equal(aged.find(row => row.userId === owner).online, true);
      assert.doesNotMatch(JSON.stringify(aged), /lastSeen|timestamp|session/i);
    });

    await t.test("suspended staff disappear from the public-presence source immediately", async () => {
      await db.exec("reset role; update public.staff_memberships set status = 'suspended' where user_id = '" + manager + "'");
      const current = await servicePresence();
      assert.deepEqual(current.map(row => row.userId), [owner]);
    });
  } finally {
    await db.close();
  }
});
