import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import router from "../api/router.js";

test("staff hierarchy dispatch preserves authenticated tokens, versions, explicit durations and private responses", async t => {
  const account = "00000000-0000-4000-8000-000000000001", target = "00000000-0000-4000-8000-000000000002", csrf = "c".repeat(43);
  const token = `fixture.${Buffer.from(JSON.stringify({ sub: account, aal: "aal2" })).toString("base64url")}.fixture`;
  const previous = { ...process.env }, originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key]; Object.assign(process.env, previous); });
  Object.assign(process.env, { NODE_ENV: "test", VERCEL: "0", APP_URL: "http://localhost:8080", SUPABASE_URL: "https://fixture.supabase.co", SUPABASE_PUBLISHABLE_KEY: "sb_publishable_fixture", SUPABASE_SECRET_KEY: "sb_secret_fixture", PRIVACY_HASH_SECRET: "fixture-only-secret" });
  const calls = []; let conflict = false;
  globalThis.fetch = async (url, options = {}) => {
    const path = new URL(url).pathname, body = options.body ? JSON.parse(options.body) : null;
    calls.push({ path, body, options }); let payload, status = 200;
    if (path === "/auth/v1/user") payload = { id: account, app_metadata: { provider: "discord", providers: ["discord"] }, identities: [{ provider: "discord", provider_id: "fixture" }] };
    else if (path.endsWith("/rpc/check_security_ban_server")) payload = null;
    else if (path.endsWith("/rpc/consume_rate_limit")) payload = true;
    else if (/\/rpc\/staff_/.test(path)) {
      if (conflict) { payload = { code: "PT409", message: "This staff record changed. Reload before saving." }; status = 409; }
      else payload = { fixture: true };
    } else throw new Error(`Unexpected fixture request ${path}`);
    return new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } });
  };
  const request = async (route, body, method = "POST", query = "", extra = {}) => {
    const headers = new Map(); let value;
    const res = { setHeader: (name, content) => headers.set(name.toLowerCase(), content), getHeader: name => headers.get(name.toLowerCase()), end: payload => { value = JSON.parse(payload); } };
    await router({ browserpRoute: route, method, url: `/api/${route}${query}`, body, headers: { host: "localhost:8080", origin: "http://localhost:8080", "content-type": "application/json", "x-browserp-csrf": csrf, cookie: `brp_access=${token}; brp_csrf=${csrf}`, ...extra }, socket: { remoteAddress: "127.0.0.1" } }, res);
    return { status: res.statusCode, value, headers };
  };
  const last = name => calls.findLast(x => x.path.endsWith(`/rpc/${name}`));
  const staff = { discordUserId: "222222222222222222", action: "assign", roleKey: "community_moderator", expectedVersion: 0, reason: "Reviewed this fixture staff assignment." };
  await t.test("read-only catalogue, requests and restriction capabilities use their own RPCs", async () => {
    for (const [route, query, name] of [["admin/roles", "", "staff_role_control"], ["admin/staff", "?view=requests", "staff_access_request_control"], ["admin/bans", "?view=access", "staff_restriction_capabilities"]]) {
      const result = await request(route, null, "GET", query); assert.equal(result.status, 200); assert.equal(result.headers.get("cache-control"), "no-store");
      assert.equal(last(name).options.headers.Authorization, `Bearer ${token}`);
    }
  });
  await t.test("direct changes and reviewed requests retain separate actions and current versions", async () => {
    assert.equal((await request("admin/staff", staff)).status, 200);
    assert.equal(last("staff_mutate_access").body.p_expected_version, 0);
    const requestKey = randomUUID();
    assert.equal((await request("admin/staff", { ...staff, requestAction: "create", requestKey })).status, 200);
    assert.equal(last("staff_request_access").body.p_request_key, requestKey);
    assert.equal((await request("admin/staff", { requestAction: "decide", id: target, expectedVersion: 3, approved: true, reason: staff.reason })).status, 200);
    assert.equal(last("staff_decide_access_request").body.p_expected_version, 3);
    assert.equal(last("staff_decide_access_request").body.p_approve, true);
    conflict = true; assert.equal((await request("admin/staff", staff)).status, 409); conflict = false;
  });
  await t.test("permission reset remains explicit and cannot use an unversioned request", async () => {
    const body = { discordUserId: staff.discordUserId, permissionKey: "blogs.manage", allowed: null, expectedVersion: 7, reason: staff.reason };
    assert.equal((await request("admin/permissions", body)).status, 200);
    assert.equal(last("staff_mutate_permission").body.p_allowed, null);
    assert.equal(last("staff_mutate_permission").body.p_expected_version, 7);
    const before = calls.length;
    assert.equal((await request("admin/permissions", { ...body, allowed: "false" })).status, 409);
    assert.equal(calls.slice(before).some(x => x.path.endsWith("/rpc/staff_mutate_permission")), false);
    assert.equal((await request("admin/permissions", { ...body, expectedVersion: undefined })).status, 409);
  });
  await t.test("timed account restrictions and security signals forward exact finite/null duration", async () => {
    const body = { action: "restrict_account", userId: target, minutes: 2880, reasonCode: "fixture", reason: staff.reason };
    assert.equal((await request("admin/bans", body)).status, 200);
    assert.equal(last("staff_restrict_account").body.p_user_id, target);
    assert.equal(last("staff_restrict_account").body.p_minutes, 2880);
    assert.equal((await request("admin/bans", { ...body, action: "apply", activityId: 123, targetType: "device", minutes: null })).status, 200);
    assert.equal(last("staff_apply_security_ban").body.p_minutes, null);
    assert.equal(last("staff_apply_security_ban").body.p_permanent, true);
    assert.equal((await request("admin/bans", { ...body, minutes: undefined })).status, 400);
  });
  await t.test("cross-origin and signed-out access fail before privileged dispatch", async () => {
    assert.equal((await request("admin/staff", staff, "POST", "", { origin: "https://untrusted.example" })).status, 403);
    assert.equal((await request("admin/roles", null, "GET", "", { cookie: "" })).status, 401);
  });
});
