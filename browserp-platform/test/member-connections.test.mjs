import test from "node:test";
import assert from "node:assert/strict";
import { beginOAuth, beginIdentityLink, currentIdentityProvider, finishOAuth, getSession, safeProviderAuthorizationUrl, unlinkMemberIdentity } from "../lib/supabase.js";
import { memberClaims, staffClaims } from "../lib/claim-workflow.js";
import router from "../api/router.js";

const userId = "00000000-0000-4000-8000-000000000001";
const otherId = "00000000-0000-4000-8000-000000000002";
const sessionId = "aaaaaaaa-0000-4000-8000-000000000001";
const discordIdentity = "bbbbbbbb-0000-4000-8000-000000000001";
const googleIdentity = "cccccccc-0000-4000-8000-000000000001";
const authenticatedAt = Math.floor(Date.now() / 1000);
const access = { active: true, staff: false, userId, sessionId, authenticatedAt, recent: true };
const csrf = "c".repeat(43);
const token = `fixture.${Buffer.from(JSON.stringify({ aal: "aal2", sub: userId })).toString("base64url")}.fixture`;
const user = { id: userId, app_metadata: { provider: "discord", providers: ["discord"] }, identities: [{ identity_id: discordIdentity, user_id: userId, provider: "discord", provider_id: "111111111111111111" }] };
const linked = { ...user, app_metadata: { provider: "discord", providers: ["discord", "google"] }, identities: [...user.identities, { identity_id: googleIdentity, user_id: userId, provider: "google", provider_id: "fixture-google" }] };
const response = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
function output() { const headers = new Map(); return { headers, setHeader: (key, value) => headers.set(key, value), getHeader: key => headers.get(key), end(value) { this.body = JSON.parse(value); } }; }
function request(method = "GET", cookie = `brp_access=${token}; brp_csrf=${csrf}`) { return { method, url: "/api/me/connections", headers: { host: "localhost:8080", origin: "http://localhost:8080", "content-type": "application/json", "x-browserp-csrf": csrf, cookie }, socket: { remoteAddress: "127.0.0.1" } }; }
function cookieJar(initial, res) {
  const jar = new Map(initial.split(";").map(part => part.trim()).filter(Boolean).map(part => { const equal = part.indexOf("="); return [part.slice(0, equal), part.slice(equal + 1)]; }));
  for (const value of res.getHeader("Set-Cookie") || []) { const pair = value.split(";")[0]; const equal = pair.indexOf("="); const key = pair.slice(0, equal); if (/Max-Age=0(?:;|$)/.test(value)) jar.delete(key); else jar.set(key, pair.slice(equal + 1)); }
  return [...jar].map(([key, value]) => `${key}=${value}`).join("; ");
}
async function isolated(handler, run) {
  const values = { SUPABASE_URL: "https://fixture.supabase.co", SUPABASE_PUBLISHABLE_KEY: "sb_publishable_fixture", SUPABASE_SECRET_KEY: "sb_secret_fixture", APP_URL: "http://localhost:8080", NODE_ENV: "test", VERCEL: "0", PRIVACY_HASH_SECRET: "fixture-private-hash" };
  const previous = new Map(Object.keys(values).map(key => [key, process.env[key]])); const original = globalThis.fetch; const calls = [];
  Object.assign(process.env, values);
  globalThis.fetch = async (value, options = {}) => {
    const call = { url: new URL(value), options, body: typeof options.body === "string" ? JSON.parse(options.body) : options.body }; calls.push(call);
    const result = await handler(call); if (result !== undefined) return result;
    if (call.url.pathname === "/auth/v1/user") return response(user);
    if (call.url.pathname === "/rest/v1/staff_memberships") return response([]);
    if (call.url.pathname === "/auth/v1/settings") return response({ external: { google: true, discord: true } });
    if (call.url.pathname.endsWith("/rpc/check_security_ban_server")) return response(null);
    if (call.url.pathname.endsWith("/rpc/consume_rate_limit")) return response(true);
    if (call.url.pathname.endsWith("/rpc/member_connection_status")) return response(access);
    if (call.url.pathname.endsWith("/rpc/member_connection_operation")) return response(call.body.p_action === "begin" ? "dddddddd-0000-4000-8000-000000000001" : null);
    throw new Error(`Unexpected fixture request ${call.url.pathname}`);
  };
  try { await run(calls); } finally { globalThis.fetch = original; for (const [key, value] of previous) value === undefined ? delete process.env[key] : process.env[key] = value; }
}
function callbackFrom(start, cookie, provider = "google") {
  const auth = new URL(beginOAuth({ ...request("GET", cookie), url: `/api/auth/${provider}?returnTo=%2Fdashboard` }, start, provider));
  const callback = new URL(auth.searchParams.get("redirect_to")); callback.searchParams.set("code", "fixture-code");
  return { ...request("GET", cookieJar(cookie, start)), url: callback.toString() };
}

