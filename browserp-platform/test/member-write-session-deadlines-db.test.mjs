import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { PGlite } from '@electric-sql/pglite';

const read=name=>readFileSync(new URL(`../supabase/migrations/${name}.sql`,import.meta.url),'utf8');
const definition=(source,name)=>source.match(new RegExp(`create or replace function ${name.replaceAll('.', '\\.')}\\([\\s\\S]*?\\n\\$\\$;`))[0];
const table=(source,name)=>source.match(new RegExp(`create table(?: if not exists)? public\\.${name} \\([\\s\\S]*?\\n\\);`))[0];
const member='00000000-0000-4000-8000-000000000001';
const other='00000000-0000-4000-8000-000000000002';
const session='aaaaaaaa-0000-4000-8000-000000000001';
const server='bbbbbbbb-0000-4000-8000-000000000001';
const parent='cccccccc-0000-4000-8000-000000000001';

async function fixture(t) {
  const db=new PGlite(); t.after(()=>db.close());
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create schema auth; create schema private; create schema extensions; revoke all on schema private from public;
    create function extensions.gen_random_uuid() returns uuid language sql as $$select pg_catalog.gen_random_uuid()$$;
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
    create table auth.users(id uuid primary key,deleted_at timestamptz,is_anonymous boolean default false);
    create table auth.sessions(id uuid primary key,user_id uuid not null,not_after timestamptz);
  `);
  const core=read('202608180001_browserp_core'),ops=read('20260819192413_platform_operations_and_trust');
  for (const statement of core.matchAll(/create table public\.\w+ \([\s\S]*?\n\);/g)) await db.exec(statement[0]);
  for (const name of ['security_bans','server_votes','server_comments']) await db.exec(table(ops,name));
  for (const name of ['profiles','servers']) await db.exec(ops.match(new RegExp(`alter table public\\.${name}\\s+add column[\\s\\S]*?;`))[0]);
  await db.exec(definition(core,'public.consume_rate_limit'));
  await db.exec(read('20260905195616_enforce_auth_session_expiry'));
  const guards=read('20260904092528_enforce_member_security_boundaries');
  for (const name of ['private.member_access_allowed','private.require_active_member','private.enforce_member_rate_limit','public.member_server_interaction']) {
    await db.exec(definition(guards,name));
  }
  await db.exec(read('20260908100413_comment_identity_and_replies'));
  await db.exec(read('20260908101556_member_recommendation_preferences'));
  await db.exec(read('20260908112653_member_preference_reply_session_deadlines'));
  await db.exec(`insert into auth.users(id) values('${member}'),('${other}');
    insert into auth.sessions(id,user_id) values('${session}','${member}');
    insert into public.profiles(id,username,display_name) values('${member}','member','Member'),('${other}','other','Other member');
    insert into public.platforms(id,name,short_name) values('fivem','FiveM','FiveM');
    insert into public.servers(id,owner_id,platform_id,name,slug,description,region,status,age_rating) values
      ('${server}','${other}','fivem','Fixture community','fixture-community','A published community for isolated member write security checks.','Europe','published','general');
    insert into public.server_comments(id,server_id,author_id,body,status) values
      ('${parent}','${server}','${other}','A published parent comment.','published');
    create function private.fixture_member_write_boundary() returns trigger language plpgsql as $$
    declare change text:=current_setting('fixture.change',true);
    begin
      if current_setting('fixture.boundary',true) is distinct from tg_argv[0] then return new; end if;
      if change in ('expiry','scheduled_ban') then perform pg_catalog.pg_sleep(0.2);
      elsif change='revoke' then delete from auth.sessions where id='${session}';
      elsif change='delete_account' then update auth.users set deleted_at=clock_timestamp() where id='${member}';
      end if;
      return new;
    end;$$;
    create trigger fixture_member_quota before insert or update on public.rate_limit_buckets
      for each row execute function private.fixture_member_write_boundary('quota');
    create trigger fixture_preference_write before insert or update on private.member_recommendation_preferences
      for each row execute function private.fixture_member_write_boundary('preference_write');
    create trigger fixture_reply_write before update of parent_comment_id on public.server_comments
      for each row execute function private.fixture_member_write_boundary('reply_write');
  `);
  const admin=async (sql,values=[])=>{await db.exec('reset role');return sql?db.query(sql,values):undefined;};
  const login=async ()=>{
    await admin();
    await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)",
      [member,JSON.stringify({sub:member,session_id:session})]);
    await db.exec('set role authenticated');
  };
  const preference=async (choice='accepted',version=0)=>(await db.query("select public.member_set_recommendation_preferences(1,$1,$2) value",[choice,version])).rows[0].value;
  const reply=async ()=>(await db.query('select public.member_server_comment_reply($1,$2,$3) value',[server,parent,'A useful reply awaiting ordinary moderation.'])).rows[0].value;
  const snapshot=async ()=> (await admin(`select
    (select coalesce(jsonb_agg(to_jsonb(p) order by user_id),'[]') from private.member_recommendation_preferences p) preferences,
    (select count(*)::int from public.server_comments) comments,
    (select count(*)::int from public.moderation_queue) reviews,
    (select coalesce(sum(request_count),0)::int from public.rate_limit_buckets) requests`)).rows[0];
  return {db,admin,login,preference,reply,snapshot};
}

test('preference and reply writes cannot outlive their bound session or account access',async t=>{
  const {db,admin,login,preference,reply,snapshot}=await fixture(t);
  // These real table triggers inject bounded waits or restrictions into the
  // actual quota/write statements. They do not simulate separate connections.
  for (const [action,boundary] of [
    ['accept','quota'],['accept','preference_write'],['reject','preference_write'],
    ['reply','quota'],['reply','reply_write']
  ]) {
    for (const change of ['expiry','scheduled_ban','revoke','delete_account']) {
      await t.test(`${action}: ${change} during ${boundary} rolls back preference, reply, review and quota writes`,async ()=>{
        await admin('begin');
        try {
          await admin("insert into private.member_recommendation_preferences values($1,1,'accepted',5,clock_timestamp())",[member]);
          const before=await snapshot();
          if (change==='expiry') {
            await admin("update auth.sessions set not_after=clock_timestamp()+interval '0.1 seconds' where id=$1",[session]);
          } else if (change==='scheduled_ban') {
            await admin(`insert into public.security_bans(user_id,target_type,target_hash,public_reference,reason_code,reason,actor_id,starts_at)
              values($1,'account',repeat('f',64),'BRP-WRITE00001','fixture','A scheduled fixture restriction.',$2,clock_timestamp()+interval '0.1 seconds')`,[member,other]);
          }
          await login();
          await db.query("select set_config('fixture.boundary',$1,true),set_config('fixture.change',$2,true)",[boundary,change]);
          await db.exec('savepoint before_member_write');
          await assert.rejects(action==='reply'?reply():preference(action==='accept'?'accepted':'rejected',action==='accept'?5:0),/active, unrestricted/);
          await db.exec('rollback to savepoint before_member_write');
          assert.deepEqual(await snapshot(),before);
        } finally {await db.exec('rollback');}
      });
    }
  }
  await t.test('healthy consent retains rejection priority, CAS and acceptance-only quota',async ()=>{
    await login(); const accepted=await preference();
    assert.equal(accepted.accountId,member); assert.equal(accepted.choice,'accepted'); assert.equal(accepted.version,1);
    const before=await snapshot(); await login();
    const rejected=await preference('rejected',0); assert.equal(rejected.choice,'rejected'); assert.equal(rejected.version,2);
    assert.equal((await snapshot()).requests,before.requests);
    await login(); await assert.rejects(preference('accepted',1),/preference changed/);
    assert.equal((await preference('accepted',2)).version,3);
  });
  await t.test('healthy replies still create one pending comment, ordinary moderation entry and quota charge',async ()=>{
    const before=await snapshot(); await login(); const result=await reply();
    assert.deepEqual(result,{id:result.id,status:'pending_review',parentCommentId:parent});
    const after=await snapshot();
    assert.equal(after.comments,before.comments+1); assert.equal(after.reviews,before.reviews+1); assert.equal(after.requests,before.requests+1);
    assert.deepEqual((await admin('select author_id,parent_comment_id,status from public.server_comments where id=$1',[result.id])).rows[0],
      {author_id:member,parent_comment_id:parent,status:'pending_review'});
    assert.deepEqual((await admin('select target_type,status,reasons from public.moderation_queue where target_id=$1',[result.id])).rows,
      [{target_type:'server_comment',status:'open',reasons:['member_comment']}]);
  });
  await t.test('the helper stays private and both RPCs retain authenticated-only grants',async ()=>{
    for (const role of ['anon','authenticated','service_role']) {
      await admin(); await db.exec(`set role ${role}`);
      await assert.rejects(db.query('select private.require_member_write_session($1)',[member]),/permission denied/);
      if (role!=='authenticated') {
        await assert.rejects(preference(),/permission denied/);
        await assert.rejects(reply(),/permission denied/);
      }
    }
  });
});
