// Isolated PostgreSQL guards; no hosted data, IP addresses or decryption keys.
// Native two-session race proof: IP_REVEAL_POSTGRES_BIN=/path/to/postgres/bin
// node --test --test-concurrency=1 test/network-reveal-db.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { PGlite } from '@electric-sql/pglite';
const read = name => readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8');
const fn = (sql, name) => sql.match(new RegExp(`create or replace function ${name.replaceAll('.', '\\.')}\\([\\s\\S]*?\\n\\$\\$;`))[0];
const operations = read('20260819192413_platform_operations_and_trust.sql');
const guards = read('20260904092528_enforce_member_security_boundaries.sql');
const migration = read('20260907194044_atomically_consume_network_reveal.sql');
const owner = '00000000-0000-4000-8000-000000000001';
const requester = '00000000-0000-4000-8000-000000000002';
const other = '00000000-0000-4000-8000-000000000003';
const requestId = 'aaaaaaaa-0000-4000-8000-000000000001';
const fixture = `
create role anon;create role authenticated;create role service_role;create schema auth;create schema private;
revoke all on schema private from public;
create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
create table auth.users(id uuid,deleted_at timestamptz,is_anonymous boolean default false);
create table auth.sessions(id uuid,user_id uuid,not_after timestamptz);
create table auth.identities(user_id uuid,provider text,provider_id text,identity_data jsonb default '{}');
create table public.staff_memberships(user_id uuid,role_key text,status text);
create table public.staff_role_permissions(role_key text,permission_key text);
create table public.staff_permission_overrides(user_id uuid,permission_key text,allowed boolean);
create table private.discord_owner_allowlist(discord_user_id text,role_key text,enabled boolean);
create table private.platform_security_settings(singleton boolean,staff_mfa_required boolean);
create table public.security_bans(user_id uuid,target_type text,revoked_at timestamptz,starts_at timestamptz,ends_at timestamptz);
create table public.network_reveal_requests(id uuid primary key,activity_id bigint,requested_by uuid,status text,expires_at timestamptz,used_at timestamptz);
create table private.network_evidence(activity_id bigint primary key,network_ciphertext text);
create table public.staff_audit_events(actor_id uuid,action text,target_type text,target_id text,reason text,after_state jsonb);
alter table public.network_reveal_requests enable row level security;alter table private.network_evidence enable row level security;
insert into private.platform_security_settings values(true,true);
insert into public.staff_role_permissions values('owner','security.network.approve'),('owner','security.network.request'),('administrator','security.network.request');
${[owner, requester, other].map((id, index) => `
insert into auth.users(id) values('${id}');insert into auth.sessions values('${id}','${id}',null);
insert into auth.identities(user_id,provider,provider_id) values('${id}','discord','fixture-${index}');
insert into public.staff_memberships values('${id}','${index ? 'administrator' : 'owner'}','active');
insert into private.discord_owner_allowlist values('fixture-${index}','${index ? 'administrator' : 'owner'}',true);`).join('')}
insert into public.network_reveal_requests values('${requestId}',1,'${requester}','approved',now()+interval '10 minutes',null);
insert into private.network_evidence values(1,'FIXTURE_CIPHERTEXT');
${fn(read('20260905195616_enforce_auth_session_expiry.sql'), 'private.has_current_auth_session')}
${fn(guards, 'private.member_access_allowed')}
${fn(guards, 'public.has_staff_permission')}
revoke all on function private.has_current_auth_session(),private.member_access_allowed() from public;
${fn(operations, 'public.staff_network_reveal_evidence')}
revoke execute on function public.staff_network_reveal_evidence(bigint,uuid) from public,anon,service_role;
grant execute on function public.staff_network_reveal_evidence(bigint,uuid) to authenticated;
`;
const login = ({ id = requester, sid = id, aal = 'aal2', provider = 'discord', amr = [{ method: 'oauth' }, { method: 'totp' }] } = {}) =>
  `reset role;select set_config('request.jwt.claim.sub','${id}',false),set_config('request.jwt.claims','${JSON.stringify({ sub: id, session_id: sid, aal, app_metadata: { provider }, amr })}',false);set role authenticated;`;
const reveal = (activity = 1, id = requestId) => `select public.staff_network_reveal_evidence(${activity},${id ? `'${id}'` : 'null'});`;
const reset = `reset role;update public.network_reveal_requests set status='approved',expires_at=now()+interval '10 minutes',used_at=null;delete from public.staff_audit_events;`;

