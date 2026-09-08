import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { FILE_EXPORT_CHUNK_BYTES, readMemberFileChunk } from "../lib/member-file-export.js";
import { privacyFileFixture } from "./privacy-file-fixture.mjs";

test("file authorization is re-read after the quota boundary and uses elapsed wall time", async t => {
  const { db, a, b, owner, sid, admin, login, call, create, review, approve, generate } = await privacyFileFixture(t);
  const assetId=randomUUID(), sha="e".repeat(64);
  await admin(`insert into public.uploaded_assets(id,owner_id,bucket,object_path,media_type,mime_type,byte_size,sha256)
    values('${assetId}','${a}','profile-media','${a}/quota-boundary.png','avatar','image/png',10,'${sha}');
    insert into storage.objects(bucket_id,name,metadata) values('profile-media','${a}/quota-boundary.png','{"size":10}');`);
  await login();let row=await create();await login(owner);row=await approve(await review(row));
  await login();const copy=await generate(row),file=(await call("member_list_data_export_files",[copy.id])).files[0];
  // Inject changes/delay at the real quota boundary in one disposable database.
  // This does not claim two independent connections or real lock contention.
  await admin(`alter function private.enforce_member_rate_limit(text,integer,integer) rename to fixture_file_original_quota;
    create function private.enforce_member_rate_limit(p_action text,p_limit integer,p_window_seconds integer)
    returns void language plpgsql security definer set search_path='' as $$
    declare mode text:=current_setting('fixture.file_quota',true);
    begin
      perform private.fixture_file_original_quota(p_action,p_limit,p_window_seconds);
      if p_action<>'data-export-file-read' then return; end if;
      if mode='delay' then perform pg_catalog.pg_sleep(0.2);
      elsif mode='oauth_delay' then perform pg_catalog.pg_sleep(1.1);
      elsif mode='revoke' then delete from auth.sessions where id='${sid(a)}';
      elsif mode='withdraw' then update private.account_data_requests set status='withdrawn',version=version+1 where id='${row.id}';
      elsif mode='prune' then update private.member_data_exports set payload=null where id='${copy.id}';
      elsif mode='asset_owner' then update public.uploaded_assets set owner_id='${b}' where id='${assetId}';
      elsif mode='asset_identity' then update public.uploaded_assets set sha256=repeat('f',64) where id='${assetId}';
      elsif mode='quota_reached' then raise exception 'Unauthenticated request reached quota';
      end if;
    end;$$;
    revoke all on function private.enforce_member_rate_limit(text,integer,integer) from public,anon,authenticated,service_role;`);
  const readFile=()=>call("member_read_data_export_file",[copy.id,file.id]);
  for (const [mode,message] of [["revoke",/active, unrestricted|Sign in again/],["withdraw",/request changed/],
    ["prune",/expired/],["asset_owner",/uploaded file changed/],["asset_identity",/uploaded file changed/]]) {
    await t.test(`${mode} at quota prevents descriptor release`,async()=>{
      await admin("begin");
      try {
        await db.query("select set_config('fixture.file_quota',$1,true)",[mode]);await login();
        await assert.rejects(readFile(),message);
      } finally {await db.exec("rollback");}
      await login();assert.equal((await readFile()).id,file.id);
    });
  }
  for (const target of ["copy","session","oauth","scheduled_ban"]) {
    await t.test(`${target} expiry during quota delay does not inherit transaction-start validity`,async()=>{
      await admin("begin");
      try {
        await db.query("select set_config('fixture.file_quota','delay',true)");
        if(target==="copy")await db.query("update private.member_data_exports set expires_at=clock_timestamp()+interval '0.1 seconds' where id=$1",[copy.id]);
        if(target==="session")await db.query("update auth.sessions set not_after=clock_timestamp()+interval '0.1 seconds' where id=$1",[sid(a)]);
        if(target==="scheduled_ban")await db.query("insert into public.security_bans(user_id,target_type,target_hash,public_reference,reason_code,reason,actor_id,starts_at) values($1,'account',repeat('a',64),'BRP-1234567890','fixture','Scheduled fixture restriction',$2,clock_timestamp()+interval '0.1 seconds')",[a,owner]);
        await login();
        if(target==="oauth") {
          // Original OAuth timestamps are whole seconds. Hold now() inside the
          // ten-minute window, then let elapsed wall time cross its deadline.
          const epoch=(await db.query("select floor(extract(epoch from now()))::bigint value")).rows[0].value;
          const claims={sub:a,session_id:sid(a),aal:"aal1",app_metadata:{provider:"google"},amr:[{method:"oauth",timestamp:Number(epoch)-599}]};
          await db.query("select set_config('request.jwt.claims',$1,true)",[JSON.stringify(claims)]);
          await db.query("select set_config('fixture.file_quota','oauth_delay',true)");
        }
        await assert.rejects(readFile(),target==="copy"?/expired/:target==="scheduled_ban"?/active, unrestricted/:/expired or changed/);
      } finally {await db.exec("rollback");}
    });
  }
  await t.test("an inactive actor cannot reach the quota before denial",async()=>{
    await admin("begin");
    try {
      await db.query("select set_config('fixture.file_quota','quota_reached',true)");
      await db.query("delete from auth.sessions where id=$1",[sid(a)]);await login();
      await assert.rejects(readFile(),/active, unrestricted/);
    } finally {await db.exec("rollback");}
  });
});

