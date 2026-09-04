// Disposable PostgreSQL integration. Never connects to a hosted database.
// node --test test/staff-session-revocation-db.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import test from "node:test";
const { PGlite } = await import(process.env.PGLITE_MODULE ? pathToFileURL(process.env.PGLITE_MODULE).href : "@electric-sql/pglite");
const db = new PGlite();
const ops = readFileSync(new URL("../supabase/migrations/20260819192413_platform_operations_and_trust.sql", import.meta.url), "utf8");
const migration = readFileSync(new URL("../supabase/migrations/20260904091734_enforce_staff_session_revocation.sql", import.meta.url), "utf8");
const definition = name => ops.match(new RegExp(`create or replace function public\\.${name}\\([\\s\\S]*?\\n\\$\\$;`))[0];
const owner = "00000000-0000-4000-8000-000000000001";
const other = "00000000-0000-4000-8000-000000000002";
const sessionId = "aaaaaaaa-0000-4000-8000-000000000001";
const otherSession = "bbbbbbbb-0000-4000-8000-000000000002";
async function login({ id = owner, sid = sessionId, aal = "aal2", provider = "discord", amr, omitSid = false } = {}) {
  await db.exec("reset role");
  const claims = { sub: id, app_metadata: { provider }, aal, amr: amr ?? [{ method: "oauth" }, ...(aal === "aal2" ? [{ method: "totp" }] : [])], ...(!omitSid ? { session_id: sid } : {}) };
  await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)", [id || "", JSON.stringify(claims)]);
  await db.exec("set role authenticated");
}
async function allowed() { return (await db.query("select public.has_staff_permission('reports.read') allowed")).rows[0].allowed; }
async function enrollment() { return (await db.query("select public.staff_mfa_enrollment_allowed() allowed")).rows[0].allowed; }
async function writeAsDatabase(sql) { await db.exec("reset role"); await db.exec(sql); }

