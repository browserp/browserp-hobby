import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
const read = file => readFileSync(new URL(`../supabase/migrations/${file}`, import.meta.url), "utf8");
const fn = (source,name) => source.match(new RegExp(`create or replace function ${name.replaceAll(".","\\.")}\\([\\s\\S]*?\\n\\$\\$;`))[0];
const owner="00000000-0000-4000-8000-000000000001", other="00000000-0000-4000-8000-000000000002", reviewer="00000000-0000-4000-8000-000000000003";
const sid="aaaaaaaa-0000-4000-8000-000000000001", otherSid="aaaaaaaa-0000-4000-8000-000000000002", id="bbbbbbbb-0000-4000-8000-000000000001";
const input={name:"Revised community",platform:"redm",region:"Europe",language:"English",framework:"VORP",description:"A carefully corrected community description with clear rules and welcoming roleplay.",communityUrl:"https://discord.gg/fixture",cfxJoinUrl:"https://cfx.re/join/example",accessType:"application",tags:["serious-roleplay","beginner-friendly"]};

test("Owner updates use one existing queue and preserve reviewed live listing identity",async t=>{
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
 await db.exec(`alter table public.server_submissions add request_id text,add idempotency_key text,add request_fingerprint text;
 insert into public.platforms(id,name,short_name) values('roblox','Roblox','Roblox');
 create function public.create_server_submission_server_v2(uuid,text,text,text,text,text,text,text,text,integer,jsonb,text,text,text,text) returns jsonb language sql as $$select '{}'::jsonb$$;
 create function public.attach_server_submission_metadata_server(uuid,uuid,text[],text,text,text) returns jsonb language sql as $$select '{}'::jsonb$$;`);
 await db.exec(fn(read("20260819114235_server_submission_boundary.sql"),"public.create_server_submission_server"));
 for(const signature of ["public.create_server_submission_server(uuid,text,text,text,text,text,text,text,text,integer,jsonb)","public.create_server_submission_server_v2(uuid,text,text,text,text,text,text,text,text,integer,jsonb,text,text,text,text)","public.attach_server_submission_metadata_server(uuid,uuid,text[],text,text,text)"]){await db.exec(`revoke all on function ${signature} from public,anon,authenticated;grant execute on function ${signature} to service_role;`);}
 await db.exec(read("20260905224408_reviewed_roblox_applications.sql"));
 await db.exec(`alter table public.servers add moderation_version bigint not null default 1;`);
 await db.exec(fn(read("20260903233151_unified_moderation_workspace.sql"),"private.bump_moderation_version"));
 await db.exec("create trigger servers_moderation_version before update on public.servers for each row execute function private.bump_moderation_version()");
 await db.exec(read("20260904002113_fivem_imports_and_server_claims.sql").match(/create table public\.server_import_sources \([\s\S]*?\n\);/)[0]);
 await db.exec(read("20260905233144_reviewed_owner_listing_updates.sql"));
 const admin=async(sql,params=[])=>{await db.exec("reset role");return db.query(sql,params);};
 const login=async(user=owner,session=sid)=>{await db.exec("reset role");await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)",[user,JSON.stringify({sub:user,session_id:session,aal:"aal2"})]);await db.exec("set role authenticated");};
 const target="cccccccc-0000-4000-8000-000000000001",staffSid="aaaaaaaa-0000-4000-8000-000000000003";
 await admin("insert into auth.sessions(id,user_id) values($1,$2)",[staffSid,reviewer]);
 await admin(`insert into public.servers(id,owner_id,platform_id,name,slug,description,region,language,framework,community_url,access_type,cfx_join_url,status,verified,website_url) values($1,$2,'fivem','Established community','permanent-address','An established public community with clear joining instructions and longstanding roleplay.','United Kingdom','English','vMenu','https://discord.gg/original','public','https://cfx.re/join/example','published',true,'https://example.org')`,[target,owner]);
 await admin("insert into public.server_import_sources(server_id,join_code,source_url,logo_url,banner_url) values($1,'abcdef','https://servers.fivem.net/servers/detail/abcdef','https://cdn.example.org/logo.png','https://cdn.example.org/banner.png')",[target]);
 await admin("insert into public.server_tags(server_id,tag,source) values($1,'serious-roleplay','system')",[target]);
 const data={...input,description:input.description+" Established community information.".repeat(50),platform:"fivem",framework:"vMenu",roblox:null};
 const propose=async({actor=owner,session=sid,expected=owner,server=target,version=1,body=data,key="3".repeat(64),role="service_role"}={})=>{await db.exec(`reset role;set role ${role}`);return(await db.query("select public.propose_owned_listing_update_server($1,$2,$3,$4,$5,$6::jsonb,'safe',5,'[]',$7,$8,'2026-08-19','2026-08-19') value",[actor,session,expected,server,version,JSON.stringify(body),crypto.randomUUID(),key])).rows[0].value;};
 const inspect=async(submission)=>{await login(reviewer,staffSid);return(await db.query("select public.staff_server_submission_review($1) value",[submission])).rows[0].value;};
 const decide=async(submission,v,q,action="approved")=>(await db.query("select public.staff_review_server_application($1,$2,$3,$4,'Checked public listing changes carefully',$5,false,null) value",[submission,v,q,action,crypto.randomUUID()])).rows[0].value;
 let saved;
 await t.test("raw submission reads reject stale tokens while guarded owner/staff reads and service access survive",async()=>{
  // Reproduce the hosted table grants and original owner policy before hardening.
  await db.exec("reset role; grant usage on schema auth to anon,authenticated; grant select on public.server_submissions to anon,authenticated,service_role; alter table public.server_submissions enable row level security");
  await admin(core.match(/create policy submissions_owner_read[\s\S]*?;/)[0]);
  await login(owner,sid);
  assert.equal((await db.query("select id from public.server_submissions where id=$1",[id])).rows.length,1);
  await admin("delete from auth.sessions where id=$1",[sid]);
  await login(owner,sid);
  assert.equal((await db.query("select id from public.server_submissions where id=$1",[id])).rows.length,1,"old raw policy trusted the unexpired identity claim after revocation");
  await assert.rejects(db.query("select public.member_server_submission($1)",[id]),/active, unrestricted/);
  await db.exec("reset role"); await db.exec(read("20260906005841_restrict_raw_submission_reads.sql"));
  for(const role of ["anon","authenticated"]){
   await db.exec(`reset role;set role ${role}`);
   await assert.rejects(db.query("select id from public.server_submissions where id=$1",[id]),/permission denied for table server_submissions/);
  }
  await login(owner,sid);
  await assert.rejects(db.query("select public.member_server_submission($1)",[id]),/active, unrestricted/);
  await admin("insert into auth.sessions(id,user_id) values($1,$2)",[sid,owner]);
  await login(owner,sid);
  const mine=(await db.query("select public.member_server_submission($1) value",[id])).rows[0].value;
  assert.equal(mine.submission.id,id);
  await assert.rejects(db.query("select * from public.server_submissions"),/permission denied/);
  await login(reviewer,staffSid);
  const review=(await db.query("select public.staff_server_submission_review($1) value",[id])).rows[0].value;
  assert.equal(review.name,"Original community");
  await assert.rejects(db.query("select * from public.server_submissions"),/permission denied/);
  await admin("alter role service_role bypassrls");
  await db.exec("set role service_role");
  assert.equal((await db.query("select id from public.server_submissions where id=$1",[id])).rows.length,1);
  const grants=(await admin("select has_table_privilege('anon','public.server_submissions','SELECT') anon_read,has_table_privilege('authenticated','public.server_submissions','SELECT') member_read,has_table_privilege('service_role','public.server_submissions','SELECT') service_read")).rows[0];
  assert.deepEqual(grants,{anon_read:false,member_read:false,service_read:true});
 });
 await t.test("only the current owner may read; unpublished or another account's listing is unavailable",async()=>{
  await login();const payload=(await db.query("select public.member_owned_listing_update($1) value",[target])).rows[0].value;
  assert.equal(payload.submission.name,"Established community");assert.equal(payload.ownerUpdate.serverVersion,1);assert.equal(payload.submission.logo_url,undefined);assert.equal(payload.submission.owner_id,undefined);
  await login(other,otherSid);await assert.rejects(db.query("select public.member_owned_listing_update($1)",[target]),/not available/);
  await login(owner,otherSid);await assert.rejects(db.query("select public.member_owned_listing_update($1)",[target]),/active, unrestricted/);
  await admin("update public.servers set status='archived' where id=$1",[target]);await login();await assert.rejects(db.query("select public.member_owned_listing_update($1)",[target]),/not available/);
  await admin("update public.servers set status='published',moderation_version=1 where id=$1",[target]);await admin("alter table public.servers disable trigger servers_moderation_version");await admin("update public.servers set moderation_version=1 where id=$1",[target]);await admin("alter table public.servers enable trigger servers_moderation_version");
 });
 await t.test("current-session, account, ownership, source and version guards reject before any proposal survives",async()=>{
  for(const args of [{session:otherSid},{expected:other},{actor:other,session:otherSid,expected:other},{role:"authenticated"},{role:"anon"},{version:999},{body:{...data,platform:"redm"}},{body:{...data,cfxJoinUrl:"https://cfx.re/join/different"}},{body:{...data,ownerId:other}}])await assert.rejects(propose(args));
  await admin("update auth.sessions set not_after=now()-interval '1 second' where id=$1",[sid]);await assert.rejects(propose(),/Sign in again/);await admin("update auth.sessions set not_after=null where id=$1",[sid]);
  assert.equal((await admin("select count(*)::int n from public.server_submissions where owner_update_server_id=$1",[target])).rows[0].n,0);
 });
 await t.test("a failed target attachment rolls back creation, metadata, queue and retry receipt",async()=>{
  await admin("alter table public.server_submissions add constraint fixture_fail_attachment check(owner_update_server_id is null) not valid");
  await assert.rejects(propose(),/fixture_fail_attachment/);await admin("alter table public.server_submissions drop constraint fixture_fail_attachment");
  assert.equal((await admin("select count(*)::int n from public.server_submissions where owner_update_server_id=$1",[target])).rows[0].n,0);
  assert.equal((await admin("select count(*)::int n from private.submission_creation_requests")).rows[0].n,0);
  assert.equal((await admin("select count(*)::int n from public.moderation_queue")).rows[0].n,1);
 });
 await t.test("atomic proposal and replay leave the live listing unchanged, with one existing queue entry",async()=>{
  saved=await propose();assert.equal(saved.status,"pending_review");assert.equal((await propose()).id,saved.id);
  await assert.rejects(propose({body:{...data,name:"Changed retry"}}),/different details/);
  await assert.rejects(propose({key:"4".repeat(64)}),/already being reviewed/);
  assert.equal((await admin("select name from public.servers where id=$1",[target])).rows[0].name,"Established community");
  assert.equal((await admin("select count(*)::int n from public.moderation_queue where target_id=$1",[saved.id])).rows[0].n,1);
  await login();const context=(await db.query("select public.member_owned_listing_update($1) value",[target])).rows[0].value;assert.equal(context.ownerUpdate.pendingId,saved.id);
  const item=await inspect(saved.id);assert.equal(item.ownerUpdate.live.name,"Established community");assert.equal(item.name,data.name);
 });
 await t.test("a newer staff edit prevents approval; feedback and owner recheck use the same proposal",async()=>{
  const prior=await inspect(saved.id);await admin("update public.servers set description=description||' Staff clarified the rules.' where id=$1",[target]);await login(reviewer,staffSid);
  await assert.rejects(decide(saved.id,prior.reviewVersion,prior.queueVersion),/live listing changed/);
  await decide(saved.id,prior.reviewVersion,prior.queueVersion,"changes_requested");
  await login();const current=(await db.query("select public.member_server_submission($1) value",[saved.id])).rows[0].value;assert.equal(current.ownerUpdate.serverVersion,2);assert.match(current.ownerUpdate.live.description,/Staff clarified/);
  await db.exec("reset role;set role service_role");
  const params=[owner,sid,saved.id,current.submission.review_version,current.submission.queue_version,2,"5".repeat(64),JSON.stringify(data)];
  await assert.rejects(db.query("select public.resubmit_server_submission_server($1,$2,$3,$4,$5,$6,$7::jsonb,'safe',5,'[]','2026-08-19','2026-08-19')",[owner,sid,saved.id,current.submission.review_version,current.submission.queue_version,"6".repeat(64),JSON.stringify(data)]),/latest live details/);
  const query="select public.correct_owned_listing_update_server($1,$2,$3,$4,$5,$6,$7,$8::jsonb,'safe',5,'[]','2026-08-19','2026-08-19') value";
  const corrected=(await db.query(query,params)).rows[0].value;assert.equal(corrected.id,saved.id);assert.equal((await db.query(query,params)).rows[0].value.idempotent,true);
  assert.equal((await admin("select count(*)::int n from public.servers")).rows[0].n,1);
 });
 await t.test("server management permission and successful audit are required for live changes",async()=>{
  const item=await inspect(saved.id);
  await admin(`create or replace function public.has_staff_permission(p_permission text) returns boolean language sql stable as $$select auth.uid()='${reviewer}'::uuid and auth.jwt()->>'aal'='aal2' and p_permission<>'servers.manage'$$`);
  await login(reviewer,staffSid);await assert.rejects(decide(saved.id,item.reviewVersion,item.queueVersion),/management permission/);
  assert.equal((await inspect(saved.id)).ownerUpdate.canApprove,false);
  await admin(`create or replace function public.has_staff_permission(p_permission text) returns boolean language sql stable as $$select auth.uid()='${reviewer}'::uuid and auth.jwt()->>'aal'='aal2'$$`);
  await admin("alter table public.staff_audit_events add constraint fixture_fail_audit check(action<>'listing_update.approved') not valid");
  await login(reviewer,staffSid);await assert.rejects(decide(saved.id,item.reviewVersion,item.queueVersion),/fixture_fail_audit/);
  assert.equal((await admin("select name from public.servers where id=$1",[target])).rows[0].name,"Established community");
  assert.equal((await admin("select status from public.server_submissions where id=$1",[saved.id])).rows[0].status,"pending_review");
  await admin("alter table public.staff_audit_events drop constraint fixture_fail_audit");
 });
 await t.test("approval changes one live row, preserves stable identity/source/images/flags, and writes safe audit",async()=>{
  const item=await inspect(saved.id);await decide(saved.id,item.reviewVersion,item.queueVersion);
  const live=(await admin("select * from public.servers where id=$1",[target])).rows[0];assert.equal(live.name,data.name);assert.equal(live.slug,"permanent-address");assert.equal(live.owner_id,owner);assert.equal(live.verified,true);assert.equal(live.source_submission_id,null);const source=(await admin("select * from public.server_import_sources where server_id=$1",[target])).rows[0];assert.equal(source.logo_url,"https://cdn.example.org/logo.png");assert.equal(source.banner_url,"https://cdn.example.org/banner.png");assert.equal(source.join_code,"abcdef");assert.equal(live.website_url,"https://example.org");assert.equal(live.cfx_join_url,"https://cfx.re/join/example");assert.equal(live.language,"English");assert.equal(live.framework,"vMenu");
  assert.deepEqual((await admin("select tag from public.server_tags where server_id=$1 order by tag",[target])).rows.map(x=>x.tag),[...data.tags].sort());
  assert.equal((await admin("select count(*)::int n from public.servers")).rows[0].n,1);
  assert.equal((await admin("select source from public.server_tags where server_id=$1 and tag='serious-roleplay'",[target])).rows[0].source,"system");
  const audit=(await admin("select before_state,after_state from public.staff_audit_events where action='listing_update.approved'")).rows[0];assert.equal(audit.before_state.listing.name,"Established community");assert.equal(audit.after_state.listing.name,data.name);assert.ok(!JSON.stringify(audit).includes("authorityEvidence"));
  assert.equal((await propose()).status,"approved");
 });
 await t.test("transferred ownership and staff permission changes block approval and correction",async()=>{
  const version=(await admin("select moderation_version from public.servers where id=$1",[target])).rows[0].moderation_version;
  const next=await propose({version,key:"7".repeat(64)});const item=await inspect(next.id);
  await admin("update public.servers set owner_id=$2 where id=$1",[target,other]);await login(reviewer,staffSid);await assert.rejects(decide(next.id,item.reviewVersion,item.queueVersion),/not available/);
  await login();await assert.rejects(db.query("select public.member_server_submission($1)",[next.id]),/no longer attached/);
  await login(reviewer,staffSid);await decide(next.id,item.reviewVersion,item.queueVersion,"rejected");
  await login(other,otherSid);const mine=(await db.query("select public.member_owned_listing_update($1) value",[target])).rows[0].value;assert.equal(mine.ownerUpdate.pendingId,null);
  await db.exec("reset role;set role anon");await assert.rejects(db.query("select public.member_owned_listing_update($1)",[target]),/permission denied/);
  await login(reviewer,otherSid);await assert.rejects(decide(next.id,item.reviewVersion,item.queueVersion),/permission required/);
 });
 await t.test("Roblox owner edits preserve experience identity, hide internal provenance, and never create a duplicate listing",async()=>{
  const robloxTarget="dddddddd-0000-4000-8000-000000000001";
  const details={kind:"independent_community",experienceUrl:"https://www.roblox.com/games/12345",communityGroupUrl:null,joiningInstructions:"Join the official Discord and read the organised community roleplay rules."};
  await admin("insert into public.servers(id,owner_id,platform_id,name,slug,description,region,language,framework,community_url,access_type,status,roblox_details) values($1,$2,'roblox','Organised Roblox community','roblox-existing-address','An established roleplay community with organised sessions and welcoming public rules.','Europe','English','Emergency Response Liberty County','https://discord.gg/roblox','application','published',$3::jsonb)",[robloxTarget,owner,JSON.stringify(details)]);
  const originalApplication=(await admin("insert into public.server_submissions(submitted_by,platform_id,name,region,language,framework,description,community_url,roblox_details,moderation_confidence,moderation_score,status) values($1,'roblox','Original Roblox listing','Europe','English','Emergency Response Liberty County','An established roleplay community with carefully reviewed public details.','https://discord.gg/roblox',$2::jsonb,'safe',5,'approved') returning id",[owner,JSON.stringify(details)])).rows[0].id;
  await admin("update public.servers set source_submission_id=$2 where id=$1",[robloxTarget,originalApplication]);
  const rbVersion=(await admin("select moderation_version from public.servers where id=$1",[robloxTarget])).rows[0].moderation_version;
  const rb={...data,platform:"roblox",framework:"Emergency Response Liberty County",cfxJoinUrl:null,roblox:{...details,joiningInstructions:details.joiningInstructions+" Staff host an orientation every weekend.",applicantRole:"Current BrowseRP listing owner",authorityEvidence:"This request comes from the recorded BrowseRP owner and is not new proof of experience ownership."}};
  for(const change of [{...rb,framework:"Another experience"},{...rb,roblox:{...rb.roblox,experienceUrl:"https://www.roblox.com/games/54321"}},{...rb,roblox:{...rb.roblox,kind:"creator_experience"}}])await assert.rejects(propose({server:robloxTarget,version:rbVersion,body:change,key:"8".repeat(64)}),/reviewed Roblox experience/);
  const savedRb=await propose({server:robloxTarget,version:rbVersion,body:rb,key:"8".repeat(64)});
  await login();const mine=(await db.query("select public.member_server_submission($1) value",[savedRb.id])).rows[0].value;assert.equal(mine.submission.roblox.authorityEvidence,undefined);
  const review=await inspect(savedRb.id);assert.equal(review.roblox.applicantRole,undefined);assert.equal(review.ownerUpdate.live.roblox.experienceUrl,details.experienceUrl);await decide(savedRb.id,review.reviewVersion,review.queueVersion);
  const stored=(await admin("select roblox_details,slug from public.servers where id=$1",[robloxTarget])).rows[0];assert.equal(stored.roblox_details.joiningInstructions,rb.roblox.joiningInstructions);assert.equal(stored.roblox_details.experienceUrl,details.experienceUrl);assert.equal(stored.slug,"roblox-existing-address");assert.equal(stored.roblox_details.authorityEvidence,undefined);
  await admin("update public.servers set platform_id=platform_id,name=name||' Staff edit' where id=$1",[robloxTarget]);
  const later=(await admin("select roblox_details,source_submission_id from public.servers where id=$1",[robloxTarget])).rows[0];assert.equal(later.roblox_details.joiningInstructions,rb.roblox.joiningInstructions);assert.equal(later.source_submission_id,originalApplication);
  await db.exec("set role anon");const publicDetails=(await db.query("select public.public_roblox_listing_details($1::uuid[]) value",[[robloxTarget]])).rows[0].value;assert.equal(publicDetails[0].roblox.joiningInstructions,rb.roblox.joiningInstructions);assert.ok(!JSON.stringify(publicDetails).includes("authorityEvidence"));
  const audit=JSON.stringify((await admin("select before_state,after_state from public.staff_audit_events where target_id=$1",[savedRb.id])).rows);assert.ok(!audit.includes("authorityEvidence"));assert.ok(!audit.includes("recorded BrowseRP owner"));
 });

});