test("ordinary members can sign in after automatic identity linking while staff provider checks remain strict", async () => isolated(call => {
  if (call.url.pathname === "/auth/v1/token") return response({ user: linked, access_token: token, refresh_token: "fixture-refresh" });
  if (call.url.pathname === "/auth/v1/user") return response(linked);
}, async () => {
  const start = output(); const callback = callbackFrom(start, request().headers.cookie); const res = output();
  const result = await finishOAuth(callback, res); assert.equal(result.user.id, userId); assert.equal(result.provider, "google"); assert.equal(result.returnTo, "/dashboard");
  assert.equal(currentIdentityProvider(linked), null);
  assert.equal((await getSession(request(), output(), { required: true })).user.id, userId);
  await assert.rejects(getSession(request(), output(), { required: true, provider: "discord" }), { status: 403 });
}));

test("any current or former staff membership blocks linked-account OAuth", async () => {
  for (const status of ["active", "suspended", "revoked"]) await isolated(call => {
    if (call.url.pathname === "/auth/v1/token") return response({ user: linked, access_token: token, refresh_token: "fixture-refresh" });
    if (call.url.pathname === "/rest/v1/staff_memberships") { assert.equal(call.url.searchParams.has("status"), false); return response([{ user_id: userId, status }]); }
  }, async () => {
    const start = output(); const callback = callbackFrom(start, request().headers.cookie); const res = output();
    await assert.rejects(finishOAuth(callback, res), { status: 403 }); assert.equal((res.getHeader("Set-Cookie") || []).some(cookie => cookie.startsWith("brp_access=")), false);
  });
});

test("explicit linking uses authenticated PKCE and binds the callback to the original member", async () => {
  let authorize;
  await isolated(call => {
    if (call.url.pathname === "/auth/v1/user/identities/authorize") { authorize = call; return response({ url: "https://accounts.google.com/o/oauth2/v2/auth?state=provider-fixture" }); }
    if (call.url.pathname === "/auth/v1/token") return response({ user: linked, access_token: token, refresh_token: "new-refresh" });
  }, async () => {
    const req = request("POST"); const start = output();
    assert.equal(await beginIdentityLink(req, start, "google"), "https://accounts.google.com/o/oauth2/v2/auth?state=provider-fixture");
    assert.equal(authorize.options.headers.Authorization, `Bearer ${token}`); assert.equal(authorize.url.searchParams.get("skip_http_redirect"), "true"); assert.equal(authorize.url.searchParams.get("code_challenge_method"), "s256"); assert.match(authorize.url.searchParams.get("code_challenge"), /^[A-Za-z0-9_-]{43}$/);
    const callback = new URL(authorize.url.searchParams.get("redirect_to")); assert.equal(callback.searchParams.get("brp_link"), "1"); callback.searchParams.set("code", "linked-fixture-code");
    const completed = await finishOAuth({ ...request("GET", cookieJar(req.headers.cookie, start)), url: callback.toString() }, output());
    assert.equal(completed.linked, true); assert.equal(completed.user.id, userId); assert.equal(completed.returnTo, "/profile?connections=linked");
  });
});

test("link callbacks cannot switch accounts and preserve the original session on rejection", async () => {
  for (const wrongStage of ["current", "returned"]) {
    let authorize; let callbackStage = false; let exchanges = 0;
    await isolated(call => {
      if (call.url.pathname === "/auth/v1/user" && callbackStage && wrongStage === "current") return response({ ...user, id: otherId });
      if (call.url.pathname === "/auth/v1/user/identities/authorize") { authorize = call; return response({ url: "https://accounts.google.com/o/oauth2/v2/auth" }); }
      if (call.url.pathname === "/auth/v1/token") { exchanges++; return response({ user: { ...linked, id: wrongStage === "returned" ? otherId : userId }, access_token: token, refresh_token: "untrusted-refresh" }); }
    }, async () => {
      const req = request("POST"); const start = output(); await beginIdentityLink(req, start, "google"); callbackStage = true;
      const callback = new URL(authorize.url.searchParams.get("redirect_to")); callback.searchParams.set("code", "linked-fixture-code"); const res = output();
      await assert.rejects(finishOAuth({ ...request("GET", cookieJar(req.headers.cookie, start)), url: callback.toString() }, res), { status: 403 });
      assert.equal(exchanges, wrongStage === "current" ? 0 : 1); assert.equal((res.getHeader("Set-Cookie") || []).some(cookie => cookie.startsWith("brp_access=")), false);
    });
  }
});

