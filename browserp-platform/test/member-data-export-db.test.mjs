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
test("structured private copies enforce approval, isolation, expiry and truthful receipt",async t=>{
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
 let request,copy;
 await t.test("no copy before staff scope approval; regular members cannot approve",async()=>{
  await login();request=await create();await assert.rejects(generate(request),/not approved/);await assert.rejects(approve(request),/permission/);
  await login(owner,{aal:"aal1"});await assert.rejects(approve(request),/permission/);
  await login(owner);request=await review(request);const before=request,key=randomUUID();request=await approve(before,key,false,"Uploaded files will be checked separately.");
  assert.equal(request.export.approved,true);assert.equal((await approve(before,key,false,"Uploaded files will be checked separately.")).version,request.version);
  await assert.rejects(approve(before,key,true),/already used/);await assert.rejects(approve(before),/changed/);
 });
 await t.test("full collector runs against real table definitions and exports only the member's named records",async()=>{
  await login();const key=randomUUID();copy=await generate(request,key);assert.equal((await generate(request,key)).id,copy.id);
  const result=await call("member_read_data_export",[copy.id]);assert.equal(createHash('sha256').update(result.content).digest('hex'),copy.sha256);assert.equal(Buffer.byteLength(result.content),copy.byteSize);
  const data=JSON.parse(result.content);assert.equal(data.collections.account[0].email,'a@example.test');assert.equal(data.collections.profile[0].bio,'My private biography');assert.equal(data.collections.connections[0].identity.name,'My linked name');assert.equal(data.collections.notifications[0].body,'OWN_NOTICE');assert.ok(Object.keys(data.collections).length>30);
  assert.doesNotMatch(result.content,/FORBIDDEN_|OTHER_ACCOUNT_EMAIL|OTHER_PRIVATE_BIO|OTHER_NOTICE|OTHER_PROVIDER/);assert.ok(data.pending.some(x=>x.category==='staff_follow_up'));
  await admin(`update public.profiles set bio='Changed after snapshot' where id='${a}'`);await login();assert.match((await call('member_read_data_export',[copy.id])).content,/My private biography/);
 });
 await t.test("another member or staff cannot fetch or acknowledge another member's private file",async()=>{
  for(const who of[b,owner]){await login(who);await assert.rejects(call('member_read_data_export',[copy.id]),/not found/);await assert.rejects(call('member_receive_data_export',[copy.id,copy.sha256,true]),/not found/);await assert.rejects(generate(request),/not found/);}
 });
 await t.test("original recent OAuth and live sessions are required, even when a JWT was just refreshed",async()=>{
  await login(a,{iat:Math.floor(Date.now()/1000),amr:[{method:'oauth',timestamp:Math.floor(Date.now()/1000)-601}]});await assert.rejects(call('member_read_data_export',[copy.id]),/Sign in again/);
  await login(a,{session_id:sid(b)});await assert.rejects(call('member_read_data_export',[copy.id]),/active, unrestricted/);
  await admin(`delete from auth.sessions where id='${sid(a)}'`);await login();await assert.rejects(call('member_read_data_export',[copy.id]),/active, unrestricted/);
  await admin(`insert into auth.sessions(id,user_id,not_after) values('${sid(a)}','${a}',now()-interval '1 second')`);await login();await assert.rejects(call('member_read_data_export',[copy.id]),/active, unrestricted/);
  await admin(`update auth.sessions set not_after=null where id='${sid(a)}'`);
 });
 await t.test("receipt is exact and idempotent but never closes a request or pretends all parts were delivered",async()=>{
  await login();await assert.rejects(call('member_receive_data_export',[copy.id,'0'.repeat(64),true]),/Download and check/);await assert.rejects(call('member_receive_data_export',[copy.id,copy.sha256,false]),/Download and check/);
  const received=await call('member_receive_data_export',[copy.id,copy.sha256,true]);assert.equal(received.request.status,'ready');assert.ok(received.copy.receivedAt);assert.equal((await call('member_receive_data_export',[copy.id,copy.sha256,true])).copy.receivedAt,received.copy.receivedAt);
 });
 await t.test("request changes revoke prepared copies before another download",async()=>{
  await login(owner);request=await review(request);await login();await assert.rejects(call('member_read_data_export',[copy.id]),/request changed/);await assert.rejects(call('member_receive_data_export',[copy.id,copy.sha256,true]),/request changed/);
  await login(owner);request=await approve(request);await login();copy=await generate(request);
 });
 await t.test("expiry denies reads even before cleanup and cleanup removes only expired payloads",async()=>{
  await admin(`update private.member_data_exports set expires_at=now()-interval '1 second' where id='${copy.id}'`);await login();await assert.rejects(call('member_read_data_export',[copy.id]),/expired/);await assert.rejects(call('service_prune_data_exports'),/permission denied/);
  await admin('set role service_role');assert.equal(await call('service_prune_data_exports'),1);await admin();assert.equal((await db.query('select payload from private.member_data_exports where id=$1',[copy.id])).rows[0].payload,null);
  assert.equal((await db.query('select count(*)::int n from private.account_data_requests')).rows[0].n,1);
 });
 await t.test("large accounts fail visibly instead of silently truncating records",async()=>{
  await admin(`delete from public.rate_limit_buckets; insert into public.notifications(user_id,kind,title,body) select '${a}','notice','Count fixture','bounded' from generate_series(1,2001)`);await login();await assert.rejects(generate(request),/larger export/);
  await admin(`delete from public.notifications where title='Count fixture'`);
 });
 await t.test("upload metadata and reviewed supplements are labelled, and a second member gets their own separate file",async()=>{
  await admin(`delete from public.rate_limit_buckets;insert into public.uploaded_assets(owner_id,bucket,object_path,media_type,mime_type,byte_size,sha256,moderation_result) values('${b}','profile-media','FORBIDDEN_OBJECT_PATH','avatar','image/png',12,'fixturehash','{"secret":"FORBIDDEN_MEDIA_SCAN"}');
   insert into public.applications(applicant_id,application_type,answers) values('${b}','staff','{"thirdParty":"FORBIDDEN_APPLICATION_ANSWER"}');`);
  await login(b);let row=await create();await login(owner);row=await review(row);row=await approve(row);await login(b);const otherCopy=await generate(row),result=await call('member_read_data_export',[otherCopy.id]);const data=JSON.parse(result.content);
  assert.equal(data.collections.account[0].email,'OTHER_ACCOUNT_EMAIL');assert.equal(data.collections.uploads.length,1);assert.deepEqual(data.pending.map(x=>x.category),['uploaded_files','reviewed_supplement']);assert.doesNotMatch(result.content,/My private biography|OWN_NOTICE|FORBIDDEN_OBJECT_PATH|FORBIDDEN_MEDIA_SCAN|FORBIDDEN_APPLICATION_ANSWER/);
  const receipt=await call('member_receive_data_export',[otherCopy.id,otherCopy.sha256,true]);assert.equal(receipt.request.status,'ready');
  await call('member_data_requests',['withdraw',null,null,null,row.id,row.version]);const history=await call('member_data_request_history',[row.id]);assert.ok(history.copies[0].receivedAt);assert.doesNotMatch(JSON.stringify(history),/FORBIDDEN_|sha256|content/);await assert.rejects(call('member_read_data_export',[otherCopy.id]),/request changed/);
 });
 await t.test("byte limits reject an oversized account and withdrawn staff authority cannot approve",async()=>{
  await admin(`delete from public.rate_limit_buckets;insert into public.notifications(user_id,kind,title,body) values('${a}','notice','Oversize fixture',repeat('x',2100000))`);await login();await assert.rejects(generate(request),/larger export/);
  await admin(`delete from public.notifications where title='Oversize fixture';update private.discord_owner_allowlist set enabled=false`);await login(owner);await assert.rejects(approve(request),/permission/);await admin('update private.discord_owner_allowlist set enabled=true');
 });
 await t.test("no raw payload, approval or collector access is granted to client or service roles",async()=>{
  for(const role of['anon','authenticated','service_role']){await admin(`set role ${role}`);await assert.rejects(db.query('select * from private.member_data_exports'),/permission denied/);await assert.rejects(db.query('select private.member_export_records($1)',[a]),/permission denied/);}
  await admin();assert.equal((await db.query("select count(*)::int n from private.account_data_request_fulfillments")).rows[0].n,0);
  assert.doesNotMatch(JSON.stringify((await db.query('select * from public.staff_audit_events')).rows),/My private biography|OWN_NOTICE|Uploaded files will/);
 });
});
