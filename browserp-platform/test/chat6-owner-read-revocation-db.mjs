// Disposable PostgreSQL only: proves the production-baseline gaps, then tests
// the additive fix. No hosted rows, real identities, or network access.
import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
const {PGlite}=await import(process.env.PGLITE_MODULE ? pathToFileURL(process.env.PGLITE_MODULE).href : '@electric-sql/pglite');
const read=name=>readFileSync(new URL('../supabase/migrations/'+name,import.meta.url),'utf8');
const fn=(source,name)=>source.match(new RegExp(`create or replace function ${name.replaceAll('.', '\\.')}\\([\\s\\S]*?\\n\\$\\$;`))[0];
const member='00000000-0000-4000-8000-000000000001',other='00000000-0000-4000-8000-000000000002',published='00000000-0000-4000-8000-000000000003',staff='00000000-0000-4000-8000-000000000004';
const sid='aaaaaaaa-0000-4000-8000-000000000001',foreignSid='aaaaaaaa-0000-4000-8000-000000000002',staffSid='aaaaaaaa-0000-4000-8000-000000000004';
const tables=['servers','reviews','developer_profiles','developer_services','resources','blog_posts','server_tags','server_categories'];
const policyNames=['servers_public_read','reviews_public_read','developers_public_read','services_public_read','resources_public_read','blog_public_read','server_tags_public_read','server_categories_public_read'];
const db=new PGlite();
const admin=async sql=>{await db.exec('reset role');if(sql)await db.exec(sql);};
const login=async({id=member,session=sid,aal='aal1'}={})=>{
 await admin();await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)",[id||'',JSON.stringify({sub:id,session_id:session,aal,app_metadata:{provider:'discord'},amr:[{method:'oauth'},...(aal==='aal2'?[{method:'totp'}]:[])]})]);
 await db.exec(`set role ${id?'authenticated':'anon'}`);
};
const visible=async table=>{
 const key=table==='developer_profiles'?'user_id':table.startsWith('server_')?'server_id':'id';
 return (await db.query(`select ${key}::text id from public.${table} order by ${key}`)).rows.map(row=>row.id);
};
const assertAll=async expected=>{for(const table of tables)assert.deepEqual(await visible(table),expected,table);};

