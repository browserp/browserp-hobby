import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { privacyFileFixture } from "./privacy-file-fixture.mjs";

const read = name => readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), "utf8");
const fn = (sql, name) => sql.match(new RegExp(`create(?: or replace)? function ${name.replaceAll(".", "\\.")}\\([\\s\\S]*?\\n\\$\\$;`))[0];

test("moderation records join the approved private account copy and existing media/erasure inventory", async t => {
  const { db, a, b, owner, admin, login, call, create, review, approve, generate } = await privacyFileFixture(t);
  const security = read("20260904092528_enforce_member_security_boundaries.sql");
  await admin(read("20260906020500_private_advertising_enquiries.sql"));
  // Duty entry is outside this export fixture; deny that unrelated dependency.
  await admin("create function public.staff_authenticator_access() returns boolean language sql as $$select false$$;");
  for (const name of ["20260908100259_explicit_staff_duty_sessions.sql", "20260908101556_member_recommendation_preferences.sql"]) await admin(read(name));
  await admin(fn(security, "public.member_server_interaction"));
  await admin(read("20260908100413_comment_identity_and_replies.sql"));
  await admin(read("20260908101754_member_export_duty_and_comment_context.sql"));
  await admin(fn(security, "public.member_set_profile_avatar"));
  await admin(fn(read("20260908112653_member_preference_reply_session_deadlines.sql"), "private.require_member_write_session"));
  await admin("alter table auth.users add raw_user_meta_data jsonb default '{}';");
  await admin(read("20260909092918_guarded_content_moderation.sql"));

  const server = randomUUID(), comment = randomUUID(), otherComment = randomUUID();
  const assets = [randomUUID(), randomUUID(), randomUUID()], otherAsset = randomUUID();
  await admin(`update public.profiles set profile_visibility='private' where id='${a}';
    insert into public.platforms(id,name,short_name) values('fivem','FiveM','FiveM');
    insert into public.servers(id,owner_id,platform_id,name,slug,description,region,status)
    values('${server}','${b}','fivem','Export fixture','export-fixture','A listing for the isolated account export regression.','Europe','published');
    insert into public.server_comments(id,server_id,author_id,body,status) values
    ('${comment}','${server}','${a}','OWN_COMMENT','pending_review'),
    ('${otherComment}','${server}','${b}','FORBIDDEN_OTHER_COMMENT','pending_review');
    update public.server_comments set body='OWN_EDITED_COMMENT' where id='${comment}';
    update private.content_submissions set status='blocked',reason='An owner-visible blocked decision.',
      appeal_status='pending',appeal_statement='OWN_APPEAL',appealed_at=now(),reviewed_by='${owner}',
      check_result='{"decision":"block","reason":"OWN_CHECK_REASON","policyVersion":"content-v1","checker":"local","details":{"code":"own-code","signalCodes":["own-signal"],"raw":"FORBIDDEN_INTERNAL_DETAILS"},"raw":"FORBIDDEN_PROVIDER_RESPONSE"}',
      checked_at=now(),check_applied_at=now()
    where owner_id='${a}' and status='pending_review';
    insert into private.content_submissions(owner_id,kind,target_id,content_text,fingerprint,status)
    values('${a}','display_name','${a}','OWN_CANDIDATE_NAME','own-name','published');`);
  for (let i = 0; i < assets.length; i++) {
    const status = ["quarantined", "approved", "rejected"][i];
    await admin(`insert into public.uploaded_assets(id,owner_id,bucket,object_path,media_type,mime_type,byte_size,sha256,moderation_status)
      values('${assets[i]}','${a}','uploads-quarantine','${a}/avatar-${i}.png','avatar','image/png',100,'${"a".repeat(64)}','${status}');
      insert into storage.objects(bucket_id,name,owner_id,metadata) values('uploads-quarantine','${a}/avatar-${i}.png','${a}','{"size":100}');
      insert into private.content_submissions(owner_id,kind,target_id,asset_id,source_url,fingerprint,status)
      values('${a}','avatar','${a}','${assets[i]}','https://cdn.discordapp.com/avatars/own.png','avatar-${i}','${["pending_review", "published", "blocked"][i]}');`);
  }
  await admin(`insert into public.uploaded_assets(id,owner_id,bucket,object_path,media_type,mime_type,byte_size,sha256)
    values('${otherAsset}','${b}','uploads-quarantine','${b}/other.png','avatar','image/png',200,'${"b".repeat(64)}');
    insert into storage.objects(bucket_id,name,owner_id,metadata) values('uploads-quarantine','${b}/other.png','${b}','{"size":200}');`);

  let row, copy, content;
  await t.test("the real approved generation path gains only the owner's stored submissions", async () => {
    await login(); row = await create(); await login(owner); row = await approve(await review(row));
    await login(); const before = await generate(row);
    const baseline = JSON.parse((await call("member_read_data_export", [before.id])).content);
    assert.equal("contentModeration" in baseline.collections, false);
    await admin(read("20260909104051_member_export_content_moderation.sql"));
    await admin(`update private.member_data_exports set expires_at=now()-interval '1 second' where id='${before.id}';delete from public.rate_limit_buckets;`);
    await login(); copy = await generate(row); const result = await call("member_read_data_export", [copy.id]);
    content = JSON.parse(result.content);
    assert.notEqual(copy.id, before.id);
    assert.equal(createHash("sha256").update(result.content).digest("hex"), copy.sha256);
    assert.equal(Buffer.byteLength(result.content), copy.byteSize);
    const { contentModeration, ...preserved } = content.collections;
    assert.deepEqual(preserved, baseline.collections);
    assert.equal(content.counts.contentModeration, 6);
    assert.equal(contentModeration.length, 6);
    assert.deepEqual(new Set(contentModeration.map(x => x.status)), new Set(["superseded", "blocked", "published", "pending_review"]));
    const appealed = contentModeration.find(x => x.appeal_status === "pending");
    assert.equal(appealed.appeal_statement, "OWN_APPEAL");
    assert.equal(appealed.content_text, "OWN_EDITED_COMMENT");
    assert.equal(appealed.check_result.reason, "OWN_CHECK_REASON");
    assert.deepEqual(appealed.check_result.details.signalCodes, ["own-signal"]);
    assert.ok(appealed.checked_at && appealed.check_applied_at && appealed.appealed_at);
    assert.equal(content.collections.profile[0].profile_visibility, "private");
    assert.doesNotMatch(result.content, /FORBIDDEN|OTHER_PRIVATE|OTHER_ACCOUNT|reviewed_by/);
    assert.ok(content.pending.some(x => x.category === "uploaded_files"));
    await login(b); await assert.rejects(call("member_read_data_export", [copy.id]), /not found/);
  });

  await t.test("quarantined, approved and rejected avatars retain separate owner-only file delivery", async () => {
    await login(); const manifest = await call("member_list_data_export_files", [copy.id]);
    assert.equal(manifest.files.length, 3);
    assert.equal(manifest.copy.files.received, 0);
    assert.doesNotMatch(JSON.stringify(manifest.files), /bucket|objectPath|other.png/);
    for (const file of manifest.files) {
      const descriptor = await call("member_read_data_export_file", [copy.id, file.id]);
      assert.equal(descriptor.bucket, "uploads-quarantine");
      assert.ok(descriptor.objectPath.startsWith(`${a}/avatar-`));
    }
    await login(b); await assert.rejects(call("member_list_data_export_files", [copy.id]), /not found/);
    await assert.rejects(call("member_read_data_export_file", [copy.id, manifest.files[0].id]), /not found/);
  });

  await t.test("the existing count-only erasure review discovers real moderation cascades and orphan quarantine objects", async () => {
    await admin(read("20260908101606_account_erasure_preflight.sql"));
    await admin(`insert into storage.objects(bucket_id,name,metadata) values('uploads-quarantine','${a}/orphan.png','{"size":10}');`);
    await login(); const deletion = (await call("member_data_requests", ["create", "delete", "Review erasure of my account.", randomUUID()])).request;
    await login(owner); const report = await call("staff_account_erasure_preflight", [deletion.id, deletion.version]);
    assert.ok(report.dependencies.some(x => x.relation === "private.content_submissions" && x.count === 6 && x.via.at(-1)?.deleteAction === "cascade"));
    assert.equal(report.summary.storedObjects, 4);
    assert.equal(report.executionEnabled, false);
    assert.equal(report.coverage.fullErasureInventory, false);
    assert.doesNotMatch(JSON.stringify(report), /OWN_COMMENT|OWN_APPEAL|OWN_CANDIDATE|orphan.png|avatar-0.png|FORBIDDEN/);
    await admin();
    assert.equal((await db.query("select count(*)::int n from private.content_submissions where owner_id=$1", [a])).rows[0].n, 6);
    assert.equal((await db.query("select count(*)::int n from storage.objects")).rows[0].n, 5);
    const refs = (await db.query("select confdeltype from pg_constraint where conrelid='private.content_submissions'::regclass and contype='f'")).rows;
    assert.equal(refs.filter(x => x.confdeltype === "c").length, 3);
    assert.equal(refs.filter(x => x.confdeltype === "n").length, 2);
  });

  await t.test("private helpers remain unavailable and a privileged collector still binds the current account", async () => {
    for (const role of ["anon", "authenticated", "service_role"]) {
      await admin(`set role ${role}`);
      await assert.rejects(db.query("select * from private.content_submissions"), /permission denied/);
      await assert.rejects(db.query("select private.member_export_records($1)", [a]), /permission denied/);
    }
    await login(); await admin();
    await assert.rejects(db.query("select private.member_export_records($1)", [b]), /Only your own/);
    const acl = await db.query("select has_function_privilege('authenticated','private.content_export_item(private.content_submissions)','EXECUTE') allowed");
    assert.equal(acl.rows[0].allowed, false);
  });

  await t.test("large moderation collections fail explicitly without truncation or oversized aggregation", async () => {
    await login(); await admin("begin");
    try {
      await db.query("insert into private.content_submissions(owner_id,kind,target_id,content_text,fingerprint,status) select $1,'display_name',$1,'Stored candidate','bulk-'||n,'superseded' from generate_series(1,1995) n", [a]);
      await assert.rejects(db.query("select private.member_export_records($1)", [a]), e => e.code === "PT413");
    } finally { await db.exec("rollback"); }
    await db.exec("begin");
    try {
      await db.query("update private.content_submissions set check_result=jsonb_build_object('reason',repeat('x',2000001)) where owner_id=$1 and kind='display_name'", [a]);
      await assert.rejects(db.query("select private.member_export_records($1)", [a]), e => e.code === "PT413");
    } finally { await db.exec("rollback"); }
  });
});
