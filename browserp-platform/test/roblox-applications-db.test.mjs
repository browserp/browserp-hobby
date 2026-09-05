import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
const read = file => readFileSync(new URL(`../supabase/migrations/${file}`, import.meta.url), "utf8");
const fn = (source,name) => source.match(new RegExp(`create or replace function ${name.replaceAll(".","\\.")}\\([\\s\\S]*?\\n\\$\\$;`))[0];
const owner="00000000-0000-4000-8000-000000000001", other="00000000-0000-4000-8000-000000000002", reviewer="00000000-0000-4000-8000-000000000003";
const sid="aaaaaaaa-0000-4000-8000-000000000001", otherSid="aaaaaaaa-0000-4000-8000-000000000002", id="bbbbbbbb-0000-4000-8000-000000000001";
const input={name:"Revised community",platform:"redm",region:"Europe",language:"English",framework:"VORP",description:"A carefully corrected community description with clear rules and welcoming roleplay.",communityUrl:"https://discord.gg/fixture",cfxJoinUrl:"https://cfx.re/join/example",accessType:"application",tags:["serious-roleplay","beginner-friendly"]};

test("Roblox applications are complete, private and version-safe through publication",async t=>{
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
 const admin=async(sql,params=[])=>{await db.exec("reset role");return db.query(sql,params);};
 const login=async(user=owner,session=sid)=>{await db.exec("reset role");await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)",[user,JSON.stringify({sub:user,session_id:session,aal:"aal2"})]);await db.exec("set role authenticated");};
 const rb={kind:"independent_community",experienceUrl:"https://www.roblox.com/games/12345",communityGroupUrl:"https://www.roblox.com/communities/6789",joiningInstructions:"Join the community Discord, read our rules and apply for an organised roleplay session.",applicantRole:"Community owner",authorityEvidence:"Private fixture evidence: I control this community and can place a temporary verification reference in its official public description."};
 const data={...input,name:"Example Roblox community",platform:"roblox",framework:"Emergency Response Liberty County",cfxJoinUrl:null,roblox:rb};
 const create=async({actor=owner,session=sid,expected=owner,body=data,key="e".repeat(64),role="service_role"}={})=>{await db.exec(`reset role;set role ${role}`);return(await db.query("select public.create_server_application_server($1,$2,$3,$4::jsonb,'safe',5,'[]',$5,$6,'2026-08-19','2026-08-19') value",[actor,session,expected,JSON.stringify(body),crypto.randomUUID(),key])).rows[0].value;};
 let saved;
 await t.test("atomic writer rejects ended/foreign sessions, switched accounts and direct calls without creating anything",async()=>{
  for(const args of [{session:otherSid},{expected:other},{session:null},{role:"anon"},{role:"authenticated"}]) await assert.rejects(create(args));
  await admin("update auth.sessions set not_after=now()-interval '1 second' where id=$1",[sid]);await assert.rejects(create(),/Sign in again/);await admin("update auth.sessions set not_after=null where id=$1",[sid]);
  await admin("insert into public.security_bans values($1,'account',null,now(),null)",[owner]);await assert.rejects(create(),/restricted/);await admin("delete from public.security_bans");
  assert.equal((await admin("select count(*)::int n from public.server_submissions")).rows[0].n,1);
 });
 await t.test("invalid or misleading fields and queue failure leave no partial submission/evidence/retry record",async()=>{
  for(const body of [{...data,roblox:null},{...data,roblox:{...rb,players:7000}},{...data,roblox:{...rb,experienceUrl:"https://www.roblox.com.evil/games/1"}},{...data,roblox:{...rb,experienceUrl:"https://www.roblox.com/games/1?privateServerLinkCode=secret"}},{...data,cfxJoinUrl:"https://cfx.re/join/example"},{...data,platform:"fivem"},{...data,tags:["invented"]}])await assert.rejects(create({body}));
  await admin("alter table public.moderation_queue add constraint fixture_fail_create check(score<>5) not valid");await assert.rejects(create(),/fixture_fail_create/);await admin("alter table public.moderation_queue drop constraint fixture_fail_create");
  for(const table of ["private.submission_roblox_evidence","private.submission_creation_requests"])assert.equal((await admin(`select count(*)::int n from ${table}`)).rows[0].n,0);
  assert.equal((await admin("select count(*)::int n from public.server_submissions")).rows[0].n,1);
 });
 await t.test("complete application appears once; identical retries replay but changed private or public details conflict",async()=>{
  saved=await create();assert.equal(saved.review_version,1);assert.equal(saved.status,"pending_review");assert.equal((await create()).id,saved.id);
  for(const body of [{...data,accessType:"public"},{...data,roblox:{...rb,authorityEvidence:rb.authorityEvidence+" Different evidence."}},{...data,roblox:{...rb,joiningInstructions:rb.joiningInstructions+" Additional steps."}}])await assert.rejects(create({body}),/different details/);
  const row=(await admin("select * from public.server_submissions where id=$1",[saved.id])).rows[0];assert.equal(row.language,"English");assert.equal(row.framework,data.framework);assert.equal(row.roblox_details.authorityEvidence,undefined);assert.equal(row.roblox_details.applicantRole,undefined);assert.equal(row.tags.length,2);
  assert.equal((await admin("select count(*)::int n from public.moderation_queue where target_id=$1",[saved.id])).rows[0].n,1);
 });
 await t.test("owner and permitted staff can read private evidence, other accounts cannot; public lookup sees no pending application",async()=>{
  await login();const mine=(await db.query("select public.member_server_submission($1) value",[saved.id])).rows[0].value;assert.equal(mine.submission.roblox.authorityEvidence,rb.authorityEvidence);
  await assert.rejects(db.query("select * from private.submission_roblox_evidence"),/permission denied/);await login(other,otherSid);await assert.rejects(db.query("select public.member_server_submission($1)",[saved.id]),/not found/);
  await db.exec("reset role;set role anon");assert.deepEqual((await db.query("select public.public_roblox_listing_details($1::uuid[]) value",[[saved.id]])).rows[0].value,[]);
 });
 const staffSid="aaaaaaaa-0000-4000-8000-000000000003";
 const inspect=async()=> (await db.query("select public.staff_server_submission_review($1) value",[saved.id])).rows[0].value;
 const decide=async(v,q,action="approved",proof=false)=> (await db.query("select public.staff_review_server_application($1,$2,$3,$4,'Reviewed the community joining details',$5,$6,$7) value",[saved.id,v,q,action,crypto.randomUUID(),proof,proof?"Confirmed a temporary reference on the official community property.":null])).rows[0].value;
 await t.test("staff must confirm control; old RPC cannot bypass it and request-changes preserves the original application",async()=>{
  await admin("insert into auth.sessions(id,user_id) values($1,$2)",[staffSid,reviewer]);await login(reviewer,staffSid);assert.equal((await inspect()).roblox.authorityEvidence,rb.authorityEvidence);
  await assert.rejects(decide(1,1),/Check the applicant/);
  await assert.rejects(db.query("select public.staff_review_server_submission($1,1,1,'approved','Reviewed all details',$2)",[saved.id,crypto.randomUUID()]),/Check the applicant/);
  await decide(1,1,"changes_requested");const item=await inspect();assert.equal(item.status,"changes_requested");
  const revised={...data,roblox:{...rb,authorityEvidence:rb.authorityEvidence+" The requested public reference is now present."}};
  await db.exec("reset role;set role service_role");const result=(await db.query("select public.resubmit_server_submission_server($1,$2,$3,$4,$5,$6,$7::jsonb,'safe',5,'[]','2026-08-19','2026-08-19') value",[owner,sid,saved.id,item.reviewVersion,item.queueVersion,"f".repeat(64),JSON.stringify(revised)])).rows[0].value;
  assert.equal(result.id,saved.id);await login(reviewer,staffSid);const current=await inspect();assert.equal(current.roblox.authorityEvidence,revised.roblox.authorityEvidence);assert.ok(current.history.some(h=>h.roblox?.authorityEvidence===rb.authorityEvidence));
  await assert.rejects(decide(item.reviewVersion,item.queueVersion,"approved",true),/changed/);
  await decide(current.reviewVersion,current.queueVersion,"approved",true);
 });
 await t.test("publication exposes only reviewed public details and no proof in broad staff audit; replay keeps current status",async()=>{
  const server=(await admin("select * from public.servers where source_submission_id=$1",[saved.id])).rows[0];assert.equal(server.owner_id,owner);assert.equal(server.roblox_details.experienceUrl,rb.experienceUrl);assert.equal(server.roblox_details.authorityEvidence,undefined);assert.equal(server.access_type,"application");
  const audit=JSON.stringify((await admin("select before_state,after_state from public.staff_audit_events where target_id=$1",[saved.id])).rows);assert.ok(!audit.includes('Private fixture evidence'));assert.ok(!audit.includes('authorityEvidence'));
  await db.exec("set role anon");const exposed=(await db.query("select public.public_roblox_listing_details($1::uuid[]) value",[[server.id]])).rows[0].value;assert.equal(exposed[0].roblox.joiningInstructions,rb.joiningInstructions);assert.ok(!JSON.stringify(exposed).includes('authorityEvidence'));
  assert.equal((await create()).status,"approved");
 });
 await t.test("two independent communities may use the same Roblox experience, and other games still use atomic metadata",async()=>{
  const second=await create({body:{...data,name:"Another independent community",communityUrl:"https://discord.gg/another",accessType:"unknown"},key:"1".repeat(64)});assert.notEqual(second.id,saved.id);assert.equal((await admin("select access_type from public.server_submissions where id=$1",[second.id])).rows[0].access_type,"unknown");
  const fivem=await create({body:{...input,platform:"fivem",framework:"vMenu",roblox:null},key:"2".repeat(64)});const row=(await admin("select * from public.server_submissions where id=$1",[fivem.id])).rows[0];assert.equal(row.cfx_join_url,input.cfxJoinUrl);assert.equal(row.roblox_details,null);assert.equal(row.language,"English");assert.equal(row.framework,"vMenu");
 });
 await t.test("post-promotion retirement closes earlier server writers while atomic replay remains available",async()=>{
  await db.exec("reset role");await db.exec(read("20260905225514_retire_partial_submission_writers.sql"));
  for(const name of ["create_server_submission_server","create_server_submission_server_v2","attach_server_submission_metadata_server"]){const rights=(await admin("select has_function_privilege('service_role',p.oid,'execute') allowed from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname=$1",[name])).rows;assert.ok(rights.length>0);assert.ok(rights.every(r=>r.allowed===false));}
  assert.equal((await create()).status,"approved");
 });

});