test("staff session revocation is enforced by real PostgreSQL permissions", async t => {
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role;
      create schema auth; create schema private;
      revoke all on schema private from public;
      create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
      create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
      create table auth.sessions(id uuid primary key,user_id uuid not null);
      create table auth.identities(user_id uuid,provider text,provider_id text,identity_data jsonb default '{}');
      create table public.staff_memberships(user_id uuid primary key,role_key text,status text default 'active');
      create table public.staff_role_permissions(role_key text,permission_key text);
      create table public.staff_permission_overrides(user_id uuid,permission_key text,allowed boolean);
      create table private.discord_owner_allowlist(discord_user_id text,enabled boolean,role_key text);
      create table private.platform_security_settings(singleton boolean,staff_mfa_required boolean);
      create table public.account_activity(user_id uuid,event_type text,provider text,metadata jsonb);
      create table public.staff_audit_events(actor_id uuid,action text,target_type text,target_id text,reason text,request_id text,after_state jsonb);
      insert into auth.sessions values('${sessionId}','${owner}'),('${otherSession}','${other}');
      insert into auth.identities(user_id,provider,provider_id) values('${owner}','discord','111111111111111111');
      insert into public.staff_memberships values('${owner}','owner','active');
      insert into public.staff_role_permissions values('owner','reports.read'),('owner','accounts.sessions.revoke'),('custom_reviewer','reports.read');
      insert into private.discord_owner_allowlist values('111111111111111111',true,'owner');
      insert into private.platform_security_settings values(true,true);
    `);
    for (const name of ["has_staff_permission", "staff_mfa_enrollment_allowed", "staff_security_status", "staff_revoke_account_sessions"]) {
      await db.exec(definition(name));
      const signature = name === "has_staff_permission" ? "text" : name === "staff_revoke_account_sessions" ? "uuid,text,text" : "";
      await db.exec(`revoke execute on function public.${name}(${signature}) from public; grant execute on function public.${name}(${signature}) to authenticated`);
    }
    await t.test("reproduces the original still-valid JWT permission after session revocation", async () => {
      await login(); assert.equal(await allowed(), true);
      const result = (await db.query("select public.staff_revoke_account_sessions($1,'Revoke compromised staff session',$2) value", [owner, crypto.randomUUID()])).rows[0].value;
      assert.equal(result.revokedSessions, 1);
      assert.equal(await allowed(), true, "baseline proves deleted sessions did not affect the original permission gate");
    });
    await writeAsDatabase(migration);
    await t.test("the same revoked JWT immediately loses staff reads, writes and MFA enrollment", async () => {
      await login(); assert.equal(await allowed(), false); assert.equal(await enrollment(), false);
      await assert.rejects(db.query("select public.staff_security_status()"), /Staff permission required/);
      await assert.rejects(db.query("select public.staff_revoke_account_sessions($1,'A second unauthorized revocation',$2)", [other, crypto.randomUUID()]), /Session-revocation permission required/);
    });
    await writeAsDatabase(`insert into auth.sessions values('${sessionId}','${owner}')`);
    await t.test("active sessions retain normal staff permissions and MFA requirements", async () => {
      await login(); assert.equal(await allowed(), true); assert.equal(await enrollment(), true);
      assert.equal((await db.query("select public.staff_security_status() value")).rows[0].value.staffMfaRequired, true);
      await login({ aal: "aal1" }); assert.equal(await allowed(), false); assert.equal(await enrollment(), true, "active staff may enroll before they have TOTP");
      await login({ amr: [{ method: "totp" }] }); assert.equal(await allowed(), false); assert.equal(await enrollment(), false);
      await login({ provider: "google" }); assert.equal(await allowed(), false); assert.equal(await enrollment(), false);
    });
    await t.test("missing, malformed, unknown and another user's session IDs fail without a cast error", async () => {
      for (const sid of [null, "", "not-a-uuid", "aaaaaaaa000040008000000000000001", "' OR true--", {}, otherSession, "cccccccc-0000-4000-8000-000000000003"]) {
        await login({ sid }); assert.equal(await allowed(), false); assert.equal(await enrollment(), false);
      }
      await login({ omitSid: true }); assert.equal(await allowed(), false);
      await login({ id: null }); assert.equal(await allowed(), false);
      await login({ sid: sessionId.toUpperCase() }); assert.equal(await allowed(), true);
    });
    await t.test("custom roles and deny overrides retain their existing meaning", async () => {
      await writeAsDatabase("update public.staff_memberships set role_key='custom_reviewer'; update private.discord_owner_allowlist set role_key='custom_reviewer'");
      await login(); assert.equal(await allowed(), true);
      await writeAsDatabase(`insert into public.staff_permission_overrides values('${owner}','reports.read',false)`);
      await login(); assert.equal(await allowed(), false);
      await writeAsDatabase("delete from public.staff_permission_overrides; update private.discord_owner_allowlist set enabled=false");
      await login(); assert.equal(await allowed(), false); assert.equal(await enrollment(), false);
      await writeAsDatabase("update private.discord_owner_allowlist set enabled=true");
      await login(); assert.equal(await allowed(), true);
    });
    await t.test("the helper exposes no session rows and anonymous permission checks are false", async () => {
      await login();
      await assert.rejects(db.query("select private.has_current_auth_session()"), /permission denied/);
      await assert.rejects(db.query("select * from auth.sessions"), /permission denied/);
      await login({ id: null, omitSid: true }); await db.exec("reset role;set role anon");
      assert.equal(await allowed(), false);
      await assert.rejects(enrollment(), /permission denied/);
      await db.exec("reset role;set role service_role");
      await assert.rejects(db.query("select private.has_current_auth_session()"), /permission denied/);
      await assert.rejects(allowed(), /permission denied/);
    });
    await t.test("revocation after the migration denies the same authenticated token on the next call", async () => {
      await writeAsDatabase("update public.staff_memberships set role_key='owner'; update private.discord_owner_allowlist set role_key='owner'");
      await login(); assert.equal(await allowed(), true);
      assert.equal((await db.query("select public.staff_revoke_account_sessions($1,'Revoke the active test session',$2) value", [owner, crypto.randomUUID()])).rows[0].value.revokedSessions, 1);
      assert.equal(await allowed(), false); assert.equal(await enrollment(), false);
      await assert.rejects(db.query("select public.staff_security_status()"), /Staff permission required/);
    });
  } finally { await db.close(); }
});