test('protected network reveal preserves authorization, expiry, owner policy and atomic audit', async t => {
  const db = new PGlite();t.after(() => db.close());await db.exec(fixture);await db.exec(migration);
  const state = async () => { await db.exec('reset role');return (await db.query('select status,used_at,(select count(*)::int from public.staff_audit_events) audits from public.network_reveal_requests')).rows[0]; };
  const deny = async sql => { await assert.rejects(db.exec(sql), error => error.code === '42501');assert.deepEqual(await state(), { status: 'approved', used_at: null, audits: 0 }); };
  await t.test('requester gets one audited view; replay and another activity/requester cannot consume', async () => {
    await deny(login({ id: other }) + reveal());await deny(login() + reveal(2));await deny(login() + reveal(1, other));
    await db.exec(login() + reveal());let saved = await state();assert.equal(saved.status, 'used');assert.ok(saved.used_at);assert.equal(saved.audits, 1);
    await assert.rejects(db.exec(login() + reveal()), error => error.code === '42501');assert.equal((await state()).audits, 1);
    await db.exec(reset);
  });
  await t.test('pending, denied and expired approvals do not reveal or consume', async () => {
    for(const change of ["status='pending'", "status='denied'", "expires_at=now()-interval '1 second'"]) {
      await db.exec(`reset role;update public.network_reveal_requests set ${change};`);
      const before = await state();await assert.rejects(db.exec(login() + reveal()), error => error.code === '42501');assert.deepEqual(await state(), before);await db.exec(reset);
    }
  });
  await t.test('current Discord session, MFA, active membership, allowlist and ban guards remain enforced', async () => {
    for(const claims of [{ aal: 'aal1' },{ provider: 'google' },{ sid: other },{ amr: [{ method: 'oauth' }] }]) await deny(login(claims) + reveal());
    for(const [change, restore] of [
      [`update auth.sessions set not_after=now()-interval '1 second' where user_id='${requester}'`, 'update auth.sessions set not_after=null'],
      [`delete from auth.sessions where user_id='${requester}'`, `insert into auth.sessions values('${requester}','${requester}',null)`],
      [`update public.staff_memberships set status='suspended' where user_id='${requester}'`, "update public.staff_memberships set status='active'"],
      ["update private.discord_owner_allowlist set enabled=false", 'update private.discord_owner_allowlist set enabled=true'],
      [`insert into public.security_bans values('${requester}','account',null,now(),null)`, 'delete from public.security_bans'],
      [`insert into auth.identities(user_id,provider,provider_id) values('${requester}','google','fixture-other')`, "delete from auth.identities where provider='google'"]
    ]) { await db.exec(`reset role;${change};`);await deny(login() + reveal());await db.exec(`reset role;${restore};`); }
  });
  await t.test('active owner direct access stays audited; a non-owner approve override grants no bypass', async () => {
    await db.exec(login({ id: owner }) + reveal(1,null));await db.exec(login({ id: owner }) + reveal(1,null));
    assert.deepEqual(await state(), { status: 'approved', used_at: null, audits: 2 });await db.exec(reset);
    await db.exec(`insert into public.staff_permission_overrides values('${requester}','security.network.approve',true);`);
    await deny(login() + reveal(1,null));await db.exec(login() + reveal());assert.equal((await state()).status,'used');
    await db.exec(reset + 'delete from public.staff_permission_overrides;');
  });
  await t.test('missing evidence or failed audit rolls back approval consumption', async () => {
    await db.exec('reset role;update private.network_evidence set network_ciphertext=null;');
    await assert.rejects(db.exec(login() + reveal()), /evidence is unavailable/);assert.deepEqual(await state(), { status:'approved',used_at:null,audits:0 });
    await db.exec("update private.network_evidence set network_ciphertext='FIXTURE_CIPHERTEXT';alter table public.staff_audit_events add constraint deny_fixture_audit check(false);");
    await assert.rejects(db.exec(login() + reveal()), error => error.code === '23514');assert.deepEqual(await state(), { status:'approved',used_at:null,audits:0 });
    await db.exec('alter table public.staff_audit_events drop constraint deny_fixture_audit;');
  });
  await t.test('raw evidence and approval rows stay private; anonymous and service-role RPC calls stay denied', async () => {
    await db.exec(login());for(const table of ['private.network_evidence','public.network_reveal_requests']) await assert.rejects(db.query(`select * from ${table}`), error => error.code === '42501');
    for(const role of ['anon','service_role']) { await db.exec(`reset role;set role ${role};`);await assert.rejects(db.exec(reveal()), error => error.code === '42501'); }
    assert.deepEqual(await state(), { status:'approved',used_at:null,audits:0 });
  });
});

