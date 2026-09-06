import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
const read = file => readFileSync(new URL(`../supabase/migrations/${file}`, import.meta.url), "utf8");
const fn = (source,name) => source.match(new RegExp(`create or replace function ${name.replaceAll(".","\\.")}\\([\\s\\S]*?\\n\\$\\$;`))[0];
const owner="00000000-0000-4000-8000-000000000001", other="00000000-0000-4000-8000-000000000002", reviewer="00000000-0000-4000-8000-000000000003";
const sid="aaaaaaaa-0000-4000-8000-000000000001", otherSid="aaaaaaaa-0000-4000-8000-000000000002", id="bbbbbbbb-0000-4000-8000-000000000001";
const input={name:"Revised community",platform:"redm",region:"Europe",language:"English",framework:"VORP",description:"A carefully corrected community description with clear rules and welcoming roleplay.",communityUrl:"https://discord.gg/fixture",cfxJoinUrl:"https://cfx.re/join/example",accessType:"application",tags:["serious-roleplay","beginner-friendly"]};

test("Contextual listing features preserve existing imported information at every database boundary",async t=>{
 const db=new PGlite();t.after(()=>db.close());const core=read("202608180001_browserp_core.sql");const security=read("20260904092528_enforce_member_security_boundaries.sql");
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create schema private;create schema extensions;revoke all on schema private from public;
 create function extensions.gen_random_uuid() returns uuid language sql as $$select pg_catalog.gen_random_uuid()$$;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
 create table auth.users(id uuid primary key,deleted_at timestamptz,is_anonymous boolean default false);
 create table auth.sessions(id uuid primary key,user_id uuid,not_after timestamptz);
 create table public.security_bans(user_id uuid,target_type text,revoked_at timestamptz,starts_at timestamptz,ends_at timestamptz);

 insert into auth.users(id) values('${owner}'),('${other}'),('${reviewer}');
 insert into auth.sessions(id,user_id) values('${sid}','${owner}'),('${otherSid}','${other}');`);
 for(const name of ["platforms","profiles","server_submissions","moderation_queue","rate_limit_buckets","staff_audit_events","servers","reports","server_tags"]) await db.exec(core.match(new RegExp(`create table public\\.${name} \\([\\s\\S]*?\\n\\);`))[0]);
 await db.exec(`alter table public.servers add source_submission_id uuid,add access_type text,add cfx_join_url text;
 create unique index fixture_submission_source on public.servers(source_submission_id);
 alter table public.server_submissions add terms_version text,add standards_version text,add tags text[] default '{}',add access_type text default 'public',add cfx_join_url text,add metadata_fingerprint text;
 insert into public.profiles(id,username,display_name) values('${owner}','owner','Owner'),('${other}','other','Other'),('${reviewer}','reviewer','Reviewer');
 insert into public.platforms(id,name,short_name) values('fivem','FiveM','FiveM'),('redm','RedM','RedM'),('minecraft','Minecraft','MC');

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
 const catalogSource=read("20260819192413_platform_operations_and_trust.sql");
 await db.exec(catalogSource.match(/create table if not exists public\.server_tag_catalog \([\s\S]*?\n\);/)[0]);
 await db.exec(catalogSource.match(/insert into public\.server_tag_catalog \([\s\S]*?sort_order = excluded.sort_order;/)[0]);
 await db.exec(read("20260905224408_reviewed_roblox_applications.sql"));
 await db.exec(`alter table public.servers add moderation_version bigint not null default 1;`);
 await db.exec(fn(read("20260903233151_unified_moderation_workspace.sql"),"private.bump_moderation_version"));
 await db.exec("create trigger servers_moderation_version before update on public.servers for each row execute function private.bump_moderation_version()");
 await db.exec(read("20260904002113_fivem_imports_and_server_claims.sql").match(/create table public\.server_import_sources \([\s\S]*?\n\);/)[0]);
 await db.exec(read("20260905233144_reviewed_owner_listing_updates.sql"));
 await db.exec(read("20260906001040_contextual_listing_features.sql"));
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

 await t.test("new atomic core still denies ended, mismatched and foreign sessions without leaving data",async()=>{
  const rowsBefore=(await admin("select count(*)::int n from public.server_submissions")).rows[0].n;
  for(const args of [{session:otherSid},{expected:other},{actor:other,session:otherSid,expected:other},{version:99}])await assert.rejects(propose(args));
  await admin("update auth.sessions set not_after=now()-interval '1 second' where id=$1",[sid]);await assert.rejects(propose(),/Sign in again/);await admin("update auth.sessions set not_after=null where id=$1",[sid]);
  assert.equal((await admin("select count(*)::int n from public.server_submissions")).rows[0].n,rowsBefore);
 });
 const contextual=["serious-roleplay","semi-serious","beginner-friendly","economy","custom-cars","custom-clothing","custom-jobs","player-businesses","housing","police"];
 const researched=["vMenu","English speaking","UK-based",...Array.from({length:17},(_,i)=>`researched-${i+1}`)];
 const all=[...contextual,...researched];
 const imported={...data,name:"Corrected imported name",tags:all};
 await admin("delete from public.server_tags where server_id=$1",[target]);
 for(const tag of all)await admin("insert into public.server_tags(server_id,tag,source,relevance_score) values($1,$2,'system',77)",[target,tag]);
 const create=async(body,key="c".repeat(64))=>{await db.exec("reset role;set role service_role");return(await db.query("select public.create_server_application_server($1,$2,$1,$3::jsonb,'safe',5,'[]',$4,$5,'2026-08-19','2026-08-19') value",[owner,sid,JSON.stringify(body),crypto.randomUUID(),key])).rows[0].value;};
 await t.test("every displayed game feature has an enabled actual catalog entry and agrees with database policy",async()=>{
  const ui=readFileSync(new URL("../public/browserp-directory.js",import.meta.url),"utf8");
  const block=ui.match(/const LISTING_TAGS_BY_GAME = Object.freeze\(\{([\s\S]*?)\n  \}\);/)[1];
  for(const match of block.matchAll(/(fivem|redm|minecraft|roblox): Object.freeze\((\[[^\n]+\])\)/g)){
   const keys=JSON.parse(match[2]);const rows=(await admin("select key from public.server_tag_catalog where enabled and key=any($1::text[])",[keys])).rows;
   assert.equal(rows.length,keys.length,match[1]);assert.deepEqual((await admin("select private.listing_feature_keys($1) value",[match[1]])).rows[0].value,keys);
   for(const key of keys) {
    const sample={...data,platform:match[1],tags:[key],cfxJoinUrl:["fivem","redm"].includes(match[1])?data.cfxJoinUrl:null,
      roblox:match[1]==="roblox"?{kind:"independent_community",experienceUrl:"https://www.roblox.com/games/12345",communityGroupUrl:null,joiningInstructions:"Join the official community and read the rules for our organised roleplay sessions.",applicantRole:"Community owner",authorityEvidence:"I manage this community and can demonstrate control of its public server and group."}:null};
    const result=(await admin("select private.validate_submission_application($1::jsonb,'safe',5,'[]') value",[JSON.stringify(sample)])).rows[0].value;
    assert.deepEqual(result,[key],`${match[1]}: ${key}`);
   }
   for(const forbidden of ["whitelisted","public","public-access","private-server"])assert.ok(!keys.includes(forbidden));
  }
  assert.equal((await admin("select label from public.server_tag_catalog where key='serious-roleplay'")).rows[0].label,"Serious roleplay");
 });
 await t.test("failed owner attachment rolls back the expanded full-tag application, queue and retry receipt",async()=>{
  const before=(await admin("select count(*)::int n from public.server_submissions")).rows[0].n;
  await admin("alter table public.server_submissions add constraint fixture_tag_attachment check(owner_update_server_id is null) not valid");
  await assert.rejects(propose({body:imported}),/fixture_tag_attachment/);await admin("alter table public.server_submissions drop constraint fixture_tag_attachment");
  assert.equal((await admin("select count(*)::int n from public.server_submissions")).rows[0].n,before);
  assert.equal((await admin("select count(*)::int n from private.submission_creation_requests")).rows[0].n,0);
  assert.equal((await admin("select count(*)::int n from public.moderation_queue")).rows[0].n,1);
 });
 await t.test("a claimed imported listing keeps all thirty exact keywords on a name-only proposal, correction and approval",async()=>{
  const saved=await propose({body:imported});assert.deepEqual((await admin("select tags from public.server_submissions where id=$1",[saved.id])).rows[0].tags,[...all].sort());
  assert.equal((await propose({body:imported})).id,saved.id);
  const item=await inspect(saved.id);await decide(saved.id,item.reviewVersion,item.queueVersion,"changes_requested");
  await login();const mine=(await db.query("select public.member_server_submission($1) value",[saved.id])).rows[0].value;
  await db.exec("reset role;set role service_role");
  const query="select public.correct_owned_listing_update_server($1,$2,$3,$4,$5,1,$6,$7::jsonb,'safe',5,'[]','2026-08-19','2026-08-19') value";
  const params=[owner,sid,saved.id,mine.submission.review_version,mine.submission.queue_version,"d".repeat(64),JSON.stringify({...imported,name:"Final imported name"})];
  const corrected=(await db.query(query,params)).rows[0].value;assert.equal((await db.query(query,params)).rows[0].value.idempotent,true);
  const review=await inspect(corrected.id);await decide(corrected.id,review.reviewVersion,review.queueVersion);
  const rows=(await admin("select tag,source,relevance_score from public.server_tags where server_id=$1 order by tag",[target])).rows;
  assert.deepEqual(rows.map(x=>x.tag),[...all].sort());assert.ok(rows.every(x=>x.source==="system"&&Number(x.relevance_score)===77));
  assert.equal((await admin("select name from public.servers where id=$1",[target])).rows[0].name,"Final imported name");
  assert.equal((await propose({body:imported})).status,"approved");
 });
 await t.test("existing research is never silently dropped and only contextual bounded additions are accepted",async()=>{
  const version=(await admin("select moderation_version from public.servers where id=$1",[target])).rows[0].moderation_version;
  for(const tags of [all.filter(x=>x!=="vMenu"),[...all.slice(1),"forged-keyword"],[...all.slice(1),"quests"],[...all,"ems"]])await assert.rejects(propose({body:{...imported,tags},version,key:"4".repeat(64)}),/keywords|match this game|eight new/);
  const changed=[...all.filter(x=>x!=="custom-cars"),"ems"];
  const saved=await propose({body:{...imported,tags:changed},version,key:"4".repeat(64)});const review=await inspect(saved.id);await decide(saved.id,review.reviewVersion,review.queueVersion);
  assert.equal((await admin("select source from public.server_tags where server_id=$1 and tag='ems'",[target])).rows[0].source,"owner");
  assert.equal((await admin("select count(*)::int n from public.server_tags where server_id=$1 and tag='custom-cars'",[target])).rows[0].n,0);
 });
 await t.test("ordinary applications cannot use the owner allowance, off-game features, or nonlaunch games",async()=>{
  for(const body of [{...data,tags:all},{...data,tags:["quests"]},{...data,ownerUpdate:true},{...data,platform:"rust",cfxJoinUrl:null,tags:[]}])await assert.rejects(create(body),/available|eight|feature choices have changed|Invalid application|Applications are open/);
  await assert.rejects(propose({actor:other,session:otherSid,expected:other,body:imported,version:3}),/not available/);
  for(const role of ["anon","authenticated","service_role"]){await db.exec(`reset role;set role ${role}`);await assert.rejects(db.query("select private.validate_owned_listing_features($1,$2,$3::jsonb,'safe',5,'[]')",[owner,target,JSON.stringify(imported)]),/permission denied/);}
 });
 await t.test("owners can add at most eight contextual features in one request",async()=>{
  const small="eeeeeeee-0000-4000-8000-000000000002";
  await admin("insert into public.servers(id,owner_id,platform_id,name,slug,description,region,language,framework,community_url,access_type,status) values($1,$2,'fivem','Small metadata fixture','small-metadata-fixture',$3,'Europe','English','vMenu','https://discord.gg/fixture','public','published')",[small,owner,data.description]);
  const query="select private.validate_owned_listing_features($1,$2,$3::jsonb,'safe',5,'[]') value";
  await assert.rejects(admin(query,[owner,small,JSON.stringify({...data,tags:contextual.slice(0,9)})]),/eight new features/);
  assert.equal((await admin(query,[owner,small,JSON.stringify({...data,tags:contextual.slice(0,8)})])).rows[0].value.length,8);
 });
 await t.test("legacy published games remain maintainable by their actual owner without admitting new legacy applications",async()=>{
  await admin("insert into public.platforms(id,name,short_name) values('rust','Rust','Rust')");
  const legacy="eeeeeeee-0000-4000-8000-000000000001";
  await admin("insert into public.servers(id,owner_id,platform_id,name,slug,description,region,language,framework,community_url,access_type,status) values($1,$2,'rust','Legacy community','legacy-community',$3,'Europe','English','Custom','https://discord.gg/fixture','public','published')",[legacy,owner,data.description]);
  await admin("insert into public.server_tags(server_id,tag,source) values($1,'Legacy setting','staff')",[legacy]);
  const body={...data,platform:"rust",framework:"Custom",cfxJoinUrl:null,tags:["Legacy setting"]};
  const saved=await propose({server:legacy,body,key:"5".repeat(64)});assert.equal(saved.status,"pending_review");
  const review=await inspect(saved.id);await decide(saved.id,review.reviewVersion,review.queueVersion);
  assert.equal((await admin("select source from public.server_tags where server_id=$1",[legacy])).rows[0].source,"staff");
  await admin("update public.server_submissions set platform_id='rust',tags=array['qbcore'] where id=$1",[id]);
  await login();const originalReview=(await db.query("select public.member_server_submission($1) value",[id])).rows[0].value;
  await db.exec("reset role;set role service_role");
  const params=[owner,sid,id,originalReview.submission.review_version,originalReview.submission.queue_version,"9".repeat(64),JSON.stringify({...body,tags:["qbcore"]})];
  const correction=(await db.query("select public.resubmit_server_submission_server($1,$2,$3,$4,$5,$6,$7::jsonb,'safe',5,'[]','2026-08-19','2026-08-19') value",params)).rows[0].value;
  assert.equal(correction.id,id);assert.equal(correction.status,"pending_review");
 });
});
