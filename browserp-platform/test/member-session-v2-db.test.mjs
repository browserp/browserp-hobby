import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const read = path => readFileSync(new URL(`../supabase/${path}`, import.meta.url), "utf8");
const migration = name => read(`migrations/${name}`);
const functionSql = (source, name) => {
  const match = source.match(new RegExp(`create or replace function ${name.replaceAll(".", "\\.")}\\([\\s\\S]*?\\n\\$\\$;`));
  assert.ok(match, `Missing source function ${name}`);
  return match[0];
};
const member = "00000000-0000-4000-8000-000000000001";
const other = "00000000-0000-4000-8000-000000000002";
const sid = "aaaaaaaa-0000-4000-8000-000000000001";
const otherSid = "aaaaaaaa-0000-4000-8000-000000000002";
const v2Sql = migration("20260909125137_member_connection_status_v2.sql");
const retirementSql = read("rollout/20260909125139_retire_legacy_member_connection_status.sql");

test("session v2 preserves the guarded contract and supports permanent legacy retirement in PostgreSQL", async t => {
  const db = new PGlite();
  t.after(() => db.close());
  const core = migration("202608180001_browserp_core.sql");
  const memberSecurity = migration("20260904092528_enforce_member_security_boundaries.sql");
  await db.exec(`
    create role anon; create role authenticated; create role service_role; create role rpc_unprivileged;
    create schema auth; create schema private;
    revoke all on schema private from public;
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    create function auth.jwt() returns jsonb language sql stable as $$
      select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
    $$;
    create table auth.users(id uuid primary key, deleted_at timestamptz, is_anonymous boolean default false);
    create table auth.sessions(id uuid primary key, user_id uuid, not_after timestamptz);
    create table public.staff_memberships(user_id uuid, status text);
    create table public.security_bans(user_id uuid, target_type text, revoked_at timestamptz, starts_at timestamptz, ends_at timestamptz);
  `);
  await db.exec(core.match(/create table public\.rate_limit_buckets \([\s\S]*?\n\);/)[0]);
  await db.exec(functionSql(core, "public.consume_rate_limit"));
  await db.exec(migration("20260905195616_enforce_auth_session_expiry.sql"));
  for (const name of ["private.member_access_allowed", "private.require_active_member", "private.enforce_member_rate_limit"]) {
    await db.exec(functionSql(memberSecurity, name));
  }
  await db.exec(migration("20260905195603_member_connection_session_guard.sql"));
  await db.exec(functionSql(migration("20260906004454_structured_member_data_export.sql"), "private.export_recent_member"));
  await db.exec(`
    revoke all on function private.member_access_allowed(), private.require_active_member(),
      private.enforce_member_rate_limit(text, integer, integer), private.export_recent_member()
      from public, anon, authenticated, service_role;
    -- Test-only adapter exercises the real private export helper in the same
    -- postgres-owned SECURITY DEFINER context as its public export consumers.
    create function public.test_export_recent_member() returns uuid
      language sql stable security definer set search_path='' as $$
        select private.export_recent_member()
      $$;
    revoke all on function public.test_export_recent_member() from public, anon, authenticated, service_role;
    grant execute on function public.test_export_recent_member() to authenticated;
  `);
  const now = Number((await db.query("select floor(extract(epoch from now()))::double precision value")).rows[0].value);
  const admin = async sql => {
    await db.exec("reset role");
    if (sql) await db.exec(sql);
  };
  const resetFixtures = async () => admin(`
    truncate private.member_connection_operations, public.rate_limit_buckets,
      public.security_bans, public.staff_memberships, auth.sessions, auth.users;
    insert into auth.users(id) values('${member}'), ('${other}');
    insert into auth.sessions(id, user_id) values('${sid}', '${member}'), ('${otherSid}', '${other}');
  `);
  const login = async ({ id = member, session = sid, oauth = now, amr, extra = {}, role = "authenticated" } = {}) => {
    assert.ok(["authenticated", "anon", "service_role", "rpc_unprivileged"].includes(role));
    await admin();
    await db.query("select set_config('request.jwt.claim.sub', $1, false), set_config('request.jwt.claims', $2, false)", [
      id || "", JSON.stringify({ sub: id, session_id: session, iat: now, amr: amr ?? [{ method: "oauth", timestamp: oauth }], ...extra })
    ]);
    await db.exec(`set role ${role}`);
  };
  const status = async (version = "v2") => {
    assert.ok(["v2", "legacy"].includes(version));
    return (await db.query(`select public.member_connection_status${version === "v2" ? "_v2" : ""}() value`)).rows[0].value;
  };
  const compareStatus = async expected => {
    const result = (await db.query("select public.member_connection_status() legacy, public.member_connection_status_v2() v2")).rows[0];
    assert.deepEqual(result.v2, result.legacy);
    assert.deepEqual(result.v2, expected);
  };
  const activeStatus = ({ id = member, session = sid, authenticatedAt = now, recent = true, staff = false } = {}) => ({
    active: true, staff, userId: id, sessionId: session, authenticatedAt, recent
  });
  const operation = async (action = "begin", token = null) =>
    (await db.query("select public.member_connection_operation($1, $2) value", [action, token])).rows[0].value;
  const exportMember = async () => (await db.query("select public.test_export_recent_member() value")).rows[0].value;
  const denied = action => assert.rejects(action, { code: "42501" });
  const privileges = async () => {
    await admin();
    return (await db.query(`
      select r.role,
        has_function_privilege(r.role, 'public.member_connection_status()', 'execute') legacy,
        has_function_privilege(r.role, 'public.member_connection_status_v2()', 'execute') v2
      from (values ('anon'), ('authenticated'), ('service_role'), ('rpc_unprivileged')) r(role)
      order by r.role
    `)).rows;
  };

  await t.test("retirement refuses a missing v2 without changing legacy execution", async () => {
    await resetFixtures();
    await assert.rejects(db.exec(retirementSql), /guarded authenticated v2 session contract must be installed first/);
    await db.exec("rollback");
    await login();
    assert.deepEqual(await status("legacy"), activeStatus());
    await admin();
    assert.equal((await db.query("select to_regprocedure('public.member_connection_status_v2()') value")).rows[0].value, null);
    await db.exec(v2Sql);
  });

  await t.test("both contracts are initially authenticated-only, including inherited PUBLIC access", async () => {
    assert.deepEqual(await privileges(), [
      { role: "anon", legacy: false, v2: false },
      { role: "authenticated", legacy: true, v2: true },
      { role: "rpc_unprivileged", legacy: false, v2: false },
      { role: "service_role", legacy: false, v2: false }
    ]);
    for (const role of ["anon", "service_role", "rpc_unprivileged"]) {
      await login({ role });
      await denied(() => status("legacy"));
      await denied(() => status());
    }
    await login();
    await compareStatus(activeStatus());
    await denied(() => db.query("select * from auth.sessions"));
    await denied(() => db.query("select private.export_recent_member()"));
  });

  await t.test("active members retain exactly the original six-field response and numeric OAuth timestamp", async () => {
    for (const details of [{}, { id: other, session: otherSid }]) {
      await login(details);
      await compareStatus(activeStatus(details));
      assert.equal(typeof (await status()).authenticatedAt, "number");
    }
  });

  await t.test("revoked, foreign, missing, malformed, expired, banned, deleted and anonymous sessions have only active:false", async sessionTests => {
    const scenarios = [
      { name: "revoked", sql: `delete from auth.sessions where id='${sid}'` },
      { name: "foreign", login: { session: otherSid } },
      { name: "missing session", login: { session: null } },
      { name: "malformed session", login: { session: "invalid" } },
      { name: "missing actor", login: { id: null } },
      { name: "expired", sql: `update auth.sessions set not_after=now()-interval '1 second' where id='${sid}'` },
      { name: "banned", sql: `insert into public.security_bans values('${member}', 'account', null, now()-interval '1 minute', null)` },
      { name: "deleted", sql: `update auth.users set deleted_at=now() where id='${member}'` },
      { name: "anonymous account", sql: `update auth.users set is_anonymous=true where id='${member}'` }
    ];
    for (const scenario of scenarios) {
      await sessionTests.test(scenario.name, async () => {
        await resetFixtures();
        if (scenario.sql) await admin(scenario.sql);
        await login(scenario.login);
        await compareStatus({ active: false });
      });
    }
    await resetFixtures();
  });

  await t.test("fresh, stale, future and malformed OAuth histories preserve authentication age and recency", async () => {
    const histories = [
      { login: { oauth: now - 60 }, authenticatedAt: now - 60, recent: true },
      { login: { oauth: now - 3600 }, authenticatedAt: now - 3600, recent: false },
      { login: { oauth: now + 120 }, authenticatedAt: now + 120, recent: false },
      { login: { amr: [{ method: "oauth", timestamp: now - 3600 }, { method: "token_refresh", timestamp: now }, { method: "totp", timestamp: now }] }, authenticatedAt: now - 3600, recent: false },
      { login: { amr: [{ method: "oauth", timestamp: now - 3600 }, { method: "oauth", timestamp: now - 60 }] }, authenticatedAt: now - 60, recent: true },
      { login: { amr: [{ method: "token_refresh", timestamp: now }] }, authenticatedAt: null, recent: false },
      { login: { amr: [{ method: "oauth", timestamp: String(now) }] }, authenticatedAt: null, recent: false },
      { login: { amr: [{ method: "oauth", timestamp: "invalid" }] }, authenticatedAt: null, recent: false },
      { login: { amr: { method: "oauth", timestamp: now } }, authenticatedAt: null, recent: false },
      { login: { amr: [], extra: { user_metadata: { amr: [{ method: "oauth", timestamp: now }] } } }, authenticatedAt: null, recent: false }
    ];
    for (const history of histories) {
      await login(history.login);
      await compareStatus(activeStatus(history));
    }
  });

  await t.test("current and former staff retain the same staff flag", async () => {
    for (const status of ["active", "suspended", "revoked"]) {
      await resetFixtures();
      await admin(`insert into public.staff_memberships values('${member}', '${status}')`);
      await login();
      await compareStatus(activeStatus({ staff: true }));
    }
    await resetFixtures();
  });

  await t.test("retirement removes explicit and inherited legacy execution while v2 continues to work", async () => {
    // Exercise the revocation against every named grant, including PUBLIC.
    await admin("grant execute on function public.member_connection_status() to public, anon, authenticated, service_role");
    assert.ok((await privileges()).every(row => row.legacy));
    await db.exec(retirementSql);
    assert.deepEqual(await privileges(), [
      { role: "anon", legacy: false, v2: false },
      { role: "authenticated", legacy: false, v2: true },
      { role: "rpc_unprivileged", legacy: false, v2: false },
      { role: "service_role", legacy: false, v2: false }
    ]);
    for (const role of ["authenticated", "anon", "service_role", "rpc_unprivileged"]) {
      await login({ role });
      await denied(() => status("legacy"));
      if (role === "authenticated") assert.deepEqual(await status(), activeStatus());
      else await denied(() => status());
    }
  });

  await t.test("actual connection and export helpers still use the guarded legacy body internally after retirement", async () => {
    await resetFixtures();
    await login();
    const token = await operation();
    assert.match(token, /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/);
    assert.equal(await exportMember(), member);
    await assert.rejects(operation(), { code: "PT409" });
    assert.equal(await operation("release", token), null);
    const nextToken = await operation();
    assert.notEqual(nextToken, token);
    await operation("release", nextToken);
    await denied(() => status("legacy"));

    await login({ oauth: now - 3600 });
    await assert.rejects(operation(), { code: "PT428" });
    await assert.rejects(exportMember(), { code: "PT401" });
    await admin(`delete from auth.sessions where id='${sid}'`);
    await login();
    await assert.rejects(operation(), { code: "PT401" });
    await denied(exportMember);
    assert.deepEqual(await status(), { active: false });

    await resetFixtures();
    await admin(`insert into public.staff_memberships values('${member}', 'active')`);
    await login();
    await denied(operation);
    assert.equal(await exportMember(), member);
    for (const role of ["anon", "service_role"]) {
      await login({ role });
      await denied(operation);
      await denied(exportMember);
    }
  });
});
