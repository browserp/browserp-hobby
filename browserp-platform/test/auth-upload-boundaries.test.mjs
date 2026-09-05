import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { deflateSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { beginOAuth, finishOAuth, getSession, setSession } from "../lib/supabase.js";
import { parseCookies, readBody } from "../lib/http.js";
import { createBrowseRPServer } from "../dev-server.mjs";
import router from "../api/router.js";

const csrf = "c".repeat(43);
const user = { id: "00000000-0000-4000-8000-000000000001", app_metadata: { provider: "discord", providers: ["discord"] }, identities: [{ provider: "discord", provider_id: "111111111111111111" }] };
const access = `fixture.${Buffer.from(JSON.stringify({ aal: "aal1", sub: user.id })).toString("base64url")}.fixture`;
const response = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
function output() { const headers = new Map(); return { headers, setHeader: (key, value) => headers.set(key, value), getHeader: key => headers.get(key) }; }
const cookies = res => (res.getHeader("Set-Cookie") || []).join("\n");
const request = cookie => ({ method: "GET", url: "/api/auth/session", headers: { host: "localhost:8080", cookie: cookie || `brp_access=expired; brp_refresh=fixture-refresh; brp_csrf=${csrf}` } });
async function isolated(fetcher, run, extra = {}) {
  const values = { SUPABASE_URL: "https://fixture.supabase.co", SUPABASE_PUBLISHABLE_KEY: "sb_publishable_fixture", SUPABASE_SECRET_KEY: "", APP_URL: "http://localhost:8080", NODE_ENV: "test", VERCEL: "0", VERCEL_ENV: "", ...extra };
  const previous = new Map(Object.keys(values).map(key => [key, process.env[key]])); const realFetch = globalThis.fetch;
  Object.assign(process.env, values); if (fetcher) globalThis.fetch = fetcher;
  try { await run(); } finally { globalThis.fetch = realFetch; for (const [key, value] of previous) value === undefined ? delete process.env[key] : process.env[key] = value; }
}

test("production sessions use host-only secure HttpOnly cookies and a Strict CSRF token", async () => isolated(null, async () => {
  const res = output(); setSession(res, { access_token: access, refresh_token: "fixture-refresh", expires_in: 3600 }, { csrfToken: csrf });
  for (const name of ["brp_access", "brp_refresh", "brp_csrf"]) {
    const header = res.getHeader("Set-Cookie").find(value => value.startsWith(`__Host-${name}=`) && !value.includes("Max-Age=0"));
    assert.ok(header); assert.match(header, /Path=\//); assert.match(header, /HttpOnly/); assert.match(header, /Secure/); assert.doesNotMatch(header, /Domain=/);
    assert.match(header, name === "brp_csrf" ? /SameSite=Strict/ : /SameSite=Lax/);
  }
}, { NODE_ENV: "production" }));

test("transient refresh failures preserve session cookies without automatic retry loops", async () => {
  for (const [status, code] of [[503, "unexpected_failure"], [504, "request_timeout"], [429, "over_request_rate_limit"], [400, "conflict"]]) {
    let attempts = 0;
    await isolated(async url => {
      if (new URL(url).pathname === "/auth/v1/user") return response({ code: "bad_jwt" }, 401);
      attempts += 1; return response({ code, message: "Temporary provider failure" }, status);
    }, async () => {
      const res = output(); await assert.rejects(getSession(request(), res, { required: true }), error => error.status === status && error.code === code);
      assert.equal(attempts, 1); assert.doesNotMatch(cookies(res), /brp_(?:access|refresh)=[^\n]*Max-Age=0/);
    });
  }
});

test("revoked or expired refresh credentials clear the session and still deny required access", async () => {
  for (const code of ["refresh_token_not_found", "refresh_token_already_used", "session_expired", "invalid_grant"]) {
    await isolated(async url => new URL(url).pathname === "/auth/v1/user" ? response({ code: "bad_jwt" }, 401) : response({ code, message: "Session no longer exists" }, 400), async () => {
      const res = output(); await assert.rejects(getSession(request(), res, { required: true }), { status: 401 });
      assert.match(cookies(res), /brp_access=;[^\n]*Max-Age=0/); assert.match(cookies(res), /brp_refresh=;[^\n]*Max-Age=0/);
    });
  }
});

test("successful refresh rotates credentials and keeps the current CSRF token", async () => {
  let refreshes = 0;
  await isolated(async (url, options) => {
    if (new URL(url).pathname === "/auth/v1/user") return response({ code: "bad_jwt" }, 401);
    refreshes += 1; assert.equal(JSON.parse(options.body).refresh_token, "fixture-refresh");
    return response({ user, access_token: access, refresh_token: "rotated-refresh", expires_in: 3600 });
  }, async () => {
    const res = output(); const session = await getSession(request(), res, { required: true });
    assert.equal(refreshes, 1); assert.equal(session.user.id, user.id); assert.equal(session.csrfToken, csrf); assert.match(cookies(res), /brp_refresh=rotated-refresh/);
  });
});

test("authenticated access fails closed when the security-ban lookup cannot complete", async () => {
  for (const [status, code, message] of [
    [403, "42501", "permission denied for function check_security_ban_server"],
    [500, "XX000", "check_security_ban_server could not read security_bans"],
    [404, "PGRST202", "Could not find the function public.check_security_ban_server in the schema cache"],
    [503, "unexpected_failure", "Temporary database failure"]
  ]) {
    await isolated(async value => {
      const url = new URL(value);
      if (url.pathname === "/auth/v1/user") return response(user);
      if (url.pathname.endsWith("/rpc/check_security_ban_server")) return response({ code, message }, status);
      throw new Error(`Unexpected test endpoint ${url.pathname}`);
    }, async () => {
      const res = output();
      await assert.rejects(getSession(request(`brp_access=${access}; brp_csrf=${csrf}`), res, { required: true }), error => error.code === code && error.status === status);
      assert.doesNotMatch(cookies(res), /brp_(?:access|refresh)=[^\n]*Max-Age=0/, "a failed check must not invalidate otherwise valid credentials");
    }, { SUPABASE_SECRET_KEY: "sb_secret_fixture", PRIVACY_HASH_SECRET: "fixture-private-hash" });
  }
});

test("security-ban lookup allows a confirmed clear account and rejects an active restriction", async () => {
  for (const restricted of [false, true]) {
    await isolated(async value => {
      const url = new URL(value);
      if (url.pathname === "/auth/v1/user") return response(user);
      if (url.pathname.endsWith("/rpc/check_security_ban_server")) return response(restricted ? { reference: "BRP-1234567890" } : null);
      throw new Error(`Unexpected test endpoint ${url.pathname}`);
    }, async () => {
      const res = output(); const req = request(`brp_access=${access}; brp_csrf=${csrf}`);
      if (restricted) {
        await assert.rejects(getSession(req, res, { required: true }), { status: 403, code: "ACCOUNT_RESTRICTED" });
        assert.match(cookies(res), /brp_access=;[^\n]*Max-Age=0/);
      } else assert.equal((await getSession(req, res, { required: true })).user.id, user.id);
    }, { SUPABASE_SECRET_KEY: "sb_secret_fixture", PRIVACY_HASH_SECRET: "fixture-private-hash" });
  }
});

test("OAuth callback state and nonce fail before token exchange, and linked identities cannot gain staff sign-in", async () => isolated(async () => { throw new Error("Token exchange must not run"); }, async () => {
  const start = output(); const login = { ...request(""), url: "/api/auth/discord?returnTo=%2Fstaffpanel%2Fmoderation" };
  const url = new URL(beginOAuth(login, start, "discord")); const callback = new URL(url.searchParams.get("redirect_to")); callback.searchParams.set("code", "fixture-code");
  const cookieHeader = start.getHeader("Set-Cookie").map(value => value.split(";")[0]).join("; ");
  for (const field of ["brp_state", "brp_nonce"]) {
    const bad = new URL(callback); bad.searchParams.set(field, "x".repeat(43));
    const res = output(); await assert.rejects(finishOAuth({ ...request(cookieHeader), url: bad.toString() }, res), { status: 400 });
    assert.doesNotMatch(cookies(res), /brp_access=[^;]/);
  }
  const parsed = parseCookies({ headers: { cookie: cookieHeader } });
  assert.equal(callback.searchParams.get("brp_nonce"), createHash("sha256").update(parsed.brp_oauth_nonce).digest("base64url"));
  globalThis.fetch = async () => response({ access_token: access, refresh_token: "fixture-refresh", user: { ...user, app_metadata: { provider: "discord", providers: ["discord", "google"] }, identities: [...user.identities, { provider: "google" }] } });
  const res = output(); await assert.rejects(finishOAuth({ ...request(cookieHeader), url: callback.toString() }, res), { status: 403 }); assert.doesNotMatch(cookies(res), /brp_access=[^;]/);
}));

test("avatar JSON admits a full 1 MiB image after base64 while default request limits stay bounded", async () => {
  const imageData = `data:image/png;base64,${Buffer.alloc(1024 * 1024).toString("base64")}`;
  const encoded = JSON.stringify({ imageData }); const req = { headers: { "content-type": "application/json", "content-length": String(Buffer.byteLength(encoded)) }, body: encoded };
  assert.ok(Buffer.byteLength(encoded) > 1024 * 1024); assert.equal((await readBody(req, 1_500_000)).imageData, imageData);
  await assert.rejects(readBody(req), { status: 413 });
  await assert.rejects(readBody({ ...req, headers: { ...req.headers, "content-length": "1500001" } }, 1_500_000), { status: 413 });
  await assert.rejects(readBody({ ...req, body: { data: "x".repeat(2 * 1024 * 1024) } }, Number.MAX_SAFE_INTEGER), { status: 413 });
});

test("a real cropped PNG crosses the avatar route and storage boundary using only the signed-in owner's path", async () => {
  const crc32 = bytes => { let crc = 0xffffffff; for (const byte of bytes) { crc ^= byte; for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0); } return (crc ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const bytes = Buffer.alloc(data.length + 12); bytes.writeUInt32BE(data.length); bytes.write(type, 4); data.copy(bytes, 8); bytes.writeUInt32BE(crc32(bytes.subarray(4, data.length + 8)), data.length + 8); return bytes; };
  const header = Buffer.alloc(13); header.writeUInt32BE(512); header.writeUInt32BE(512, 4); header[8] = 8; header[9] = 2;
  const pixels = randomBytes(512 * (512 * 3 + 1)); for (let row = 0; row < 512; row++) pixels[row * (512 * 3 + 1)] = 0;
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", deflateSync(pixels)), chunk("IEND", Buffer.alloc(0))]);
  const body = { imageData: `data:image/png;base64,${png.toString("base64")}`, userId: "attacker-selected-user", objectPath: "../overwrite.png" };
  assert.ok(png.length < 1024 * 1024); assert.ok(Buffer.byteLength(JSON.stringify(body)) > 1024 * 1024);
  let storedPath; let registered;
  await isolated(async (value, options) => {
    const url = new URL(value);
    if (url.pathname === "/auth/v1/user") return response(user);
    if (url.pathname.endsWith("/rpc/check_security_ban_server")) return response(null);
    if (url.pathname.endsWith("/rpc/member_connection_status")) return response({ active: true, userId: user.id, sessionId: "fixture-active-session" });
    if (url.pathname.endsWith("/rpc/consume_rate_limit")) return response(true);
    if (url.pathname.startsWith("/storage/v1/object/profile-media/")) { storedPath = url.pathname; assert.deepEqual(options.body, png); assert.equal(options.headers["x-upsert"], "false"); return response({ Key: url.pathname }); }
    if (url.pathname === "/rest/v1/uploaded_assets") { registered = JSON.parse(options.body); assert.equal(registered.owner_id, user.id); return response([{ id: "00000000-0000-4000-8000-000000000002" }]); }
    if (url.pathname.endsWith("/rpc/member_set_profile_avatar")) { const data = JSON.parse(options.body); assert.ok(data.p_avatar_url.endsWith(registered.object_path)); assert.equal(options.headers.Authorization, `Bearer ${access}`); return response({ avatar_url: data.p_avatar_url }); }
    if (url.pathname.endsWith("/rpc/record_account_activity_server")) return response(null);
    throw new Error(`Unexpected test endpoint ${url.pathname}`);
  }, async () => {
    const res = output(); res.end = value => { res.body = JSON.parse(value); };
    const req = { ...request(`brp_access=${access}; brp_csrf=${csrf}`), browserpRoute: "me/avatar", method: "POST", url: "/api/me/avatar", body, socket: { remoteAddress: "127.0.0.1" } };
    req.headers = { ...req.headers, "content-type": "application/json", origin: "http://localhost:8080", "x-browserp-csrf": csrf };
    await router(req, res); assert.equal(res.statusCode, 201); assert.match(storedPath, new RegExp(`/profile-media/${user.id}/[0-9]+-[a-f0-9]{24}\\.png$`)); assert.equal(registered.byte_size, png.length); assert.equal(res.body.avatarUrl, `https://fixture.supabase.co/storage/v1/object/public/profile-media/${registered.object_path}`);
    const forged = output(); forged.end = value => { forged.body = JSON.parse(value); };
    await router({ ...req, headers: { ...req.headers, "x-browserp-csrf": "d".repeat(43) } }, forged); assert.equal(forged.statusCode, 403);
  }, { SUPABASE_SECRET_KEY: "sb_secret_fixture", PRIVACY_HASH_SECRET: "fixture-private-hash" });
});

test("revoked but otherwise valid JWTs cannot read private profiles, expose session identity or write avatar files", async () => {
  for (const denied of [{ active: false }, { active: true, userId: "another-user", sessionId: "another-session" }, { active: true, userId: user.id }]) {
    const privileged = [];
    await isolated(async (value, options) => {
      const path = new URL(value).pathname;
      if (path === "/auth/v1/user") return response({ ...user, email: "private-fixture@example.test", factors: [{ id: "private-factor", factor_type: "totp", status: "verified" }] });
      if (path.endsWith("/rpc/check_security_ban_server")) return response(null);
      if (path.endsWith("/rpc/member_connection_status")) return response(denied);
      privileged.push({ path, method: options.method }); throw new Error("Privileged work must not run for a revoked session");
    }, async () => {
      for (const route of ["auth/session", "me/profile", "me/avatar"]) {
        const req = { ...request(`brp_access=${access}; brp_csrf=${csrf}`), browserpRoute: route, method: route === "me/avatar" ? "POST" : "GET", body: { imageData: "must not be decoded or uploaded" } };
        req.headers = { ...req.headers, "content-type": "application/json", origin: "http://localhost:8080", "x-browserp-csrf": csrf };
        const res = output(); res.end = value => { res.body = JSON.parse(value); };
        await router(req, res);
        assert.equal(res.statusCode, route === "auth/session" ? 200 : 401);
        if (route === "auth/session") { assert.equal(res.body.authenticated, false); assert.equal(res.body.user, null); }
        assert.doesNotMatch(JSON.stringify(res.body), /private-fixture|private-factor|another-user/);
      }
      assert.deepEqual(privileged, []);
    }, { SUPABASE_SECRET_KEY: "sb_secret_fixture", PRIVACY_HASH_SECRET: "fixture-private-hash" });
  }
});

test("current account sessions can read profiles and AAL1 staff setup remains available; lookup outages fail closed", async () => {
  for (const unavailable of [false, true]) {
    let profileReads = 0;
    await isolated(async value => {
      const path = new URL(value).pathname;
      if (path === "/auth/v1/user") return response(user);
      if (path.endsWith("/rpc/check_security_ban_server")) return response(null);
      if (path.endsWith("/rpc/member_connection_status")) return unavailable ? response({ message: "Unavailable" }, 503) : response({ active: true, userId: user.id, sessionId: "fixture-active-session", recent: false });
      if (path === "/rest/v1/profiles") { profileReads++; return response([{ display_name: "Fixture member" }]); }
      if (path.endsWith("/rpc/staff_mfa_enrollment_allowed")) return response(true);
      if (path.endsWith("/rpc/staff_mfa_policy")) return response({ staffMfaRequired: true });
      throw new Error(`Unexpected endpoint ${path}`);
    }, async () => {
      for (const route of ["auth/session", "me/profile"]) {
        const res = output(); res.end = value => { res.body = JSON.parse(value); };
        await router({ ...request(`brp_access=${access}; brp_csrf=${csrf}`), browserpRoute: route }, res);
        assert.equal(res.statusCode, unavailable ? 503 : 200);
        if (!unavailable && route === "auth/session") { assert.equal(res.body.authenticated, true); assert.equal(res.body.aal, "aal1"); assert.equal(res.body.staffAccess, true); }
      }
      assert.equal(profileReads, unavailable ? 0 : 2);
    }, { SUPABASE_SECRET_KEY: "sb_secret_fixture", PRIVACY_HASH_SECRET: "fixture-private-hash" });
  }
});

test("profile routes are present locally, private without sign-in, and share safe image CSP with production", async () => isolated(null, async () => {
  const server = createBrowseRPServer(); await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  try {
    for (const [path, method] of [["/api/me/profile", "GET"], ["/api/me/profile", "POST"], ["/api/me/avatar", "POST"]]) {
      const res = await fetch(origin + path, { method, headers: { "Content-Type": "application/json" }, ...(method === "POST" ? { body: "{}" } : {}) });
      assert.equal(res.status, 401, `${method} ${path}`); assert.equal(res.headers.get("cache-control"), "no-store");
    }
    const config = JSON.parse(readFileSync(new URL("../vercel.json", import.meta.url)));
    const production = config.headers.flatMap(item => item.headers).find(header => header.key === "Content-Security-Policy").value;
    const local = (await fetch(origin + "/dashboard")).headers.get("content-security-policy");
    for (const policy of [production, local]) {
      const image = policy.split(";").find(directive => directive.trim().startsWith("img-src "));
      assert.match(image, /\bdata:/); assert.match(image, /https:\/\/kywabzfgjoqiznnxygbq\.supabase\.co\/storage\/v1\/object\/public\/profile-media\//);
      assert.doesNotMatch(policy.split(";").find(directive => directive.trim().startsWith("script-src ")), /blob:|unsafe-inline/);
    }
  } finally { await new Promise(resolve => server.close(resolve)); }
}));
