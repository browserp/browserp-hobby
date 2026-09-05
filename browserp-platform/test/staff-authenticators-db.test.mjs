import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
const read = file => readFileSync(new URL(`../supabase/migrations/${file}`, import.meta.url), "utf8");
const fn = (source, name) => source.match(new RegExp(`create or replace function ${name.replaceAll(".", "\\.")}\\([\\s\\S]*?\\n\\$\\$;`))[0];
const member = "00000000-0000-4000-8000-000000000001", other = "00000000-0000-4000-8000-000000000002";
const sid = "aaaaaaaa-0000-4000-8000-000000000001", otherSid = "aaaaaaaa-0000-4000-8000-000000000002";
const operationId = "bbbbbbbb-0000-4000-8000-000000000001";

test("staff authenticator writes require active allowed Discord AAL2 sessions and exclusive account leases", async t => {
  const db = new PGlite(); t.after(() => db.close());
  await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create schema private;
    revoke all on schema private from public;
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
    create table auth.users(id uuid primary key,deleted_at timestamptz,is_anonymous boolean default false);
    create table auth.sessions(id uuid primary key,user_id uuid,not_after timestamptz);
    create table auth.identities(user_id uuid,provider text,provider_id text,identity_data jsonb default '{}');
    create table auth.mfa_factors(id uuid primary key,user_id uuid,status text,factor_type text);
    create table public.staff_memberships(user_id uuid,status text,role_key text);
    create table private.discord_owner_allowlist(discord_user_id text,enabled boolean,role_key text);
    create table public.security_bans(user_id uuid,target_type text,revoked_at timestamptz,starts_at timestamptz,ends_at timestamptz);
    create table private.network_evidence(activity_id bigint,network_ciphertext text,network_hash text,device_hash text,user_agent_hash text);
    insert into auth.users(id) values('${member}'),('${other}');
    insert into auth.sessions(id,user_id) values('${sid}','${member}'),('${otherSid}','${other}');
    insert into auth.identities(user_id,provider,provider_id) values('${member}','discord','discord-one'),('${other}','discord','discord-two');
    insert into public.staff_memberships values('${member}','active','owner'),('${other}','active','moderator');
    insert into private.discord_owner_allowlist values('discord-one',true,'owner'),('discord-two',true,'moderator');
  `);
  const operations = read("20260819192413_platform_operations_and_trust.sql");
  await db.exec(operations.match(/create table if not exists public\.account_activity \([\s\S]*?\n\);/)[0]);
  await db.exec(fn(read("20260904091734_enforce_staff_session_revocation.sql"), "private.has_current_auth_session"));
  const security = read("20260904092528_enforce_member_security_boundaries.sql");
  await db.exec(fn(security, "private.member_access_allowed"));
  await db.exec(fn(security, "public.staff_mfa_enrollment_allowed"));
  await db.exec(read("20260905200710_serialize_staff_authenticator_management.sql"));
  await db.exec(read("20260905195616_enforce_auth_session_expiry.sql"));
  await db.exec(read("20260905200719_recover_initial_staff_authenticator_setup.sql"));
  const login = async ({ id = member, session = sid, aal = "aal2", provider = "discord", amr = [{ method: "oauth" }, { method: "totp" }] } = {}) => {
    await db.exec("reset role"); await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)", [id, JSON.stringify({ sub: id, session_id: session, aal, app_metadata: { provider }, amr })]); await db.exec("set role authenticated");
  };
  const admin = async sql => { await db.exec("reset role"); await db.exec(sql); };
  const operation = async (action = "acquire", id = operationId) => (await db.query("select public.staff_authenticator_operation($1,$2) value", [action, id])).rows[0].value;
  const access = async () => (await db.query("select public.staff_authenticator_access() value")).rows[0].value;
  const initial = async (action = "acquire", id = operationId) => (await db.query("select public.staff_initial_authenticator_operation($1,$2) value", [action, id])).rows[0].value;

  await t.test("AAL1, missing TOTP proof, linked/other providers and foreign sessions are rejected", async () => {
    for (const change of [{ aal: "aal1" }, { amr: [{ method: "oauth" }] }, { provider: "google" }, { session: otherSid }, { session: "bad" }]) {
      await login(change); assert.equal(await access(), false); await assert.rejects(operation(), /Verify your staff authenticator/);
    }
    await admin(`insert into auth.identities(user_id,provider,provider_id) values('${member}','google','fixture')`); await login(); assert.equal(await access(), false); await assert.rejects(operation(), /Verify your staff authenticator/);
    await admin("delete from auth.identities where provider='google'");
  });
  await t.test("banned, expired, revoked and no-longer-allowlisted staff cannot manage factors", async () => {
    for (const [change, restore] of [
      [`insert into public.security_bans values('${member}','account',null,now(),null)`, "delete from public.security_bans"],
      [`update auth.sessions set not_after=now()-interval '1 second' where id='${sid}'`, "update auth.sessions set not_after=null"],
      [`delete from auth.sessions where id='${sid}'`, `insert into auth.sessions(id,user_id) values('${sid}','${member}')`],
      ["update public.staff_memberships set status='revoked'", "update public.staff_memberships set status='active'"],
      ["update private.discord_owner_allowlist set enabled=false", "update private.discord_owner_allowlist set enabled=true"]
    ]) { await admin(change); await login(); assert.equal(await access(), false); await assert.rejects(operation(), /Verify your staff authenticator/); await admin(restore); }
  });
  await t.test("one lease wins; wrong tokens and other accounts cannot release it", async () => {
    await login(); assert.equal(await access(), true); assert.equal(await operation(), true); assert.equal(await operation("acquire", otherSid), false);
    assert.equal(await operation("release", otherSid), false); await login({ id: other, session: otherSid }); assert.equal(await operation("release"), false);
    await login(); assert.equal(await operation("acquire", otherSid), false); assert.equal(await operation("release"), true); assert.equal(await operation("acquire", otherSid), true);
    await admin("update private.staff_authenticator_operations set expires_at=now()-interval '1 second'"); await login(); assert.equal(await operation(), true); assert.equal(await operation("release"), true);
  });
  await t.test("private leases and audit writes cannot be read or modified directly by members", async () => {
    await login(); await assert.rejects(db.query("select * from private.staff_authenticator_operations"), /permission denied/);
    await assert.rejects(db.query("delete from private.staff_authenticator_operations"), /permission denied/);
    for (const role of ["anon", "service_role"]) { await db.exec(`reset role;set role ${role}`); await assert.rejects(operation(), /permission denied/); await assert.rejects(access(), /permission denied/); await assert.rejects(initial(), /permission denied/); }
    await db.exec("reset role");
    const permissions = (await db.query("select has_function_privilege('authenticated','public.record_account_activity_server(uuid,text,text,text,text,text,text,text,text,text,text,text,jsonb)','EXECUTE') member, has_function_privilege('service_role','public.record_account_activity_server(uuid,text,text,text,text,text,text,text,text,text,text,text,jsonb)','EXECUTE') server")).rows[0];
    assert.deepEqual(permissions, { member: false, server: true });
  });
  await t.test("initial setup shares the account lease and becomes unavailable as soon as any factor is verified", async () => {
    await admin(`insert into auth.mfa_factors values('${operationId}','${member}','unverified','totp')`);
    await login({ aal: "aal1", amr: [{ method: "oauth" }] });
    assert.equal(await initial(), true); assert.equal(await initial("check"), true);
    await assert.rejects(operation(), /Verify your staff authenticator/);
    assert.equal(await initial("acquire", otherSid), false);
    assert.equal(await initial("release", otherSid), false);
    await login({ id: other, session: otherSid, aal: "aal1" }); assert.equal(await initial("release"), false);
    await login(); assert.equal(await operation("acquire", otherSid), false);
    await admin("update auth.mfa_factors set status='verified'");
    await login({ aal: "aal1" }); await assert.rejects(initial("check"), /already verified/); await assert.rejects(initial("acquire", otherSid), /already verified/);
    assert.equal(await initial("release"), true);
    await login(); assert.equal(await operation(), true); assert.equal(await operation("release"), true);
    await admin("update auth.mfa_factors set factor_type='phone'");
    await login({ aal: "aal1" }); await assert.rejects(initial(), /already verified/);
    await admin("delete from auth.mfa_factors");
  });
  await t.test("initial recovery rejects revoked, expired, banned, linked and foreign staff sessions", async () => {
    for (const change of [{ provider: "google" }, { session: otherSid }, { session: "bad" }]) {
      await login({ aal: "aal1", ...change }); await assert.rejects(initial(), /active staff sign-in/);
    }
    for (const [change, restore] of [
      [`insert into public.security_bans values('${member}','account',null,now(),null)`, "delete from public.security_bans"],
      [`update auth.sessions set not_after=now()-interval '1 second' where id='${sid}'`, "update auth.sessions set not_after=null"],
      [`delete from auth.sessions where id='${sid}'`, `insert into auth.sessions(id,user_id) values('${sid}','${member}')`],
      ["update public.staff_memberships set status='revoked'", "update public.staff_memberships set status='active'"],
      ["update private.discord_owner_allowlist set enabled=false", "update private.discord_owner_allowlist set enabled=true"],
      [`insert into auth.identities(user_id,provider,provider_id) values('${member}','google','fixture')`, "delete from auth.identities where provider='google'"]
    ]) { await admin(change); await login({ aal: "aal1" }); await assert.rejects(initial(), /active staff sign-in/); await admin(restore); }
    await login({ aal: "aal1" }); assert.equal(await initial(), true);
    await admin("update private.staff_authenticator_operations set expires_at=now()-interval '1 second'");
    await login({ aal: "aal1" }); assert.equal(await initial("check"), false); assert.equal(await initial("acquire", otherSid), true); assert.equal(await initial("release", otherSid), true);
    await db.exec("reset role"); assert.equal((await db.query("select count(*)::int n from auth.mfa_factors")).rows[0].n, 0);
  });
  await t.test("factor removal, identity link and unlink all keep their audit events, while unknown event types are denied", async () => {
    await db.exec("reset role;set role service_role");
    await db.query("select public.record_account_activity_server($1,'auth.mfa_removed','discord',null,null,null,null,'fixture',null,null,null,null,'{\"factorId\":\"fixture-factor\"}')", [member]);
    await db.query("select public.record_account_activity_server($1,'auth.identity_unlinked','google',null,null,null,null,'fixture',null,null,null,null,'{\"sessionsEnded\":true}')", [member]);
    await db.query("select public.record_account_activity_server($1,'auth.identity_linked','google',null,null,null,null,'fixture',null,null,null,null,'{}')", [member]);
    await assert.rejects(db.query("select public.record_account_activity_server($1,'unknown','discord',null,null,null,null,'fixture',null,null,null,null,'{}')", [member]), /Invalid account activity type/);
    await db.exec("reset role"); assert.deepEqual((await db.query("select event_type from public.account_activity order by id")).rows.map(row => row.event_type), ["auth.mfa_removed", "auth.identity_unlinked", "auth.identity_linked"]);
  });
});
