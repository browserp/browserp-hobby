// Execute the actual migrated functions in disposable PostgreSQL, with no network.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";

const read = name => readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), "utf8");
const fn = (source, name) => source.match(new RegExp(`create or replace function ${name.replaceAll(".", "\\.")}\\([\\s\\S]*?\\n\\$\\$;`))[0];
const table = (source, name) => source.match(new RegExp(`create table(?: if not exists)? public\\.${name} \\([\\s\\S]*?\\n\\);`))[0];
const member = "00000000-0000-4000-8000-000000000001", other = "00000000-0000-4000-8000-000000000002", staff = "00000000-0000-4000-8000-000000000003";
const sid = id => id.replace("00000000", "aaaaaaaa");

async function fixture(t) {
  const db = new PGlite(); t.after(() => db.close());
  const core = read("202608180001_browserp_core.sql"), ops = read("20260819192413_platform_operations_and_trust.sql");
  const guards = read("20260904092528_enforce_member_security_boundaries.sql");
  await db.exec(`create role anon;create role authenticated;create role service_role;
    create schema auth;create schema private;create schema extensions;revoke all on schema private from public;
    create function extensions.gen_random_uuid() returns uuid language sql as $$select pg_catalog.gen_random_uuid()$$;
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
    create table auth.users(id uuid primary key,deleted_at timestamptz,is_anonymous boolean default false,raw_user_meta_data jsonb default '{}');
    create table auth.sessions(id uuid primary key,user_id uuid not null,not_after timestamptz);
  `);
  for (const statement of core.matchAll(/create table public\.\w+ \([\s\S]*?\n\);/g)) await db.exec(statement[0]);
  for (const name of ["security_bans", "server_votes", "server_comments"]) await db.exec(table(ops, name));
  for (const name of ["profiles", "servers"]) {
    await db.exec(ops.match(new RegExp(`alter table public\\.${name}\\s+add column[\\s\\S]*?;`))[0]);
  }
  await db.exec(fn(core, "public.consume_rate_limit"));
  await db.exec(read("20260905195616_enforce_auth_session_expiry.sql"));
  for (const name of ["private.member_access_allowed", "private.require_active_member", "private.enforce_member_rate_limit", "public.member_server_interaction"]) {
    await db.exec(fn(guards, name));
  }
  await db.exec(fn(ops, "public.public_server_engagement"));
  await db.exec(`revoke all on function public.consume_rate_limit(text,text,integer,integer),
    private.member_access_allowed(),private.require_active_member(),private.enforce_member_rate_limit(text,integer,integer),
    public.member_server_interaction(uuid,text,text,text),public.public_server_engagement(text) from public,anon,authenticated,service_role;
    grant execute on function public.member_server_interaction(uuid,text,text,text) to authenticated;
    grant execute on function public.public_server_engagement(text) to anon,authenticated,service_role;
    alter table public.server_comments enable row level security;
    alter table public.server_votes enable row level security;
    revoke all on public.server_comments,public.server_votes,public.security_bans from public,anon,authenticated;
  `);
  const server = randomUUID(), foreignServer = randomUUID(), unpublishedServer = randomUUID(), adultServer = randomUUID();
  const parent = randomUUID(), plain = randomUUID(), hidden = randomUUID(), rejected = randomUUID(), pending = randomUUID();
  const foreignParent = randomUUID(), unpublishedParent = randomUUID(), adultParent = randomUUID();
  await db.exec(`insert into auth.users(id,raw_user_meta_data) values
    ('${member}','{"role":"owner","staff":true,"badges":["Moderator","Server owner"]}'),('${other}','{}'),('${staff}','{}');
    insert into auth.sessions(id,user_id) values('${sid(member)}','${member}'),('${sid(other)}','${other}'),('${sid(staff)}','${staff}');
    insert into public.profiles(id,username,display_name,avatar_url,avatar_review_status,approved_avatar_url) values
    ('${member}','member','Moderator - Server owner','https://example.test/unreviewed.png','pending_review','https://example.test/previous.png'),
    ('${other}','other','Other member',null,'not_set',null),
    ('${staff}','trusted','Trusted moderator','https://example.test/raw.png','approved','https://example.test/approved.png');
    insert into public.staff_roles(key,name,description,rank) values('moderator','Moderator','Fixture moderator role',50);
    insert into public.staff_memberships(user_id,role_key,reason) values('${staff}','moderator','Fixture membership');
    insert into public.platforms(id,name,short_name) values('fivem','FiveM','FiveM');
    insert into public.servers(id,owner_id,platform_id,name,slug,description,region,status,age_rating,access_type,cfx_join_url,animated_media_enabled) values
    ('${server}','${staff}','fivem','Primary community','primary-community','A published roleplay community for the isolated comment regression.','Europe','published','general','allowlisted','https://cfx.re/join/abc123',true),
    ('${foreignServer}','${other}','fivem','Foreign community','foreign-community','A separate published community for same-server reply boundary checks.','Europe','published','general','public',null,false),
    ('${unpublishedServer}','${staff}','fivem','Draft community','draft-community','An unpublished community that must never receive public replies.','Europe','draft','general','public',null,false),
    ('${adultServer}','${staff}','fivem','Adult community','adult-community','An adult community that must never receive public replies here.','Europe','published','adult','public',null,false);
    insert into public.server_comments(id,server_id,author_id,body,status,created_at) values
    ('${parent}','${server}','${staff}','PARENT_TEXT_PRIVATE_IF_HIDDEN','published','2026-01-02T00:00:00Z'),
    ('${plain}','${server}','${member}','Ordinary comment from a member.','published','2026-01-01T00:00:00Z'),
    ('${hidden}','${server}','${staff}','HIDDEN_PARENT_TEXT','hidden','2026-01-01T00:00:00Z'),
    ('${rejected}','${server}','${staff}','REJECTED_PARENT_TEXT','rejected','2026-01-01T00:00:00Z'),
    ('${pending}','${server}','${staff}','PENDING_PARENT_TEXT','pending_review','2026-01-01T00:00:00Z'),
    ('${foreignParent}','${foreignServer}','${other}','FOREIGN_PARENT_TEXT','published','2026-01-01T00:00:00Z'),
    ('${unpublishedParent}','${unpublishedServer}','${staff}','UNPUBLISHED_SERVER_PARENT_TEXT','published','2026-01-01T00:00:00Z'),
    ('${adultParent}','${adultServer}','${staff}','ADULT_SERVER_PARENT_TEXT','published','2026-01-01T00:00:00Z');
  `);
  const admin = async sql => { await db.exec("reset role"); if (sql) await db.exec(sql); };
  const login = async (id = member, session = sid(id), extra = {}) => {
    await admin();
    await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)",
      [id || "", JSON.stringify({ sub: id, session_id: session, user_metadata: { role: "owner", staff: true }, ...extra })]);
    await db.exec("set role authenticated");
  };
  const call = async (expression, values = []) => (await db.query(`select public.${expression} value`, values)).rows[0].value;
  const engagement = () => call("public_server_engagement($1)", ["primary-community"]);
  const reply = (parentId = parent, body = "A helpful reply to this comment.", serverId = server) =>
    call("member_server_comment_reply($1,$2,$3)", [serverId, parentId, body]);
  const baseline = await engagement();
  await db.exec(read("20260908100413_comment_identity_and_replies.sql"));
  return { db, admin, login, call, engagement, reply, baseline, server, foreignServer, unpublishedServer, adultServer,
    parent, plain, hidden, rejected, pending, foreignParent, unpublishedParent, adultParent };
}