test("connections reject CSRF, staff accounts, already-connected providers and disabled manual linking", async () => {
  await isolated(call => call.url.pathname === "/auth/v1/user/identities/authorize" ? response({ code: "manual_linking_disabled", message: "disabled" }, 400) : undefined, async calls => {
    const bad = request("POST"); bad.headers["x-browserp-csrf"] = "x".repeat(43);
    await assert.rejects(beginIdentityLink(bad, output(), "google"), { status: 403 });
    await assert.rejects(beginIdentityLink(request("POST"), output(), "discord"), { status: 409 });
    assert.equal(calls.some(call => call.url.pathname.endsWith("/identities/authorize")), false);
    const res = output(); await assert.rejects(beginIdentityLink(request("POST"), res, "google"), error => error.status === 409 && error.code === "MANUAL_LINKING_DISABLED");
    assert.equal((res.getHeader("Set-Cookie") || []).some(cookie => cookie.startsWith("brp_access=")), false);
  });
  await isolated(call => call.url.pathname === "/rest/v1/staff_memberships" ? response([{ user_id: userId }]) : undefined, async calls => {
    await assert.rejects(beginIdentityLink(request("POST"), output(), "google"), { status: 403 }); assert.equal(calls.some(call => call.url.pathname.endsWith("/identities/authorize")), false);
  });
});

test("connection API shows supported providers truthfully and rejects cross-origin writes", async () => isolated(() => undefined, async () => {
  const res = output(); await router({ ...request(), browserpRoute: "me/connections" }, res);
  assert.equal(res.statusCode, 200); assert.equal(res.body.connections.canManage, true);
  assert.deepEqual(res.body.connections.providers.map(item => [item.provider, item.connected, item.canConnect]), [["discord", true, false], ["google", false, true]]);
  assert.equal(res.getHeader("Cache-Control"), "no-store");
  const bad = request("POST"); bad.headers.origin = "https://attacker.example"; bad.body = { provider: "google" }; const denied = output(); await router({ ...bad, browserpRoute: "me/connections" }, denied); assert.equal(denied.statusCode, 403);
}));

test("a member's connected Discord identity works for claims but never authorizes staff claims", async () => isolated(call => {
  if (call.url.pathname === "/auth/v1/user") return response(linked);
  if (call.url.pathname === "/rest/v1/servers") return response([{ id: otherId, slug: "fixture-server", status: "published", name: "Fixture server", owner_id: null, community_url: "https://discord.gg/fixture" }]);
  if (call.url.pathname.endsWith("/rpc/member_server_claims")) return response({ items: [{ id: "fixture-claim" }] });
}, async () => {
  const result = await memberClaims({ ...request(), url: `/api/server-claims?serverId=${otherId}` }, output(), "fixture-request");
  assert.equal(result.context.provider, "discord"); assert.equal(result.claims.length, 1);
  await assert.rejects(staffClaims(request(), output(), "fixture-request"), { status: 403 });
}));

test("provider redirects only allow the matching HTTPS consent endpoint", () => {
  assert.ok(safeProviderAuthorizationUrl("https://discord.com/oauth2/authorize?client_id=fixture", "discord"));
  for (const url of ["https://accounts.google.com.evil.example/o/oauth2/v2/auth", "https://user@accounts.google.com/o/oauth2/v2/auth", "https://accounts.google.com/redirect", "javascript:alert(1)", "https://accounts.google.com:8443/o/oauth2/v2/auth", "https://discord.com/oauth2/authorize"]) assert.equal(safeProviderAuthorizationUrl(url, "google"), null);
});

test("linking refuses revoked and stale original sessions before calling the provider", async () => {
  for (const [status, expected] of [[{ active: false }, 401], [{ ...access, recent: false }, 428]]) {
    await isolated(call => call.url.pathname.endsWith("/rpc/member_connection_status") ? response(status) : undefined, async calls => {
      await assert.rejects(beginIdentityLink(request("POST"), output(), "google"), { status: expected });
      assert.equal(calls.some(call => call.url.pathname.endsWith("/identities/authorize")), false);
    });
  }
});