test("trusted file chunk digests require a current approved tuple and a service-only write", async t => {
  const { db, a, b, owner, admin, login, call, create, review, approve, generate } = await privacyFileFixture(t);
  const assetId = randomUUID(), maximumId = randomUUID(), sha = "a".repeat(64);
  const hashes = ["b".repeat(64), "c".repeat(64)], maximumHashes = Array(20).fill("d".repeat(64));
  await admin(`insert into public.uploaded_assets(id,owner_id,bucket,object_path,media_type,mime_type,byte_size,sha256)
    values('${assetId}','${a}','profile-media','${a}/own.png','avatar','image/png',524289,'${sha}'),
    ('${maximumId}','${a}','profile-media','${a}/maximum.png','avatar','image/png',10485760,'${sha}');
    insert into storage.objects(bucket_id,name,metadata)
    values('profile-media','${a}/own.png','{"size":524289}'),('profile-media','${a}/maximum.png','{"size":10485760}');`);
  await login(); let row = await create(); await login(owner); row = await approve(await review(row));
  await login(); const copy = await generate(row), files = (await call("member_list_data_export_files", [copy.id])).files;
  const file = files.find(f => f.byteSize === 524289), maximum = files.find(f => f.byteSize === 10485760);
  const args = [copy.id, file.id, assetId, "profile-media", `${a}/own.png`, 524289, sha, hashes];
  const prepare = (values = args) => call("service_prepare_data_export_file_chunks", values, "uuid,uuid,uuid,text,text,integer,text,text[]");
  const service = async () => { await admin("set role service_role"); };

  await t.test("members, staff, and anonymous callers cannot prepare or directly alter private digests", async () => {
    for (const user of [a, b, owner]) {
      await login(user); await assert.rejects(prepare(), /permission denied/);
    }
    await admin("set role anon"); await assert.rejects(prepare(), /permission denied/);
    for (const role of ["anon", "authenticated", "service_role"]) {
      await admin(`set role ${role}`);
      await assert.rejects(db.query("select chunk_sha256 from private.member_data_export_files"), /permission denied/);
      await assert.rejects(db.query("update private.member_data_export_files set chunk_sha256=$1::text[] where id=$2", [hashes, file.id]), /permission denied/);
    }
    await admin();
    const signature = "public.service_prepare_data_export_file_chunks(uuid,uuid,uuid,text,text,integer,text,text[])";
    for (const role of ["anon", "authenticated", "service_role"]) {
      assert.equal((await db.query("select has_function_privilege($1,$2,'EXECUTE') allowed", [role, signature])).rows[0].allowed, role === "service_role");
    }
    assert.equal((await db.query("select relrowsecurity from pg_class where oid='private.member_data_export_files'::regclass")).rows[0].relrowsecurity, true);
  });

  await t.test("hashes are absent until preparation and the member-only descriptor retains asset identity", async () => {
    await login();
    const descriptor = await call("member_read_data_export_file", [copy.id, file.id]);
    assert.equal(descriptor.assetId, assetId); assert.equal(descriptor.chunkSha256, null);
    assert.doesNotMatch(JSON.stringify(files), /assetId|chunkSha256|objectPath|bucket/);
  });

  await t.test("malformed hashes, incorrect counts, noncanonical arrays, and invalid sizes fail without a write", async () => {
    await service();
    for (const invalid of [null, [], [hashes[0]], [...hashes, hashes[0]], Array(21).fill(hashes[0]),
      [null, hashes[1]], [hashes[0].toUpperCase(), hashes[1]], ["0".repeat(63), hashes[1]], ["g".repeat(64), hashes[1]]]) {
      await assert.rejects(prepare([...args.slice(0, 7), invalid]), /Check the file chunk digests/);
    }
    for (const size of [null, 0, -1, 10485761, 2147483647]) {
      const invalid = [...args]; invalid[5] = size;
      await assert.rejects(prepare(invalid), /Check the file chunk digests/);
    }
    for (const arrayLiteral of [`[0:1]={${hashes.join(",")}}`, `{{${hashes.join(",")}}}`]) {
      await assert.rejects(prepare([...args.slice(0, 7), arrayLiteral]), /Check the file chunk digests/);
    }
    await login(); assert.equal((await call("member_read_data_export_file", [copy.id, file.id])).chunkSha256, null);
  });

  await t.test("every supplied identity field must match the exact approved file", async () => {
    await service();
    for (const [index, value] of [[0, randomUUID()], [1, maximum.id], [2, maximumId], [3, "server-media"],
      [4, `${a}/maximum.png`], [5, 524290], [6, "d".repeat(64)], [2, null], [3, null], [4, null], [6, null]]) {
      const wrong = [...args]; wrong[index] = value;
      await assert.rejects(prepare(wrong), /not found|changed/);
    }
  });

  await t.test("expired, pruned, unprepared, or stale requests cannot persist even correctly shaped digests", async () => {
    const rejectedState = async (sql, message) => {
      await admin("begin");
      try {
        await db.exec(sql); await db.exec("set local role service_role");
        await assert.rejects(prepare(), message);
      } finally { await db.exec("rollback"); }
    };
    await rejectedState(`update private.member_data_exports set expires_at=now()-interval '1 second' where id='${copy.id}'`, /expired/);
    await rejectedState(`update private.member_data_exports set payload=null where id='${copy.id}'`, /expired/);
    await rejectedState(`update private.member_data_exports set files_prepared_at=null where id='${copy.id}'`, /changed/);
    await rejectedState(`update private.account_data_requests set version=version+1 where id='${row.id}'`, /request changed/);
    await rejectedState(`update private.account_data_requests set status='withdrawn',version=version+1 where id='${row.id}'`, /request changed/);
    for (const change of [`owner_id='${b}'`, "bucket='server-media'", `object_path='${a}/changed.png'`, "byte_size=524290", `sha256='${hashes[0]}'`]) {
      await rejectedState(`update public.uploaded_assets set ${change} where id='${assetId}'`, /uploaded file changed/);
    }
    await rejectedState(`delete from public.uploaded_assets where id='${assetId}'`, /uploaded file changed/);
    await login(); assert.equal((await call("member_read_data_export_file", [copy.id, file.id])).chunkSha256, null);
  });

  await t.test("service preparation is atomic and exact retries succeed through the maximum file size", async () => {
    await service(); assert.equal(await prepare(), true); assert.equal(await prepare(), true);
    const maxArgs = [copy.id, maximum.id, maximumId, "profile-media", `${a}/maximum.png`, 10485760, sha, maximumHashes];
    assert.equal(await prepare(maxArgs), true);
    await login();
    assert.deepEqual((await call("member_read_data_export_file", [copy.id, file.id])).chunkSha256, hashes);
    assert.deepEqual((await call("member_read_data_export_file", [copy.id, maximum.id])).chunkSha256, maximumHashes);
    for (const user of [b, owner]) {
      await login(user); await assert.rejects(call("member_read_data_export_file", [copy.id, file.id]), /not found/);
    }
  });

  await t.test("prepared digests cannot be overwritten, cleared, or rebound, while receipts still work", async () => {
    await service();
    await assert.rejects(prepare([...args.slice(0, 7), [hashes[1], hashes[0]]]), /different prepared chunk digests/);
    await admin();
    for (const change of ["chunk_sha256=null", `chunk_sha256=array['${hashes[1]}','${hashes[0]}']`,
      `asset_id='${maximumId}'`, `export_id='${randomUUID()}'`, "bucket='server-media'", `object_path='${a}/changed.png'`,
      "byte_size=524290", `sha256='${hashes[0]}'`]) {
      await assert.rejects(db.exec(`update private.member_data_export_files set ${change} where id='${file.id}'`), /cannot be changed/);
    }
    await login();
    assert.deepEqual((await call("member_read_data_export_file", [copy.id, file.id])).chunkSha256, hashes);
    const receipt = await call("member_receive_data_export_file", [copy.id, file.id, sha, true]);
    assert.ok(receipt.receivedAt); assert.equal((await call("member_data_requests", ["list"])).items[0].status, "ready");
    await call("member_data_requests", ["withdraw", null, null, null, row.id, row.version]);
    await service(); await assert.rejects(prepare(), /request changed/);
    await login(); await assert.rejects(call("member_read_data_export_file", [copy.id, file.id]), /request changed/);
  });
});

