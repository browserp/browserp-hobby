// Runs real PostgreSQL permission, pgcrypto and lease logic in a disposable DB.
// Vault encryption, pg_net transport and pg_cron execution require hosted checks;
// their small test doubles below record arguments without making network calls.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';

const migrations = resolve(import.meta.dirname, '../supabase/migrations');
const sql = readFileSync(resolve(migrations, readdirSync(migrations).find(name => name.endsWith('_scheduled_server_status_refresh.sql'))), 'utf8');
const summary = { requested: 55, checked: 53, unchanged: 1, unavailable: 1, skipped: 0, failed: 0, deferred: 0, durationMs: 12500 };

test('scheduled status refresh has private credentials, a bounded lease and observable freshness', async t => {
 const db = new PGlite({ extensions: { pgcrypto } });
 const value = async (query, args = []) => (await db.query(`select (select ${query}) as value`, args)).rows[0].value;
 const role = async name => { await db.exec('reset role'); if (name) await db.exec(`set role ${name}`); };
 try {
  await db.exec(`
   create role anon; create role authenticated; create role service_role;
   create schema private; create schema extensions; create schema vault; create schema net; create schema cron;
   revoke all on schema private from public;
   create table private.secrets(key text primary key,secret_hash text not null,updated_at timestamptz default now());
   create table vault.secrets(id uuid primary key default gen_random_uuid(),name text unique,secret text,description text);
   create view vault.decrypted_secrets as select id,name,secret as decrypted_secret from vault.secrets;
   create function vault.create_secret(new_secret text,new_name text,new_description text) returns uuid language sql as $$
    insert into vault.secrets(name,secret,description) values(new_name,new_secret,new_description) returning id
   $$;
   create table net.http_request_queue(id bigint generated always as identity, url text,body jsonb,headers jsonb,timeout_milliseconds integer);
   create function net.http_post(url text,body jsonb,headers jsonb,timeout_milliseconds integer) returns bigint language sql as $$
    insert into net.http_request_queue(url,body,headers,timeout_milliseconds) values(url,body,headers,timeout_milliseconds) returning id
   $$;
   create table cron.job(jobid bigint generated always as identity,jobname text unique,schedule text,command text,active boolean not null default true);
   create function cron.schedule(job_name text,cron_schedule text,sql_command text) returns bigint language sql as $$
    insert into cron.job(jobname,schedule,command) values(job_name,cron_schedule,sql_command)
   on conflict(jobname) do update set schedule=excluded.schedule,command=excluded.command returning jobid
   $$;
   create function cron.alter_job(job_id bigint,active boolean) returns void language sql as $$
    update cron.job set active=$2 where jobid=$1
   $$;
   create table public.servers(id uuid primary key,platform_id text,status text,age_rating text);
   create table public.server_import_sources(server_id uuid,platform text,last_checked_at timestamptz,last_error_at timestamptz);
   create table public.minecraft_import_sources(server_id uuid,last_checked_at timestamptz,last_error_at timestamptz);
   grant usage on schema vault,net to anon,authenticated,service_role;
   grant select on vault.secrets,vault.decrypted_secrets,net.http_request_queue to anon,authenticated,service_role;
  `);
  const localSql = sql.replace(/execute 'create extension (?:supabase_vault|pg_net|pg_cron)[^']*';/g, 'null; -- Hosted extension replaced by the test double.');
  await db.exec(localSql);
  // This is an ephemeral generated test credential only; never read production secrets.
  const token = await value("decrypted_secret from vault.decrypted_secrets where name='browserp_server_status_refresh'");
  let runId;

  await t.test('an installed extension does not execute CREATE EXTENSION or trigger hosted permission hooks', async () => {
   assert.equal(await value("count(*)::integer from pg_catalog.pg_extension where extname='pgcrypto'"), 1);
   const installer = localSql.match(/do \$status_refresh_extensions\$[\s\S]*?\$status_refresh_extensions\$;/)[0];
   // An existing extension must bypass the DDL branch altogether, even when
   // re-running it would fail inside Supabase's permission event trigger.
   await db.exec(installer.replace("execute 'create extension pgcrypto with schema extensions';", "raise exception 'Existing extension DDL must not run';"));
  });

  await t.test('generates a high-entropy credential and installs one paused fixed-destination schedule', async () => {
   assert.match(token, /^[a-f0-9]{64}$/);
   const hash = await value("secret_hash from private.secrets where key='server_status_refresh'");
   assert.notEqual(hash, token);
   assert.equal(hash, createHash('sha256').update(token).digest('hex'));
   assert.match(hash, /^[a-f0-9]{64}$/);
   assert.deepEqual((await db.query('select jobname,schedule,command,active from cron.job')).rows, [{ jobname:'browserp-server-status-refresh',schedule:'* * * * *',command:'select private.dispatch_server_status_refresh()',active:false }]);
   assert.equal(await value('count(*)::integer from net.http_request_queue'), 0);
   await db.exec("select cron.alter_job(jobid,active:=true) from cron.job where jobname='browserp-server-status-refresh'");
   assert.equal(await value("active from cron.job where jobname='browserp-server-status-refresh'"), true);
   assert.equal(await value('private.dispatch_server_status_refresh()'), 1);
   const request = (await db.query('select * from net.http_request_queue')).rows[0];
   assert.equal(request.url, 'https://www.browserp.com/api/internal/server-status');
   assert.deepEqual(request.body, {});
   assert.equal(request.headers.Authorization, `Bearer ${token}`);
   assert.equal(request.timeout_milliseconds, 55000);
   assert.equal(await value('last_request_id from private.server_status_refresh_control'), 1);
  });

  await t.test('anonymous users and members cannot forge, dispatch or inspect refresh credentials', async () => {
   for (const name of ['anon','authenticated']) {
    await role(name);
    await assert.rejects(value('public.service_claim_status_refresh($1)', [token]), error => error.code==='42501');
    await assert.rejects(value('public.service_finish_status_refresh(gen_random_uuid(),$1::jsonb)', [JSON.stringify(summary)]), error => error.code==='42501');
    await assert.rejects(value('private.dispatch_server_status_refresh()'), error => error.code==='42501');
    for (const table of ['vault.secrets','vault.decrypted_secrets','net.http_request_queue','private.server_status_refresh_runs']) await assert.rejects(db.query(`select * from ${table}`), error => error.code==='42501');
   }
   await role('service_role');
   for (const table of ['vault.secrets','vault.decrypted_secrets','net.http_request_queue','private.server_status_refresh_control']) await assert.rejects(db.query(`select * from ${table}`), error => error.code==='42501');
   await assert.rejects(value('private.dispatch_server_status_refresh()'), error => error.code==='42501');
  });

  await t.test('a correct token is required and only one request obtains the 55-second lease', async () => {
   for (const wrong of [null,'', 'a'.repeat(63),'z'.repeat(64),token.replace(/^./,token[0]==='a'?'b':'a')]) await assert.rejects(value('public.service_claim_status_refresh($1)', [wrong]), error => error.code==='42501');
   runId = await value('public.service_claim_status_refresh($1)', [token]);
   assert.match(runId, /^[a-f0-9-]{36}$/);
   assert.equal(await value('public.service_claim_status_refresh($1)', [token]), null);
   await role();
   assert.equal(await value('count(*)::integer from private.server_status_refresh_runs'), 1);
   assert.equal(await value("leased_until > clock_timestamp()+interval '50 seconds' and leased_until <= clock_timestamp()+interval '55 seconds' from private.server_status_refresh_control"), true);
  });

  await t.test('summary bounds reject fabricated payloads and freshness comes from real source rows', async () => {
   await db.exec(`
    insert into public.servers values
    ('00000000-0000-4000-8000-000000000001','fivem','published','teen'),
    ('00000000-0000-4000-8000-000000000002','redm','published','teen'),
    ('00000000-0000-4000-8000-000000000003','minecraft','published','teen'),
    ('00000000-0000-4000-8000-000000000004','fivem','archived','teen');
    insert into public.server_import_sources values
    ('00000000-0000-4000-8000-000000000001','fivem',now(),null),
    ('00000000-0000-4000-8000-000000000002','redm',now()-interval '6 minutes',null),
    ('00000000-0000-4000-8000-000000000004','fivem',null,null);
    insert into public.minecraft_import_sources values('00000000-0000-4000-8000-000000000003',now()-interval '1 minute',now());
   `);
   await role('service_role');
   for (const invalid of [null,[],{}, {...summary,token}, {...summary,failed:-1}, {...summary,checked:1.1}, {...summary,requested:201}, {...summary,durationMs:120001}, {...summary,checked:'53'}]) await assert.rejects(value('public.service_finish_status_refresh($1,$2::jsonb)', [runId,JSON.stringify(invalid)]), /Invalid refresh summary/);
   await assert.rejects(value('public.service_finish_status_refresh(gen_random_uuid(),$1::jsonb)', [JSON.stringify(summary)]), /Unknown refresh run/);
   await value('public.service_finish_status_refresh($1,$2::jsonb)', [runId,JSON.stringify(summary)]);
   assert.equal(await value('public.service_claim_status_refresh($1)', [token]), null, 'finishing early must not release the rate limit');
   await role();
   const stored = await value('summary from private.server_status_refresh_runs where id=$1', [runId]);
   assert.equal(stored.totalSources, 3);
   assert.equal(stored.freshSources, 1);
   assert.equal(stored.staleSources, 2);
   assert.ok(Date.parse(stored.oldestSourceCheckedAt)<Date.now()-5*60000);
   assert.equal(JSON.stringify(stored).includes(token), false);
  });

  await t.test('expired leases recover, late completion cannot release a newer run, and history is bounded', async () => {
   await db.exec("update private.server_status_refresh_control set leased_until=now()-interval '1 second';insert into private.server_status_refresh_runs(id,started_at) values(gen_random_uuid(),now()-interval '8 days');");
   await role('service_role');
   const newerRun = await value('public.service_claim_status_refresh($1)', [token]);
   assert.notEqual(newerRun, runId);
   await value('public.service_finish_status_refresh($1,$2::jsonb)', [runId,JSON.stringify({...summary,checked:1})]);
   assert.equal(await value('public.service_claim_status_refresh($1)', [token]), null);
   await role();
   assert.equal(await value('run_id from private.server_status_refresh_control'), newerRun);
   assert.equal(await value('count(*)::integer from private.server_status_refresh_runs'), 2);
   assert.equal(await value("(summary->>'checked')::integer from private.server_status_refresh_runs where id=$1", [runId]), 53, 'repeat completion is idempotent');
  });
 } finally { await db.close(); }
});