test("link callback requires the original active, recent session even after provider consent", async () => {
  for (const changed of [{ active: false }, { ...access, recent: false }, { ...access, sessionId: otherId }, { ...access, authenticatedAt: authenticatedAt + 1 }]) {
    let callbackStage = false; let authorization;
    await isolated(call => {
      if (call.url.pathname.endsWith("/rpc/member_connection_status")) return response(callbackStage ? changed : access);
      if (call.url.pathname.endsWith("/identities/authorize")) { authorization = call.url; return response({ url: "https://accounts.google.com/o/oauth2/v2/auth" }); }
    }, async calls => {
      const start = output(); const req = request("POST"); await beginIdentityLink(req, start, "google"); callbackStage = true;
      const callback = new URL(authorization.searchParams.get("redirect_to")); callback.searchParams.set("code", "fixture-code");
      await assert.rejects(finishOAuth({ ...request("GET", cookieJar(req.headers.cookie, start)), url: callback.href }, output()));
      assert.equal(calls.some(call => call.url.pathname === "/auth/v1/token"), false);
    });
  }
});

test("disconnect deletes only the exact owned identity, verifies the result and ends all sessions", async () => {
  let removed = false;
  await isolated(call => {
    if (call.url.pathname === "/auth/v1/user") return response(removed ? user : linked);
    if (call.url.pathname === `/auth/v1/user/identities/${googleIdentity}`) { assert.equal(call.options.method, "DELETE"); assert.equal(call.options.headers.Authorization, `Bearer ${token}`); removed = true; return response({}); }
    if (call.url.pathname === "/auth/v1/logout") { assert.equal(call.url.searchParams.get("scope"), "global"); return response({}); }
  }, async calls => {
    const res = output(); const result = await unlinkMemberIdentity(request("POST"), res, { provider: "google", identityId: googleIdentity, accountId: userId });
    assert.equal(result.disconnected, true); assert.equal(result.sessionsEnded, true); assert.deepEqual(result.signInProviders, ["discord"]);
    assert.ok((res.getHeader("Set-Cookie") || []).some(value => value.startsWith("brp_access=") && value.includes("Max-Age=0")));
    assert.equal(calls.filter(call => call.options.method === "DELETE").length, 1);
    assert.equal(calls.some(call => call.body?.p_action === "release"), true);
  });
});

test("disconnect reuses the refreshed token under its lease instead of refreshing the original cookie twice", async () => {
  let removed = false, refreshes = 0, leaseHeld = false;
  const refreshedToken = `${token}-refreshed`;
  await isolated(call => {
    if (call.url.pathname === "/auth/v1/user") {
      if (call.options.headers.Authorization === "Bearer expired") return response({ message: "Expired access token" }, 401);
      assert.equal(call.options.headers.Authorization, `Bearer ${refreshedToken}`);
      assert.equal(leaseHeld, true);
      return response(removed ? user : linked);
    }
    if (call.url.pathname === "/auth/v1/token") {
      assert.equal(call.body.refresh_token, "fixture-original-refresh");
      if (++refreshes > 1) return response({ error_code: "refresh_token_already_used", message: "Refresh token already used" }, 400);
      return response({ user: linked, access_token: refreshedToken, refresh_token: "fixture-new-refresh" });
    }
    if (call.url.pathname.endsWith("/rpc/member_connection_operation") && call.body.p_action === "begin") leaseHeld = true;
    if (call.options.method === "DELETE") {
      assert.equal(call.options.headers.Authorization, `Bearer ${refreshedToken}`); removed = true; return response({});
    }
    if (call.url.pathname === "/auth/v1/logout") return response({});
  }, async calls => {
    const result = await unlinkMemberIdentity(request("POST", `brp_access=expired; brp_refresh=fixture-original-refresh; brp_csrf=${csrf}`), output(), { provider: "google", identityId: googleIdentity, accountId: userId });
    assert.equal(result.disconnected, true); assert.equal(refreshes, 1);
    assert.equal(calls.filter(call => call.url.pathname === "/auth/v1/user").length, 3);
    assert.equal(calls.filter(call => call.url.pathname.endsWith("/rpc/member_connection_status")).length, 2);
  });
});

