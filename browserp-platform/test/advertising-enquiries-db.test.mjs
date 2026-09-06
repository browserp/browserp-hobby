import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
const read = name => readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), "utf8");
const fn = (source, name) => source.match(new RegExp(`create or replace function ${name.replaceAll(".", "\\.")}\\([\\s\\S]*?\\n\\$\\$;`))[0];
const owner="00000000-0000-4000-8000-000000000001", member="00000000-0000-4000-8000-000000000002", other="00000000-0000-4000-8000-000000000003";
const sid="aaaaaaaa-0000-4000-8000-000000000001", memberSid="aaaaaaaa-0000-4000-8000-000000000002", otherSid="aaaaaaaa-0000-4000-8000-000000000003";

test("advertising enquiry operations enforce live ownership, staff MFA, bounded writes and private replies",async t=>{
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
    insert into public.staff_role_permissions values('owner','adverts.manage');
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
  await db.exec(`create function private.member_export_records(uuid) returns jsonb language sql as $$select '{"collections":{"fixture":[]},"counts":{"fixture":0}}'::jsonb$$;`);
  await db.exec(read("20260906020500_private_advertising_enquiries.sql"));
  const admin=async sql=>{await db.exec("reset role");await db.exec(sql);};
  const login=async({id=member,session=memberSid,aal="aal1",provider=id===member?"google":"discord",amr=[{method:"oauth"},{method:"totp"}]}={})=>{
    await db.exec("reset role");await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false)",[id,JSON.stringify({sub:id,session_id:session,aal,app_metadata:{provider},amr})]);await db.exec("set role authenticated");
  };
  const memberCall=async(action="list",data={},key=null,id=null,version=null,time=null,before=null,limit=25)=>(await db.query("select public.member_advertising_enquiries($1,$2,$3,$4,$5,$6,$7,$8) value",[action,data,key,id,version,time,before,limit])).rows[0].value;
  const details={subject:"Community launch campaign",destinationUrl:"https://community.example.com/join?ref=browserp",placement:"homepage",message:"Please discuss a community launch campaign with us."};
  const create=async(data=details,key=randomUUID())=>(await memberCall("create",data,key)).enquiry;
  const review=async(row,status="reviewing",reply="",key=randomUUID())=>(await db.query("select public.staff_review_advertising_enquiry($1,$2,$3,$4,$5) value",[row.id,row.version,status,reply,key])).rows[0].value.enquiry;
  const queue=async(status="open",time=null,id=null,limit=25)=>(await db.query("select public.staff_advertising_enquiries($1,$2,$3,$4) value",[status,time,id,limit])).rows[0].value;
  const withdraw=async(row,key=randomUUID())=>(await memberCall("withdraw",{},key,row.id,row.version)).enquiry;
  let first,firstKey,second;
  await t.test("member creation is atomic, retries are immutable and projections stay private",async()=>{
    await login();firstKey=randomUUID();first=await create(details,firstKey);assert.equal(first.version,1);assert.equal(first.status,"submitted");
    assert.equal((await create(details,firstKey)).id,first.id);
    await assert.rejects(create({...details,message:"A different request attached to the same retry key."},firstKey),/different enquiry details/);
    const own=(await memberCall()).items;assert.equal(own.length,1);assert.doesNotMatch(JSON.stringify(own),/user_id|accountId|displayName|fingerprint|request_key/);
    await login({id:other,session:otherSid});assert.deepEqual((await memberCall()).items,[]);await assert.rejects(withdraw(first),/not found/);
    await login();second=await create({...details,subject:"Directory placement discussion"});
    await admin("select 1");assert.equal((await db.query("select count(*)::int n from private.advertising_enquiry_keys")).rows[0].n,2);
  });
  await t.test("direct RPC validation rejects unsafe links, unknown data, control characters and invalid lengths before writes",async()=>{
    await login();for(const destinationUrl of["http://example.com","https://127.0.0.1/","https://[::1]/","https://localhost/","https://example.local/","https://user:pass@example.com","https://example.com:443/","https://example.com\\evil","https://example.com/white space","https://example.com/\u0001"]){await assert.rejects(create({...details,destinationUrl}),/HTTPS|details/);}
    for(const extra of[{subject:"x"},{subject:"Line\nsubject"},{message:"Short"},{message:"a".repeat(2001)},{placement:"paid"},{status:"published"},{ownerId:other}])await assert.rejects(create({...details,...extra}),/details|HTTPS/);
    await assert.rejects(create([]));await assert.rejects(memberCall("create",details),/enquiry action/);
    await admin("select 1");assert.equal((await db.query("select count(*)::int n from private.advertising_enquiries")).rows[0].n,2);
  });
  await t.test("revoked, cross-account, expired, anonymous and banned sessions cannot list, create or replay",async()=>{
    for(const [change,restore]of[
      [`delete from auth.sessions where id='${memberSid}'`,`insert into auth.sessions(id,user_id) values('${memberSid}','${member}')`],
      [`update auth.sessions set not_after=now()-interval '1 second' where id='${memberSid}'`,"update auth.sessions set not_after=null"],
      [`update auth.users set is_anonymous=true where id='${member}'`,"update auth.users set is_anonymous=false"],
      [`insert into public.security_bans values('${member}','account',null,now(),null)`,"delete from public.security_bans"]
    ]){await admin(change);await login();for(const operation of[()=>memberCall(),()=>create(),()=>create(details,firstKey),()=>withdraw(first)])await assert.rejects(operation(),/active, unrestricted/);await admin(restore);}
    await login({session:otherSid});await assert.rejects(memberCall(),/active, unrestricted/);
  });
  await t.test("review requires current allowed Discord staff, TOTP, AAL2 and adverts.manage",async()=>{
    for(const change of[{},{id:other,session:otherSid,aal:"aal2"},{id:owner,session:sid,aal:"aal1"},{id:owner,session:sid,aal:"aal2",amr:[{method:"oauth"}]},{id:owner,session:sid,aal:"aal2",provider:"google"}]){
      await login(change);assert.equal((await db.query("select public.staff_advertising_enquiry_access() value")).rows[0].value,false);await assert.rejects(queue(),/Permission and an authenticator/);await assert.rejects(review(first),/Permission and an authenticator/);
    }
    await admin(`insert into public.staff_permission_overrides values('${other}','adverts.manage',true)`);await login({id:other,session:otherSid,aal:"aal2"});assert.equal((await queue()).items.length,2);
    for(const [change,restore]of[
      ["update private.discord_owner_allowlist set enabled=false where discord_user_id='other-discord'","update private.discord_owner_allowlist set enabled=true"],
      [`delete from auth.sessions where id='${otherSid}'`,`insert into auth.sessions(id,user_id) values('${otherSid}','${other}')`],
      [`update public.staff_memberships set status='suspended' where user_id='${other}'`,"update public.staff_memberships set status='active'"],
      ["update public.staff_permission_overrides set allowed=false","update public.staff_permission_overrides set allowed=true"]
    ]){await admin(change);await login({id:other,session:otherSid,aal:"aal2"});await assert.rejects(queue(),/Permission and an authenticator/);await admin(restore);}
  });
  await t.test("review/withdraw versions prevent stale decisions and replies remain immutable",async()=>{
    await login({id:owner,session:sid,aal:"aal2"});const old=first,key=randomUUID();first=await review(first,"reviewing","",key);assert.equal(first.version,2);assert.equal((await review(old,"reviewing","",key)).version,2);
    await assert.rejects(review(old,"closed","A different outcome for this enquiry.",key),/different review/);await assert.rejects(review(old),/changed or closed/);
    await login();await assert.rejects(withdraw(old),/changed or closed/);
    await login({id:owner,session:sid,aal:"aal2"});await assert.rejects(review(first,"replied","Short"),/at least 20/);
    const reply="We can discuss a clearly labelled homepage placement for your community.";
    first=await review(first,"replied",reply);assert.equal(first.reply,reply);await assert.rejects(review(first,"replied","Replace the earlier sent message with this one."),/unanswered/);
    await assert.rejects(review(first,"closed","A replacement that should not overwrite the existing reply."),/kept unchanged/);
    const before=first;first=await review(first,"closed");assert.equal(first.reply,reply);assert.equal(first.status,"closed");await assert.rejects(review(first),/changed or closed/);
    await login();assert.equal((await memberCall()).items.find(x=>x.id===first.id).reply,reply);await assert.rejects(withdraw(before),/changed or closed/);assert.equal((await create(details,firstKey)).status,"closed");
    await admin("select 1");const audit=(await db.query("select * from public.staff_audit_events")).rows;assert.equal(audit.length,3);assert.doesNotMatch(JSON.stringify(audit),/Community launch|discuss a clearly|community.example|Please discuss/);
  });
  await t.test("first reply can close an enquiry; withdraw preserves a sent reply and stale staff cannot resurrect it",async()=>{
    await login({id:owner,session:sid,aal:"aal2"});await assert.rejects(review(second,"closed"),/Explain the outcome/);
    second=await review(second,"replied","Please return when your campaign destination is ready for review.");
    await login();const old=second,key=randomUUID();second=await withdraw(second,key);assert.equal(second.reply,old.reply);assert.equal((await withdraw(old,key)).version,second.version);
    await assert.rejects(withdraw(second,key),/different enquiry details/);
    await login({id:owner,session:sid,aal:"aal2"});await assert.rejects(review(old,"closed"),/changed or closed/);
    await login();const third=await create({...details,subject:"One final campaign discussion"});await login({id:owner,session:sid,aal:"aal2"});const closed=await review(third,"closed","We cannot offer that placement currently. Thank you for asking.");assert.equal(closed.status,"closed");assert.ok(closed.reply);
    await login();await assert.rejects(create(),/Too many requests/);
  });
  await t.test("failed audit or receipt writes roll back the entire decision/create",async()=>{
    await admin(`delete from public.rate_limit_buckets;alter table public.staff_audit_events add constraint fixture_deny_advertising check(action<>'advertising.enquiry.reviewed') not valid;`);
    await login();const row=await create();await login({id:owner,session:sid,aal:"aal2"});await assert.rejects(review(row),/fixture_deny_advertising/);
    assert.equal((await queue()).items.find(x=>x.id===row.id).version,1);
    await admin(`alter table public.staff_audit_events drop constraint fixture_deny_advertising;alter table private.advertising_enquiry_keys add constraint fixture_deny_receipt check(false) not valid;`);
    const count=(await db.query("select count(*)::int n from private.advertising_enquiries")).rows[0].n;
    await login();await assert.rejects(create({...details,subject:"Should roll back"}),/fixture_deny_receipt/);
    await admin(`alter table private.advertising_enquiry_keys drop constraint fixture_deny_receipt`);assert.equal((await db.query("select count(*)::int n from private.advertising_enquiries")).rows[0].n,count);
  });
  await t.test("three open enquiries limit is enforced by the database independently of page controls",async()=>{
    await admin("delete from public.rate_limit_buckets");await login({id:other,session:otherSid});for(let i=0;i<3;i++)await create({...details,subject:`Other campaign ${i}`});await assert.rejects(create(),/three open enquiries/);
  });
  await t.test("cursor ties paginate without duplicates and staff filters are exact",async()=>{
    await admin(`insert into private.advertising_enquiries(user_id,subject,destination_url,placement,message,created_at) select '${member}','Paging fixture '||n,'https://example.com/','any','A valid paging fixture enquiry message.', '2026-01-01' from generate_series(1,28)n;`);
    await login();const all=[];let page=await memberCall();do{all.push(...page.items);page=page.next?await memberCall("list",{},null,null,null,page.next.createdAt,page.next.id):null;}while(page);
    assert.equal(new Set(all.map(x=>x.id)).size,all.length);assert.equal(all.filter(x=>x.subject.startsWith("Paging fixture")).length,28);
    await login({id:owner,session:sid,aal:"aal2"});assert.ok((await queue("closed")).items.every(x=>x.status==="closed"));assert.ok((await queue()).items.every(x=>!["closed","withdrawn"].includes(x.status)));
    await assert.rejects(queue("invented"),/valid enquiry filters/);await assert.rejects(queue("all",null,first.id),/valid enquiry filters/);
    assert.ok((await queue("all")).items.every(x=>x.accountId&&x.displayName));
  });
  await t.test("combined export row budget includes enquiries even when each collection fits",async()=>{
    await admin(`create or replace function private.member_export_records_before_advertising(uuid) returns jsonb language sql as $$select '{"collections":{"boundedFixture":[]},"counts":{"boundedFixture":9999}}'::jsonb$$;`);
    await login();await admin("select 1");await assert.rejects(db.query("select private.member_export_records($1)",[member]),/larger export/);
    await login({id:other,session:otherSid});await admin("select 1");await assert.rejects(db.query("select private.member_export_records($1)",[member]),/Only your own/);
  });
  await t.test("raw records, receipts and helper functions are unavailable to every API role",async()=>{
    for(const role of["anon","authenticated","service_role"]){await admin(`set role ${role}`);for(const name of["advertising_enquiries","advertising_enquiry_keys"])for(const verb of["select * from","delete from"])await assert.rejects(db.query(`${verb} private.${name}`),/permission denied/);await assert.rejects(db.query("select private.advertising_enquiry_page(null,'all',null,null,25,true)"),/permission denied/);
      if(role!=="authenticated"){await assert.rejects(memberCall(),/permission denied/);await assert.rejects(queue(),/permission denied/);await assert.rejects(review(first),/permission denied/);}}
    await admin("select 1");for(const name of["advertising_enquiries","advertising_enquiry_keys"]){assert.equal((await db.query(`select relrowsecurity from pg_class where oid='private.${name}'::regclass`)).rows[0].relrowsecurity,true);for(const role of["anon","authenticated","service_role"])assert.equal((await db.query("select has_table_privilege($1,$2,'SELECT,INSERT,UPDATE,DELETE') allowed",[role,`private.${name}`])).rows[0].allowed,false);}
  });
});
