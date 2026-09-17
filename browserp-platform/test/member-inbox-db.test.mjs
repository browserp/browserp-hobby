import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const read = file => readFileSync(new URL(`../supabase/migrations/${file}`, import.meta.url), "utf8");
const fn = (source, name) => source.match(new RegExp(`create (?:or replace )?function ${name.replaceAll(".", "\\.")}\\([\\s\\S]*?\\n\\$\\$;`))[0];
const alice = "00000000-0000-4000-8000-000000000001";
const bob = "00000000-0000-4000-8000-000000000002";
const eve = "00000000-0000-4000-8000-000000000003";
const sessions = Object.fromEntries([alice, bob, eve].map((id, index) => [id, `aaaaaaaa-0000-4000-8000-00000000000${index + 1}`]));

test("member inbox enforces private reads, contact rules, blocking, reports and live sessions in PostgreSQL", async t => {
  const db = new PGlite(); t.after(() => db.close());
  const core = read("202608180001_browserp_core.sql");
  const security = read("20260904092528_enforce_member_security_boundaries.sql");
  await db.exec(`create role anon;create role authenticated;create role service_role;
    create schema auth;create schema private;create schema extensions;
    create function extensions.gen_random_uuid() returns uuid language sql volatile as $$select pg_catalog.gen_random_uuid()$$;
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
    create table auth.users(id uuid primary key,deleted_at timestamptz,is_anonymous boolean default false);
    create table auth.sessions(id uuid primary key,user_id uuid,not_after timestamptz);
    create table public.security_bans(user_id uuid,target_type text,revoked_at timestamptz,starts_at timestamptz,ends_at timestamptz);
    create table public.profiles(id uuid primary key,username text unique,display_name text,
      profile_visibility text,avatar_review_status text,approved_avatar_url text);
    create table public.notifications(id uuid primary key default extensions.gen_random_uuid(),
      user_id uuid,title text,body text,kind text,action_url text,read_at timestamptz,created_at timestamptz default now());
    create table public.reports(id uuid primary key default extensions.gen_random_uuid(),
      reporter_id uuid,target_type text,target_id text,category text,details text,status text default 'open');
    create table public.staff_audit_events(actor_id uuid,action text,target_type text,target_id text,
      reason text,request_id text,before_state jsonb,after_state jsonb);
    create function public.has_staff_permission(p text) returns boolean language sql stable as
      $$select p='moderation.resolve' and auth.uid()='${eve}'::uuid$$;
    create function private.member_export_records(p_subject uuid) returns jsonb language sql stable as
      $$select jsonb_build_object('collections','{}'::jsonb,'counts','{}'::jsonb)$$;
    insert into auth.users(id) values ('${alice}'),('${bob}'),('${eve}');
    insert into auth.sessions(id,user_id) values
      ('${sessions[alice]}','${alice}'),('${sessions[bob]}','${bob}'),('${sessions[eve]}','${eve}');
    insert into public.profiles(id,username,display_name,profile_visibility) values
      ('${alice}','alice_rp','Alice','public'),('${bob}','bob_rp','Bob','members'),('${eve}','eve_rp','Eve','public');
  `);
  await db.exec(core.match(/create table public\.rate_limit_buckets \([\s\S]*?\n\);/)[0]);
  await db.exec(fn(core, "public.consume_rate_limit"));
  await db.exec(fn(read("20260904091734_enforce_staff_session_revocation.sql"), "private.has_current_auth_session"));
  for (const name of ["private.member_access_allowed", "private.require_active_member", "private.enforce_member_rate_limit"]) {
    await db.exec(fn(security, name));
  }
  await db.exec(fn(read("20260908112653_member_preference_reply_session_deadlines.sql"), "private.require_member_write_session"));
  await db.exec(read("20260917120000_member_inbox.sql"));
  const admin = async command => { await db.exec("reset role"); await db.exec(command); };
  const login = async id => {
    await db.exec("reset role");
    await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)",
      [id || "", JSON.stringify({ sub: id, session_id: sessions[id] })]);
    await db.exec("set role authenticated");
  };
  const call = async (name, args = []) => {
    const placeholders = args.map((_, i) => `$${i + 1}`).join(",");
    return (await db.query(`select public.${name}(${placeholders}) value`, args)).rows[0].value;
  };
  await login(alice);
  const sent = await call("member_message_send", ["bob_rp", "Hello Bob"]);
  assert.ok(sent.conversationId && sent.messageId);
  assert.equal(sent.status, "pending_review");
  const aliceInbox = await call("member_message_overview");
  assert.equal(aliceInbox.conversations[0].username, "bob_rp");
  assert.equal(aliceInbox.unread, 0);
  assert.doesNotMatch(JSON.stringify(aliceInbox), new RegExp(bob));
  await assert.rejects(db.query("select * from public.member_messages"), /permission denied/);
  await assert.rejects(db.query("select * from public.member_conversations"), /permission denied/);
  await assert.rejects(call("staff_member_message_reviews"), /permission required/);
  await assert.rejects(call("staff_member_message_pending_count"), /permission required/);
  await assert.rejects(call("staff_decide_member_message", [sent.messageId, 1, "approve", "Not staff review", "forbidden"]), /permission required/);
  await assert.rejects(call("service_member_message_check", [sent.messageId, alice, "Hello Bob", { decision: "approve", checker: "openai:omni-moderation-2024-09-26", details: { code: "provider_low_risk" } }]), /permission denied/);
  await login(bob);
  assert.equal((await call("member_message_overview")).conversations.length, 0);
  await assert.rejects(call("member_message_thread", [sent.conversationId, null]), /Conversation unavailable/);
  await admin("select 1");
  assert.equal((await db.query("select count(*)::int n from public.notifications")).rows[0].n, 0);
  await db.exec("set role service_role");
  const held = await call("service_member_message_check", [sent.messageId, alice, "Hello Bob", { decision: "review", checker: "local", details: { code: "provider_not_enabled" } }]);
  assert.equal(held.status, "pending_review");
  await login(bob);
  assert.equal((await call("member_message_overview")).unread, 0);
  await login(eve);
  assert.deepEqual(await call("staff_member_message_pending_count"), { pendingCount: 1 });
  assert.equal((await call("staff_member_message_reviews")).items[0].text, "Hello Bob");
  await assert.rejects(call("staff_decide_member_message", [sent.messageId, null, "approve", "Reviewed private text", "fixture-null-version"]), /changed/);
  await assert.rejects(call("staff_decide_member_message", [sent.messageId, held.version, null, "Reviewed private text", "fixture-null-action"]), /valid decision/);
  const approval = await call("staff_decide_member_message", [sent.messageId, held.version, "approve", "Approved after review", "fixture-request"]);
  assert.equal(approval.status, "delivered");
  assert.deepEqual(await call("staff_member_message_pending_count"), { pendingCount: 0 });
  await assert.rejects(call("staff_decide_member_message", [sent.messageId, held.version, "approve", "Repeat decision", "fixture-request"]), /changed/);
  await login(eve);
  await assert.rejects(call("member_message_thread", [sent.conversationId, null]), /Conversation unavailable/);
  await assert.rejects(call("member_message_mark_read", [sent.conversationId]), /Conversation unavailable/);
  await assert.rejects(call("member_message_report", [sent.messageId, "harassment", "I want staff to check this message."]), /Message unavailable/);
  await login(bob);
  const bobInbox = await call("member_message_overview");
  assert.equal(bobInbox.unread, 1);
  const thread = await call("member_message_thread", [sent.conversationId, null]);
  assert.equal(thread.messages[0].body, "Hello Bob");
  assert.equal(thread.messages[0].fromMe, false);
  assert.doesNotMatch(JSON.stringify(thread), new RegExp(alice));
  assert.equal(await call("member_message_mark_read", [sent.conversationId]), 1);
  assert.equal((await call("member_message_overview")).unread, 0);
  await admin(`select 1`);
  assert.equal((await db.query("select title,body,read_at,action_url from public.notifications")).rows[0].title, "New message");
  assert.equal((await db.query("select title,body,read_at,action_url from public.notifications")).rows[0].body, "From alice_rp");
  assert.ok((await db.query("select read_at from public.notifications")).rows[0].read_at);
  await login(bob);
  const report = await call("member_message_report", [sent.messageId, "harassment", "This message was unwelcome and should be reviewed."]);
  assert.equal(report.status, "open");
  await assert.rejects(call("member_message_report", ["00000000-0000-4000-8000-000000000099", "spam", "I want to report an unknown private message."]), /Message unavailable/);
  await admin("update public.profiles set profile_visibility='private' where username='alice_rp'");
  await login(bob);
  await call("member_message_set_block", ["alice_rp", true]);
  await login(alice);
  await assert.rejects(call("member_message_send", ["bob_rp", "A private sender should still be blockable"]), /Member unavailable/);
  await login(bob);
  await call("member_message_set_block", ["alice_rp", false]);
  await admin("update public.profiles set profile_visibility='public' where username='alice_rp'");
  await login(bob);
  await call("member_message_set_block", ["alice_rp", true]);
  assert.equal((await call("member_message_thread", [sent.conversationId, null])).canReply, false);
  await login(alice);
  await assert.rejects(call("member_message_send", ["bob_rp", "Still there?"]), /Member unavailable/);
  assert.equal((await call("member_message_thread", [sent.conversationId, null])).canReply, false);
  await login(bob);
  await call("member_message_set_block", ["alice_rp", false]);
  await call("member_message_set_policy", ["nobody"]);
  await assert.rejects(call("member_message_send", ["alice_rp", "Could you reply?"]), /Member unavailable/);
  await login(alice);
  await assert.rejects(call("member_message_send", ["bob_rp", "Could you reply?"]), /Member unavailable/);
  await login(bob);
  await call("member_message_set_policy", ["members"]);
  await admin("update public.profiles set profile_visibility='basic' where username='bob_rp'");
  await login(alice);
  const second = await call("member_message_send", ["bob_rp", "Thanks"]);
  await db.exec("reset role;set role service_role");
  const auto = await call("service_member_message_check", [second.messageId, alice, "Thanks", {
    decision: "approve", checker: "openai:omni-moderation-2024-09-26", details: { code: "provider_low_risk" }
  }]);
  assert.equal(auto.status, "delivered");
  await login(alice);
  const basicThread = await call("member_message_thread", [sent.conversationId, null]);
  assert.equal(basicThread.displayName, "bob_rp");
  assert.equal(basicThread.canReply, true);
  await db.exec("reset role");
  const ownExport = (await db.query("select private.member_export_records($1) value", [alice])).rows[0].value;
  assert.equal(ownExport.collections.memberMessages.length, 2);
  assert.equal(ownExport.collections.memberMessages[0].sender, "alice_rp");
  assert.equal(ownExport.counts.memberMessages, 2);
  await login(alice);
  const third = await call("member_message_send", ["bob_rp", "Held while contact rules change"]);
  await db.exec("reset role;set role service_role");
  const untrusted = await call("service_member_message_check", [third.messageId, alice, "Held while contact rules change", {
    decision: "approve", checker: "local", details: { code: "provider_low_risk" }
  }]);
  assert.equal(untrusted.status, "pending_review", "a local or forged-looking result cannot deliver");
  await login(bob);
  await db.exec("reset role");
  const bobExportBeforeDelivery = (await db.query("select private.member_export_records($1) value", [bob])).rows[0].value;
  assert.equal(bobExportBeforeDelivery.collections.memberMessages.some(item => item.id === third.messageId), false);
  await login(bob);
  await call("member_message_set_policy", ["nobody"]);
  await login(eve);
  await assert.rejects(call("staff_decide_member_message", [third.messageId, untrusted.version, "approve", "Approved after review", "fixture-race"]), /Member unavailable/);
  await login(bob);
  assert.equal((await call("member_message_thread", [sent.conversationId, null])).messages.some(item => item.id === third.messageId), false);
  await admin("select 1");
  assert.equal((await db.query("select count(*)::int n from public.notifications where kind='member_message'")).rows[0].n, 2,
    "only the two delivered messages notify the recipient, once each");
  await login(bob);
  await call("member_message_set_policy", ["members"]);
  await login(alice);
  const fourth = await call("member_message_send", ["bob_rp", "Held before a block"]);
  await login(bob);
  await call("member_message_set_block", ["alice_rp", true]);
  await login(eve);
  await assert.rejects(call("staff_decide_member_message", [fourth.messageId, 1, "approve", "Approved after review", "fixture-block-race"]), /Member unavailable/);
  await login(bob);
  assert.equal((await call("member_message_thread", [sent.conversationId, null])).messages.some(item => item.id === fourth.messageId), false);
  await call("member_message_set_block", ["alice_rp", false]);
  await login(eve);
  const later = await call("staff_decide_member_message", [third.messageId, untrusted.version, "block", "Unwanted message", "fixture-block"]);
  assert.equal(later.status, "blocked");
  await login(alice);
  const blocked = await call("member_message_thread", [sent.conversationId, null]);
  assert.equal(blocked.messages.find(item => item.id === third.messageId).status, "blocked");
  await login(bob);
  assert.equal((await call("member_message_thread", [sent.conversationId, null])).messages.some(item => item.id === third.messageId), false);
  await admin(`insert into public.profiles(id,username,display_name,profile_visibility)
    select gen_random_uuid(),'bulk_'||n,'Bulk member','public' from generate_series(1,55) n;
    insert into public.member_conversations(user_low,user_high,started_by)
    select least('${alice}'::uuid,p.id),greatest('${alice}'::uuid,p.id),'${alice}'::uuid
      from public.profiles p where p.username like 'bulk_%';
    insert into public.member_messages(conversation_id,sender_id,recipient_id,body,status)
      select c.id,'${alice}'::uuid,case when c.user_low='${alice}'::uuid then c.user_high else c.user_low end,
        'Fixture delivered message','delivered' from public.member_conversations c
        where c.started_by='${alice}'::uuid and c.id<>'${sent.conversationId}'::uuid`);
  await login(alice);
  const inboxPage = await call("member_message_overview");
  assert.equal(inboxPage.conversations.length, 50);
  assert.ok(inboxPage.nextBeforeId);
  const olderInboxPage = await call("member_message_overview", [inboxPage.nextBeforeId]);
  assert.equal(olderInboxPage.conversations.length, 6);
  assert.equal(olderInboxPage.nextBeforeId, null);
  await admin(`delete from auth.sessions where id='${sessions[alice]}'`);
  await login(alice);
  await assert.rejects(call("member_message_overview"), /active, unrestricted sign-in/);
  await assert.rejects(call("member_message_send", ["bob_rp", "Revoked"]), /active, unrestricted sign-in/);
  await admin(`insert into auth.sessions(id,user_id,not_after) values('${sessions[alice]}','${alice}',now()-interval '1 second')`);
  await login(alice);
  await assert.rejects(call("member_message_overview"), /active, unrestricted sign-in/);
  await assert.rejects(call("member_message_thread", [sent.conversationId, null]), /active, unrestricted sign-in/);
  await admin(`update auth.sessions set not_after=null where id='${sessions[alice]}';
    insert into public.security_bans(user_id,target_type,starts_at) values('${alice}','account',now()-interval '1 minute')`);
  await login(alice);
  await assert.rejects(call("member_message_send", ["bob_rp", "Banned"]), /active, unrestricted sign-in/);
  await admin("select 1");
  const reports = (await db.query("select target_type,category,details from public.reports")).rows;
  assert.equal(reports.length, 1);
  assert.equal(reports[0].target_type, "profile");
  assert.match(reports[0].details, /Quoted message: Hello Bob/);
  await admin(`insert into public.member_messages(conversation_id,sender_id,recipient_id,body,created_at,status)
    select '${sent.conversationId}','${bob}','${alice}','Older '||n,now()+n*interval '1 second','delivered'
      from generate_series(1,55) n`);
  await login(bob);
  const recent = await call("member_message_thread", [sent.conversationId, null]);
  assert.equal(recent.messages.length, 50);
  assert.ok(recent.nextBeforeId);
  const older = await call("member_message_thread", [sent.conversationId, recent.nextBeforeId]);
  assert.equal(older.messages.length, 7);
  assert.equal(older.nextBeforeId, null);
  assert.equal(new Set([...recent.messages, ...older.messages].map(message => message.id)).size, 57);
  for (const role of ["anon", "service_role"]) {
    await db.exec(`reset role;set role ${role}`);
    await assert.rejects(call("member_message_overview"), /permission denied/);
    await assert.rejects(db.query("select * from public.member_messages"), /permission denied/);
  }
});
