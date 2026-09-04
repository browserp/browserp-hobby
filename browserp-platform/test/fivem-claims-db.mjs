// Disposable PostgreSQL coverage. No production connection, users or claims.
// Run: node --test test/fivem-claims-db.mjs (or set PGLITE_MODULE to the installed module).
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { normalizeFiveMServer } from '../lib/fivem-import.js';
import { candidateForStorage } from '../lib/fivem-workflow.js';
const { PGlite } = await import(process.env.PGLITE_MODULE ? pathToFileURL(process.env.PGLITE_MODULE).href : '@electric-sql/pglite');
const db = new PGlite();
const base = resolve(import.meta.dirname, '../supabase/migrations');
const read = (path) => readFileSync(resolve(base, path), 'utf8');
const core = read('202608180001_browserp_core.sql');
const ops = read('20260819192413_platform_operations_and_trust.sql');
const migration = read('20260904002113_fivem_imports_and_server_claims.sql');
const fn = (sql, name) => sql.match(new RegExp(`create or replace function ${name.replaceAll('.', '\\.')}\\([\\s\\S]*?\\n\\$\\$;`))[0];
const owner = '00000000-0000-4000-8000-000000000001';
const admin = '00000000-0000-4000-8000-000000000002';
const member = '00000000-0000-4000-8000-000000000003';
const other = '00000000-0000-4000-8000-000000000004';
const google = '00000000-0000-4000-8000-000000000005';
const discordMember = '333333333333333333';
const guild = '555555555555555555';
const request = () => crypto.randomUUID();
let published;
let staged;
let firstClaim;
let secondClaim;
const candidate = (code = '6myr996') => ({joinCode:code,name:'North American Roleplay',description:'A welcoming roleplay community featuring player businesses, public services and shared stories.',region:'North America',language:'English',framework:'QBCore',accessType:'allowlisted',discordUrl:'https://discord.gg/legitimate',websiteUrl:'https://example.com',joinUrl:`https://cfx.re/join/${code}`,tags:['roleplay','player-owned-businesses'],keywords:['economy','custom cars'],logoUrl:null,bannerUrl:null,players:12,capacity:64,online:true,checkedAt:new Date().toISOString(),warnings:[{code:'region_inferred',field:'region',severity:'warning',message:'Check the inferred region.'}],evidence:[{field:'joinUrl',source:'EndPoint',value:code,confidence:'high'}],sourceUrl:`https://servers-frontend.fivem.net/api/servers/single/${code}`});
async function login(id = owner, aal = 'aal2') {
 await db.exec('reset role');
 await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)",[id,JSON.stringify({sub:id,app_metadata:{provider:id===google?'google':'discord'},aal,amr:[{method:'oauth'},...(aal==='aal2'?[{method:'totp'}]:[])]})]);
 await db.exec('set role authenticated');
}
async function service() { await db.exec('reset role;set role service_role'); }
async function rpc(sql, args = []) { return (await db.query(`select ${sql} value`,args)).rows[0].value; }
async function stage(data = candidate(), actor = owner) { await service(); return rpc('public.service_stage_fivem_candidate($1::uuid,$2::jsonb,$3)',[actor,JSON.stringify(data),request()]); }
async function publish(c, data = {}, id = request()) { return rpc('public.staff_publish_fivem_candidate($1::uuid,$2::bigint,$3::jsonb,$4,$5)',[c.id,c.version,JSON.stringify(data),'Reviewed the source and corrected its fields',id]); }
async function claim(serverId = published.serverId, id = request()) { return rpc('public.member_server_claim($1::uuid,$2,$3,$4)',[serverId,'I own and operate this server and its community.','https://example.com/ownership',id]); }
async function verify(c = firstClaim, isOwner = true, opts = {}) { await service(); return rpc('public.service_verify_server_claim($1::uuid,$2::uuid,$3,$4,$5,$6::boolean,$7,$8)',[c.id,opts.userId||member,opts.discordId||discordMember,guild,opts.invite||'https://discord.gg/legitimate',isOwner,'Roleplay community',opts.status||null]); }
async function claims(status = 'pending', verification = 'all') { return rpc('public.staff_server_claims($1,$2,$3,$4,$5)',[status,verification,'',25,0]); }
async function decide(c, decision = 'approve', id = request()) { return rpc('public.staff_decide_server_claim($1::uuid,$2::bigint,$3,$4,$5)',[c.id,c.version,decision,'Ownership evidence reviewed by the site team',id]); }

