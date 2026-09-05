import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
const read = file => readFileSync(new URL(`../supabase/migrations/${file}`, import.meta.url), "utf8");
const fn = (source,name) => source.match(new RegExp(`create or replace function ${name.replaceAll(".","\\.")}\\([\\s\\S]*?\\n\\$\\$;`))[0];
const owner="00000000-0000-4000-8000-000000000001", other="00000000-0000-4000-8000-000000000002", reviewer="00000000-0000-4000-8000-000000000003";
const sid="aaaaaaaa-0000-4000-8000-000000000001", otherSid="aaaaaaaa-0000-4000-8000-000000000002", id="bbbbbbbb-0000-4000-8000-000000000001";
const input={name:"Revised community",platform:"redm",region:"Europe",language:"English",framework:"VORP",description:"A carefully corrected community description with clear rules and welcoming roleplay.",communityUrl:"https://discord.gg/fixture",cfxJoinUrl:"https://cfx.re/join/example",accessType:"application",tags:["serious-roleplay","beginner-friendly"]};

test("owners resubmit the same record under real PostgreSQL ownership, session, version and retry guards",async t=>{
 const db=new PGlite();t.after(()=>db.close());const core=read("202608180001_browserp_core.sql");const security=read("20260904092528_enforce_member_security_boundaries.sql");
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create schema private;create schema extensions;revoke all on schema private from public;
 create function extensions.gen_random_uuid() returns uuid language sql as $$select pg_catalog.gen_random_uuid()$$;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
 create table auth.users(id uuid primary key,deleted_at timestamptz,is_anonymous boolean default false);
 create table auth.sessions(id uuid primary key,user_id uuid,not_after timestamptz);
 create table public.security_bans(user_id uuid,target_type text,revoked_at timestamptz,starts_at timestamptz,ends_at timestamptz);
 create table public.server_tag_catalog(key text primary key,enabled boolean default true);
 insert into auth.users(id) values('${owner}'),('${other}'),('${reviewer}');
 insert into auth.sessions(id,user_id) values('${sid}','${owner}'),('${otherSid}','${other}');`);
 for(const name of ["platforms","profiles","server_submissions","moderation_queue","rate_limit_buckets","staff_audit_events","servers","reports","server_tags"]) await db.exec(core.match(new RegExp(`create table public\\.${name} \\([\\s\\S]*?\\n\\);`))[0]);
 await db.exec(`alter table public.servers add source_submission_id uuid,add access_type text,add cfx_join_url text;
 create unique index fixture_submission_source on public.servers(source_submission_id);
 alter table public.server_submissions add terms_version text,add standards_version text,add tags text[] default '{}',add access_type text default 'public',add cfx_join_url text,add metadata_fingerprint text;
 insert into public.profiles(id,username,display_name) values('${owner}','owner','Owner'),('${other}','other','Other'),('${reviewer}','reviewer','Reviewer');
 insert into public.platforms(id,name,short_name) values('fivem','FiveM','FiveM'),('redm','RedM','RedM'),('minecraft','Minecraft','MC');
 insert into public.server_tag_catalog(key) values('serious-roleplay'),('beginner-friendly');
 insert into public.server_submissions(id,submitted_by,platform_id,name,region,language,framework,description,community_url,moderation_confidence,moderation_score,status,reviewed_by,reviewed_at,review_note)
 values('${id}','${owner}','fivem','Original community','United Kingdom','English','vMenu','The original description for this established community has enough detail.','https://discord.gg/original','safe',5,'changes_requested','${reviewer}',now(),'Please correct the community link and explain the setting.');
 insert into public.moderation_queue(target_type,target_id,confidence,score,status,assigned_to,resolution) values('server_submission','${id}','safe',5,'claimed','${reviewer}','Please correct the community link and explain the setting.');`);
 await db.exec(fn(core,"public.consume_rate_limit"));await db.exec(read("20260905195616_enforce_auth_session_expiry.sql"));
 for(const name of ["private.member_access_allowed","private.require_active_member","private.enforce_member_rate_limit"])await db.exec(fn(security,name));
 await db.exec(`create function public.has_staff_permission(p_permission text) returns boolean language sql stable as $$select auth.uid()='${reviewer}'::uuid and auth.jwt()->>'aal'='aal2'$$;`);
 await db.exec(fn(read("202608180005_staff_workspace.sql"),"public.staff_resolve_queue_item"));
 await db.exec(fn(read("20260819192413_platform_operations_and_trust.sql"),"private.publish_submission_metadata"));
 await db.exec("create trigger servers_publish_submission_metadata after insert or update of source_submission_id on public.servers for each row execute function private.publish_submission_metadata()");
 await db.exec(read("20260905210355_owner_submission_corrections.sql"));
 const login=async(user=owner,session=sid)=>{await db.exec("reset role");await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)",[user,JSON.stringify({sub:user,session_id:session,aal:"aal2"})]);await db.exec("set role authenticated");};
 const admin=async(sql,params=[])=>{await db.exec("reset role");return db.query(sql,params);};
 const get=async()=> (await db.query("select public.member_server_submission($1) value",[id])).rows[0].value;
 const send=async({actor=owner,session=sid,submission=id,version=1,queueVersion=1,key="a".repeat(64),data=input,terms="2026-08-19",role="service_role"}={})=>{await db.exec(`reset role;set role ${role}`);return (await db.query("select public.resubmit_server_submission_server($1,$2,$3,$4,$5,$6,$7::jsonb,'likely_safe',20,'[\"manual-review\"]'::jsonb,$8,'2026-08-19') value",[actor,session,submission,version,queueVersion,key,JSON.stringify(data),terms])).rows[0].value;};
 await t.test("owner read is private, current and minimal; anonymous and foreign/revoked sessions cannot read",async()=>{
   await login();const payload=await get();assert.equal(payload.submission.name,"Original community");assert.equal(payload.submission.review_version,1);assert.equal(payload.submission.review_note,"Please correct the community link and explain the setting.");assert.equal(payload.submission.submitted_by,undefined);assert.equal(payload.submission.reviewed_by,undefined);
   await login(other,otherSid);await assert.rejects(get(),/not found/);await login(owner,otherSid);await assert.rejects(get(),/active, unrestricted/);
   await db.exec("reset role;set role anon");await assert.rejects(get(),/permission denied/);
   await login();await assert.rejects(db.query("select * from private.server_submission_revisions"),/permission denied/);
 });
 await t.test("server-only writes deny other owners, spoofed or ended sessions and direct member calls",async()=>{
   await assert.rejects(send({actor:other,session:otherSid}),/not found/);
   await assert.rejects(send({session:otherSid}),/Sign in again/);
   await assert.rejects(send({session:null}),/Sign in again/);
   await assert.rejects(send({role:"authenticated"}),/permission denied/);
   await assert.rejects(send({role:"anon"}),/permission denied/);
   await admin("update auth.sessions set not_after=now()-interval '1 second' where id=$1",[sid]);await assert.rejects(send(),/Sign in again/);
   await admin("delete from auth.sessions where id=$1",[sid]);await assert.rejects(send(),/Sign in again/);
   await admin("insert into auth.sessions(id,user_id) values($1,$2)",[sid,owner]);
   await admin("insert into public.security_bans values($1,'account',null,now(),null)",[owner]);await assert.rejects(send(),/restricted/);await admin("delete from public.security_bans");
 });
 await t.test("malformed content and stale versions fail before any record or queue change",async()=>{
   await assert.rejects(send({version:99}),/changed since/);
   await assert.rejects(send({data:{...input,communityUrl:"javascript:alert(1)"}}),/Invalid community URL/);
   await assert.rejects(send({data:{...input,tags:["not-in-catalog"]}}),/no longer available/);
   await assert.rejects(send({data:{...input,platform:"minecraft"}}),/Cfx connect link/);
   await assert.rejects(send({data:{...input,ownerId:other}}),/Invalid correction/);
   await assert.rejects(send({terms:"old"}),/Current terms/);
   assert.equal((await admin("select count(*)::integer n from private.server_submission_revisions")).rows[0].n,0);
 });
 await t.test("queue failure rolls back the entire correction and preserved history",async()=>{
   await admin("alter table public.moderation_queue add constraint fixture_reject_queue_score check(score<>20) not valid");
   await assert.rejects(send(),/fixture_reject_queue_score/);
   assert.equal((await admin("select review_version,status from public.server_submissions where id=$1",[id])).rows[0].status,"changes_requested");
   assert.equal((await admin("select count(*)::integer n from private.server_submission_revisions")).rows[0].n,0);
   await admin("alter table public.moderation_queue drop constraint fixture_reject_queue_score");
 });
 await t.test("one correction changes the existing row, preserves provenance and reopens one queue row",async()=>{
   const saved=await send();assert.equal(saved.id,id);assert.equal(saved.status,"pending_review");assert.equal(saved.review_version,2);assert.equal(saved.idempotent,false);
   const rows=await admin("select * from public.server_submissions");assert.equal(rows.rows.length,1);const row=rows.rows[0];assert.equal(row.language,"English");assert.equal(row.framework,"VORP");assert.equal(row.submitted_by,owner);assert.equal(row.reviewed_by,reviewer);assert.match(row.review_note,/Please correct/);assert.deepEqual(row.tags,[...input.tags].sort());
   const history=(await admin("select * from private.server_submission_revisions")).rows;assert.equal(history.length,1);assert.equal(history[0].snapshot.name,"Original community");assert.equal(history[0].snapshot.framework,"vMenu");assert.equal(history[0].queue_snapshot.status,"claimed");
   const queues=(await admin("select * from public.moderation_queue")).rows;assert.equal(queues.length,1);assert.equal(queues[0].status,"open");assert.equal(queues[0].assigned_to,null);assert.equal(queues[0].resolution,null);
 });
 await t.test("ambiguous retries replay only identical input; duplicate attempts and changed replay data never overwrite",async()=>{
   const replay=await send();assert.equal(replay.idempotent,true);assert.equal(replay.review_version,2);
   await assert.rejects(send({key:"b".repeat(64)}),/changed/);await assert.rejects(send({key:"b".repeat(64),version:2,queueVersion:2}),/no longer waiting/);
   await assert.rejects(send({data:{...input,name:"Different replay"}}),/different changes/);
   assert.equal((await admin("select count(*)::integer n from private.server_submission_revisions")).rows[0].n,1);
 });
 await t.test("later staff feedback advances the version and owner edits retain successive review history",async()=>{
   await admin("update public.server_submissions set status='changes_requested',review_note='Please describe the application process.',reviewed_at=now() where id=$1",[id]);
   await login();const payload=await get();assert.equal(payload.submission.review_version,3);assert.equal(payload.history[0].review_note,"Please correct the community link and explain the setting.");
   await assert.rejects(send({version:2,queueVersion:2,key:"c".repeat(64)}),/changed since/);
   const next=await send({version:3,queueVersion:2,key:"c".repeat(64),data:{...input,description:input.description+" Members apply through Discord and wait for approval."}});assert.equal(next.review_version,4);
   await login();assert.ok((await get()).history.some(row=>row.review_note==="Please describe the application process."));
 });
 await t.test("staff must review the current submission and queue; legacy listing RPC cannot bypass revisions",async()=>{
   const staffSid="aaaaaaaa-0000-4000-8000-000000000003";
   await admin("insert into auth.sessions(id,user_id) values($1,$2)",[staffSid,reviewer]);
   const inspect=async()=> (await db.query("select public.staff_server_submission_review($1) value",[id])).rows[0].value;
   const decide=async(version,queueVersion,action="changes_requested")=> (await db.query("select public.staff_review_server_submission($1,$2,$3,$4,'Clear review reason',$5) value",[id,version,queueVersion,action,crypto.randomUUID()])).rows[0].value;
   await login();await assert.rejects(inspect(),/permission required/);await assert.rejects(decide(4,3),/permission required/);
   await login(reviewer,staffSid);const item=await inspect();assert.equal(item.reviewVersion,4);assert.equal(item.queueVersion,3);assert.ok(item.history.some(x=>x.name==="Original community"));
   await assert.rejects(db.query("select public.staff_resolve_queue_item('listing',$1,'approved','Bypass attempt',$2)",[id,crypto.randomUUID()]),/latest submission review/);
   await assert.rejects(db.query("select private.staff_resolve_queue_item('listing',$1,'approved','Bypass attempt',$2)",[id,crypto.randomUUID()]),/permission denied/);
   await assert.rejects(decide(3,3),/changed/);await assert.rejects(decide(4,2),/changed/);
   await admin("update public.moderation_queue set status='claimed' where target_id=$1",[id]);await login(reviewer,staffSid);await assert.rejects(decide(4,3),/review queue changed/);
   const accepted=await decide(4,4);assert.equal(accepted.status,"changes_requested");
   const newItem=await inspect();assert.equal(newItem.reviewVersion,5);assert.equal(newItem.queueVersion,5);
   const audit=(await admin("select before_state,after_state from public.staff_audit_events where target_id=$1",[id])).rows[0];assert.equal(audit.before_state.review_version,4);assert.equal(audit.after_state.review_version,5);
   const report=(await admin("insert into public.reports(reporter_id,target_type,target_id,category,details) values($1,'server',$2,'spam','A real fixture report with enough review evidence.') returning id",[owner,id])).rows[0].id;
   await login(reviewer,staffSid);
   const resolved=(await db.query("select public.staff_resolve_queue_item('report',$1,'resolved','Reviewed report evidence',$2) value",[report,crypto.randomUUID()])).rows[0].value;
   assert.equal(resolved.status,"resolved");
   const approved=await decide(5,5,"approved");assert.equal(approved.status,"approved");
   const published=(await admin("select * from public.servers where source_submission_id=$1",[id])).rows;assert.equal(published.length,1);assert.equal(published[0].name,input.name);assert.equal(published[0].language,"English");assert.equal(published[0].framework,"VORP");assert.equal(published[0].access_type,"application");assert.equal(published[0].community_url,input.communityUrl);assert.equal(published[0].cfx_join_url,input.cfxJoinUrl);assert.match(published[0].description,/Members apply through Discord/);
   const tags=(await admin("select tag from public.server_tags where server_id=$1 order by tag",[published[0].id])).rows.map(row=>row.tag);assert.deepEqual(tags,[...input.tags].sort());
   await login(reviewer,staffSid);await assert.rejects(decide(6,6,"approved"),/already closed/);

   await admin("delete from auth.sessions where id=$1",[staffSid]);await login(reviewer,staffSid);await assert.rejects(inspect(),/permission required/);await assert.rejects(decide(6,6),/permission required/);
 });
 await t.test("approved/rejected/withdrawn decisions block corrections and replay reports current decision",async()=>{
   for(const status of ["approved","rejected","withdrawn"]){const row=(await admin("update public.server_submissions set status=$1 where id=$2 returning review_version",[status,id])).rows[0];await assert.rejects(send({version:Number(row.review_version),queueVersion:6,key:"d".repeat(64)}),/no longer waiting/);}
   assert.equal((await send()).status,"withdrawn");
   await admin("update auth.sessions set not_after=now()-interval '1 second' where id=$1",[sid]);await assert.rejects(send(),/Sign in again/);
 });
});
