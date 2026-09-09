// Disposable PostgreSQL only: existing auth/session/rate guards + new migration.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
const db = new PGlite();
const base = resolve(import.meta.dirname, "../supabase/migrations");
const read = name => readFileSync(resolve(base, name), "utf8");
const core = read("202608180001_browserp_core.sql"), ops = read("20260819192413_platform_operations_and_trust.sql");
const guards = read("20260904092528_enforce_member_security_boundaries.sql");
const fn = (sql, name) => sql.match(new RegExp(`create or replace function ${name.replaceAll(".", "\\.")}\\([\\s\\S]*?\\n\\$\\$;`))[0];
const uid = suffix => `00000000-0000-4000-8000-${suffix.padStart(12,"0")}`;
const member=uid("1"), other=uid("2"), staff=uid("3"), server=uid("101"), session=uid("501");
const result = async (sql,args=[]) => (await db.query(`select ${sql} as value`,args)).rows[0].value;
async function login(who=member, aal="aal2", active=true) {
 await db.exec("reset role");
 await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)",[who,JSON.stringify({sub:who,session_id:active?session:uid("999"),app_metadata:{provider:"discord"},aal,amr:[{method:"oauth"},...(aal==="aal2"?[{method:"totp"}]:[])]})]);
 await db.exec("set role authenticated");
}
async function service() { await db.exec("reset role;set role service_role"); }
const item = async target => result("public.member_content_moderation_item(null,$1,'comment')",[target]);
const check = async (s,decision="approve",checker="openai:omni-moderation-2024-09-26") => {
 await service();const input=await result("public.service_content_check_input($1,$2)",[s.id,member]);
 return result("public.service_record_content_check($1,$2,$3,$4,$5::jsonb)",[s.id,member,s.version,input.fingerprint,JSON.stringify({decision,reason:"Synthetic fixture content decision.",policyVersion:"content-v1",checker})]);
};
let first,second;
test("guarded content uses real PostgreSQL permissions and transitions",async t=>{
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create schema private;create schema extensions;
 revoke all on schema private from public;grant usage on schema auth to authenticated;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
 create function extensions.gen_random_uuid() returns uuid language sql as $$select pg_catalog.gen_random_uuid()$$;
 create table auth.users(id uuid primary key,raw_user_meta_data jsonb default '{}',deleted_at timestamptz,is_anonymous boolean default false);
 create table auth.sessions(id uuid,user_id uuid,not_after timestamptz);
 create table auth.identities(user_id uuid,provider text,provider_id text,identity_data jsonb default '{}');`);
 for(const name of ["platforms","profiles","staff_roles","permissions","staff_role_permissions","staff_memberships","servers","reports","moderation_queue","uploaded_assets","staff_audit_events","rate_limit_buckets"]){
  await db.exec(core.match(new RegExp(`create table public\\.${name} \\([\\s\\S]*?\\n\\);`))[0]);
 }
 for(const name of ["server_comments","server_votes"])await db.exec(ops.match(new RegExp(`create table if not exists public\\.${name} \\([\\s\\S]*?\\n\\);`))[0]);
 await db.exec(`alter table public.profiles add avatar_review_status text default 'not_set',add approved_avatar_url text,add bio_review_status text default 'not_set',add approved_bio text default '';
 create table public.security_bans(user_id uuid,target_type text,revoked_at timestamptz,starts_at timestamptz,ends_at timestamptz);
 create table private.discord_owner_allowlist(discord_user_id text,enabled boolean,role_key text);
 create table private.platform_security_settings(singleton boolean,staff_mfa_required boolean);
 create table public.staff_permission_overrides(user_id uuid,permission_key text,allowed boolean);
 insert into private.platform_security_settings values(true,true);
 insert into public.staff_roles values('administrator','Administrator','Test staff role',800,true);
 insert into public.permissions values('profiles.review','Review profiles'),('moderation.read','Read moderation'),('moderation.resolve','Review comments');
 insert into public.staff_role_permissions values('administrator','profiles.review'),('administrator','moderation.read'),('administrator','moderation.resolve');
 insert into auth.users(id) values('${member}'),('${other}'),('${staff}');
 insert into auth.sessions(id,user_id) values('${session}','${member}'),('${session}','${other}'),('${session}','${staff}');
 insert into public.profiles(id,username,display_name) values('${member}','member','Approved member'),('${other}','other','Approved other'),('${staff}','staff','Approved staff');
 insert into public.staff_memberships(user_id,role_key,reason) values('${staff}','administrator','Test staff assignment');
 insert into auth.identities(user_id,provider,provider_id) values('${staff}','discord','333333333333333333');
 insert into private.discord_owner_allowlist values('333333333333333333',true,'administrator');
 insert into public.platforms(id,name,short_name) values('fivem','FiveM','FiveM');
 insert into public.servers(id,owner_id,platform_id,name,slug,description,region,language,framework,status) values('${server}','${member}','fivem','Test RP community','test-rp-community','A welcoming roleplay community with engaging jobs and shared stories.','Europe','English','QBCore','published');
 revoke all on public.profiles,public.server_comments,public.uploaded_assets from public,anon,authenticated;
 alter table public.server_comments enable row level security;
 `);
 await db.exec(read("20260905195616_enforce_auth_session_expiry.sql"));
 await db.exec(fn(read("20260904091734_enforce_staff_session_revocation.sql"),"public.has_staff_permission"));
 await db.exec(fn(core,"public.consume_rate_limit"));
 for(const name of ["private.member_access_allowed","private.require_active_member","private.enforce_member_rate_limit","public.member_server_interaction","public.member_set_profile_avatar"]){await db.exec(fn(guards,name));}
 const deadlineSql=read("20260908112653_member_preference_reply_session_deadlines.sql");
 await db.exec(deadlineSql.match(/create function private.require_member_write_session\([\s\S]*?\n\$\$;/)[0]);
 await db.exec(fn(read("20260820023114_profile_avatar_immediate_name_filter.sql"),"private.queue_profile_review"));
 await db.exec(`create trigger profiles_content_review_state_insert before insert on public.profiles for each row execute function private.queue_profile_review();
 create trigger profiles_content_review_state_update before update of avatar_url,bio on public.profiles for each row execute function private.queue_profile_review();
 alter table public.server_comments add parent_comment_id uuid references public.server_comments(id),add edited_at timestamptz;
 grant execute on function public.member_server_interaction(uuid,text,text,text) to authenticated;`);
 await db.exec(fn(deadlineSql,"public.member_server_comment_reply"));
 await db.exec(fn(ops,"public.staff_comment_review_item"));
 await db.exec(fn(ops,"public.staff_resolve_comment_review"));
 await db.exec(read("20260909092918_guarded_content_moderation.sql"));
 await t.test("anonymous/member clients cannot write decisions or public identity",async()=>{
  await db.exec("set role anon");await assert.rejects(result("public.member_content_moderation()"),/permission denied/);
  await login();await assert.rejects(db.query("select * from private.content_submissions"),/permission denied/);
  await assert.rejects(result("public.service_record_content_check(null,null,1,'x','{}')"),/permission denied/);
  await assert.rejects(result("public.member_set_profile_avatar('https://example.com/a.png',null)"),/permission denied/);
  await assert.rejects(db.query("update public.profiles set display_name='Bypass'"),/permission denied/);
  await assert.rejects(result("public.staff_content_moderation()"),/permission required/);
 });
 await t.test("comment pending then server attestation + active owner apply publishes exact version",async()=>{
  await login();let submitted=await result("public.member_server_interaction($1,'comment','A welcoming roleplay community.')",[server]);first=await item(submitted.id);
  assert.equal(first.status,"pending_review");assert.equal(await check(first),true);
  await login(other);await assert.rejects(result("public.member_apply_content_check($1,$2)",[first.id,first.version]),/not found/);
  await login(member,"aal2",false);await assert.rejects(result("public.member_apply_content_check($1,$2)",[first.id,first.version]),/active/);
  await login();first=await result("public.member_apply_content_check($1,$2)",[first.id,first.version]);assert.equal(first.status,"published");
  assert.equal((await item(submitted.id)).status,"published");
 });
 await t.test("replies reuse pending boundary; duplicates cannot certify safety",async()=>{
  await login();const reply=await result("public.member_server_comment_reply($1,$2,'A welcoming roleplay community.')",[server,first.targetId]);second=await item(reply.id);
  assert.equal(second.status,"pending_review");assert.equal(reply.parentCommentId,first.targetId);
  await service();const input=await result("public.service_content_check_input($1,$2)",[second.id,member]);assert.equal(input.duplicate,true);
  await assert.rejects(check(second,"approve","local"),/complete supported checker/);
  await assert.rejects(result("public.service_record_content_check($1,$2,$3,$4,'{\"decision\":\"approve\"}')",[second.id,member,second.version,input.fingerprint]),/Invalid checker/);
 });
 await t.test("blocked content has one free private appeal; staff version/MFA guards hold",async()=>{
  await check(second,"block","local");await login();second=await result("public.member_apply_content_check($1,$2)",[second.id,second.version]);assert.equal(second.status,"blocked");
  await login(other);await assert.rejects(result("public.member_appeal_content($1,$2,'Please review the context.')",[second.id,second.version]),/not found/);
  await login();const appealed=await result("public.member_appeal_content($1,$2,'Please review the context.')",[second.id,second.version]);assert.equal(appealed.appealStatus,"pending");
  await assert.rejects(result("public.member_appeal_content($1,$2,'Please review again.')",[second.id,appealed.version]),/already appealed/);
  await login(staff,"aal1");await assert.rejects(result("public.staff_content_moderation()"),/permission required/);
  await login(staff);assert.ok((await result("public.staff_content_moderation() ")).items.some(i=>i.id===second.id));
  await assert.rejects(result("public.staff_decide_content($1,$2,'approve','Reviewed the context.','fixture')",[second.id,second.version]),/changed/);
  const approved=await result("public.staff_decide_content($1,$2,'approve','Reviewed the context.','fixture')",[second.id,appealed.version]);assert.equal(approved.status,"published");assert.equal(approved.appealStatus,"resolved");
 });
 await t.test("replacement names stay private and older checks cannot override replacements",async()=>{
  await login();let p=await result("public.member_update_profile('New member name','','public')");const pending=p.moderation;assert.equal(p.displayName,"Approved member");assert.equal(pending.status,"pending_review");
  await check(pending);await login();p=await result("public.member_update_profile('Newer member name','','public')");assert.equal(p.displayName,"Approved member");
  assert.equal((await result("public.member_apply_content_check($1,$2)",[pending.id,pending.version])).status,"superseded");
  await check(p.moderation);await login();assert.equal((await result("public.member_apply_content_check($1,$2)",[p.moderation.id,p.moderation.version])).status,"published");
  await db.exec("reset role");assert.equal((await db.query("select display_name from public.profiles where id=$1",[member])).rows[0].display_name,"Newer member name");
 });
 await t.test("an old queue approval cannot publish an edited comment; the current version can",async()=>{
  await login();const c=await result("public.member_server_interaction($1,'comment','Original editable fixture comment.')",[server]);let before=await item(c.id);await check(before);
  await db.exec("reset role");
  const q=(await db.query("select id from public.moderation_queue where target_type='server_comment' and target_id=$1",[c.id])).rows[0].id;
  await login(staff);const seen=await result("public.staff_comment_review_item($1)",[q]);assert.equal(seen.body,"Original editable fixture comment.");
  await db.exec("reset role");await db.query("update public.server_comments set body='Revised editable fixture comment.' where id=$1",[c.id]);
  await login();assert.equal((await result("public.member_apply_content_check($1,$2)",[before.id,before.version])).status,"superseded");
  const changed=await item(c.id);assert.notEqual(changed.id,before.id);assert.equal(changed.text,"Revised editable fixture comment.");
  await login(staff);await assert.rejects(result("public.staff_resolve_comment_review($1,'approve','Approved the original visible content.','stale-legacy-fixture')",[q]),/current versioned content review/);
  const current=(await result("public.staff_content_moderation('comment')")).items.find(entry=>entry.id===changed.id);assert.equal(current.text,"Revised editable fixture comment.");assert.equal(current.version,changed.version);
  const approved=await result("public.staff_decide_content($1,$2,'approve','Reviewed the revised comment.','current-version-fixture')",[current.id,current.version]);assert.equal(approved.status,"published");
  await login();const after=await item(c.id);assert.equal(after.status,"published");assert.equal(after.text,"Revised editable fixture comment.");assert.ok(after.version>changed.version);
 });
 await t.test("OAuth identity is private at profile creation before callback checking",async()=>{
  const oauth=uid("4");await db.exec("reset role");await db.query("insert into auth.users(id,raw_user_meta_data) values($1,$2::jsonb)",[oauth,JSON.stringify({full_name:"Imported identity name"})]);
  await db.query("insert into public.profiles(id,username,display_name,avatar_url) values($1,'oauthmember','Imported identity name','https://cdn.discordapp.com/avatars/test.png')",[oauth]);
  const profile=(await db.query("select * from public.profiles where id=$1",[oauth])).rows[0];assert.equal(profile.display_name,"BrowseRP member");assert.equal(profile.avatar_url,null);assert.equal(profile.approved_avatar_url,null);
  assert.equal((await db.query("select count(*)::int as n from private.content_submissions where owner_id=$1 and status='pending_review'",[oauth])).rows[0].n,2);
 });
 await t.test("NULL and oversized versions cannot bypass appeal or staff decisions",async()=>{
  await login();const created=await result("public.member_server_interaction($1,'comment','A synthetic version-boundary comment.')",[server]);let s=await item(created.id);
  await check(s,"block","local");await login();s=await result("public.member_apply_content_check($1,$2)",[s.id,s.version]);
  for(const bad of [null,0,-1,"9007199254740991"]){
   await assert.rejects(result("public.member_appeal_content($1,$2,'Please review this context.')",[s.id,bad]),/changed|version/);
   await login(staff);await assert.rejects(result("public.staff_decide_content($1,$2,'approve','A reviewed decision.','fixture')",[s.id,bad]),/changed|version/);await login();
  }
  assert.equal((await item(created.id)).status,"blocked");
 });
 await t.test("deadline crossed during comment/profile/avatar/appeal/check/audit writes rolls back",async()=>{
  await db.exec("reset role");
  await db.exec(`create function private.fixture_delay() returns trigger language plpgsql as $$begin perform pg_sleep(0.15);return new;end;$$;`);
  const expire=async()=>{await db.exec("reset role");await db.query("update auth.sessions set not_after=clock_timestamp()+interval '80 milliseconds' where user_id=$1",[member]);await login();};
  const restore=async()=>{await db.exec("reset role;update auth.sessions set not_after=null");};
  await db.exec("create trigger fixture_delay after insert or update on public.rate_limit_buckets for each row execute function private.fixture_delay()");
  await expire();await assert.rejects(result("public.member_update_profile('Delayed quota name','','public')"),/active/);await restore();
  assert.equal((await db.query("select count(*)::int n from private.content_submissions where content_text='Delayed quota name'")).rows[0].n,0);
  await db.exec("drop trigger fixture_delay on public.rate_limit_buckets");
  await db.exec("create trigger fixture_delay after insert on public.server_comments for each row execute function private.fixture_delay()");
  await expire();await assert.rejects(result("public.member_server_interaction($1,'comment','Delayed comment write fixture.')",[server]),/active/);await restore();
  assert.equal((await db.query("select count(*)::int n from public.server_comments where body='Delayed comment write fixture.'")).rows[0].n,0);
  await db.exec("drop trigger fixture_delay on public.server_comments;create trigger fixture_delay after update on public.profiles for each row execute function private.fixture_delay()");
  await expire();await assert.rejects(result("public.member_update_profile('Delayed name fixture','','public')"),/active/);await restore();
  assert.equal((await db.query("select count(*)::int n from private.content_submissions where content_text='Delayed name fixture'")).rows[0].n,0);
  await db.exec("drop trigger fixture_delay on public.profiles");
  const a=uid("702");await db.query("insert into public.uploaded_assets(id,owner_id,bucket,object_path,media_type,mime_type,byte_size,sha256) values($1,$2,'uploads-quarantine',$3,'avatar','image/png',100,$4)",[a,member,`${member}/${a}.png`,"b".repeat(64)]);
  await db.exec("create trigger fixture_delay after insert on private.content_submissions for each row execute function private.fixture_delay()");
  await expire();await assert.rejects(result("public.member_submit_profile_avatar($1)",[a]),/active/);await restore();
  assert.equal((await db.query("select count(*)::int n from private.content_submissions where asset_id=$1",[a])).rows[0].n,0);
  await db.exec("drop trigger fixture_delay on private.content_submissions");
  await login();const c=await result("public.member_server_interaction($1,'comment','Delayed checker fixture comment.')",[server]);let s=await item(c.id);await check(s,"block","local");
  await db.exec("reset role;create trigger fixture_delay after update on private.content_submissions for each row execute function private.fixture_delay()");
  await expire();await assert.rejects(result("public.member_apply_content_check($1,$2)",[s.id,s.version]),/active/);await restore();
  assert.equal((await db.query("select status from private.content_submissions where id=$1",[s.id])).rows[0].status,"pending_review");
  await db.exec("drop trigger fixture_delay on private.content_submissions");await login();s=await result("public.member_apply_content_check($1,$2)",[s.id,s.version]);
  await db.exec("reset role;create trigger fixture_delay after update on private.content_submissions for each row execute function private.fixture_delay()");
  await expire();await assert.rejects(result("public.member_appeal_content($1,$2,'Review the delayed fixture.')",[s.id,s.version]),/active/);await restore();
  assert.equal((await db.query("select appeal_status from private.content_submissions where id=$1",[s.id])).rows[0].appeal_status,"none");
  await db.exec("drop trigger fixture_delay on private.content_submissions;create trigger fixture_delay after insert on public.staff_audit_events for each row execute function private.fixture_delay()");
  await db.query("update auth.sessions set not_after=clock_timestamp()+interval '80 milliseconds' where user_id=$1",[staff]);await login(staff);
  await assert.rejects(result("public.staff_decide_content($1,$2,'approve','Reviewed delayed audit fixture.','fixture')",[s.id,s.version]),/active|permission/);await restore();
  assert.equal((await db.query("select status from private.content_submissions where id=$1",[s.id])).rows[0].status,"blocked");
  await db.exec("drop trigger fixture_delay on public.staff_audit_events");
  await db.exec(`create function private.fixture_revoke_staff() returns trigger language plpgsql as $$begin update public.staff_memberships set status='suspended' where user_id='${staff}';return new;end;$$;
   create trigger fixture_revoke_staff after insert on public.staff_audit_events for each row execute function private.fixture_revoke_staff();`);
  await login(staff);await assert.rejects(result("public.staff_decide_content($1,$2,'approve','Revoked staff audit fixture.','fixture')",[s.id,s.version]),/permission/);
  await db.exec("reset role");assert.equal((await db.query("select status from private.content_submissions where id=$1",[s.id])).rows[0].status,"blocked");
  assert.equal((await db.query("select status from public.staff_memberships where user_id=$1",[staff])).rows[0].status,"active");
  await db.exec("drop trigger fixture_revoke_staff on public.staff_audit_events");

 });
 await t.test("pending replacement keeps prior approved avatar and approval revokes its old route",async()=>{
  const images=[uid("703"),uid("704")];await db.exec("reset role");
  for(const a of images)await db.query("insert into public.uploaded_assets(id,owner_id,bucket,object_path,media_type,mime_type,byte_size,sha256) values($1,$2,'uploads-quarantine',$3,'avatar','image/png',100,$4)",[a,other,`${other}/${a}.png`,"c".repeat(64)]);
  await login(other);let first=await result("public.member_submit_profile_avatar($1)",[images[0]]);
  await login(staff);first=await result("public.staff_decide_content($1,$2,'approve','Reviewed first picture.','fixture')",[first.id,first.version]);
  await login(other);let replacement=await result("public.member_submit_profile_avatar($1)",[images[1]]);
  await db.exec("reset role;set role anon");assert.equal((await result("public.content_avatar_access($1,true)",[first.id])).assetId,images[0]);
  await assert.rejects(result("public.content_avatar_access($1,true)",[replacement.id]),/not found/);
  await login(staff);replacement=await result("public.staff_decide_content($1,$2,'approve','Reviewed replacement picture.','fixture')",[replacement.id,replacement.version]);
  await db.exec("reset role;set role anon");await assert.rejects(result("public.content_avatar_access($1,true)",[first.id]),/not found/);
  assert.equal((await result("public.content_avatar_access($1,true)",[replacement.id])).assetId,images[1]);
 });
 await t.test("private avatars cannot auto-publish and staff approval serves only current approved asset",async()=>{
  const asset=uid("701");await db.exec("reset role");await db.query("insert into public.uploaded_assets(id,owner_id,bucket,object_path,media_type,mime_type,byte_size,sha256) values($1,$2,'uploads-quarantine',$3,'avatar','image/png',100,$4)",[asset,member,`${member}/${asset}.png`,"a".repeat(64)]);
  await login();let s=await result("public.member_submit_profile_avatar($1)",[asset]);assert.ok(s.previewUrl);await assert.rejects(check(s),/complete supported checker/);
  await login(other);await assert.rejects(result("public.content_avatar_access($1,false)",[s.id]),/access required/);
  await db.exec("reset role;set role anon");await assert.rejects(result("public.content_avatar_access($1,true)",[s.id]),/not found/);
  await login(staff);s=await result("public.staff_decide_content($1,$2,'approve','Reviewed the immutable picture.','fixture')",[s.id,s.version]);assert.equal(s.status,"published");
  await db.exec("reset role;set role anon");assert.equal((await result("public.content_avatar_access($1,true)",[s.id])).assetId,asset);
  await login(staff);assert.equal((await result("public.staff_content_moderation_item($1)",[s.id])).status,"published");
  s=await result("public.staff_decide_content($1,$2,'block','Picture removed after a staff report.','fixture')",[s.id,s.version]);assert.equal(s.status,"blocked");
  await db.exec("reset role;set role anon");await assert.rejects(result("public.content_avatar_access($1,true)",[s.id]),/not found/);
  await db.exec("reset role");assert.equal((await db.query("select avatar_url from public.profiles where id=$1",[member])).rows[0].avatar_url,null);
  assert.equal((await db.query("select moderation_status from public.uploaded_assets where id=$1",[asset])).rows[0].moderation_status,"rejected");
  await login();s=await result("public.member_appeal_content($1,$2,'Please review this picture again.')",[s.id,s.version]);
  await login(staff);s=await result("public.staff_decide_content($1,$2,'approve','Picture reconsidered in its full context.','fixture')",[s.id,s.version]);assert.equal(s.status,"published");
  await db.exec("reset role");await db.query("delete from public.profiles where id=$1",[member]);assert.equal((await db.query("select count(*)::int n from private.content_submissions where owner_id=$1",[member])).rows[0].n,0);
 });
 await db.close();
});
