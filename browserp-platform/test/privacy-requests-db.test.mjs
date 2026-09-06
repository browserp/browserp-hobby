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
  await t.test("upgrade preserves a labelled snapshot without inventing lost history",async()=>{
    await admin(read("20260906002145_private_request_history_and_completion.sql"));
    await login();
    const result=(await db.query("select public.member_data_request_history($1) value",[copy.id])).rows[0].value;
    assert.equal(result.items.length,1); assert.equal(result.items[0].event,"legacy_snapshot");
    assert.equal(result.items[0].details,copy.details);assert.equal(result.items[0].version,copy.version);
    assert.equal("completion" in result,false);
  });
  const history=async(id,before=null,staff=false)=>(await db.query(`select public.${staff?"staff":"member"}_data_request_history($1,$2) value`,[id,before])).rows[0].value;
  const fulfill=async(row,change={})=>{
    const body={result:"A scoped account-data copy was delivered through the verified private account channel.",method:"secure_delivery",evidence:"Private follow-up record COPY-123: recipient and successful delivery verified.",completedAt:new Date().toISOString(),key:randomUUID(),confirmed:true,...change};
    return (await db.query("select public.staff_fulfill_data_request($1,$2,$3,$4,$5,$6,$7,$8) value",[row.id,body.result,body.method,body.evidence,body.completedAt,row.version,body.key,body.confirmed])).rows[0].value.request;
  };
  await t.test("member follow-ups and staff replies append immutable private history",async()=>{
    await login();copy=(await memberCall("update",null,"Please include my recorded profile and account preferences.",null,copy.id,copy.version)).request;
    await login({id:owner,session:sid,aal:"aal2"});copy=await review(copy,"information_needed","Please confirm which account preferences you requested.");
    await login();copy=(await memberCall("update",null,"Include my saved country, visibility and display preferences.",null,copy.id,copy.version)).request;
    const thread=await history(copy.id);assert.equal(thread.items.length,4);
    assert.deepEqual(thread.items.map(x=>x.event),["member_update","staff_review","member_update","legacy_snapshot"]);
    assert.match(thread.items[2].details,/recorded profile/);assert.match(thread.items[1].reply,/confirm which account/);
    assert.equal(thread.items[0].reply,null);assert.equal(thread.items[1].details,null);
    assert.doesNotMatch(JSON.stringify(thread),/actor_id|staffId|evidence/);
    await login({id:other,session:otherSid,aal:"aal2"});await assert.rejects(history(copy.id),/Request not found/);
    assert.equal((await history(copy.id,null,true)).items.length,4);
    await admin("select 1");await assert.rejects(db.query("update private.account_data_request_history set reply='changed' where request_id=$1",[copy.id]),/cannot be changed/);
    await assert.rejects(db.query("delete from private.account_data_request_history where request_id=$1",[copy.id]),/cannot be changed/);
  });
  await t.test("completion needs separate current authority, ready state, concrete result, correct action and confirmation",async()=>{
    await login({id:other,session:otherSid,aal:"aal2"});assert.equal((await queue()).canFulfill,false);
    await assert.rejects(fulfill(copy),/Completion permission/);
    await login({id:owner,session:sid,aal:"aal1"});await assert.rejects(fulfill(copy),/Completion permission/);
    await login({id:owner,session:sid,aal:"aal2",amr:[{method:"oauth"}]});await assert.rejects(fulfill(copy),/Completion permission/);
    await login({id:owner,session:sid,aal:"aal2"});assert.equal((await queue()).canFulfill,true);
    await assert.rejects(fulfill(copy),/not ready for follow-up/);
    copy=await review(copy,"ready","Recipient identity and scope reviewed; secure delivery needs separate follow-up.");
    for(const change of[{result:"Done"},{evidence:"Checked"},{confirmed:false},{confirmed:null},{completedAt:"2100-01-01"},{completedAt:"infinity"},{completedAt:"2000-01-01"},{method:"account_erasure"}])await assert.rejects(fulfill(copy,change),/Describe the completed|action and date/);
    await assert.rejects(review(copy,"fulfilled"),/Choose a review decision/);
    await admin(`delete from auth.sessions where id='${sid}'`);await login({id:owner,session:sid,aal:"aal2"});await assert.rejects(fulfill(copy),/Completion permission/);await assert.rejects(history(copy.id,null,true),/Permission and an authenticator/);
    await admin(`insert into auth.sessions(id,user_id) values('${sid}','${owner}'); insert into public.staff_permission_overrides values('${other}','privacy.requests.fulfill',true)`);
  });
  await t.test("verified manual closure acts once, preserves history and private evidence, and permits a new request",async()=>{
    await login({id:other,session:otherSid,aal:"aal2"});assert.equal((await queue()).canFulfill,true);
    const before=copy, key=randomUUID(),completedAt=new Date().toISOString();copy=await fulfill(copy,{key,completedAt});assert.equal(copy.status,"fulfilled");assert.equal(copy.version,before.version+1);
    assert.equal((await fulfill(before,{key,completedAt})).version,copy.version);
    await assert.rejects(fulfill(before,{key,completedAt,result:"Different result attached to the same retry key is invalid."}),/completion key was already used/);
    await assert.rejects(fulfill(before),/changed or is not ready/);await assert.rejects(review(copy),/changed or closed/);
    const staffThread=await history(copy.id,null,true);assert.match(staffThread.completion.evidence,/COPY-123/);assert.equal(staffThread.items[0].event,"fulfilled");
    assert.ok((await queue("open")).items.every(x=>x.id!==copy.id));assert.equal((await queue("fulfilled")).items[0].id,copy.id);
    await login();const memberThread=await history(copy.id);assert.equal("completion" in memberThread,false);assert.doesNotMatch(JSON.stringify(memberThread),/COPY-123|actor_id|fingerprint/);
    assert.match(memberThread.items[0].reply,/scoped account-data copy/);
    await assert.rejects(memberCall("update",null,"A request cannot be edited after completed follow-up.",null,copy.id,copy.version),/request is closed/);
    await assert.rejects(memberCall("withdraw",null,null,null,copy.id,copy.version),/request is closed/);
    await admin("delete from public.rate_limit_buckets");await login();const fresh=await create("copy","A later request after completed follow-up.");assert.notEqual(fresh.id,copy.id);
    await admin("select 1");assert.equal((await db.query("select count(*)::int n from private.account_data_request_fulfillments")).rows[0].n,1);
    assert.equal((await db.query("select count(*)::int n from auth.users")).rows[0].n,3);assert.equal((await db.query("select count(*)::int n from auth.identities")).rows[0].n,3);
    const audit=JSON.stringify((await db.query("select * from public.staff_audit_events")).rows);assert.doesNotMatch(audit,/COPY-123|scoped account-data copy|saved country|recorded profile/);
    await assert.rejects(db.query("delete from private.account_data_request_fulfillments"),/cannot be changed/);
    await assert.rejects(db.query("update private.account_data_request_fulfillments set evidence='edited evidence'"),/cannot be changed/);
  });
  await t.test("owner completion handles each request kind and removed custom grants take effect immediately",async()=>{
    await admin("delete from public.rate_limit_buckets");await login();
    const correction=(await memberCall()).items.find(x=>x.kind==="correction"&&x.status==="submitted"), erasure=await create("delete","Please review this separate erasure request.");
    for(const [request,method,result]of [[correction,"data_correction","The requested country setting was corrected and the saved profile was checked."],[erasure,"account_erasure","The requested erasure was completed in the separately verified operation; retained records were explained."]]){
      await login({id:owner,session:sid,aal:"aal2"});const ready=await review(request,"ready","Scope reviewed and ready for the separately verified follow-up.");
      const done=await fulfill(ready,{method,result});assert.equal(done.status,"fulfilled");assert.equal(done.staffReply,result);
    }
    await admin(`update public.staff_permission_overrides set allowed=false where user_id='${other}' and permission_key='privacy.requests.fulfill'`);
    await login({id:other,session:otherSid,aal:"aal2"});assert.equal((await queue()).canFulfill,false);await assert.rejects(fulfill(copy),/Completion permission/);
    await admin(`update public.staff_permission_overrides set allowed=true where user_id='${other}' and permission_key='privacy.requests.fulfill'; update public.staff_memberships set status='removed' where user_id='${other}'`);
    await login({id:other,session:otherSid,aal:"aal2"});await assert.rejects(fulfill(copy),/Completion permission/);await assert.rejects(history(copy.id,null,true),/Permission and an authenticator/);
    await admin(`update public.staff_memberships set status='active' where user_id='${other}'`);
    assert.equal((await db.query("select count(*)::int n from auth.users")).rows[0].n,3);assert.equal((await db.query("select count(*)::int n from auth.identities")).rows[0].n,3);
  });
  await t.test("history pagination is bounded and private reads reject expired sessions and raw role access",async()=>{
    await admin("select 1");
    // Trusted offline fixture supplies a long history to exercise exact pagination.
    for(let version=100;version<130;version++)await db.query("insert into private.account_data_request_history(request_id,version,event,status,details,reply) values($1,$2,'staff_review','reviewing','','Fixture earlier message')",[copy.id,version]);
    await login();const first=await history(copy.id),second=await history(copy.id,first.next);assert.equal(first.items.length,25);assert.ok(first.next);assert.equal(new Set([...first.items,...second.items].map(x=>x.version)).size,first.items.length+second.items.length);
    await assert.rejects(history(copy.id,0),/Refresh the request history/);
    await admin(`update auth.sessions set not_after=now()-interval '1 second' where id='${memberSid}'`);await login();await assert.rejects(history(copy.id),/active, unrestricted/);
    await admin("update auth.sessions set not_after=null");
    for(const role of ["anon","authenticated","service_role"]){await db.exec(`reset role;set role ${role}`);for(const table of["account_data_request_history","account_data_request_fulfillments"])await assert.rejects(db.query(`select * from private.${table}`),/permission denied/);}
    for(const role of ["anon","service_role"]){await db.exec(`reset role;set role ${role}`);await assert.rejects(history(copy.id),/permission denied/);await assert.rejects(history(copy.id,null,true),/permission denied/);await assert.rejects(fulfill(copy),/permission denied/);}
    await admin("select 1");for(const table of["account_data_request_history","account_data_request_fulfillments"])assert.equal((await db.query(`select relrowsecurity from pg_class where oid='private.${table}'::regclass`)).rows[0].relrowsecurity,true);
  });

});