test("disconnect preserves the last enabled login and rejects stale-page ownership and forged identities", async () => {
  for (const scenario of ["last", "disabled", "wrong-identity", "provider-id", "wrong-account", "identity-owner", "revoked", "stale", "staff"]) {
    await isolated(call => {
      if (call.url.pathname === "/auth/v1/user") return response(scenario === "last" ? user : scenario === "identity-owner" ? { ...linked, identities: linked.identities.map(item => ({ ...item, user_id: otherId })) } : linked);
      if (scenario === "disabled" && call.url.pathname === "/auth/v1/settings") return response({ external: { google: true, discord: false } });
      if (scenario === "staff" && call.url.pathname === "/rest/v1/staff_memberships") return response([{ user_id: userId, status: "revoked" }]);
      if (scenario === "revoked" && call.url.pathname.endsWith("/rpc/member_connection_status")) return response({ active: false });
      if (scenario === "stale" && call.url.pathname.endsWith("/rpc/member_connection_status")) return response({ ...access, recent: false });
    }, async calls => {
      await assert.rejects(unlinkMemberIdentity(request("POST"), output(), { provider: scenario === "last" ? "discord" : "google", identityId: scenario === "last" ? discordIdentity : scenario === "wrong-identity" ? otherId : scenario === "provider-id" ? "fixture-google" : googleIdentity, accountId: scenario === "wrong-account" ? otherId : userId }));
      assert.equal(calls.some(call => call.options.method === "DELETE"), false, scenario);
    });
  }
});

test("disconnect fails closed on CSRF and an in-progress operation; logout outage is reported honestly", async () => {
  await isolated(call => call.url.pathname === "/auth/v1/user" ? response(linked) : undefined, async calls => {
    const req = request("POST"); req.headers["x-browserp-csrf"] = "wrong";
    await assert.rejects(unlinkMemberIdentity(req, output(), { provider: "google", identityId: googleIdentity, accountId: userId }), { status: 403 });
    assert.equal(calls.some(call => call.options.method === "DELETE"), false);
  });
  await isolated(call => call.url.pathname.endsWith("/rpc/member_connection_operation") ? response({ message: "Another account change is finishing." }, 409) : undefined, async calls => {
    await assert.rejects(unlinkMemberIdentity(request("POST"), output(), { provider: "google", identityId: googleIdentity, accountId: userId }), { status: 409 });
    assert.equal(calls.some(call => call.options.method === "DELETE"), false);
  });
  let removed = false;
  await isolated(call => {
    if (call.url.pathname === "/auth/v1/user") return response(removed ? user : linked);
    if (call.options.method === "DELETE") { removed = true; return response({}); }
    if (call.url.pathname === "/auth/v1/logout") return response({ message: "Unavailable" }, 503);
  }, async () => {
    const res = output(); const result = await unlinkMemberIdentity(request("POST"), res, { provider: "google", identityId: googleIdentity, accountId: userId });
    assert.equal(result.disconnected, true); assert.equal(result.sessionsEnded, false);
    assert.ok((res.getHeader("Set-Cookie") || []).some(value => value.startsWith("brp_access=") && value.includes("Max-Age=0")));
  });
});

test("connection API requires the displayed account and exposes stale authentication without mutation controls", async () => {
  await isolated(call => call.url.pathname.endsWith("/rpc/member_connection_status") ? response({ ...access, recent: false }) : undefined, async () => {
    const res = output(); await router({ ...request(), browserpRoute: "me/connections" }, res);
    assert.equal(res.statusCode, 200); assert.equal(res.body.connections.accountId, userId); assert.equal(res.body.connections.reauthenticationRequired, true);
    assert.ok(res.body.connections.providers.every(item => !item.canConnect && !item.canDisconnect));
  });
  for (const accountId of [undefined, otherId]) await isolated(() => undefined, async calls => {
    const res = output(); await router({ ...request("POST"), browserpRoute: "me/connections", body: { provider: "google", accountId } }, res);
    assert.equal(res.statusCode, 409); assert.equal(calls.some(call => call.url.pathname.endsWith("/identities/authorize")), false);
  });
});

test("ambiguous provider deletion clears the local session and retains its operation lease", async () => {
  for (const failure of ["delete-timeout", "verify-timeout"]) {
    let attempted = false;
    await isolated(call => {
      if (call.url.pathname === "/auth/v1/user") {
        if (attempted && failure === "verify-timeout") return response({ message: "Temporary error" }, 503);
        return response(linked);
      }
      if (call.options.method === "DELETE") { attempted = true; return failure === "delete-timeout" ? response({ message: "Timeout" }, 504) : response({}); }
    }, async calls => {
      const res = output();
      await assert.rejects(unlinkMemberIdentity(request("POST"), res, { provider: "google", identityId: googleIdentity, accountId: userId }), error => error.status === 401 && /couldn’t confirm/.test(error.message));
      assert.equal(calls.filter(call => call.options.method === "DELETE").length, 1);
      assert.equal(calls.some(call => call.body?.p_action === "release"), false);
      assert.ok((res.getHeader("Set-Cookie") || []).some(value => value.startsWith("brp_access=") && value.includes("Max-Age=0")));
    });
  }
});