test('Chat6 owner reads honor session validity and existing profile visibility',async t=>{
 try{
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create schema private;revoke all on schema private from public;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
 create table auth.users(id uuid,deleted_at timestamptz,is_anonymous boolean default false);
 create table auth.sessions(id uuid,user_id uuid,not_after timestamptz);
 create table auth.identities(user_id uuid,provider text,provider_id text,identity_data jsonb);
 create table public.staff_memberships(user_id uuid,status text,role_key text);
 create table private.discord_owner_allowlist(discord_user_id text,enabled boolean,role_key text);
 create table public.security_bans(user_id uuid,target_type text,revoked_at timestamptz,starts_at timestamptz,ends_at timestamptz);
 create table private.platform_security_settings(singleton boolean,staff_mfa_required boolean);
 create table public.staff_permission_overrides(user_id uuid,permission_key text,allowed boolean);
 create table public.staff_role_permissions(role_key text,permission_key text);
 insert into auth.users(id) values('${member}'),('${other}'),('${published}'),('${staff}');
 insert into auth.sessions values('${sid}','${member}',null),('${foreignSid}','${other}',null),('${staffSid}','${staff}',null);
 insert into auth.identities values('${staff}','discord','synthetic-staff','{}');
 insert into public.staff_memberships values('${staff}','active','auditor');
 insert into private.discord_owner_allowlist values('synthetic-staff',true,'auditor');
 insert into private.platform_security_settings values(true,true);
 insert into public.staff_role_permissions values('auditor','servers.review'),('auditor','moderation.read'),('auditor','developers.verify');
 create table public.profiles(id uuid,display_name text,username text,avatar_review_status text,approved_avatar_url text,profile_visibility text);
 create table public.platforms(id text,name text,enabled boolean);
 create table public.developer_profiles(user_id uuid,status text,headline text,specialties text[],portfolio_url text,verified boolean,created_at timestamptz);
 create table public.resources(id uuid,status text,author_id uuid,platform_id text,title text,slug text,summary text,resource_type text,download_count int,published_at timestamptz);
 create table public.servers(id uuid,status text,owner_id uuid,age_rating text);
 create table public.reviews(id uuid,status text,author_id uuid);
 create table public.developer_services(id uuid,status text,developer_id uuid);
 create table public.blog_posts(id uuid,status text,author_id uuid);
 create table public.server_tags(server_id uuid,tag text);
 create table public.server_categories(server_id uuid,category_id uuid);
 insert into public.profiles values('${member}','Synthetic private owner','synthetic-a','approved',null,'private'),('${other}','Synthetic other','synthetic-b','approved',null,'private'),('${published}','Synthetic public','synthetic-p','approved',null,'public');
 `);
 await db.exec(read('20260905195616_enforce_auth_session_expiry.sql'));
 const guards=read('20260904092528_enforce_member_security_boundaries.sql');
 for(const name of ['private.member_access_allowed','public.has_staff_permission'])await db.exec(fn(guards,name));
 const core=read('202608180001_browserp_core.sql');
 for(let i=0;i<tables.length;i++){
  await db.exec(`alter table public.${tables[i]} enable row level security;grant select on public.${tables[i]} to anon,authenticated;`);
  await db.exec(core.match(new RegExp(`create policy ${policyNames[i]}[^;]*;`))[0]);
 }
 for(const [id,status] of [[member,'draft'],[other,'draft'],[published,'published']]){
  await db.query('insert into public.developer_profiles values($1,$2,$3,array[]::text[],null,false,now())',[id,status,'Synthetic headline']);
  await db.query('insert into public.resources values($1,$2,$1,null,$3,$3,$3,$3,0,now())',[id,status,'Synthetic resource']);
  for(const [table,field]of[['servers','owner_id'],['reviews','author_id'],['developer_services','developer_id'],['blog_posts','author_id']])await db.query(`insert into public.${table}(id,status,${field}${table==='servers'?',age_rating':''})values($1,$2,$1${table==='servers'?",'teen'":''})`,[id,status]);
  await db.query("insert into public.server_tags values($1,'synthetic')",[id]);await db.query('insert into public.server_categories values($1,$1)',[id]);
 }
 const projection=read('20260906012500_restrict_private_record_reads.sql');
 for(const view of ['developer_directory','resource_directory']){
  await db.exec(projection.match(new RegExp(`create or replace view public.${view}[\\s\\S]*?;`))[0]);await db.exec(`grant select on public.${view} to anon,authenticated`);
 }
 await t.test('baseline reproduces revoked owner read in all eight policy paths',async()=>{
  await admin(`delete from auth.sessions where id='${sid}'`);await login();await assertAll([member,published]);
 });
 await t.test('baseline direct published reads bypass the existing private-profile projections',async()=>{
  await admin(`update public.developer_profiles set status='published' where user_id='${member}';update public.resources set status='published' where id='${member}'`);await login({id:null});
  for(const table of ['developer_profiles','resources'])assert.deepEqual(await visible(table),[member,published]);
  for(const view of ['developer_directory','resource_directory'])assert.deepEqual((await db.query(`select id::text id from public.${view}`)).rows.map(row=>row.id),[published]);
  await admin(`update public.developer_profiles set status='draft' where user_id='${member}';update public.resources set status='draft' where id='${member}'`);
 });
 await admin(read('20260908104226_chat6_private_listing_read_boundaries.sql'));
 await t.test('the same revoked token loses private reads while all published public rows remain',async()=>{await login();await assertAll([published]);});
 await t.test('active owner keeps own drafts and cannot read another owner drafts',async()=>{
  await admin(`insert into auth.sessions values('${sid}','${member}',null)`);await login();await assertAll([member,published]);
 });
 await t.test('guest and foreign, malformed, or missing sessions cannot read private rows',async()=>{
  await login({id:null});await assertAll([published]);
  for(const session of [foreignSid,'invalid',null]){await login({session});await assertAll([published]);}
 });
 await t.test('expired, banned, deleted, and anonymous accounts lose private owner reads',async()=>{
  for(const [change,restore]of[
   [`update auth.sessions set not_after=now()-interval '1 second' where id='${sid}'`,`update auth.sessions set not_after=null where id='${sid}'`],
   [`insert into public.security_bans values('${member}','account',null,now(),null)`,'delete from public.security_bans'],
   [`update auth.users set deleted_at=now() where id='${member}'`,`update auth.users set deleted_at=null where id='${member}'`],
   [`update auth.users set is_anonymous=true where id='${member}'`,`update auth.users set is_anonymous=false where id='${member}'`]
  ]){await admin(change);await login();await assertAll([published]);await admin(restore);}
 });
 await t.test('staff without MFA is denied private rows; verified staff retains review access',async()=>{
  await login({id:staff,session:staffSid});await assertAll([published]);
  await login({id:staff,session:staffSid,aal:'aal2'});await assertAll([member,other,published]);
  await admin(`delete from auth.sessions where id='${staffSid}'`);await login({id:staff,session:staffSid,aal:'aal2'});await assertAll([published]);
 });
 await t.test('raw developer and resource reads follow private, members, and public profile choices',async()=>{
  await admin(`update public.developer_profiles set status='published' where user_id='${member}';update public.resources set status='published' where id='${member}'`);
  for(const visibility of ['private','members']){
   await admin(`update public.profiles set profile_visibility='${visibility}' where id='${member}'`);await login({id:null});
   for(const table of ['developer_profiles','resources'])assert.deepEqual(await visible(table),[published]);
   await login({id:other,session:foreignSid});
   for(const table of ['developer_profiles','resources'])assert.deepEqual(await visible(table),[other,published]);
   await login();for(const table of ['developer_profiles','resources'])assert.deepEqual(await visible(table),[member,published]);
   await login({id:null});for(const view of ['developer_directory','resource_directory'])assert.deepEqual((await db.query(`select id::text id from public.${view}`)).rows.map(row=>row.id),[published]);
  }
  await admin(`update public.profiles set profile_visibility='public' where id='${member}'`);await login({id:null});
  for(const table of ['developer_profiles','resources'])assert.deepEqual(await visible(table),[member,published]);
  for(const view of ['developer_directory','resource_directory'])assert.deepEqual((await db.query(`select id::text id from public.${view} order by id`)).rows.map(row=>row.id),[member,published]);
 });
 await t.test('the helpers disclose booleans only, preserve private raw ACLs, and never permit writes',async()=>{
  await login({id:null});assert.equal((await db.query('select public.member_table_read_allowed() allowed')).rows[0].allowed,false);
  assert.equal((await db.query('select public.profile_is_public($1) allowed',[staff])).rows[0].allowed,false);
  await assert.rejects(db.query('select * from public.profiles'),/permission denied/);await assert.rejects(db.query('select private.member_access_allowed()'),/permission denied/);
  for(const role of ['anon','authenticated']){await admin();await db.exec(`set role ${role}`);await assert.rejects(db.query("update public.servers set status='published'"),/permission denied/);}
  await admin();const acl=(await db.query("select has_function_privilege('service_role','public.member_table_read_allowed()','EXECUTE') a,has_function_privilege('service_role','public.profile_is_public(uuid)','EXECUTE') b")).rows[0];assert.deepEqual(acl,{a:false,b:false});
 });
 }finally{await db.close();}
});