// PGlite serializes connections. Enable this separate native proof explicitly;
// never substitute Promise.all against one PGlite connection for a row-lock race.
if (process.env.IP_REVEAL_POSTGRES_BIN) test('two native PostgreSQL sessions reproduce the old race and only one wins after migration', { timeout: 30000 }, async t => {
  const bin = process.env.IP_REVEAL_POSTGRES_BIN, directory = mkdtempSync('/tmp/brp-ip-'), execute = promisify(execFile);
  // A sanitized environment has no locale. On macOS PostgreSQL's fallback can
  // start threads before fork, which it correctly refuses. Scope a valid locale
  // to these disposable fixture processes, including pg_ctl's server child.
  const pgEnvironment = { ...process.env, LC_ALL: 'C', LANG: 'C' };
  const run = (command, args) => execute(command, args, { env: pgEnvironment });
  const pg = name => join(bin,name), args = ['-X','-qAt','-v','ON_ERROR_STOP=1','-h',directory,'-U','fixture','postgres'];
  let started = false;
  t.after(async () => { if(started) await run(pg('pg_ctl'),['-D',join(directory,'data'),'-m','immediate','-w','stop']);rmSync(directory,{recursive:true,force:true}); });
  await run(pg('initdb'),['-D',join(directory,'data'),'-A','trust','-U','fixture','--no-locale']);
  try {
    await run(pg('pg_ctl'),['-D',join(directory,'data'),'-l',join(directory,'postgres.log'),'-o',`-F -k ${directory} -h ''`,'-w','start']);started = true;
  } catch (error) {
    // Capture this empty fixture's startup diagnostics before teardown removes it.
    // No application data, provider credentials or evidence has been loaded yet.
    try { error.message += `\nTemporary PostgreSQL startup log:\n${readFileSync(join(directory,'postgres.log'),'utf8').slice(-12000)}`; } catch {}
    throw error;
  }
  const query = async sql => (await run(pg('psql'),[...args,'-c',sql])).stdout.trim();
  const child = sql => { const p=spawn(pg('psql'),args,{stdio:['pipe','pipe','pipe'],env:pgEnvironment});let stdout='',stderr='';p.stdout.on('data',data=>stdout+=data);p.stderr.on('data',data=>stderr+=data);const done=new Promise((resolve,reject)=>{p.on('error',reject);p.on('close',code=>resolve({code,stdout,stderr}));});if(sql)p.stdin.end(sql);return {p,done,get output(){return stdout;}}; };
  const until = async condition => { const end=Date.now()+5000;while(!await condition()){if(Date.now()>end)throw Error('Fixture row-lock barrier timed out');await new Promise(resolve=>setTimeout(resolve,25));} };
  await query(fixture);
  const race = async (beforeRelease = async () => {}) => {
    const holder=child();holder.p.stdin.write(`begin;select id from public.network_reveal_requests where id='${requestId}' for update;\n\\echo LOCK_READY\n`);
    try {
      await until(()=>holder.output.includes('LOCK_READY'));
      const a=child(`set application_name='ip-reveal-a';${login()}${reveal()}`),b=child(`set application_name='ip-reveal-b';${login()}${reveal()}`);
      await until(async()=>await query("select count(*) from pg_stat_activity where application_name in ('ip-reveal-a','ip-reveal-b') and wait_event_type='Lock'")==='2');
      await beforeRelease();
      holder.p.stdin.end('commit;\n');await holder.done;return await Promise.all([a.done,b.done]);
    } finally { if(!holder.p.killed&&holder.p.exitCode===null)holder.p.stdin.end('rollback;\n'); }
  };
  const old=await race();assert.equal(old.filter(result=>result.code===0).length,2,'old unlocked approval check permits both callers');assert.equal(await query('select count(*) from public.staff_audit_events'),'2');
  await query(reset + migration);
  const fixed=await race();assert.equal(fixed.filter(result=>result.code===0).length,1);assert.equal(fixed.filter(result=>/Approved network-evidence request required/.test(result.stderr)).length,1);
  assert.equal(await query('select count(*) from public.staff_audit_events'),'1');assert.equal(await query('select status from public.network_reveal_requests'),'used');
  await query(reset + "update public.network_reveal_requests set expires_at=clock_timestamp()+interval '1 second';");
  const expired=await race(()=>until(async()=>await query('select expires_at<=clock_timestamp() from public.network_reveal_requests')==='t'));
  assert.equal(expired.filter(result=>result.code===0).length,0,'waiting does not extend the approval deadline');
  assert.equal(await query('select count(*) from public.staff_audit_events'),'0');assert.equal(await query('select status from public.network_reveal_requests'),'approved');
});
