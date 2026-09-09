import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { privacyFileFixture } from "./privacy-file-fixture.mjs";

const read = name => readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), "utf8");
const proposal = readFileSync(new URL("../supabase/rollout/raw-badge-award-privacy.sql", import.meta.url), "utf8");
const columns = "user_id,badge_id,awarded_at,expires_at";
const finalRevokes = `revoke all on table public.user_badges from public,anon,authenticated;
revoke all (user_id,badge_id,awarded_by,reason,awarded_at,expires_at)
 on table public.user_badges from public,anon,authenticated;`;

test("the standalone badge read restriction preserves production consumers and future canonical closure", async t => {
  const h = await privacyFileFixture(t), { db, owner, a, b, admin, login, call, create, review, approve, generate } = h;
  const core = read("202608180001_browserp_core.sql");
  const server = randomUUID();
  await admin(core.match(/insert into public\.badges \(key, name, description, icon_key, color, system_managed\) values[\s\S]*?;/)[0]);
  await admin(read("20260908100413_comment_identity_and_replies.sql"));
  await admin(`alter table public.user_badges enable row level security;
    alter table public.profiles enable row level security;
    grant select on public.profiles,public.badges to anon,authenticated;
    grant all on public.user_badges to anon,authenticated,service_role;
    grant select on public.user_badges to public;
    grant select(reason,awarded_by) on public.user_badges to authenticated;
    alter role service_role bypassrls;`);
  await admin(core.match(/create policy user_badges_public_read[^;]+;/)[0]);
  await admin(core.match(/create policy profiles_public_read[^;]+;/)[0]);
  await admin(`update public.profiles set profile_visibility='private' where id in ('${a}','${b}');
    insert into public.user_badges(user_id,badge_id,awarded_by,reason)
      select u.id,b.id,'${owner}','PRIVATE_FIXTURE_AWARD_REASON' from public.profiles u cross join public.badges b where b.key='community_helper';
    insert into public.user_badges(user_id,badge_id,reason,expires_at)
      select '${owner}',id,'EXPIRED_FIXTURE_EVIDENCE',now()-interval '1 day' from public.badges where key='new_joiner';
    insert into public.platforms(id,name,short_name) values('fivem','FiveM','FiveM');
    insert into public.servers(id,owner_id,platform_id,name,slug,description,region,status)
      values('${server}','${owner}','fivem','Privacy fixture RP','privacy-fixture-rp','A controlled fixture community for the badge projection check.','Europe','published');
    insert into public.server_comments(server_id,author_id,body,status)
      values('${server}','${owner}','A published fixture staff comment.','published');`);
  const asAnon = async () => { await admin(); await db.query("select set_config('request.jwt.claim.sub','',false)"); await db.exec("set role anon"); };
  const publicRows = async () => (await db.query(`select ${columns} from public.user_badges order by user_id,badge_id`)).rows;
  const controls = async () => {
    await admin();
    return (await db.query(`select md5(pg_get_functiondef('public.public_server_engagement(text)'::regprocedure)) engagement,
      md5(pg_get_functiondef('private.member_export_records(uuid)'::regprocedure)) collector,
      (select jsonb_agg(to_jsonb(p) order by policyname) from pg_policies p where schemaname='public' and tablename='user_badges') policies,
      (select jsonb_agg(jsonb_build_object('role',r,'insert',has_table_privilege(r,'public.user_badges','insert'),
        'update',has_table_privilege(r,'public.user_badges','update'),'delete',has_table_privilege(r,'public.user_badges','delete')) order by r)
       from unnest(array['anon','authenticated','service_role']) r) writes`)).rows[0];
  };
  const before = await controls();
  await asAnon(); const anonymousBefore = await publicRows(); const engagementBefore = await call("public_server_engagement", ["privacy-fixture-rp"]);
  await login(a); const memberBefore = await publicRows();

  await t.test("the real old policy exposes synthetic reason/actor fields before the proposal", async () => {
    await asAnon();
    const rows = (await db.query("select awarded_by,reason from public.user_badges")).rows;
    assert.equal(rows.length, 1); assert.equal(rows[0].reason, "PRIVATE_FIXTURE_AWARD_REASON"); assert.equal(rows[0].awarded_by, owner);
    await login(a);
    assert.equal((await db.query("select reason from public.user_badges where user_id=$1", [a])).rows[0].reason, "PRIVATE_FIXTURE_AWARD_REASON");
  });

  await t.test("only four explicit columns survive, with identical eligible rows and no whole-row/filter bypass", async () => {
    await admin(proposal); await admin(proposal); // Repeating before canonical migration is safe.
    for (const role of ["anon", "authenticated"]) {
      await admin();
      const privileges = (await db.query(`select has_table_privilege($1,'public.user_badges','select') whole,
        has_column_privilege($1,'public.user_badges','reason','select') reason,
        has_column_privilege($1,'public.user_badges','awarded_by','select') actor`, [role])).rows[0];
      assert.deepEqual(privileges, { whole: false, reason: false, actor: false });
      if (role === "anon") await asAnon(); else await login(a);
      assert.deepEqual(await publicRows(), role === "anon" ? anonymousBefore : memberBefore);
      for (const sql of ["select reason from public.user_badges", "select awarded_by from public.user_badges", "select * from public.user_badges",
        "select to_jsonb(b) from public.user_badges b", "select user_id from public.user_badges where reason='PRIVATE_FIXTURE_AWARD_REASON'",
        "select user_id from public.user_badges order by awarded_by"]) await assert.rejects(db.query(sql), { code: "42501" });
    }
    assert.equal(anonymousBefore.length, 1); assert.equal(memberBefore.length, 2);
  });

  await t.test("actual public engagement and an approved member account copy keep working", async () => {
    await asAnon();
    assert.deepEqual(await call("public_server_engagement", ["privacy-fixture-rp"]), engagementBefore);
    assert.deepEqual(engagementBefore.comments[0].badges, [{ kind: "staff", label: "Owner" }, { kind: "server_owner", label: "Server owner" }]);
    await login(a); let request = await create(); await login(owner); request = await approve(await review(request));
    await login(a); const copy = await generate(request);
    const records = JSON.parse((await call("member_read_data_export", [copy.id])).content);
    assert.equal(records.collections.badges.length, 1);
    assert.equal(records.collections.badges[0].badge.key, "community_helper");
    assert.doesNotMatch(JSON.stringify(records.collections.badges), /PRIVATE_FIXTURE_AWARD_REASON|awarded_by/);
    assert.deepEqual(await controls(), before);
  });

  await t.test("service reads/writes remain available and no new badge, session or hierarchy objects are introduced", async () => {
    await admin(); await db.exec("set role service_role");
    assert.equal((await db.query("select reason from public.user_badges where user_id=$1", [b])).rows[0].reason, "PRIVATE_FIXTURE_AWARD_REASON");
    await db.query("update public.user_badges set reason=reason where user_id=$1", [b]);
    await admin();
    assert.deepEqual((await db.query(`select to_regprocedure('public.member_badges(uuid)') badges,
      to_regprocedure('public.member_connection_status_v2()') v2,to_regclass('private.member_signup_order') signup,
      to_regclass('private.staff_access_requests') staff_requests`)).rows[0], { badges: null, v2: null, signup: null, staff_requests: null });
  });

  await t.test("the accepted later migration removes transitional column grants and rerunning this proposal cannot reopen them", async () => {
    await admin();
    // Exact two REVOKEs from accepted 20260909163000_member_badges.sql, whose
    // SHA-256 is 6e753cc0803bf95235916700bfeb74b8b72a8fc7f3fc2cd0375cf19e30e847c0.
    await db.exec(finalRevokes);
    for (const role of ["anon", "authenticated"]) {
      assert.equal((await db.query("select has_any_column_privilege($1,'public.user_badges','select') allowed", [role])).rows[0].allowed, false);
    }
    // Only an ordering marker is simulated; no canonical badge feature is enabled.
    await db.exec("create function public.member_badges(uuid) returns jsonb language sql as $$select null::jsonb$$;");
    try { await assert.rejects(db.exec(proposal), /Canonical badges are already installed/); }
    finally { await db.exec("rollback"); }
    assert.equal((await db.query("select has_any_column_privilege('authenticated','public.user_badges','select') allowed")).rows[0].allowed, false);
  });
});
