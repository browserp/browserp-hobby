import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const read = file => readFileSync(new URL(`../supabase/migrations/${file}`, import.meta.url), "utf8");
const fn = (source, name) => source.match(new RegExp(`create or replace function ${name.replaceAll(".", "\\.")}\\([\\s\\S]*?\\n\\$\\$;`))[0];
const member = "00000000-0000-4000-8000-000000000001", other = "00000000-0000-4000-8000-000000000002";
const sid = "aaaaaaaa-0000-4000-8000-000000000001", otherSid = "aaaaaaaa-0000-4000-8000-000000000002";

test("connection changes enforce real sessions, original OAuth age and exclusive operations in PostgreSQL", async t => {
  const db = new PGlite(); t.after(() => db.close());
  const core = read("202608180001_browserp_core.sql");
  const memberSecurity = read("20260904092528_enforce_member_security_boundaries.sql");
  await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create schema private;
    revoke all on schema private from public;
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
    create table auth.users(id uuid primary key,deleted_at timestamptz,is_anonymous boolean default false);
    create table auth.sessions(id uuid primary key,user_id uuid,not_after timestamptz);
    create table public.staff_memberships(user_id uuid,status text);
    create table public.security_bans(user_id uuid,target_type text,revoked_at timestamptz,starts_at timestamptz,ends_at timestamptz);
    insert into auth.users(id) values('${member}'),('${other}');
    insert into auth.sessions(id,user_id) values('${sid}','${member}'),('${otherSid}','${other}');
  `);
  await db.exec(core.match(/create table public\.rate_limit_buckets \([\s\S]*?\n\);/)[0]);
  await db.exec(fn(core, "public.consume_rate_limit"));
  await db.exec(fn(read("20260904091734_enforce_staff_session_revocation.sql"), "private.has_current_auth_session"));
  for (const name of ["private.member_access_allowed", "private.require_active_member", "private.enforce_member_rate_limit"]) await db.exec(fn(memberSecurity, name));
  await db.exec(read("20260905195603_member_connection_session_guard.sql"));
  const now = Math.floor(Date.now() / 1000);
  const login = async ({ id = member, session = sid, oauth = now, amr, extra = {} } = {}) => {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)", [id || "", JSON.stringify({ sub: id, session_id: session, iat: now, amr: amr ?? [{ method: "oauth", timestamp: oauth }], ...extra })]);
    await db.exec("set role authenticated");
  };
  const status = async () => (await db.query("select public.member_connection_status() value")).rows[0].value;
  const operation = async (action = "begin", token = null) => (await db.query("select public.member_connection_operation($1,$2) value", [action, token])).rows[0].value;
  const admin = async sql => { await db.exec("reset role"); await db.exec(sql); };

  await t.test("fresh OAuth works, refreshed iat and unrelated methods never refresh authentication age", async () => {
    await login(); assert.equal((await status()).recent, true);
    for (const change of [
      { oauth: now - 601 },
      { oauth: now + 120 },
      { amr: [{ method: "token_refresh", timestamp: now }] },
      { amr: [{ method: "oauth", timestamp: now - 3600 }, { method: "totp", timestamp: now }] },
      { amr: [{ method: "oauth", timestamp: "not a date" }] },
      { amr: { method: "oauth", timestamp: now } },
      { amr: [], extra: { user_metadata: { amr: [{ method: "oauth", timestamp: now }] } } }
    ]) {
      await login(change); assert.equal((await status()).recent, false); await assert.rejects(operation(), /Sign in again/);
    }
  });
  await t.test("revoked, foreign, absent, expired and banned sessions cannot change connections", async () => {
    for (const session of [otherSid, undefined, "invalid"]) {
      await login({ session, extra: session === undefined ? { session_id: null } : {} }); assert.equal((await status()).active, false); await assert.rejects(operation(), /Sign in again/);
    }
    await admin(`delete from auth.sessions where id='${sid}'`); await login(); assert.equal((await status()).active, false);
    await admin(`insert into auth.sessions values('${sid}','${member}',now()-interval '1 second')`); await login(); assert.equal((await status()).active, false);
    await admin(`update auth.sessions set not_after=null where id='${sid}';insert into public.security_bans values('${member}','account',null,now(),null)`); await login(); assert.equal((await status()).active, false);
    await admin("delete from public.security_bans");
  });
  await t.test("current and former staff cannot acquire an operation", async () => {
    for (const value of ["active", "suspended", "revoked"]) {
      await admin(`insert into public.staff_memberships values('${member}','${value}')`); await login(); assert.equal((await status()).staff, true); await assert.rejects(operation(), /Staff accounts/);
      await admin("delete from public.staff_memberships");
    }
  });
  await t.test("exclusive leases cannot be released by another member or the wrong token", async () => {
    await login(); const first = await operation(); assert.match(first, /^[0-9a-f-]{36}$/);
    await assert.rejects(operation(), /Another account change/);
    await operation("release", otherSid); await assert.rejects(operation(), /Another account change/);
    await login({ id: other, session: otherSid }); await operation("release", first);
    await login(); await assert.rejects(operation(), /Another account change/);
    await operation("release", first); const next = await operation(); assert.notEqual(next, first);
    await admin("update private.member_connection_operations set expires_at=now()-interval '1 second'"); await login(); const recovered = await operation(); assert.notEqual(recovered, next); await operation("release", recovered);
    await assert.rejects(operation(null), /valid account action/);
  });
  await t.test("private data and anonymous/service callers have no direct access", async () => {
    await login(); await assert.rejects(db.query("select * from auth.sessions"), /permission denied/); await assert.rejects(db.query("select * from private.member_connection_operations"), /permission denied/);
    for (const role of ["anon", "service_role"]) { await db.exec(`reset role;set role ${role}`); await assert.rejects(status(), /permission denied/); await assert.rejects(operation(), /permission denied/); }
  });
});
