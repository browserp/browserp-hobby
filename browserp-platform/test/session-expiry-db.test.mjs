import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
const read = name => readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), "utf8");
const fn = (source, name) => source.match(new RegExp(`create or replace function ${name.replaceAll(".", "\\.")}\\([\\s\\S]*?\\n\\$\\$;`))[0];
const member = "00000000-0000-4000-8000-000000000001", other = "00000000-0000-4000-8000-000000000002";
const sid = "aaaaaaaa-0000-4000-8000-000000000001", otherSid = "aaaaaaaa-0000-4000-8000-000000000002";

test("all shared member and staff checks respect session end times without changing role rules", async t => {
  const db = new PGlite(); t.after(() => db.close());
  await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create schema private;
    revoke all on schema private from public;
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
    create table auth.users(id uuid primary key,deleted_at timestamptz,is_anonymous boolean default false);
    create table auth.sessions(id uuid primary key,user_id uuid,not_after timestamptz);
    create table auth.identities(user_id uuid,provider text,provider_id text,identity_data jsonb default '{}');
    create table public.staff_memberships(user_id uuid,status text,role_key text);
    create table private.discord_owner_allowlist(discord_user_id text,enabled boolean,role_key text);
    create table public.security_bans(user_id uuid,target_type text,revoked_at timestamptz,starts_at timestamptz,ends_at timestamptz);
    create table private.platform_security_settings(singleton boolean,staff_mfa_required boolean);
    create table public.staff_permission_overrides(user_id uuid,permission_key text,allowed boolean);
    create table public.staff_role_permissions(role_key text,permission_key text);
    insert into private.platform_security_settings values(true,true);
    insert into auth.users(id) values('${member}'),('${other}');
    insert into auth.sessions(id,user_id) values('${sid}','${member}'),('${otherSid}','${other}');
    insert into auth.identities(user_id,provider,provider_id) values('${member}','discord','discord-one'),('${other}','discord','discord-two');
    insert into public.staff_memberships values('${member}','active','owner'),('${other}','active','custom_helper');
    insert into private.discord_owner_allowlist values('discord-one',true,'owner'),('discord-two',true,'custom_helper');
    insert into public.staff_role_permissions values('owner','adverts.manage'),('custom_helper','reports.read');
  `);
  const security = read("20260904092528_enforce_member_security_boundaries.sql");
  await db.exec(fn(read("20260904091734_enforce_staff_session_revocation.sql"), "private.has_current_auth_session"));
  for (const name of ["private.member_access_allowed", "public.has_staff_permission", "public.staff_mfa_enrollment_allowed"]) await db.exec(fn(security, name));
  const login = async ({ id = member, session = sid, aal = "aal2" } = {}) => {
    await db.exec("reset role"); await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)", [id, JSON.stringify({ sub: id, session_id: session, aal, app_metadata: { provider: "discord" }, amr: [{ method: "oauth" }, { method: "totp" }] })]);
  };
  const access = async () => (await db.query("select private.has_current_auth_session() session,private.member_access_allowed() member,public.has_staff_permission('adverts.manage') adverts,public.staff_mfa_enrollment_allowed() enrollment")).rows[0];

  await t.test("reproduces an expired session authorizing advert management before the fix", async () => {
    await login(); await db.exec(`update auth.sessions set not_after=now()-interval '1 hour' where id='${sid}'`);
    assert.deepEqual(await access(), { session: true, member: true, adverts: true, enrollment: true });
  });
  await db.exec(read("20260905195616_enforce_auth_session_expiry.sql"));

  await t.test("a past or exactly-ended session cannot authorize member actions, adverts or MFA enrollment", async () => {
    assert.deepEqual(await access(), { session: false, member: false, adverts: false, enrollment: false });
    await db.exec("begin"); await db.exec(`update auth.sessions set not_after=now() where id='${sid}'`);
    assert.deepEqual(await access(), { session: false, member: false, adverts: false, enrollment: false }); await db.exec("rollback");
  });
  await t.test("null and future deadlines keep active owner access while AAL1 stays permission denied", async () => {
    for (const deadline of ["null", "now()+interval '1 hour'"]) {
      await db.exec(`update auth.sessions set not_after=${deadline} where id='${sid}'`); await login();
      assert.deepEqual(await access(), { session: true, member: true, adverts: true, enrollment: true });
    }
    await login({ aal: "aal1" }); assert.deepEqual(await access(), { session: true, member: true, adverts: false, enrollment: true });
  });
  await t.test("custom roles and individual permission overrides retain their existing behavior", async () => {
    await login({ id: other, session: otherSid });
    assert.deepEqual(await access(), { session: true, member: true, adverts: false, enrollment: true });
    assert.equal((await db.query("select public.has_staff_permission('reports.read') value")).rows[0].value, true);
    await db.exec(`insert into public.staff_permission_overrides values('${other}','adverts.manage',true)`); assert.equal((await access()).adverts, true);
    await db.exec("update public.staff_permission_overrides set allowed=false"); assert.equal((await access()).adverts, false);
  });
  await t.test("foreign, malformed, missing and revoked session identities still fail closed", async () => {
    for (const session of [otherSid, "invalid", null]) { await login({ session }); assert.equal((await access()).session, false); }
    await login(); await db.exec(`delete from auth.sessions where id='${sid}'`); assert.equal((await access()).session, false);
    await db.exec(`insert into auth.sessions(id,user_id) values('${sid}','${member}')`);
  });
  await t.test("revoked membership, active account bans and disabled allowlist still restrict the account", async () => {
    await login();
    for (const [change, restore] of [
      ["update public.staff_memberships set status='revoked'", "update public.staff_memberships set status='active'"],
      ["update private.discord_owner_allowlist set enabled=false", "update private.discord_owner_allowlist set enabled=true"],
      [`insert into public.security_bans values('${member}','account',null,now(),null)`, "delete from public.security_bans"]
    ]) { await db.exec(change); const value = await access(); assert.equal(value.adverts, false); assert.equal(value.enrollment, false); await db.exec(restore); }
  });
  await t.test("the shared helper remains private and no fixture data was removed by the migration", async () => {
    const privileges=(await db.query("select has_function_privilege('authenticated','private.has_current_auth_session()','EXECUTE') member,has_function_privilege('anon','private.has_current_auth_session()','EXECUTE') anon,has_function_privilege('service_role','private.has_current_auth_session()','EXECUTE') service")).rows[0];
    assert.deepEqual(privileges,{member:false,anon:false,service:false}); assert.equal((await db.query("select count(*)::int total from auth.users")).rows[0].total,2);
  });
});
