import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
const read=n=>readFileSync(new URL(`../supabase/migrations/${n}`,import.meta.url),"utf8");
const fn=(s,n)=>s.match(new RegExp(`create or replace function ${n.replaceAll(".","\\.")}\\([\\s\\S]*?\\n\\$\\$;`))[0];
const table=(s,n)=>s.match(new RegExp(`create table(?: if not exists)? ${n.replaceAll(".","\\.")} \\([\\s\\S]*?\\n\\);`))[0];
const owner="00000000-0000-4000-8000-000000000001",a="00000000-0000-4000-8000-000000000002",b="00000000-0000-4000-8000-000000000003";
const sid=id=>id.replace("00000000","aaaaaaaa");
async function fixture(t) {
 const db=new PGlite();t.after(()=>db.close());
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create schema private;create schema extensions;
 create function extensions.gen_random_uuid() returns uuid language sql as $$select pg_catalog.gen_random_uuid()$$;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
 create table auth.users(id uuid primary key,deleted_at timestamptz,is_anonymous boolean default false,email text,phone text,email_confirmed_at timestamptz,phone_confirmed_at timestamptz,created_at timestamptz default now(),updated_at timestamptz default now(),last_sign_in_at timestamptz,encrypted_password text,raw_app_meta_data jsonb);
 create table auth.sessions(id uuid primary key,user_id uuid,not_after timestamptz);
 create table auth.identities(user_id uuid,provider text,provider_id text,identity_data jsonb default '{}',created_at timestamptz default now(),updated_at timestamptz default now(),last_sign_in_at timestamptz);
 create table private.discord_owner_allowlist(discord_user_id text,enabled boolean,role_key text);
 `);
 const core=read("202608180001_browserp_core.sql"),ops=read("20260819192413_platform_operations_and_trust.sql"),security=read("20260904092528_enforce_member_security_boundaries.sql");
 for(const ddl of core.matchAll(/create table public\.[a-z_]+ \([\s\S]*?\n\);/g)) await db.exec(ddl[0]);
 for(const n of ["private.platform_security_settings","public.account_activity","public.security_bans","public.security_ban_appeals","public.server_votes","public.server_comments","public.server_entitlements","public.payment_attempts"])await db.exec(table(ops,n));
 for(const source of [core,ops,read("20260819164347_v2_application_boundaries.sql"),read("20260905233144_reviewed_owner_listing_updates.sql")]){
  for(const match of source.matchAll(/alter table public\.(profiles|servers|server_submissions|ad_campaigns)\s+add column[\s\S]*?;/g))await db.exec(match[0]);
 }
 await db.exec(`create table public.staff_permission_overrides(user_id uuid,permission_key text,allowed boolean);
 alter table public.server_submissions add column if not exists review_version bigint not null default 1, add column roblox_details jsonb;
 alter table public.servers add column roblox_details jsonb;
 alter table public.server_submissions add owner_update_server_id uuid,add owner_update_version bigint;
 insert into public.staff_roles(key,name,description,rank) values('owner','Owner','Owner fixture',100),('helper','Helper','Helper fixture',10);
 insert into private.platform_security_settings(singleton,staff_mfa_required) values(true,true);
 `);
 const claims=read("20260904002113_fivem_imports_and_server_claims.sql");
 await db.exec(table(claims,"public.server_claim_requests"));
 await db.exec(table(read("20260905224408_reviewed_roblox_applications.sql"),"private.submission_roblox_evidence"));
 await db.exec(table(read("20260905210355_owner_submission_corrections.sql"),"private.server_submission_revisions"));
 await db.exec(fn(core,"public.consume_rate_limit"));
 await db.exec(read("20260905195616_enforce_auth_session_expiry.sql"));
 for(const n of ["private.member_access_allowed","private.require_active_member","private.enforce_member_rate_limit","public.has_staff_permission","public.staff_mfa_enrollment_allowed"])await db.exec(fn(security,n));
 await db.exec(fn(read("20260905195603_member_connection_session_guard.sql"),"public.member_connection_status"));
 await db.exec(read("20260905210347_member_data_requests.sql"));
 await db.exec(read("20260906002145_private_request_history_and_completion.sql"));
 await db.exec(read("20260906004454_structured_member_data_export.sql"));
 const admin=async sql=>{await db.exec("reset role");if(sql)await db.exec(sql);};
 const login=async(id=a,extra={})=>{await admin();await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)",[id,JSON.stringify({sub:id,session_id:sid(id),aal:id===owner?"aal2":"aal1",app_metadata:{provider:id===owner?"discord":"google"},amr:[{method:"oauth",timestamp:Math.floor(Date.now()/1000)},{method:"totp"}],...extra})]);await db.exec("set role authenticated");};
 const call=async(name,args=[],types="")=>(await db.query(`select public.${name}(${args.map((_,i)=>`$${i+1}${types.split(',')[i]?`::${types.split(',')[i]}`:''}`).join(',')}) value`,args)).rows[0].value;
 const create=async()=> (await call("member_data_requests",["create","copy","A complete account copy please.",randomUUID()],"text,text,text,uuid")).request;
 const review=async row=>(await call("staff_review_data_request",[row.id,"ready","Your request is ready for follow-up.",row.version,randomUUID()])).request;
 const approve=async(row,key=randomUUID(),complete=true,note="")=>(await call("staff_approve_data_export",[row.id,row.version,key,complete,note,true])).request;
 const generate=async(row,key=randomUUID())=>(await call("member_generate_data_export",[row.id,row.version,key])).copy;
 await admin(`insert into auth.users(id,email,encrypted_password,raw_app_meta_data) values('${owner}','owner@example.test','FORBIDDEN_PASSWORD','{"secret":"FORBIDDEN_META"}'),('${a}','a@example.test','FORBIDDEN_PASSWORD','{}'),('${b}','OTHER_ACCOUNT_EMAIL','FORBIDDEN_PASSWORD','{}');
 insert into auth.sessions(id,user_id) values('${sid(owner)}','${owner}'),('${sid(a)}','${a}'),('${sid(b)}','${b}');
 insert into auth.identities(user_id,provider,provider_id,identity_data) values('${owner}','discord','owner-discord','{}'),('${a}','google','own-provider','{"name":"My linked name","refresh_token":"FORBIDDEN_PROVIDER_TOKEN"}'),('${b}','google','OTHER_PROVIDER','{}');
 insert into public.profiles(id,username,display_name,bio) values('${owner}','owner','Owner',''),('${a}','alpha','Alpha','My private biography'),('${b}','bravo','Bravo','OTHER_PRIVATE_BIO');
 insert into public.staff_memberships(user_id,role_key,reason) values('${owner}','owner','Fixture owner');
 insert into private.discord_owner_allowlist values('owner-discord',true,'owner');
 insert into public.notifications(user_id,kind,title,body) values('${a}','notice','My notice','OWN_NOTICE'),('${b}','notice','Other notice','OTHER_NOTICE');
 insert into public.account_activity(user_id,event_type,masked_network,metadata) values('${a}','auth.signed_in','192.0.2.*','{"ip":"FORBIDDEN_RAW_IP"}');
 `);
 await admin(read("20260906020500_private_advertising_enquiries.sql"));
 // Duty entry is not invoked in export tests; supply its unrelated access
 // dependency as denied while applying the complete real duty migration.
 await admin("create function public.staff_authenticator_access() returns boolean language sql as $$select false$$;");
 await admin(read("20260908100259_explicit_staff_duty_sessions.sql"));
 await admin(fn(security,"public.member_server_interaction"));
 await admin(read("20260908100413_comment_identity_and_replies.sql"));
 await admin(read("20260908101556_member_recommendation_preferences.sql"));
 return {db,admin,login,call,create,review,approve,generate};
}

test("private account copies include own duty, comment context, and consent within existing export limits", async t => {
 const {db,admin,login,call,create,review,approve,generate}=await fixture(t);
 const server=randomUUID(),parent=randomUUID(),comment=randomUUID(),ownSessions=[randomUUID(),randomUUID(),randomUUID()],otherSession=randomUUID(),requestKey=randomUUID();
 await admin(`insert into public.staff_memberships(user_id,role_key,status,reason) values('${a}','helper','revoked','Former staff membership');
  insert into private.staff_duty_state(user_id,availability) values('${a}','away'),('${b}','available');
  insert into private.staff_work_sessions(id,user_id,started_at,ended_at,status,version) values
  ('${ownSessions[0]}','${a}','2026-01-01T10:00:00Z','2026-01-01T11:00:00Z','confirmed',3),
  ('${ownSessions[1]}','${a}','2026-01-02T10:00:00Z','2026-01-02T23:00:00Z','needs_review',2),
  ('${ownSessions[2]}','${a}','2026-01-03T10:00:00Z',null,'open',1),
  ('${otherSession}','${b}','2026-01-01T10:00:00Z','2026-01-01T11:00:00Z','confirmed',1);
  insert into private.staff_duty_requests(actor_id,request_key,payload,result)
  values('${a}','${requestKey}','{"reason":"FORBIDDEN_CORRECTION_REASON"}','{"secret":"FORBIDDEN_IDEMPOTENCY_RESULT"}');
  insert into public.staff_audit_events(actor_id,action,target_type,target_id,reason)
  values('${a}','staff.duty.correct_session','staff_work_session','${ownSessions[0]}','FORBIDDEN_AUDIT_CORRECTION_REASON');
  insert into public.platforms(id,name,short_name) values('fivem','FiveM','FiveM');
  insert into public.servers(id,owner_id,platform_id,name,slug,description,region,status)
  values('${server}','${b}','fivem','Export fixture','export-fixture','A published listing for the isolated account export regression.','Europe','published');
  insert into public.server_comments(id,server_id,author_id,body,status) values
  ('${parent}','${server}','${b}','FORBIDDEN_HIDDEN_PARENT_TEXT','hidden'),
  ('${comment}','${server}','${a}','An earlier own comment.','published');
  update public.server_comments set parent_comment_id='${parent}',body='OWN_EDITED_COMMENT_BODY' where id='${comment}';
  insert into private.advertising_enquiries(user_id,subject,destination_url,placement,message,status,reply) values
  ('${a}','Own enquiry','https://example.test/','directory','OWN_ADVERTISING_ENQUIRY','closed','OWN_ADVERTISING_REPLY'),
  ('${b}','Other enquiry','https://example.test/','any','FORBIDDEN_OTHER_ENQUIRY','replied','FORBIDDEN_OTHER_REPLY');
  insert into private.member_recommendation_preferences(user_id,schema_version,choice,version,updated_at) values
  ('${a}',1,'accepted',7,'2026-01-01T12:00:00Z'),('${b}',1,'rejected',13,'2026-01-02T12:00:00Z');
 `);
 const collect=async(subject=a)=>(await db.query("select private.member_export_records($1) value",[subject])).rows[0].value;
 const collectionBytes=async data=>(await db.query("select octet_length(($1::jsonb->'collections')::text) n",[data])).rows[0].n;
 const payloadBytes=async data=>(await db.query("select octet_length($1::jsonb::text) n",[data])).rows[0].n;
 const larger=error=>error.code==='PT413'&&/larger export/.test(error.message);
 let baseline,baselineCopy,updated,request;

 await t.test("an already-used approved generation routine picks up the new wrapper and preserves earlier fields",async()=>{
  await login();request=await create();await login(owner);request=await approve(await review(request));
  await login();baselineCopy=await generate(request);
  baseline=JSON.parse((await call('member_read_data_export',[baselineCopy.id])).content);
  assert.equal(baseline.collections.advertisingEnquiries[0].message,'OWN_ADVERTISING_ENQUIRY');
  assert.equal(baseline.collections.comments.length,1);
  assert.equal('staffWorkSessions' in baseline.collections,false);
  await admin(read('20260908101754_member_export_duty_and_comment_context.sql'));
  await admin(`update private.member_data_exports set expires_at=now()-interval '1 second' where id='${baselineCopy.id}';delete from public.rate_limit_buckets;`);
  await login();const copy=await generate(request),result=await call('member_read_data_export',[copy.id]);updated=JSON.parse(result.content);
  assert.notEqual(copy.id,baselineCopy.id);
  assert.equal(createHash('sha256').update(result.content).digest('hex'),copy.sha256);
  assert.equal(Buffer.byteLength(result.content),copy.byteSize);
  const {staffDutyState,staffWorkSessions,recommendationPreferences,...oldCollections}=updated.collections;
  oldCollections.comments=oldCollections.comments.map(({parent_comment_id,edited_at,...old})=>old);
  assert.deepEqual(oldCollections,baseline.collections);
  const {staffDutyState:stateCount,staffWorkSessions:workCount,recommendationPreferences:preferenceCount,...oldCounts}=updated.counts;
  assert.deepEqual(oldCounts,baseline.counts);assert.equal(stateCount,1);assert.equal(workCount,3);assert.equal(preferenceCount,1);
  assert.deepEqual(updated.scopeNotes.slice(0,baseline.scopeNotes.length),baseline.scopeNotes);
  assert.match(updated.scopeNotes.slice(baseline.scopeNotes.length).join(' '),/Staff duty/);
  const omitChanging=data=>Object.fromEntries(Object.entries(data).filter(([key])=>!['collections','counts','scopeNotes','generatedAt'].includes(key)));
  assert.deepEqual(omitChanging(updated),omitChanging(baseline));
 });

 await t.test("accepted, rejected, and unset consent describe only the member's current choice",async()=>{
  assert.deepEqual(updated.collections.recommendationPreferences,[{schemaVersion:1,choice:'accepted',version:7,updatedAt:'2026-01-01T12:00:00+00:00'}]);
  assert.equal(updated.counts.recommendationPreferences,1);
  await login();await admin('begin');
  try {
   await db.query("update private.member_recommendation_preferences set choice='rejected',version=8,updated_at='2026-01-03T12:00:00Z' where user_id=$1",[a]);
   const rejected=await collect();assert.deepEqual(rejected.collections.recommendationPreferences,[{schemaVersion:1,choice:'rejected',version:8,updatedAt:'2026-01-03T12:00:00+00:00'}]);
   await db.query('delete from private.member_recommendation_preferences where user_id=$1',[a]);
   const unset=await collect();assert.deepEqual(unset.collections.recommendationPreferences,[{schemaVersion:1,choice:null,version:0,updatedAt:null}]);
   assert.equal(unset.counts.recommendationPreferences,1);
   assert.equal((await db.query('select version from private.member_recommendation_preferences where user_id=$1',[b])).rows[0].version,13,'another account still has a saved choice');
  } finally {await db.exec('rollback');}
 });

 await t.test("former staff receive only their own recorded states, intervals, and comment links without private context",async()=>{
  assert.deepEqual(updated.collections.staffDutyState.map(s=>Object.keys(s).sort()),[['availability','updated_at']]);
  assert.equal(updated.collections.staffDutyState[0].availability,'away');
  const sessions=updated.collections.staffWorkSessions;
  assert.deepEqual(sessions.map(s=>s.id).sort(),[...ownSessions].sort());
  assert.deepEqual(sessions.map(s=>s.status).sort(),['confirmed','needs_review','open']);
  for(const session of sessions)assert.deepEqual(Object.keys(session).sort(),['ended_at','id','started_at','status','updated_at','version']);
  const ownComment=updated.collections.comments[0];assert.equal(ownComment.id,comment);assert.equal(ownComment.parent_comment_id,parent);assert.ok(ownComment.edited_at);
  assert.equal(ownComment.body,'OWN_EDITED_COMMENT_BODY');
  const text=JSON.stringify(updated);
  assert.doesNotMatch(text,/FORBIDDEN_|OTHER_ACCOUNT_EMAIL|OTHER_PRIVATE_BIO|OTHER_NOTICE|OTHER_PROVIDER/);
  assert.ok(!text.includes(otherSession));assert.ok(!text.includes(requestKey));
  await login();await admin('begin');
  try {
   await db.query('delete from public.staff_memberships where user_id=$1',[a]);
   const noMembership=await collect();assert.deepEqual(noMembership.collections.staffWorkSessions,sessions);
  } finally {await db.exec('rollback');}
 });

 await t.test("absent stored duty data stays empty without inventing availability or work events",async()=>{
  await login();await admin('begin');
  try {
   await db.query('delete from private.staff_duty_state where user_id=$1',[a]);
   await db.query('delete from private.staff_work_sessions where user_id=$1',[a]);
   const result=await collect();assert.deepEqual(result.collections.staffDutyState,[]);assert.deepEqual(result.collections.staffWorkSessions,[]);
   assert.equal(result.counts.staffDutyState,0);assert.equal(result.counts.staffWorkSessions,0);
  } finally {await db.exec('rollback');}
 });

 await t.test("collectors stay private and enforce the current account and live session even through privileged invocation",async()=>{
  const helpers=['member_export_records','member_export_records_before_duty_comments','member_export_records_before_advertising'];
  for(const role of ['anon','authenticated','service_role']){
   await admin(`set role ${role}`);
   for(const helper of helpers)await assert.rejects(db.query(`select private.${helper}($1)`,[a]),/permission denied/);
   for(const name of ['staff_duty_state','staff_work_sessions','staff_duty_requests','member_recommendation_preferences'])await assert.rejects(db.query(`select * from private.${name}`),/permission denied/);
   await admin();
   for(const helper of helpers)assert.equal((await db.query("select has_function_privilege($1,$2,'EXECUTE') allowed",[role,`private.${helper}(uuid)`])).rows[0].allowed,false);
  }
  await login();await admin();await assert.rejects(collect(b),error=>error.code==='42501'&&/Only your own account/.test(error.message));
  await admin('begin');
  try {
   await db.query('delete from auth.sessions where id=$1',[sid(a)]);
   await assert.rejects(collect(),error=>error.code==='42501'&&/active, unrestricted/.test(error.message));
  } finally {await db.exec('rollback');}
 });

 await t.test("2000 own work records are exported completely and record 2001 fails without truncation",async()=>{
  await login();await admin('begin');
  try {
   await db.query('delete from private.staff_work_sessions where user_id=$1',[a]);
   await db.query(`insert into private.staff_work_sessions(user_id,started_at,ended_at,status)
    select $1,'2026-01-01T10:00:00Z','2026-01-01T11:00:00Z','confirmed' from generate_series(1,2000)`,[a]);
   const result=await collect();assert.equal(result.counts.staffWorkSessions,2000);assert.equal(result.collections.staffWorkSessions.length,2000);
   assert.equal(new Set(result.collections.staffWorkSessions.map(s=>s.id)).size,2000);
   await db.query(`insert into private.staff_work_sessions(user_id,started_at,ended_at,status) values($1,'2026-01-02T10:00:00Z','2026-01-02T11:00:00Z','confirmed')`,[a]);
   await assert.rejects(collect(),larger);
  } finally {await db.exec('rollback');}
 });

 // Exact budget edges use an already-validated base projection substituted
 // only inside a rolled-back transaction. All positive account-copy tests
 // above run the complete original collector and real approval/generation RPCs.
 const withBase=async run=>{
  await login();await admin('begin');
  try {
   await db.exec(`create or replace function private.member_export_records_before_duty_comments(p_subject uuid)
    returns jsonb language sql stable security definer set search_path='' as $$
    select current_setting('fixture.member_export_base')::jsonb;
    $$;`);
   const setBase=async value=>db.query("select set_config('fixture.member_export_base',$1,true)",[JSON.stringify(value)]);
   await run(setBase);
  } finally {await db.exec('rollback');}
 };
 const emptyBase=()=>({collections:{comments:[]},counts:{comments:0},scopeNotes:[]});

 await t.test("consent's final row completes the 10000-row budget and rejects a prior total already at the cap",async()=>{
  await withBase(async setBase=>{
   const base=emptyBase();base.counts.previousCollections=9995;await setBase(base);
   const result=await collect();assert.equal(Object.values(result.counts).reduce((sum,n)=>sum+n,0),10000);
   base.counts.previousCollections=9996;await setBase(base);await assert.rejects(collect(),larger);
  });
 });

 await t.test("new duty bytes can reject a previously valid collection near the two-million-byte limit",async()=>{
  await withBase(async setBase=>{
   const base=emptyBase();base.collections.padding=[{body:''}];base.counts.padding=1;
   base.collections.padding[0].body='x'.repeat(1999900-await collectionBytes(base));
   assert.equal(await collectionBytes(base),1999900);assert.ok(await payloadBytes(base)<2097152);
   await setBase(base);await assert.rejects(collect(),larger);
  });
 });

 await t.test("added comment relationship and edit fields count against the collection-byte budget",async()=>{
  await withBase(async setBase=>{
   await db.query('delete from private.staff_duty_state where user_id=$1',[a]);
   await db.query('delete from private.staff_work_sessions where user_id=$1',[a]);
   const base=emptyBase();base.collections.comments=[baseline.collections.comments[0]];base.counts.comments=1;
   base.collections.padding=[{body:''}];base.counts.padding=1;
   base.collections.padding[0].body='x'.repeat(1999980-await collectionBytes(base));
   assert.equal(await collectionBytes(base),1999980);await setBase(base);await assert.rejects(collect(),larger);
  });
 });

 await t.test("the complete enriched payload retains the exact 2097152-byte limit",async()=>{
  await withBase(async setBase=>{
   const base=emptyBase();base.padding='';await setBase(base);
   const overhead=(await payloadBytes(await collect()))-(await payloadBytes(base));
   base.padding='x'.repeat(2097152-overhead-await payloadBytes(base));await setBase(base);
   assert.ok(await collectionBytes(base)<2000000);
   assert.equal(await payloadBytes(await collect()),2097152);
   base.padding+='x';await setBase(base);await assert.rejects(collect(),larger);
  });
 });
});