test('FiveM imports and claim requests enforce real PostgreSQL trust boundaries', async (t) => {
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create schema private;create schema extensions;create schema storage;
 revoke all on schema private from public;grant usage on schema auth to authenticated;
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
 create function extensions.gen_random_uuid() returns uuid language sql as $$select pg_catalog.gen_random_uuid()$$;
 create table auth.users(id uuid primary key,deleted_at timestamptz,is_anonymous boolean default false);
 create table auth.identities(user_id uuid,provider text,provider_id text,identity_data jsonb default '{}');
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 `);
 for (const name of ['platforms','profiles','staff_roles','permissions','staff_role_permissions','staff_memberships','servers','server_tags','server_status_snapshots','staff_audit_events','boosts','tool_events']) await db.exec(core.match(new RegExp(`create table public\\.${name} \\([\\s\\S]*?\\n\\);`))[0]);
 await db.exec(ops.match(/create table if not exists public\.security_bans \([\s\S]*?\n\);/)[0]);
 await db.exec(`alter table public.servers add access_type text not null default 'public' constraint servers_access_type_check check(access_type in ('public','allowlisted','application')),add cfx_join_url text,add moderation_version bigint not null default 1;
 create function private.bump_moderation_version() returns trigger language plpgsql as $$begin new.moderation_version:=old.moderation_version+1;return new;end$$;
 create trigger servers_moderation_version before update on public.servers for each row execute function private.bump_moderation_version();
 create table public.staff_permission_overrides(user_id uuid,permission_key text,allowed boolean);
 create table private.discord_owner_allowlist(discord_user_id text primary key,role_key text,enabled boolean);
 create table private.platform_security_settings(singleton boolean,staff_mfa_required boolean);
 insert into private.platform_security_settings values(true,true);
 insert into public.staff_roles values('owner','Owner','Owner role',1000,true),('administrator','Administrator','Admin role',800,true);
 insert into auth.users(id) values('${owner}'),('${admin}'),('${member}'),('${other}'),('${google}');
 insert into public.profiles(id,username,display_name) values('${owner}','owner','Owner'),('${admin}','admin','Administrator'),('${member}','member','Member'),('${other}','other','Other member'),('${google}','google','Google member');
 insert into public.staff_memberships(user_id,role_key,reason) values('${owner}','owner','Test owner'),('${admin}','administrator','Test admin');
 insert into auth.identities(user_id,provider,provider_id) values('${owner}','discord','111111111111111111'),('${admin}','discord','222222222222222222'),('${member}','discord','${discordMember}'),('${other}','discord','444444444444444444'),('${google}','google','google-user');
 insert into private.discord_owner_allowlist values('111111111111111111','owner',true),('222222222222222222','administrator',true);
 insert into public.platforms(id,name,short_name) values('fivem','FiveM','FiveM');
 `);
 await db.exec(fn(ops,'public.has_staff_permission'));
 try { await db.exec(migration); } catch (error) { console.error({position:error.position,detail:error.detail,where:error.where,context:migration.slice(Math.max(0,Number(error.position)-180),Number(error.position)+180)}); await db.close(); throw error; }
 await db.exec(read('20260904003147_searchable_import_keywords.sql'));
 await db.exec(read(readdirSync(base).find(name => name.endsWith('_tailored_game_discovery_filters.sql'))));
 await db.exec(read('20260904005311_imported_server_unknown_access.sql'));
 await db.exec(read('20260904010316_public_import_website_link.sql'));
 await db.exec(fn(ops,'public.attach_server_submission_metadata_server'));
 await db.exec('revoke all on function public.attach_server_submission_metadata_server(uuid,uuid,text[],text,text,text) from public;grant execute on function public.attach_server_submission_metadata_server(uuid,uuid,text[],text,text,text) to service_role');

 await t.test('anonymous users, ordinary members, insufficient MFA and direct proof forgery are denied', async () => {
  await db.exec('set role anon');
  await assert.rejects(rpc('public.staff_fivem_candidates()'),/permission denied/);
  await assert.rejects(rpc('public.member_server_claims()'),/permission denied/);
  await login(member);
  await assert.rejects(rpc('public.staff_fivem_candidates()'),/permission required/);
  await assert.rejects(rpc('public.service_stage_fivem_candidate($1::uuid,$2::jsonb,$3)',[owner,JSON.stringify(candidate()),request()]),/permission denied/);
  await assert.rejects(rpc('public.service_verify_server_claim(null,null,null,null,null,true)'),/permission denied/);
  await assert.rejects(db.query('insert into public.server_claim_requests(server_id,claimant_id,message,request_id,verification_status) values(gen_random_uuid(),$1,$2,$3,$4)',[member,'Pretending to own a server',request(),'verified']),/permission denied/);
  await login(owner,'aal1');
  await assert.rejects(rpc('public.staff_fivem_candidates()'),/permission required/);
  await assert.rejects(stage(candidate(),member),/permission required/);
 });

 await t.test('candidate validation rejects mixed-up links, raw fields and false player values', async () => {
  await assert.rejects(stage({...candidate(),joinUrl:'https://discord.gg/legitimate'}),/join link/);
  await assert.rejects(stage({...candidate(),discordUrl:'https://cfx.re/join/6myr996'}),/Discord field/);
  await assert.rejects(stage({...candidate(),tags:['https://discord.gg/legitimate']}),/Tags and keywords/);
  await assert.rejects(stage({...candidate(),players:100,capacity:64}),/exceeds capacity/);
  await assert.rejects(stage({...candidate(),rawVars:{ip:'192.0.2.1'}}),/Unexpected FiveM/);
  await assert.rejects(stage({...candidate(),evidence:[{field:'players',rawPlayers:['PRIVATE']}]}),/Unexpected source evidence/);
  await assert.rejects(stage({...candidate(),sourceUrl:'https://evil.example/candidate'}),/source URL/);
  const normalized=normalizeFiveMServer({EndPoint:'dtotst7',Data:{hostname:'Full DTO integration',clients:2,svMaxclients:64,lastSeen:new Date().toISOString(),resources:['qb-core'],vars:{gamename:'gta5',sv_projectDesc:'This real normalized source is checked against the SQL staging contract.',tags:'roleplay,economy,custom cars',locale:'en-US',sv_appearAllowlisted:'false',discord:'https://discord.gg/real_test'}}});
  const integrated=await stage(candidateForStorage(normalized));assert.equal(integrated.candidate.evidence.find(item=>item.field==='tags').value.length,3);assert.ok(integrated.candidate.sourceUrl.startsWith('https://frontend.cfx-services.net/'));
  staged=await stage();
  assert.equal(staged.joinCode,'6myr996');assert.equal(staged.status,'pending');
  assert.equal(staged.candidate.language,'English');assert.equal(staged.candidate.framework,'QBCore');
 });

 await t.test('reviewed publishing preserves metadata order, vetted media, tags and seven-character source identity', async () => {
  await login();
  assert.equal((await rpc('public.staff_fivem_candidate($1::uuid)',[staged.id])).joinCode,staged.joinCode);
  await assert.rejects(publish(staged,{logoUrl:'https://evil.example/unreviewed.png'}),/approved server media/);
  await assert.rejects(publish(staged,{language:null}),/Review the name/);
  await assert.rejects(publish(staged,{ownerId:member}),/Unexpected reviewed field/);
  const id=request();
  published=await publish(staged,{language:'French',framework:'ESX',keywords:['economy','custom cars','moonquartz'],logoUrl:'https://kywabzfgjoqiznnxygbq.supabase.co/storage/v1/object/public/server-media/6myr996/abcdef0123456789.png'},id);
  assert.equal(published.status,'published');assert.ok(published.slug.endsWith('6myr996'));
  assert.deepEqual(await publish(staged,{},id),published);
  await assert.rejects(publish(staged),/candidate changed/);
  await db.exec('reset role');
  const row=(await db.query('select * from public.servers where id=$1',[published.serverId])).rows[0];
  assert.equal(row.owner_id,null);assert.equal(row.language,'French');assert.equal(row.framework,'ESX');assert.equal(row.verified,false);
  assert.equal(row.community_url,'https://discord.gg/legitimate');assert.equal(row.cfx_join_url,'https://cfx.re/join/6myr996');
  assert.equal((await db.query('select count(*) n from public.server_tags where server_id=$1',[row.id])).rows[0].n,2);
  await db.exec('set role anon');
  const info=await rpc('public.public_server_import_details($1::uuid[])',[[row.id]]);
  assert.equal(info[0].claimable,true);assert.equal(info[0].imported,true);assert.ok(info[0].logoUrl.includes('/server-media/'));
  assert.equal(JSON.stringify(info).includes('created_by'),false);
 });

 await t.test('claims expose only the signed-in member history and never accept client verification', async () => {
  await login(member);firstClaim=await claim();
  assert.equal(firstClaim.verificationStatus,'pending_check');
  assert.equal(firstClaim.status,'pending');assert.equal((await claim()).id,firstClaim.id);
  assert.equal((await rpc('public.member_server_claims()')).items.length,1);
  await assert.rejects(claim(published.serverId,'x'),/Explain your connection/);
  await login(other);assert.equal((await rpc('public.member_server_claims()')).items.length,0);
  secondClaim=await claim();assert.notEqual(secondClaim.id,firstClaim.id);
  await assert.rejects(claims(),/Claim-review permission required/);
  await login(google);const c=await claim();assert.equal(c.verificationStatus,'needs_discord');
  await login();assert.equal((await claims()).total,3);
 });

 await t.test('Discord proof must match the claimant identity and exact stored invite and still awaits review', async () => {
  await assert.rejects(verify(firstClaim,true,{discordId:'111111111111111111'}),/identity does not match/);
  await assert.rejects(verify(firstClaim,true,{userId:other}),/Claimant does not match/);
  await assert.rejects(verify(firstClaim,true,{invite:'https://discord.gg/different'}),/invite changed/);
  let checked=await verify(firstClaim,false);assert.equal(checked.verificationStatus,'not_owner');
  checked=await verify(firstClaim,null,{status:'unavailable'});assert.equal(checked.verificationStatus,'unavailable');
  firstClaim=await verify(firstClaim,true);assert.equal(firstClaim.verificationStatus,'verified');assert.equal(firstClaim.status,'pending');assert.ok(firstClaim.verifiedAt);
  await login();assert.equal((await claims('pending','verified')).total,1);
  await db.exec('reset role');await db.query('update public.servers set community_url=$1 where id=$2',['https://discord.gg/replaced',published.serverId]);
  await login();assert.equal((await claims('pending','verified')).total,0);assert.equal((await claims('pending','unverified')).total,3);
  await login(member);assert.equal((await rpc('public.member_server_claims()')).items[0].verificationStatus,'unavailable');
  await assert.rejects(verify(firstClaim,true),/invite changed/);
  firstClaim=await verify(firstClaim,true,{invite:'https://discord.gg/replaced'});assert.equal(firstClaim.verificationStatus,'verified');
  await login();assert.equal((await claims('pending','verified')).counts.verifiedPending,1);
  await db.exec('reset role');assert.equal((await db.query('select owner_id from public.servers where id=$1',[published.serverId])).rows[0].owner_id,null);
 });

 await t.test('versioned staff decisions assign one owner, preserve history and reject competing approvals', async () => {
  await login(member);await assert.rejects(decide(firstClaim),/Claim-review permission required/);
  await login();
  await assert.rejects(decide({...firstClaim,version:1}),/claim changed/);
  const id=request();const approved=await decide(firstClaim,'approve',id);assert.equal(approved.status,'approved');
  assert.deepEqual(await decide(firstClaim,'approve',id),approved);
  await assert.rejects(decide(secondClaim),/claim changed/);
  const history=await claims('all');assert.equal(history.counts.approved,1);assert.equal(history.counts.superseded,2);
  await db.exec('reset role');const row=(await db.query('select owner_id,moderation_version from public.servers where id=$1',[published.serverId])).rows[0];
  assert.equal(row.owner_id,member);assert.ok(row.moderation_version>1);
  await login(other);await assert.rejects(claim(),/already has an owner/);
  await service();await assert.rejects(verify(firstClaim,true),/already reviewed/);
 });

 await t.test('refresh leases and snapshots update live counts without changing claimed metadata', async () => {
  await db.exec('reset role');await db.query("update public.server_import_sources set next_refresh_at=now()-interval '1 second' where server_id=$1",[published.serverId]);
  await service();
  const sources=await rpc('public.service_fivem_sources($1::uuid,true,25)',[published.serverId]);assert.equal(sources.length,1);assert.equal(sources[0].joinCode,'6myr996');
  assert.equal(await rpc('public.service_mark_fivem_unavailable($1)',['6myr996']),true);
  assert.equal((await rpc('public.public_server_import_details($1::uuid[])',[[published.serverId]]))[0].statusUnavailable,true);
  await db.exec('reset role');await db.query("update public.server_import_sources set next_refresh_at=now()-interval '1 second' where server_id=$1",[published.serverId]);await service();
  assert.equal(await rpc('public.service_claim_fivem_refresh($1)',['6myr996']),true);
  assert.equal(await rpc('public.service_claim_fivem_refresh($1)',['6myr996']),false);
  assert.equal(await rpc('public.service_claim_fivem_refresh($1)',['unknown']),false);
  const observed=new Date(Date.now()+1000).toISOString();
  const fresh=await rpc('public.service_refresh_fivem_snapshot($1,true,25,64,$2::timestamptz)',['6myr996',observed]);assert.equal(fresh.players,25);
  assert.equal((await rpc('public.public_server_import_details($1::uuid[])',[[published.serverId]]))[0].statusUnavailable,false);
  assert.equal((await rpc('public.service_refresh_fivem_snapshot($1,true,25,64,$2::timestamptz)',['6myr996',observed])).unchanged,true);
  await assert.rejects(rpc('public.service_refresh_fivem_snapshot($1,true,null,64,now())',['6myr996']),/verified player observation/);
  await assert.rejects(rpc("public.service_refresh_fivem_snapshot($1,true,12,64,now()-interval '1 day')",['6myr996']),/verified player observation/);
  staged=await stage({...candidate(),name:'Upstream changed name'});
  await login();await assert.rejects(publish(staged),/already has an owner/);
  await db.exec('reset role');assert.equal((await db.query('select name,language,framework from public.servers where id=$1',[published.serverId])).rows[0].name,'North American Roleplay');
 });

 await t.test('unknown live counts stay unknown and duplicate existing owner listings cannot be republished', async () => {
  const unknown=await stage({...candidate('7bb4dpe'),players:null,capacity:null,online:null,checkedAt:null});
  await login();const next=await publish(unknown);
  await db.exec('reset role');assert.equal((await db.query('select count(*) n from public.server_status_snapshots where server_id=$1',[next.serverId])).rows[0].n,0);
  await db.query('insert into public.servers(owner_id,platform_id,name,slug,description,region,language,cfx_join_url,status) values($1,$2,$3,$4,$5,$6,$7,$8,$9)',[other,'fivem','Owner registered listing','owner-registered-listing','An existing owner submitted this community and it must never be replaced.','Europe','English','https://cfx.re/join/abc1234','published']);
  const duplicate=await stage(candidate('abc1234'));assert.ok(duplicate.serverId);
  await login();await assert.rejects(publish(duplicate),/already has an owner/);
  const page=await rpc('public.staff_fivem_candidates($1,$2,1,0)',['all','roleplay']);assert.equal(page.items.length,1);assert.ok(page.total>=2);
 });

 await t.test('public online filters, facets and totals ignore stale imports before ranking', async () => {
  await db.exec('reset role');
  const nonimport=(await db.query("select id from public.servers where slug='owner-registered-listing'")).rows[0].id;
  await db.query("insert into public.server_status_snapshots(server_id,online,players,capacity,checked_at) values($1,true,3,32,now()-interval '1 day')",[nonimport]);
  await db.query("update public.server_import_sources set last_checked_at=now()-interval '6 minutes',last_error_at=null where server_id=$1",[published.serverId]);
  await db.query("update public.server_status_snapshots set checked_at=now()-interval '6 minutes' where server_id=$1",[published.serverId]);
  await db.exec('set role anon');
  const filtered=await rpc('public.search_public_directory($1::jsonb)',[JSON.stringify({online:true})]);
  assert.equal(filtered.total,1);assert.equal(filtered.servers[0].id,nonimport);assert.equal(filtered.facets.online[0].count,1);
  const legacy=await rpc('public.search_server_directory($1,$2,$3,$4,true,false,false,$5,30)',[null,'','all','all','players']);assert.equal(legacy.length,1);assert.equal(legacy[0].id,nonimport);
  const totals=await rpc('public.public_overview()');assert.equal(totals.online,1);assert.equal(totals.players,3);
  const all=await rpc('public.search_public_directory($1::jsonb)',[JSON.stringify({sort:'players'})]);const old=all.servers.find(row=>row.id===published.serverId);assert.equal(old.online,false);assert.equal(old.players,null);
  await service();await rpc('public.service_refresh_fivem_snapshot($1,true,30,64,now())',['6myr996']);
  await db.exec('set role anon');assert.equal((await rpc('public.public_overview()')).players,33);
  await service();await rpc('public.service_mark_fivem_unavailable($1)',['6myr996']);
  await db.exec('set role anon');assert.equal((await rpc('public.public_overview()')).players,3);
 });

 await t.test('reviewed import keywords participate in both public searches without bypassing filters', async () => {
  await db.exec('set role anon');
  const smart=await rpc('public.search_public_directory($1::jsonb)',[JSON.stringify({query:'moonquartz',platform:'fivem',language:'French'})]);
  assert.equal(smart.total,1);assert.equal(smart.servers[0].id,published.serverId);
  assert.equal(/moonquartz/i.test([smart.servers[0].name,smart.servers[0].description,...smart.servers[0].tags].join(' ')),false);
  assert.equal((await rpc('public.search_public_directory($1::jsonb)',[JSON.stringify({query:'moonquartz',platform:'minecraft'})])).total,0);
  assert.equal((await rpc('public.search_public_directory($1::jsonb)',[JSON.stringify({query:'moonquartz',language:'English'})])).total,0);
  const legacy=await rpc('public.search_server_directory($1,$2,$3,$4,false,false,false,$5,30)',[null,'moonquartz','fivem','all','recommended']);
  assert.equal(legacy.length,1);assert.equal(legacy[0].id,published.serverId);
  const excluded=await rpc('public.search_server_directory($1,$2,$3,$4,false,false,false,$5,30)',[null,'moonquartz','minecraft','all','recommended']);assert.equal(excluded.length,0);
  assert.equal(Object.hasOwn(legacy[0],'owner_id'),false);assert.equal(Object.hasOwn(smart.servers[0],'candidate'),false);
 });

 await t.test('unconfirmed imported access is explicit, searchable and never matches known access filters', async () => {
  const unresolved = await stage({...candidate('unkn0wn'),name:'Unresolved access roleplay',accessType:'unknown',players:null,capacity:null,online:null,checkedAt:null});
  await login();
  const result = await publish(unresolved);
  await db.exec('reset role');
  assert.equal((await db.query('select access_type from public.servers where id=$1',[result.serverId])).rows[0].access_type,'unknown');
  await assert.rejects(db.query('update public.servers set access_type=null where id=$1',[result.serverId]),/not-null constraint/);
  await assert.rejects(db.query("update public.servers set access_type='unrestricted' where id=$1",[result.serverId]),/servers_access_type_check/);
  await db.exec('set role anon');
  const search = access => rpc('public.search_public_directory($1::jsonb)',[JSON.stringify({query:'Unresolved access roleplay',platform:'fivem',access})]);
  const found = await search('all');
  assert.equal(found.total,1);assert.equal(found.servers[0].id,result.serverId);assert.equal(found.servers[0].access_type,'unknown');
  assert.ok(found.facets.access.some(item=>item.value==='unknown'&&item.count===1));
  assert.equal((await search('unknown')).total,1);
  for (const access of ['public','allowlisted','application']) assert.equal((await search(access)).total,0);
  await assert.rejects(stage({...candidate('badacc3'),accessType:'unrestricted'}),/Invalid access type/);
  const missing = await stage({...candidate('noacc33'),accessType:null});
  await login();await assert.rejects(publish(missing),/Review the name, description, region, language and access/);
  await service();
  await assert.rejects(rpc('public.attach_server_submission_metadata_server($1::uuid,$2::uuid,$3::text[],$4,$5,$6)',[member,request(),[],'unknown',null,'a'.repeat(64)]),/Invalid access type/);
 });

 await t.test('dismissal is audited, permission changes take effect and private source tables stay inaccessible', async () => {
  const discard=await stage(candidate('deadbe7'));await login();
  const dismissed=await rpc('public.staff_dismiss_fivem_candidate($1::uuid,$2::bigint,$3,$4)',[discard.id,discard.version,'This candidate does not meet listing requirements',request()]);assert.equal(dismissed.status,'dismissed');
  await assert.rejects(rpc('public.staff_dismiss_fivem_candidate($1::uuid,$2::bigint,$3,$4)',[discard.id,discard.version,'This candidate does not meet listing requirements',request()]),/candidate changed/);
  await db.exec('reset role');await db.query('insert into public.staff_permission_overrides values($1,$2,false)',[admin,'scrapers.manage']);
  await login(admin);await assert.rejects(rpc('public.staff_fivem_candidates()'),/permission required/);
  await assert.rejects(stage(candidate('abcdef7'),admin),/permission required/);
  await login(member);await assert.rejects(db.query('select * from public.server_import_sources'),/permission denied/);await assert.rejects(db.query('select * from public.server_claim_requests'),/permission denied/);
  await db.exec('reset role');assert.ok((await db.query("select count(*) n from public.staff_audit_events where action like 'fivem.import.%' or action like 'server.claim.%'")).rows[0].n>=4);
 });
 await t.test('public import details expose reviewed websites only for published listings', async () => {
  await db.exec('reset role');
  await db.query('update public.servers set website_url=$1 where id=$2',['https://community.example.org/',published.serverId]);
  await db.exec('set role anon');
  const details=await rpc('public.public_server_import_details($1::uuid[])',[[published.serverId]]);
  assert.equal(details[0].websiteUrl,'https://community.example.org/');
  assert.equal(Object.hasOwn(details[0],'candidate'),false);
  await db.exec('reset role');await db.query("update public.servers set status='archived' where id=$1",[published.serverId]);
  await db.exec('set role anon');
  assert.deepEqual(await rpc('public.public_server_import_details($1::uuid[])',[[published.serverId]]),[]);
 });
 await db.close();
});
