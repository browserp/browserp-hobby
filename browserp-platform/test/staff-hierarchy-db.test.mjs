import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { staffHierarchyFixture } from "./staff-hierarchy-fixture.mjs";

test("the complete hierarchy migration applies after the existing privacy and moderation history", async t => {
  const { db, admin, login, call, ids, discord, mutate, restrict, sid } = await staffHierarchyFixture(t);
  const rejected = async (operation, pattern) => {
    await db.exec("savepoint expected_rejection");
    try { await assert.rejects(operation, pattern); }
    finally { await db.exec("rollback to savepoint expected_rejection;release savepoint expected_rejection"); }
  };
  await t.test("all eight actual ranks can read the catalogue while actions stay separate", async () => {
    for (const role of Object.keys(discord)) {
      await login(role); const c = await call("staff_role_control");
      assert.equal(c.roles.filter(x => x.key !== "helper").length, 8);
      assert.equal(c.roles.find(x => x.key === "custom_full_access").name, "Management");
      assert.equal(c.canAssign, !["community_moderator", "support"].includes(role));
      assert.equal(c.canEditRoles, ["owner", "custom_full_access", "head_administrator"].includes(role));
      assert.equal(c.roles.find(x => x.key === "owner").assignable, false);
      assert.equal(c.roles.find(x => x.key === "owner").editable, false);
      if (role === "administrator") assert.equal(c.roles.find(x => x.key === "administrator").assignable, false);
    }
  });
  await t.test("Management and Head Admin receive the complete operational permission catalogue", async () => {
    for (const role of ["owner", "custom_full_access", "head_administrator"]) {
      await login(role); const c = await call("staff_role_control");
      await admin(); const all = (await db.query("select key from public.permissions order by key")).rows.map(x => x.key);
      assert.deepEqual(c.effectivePermissions, all);
      await login(role); assert.ok(await call("staff_permission_control"));
    }
  });
  await t.test("Moderator publishes an actual announcement; Community Moderator cannot", async () => {
    const args = [null, "publish", "Community update", "A useful announcement for the fixture.", "info", null, null, null, "Reviewed community announcement", randomUUID()];
    await login("moderator"); const result = await call("staff_mutate_announcement", args, "uuid,text,text,text,text,timestamptz,timestamptz,bigint,text,text");
    assert.equal(result.status, "published");
    await login("community_moderator"); await assert.rejects(call("staff_mutate_announcement", args, "uuid,text,text,text,text,timestamptz,timestamptz,bigint,text,text"), /permission/i);
  });
  await t.test("Admin assigns lower ranks, while peer, superior and self changes fail", async () => {
    await login("administrator");
    const fresh = "222222222222222222";
    const result = await mutate(fresh, "community_moderator");
    assert.equal(result.roleKey, "community_moderator");
    await assert.rejects(mutate("222222222222222223", "administrator"), /lower-rank/);
    await assert.rejects(mutate("222222222222222224", "head_administrator"), /lower-rank/);
    await assert.rejects(mutate("administrator", "support", "change_role", 1), /own authority/);
    await assert.rejects(mutate("custom_full_access", "support", "change_role", 1), /below your own/);
    await login("moderator"); await mutate("222222222222222225", "community_moderator");
    await assert.rejects(mutate("222222222222222226", "moderator"), /lower-rank/);
    await login("community_moderator"); await assert.rejects(mutate("222222222222222227", "support"), /permit/);
  });
  await t.test("the exact graduated restriction limits are enforced by direct RPC calls", async () => {
    for (const [role, maximum] of [["moderator", 2880], ["senior_moderator", 4320], ["administrator", 10080], ["head_administrator", 43200]]) {
      await login(role); await admin("begin");
      try {
        await db.exec("set role authenticated");
        const result = await restrict(ids.member, maximum);
        assert.equal((new Date(result.endsAt) - new Date(result.startsAt)) / 60000, maximum);
      } finally { await db.exec("rollback"); }
      await login(role); await assert.rejects(restrict(ids.member, maximum + 1), /rank limit/);
      await assert.rejects(restrict(ids.member, null), /rank limit/);
      await assert.rejects(restrict(ids[role], 60), /yourself/);
      await assert.rejects(restrict(ids.owner, 60), /below your own/);
    }
    for (const role of ["community_moderator", "support"]) { await login(role); await assert.rejects(restrict(ids.member, 60), /permit/); }
    await login("custom_full_access"); await admin("begin");
    try { await db.exec("set role authenticated"); assert.equal((await restrict(ids.member, null)).endsAt, null); }
    finally { await db.exec("rollback"); }
  });

  await t.test("revoke/reapply cannot reset a cap; a higher-ranked review can extend the episode", async () => {
    await admin("begin");
    try {
      await login("moderator"); const first = await restrict(ids.member, 2880);
      await admin(`update public.security_bans set starts_at=clock_timestamp()-interval '47 hours',
        restriction_episode_started_at=clock_timestamp()-interval '47 hours',ends_at=clock_timestamp()+interval '1 hour' where id='${first.id}'`);
      await login("moderator"); await call("staff_revoke_security_ban", [first.id, "Reconsider this fixture restriction.", randomUUID()]);
      await rejected(() => restrict(ids.member, 2880), /extend an existing restriction/);
      const short = await restrict(ids.member, 30);
      await admin(); const kept = (await db.query("select restriction_episode_started_at<starts_at-interval '46 hours' kept from public.security_bans where id=$1", [short.id])).rows[0].kept;
      assert.equal(kept, true);
      await login("administrator"); await call("staff_revoke_security_ban", [short.id, "Higher-ranked review of the fixture.", randomUUID()]);
      const higher = await restrict(ids.member, 10080);
      assert.equal((new Date(higher.endsAt) - new Date(higher.startsAt)) / 60000, 10080);
    } finally { await db.exec("rollback"); }
  });

  await t.test("expired restrictions release access and the unique slot without losing history or audit", async () => {
    await admin("begin");
    try {
      await login("moderator"); const first = await restrict(ids.member, 60);
      await admin(`update public.security_bans set starts_at=clock_timestamp()-interval '2 hours',
        restriction_episode_started_at=clock_timestamp()-interval '2 hours',ends_at=clock_timestamp()-interval '1 hour' where id='${first.id}';
        insert into auth.sessions(id,user_id) values('${sid(ids.member)}','${ids.member}');`);
      await login("member", { aal: "aal1", app_metadata: { provider: "google" } }); await admin();
      assert.equal((await db.query("select private.member_access_allowed() allowed")).rows[0].allowed, true);
      await login("moderator"); const next = await restrict(ids.member, 60);
      assert.notEqual(next.id, first.id);
      await admin(); const old = (await db.query("select revoked_at,revoke_reason from public.security_bans where id=$1", [first.id])).rows[0];
      assert.ok(old.revoked_at); assert.match(old.revoke_reason, /expired/);
      assert.equal((await db.query("select count(*)::int n from public.security_bans where user_id=$1", [ids.member])).rows[0].n, 2);
      assert.equal((await db.query("select count(*)::int n from public.staff_audit_events where action='security.ban.expired' and target_id=$1", [first.id])).rows[0].n, 1);
    } finally { await db.exec("rollback"); }
  });

  await t.test("denied permissions cannot be restored indirectly through reset, assignment or reactivation", async () => {
    await admin("begin");
    try {
      await admin(`insert into public.staff_permission_overrides(user_id,permission_key,allowed,reason,changed_by) values
        ('${ids.head_administrator}','blogs.manage',false,'Owner restricted this publishing permission.','${ids.owner}'),
        ('${ids.administrator}','blogs.manage',false,'Owner restricted this publishing permission.','${ids.owner}'),
        ('${ids.support}','blogs.manage',true,'A previous custom publishing allowance.','${ids.owner}');
        update public.staff_memberships set status='suspended' where user_id='${ids.support}';
        insert into public.staff_roles(key,name,description,rank,is_custom) values('custom_editor','Fixture editor','A lower custom editor role.',798,true);
        insert into public.staff_role_permissions(role_key,permission_key) values('custom_editor','blogs.manage'),('custom_editor','staff.read');`);
      await login("head_administrator");
      for (const allowed of [true, null]) await rejected(() => call("staff_mutate_permission", [discord.administrator, "blogs.manage", allowed, "Restore fixture publishing access.", randomUUID(), 1], "text,text,boolean,text,text,bigint"), /outside the current role hierarchy/);
      await login("administrator"); await rejected(() => mutate("333333333333333331", "custom_editor"), /cannot delegate/);
      await login("moderator"); await rejected(() => mutate("support", "support", "reactivate", 1), /cannot delegate/);
      await login("head_administrator");
      await rejected(() => call("staff_mutate_role", [null, "Clone admin", "Attempt to create a peer-capable custom role.", ["staff.permissions.manage"], 0, "A fixture clone attempt.", randomUUID()], "text,text,text,text[],bigint,text,text"), /higher role rank/);
      await admin(); assert.equal((await db.query("select allowed from public.staff_permission_overrides where user_id=$1 and permission_key='blogs.manage'", [ids.administrator])).rows[0].allowed, false);
      assert.equal((await db.query("select status from public.staff_memberships where user_id=$1", [ids.support])).rows[0].status, "suspended");
    } finally { await db.exec("rollback"); }
  });

  await t.test("versioned requests require a higher reviewer and remain included in the requester's account copy", async () => {
    await admin("begin");
    try {
      await login("administrator");
      const request = await call("staff_request_access", [discord.administrator, "change_role", "head_administrator", "Please review this higher staff role.", 1, randomUUID()], "text,text,text,text,bigint,uuid");
      assert.equal(request.status, "pending");
      await rejected(() => call("staff_decide_access_request", [request.id, request.version, true, "Trying to approve my own promotion.", randomUUID()], "uuid,bigint,boolean,text,text"), /Another authorised/);
      await admin(); const exported = (await db.query("select private.member_export_records($1) data", [ids.administrator])).rows[0].data;
      assert.equal(exported.collections.staffAccessRequests[0].id, request.id);
      assert.ok(Array.isArray(exported.collections.contentModeration));
      await login("custom_full_access");
      await rejected(() => call("staff_decide_access_request", [request.id, request.version + 1, true, "A stale fixture review request.", randomUUID()], "uuid,bigint,boolean,text,text"), /changed/);
      const approved = await call("staff_decide_access_request", [request.id, request.version, true, "Management approves the fixture request.", randomUUID()], "uuid,bigint,boolean,text,text");
      assert.equal(approved.status, "approved");
      await admin(); assert.equal((await db.query("select role_key from public.staff_memberships where user_id=$1", [ids.administrator])).rows[0].role_key, "head_administrator");
    } finally { await db.exec("rollback"); }
  });

  await t.test("Community Moderator performs real comment review but cannot appoint staff or impose restrictions", async () => {
    await admin("begin");
    try {
      const server = randomUUID(), comment = randomUUID();
      await admin(`insert into public.platforms(id,name,short_name) values('fivem','FiveM','FiveM');
        insert into public.servers(id,owner_id,platform_id,name,slug,description,region,status) values('${server}','${ids.member}','fivem','Fixture RP','fixture-rp','A welcoming roleplay community for this isolated regression.','Europe','published');
        insert into public.server_comments(id,server_id,author_id,body,status) values('${comment}','${server}','${ids.member}','A constructive fixture comment.','pending_review');`);
      const submission = (await db.query("select id,version from private.content_submissions where target_id=$1", [comment])).rows[0];
      await login("community_moderator"); const reviewed = await call("staff_decide_content", [submission.id, submission.version, "approve", "Approved the constructive fixture comment.", randomUUID()], "uuid,bigint,text,text,text");
      assert.equal(reviewed.status, "published");
      await admin(); assert.equal((await db.query("select status from public.server_comments where id=$1", [comment])).rows[0].status, "published");
    } finally { await db.exec("rollback"); }
  });

  await t.test("membership loss or a clock expiry during a report write rolls the write and audit back", async () => {
    for (const mode of ["revoke", "expire"]) {
      await admin("begin");
      try {
        const report = randomUUID();
        await admin(`insert into public.reports(id,reporter_id,target_type,target_id,category,details)
          values('${report}','${ids.member}','profile','${ids.otherMember}','fixture','An isolated report long enough for validation.');
          create function private.fixture_staff_wait() returns trigger language plpgsql security definer as $$begin
            ${mode === "revoke" ? `update public.staff_memberships set status='revoked' where user_id='${ids.community_moderator}';` : "perform pg_sleep(0.2);"}
            return new;end;$$;
          create trigger fixture_staff_wait before update on public.reports for each row execute function private.fixture_staff_wait();
          ${mode === "expire" ? `update auth.sessions set not_after=clock_timestamp()+interval '0.15 seconds' where user_id='${ids.community_moderator}';` : ""}`);
        await login("community_moderator");
        await rejected(() => call("staff_moderation_mutate", ["report", report, "delete", {}, 1, "A delayed fixture report decision.", randomUUID()], "text,uuid,text,jsonb,bigint,text,text"), /permit|active|sign-in/i);
        await admin();
        assert.equal((await db.query("select deleted_at from public.reports where id=$1", [report])).rows[0].deleted_at, null);
        assert.equal((await db.query("select count(*)::int n from public.staff_audit_events where target_id=$1", [report])).rows[0].n, 0);
      } finally { await db.exec("rollback"); }
    }
  });

  await t.test("permitted override changes require the current staff version and cannot elevate a lower rank", async () => {
    await admin("begin");
    try {
      await login("head_administrator");
      const set = (allowed, version, key = "blogs.manage") => call("staff_mutate_permission", [discord.administrator, key, allowed, "Reviewed fixture permission change.", randomUUID(), version], "text,text,boolean,text,text,bigint");
      assert.equal((await set(false, 1)).version, 2);
      await rejected(() => set(true, 1), /changed/);
      assert.equal((await set(null, 2)).version, 3);
      await rejected(() => set(true, 3, "staff.permissions.manage"), /outside the current role hierarchy/);
      await rejected(() => call("staff_mutate_permission", [discord.administrator, "blogs.manage", true, "Unversioned fixture permission change.", randomUUID()], "text,text,boolean,text,text"), /permission denied/);
    } finally { await db.exec("rollback"); }
  });

  await t.test("network approvals and erasure review match the new operational permissions without exposing raw data to ordinary staff", async () => {
    await admin("begin");
    try {
      await admin(`insert into private.network_evidence(activity_id,network_ciphertext)
        select id,'FIXTURE_ENCRYPTED_NETWORK' from public.account_activity where user_id='${ids.member}' limit 1;`);
      const activity = (await db.query("select id from public.account_activity where user_id=$1 limit 1", [ids.member])).rows[0].id;
      await login("head_administrator");
      assert.equal((await call("staff_security_status")).canApproveNetwork, true);
      assert.equal((await call("staff_network_reveal_evidence", [activity, null], "bigint,uuid")).ciphertext, "FIXTURE_ENCRYPTED_NETWORK");
      await login("administrator");
      await rejected(() => call("staff_network_reveal_evidence", [activity, null], "bigint,uuid"), /Approved network/);
      await login("community_moderator");
      await rejected(() => call("staff_network_reveal_evidence", [activity, null], "bigint,uuid"), /permit|Approved network/);
      await login("member", { aal: "aal1", app_metadata: { provider: "google" } });
      const deletion = (await call("member_data_requests", ["create", "delete", "Review this fixture deletion request.", randomUUID()])).request;
      await login("head_administrator");
      const report = await call("staff_account_erasure_preflight", [deletion.id, deletion.version]);
      assert.equal(report.executionEnabled, false); assert.equal(report.coverage.fullErasureInventory, false);
      for (const role of ["anon", "authenticated", "service_role"]) {
        await admin(`set role ${role}`);
        await rejected(() => db.query("select * from private.staff_access_requests"), /permission denied/);
        await rejected(() => db.query("select private.require_staff_authority('staff.manage')"), /permission denied/);
      }
    } finally { await db.exec("rollback"); }
  });
});