test("comment identities and replies preserve moderation, visibility, and real member security", async t => {
  const h = await fixture(t), { db, admin, login, call, engagement, reply, baseline, server, foreignServer,
    unpublishedServer, adultServer, parent, plain, hidden, rejected, pending, foreignParent, unpublishedParent, adultParent } = h;
  let childId;
  const snapshot = async () => {
    await admin();
    return (await db.query(`select (select count(*)::int from public.server_comments) comments,
      (select count(*)::int from public.moderation_queue) reviews,
      (select coalesce(sum(request_count),0)::int from public.rate_limit_buckets) requests`)).rows[0];
  };

  await t.test("the public response preserves existing fields and approved-avatar rules with unspoofable badges", async () => {
    await admin("set role anon"); const result = await engagement();
    assert.deepEqual({ ...result, comments: result.comments.map(({ badges, editedAt, parent: ignored, ...old }) => old) }, baseline);
    const trusted = result.comments.find(c => c.id === parent), ordinary = result.comments.find(c => c.id === plain);
    assert.deepEqual(trusted.badges, [{ kind: "staff", label: "Moderator" }, { kind: "server_owner", label: "Server owner" }]);
    assert.deepEqual(ordinary.badges, []); assert.equal(ordinary.author, "Moderator - Server owner");
    assert.equal(trusted.avatarUrl, "https://example.test/approved.png"); assert.equal(ordinary.avatarUrl, null);
    for (const item of result.comments) { assert.equal(item.editedAt, null); assert.equal(item.parent, null); }
    assert.doesNotMatch(JSON.stringify(result), /unreviewed.png|previous.png|raw.png|HIDDEN_PARENT|REJECTED_PARENT|PENDING_PARENT/);
    await login(); assert.deepEqual((await engagement()).comments.find(c => c.id === plain).badges, []);
    assert.equal(await call("public_server_engagement($1)", ["draft-community"]), null);
    assert.equal(await call("public_server_engagement($1)", ["adult-community"]), null);
  });

  await t.test("one same-server reply creates one pending comment, one moderation entry, and one rate count", async () => {
    const before = await snapshot(); await login(); const result = await reply(); childId = result.id;
    assert.deepEqual(result, { id: childId, status: "pending_review", parentCommentId: parent });
    assert.ok(!((await engagement()).comments.some(c => c.id === childId)), "an unreviewed reply must not be public");
    const after = await snapshot();
    assert.deepEqual(after, { comments: before.comments + 1, reviews: before.reviews + 1, requests: before.requests + 1 });
    const stored = (await db.query("select server_id,author_id,parent_comment_id,body,status,edited_at from public.server_comments where id=$1", [childId])).rows[0];
    assert.deepEqual(stored, { server_id: server, author_id: member, parent_comment_id: parent, body: "A helpful reply to this comment.", status: "pending_review", edited_at: null });
    const review = (await db.query("select target_type,target_id,confidence,score,reasons,status from public.moderation_queue where target_id=$1", [childId])).rows;
    assert.deepEqual(review, [{ target_type: "server_comment", target_id: childId, confidence: "review_recommended", score: 40, reasons: ["member_comment"], status: "open" }]);
    await admin(`update public.server_comments set status='published' where id='${childId}'`);
    const visible = (await engagement()).comments.find(c => c.id === childId);
    assert.deepEqual(visible.parent, { id: parent, author: "Trusted moderator", body: "PARENT_TEXT_PRIVATE_IF_HIDDEN", createdAt: "2026-01-02T00:00:00+00:00", unavailable: false });
    assert.equal(visible.editedAt, null);
  });

  await t.test("invalid parents, unavailable listings, and invalid bodies leave no comments, reviews, or rate writes", async () => {
    const before = await snapshot(); await login();
    for (const id of [null, randomUUID(), hidden, rejected, pending, foreignParent]) {
      await assert.rejects(reply(id), /unavailable for replies/);
    }
    await assert.rejects(reply(unpublishedParent, undefined, unpublishedServer), /Server not found/);
    await assert.rejects(reply(adultParent, undefined, adultServer), /Server not found/);
    await assert.rejects(reply(parent, undefined, null), /Server not found/);
    for (const body of [null, "", "ab", "x".repeat(1001)]) await assert.rejects(reply(parent, body), /Comment must be/);
    assert.deepEqual(await snapshot(), before);
  });

  await t.test("revoked, expired, mismatched, anonymous, deleted, and banned identities cannot reply", async () => {
    const before = await snapshot();
    const denied = async (sql = "", id = member, session = sid(id)) => {
      await admin("begin");
      try {
        if (sql) await db.exec(sql); await login(id, session);
        await assert.rejects(reply(), /active, unrestricted/);
      } finally { await db.exec("rollback"); }
    };
    await denied(`delete from auth.sessions where id='${sid(member)}'`);
    await denied(`update auth.sessions set not_after=now()-interval '1 second' where id='${sid(member)}'`);
    await denied("", member, sid(other)); await denied("", member, null); await denied("", member, "not-a-session-id");
    await denied(`update auth.users set is_anonymous=true where id='${member}'`);
    await denied(`update auth.users set deleted_at=now() where id='${member}'`);
    await denied(`insert into public.security_bans(user_id,target_type,target_hash,public_reference,scope,reason_code,reason,actor_id)
      values('${member}','account','${"f".repeat(64)}','BRP-REPLY00001','account','fixture','An active fixture account ban.','${staff}')`);
    for (const role of ["anon", "service_role"]) {
      await admin(`set role ${role}`); await assert.rejects(reply(), /permission denied/);
    }
    assert.deepEqual(await snapshot(), before);
  });

  await t.test("badge changes reflect current membership, role names, and listing ownership immediately", async () => {
    const withChange = async (sql, verify) => {
      await admin("begin");
      try { await db.exec(sql); await db.exec("set local role anon"); await verify(await engagement()); }
      finally { await db.exec("rollback"); }
    };
    for (const status of ["suspended", "revoked"]) {
      await withChange(`update public.staff_memberships set status='${status}' where user_id='${staff}'`, result => {
        assert.deepEqual(result.comments.find(c => c.id === parent).badges, [{ kind: "server_owner", label: "Server owner" }]);
      });
    }
    await withChange(`delete from public.staff_memberships where user_id='${staff}'`, result => {
      assert.deepEqual(result.comments.find(c => c.id === parent).badges, [{ kind: "server_owner", label: "Server owner" }]);
    });
    await withChange("update public.staff_roles set name='Senior moderator' where key='moderator'", result => {
      assert.deepEqual(result.comments.find(c => c.id === parent).badges, [{ kind: "staff", label: "Senior moderator" }, { kind: "server_owner", label: "Server owner" }]);
    });
    await withChange(`insert into public.staff_roles(key,name,description,rank) values('helper','Helper','Fixture lower staff role',10);
      update public.staff_memberships set role_key='helper' where user_id='${staff}'`, result => {
      assert.deepEqual(result.comments.find(c => c.id === parent).badges, [{ kind: "staff", label: "Helper" }, { kind: "server_owner", label: "Server owner" }]);
    });
    await withChange(`update public.servers set owner_id='${member}' where id='${server}'`, result => {
      assert.deepEqual(result.comments.find(c => c.id === parent).badges, [{ kind: "staff", label: "Moderator" }]);
      assert.deepEqual(result.comments.find(c => c.id === plain).badges, [{ kind: "server_owner", label: "Server owner" }]);
    });
  });

  await t.test("hidden or nonpublished parents disclose only their ID while published replies remain visible", async () => {
    for (const status of ["hidden", "pending_review", "rejected"]) {
      await admin(`update public.server_comments set status='${status}' where id='${parent}'`);
      await db.exec("set role anon"); const result = await engagement();
      assert.deepEqual(result.comments.find(c => c.id === childId).parent, { id: parent, unavailable: true });
      assert.ok(!result.comments.some(c => c.id === parent));
      assert.doesNotMatch(JSON.stringify(result), /PARENT_TEXT_PRIVATE_IF_HIDDEN/);
    }
    await admin(`update public.server_comments set status='published' where id='${parent}'`);
    assert.equal((await engagement()).comments.find(c => c.id === childId).parent.unavailable, false);
  });

  await t.test("same-server and self-parent constraints survive direct writes and parent deletion preserves the reply", async () => {
    await admin();
    await assert.rejects(db.query("update public.server_comments set parent_comment_id=$1 where id=$2", [foreignParent, childId]), /foreign key constraint/);
    await assert.rejects(db.query("update public.server_comments set parent_comment_id=id where id=$1", [childId]), /check constraint/);
    await db.query("delete from public.server_comments where id=$1", [parent]);
    const stored = (await db.query("select server_id,parent_comment_id,edited_at from public.server_comments where id=$1", [childId])).rows[0];
    assert.deepEqual(stored, { server_id: server, parent_comment_id: null, edited_at: null });
    assert.equal((await engagement()).comments.find(c => c.id === childId).parent, null);
  });

  await t.test("only actual body edits set editedAt; forged timestamps and moderation changes cannot mark an edit", async () => {
    const id = randomUUID(); await admin();
    await db.query("insert into public.server_comments(id,server_id,author_id,body,edited_at) values($1,$2,$3,'Original comment body.','2000-01-01')", [id, server, member]);
    const edited = async () => (await db.query("select edited_at::text value from public.server_comments where id=$1", [id])).rows[0].value;
    assert.equal(await edited(), null);
    await db.query("update public.server_comments set status='published',edited_at='2000-01-01' where id=$1", [id]);
    assert.equal(await edited(), null);
    const before = Date.now();
    await db.query("update public.server_comments set body='An actually edited comment.',edited_at='2000-01-01' where id=$1", [id]);
    const timestamp = await edited(); assert.ok(Date.parse(timestamp) >= before - 1000 && Date.parse(timestamp) <= Date.now() + 1000);
    await db.query("update public.server_comments set status='hidden',moderation_score=50,updated_at=now(),edited_at=null where id=$1", [id]);
    assert.equal(await edited(), timestamp);
    await db.query("update public.server_comments set status='published',body=body,edited_at='2001-01-01' where id=$1", [id]);
    assert.equal(await edited(), timestamp);
    const item = (await engagement()).comments.find(c => c.id === id);
    assert.equal(Date.parse(item.editedAt), Date.parse(timestamp));
  });

  await t.test("the original four-argument comment, vote, unvote, and report function remains unchanged and unambiguous", async () => {
    await admin();
    const signatures = (await db.query("select oid::regprocedure::text signature,pronargs from pg_proc where pronamespace='public'::regnamespace and proname='member_server_interaction'")).rows;
    assert.deepEqual(signatures, [{ signature: "member_server_interaction(uuid,text,text,text)", pronargs: 4 }]);
    await login();
    const ordinary = await call("member_server_interaction($1,$2,$3,$4)", [server, "comment", "A normal top-level comment.", null]);
    assert.deepEqual(ordinary, { id: ordinary.id, status: "pending_review" });
    assert.deepEqual(await call("member_server_interaction($1,$2,$3,$4)", [server, "vote", null, null]), { voted: true, voteCount: 1 });
    assert.deepEqual(await call("member_server_interaction($1,$2,$3,$4)", [server, "vote", null, null]), { voted: true, voteCount: 1 });
    assert.deepEqual(await call("member_server_interaction($1,$2,$3,$4)", [server, "unvote", null, null]), { voted: false, voteCount: 0 });
    const report = await call("member_server_interaction($1,$2,$3,$4)", [server, "report", "A detailed report requiring staff follow-up.", "Listing details"]);
    assert.deepEqual(report, { id: report.id, status: "open" });
    await admin();
    assert.deepEqual((await db.query("select parent_comment_id,edited_at from public.server_comments where id=$1", [ordinary.id])).rows[0], { parent_comment_id: null, edited_at: null });
    assert.equal((await db.query("select count(*)::int n from public.moderation_queue where target_id=$1", [ordinary.id])).rows[0].n, 1);
    assert.deepEqual((await db.query("select reporter_id,target_type,target_id,category,details from public.reports where id=$1", [report.id])).rows[0],
      { reporter_id: member, target_type: "server", target_id: server, category: "Listing details", details: "A detailed report requiring staff follow-up." });
  });

  await t.test("replies share the existing account-wide rate cap without double charging the final permitted request", async () => {
    await admin("begin");
    try {
      await db.query("update public.rate_limit_buckets set request_count=19,window_started_at=now() where key_hash=md5('member:'||$1::text) and action='member-db:server-interaction'", [member]);
      await login(); const final = await reply(plain); assert.equal(final.status, "pending_review");
      await admin(); assert.equal((await db.query("select request_count from public.rate_limit_buckets where key_hash=md5('member:'||$1::text) and action='member-db:server-interaction'", [member])).rows[0].request_count, 20);
      await login(); await assert.rejects(reply(plain), /Too many requests/);
    } finally { await db.exec("rollback"); }
  });
});