test("the actual transport prepares database digests once and rejects changed stored range bytes", async t => {
  const { a, owner, admin, login, call, create, review, approve, generate } = await privacyFileFixture(t);
  const bytes = Buffer.alloc(FILE_EXPORT_CHUNK_BYTES + 7, 0x6d);
  bytes.fill(0x19, FILE_EXPORT_CHUNK_BYTES);
  const hash = value => createHash("sha256").update(value).digest("hex");
  const sha = hash(bytes), assetId = randomUUID(), path = `${a}/transport.png`;
  await admin(`insert into public.uploaded_assets(id,owner_id,bucket,object_path,media_type,mime_type,byte_size,sha256)
    values('${assetId}','${a}','profile-media','${path}','avatar','image/png',${bytes.length},'${sha}');
    insert into storage.objects(bucket_id,name,metadata) values('profile-media','${path}','{"size":${bytes.length}}');`);
  await login(); let row = await create(); await login(owner); row = await approve(await review(row));
  await login(); const copy = await generate(row), file = (await call("member_list_data_export_files", [copy.id])).files[0];
  const ranges = [], accessToken = "fixture-member-token"; let preparations = 0, corruptRange = false;
  const deps = {
    config: () => ({ url: "https://supabase.example.invalid", secretKey: "fixture-secret" }),
    rpc: async (name, params, token, options = {}) => {
      if (name === "member_read_data_export_file") {
        assert.equal(token, accessToken); assert.notEqual(options.useSecret, true);
        await login(); return call(name, [params.p_id, params.p_file_id], "uuid,uuid");
      }
      assert.equal(name, "service_prepare_data_export_file_chunks");
      assert.equal(token, undefined); assert.equal(options.useSecret, true); preparations++;
      await admin("set role service_role");
      return call(name, [params.p_id, params.p_file_id, params.p_asset_id, params.p_bucket,
        params.p_object_path, params.p_byte_size, params.p_sha256, params.p_chunk_sha256], "uuid,uuid,uuid,text,text,integer,text,text[]");
    },
    fetch: async (url, options) => {
      assert.equal(url, `https://supabase.example.invalid/storage/v1/object/authenticated/profile-media/${path}`);
      assert.equal(options.headers.apikey, "fixture-secret");
      ranges.push(options.headers.Range);
      const match = /^bytes=(\d+)-(\d+)$/.exec(options.headers.Range);
      assert.ok(match); const start = Number(match[1]), end = Number(match[2]);
      const content = Buffer.from(bytes.subarray(start, end + 1));
      if (corruptRange) content[0] ^= 0xff;
      return new Response(content, { status: 206, headers: {
        "content-range": `bytes ${start}-${end}/${bytes.length}`, "content-length": String(content.length)
      } });
    }
  };
  const first = await readMemberFileChunk({ exportId: copy.id, fileId: file.id, offset: 0 }, accessToken, deps);
  assert.equal(preparations, 1); assert.equal(first.nextOffset, FILE_EXPORT_CHUNK_BYTES);
  const expected = [hash(bytes.subarray(0, FILE_EXPORT_CHUNK_BYTES)), hash(bytes.subarray(FILE_EXPORT_CHUNK_BYTES))];
  await login(); assert.deepEqual((await call("member_read_data_export_file", [copy.id, file.id])).chunkSha256, expected);
  const last = await readMemberFileChunk({ exportId: copy.id, fileId: file.id, offset: first.nextOffset }, accessToken, deps);
  assert.equal(preparations, 1); assert.equal(last.nextOffset, null);
  assert.deepEqual(ranges, [`bytes=0-${bytes.length - 1}`, `bytes=${FILE_EXPORT_CHUNK_BYTES}-${bytes.length - 1}`]);
  assert.deepEqual(Buffer.concat([Buffer.from(first.content, "base64"), Buffer.from(last.content, "base64")]), bytes);
  corruptRange = true;
  await assert.rejects(readMemberFileChunk({ exportId: copy.id, fileId: file.id, offset: FILE_EXPORT_CHUNK_BYTES }, accessToken, deps), { status: 503 });
  assert.equal(preparations, 1);
  await login(); assert.deepEqual((await call("member_read_data_export_file", [copy.id, file.id])).chunkSha256, expected);
});
