import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { privacyFileFixture } from "./privacy-file-fixture.mjs";

test("approved file snapshots retain member/session isolation and truthful receipts", async t => {
  const h = await privacyFileFixture(t), { db, a, b, owner, admin, login, call, create, review, approve, generate, sid } = h;
  const assetId = randomUUID(), otherId = randomUUID(), sha = "a".repeat(64), otherSha = "b".repeat(64);
  await admin(`insert into public.uploaded_assets(id,owner_id,bucket,object_path,media_type,mime_type,byte_size,sha256)
    values('${assetId}','${a}','profile-media','${a}/own.png','avatar','image/png',100,'${sha}'),
    ('${otherId}','${b}','profile-media','${b}/other.png','avatar','image/png',200,'${otherSha}');
    insert into storage.objects(bucket_id,name,metadata) values('profile-media','${a}/own.png','{"size":100}'),('profile-media','${b}/other.png','{"size":200}');`);
  await login(); let row = await create(); await login(owner); row = await approve(await review(row)); await login(); const copy = await generate(row);
  let file;
  await t.test("manifest covers the approved JSON upload snapshot, not other accounts or new uploads", async () => {
    const result = await call("member_list_data_export_files", [copy.id]);
    assert.equal(result.files.length, 1); file = result.files[0]; assert.equal(file.byteSize, 100); assert.equal(file.sha256, sha);
    assert.equal(result.copy.files.count, 1); assert.equal(result.copy.files.received, 0);
    assert.doesNotMatch(JSON.stringify(result.files), /bucket|objectPath|other.png/);
    assert.deepEqual((await call("member_list_data_export_files", [copy.id])).files, result.files, "repeated preparation retains the same file IDs");
    const descriptor = await call("member_read_data_export_file", [copy.id, file.id]); assert.equal(descriptor.objectPath, `${a}/own.png`);
  });
  await t.test("another account and staff cannot list, read or receive this member's files", async () => {
    for (const user of [b, owner]) {
      await login(user);
      await assert.rejects(call("member_list_data_export_files", [copy.id]), /not found/);
      await assert.rejects(call("member_read_data_export_file", [copy.id, file.id]), /not found/);
      await assert.rejects(call("member_receive_data_export_file", [copy.id, file.id, sha, true]), /not found/);
    }
    await login(); await assert.rejects(call("member_read_data_export_file", [copy.id, randomUUID()]), /not found/);
  });
  await t.test("file receipts require the exact hash and explicit confirmation and never complete the request", async () => {
    await login(); await assert.rejects(call("member_receive_data_export_file", [copy.id, file.id, otherSha, true]), /Save and check/);
    await assert.rejects(call("member_receive_data_export_file", [copy.id, file.id, sha, false]), /Save and check/);
    const received = await call("member_receive_data_export_file", [copy.id, file.id, sha, true]);
    assert.ok(received.receivedAt); assert.equal((await call("member_receive_data_export_file", [copy.id, file.id, sha, true])).receivedAt, received.receivedAt);
    assert.equal((await call("member_list_data_export_files", [copy.id])).copy.files.received, 1);
    assert.equal((await call("member_data_requests", ["list"])).items[0].status, "ready");
  });
  await t.test("changed or reassigned metadata cannot be read from an older approval", async () => {
    await admin(`update public.uploaded_assets set sha256='${otherSha}' where id='${assetId}'`); await login();
    await assert.rejects(call("member_read_data_export_file", [copy.id, file.id]), /changed/);
    await admin(`update public.uploaded_assets set sha256='${sha}',owner_id='${b}' where id='${assetId}'`); await login();
    await assert.rejects(call("member_read_data_export_file", [copy.id, file.id]), /changed/);
    await admin(`update public.uploaded_assets set owner_id='${a}' where id='${assetId}'`); await login();
  });
  await t.test("revocation, stale OAuth and expiry deny files independently of the HTTP route", async () => {
    await login(a, { amr: [{ method: "oauth", timestamp: Math.floor(Date.now() / 1000) - 601 }] });
    await assert.rejects(call("member_read_data_export_file", [copy.id, file.id]), /Sign in again/);
    await admin(`delete from auth.sessions where id='${sid(a)}'`); await login();
    await assert.rejects(call("member_read_data_export_file", [copy.id, file.id]), /active, unrestricted/);
    await admin(`insert into auth.sessions(id,user_id) values('${sid(a)}','${a}');update private.member_data_exports set expires_at=now()-interval '1 second' where id='${copy.id}'`); await login();
    await assert.rejects(call("member_read_data_export_file", [copy.id, file.id]), /expired/);
    await admin(`update private.member_data_exports set expires_at=now()+interval '1 hour' where id='${copy.id}'`); await login();
  });
  await t.test("unregistered storage or missing files cannot silently become a complete manifest", async () => {
    await admin(`insert into storage.objects(bucket_id,name,metadata) values('profile-media','${b}/orphan.png','{"size":10}')`);
    await login(b); let other = await create(); await login(owner); other = await approve(await review(other)); await login(b); const otherCopy = await generate(other);
    await assert.rejects(call("member_list_data_export_files", [otherCopy.id]), /reconciliation/);
    await admin(`delete from storage.objects where name='${b}/orphan.png';delete from storage.objects where name='${b}/other.png'`); await login(b);
    await assert.rejects(call("member_list_data_export_files", [otherCopy.id]), /could not be confirmed/);
    await admin(`insert into storage.objects(bucket_id,name,metadata) values('profile-media','${b}/other.png','{"size":200}')`); await login(b);
    assert.equal((await call("member_list_data_export_files", [otherCopy.id])).files.length, 1);
  });
  await t.test("a withdrawn request immediately denies file reads and receipts", async () => {
    await login(); await call("member_data_requests", ["withdraw", null, null, null, row.id, row.version]);
    await assert.rejects(call("member_read_data_export_file", [copy.id, file.id]), /request changed/);
    await assert.rejects(call("member_receive_data_export_file", [copy.id, file.id, sha, true]), /request changed/);
  });
  await t.test("private file rows and functions are not raw service/anonymous APIs", async () => {
    for (const role of ["anon", "authenticated", "service_role"]) {
      await admin(`set role ${role}`); await assert.rejects(db.query("select * from private.member_data_export_files"), /permission denied/);
    }
    for (const role of ["anon", "service_role"]) {
      await admin(`set role ${role}`); await assert.rejects(call("member_list_data_export_files", [copy.id]), /permission denied/);
    }
    await admin(); assert.doesNotMatch(JSON.stringify((await db.query("select * from public.staff_audit_events")).rows), /own.png|other.png/);
  });
});
