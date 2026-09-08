import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const read = file => readFileSync(new URL(`../supabase/migrations/${file}`, import.meta.url), "utf8");
const fn = (source, name) => source.match(new RegExp(`create or replace function ${name.replaceAll(".", "\\.")}\\([\\s\\S]*?\\n\\$\\$;`))[0];
const member = "00000000-0000-4000-8000-000000000001", other = "00000000-0000-4000-8000-000000000002";
const sid = id => id.replace("00000000", "aaaaaaaa");
const maximumVersion = Number.MAX_SAFE_INTEGER;

test("account recommendation preferences enforce rejection-safe versioning and actual PostgreSQL access boundaries", async t => {
  const db = new PGlite(); t.after(() => db.close());
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth; create schema private; revoke all on schema private from public;
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
    create table auth.users(id uuid primary key, deleted_at timestamptz, is_anonymous boolean default false);
    create table auth.sessions(id uuid primary key, user_id uuid, not_after timestamptz);
    create table public.security_bans(user_id uuid, target_type text, revoked_at timestamptz, starts_at timestamptz, ends_at timestamptz);
    insert into auth.users(id) values('${member}'),('${other}');
  `);
  const core = read("202608180001_browserp_core.sql");
  await db.exec(core.match(/create table public\.rate_limit_buckets \([\s\S]*?\n\);/)[0]);
  await db.exec(fn(core, "public.consume_rate_limit"));
  // Execute the real current guard dependencies, including configured expiry.
  await db.exec(read("20260905195616_enforce_auth_session_expiry.sql"));
  const security = read("20260904092528_enforce_member_security_boundaries.sql");
  for (const name of ["private.member_access_allowed", "private.require_active_member", "private.enforce_member_rate_limit"]) await db.exec(fn(security, name));
  await db.exec(read("20260908101556_member_recommendation_preferences.sql"));
  const admin = async sql => { await db.exec("reset role"); return db.exec(sql); };
  const login = async (id = member, sessionId = sid(id || member), extra = {}) => {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)", [id || "", JSON.stringify({ sub: id, session_id: sessionId, ...extra })]);
    await db.exec("set role authenticated");
  };
  const reset = async () => {
    await admin(`delete from private.member_recommendation_preferences; delete from public.rate_limit_buckets;
      delete from public.security_bans; update auth.users set deleted_at=null,is_anonymous=false;
      delete from auth.sessions; insert into auth.sessions(id,user_id) values('${sid(member)}','${member}'),('${sid(other)}','${other}');`);
    await login();
  };
  const get = async () => (await db.query("select public.member_recommendation_preferences() as value")).rows[0].value;
  const set = async (choice, version, schemaVersion = 1) => (await db.query("select public.member_set_recommendation_preferences($1,$2,$3) as value", [schemaVersion, choice, version])).rows[0].value;
  const check = (result, accountId, choice, version) => {
    assert.equal(result.accountId, accountId); assert.equal(result.schemaVersion, 1);
    assert.equal(result.choice, choice); assert.equal(result.version, version);
    assert.deepEqual(Object.keys(result).sort(), ["accountId", "choice", "schemaVersion", "updatedAt", "version"]);
    if (version === 0) assert.equal(result.updatedAt, null);
    else assert.ok(Number.isFinite(Date.parse(result.updatedAt)));
  };

  await t.test("reading an unset choice returns null/version zero and creates no preference row", async () => {
    await reset(); check(await get(), member, null, 0); check(await get(), member, null, 0);
    await admin("select 1"); assert.equal((await db.query("select count(*)::int count from private.member_recommendation_preferences")).rows[0].count, 0);
  });

  await t.test("acceptance needs the exact version while stale rejection creates and updates safely", async () => {
    await reset();
    await assert.rejects(set("accepted", 5), { code: "PT409" });
    check(await set("rejected", 99), member, "rejected", 1);
    await assert.rejects(set("accepted", 0), { code: "PT409" });
    check(await set("accepted", 1), member, "accepted", 2);
    check(await set("rejected", 0), member, "rejected", 3);
    await assert.rejects(set("accepted", 2), { code: "PT409" });
    check(await set("rejected", maximumVersion), member, "rejected", 4);
    check(await set("rejected", 4), member, "rejected", 5);
    check(await set("accepted", 5), member, "accepted", 6);
    await assert.rejects(set("accepted", 5), { code: "PT409" });
    check(await get(), member, "accepted", 6);
  });

  await t.test("conflicting initial writes are safe in either serial order, including absent-row CAS", async () => {
    await reset();
    const acceptThenReject = await Promise.allSettled([set("accepted", 0), set("rejected", 0)]);
    assert.ok(acceptThenReject.every(result => result.status === "fulfilled"));
    check(await get(), member, "rejected", 2);
    await reset();
    const rejectThenAccept = await Promise.allSettled([set("rejected", 0), set("accepted", 0)]);
    assert.equal(rejectThenAccept[0].status, "fulfilled"); assert.equal(rejectThenAccept[1].reason.code, "PT409");
    check(await get(), member, "rejected", 1);
    await reset();
    const duplicateAccept = await Promise.allSettled([set("accepted", 0), set("accepted", 0)]);
    assert.equal(duplicateAccept.filter(result => result.status === "fulfilled").length, 1);
    assert.equal(duplicateAccept.find(result => result.status === "rejected").reason.code, "PT409");
    check(await get(), member, "accepted", 1);
  });

  await t.test("the authenticated actor owns every read/write; JWT metadata cannot choose another account", async () => {
    await reset(); check(await set("accepted", 0), member, "accepted", 1);
    await login(other, sid(other), { user_metadata: { userId: member, accountId: member, choice: "accepted" } });
    check(await get(), other, null, 0); check(await set("rejected", 0), other, "rejected", 1);
    await login(); check(await get(), member, "accepted", 1);
    await assert.rejects(db.query("select public.member_recommendation_preferences($1)", [other]), { code: "42883" });
  });

  await t.test("revoked, foreign, missing, malformed, expired, anonymous, deleted and banned sessions are denied", async () => {
    for (const scenario of ["revoked", "foreign", "missing", "malformed", "expired", "anonymous", "deleted", "banned", "no-user"]) {
      await reset();
      if (scenario === "revoked") await admin(`delete from auth.sessions where user_id='${member}'`);
      if (scenario === "expired") await admin(`update auth.sessions set not_after=now()-interval '1 second' where user_id='${member}'`);
      if (scenario === "anonymous") await admin(`update auth.users set is_anonymous=true where id='${member}'`);
      if (scenario === "deleted") await admin(`update auth.users set deleted_at=now() where id='${member}'`);
      if (scenario === "banned") await admin(`insert into public.security_bans values('${member}','account',null,now(),null)`);
      await login(scenario === "no-user" ? null : member, scenario === "foreign" ? sid(other) : scenario === "missing" ? null : scenario === "malformed" ? "invalid" : sid(member));
      await assert.rejects(get(), { code: "42501" }, scenario);
      for (const choice of ["accepted", "rejected"]) await assert.rejects(set(choice, 0), { code: "42501" }, scenario);
    }
    await reset();
    await admin(`insert into public.security_bans values('${member}','account',now(),now(),null),('${member}','account',null,now()-interval '2 days',now()-interval '1 day')`);
    await login(); check(await set("rejected", 0), member, "rejected", 1);
  });

  await t.test("direct RPC validation rejects missing, unknown and unsafe schema/choice/version values", async () => {
    await reset();
    for (const [choice, version, schemaVersion] of [[null, 0, 1], ["history", 0, 1], ["accepted", null, 1], ["rejected", -1, 1], ["rejected", "9007199254740992", 1], ["accepted", 0, null], ["accepted", 0, 2]]) {
      await assert.rejects(set(choice, version, schemaVersion), { code: "PT400" });
    }
    check(await get(), member, null, 0);
  });

  await t.test("a transaction that outlives the session deadline cannot save using its older now()", async () => {
    await reset();
    await db.exec("begin");
    try {
      await admin(`update auth.sessions set not_after=now()+interval '1 millisecond' where user_id='${member}'`);
      await login();
      await new Promise(resolve => setTimeout(resolve, 15));
      // The inherited stable guard still regards transaction-start now() as
      // before the deadline. The writer must independently use the real clock.
      check(await get(), member, null, 0);
      await assert.rejects(set("accepted", 0), { code: "PT401" });
    } finally { await db.exec("rollback"); }
    await login(); check(await get(), member, null, 0);
  });

  await t.test("an exhausted acceptance quota never prevents rejection and does not spend another account's quota", async () => {
    await reset();
    for (let version = 0; version < 30; version++) await set("accepted", version);
    await assert.rejects(set("accepted", 30), { code: "PT429" });
    check(await set("rejected", 0), member, "rejected", 31);
    await assert.rejects(set("accepted", 31), { code: "PT429" });
    check(await set("rejected", 0), member, "rejected", 32);
    await login(other); check(await set("accepted", 0), other, "accepted", 1);
  });

  await t.test("version exhaustion remains rejection-safe and never reuses a consent version for acceptance", async () => {
    await reset(); await set("accepted", 0);
    await admin(`update private.member_recommendation_preferences set version=${maximumVersion} where user_id='${member}'`);
    await login();
    await assert.rejects(set("accepted", maximumVersion), { code: "PT409" });
    check(await set("rejected", 0), member, "rejected", maximumVersion);
    await assert.rejects(set("accepted", maximumVersion), { code: "PT409" });
    check(await set("rejected", maximumVersion), member, "rejected", maximumVersion);
  });

  await t.test("RLS and grants deny direct data access and anonymous/service RPC access", async () => {
    await reset(); await set("rejected", 0);
    for (const role of ["anon", "authenticated", "service_role"]) {
      await db.exec(`reset role; set role ${role}`);
      await assert.rejects(db.query("select * from private.member_recommendation_preferences"), { code: "42501" });
      await assert.rejects(db.query("delete from private.member_recommendation_preferences"), { code: "42501" });
      if (role !== "authenticated") { await assert.rejects(get(), { code: "42501" }); await assert.rejects(set("rejected", 0), { code: "42501" }); }
    }
    await db.exec("reset role");
    assert.equal((await db.query("select relrowsecurity from pg_class where oid='private.member_recommendation_preferences'::regclass")).rows[0].relrowsecurity, true);
    for (const role of ["anon", "authenticated", "service_role"]) {
      for (const permission of ["SELECT", "INSERT", "UPDATE", "DELETE"]) {
        assert.equal((await db.query("select has_table_privilege($1,'private.member_recommendation_preferences',$2) allowed", [role, permission])).rows[0].allowed, false);
      }
    }
    assert.deepEqual((await db.query("select column_name from information_schema.columns where table_schema='private' and table_name='member_recommendation_preferences' order by ordinal_position")).rows.map(row => row.column_name), ["user_id", "schema_version", "choice", "version", "updated_at"]);
  });

  await t.test("deleting an Auth fixture removes only that account's preference via the explicit FK", async () => {
    await reset(); await set("rejected", 0); await login(other); await set("accepted", 0);
    await admin(`delete from auth.users where id='${member}'`);
    assert.deepEqual((await db.query("select user_id,choice from private.member_recommendation_preferences")).rows, [{ user_id: other, choice: "accepted" }]);
  });
});
