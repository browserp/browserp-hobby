import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
const read = name => readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), "utf8");
const fn = (source, name) => source.match(new RegExp(`create or replace function ${name.replaceAll(".", "\\.")}\\([\\s\\S]*?\\n\\$\\$;`))[0];
const owner="00000000-0000-4000-8000-000000000001", member="00000000-0000-4000-8000-000000000002", other="00000000-0000-4000-8000-000000000003";
const sid="aaaaaaaa-0000-4000-8000-000000000001", memberSid="aaaaaaaa-0000-4000-8000-000000000002", otherSid="aaaaaaaa-0000-4000-8000-000000000003";

test("private data requests are owned, recoverable, permission-scoped and never fulfil exports or deletion",async t=>{
  const db=new PGlite();t.after(()=>db.close());
  await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create schema private;revoke all on schema private from public;
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create function auth.jwt() returns jsonb language sql stable as $$select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb$$;
    create table auth.users(id uuid primary key,deleted_at timestamptz,is_anonymous boolean default false);
    create table auth.sessions(id uuid primary key,user_id uuid,not_after timestamptz);
    create table auth.identities(user_id uuid,provider text,provider_id text,identity_data jsonb default '{}');
    create table public.profiles(id uuid primary key,display_name text);
    create table public.permissions(key text primary key,description text);
    create table public.staff_memberships(user_id uuid,status text,role_key text);
    create table private.discord_owner_allowlist(discord_user_id text,enabled boolean,role_key text);
    create table public.security_bans(user_id uuid,target_type text,revoked_at timestamptz,starts_at timestamptz,ends_at timestamptz);
    create table private.platform_security_settings(singleton boolean,staff_mfa_required boolean);
    create table public.staff_permission_overrides(user_id uuid,permission_key text,allowed boolean);
    create table public.staff_role_permissions(role_key text,permission_key text,primary key(role_key,permission_key));
    insert into private.platform_security_settings values(true,true);
    insert into auth.users(id) values('${owner}'),('${member}'),('${other}');
    insert into public.profiles values('${owner}','Owner fixture'),('${member}','Member fixture'),('${other}','Other fixture');
    insert into auth.sessions(id,user_id) values('${sid}','${owner}'),('${memberSid}','${member}'),('${otherSid}','${other}');
    insert into auth.identities(user_id,provider,provider_id) values('${owner}','discord','owner-discord'),('${member}','google','member-google'),('${other}','discord','other-discord');
    insert into public.staff_memberships values('${owner}','active','owner'),('${other}','active','custom_helper');
    insert into private.discord_owner_allowlist values('owner-discord',true,'owner'),('other-discord',true,'custom_helper');
  `);
  const core=read("202608180001_browserp_core.sql"),security=read("20260904092528_enforce_member_security_boundaries.sql");
  for(const table of ["rate_limit_buckets","staff_audit_events"])await db.exec(core.match(new RegExp(`create table public\\.${table} \\([\\s\\S]*?\\n\\);`))[0]);
  await db.exec(fn(core,"public.consume_rate_limit"));
  await db.exec(read("20260905195616_enforce_auth_session_expiry.sql"));
  for(const name of ["private.member_access_allowed","private.require_active_member","private.enforce_member_rate_limit","public.has_staff_permission","public.staff_mfa_enrollment_allowed"])await db.exec(fn(security,name));
  await db.exec(read("20260905210347_member_data_requests.sql"));
  const admin=async sql=>{await db.exec("reset role");await db.exec(sql);};
  const login=async({id=member,session=memberSid,aal="aal1",provider=id===member?"google":"discord",amr=[{method:"oauth"},{method:"totp"}]}={})=>{
    await db.exec("reset role");await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)",[id,JSON.stringify({sub:id,session_id:session,aal,app_metadata:{provider},amr})]);await db.exec("set role authenticated");
  };
  const memberCall=async(action="list",kind=null,details=null,key=null,id=null,version=null)=>(await db.query("select public.member_data_requests($1,$2,$3,$4,$5,$6) value",[action,kind,details,key,id,version])).rows[0].value;
  const create=async(kind="copy",details="",key=randomUUID())=>(await memberCall("create",kind,details,key)).request;
  const review=async(row,status="reviewing",reply="Your request is being reviewed.",key=randomUUID())=>(await db.query("select public.staff_review_data_request($1,$2,$3,$4,$5) value",[row.id,status,reply,row.version,key])).rows[0].value.request;
  const queue=async(status="open",kind=null,time=null,id=null,limit=25)=>(await db.query("select public.staff_data_requests($1,$2,$3,$4,$5) value",[status,kind,time,id,limit])).rows[0].value;
  let copy, deletion, copyKey;
  await t.test("members submit once, view only their requests and cannot create duplicate active kinds",async()=>{
    await login();const key=randomUUID();copyKey=key;copy=await create("copy","Private fixture details",key);
    assert.equal((await create("copy","Private fixture details",key)).id,copy.id);
    await assert.rejects(create("copy","Different private fixture details",key),/different request details/);
    assert.equal((await memberCall()).items.length,1);await assert.rejects(create(),/already have an open request/);
    await login({id:other,session:otherSid});assert.equal((await memberCall()).items.length,0);
    await assert.rejects(memberCall("withdraw",null,null,null,copy.id,copy.version),/Request not found/);
    await login();deletion=await create("delete");assert.equal(deletion.status,"submitted");
    await assert.rejects(create("correction","Short"),/describe the correction/);await assert.rejects(create("copy","a".repeat(1001)),/Check your request details/);
  });
  await t.test("revoked, expired, anonymous and banned members cannot even list private requests",async()=>{
    for(const [change,restore]of [
      [`delete from auth.sessions where id='${memberSid}'`,`insert into auth.sessions(id,user_id) values('${memberSid}','${member}')`],
      [`update auth.sessions set not_after=now()-interval '1 second' where id='${memberSid}'`,"update auth.sessions set not_after=null"],
      [`update auth.users set is_anonymous=true where id='${member}'`,"update auth.users set is_anonymous=false"],
      [`insert into public.security_bans values('${member}','account',null,now(),null)`,"delete from public.security_bans"]
    ]){await admin(change);await login();await assert.rejects(memberCall(),/active, unrestricted sign-in/);await admin(restore);}
    await login({session:otherSid});await assert.rejects(memberCall(),/active, unrestricted sign-in/);
  });
  await t.test("the staff queue requires explicit permission, active allowed Discord and AAL2",async()=>{
    for(const change of [{},{id:other,session:otherSid,aal:"aal2"},{id:owner,session:sid,aal:"aal1"},{id:owner,session:sid,aal:"aal2",amr:[{method:"oauth"}]}]){
      await login(change);assert.equal((await db.query("select public.staff_data_request_access() value")).rows[0].value,false);await assert.rejects(queue(),/Permission and an authenticator/);await assert.rejects(review(copy),/Permission and an authenticator/);
    }
    await login({id:owner,session:sid,aal:"aal2"});assert.equal((await db.query("select public.staff_data_request_access() value")).rows[0].value,true);assert.equal((await queue()).items.length,2);
    await admin(`insert into public.staff_permission_overrides values('${other}','privacy.requests.manage',true)`);await login({id:other,session:otherSid,aal:"aal2"});assert.equal((await queue()).items.length,2);
    await admin("update private.discord_owner_allowlist set enabled=false where discord_user_id='other-discord'");await login({id:other,session:otherSid,aal:"aal2"});await assert.rejects(queue(),/Permission and an authenticator/);
    await admin("update private.discord_owner_allowlist set enabled=true");
  });
  await t.test("review decisions are versioned and idempotent; general audit records contain no private prose",async()=>{
    await login({id:owner,session:sid,aal:"aal2"});const key=randomUUID();const before=copy;
    copy=await review(copy,"information_needed","Please add which dates your copy should cover.",key);
    assert.equal(copy.version,2);assert.equal((await review(before,"information_needed","Please add which dates your copy should cover.",key)).version,2);
    await assert.rejects(review(before,"information_needed","A different reply using the original key.",key),/review was already used/);
    await assert.rejects(review(before),/changed or closed/);
    await assert.rejects(review(copy,"completed"),/Choose a review decision/);
    await db.exec("reset role");const audit=(await db.query("select * from public.staff_audit_events")).rows;assert.equal(audit.length,1);
    assert.doesNotMatch(JSON.stringify(audit),/Private fixture details|Please add which dates/);
    await login({id:owner,session:sid,aal:"aal2"});
    copy=await review(copy,"information_needed","Please clarify the updated date range.");
    await assert.rejects(review(before,"information_needed","Please clarify the updated date range.",key),/review was already used/);
    assert.equal((await review(before,"information_needed","Please add which dates your copy should cover.",key)).version,copy.version);
    await login();copy=(await memberCall("update",null,"Please include all my information since joining.",null,copy.id,copy.version)).request;assert.equal(copy.status,"submitted");
    assert.equal((await create("copy","Private fixture details",copyKey)).id,copy.id);
    await assert.rejects(create("copy",copy.details,copyKey),/different request details/);
  });
  await t.test("ready-for-follow-up never deletes an account, and members may still withdraw it",async()=>{
    await login({id:owner,session:sid,aal:"aal2"});deletion=await review(deletion,"ready","Your ownership and retention review is ready for follow-up.");assert.equal(deletion.status,"ready");
    await login();const withdrawn=(await memberCall("withdraw",null,null,null,deletion.id,deletion.version)).request;assert.equal(withdrawn.status,"withdrawn");
    assert.equal((await memberCall("withdraw",null,null,null,deletion.id,deletion.version)).request.version,withdrawn.version);
    await db.exec("reset role");assert.equal((await db.query("select count(*)::int n from auth.users")).rows[0].n,3);assert.equal((await db.query("select count(*)::int n from auth.identities")).rows[0].n,3);
  });
  await t.test("database quotas cannot be bypassed by calling RPCs directly",async()=>{
    await login();await create("correction","Correct the country associated with my profile.");
    await assert.rejects(create("delete"),/Too many requests/);
  });
  await t.test("staff filters paginate without duplicates and raw table access remains denied",async()=>{
    await login({id:owner,session:sid,aal:"aal2"});const first=await queue("all",null,null,null,1);assert.equal(first.items.length,1);assert.ok(first.next);
    const second=await queue("all",null,first.next.createdAt,first.next.id,1);assert.equal(second.items.length,1);assert.notEqual(first.items[0].id,second.items[0].id);
    assert.ok((await queue("open")).items.every(item=>item.status!=="withdrawn"));assert.ok((await queue("all","delete")).items.every(item=>item.kind==="delete"));
    await assert.rejects(db.query("select * from private.account_data_request_review_keys"),/permission denied/);
    await assert.rejects(db.query("select * from private.account_data_requests"),/permission denied/);await assert.rejects(db.query("delete from private.account_data_requests"),/permission denied/);
    for(const role of["anon","service_role"]){await db.exec(`reset role;set role ${role}`);await assert.rejects(memberCall(),/permission denied/);await assert.rejects(queue(),/permission denied/);await assert.rejects(review(copy),/permission denied/);await assert.rejects(db.query("select public.staff_data_request_access()"),/permission denied/);}
    await db.exec("reset role");for(const name of ["account_data_requests","account_data_request_review_keys"])assert.equal((await db.query(`select relrowsecurity from pg_class where oid='private.${name}'::regclass`)).rows[0].relrowsecurity,true);
  });
});
