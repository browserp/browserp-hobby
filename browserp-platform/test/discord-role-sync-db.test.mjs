import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {PGlite} from '@electric-sql/pglite';
import {pgcrypto} from '@electric-sql/pglite/contrib/pgcrypto';
const migration=readFileSync(new URL('../supabase/migrations/20260906203519_discord_site_role_sync.sql',import.meta.url),'utf8');
const actor='00000000-0000-4000-8000-000000000001',member='00000000-0000-4000-8000-000000000002';
const guild='111111111111111111',bot='222222222222222222',target='444444444444444444',a='555555555555555555',b='666666666666666666',protect='777777777777777777',token='a'.repeat(64);
test('private role reconciliation preserves revocations, exact authority, historical IDs and configuration fencing',async t=>{
 const db=new PGlite({extensions:{pgcrypto}});
 const value=async(sql,args=[])=>(await db.query('select (select '+sql+') as value',args)).rows[0].value;
 const setRole=async role=>{await db.exec('reset role');if(role)await db.exec('set role '+role);};
 try{
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema private;create schema auth;create schema extensions;create schema vault;create schema net;create schema cron;
 create extension pgcrypto with schema extensions;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create function public.has_staff_permission(text) returns boolean language sql stable as $$select auth.uid()='${actor}'::uuid and current_setting('request.jwt.aal',true)='aal2'$$;
 create table auth.users(id uuid primary key,deleted_at timestamptz,is_anonymous boolean default false);
 create table auth.identities(user_id uuid references auth.users on delete cascade,provider text,provider_id text,identity_data jsonb default '{}');
 create table public.staff_roles(key text primary key);insert into public.staff_roles values('owner'),('administrator'),('senior_moderator'),('moderator'),('support');
 create table public.staff_memberships(user_id uuid references auth.users on delete cascade,role_key text,status text);
 create table public.security_bans(user_id uuid,target_type text,starts_at timestamptz default now(),ends_at timestamptz,revoked_at timestamptz);
 create table private.discord_owner_allowlist(discord_user_id text primary key,role_key text,enabled boolean);
 create table private.secrets(key text primary key,secret_hash text);
 insert into private.secrets values('server_status_refresh',encode(extensions.digest('${token}','sha256'),'hex'));
 create table vault.decrypted_secrets(name text,decrypted_secret text);
 create function net.http_post(url text,body jsonb,headers jsonb,timeout_milliseconds integer) returns bigint language sql as $$select 1::bigint$$;
 create table cron.job(jobid bigint generated always as identity,jobname text,schedule text,command text,active boolean default true);
 create function cron.schedule(job_name text,cron_schedule text,sql_command text) returns bigint language sql as $$insert into cron.job(jobname,schedule,command) values(job_name,cron_schedule,sql_command) returning jobid$$;
 create function cron.alter_job(job_id bigint,active boolean) returns void language sql as $$update cron.job set active=$2 where jobid=$1$$;
 insert into auth.users(id) values('${actor}'),('${member}');
 insert into public.staff_memberships values('${actor}','owner','active'),('${member}','moderator','active');
 insert into auth.identities(user_id,provider,provider_id) values('${member}','discord','${target}');
 insert into private.discord_owner_allowlist values('${target}','moderator',true);
 `);
 await db.exec(migration);
 const configure=async(mappings={moderator:a},version=0,enabled=true)=>value('public.staff_configure_discord_role_sync($1,$2,$3,$4,$5,false,$6,$7)',[guild,bot,[protect],JSON.stringify(mappings),enabled,version,'Reviewed exact roles for testing']);
 await t.test('new configuration and schedule are disabled; anonymous and member identities cannot configure or read private data',async()=>{
  assert.equal(await value('enabled from private.discord_role_sync_control'),false);assert.equal(await value('active from cron.job'),false);
  for(const role of ['anon','authenticated','service_role']){await setRole(role);await assert.rejects(value('count(*) from private.discord_role_sync_members'),/permission denied/);await assert.rejects(value('count(*) from private.discord_role_sync_control'),/permission denied/);}
  await setRole('anon');await assert.rejects(value('public.staff_discord_role_sync_control()'),/permission denied/);await assert.rejects(value('public.service_claim_discord_role_sync($1)',[token]),/permission denied/);
  await setRole();await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.aal','aal2',false)",[member]);await setRole('authenticated');await assert.rejects(configure(),/Owner permission/);await assert.rejects(value('public.staff_discord_role_sync_control()'),/Owner permission/);
  await setRole();await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.aal','aal1',false)",[actor]);await setRole('authenticated');await assert.rejects(configure(),/Owner permission/);
  await setRole();await db.exec("select set_config('request.jwt.aal','aal2',false)");await setRole('authenticated');await configure();
  await assert.rejects(configure({moderator:555555555555555555},1),/exact strings/);await assert.rejects(configure({owner:a},1),/Invalid exact role/);await assert.rejects(configure({moderator:protect},1),/Invalid exact role/);
 });
 let run;
 const claim=async()=>{await setRole();await db.exec("update private.discord_role_sync_control set leased_until='-infinity',not_before='-infinity'");await setRole('service_role');run=await value('public.service_claim_discord_role_sync($1)',[token]);return run;};
 const read=()=>value('public.service_read_discord_role_sync($1,$2)',[run.runId,target]);
 await t.test('claim requires the opaque scheduler credential and allows only one active lease',async()=>{await setRole('service_role');await assert.rejects(value('public.service_claim_discord_role_sync($1)',['b'.repeat(64)]),/authorization/);await claim();assert.equal(await value('public.service_claim_discord_role_sync($1)',[token]),null);assert.deepEqual(await value('public.service_read_discord_role_sync($1)',[run.runId]),[target]);assert.equal((await read()).desiredRoleId,a);});
 await t.test('suspension with enabled allowlist, pending membership and identity changes cannot grant',async()=>{
  await setRole();await db.exec("update public.staff_memberships set status='suspended' where role_key='moderator'");assert.equal((await read()).desiredRoleId,null);
  await db.exec("update public.staff_memberships set status='active';update private.discord_owner_allowlist set enabled=false");assert.equal((await read()).desiredRoleId,null);
  await db.exec("update private.discord_owner_allowlist set enabled=true,role_key='support'");assert.equal((await read()).desiredRoleId,null);
  await db.exec(`update private.discord_owner_allowlist set role_key='moderator';insert into auth.identities(user_id,provider,provider_id) values('${member}','google','other')`);assert.equal((await read()).desiredRoleId,null);
  await db.exec("delete from auth.identities where provider='google'");assert.equal((await read()).desiredRoleId,a);
 });
 await t.test('active account bans remove desired authority without requiring a staff-membership edit',async()=>{
  await setRole();await db.query("insert into public.security_bans(user_id,target_type) values($1,'account')",[member]);
  await setRole('service_role');assert.equal((await read()).desiredRoleId,null);
  await setRole();assert.equal(await value("status from public.staff_memberships where role_key='moderator'"),'active');assert.equal(await value('enabled from private.discord_owner_allowlist'),true);
  for(const update of ["ends_at=now()-interval '1 second'","ends_at=null,revoked_at=now()","revoked_at=null,starts_at=now()+interval '1 day'","starts_at=now(),target_type='device'","target_type='network_prefix'"]){
   await setRole();await db.exec('update public.security_bans set '+update);await setRole('service_role');assert.equal((await read()).desiredRoleId,a);
  }
  await setRole();await db.exec('delete from public.security_bans');
 });
 await t.test('mapping changes fence active jobs and retain previous roles for cleanup',async()=>{
  await setRole('authenticated');await configure({moderator:b},1);await setRole('service_role');await assert.rejects(read(),/Expired or disabled/);
  await assert.rejects(value('public.service_record_discord_role_sync($1,$2,$3,null,300)',[run.runId,target,'unchanged']),/Expired/);
  await claim();const state=await read();assert.equal(state.desiredRoleId,b);assert.deepEqual(state.managedRoleIds.sort(),[a,b]);
 });
 await t.test('deleting a mapping retains cleanup IDs and makes the desired role empty',async()=>{await setRole('authenticated');await configure({},2);await claim();const state=await read();assert.equal(state.desiredRoleId,null);assert.deepEqual(state.managedRoleIds.sort(),[a,b]);});
 await t.test('external unlink/deletion and allowlist deletion keep the tombstone eligible for removal',async()=>{
  await setRole();await db.exec(`delete from auth.users where id='${member}';delete from private.discord_owner_allowlist where discord_user_id='${target}'`);await claim();assert.equal((await read()).desiredRoleId,null);assert.deepEqual(await value('public.service_read_discord_role_sync($1)',[run.runId]),[target]);
 });
 await t.test('unknown roles are not recordable; rate limit persists a global backoff without exposing a secret',async()=>{
  await assert.rejects(value('public.service_record_discord_role_sync($1,$2,$3,$4,300)',[run.runId,target,'added',protect]),/outside approved/);
  await value('public.service_record_discord_role_sync($1,$2,$3,null,42)',[run.runId,target,'rate_limited']);await setRole();assert.ok(await value('not_before>clock_timestamp() from private.discord_role_sync_control'));
  await setRole('authenticated');const status=await value('public.staff_discord_role_sync_control()');assert.ok(!JSON.stringify(status).includes(token));assert.ok(status.recentEvents.some(e=>e.event==='rate_limited'));
  assert.equal(status.schedulerEnabled,false);assert.equal(status.trackedMembers,1);assert.ok(status.lastCheckedAt);
  await setRole();await db.exec("update cron.job set active=true");await setRole('authenticated');assert.equal((await value('public.staff_discord_role_sync_control()')).schedulerEnabled,true);
 });
 }finally{await db.close();}
});
