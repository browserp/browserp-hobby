// Regression coverage against the real old/new PostgreSQL functions and public
// status projection. No hosted database or upstream server is contacted.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const directory = resolve(import.meta.dirname, '../supabase/migrations');
const read = suffix => readFileSync(resolve(directory, readdirSync(directory).find(name => name.endsWith(suffix))), 'utf8');
const cfxSql = read('_redm_reviewed_cfx_imports.sql');
const minecraftSql = read('_minecraft_reviewed_imports.sql');
const migration = read('_recover_equal_source_observations.sql');
const extract = (sql, name) => sql.match(new RegExp(`create or replace function ${name.replaceAll('.', '\\.')}\\([\\s\\S]*?\\n\\$\\$;`))[0];
const sources = [
 { id:'00000000-0000-4000-8000-000000000001', platform:'fivem', code:'abcdef', players:0 },
 { id:'00000000-0000-4000-8000-000000000002', platform:'redm', code:'ghijkl', players:12 },
 { id:'00000000-0000-4000-8000-000000000003', platform:'minecraft', code:'123456abcdef', players:161 }
];

test('equal current observations recover transient errors without duplicate or newer timestamps', async t => {
 const db = new PGlite();
 const observedAt = new Date(Date.now()-120000).toISOString();
 const value = async (sql, args = []) => (await db.query(`select (select ${sql}) as value`, args)).rows[0].value;
 const reset = () => db.exec('reset role');
 const sourceTable = source => source.platform==='minecraft'?'minecraft_import_sources':'server_import_sources';
 const refresh = (source, timestamp=observedAt, players=source.players) => source.platform==='minecraft'
  ? value('public.service_refresh_minecraft_snapshot($1,true,$2,200,$3::timestamptz)', [source.code,players,timestamp])
  : value('public.service_refresh_cfx_snapshot($1,$2,true,$3,200,$4::timestamptz)', [source.platform,source.code,players,timestamp]);
 const fail = source => source.platform==='minecraft'
  ? value('public.service_mark_minecraft_unavailable($1)', [source.code])
  : value('public.service_mark_cfx_unavailable($1,$2)', [source.platform,source.code]);
 const claim = source => source.platform==='minecraft'
  ? value('public.service_claim_minecraft_refresh($1)', [source.code])
  : value('public.service_claim_cfx_refresh($1,$2)', [source.platform,source.code]);
 const state = async source => {
  await reset();
  const data = (await db.query(`select last_checked_at,last_error_at,next_refresh_at from public.${sourceTable(source)} where server_id=$1`, [source.id])).rows[0];
  const status = (await db.query('select * from private.effective_server_status where server_id=$1',[source.id])).rows[0];
  return { ...data, ...status, snapshotCount:await value('count(*)::integer from public.server_status_snapshots where server_id=$1',[source.id]) };
 };
 try {
  await db.exec(`
   create role anon;create role authenticated;create role service_role;create schema private;
   create table public.servers(id uuid primary key,platform_id text,status text,age_rating text);
   create table public.server_import_sources(server_id uuid primary key,platform text,join_code text,last_checked_at timestamptz,last_error_at timestamptz,next_refresh_at timestamptz default now());
   create table public.minecraft_import_sources(server_id uuid primary key,join_code text,last_checked_at timestamptz,last_error_at timestamptz,next_refresh_at timestamptz default now());
   create table public.server_status_snapshots(id bigint generated always as identity,server_id uuid,online boolean,players integer,capacity integer,provider_status text,checked_at timestamptz);
  `);
  for (const name of ['public.service_refresh_cfx_snapshot','public.service_mark_cfx_unavailable']) await db.exec(extract(cfxSql,name));
  for (const name of ['public.service_refresh_minecraft_snapshot','public.service_mark_minecraft_unavailable']) await db.exec(extract(minecraftSql,name));
  await db.exec(minecraftSql.match(/create or replace view private\.effective_server_status[\s\S]*?x on true;/)[0]);
  for (const source of sources) {
   await db.query("insert into public.servers values($1,$2,'published','teen')",[source.id,source.platform]);
   if (source.platform==='minecraft') await db.query('insert into public.minecraft_import_sources(server_id,join_code) values($1,$2)',[source.id,source.code]);
   else await db.query('insert into public.server_import_sources(server_id,platform,join_code) values($1,$2,$3)',[source.id,source.platform,source.code]);
   await refresh(source);
   await fail(source);
  }

  await t.test('previous Cfx and Minecraft functions reproduce the sticky unavailable flag',async()=>{
   for (const source of sources) {
    assert.equal((await refresh(source)).unchanged,true);
    const current=await state(source);
    assert.ok(current.last_error_at);
    assert.equal(current.online,false);
    assert.equal(current.players,null);
    assert.equal(current.snapshotCount,1);
   }
  });
  await db.exec(migration);

  await t.test('same fresh source time clears only the error and restores verified counts including zero',async()=>{
   for (const source of sources) {
    await db.exec('set role service_role');
    const result=await refresh(source);
    assert.equal(result.unchanged,true);
    assert.equal(Date.parse(result.checkedAt),Date.parse(observedAt));
    const current=await state(source);
    assert.equal(current.last_error_at,null);
    assert.equal(new Date(current.last_checked_at).getTime(),Date.parse(observedAt));
    assert.equal(current.players,source.players);
    assert.equal(current.online,true);
    assert.equal(current.snapshotCount,1);
    assert.ok(new Date(current.next_refresh_at).getTime()>=Date.now()+50000);
   }
  });

  await t.test('older observations and invalid equal observations cannot clear a later failure',async()=>{
   for (const source of sources) {
    await fail(source);
    const before=await state(source);
    assert.equal((await refresh(source,new Date(Date.parse(observedAt)-1000).toISOString())).unchanged,true);
    await assert.rejects(refresh(source,observedAt,201),/current verified player observation/);
    const current=await state(source);
    assert.deepEqual(current.last_error_at,before.last_error_at);
    assert.deepEqual(current.last_checked_at,before.last_checked_at);
    assert.equal(current.players,null);
    assert.equal(current.snapshotCount,1);
   }
  });

  await t.test('stale equal timestamps never recover public availability',async()=>{
   const stale=new Date(Date.now()-360000).toISOString();
   for (const source of sources) {
    await db.query(`update public.${sourceTable(source)} set last_checked_at=$1 where server_id=$2`,[stale,source.id]);
    await db.query('update public.server_status_snapshots set checked_at=$1 where server_id=$2',[stale,source.id]);
    if(source.platform==='minecraft') assert.equal((await refresh(source,stale)).unchanged,true);
    else await assert.rejects(refresh(source,stale),/current verified player observation/);
    const current=await state(source);
    assert.ok(current.last_error_at);
    assert.equal(current.players,null);
    assert.equal(current.online,false);
    assert.equal(current.snapshotCount,1);
   }
  });

  await t.test('a newer verified timestamp keeps normal insert behavior and anonymous/member access stays denied',async()=>{
   for (const source of sources) {
    const newer=new Date().toISOString();
    await db.exec('set role service_role');
    const result=await refresh(source,newer);
    assert.equal(result.players,source.players);
    const current=await state(source);
    assert.equal(current.last_error_at,null);
    assert.equal(new Date(current.last_checked_at).getTime(),Date.parse(newer));
    assert.equal(current.snapshotCount,2);
    for(const role of ['anon','authenticated']) {
     await db.exec(`set role ${role}`);
     await assert.rejects(refresh(source,newer),error=>error.code==='42501');
     await assert.rejects(claim(source),error=>error.code==='42501');
     await assert.rejects(fail(source),error=>error.code==='42501');
     await reset();
    }
   }
  });

  await t.test('claim, new/equal save and failure all use a 55-second cooldown and retain longer leases',async()=>{
   for (const source of sources) {
    const table=sourceTable(source);
    const expired=()=>db.query(`update public.${table} set next_refresh_at=now()-interval '1 second' where server_id=$1`,[source.id]);
    const assertCooldown=async action=>{
     // Check the assigned interval against the same transaction's stable clock,
     // so scheduling delays between queries cannot shorten the measured lease.
     await db.exec('begin');
     try {
      await expired();await db.exec('set role service_role');
      await action();
      await reset();
      const seconds=await value(`extract(epoch from next_refresh_at-now())::double precision from public.${table} where server_id=$1`,[source.id]);
      assert.equal(seconds,55,'Expected an exactly 55-second cooldown');
      await db.exec('commit');
     } catch(error) {
      await db.exec('rollback');
      throw error;
     }
    };
    await assertCooldown(async()=>{
     assert.equal(await claim(source),true);
     assert.equal(await claim(source),false);
    });
    await assertCooldown(async()=>assert.equal(await fail(source),true));
    const newer=new Date((await state(source)).last_checked_at.getTime()+1000).toISOString();
    await assertCooldown(async()=>{
     const result=await refresh(source,newer);
     assert.equal(result.players,source.players);
     assert.equal(result.unchanged,undefined);
    });
    const seen=(await state(source)).last_checked_at.toISOString();
    await assertCooldown(async()=>assert.equal((await refresh(source,seen)).unchanged,true));
    await db.query(`update public.${table} set next_refresh_at=now()+interval '2 minutes' where server_id=$1`,[source.id]);
    const longer=(await state(source)).next_refresh_at;
    await db.exec('set role service_role');assert.equal(await claim(source),false);
    await fail(source);await refresh(source,seen);
    assert.deepEqual((await state(source)).next_refresh_at,longer);
   }
  });

  await t.test('source claiming retains published, age and Cfx platform guards',async()=>{
   for(const source of sources) {
    await db.query(`update public.${sourceTable(source)} set next_refresh_at=now()-interval '1 second' where server_id=$1`,[source.id]);
    await db.query("update public.servers set status='archived' where id=$1",[source.id]);
    await db.exec('set role service_role');assert.equal(await claim(source),false);await reset();
    await db.query("update public.servers set status='published',age_rating='adult' where id=$1",[source.id]);
    await db.exec('set role service_role');assert.equal(await claim(source),false);await reset();
    await db.query("update public.servers set age_rating='teen' where id=$1",[source.id]);
   }
   await db.exec('set role service_role');
   assert.equal(await value("public.service_claim_cfx_refresh('redm','abcdef')"),false);
   assert.equal(await value("public.service_claim_cfx_refresh('fivem','missing')"),false);
   assert.equal(await value("public.service_claim_minecraft_refresh('missing')"),false);
   await assert.rejects(value("public.service_claim_cfx_refresh('minecraft','abcdef')"),/Invalid Cfx platform/);
  });
 } finally { await db.close(); }
});
