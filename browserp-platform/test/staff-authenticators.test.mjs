import test from "node:test";
import assert from "node:assert/strict";
import { staffAuthenticators } from "../lib/staff-authenticators.js";
import { getSession } from "../lib/supabase.js";
import router from "../api/router.js";

const userId = "00000000-0000-4000-8000-000000000001";
const first = "11111111-0000-4000-8000-000000000001";
const backup = "22222222-0000-4000-8000-000000000002";
const pending = "33333333-0000-4000-8000-000000000003";
const challenge = "44444444-0000-4000-8000-000000000004";
const csrf = "c".repeat(43);
const token = aal => `fixture.${Buffer.from(JSON.stringify({ aal, sub: userId })).toString("base64url")}.fixture`;
const factor = (id, status = "verified", name = id === first ? "Main phone" : "Backup phone") => ({ id, factor_type: "totp", status, friendly_name: name, secret: "must-not-leak" });
const user = factors => ({ id: userId, app_metadata: { provider: "discord", providers: ["discord"] }, identities: [{ provider: "discord", provider_id: "111111111111111111" }], factors });
const response = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
const req = (body, aal = "aal2") => ({ method: body ? "POST" : "GET", body, url: "/api/admin/authenticators", headers: { host: "localhost:8080", origin: "http://localhost:8080", "content-type": "application/json", "x-browserp-csrf": csrf, cookie: `brp_access=${token(aal)}; brp_csrf=${csrf}` }, socket: { remoteAddress: "127.0.0.1" } });
function output() { const headers = new Map(); return { setHeader: (key, value) => headers.set(key, value), getHeader: key => headers.get(key) }; }
async function fixture(run, options = {}) {
  const env = { SUPABASE_URL: "https://fixture.supabase.co", SUPABASE_PUBLISHABLE_KEY: "sb_publishable_fixture", SUPABASE_SECRET_KEY: "sb_secret_fixture", APP_URL: "http://localhost:8080", NODE_ENV: "test", VERCEL: "0", PRIVACY_HASH_SECRET: "fixture-private-hash" };
  const previous = new Map(Object.keys(env).map(key => [key, process.env[key]])); const original = globalThis.fetch;
  Object.assign(process.env, env);
  const state = { factors: options.factors || [factor(first), factor(backup)], calls: [], allowed: true, lock: null, codes: [], ...options };
  globalThis.fetch = async (value, config = {}) => {
    const path = new URL(value).pathname; const body = config.body ? JSON.parse(config.body) : undefined; const call = { path, body, method: config.method || "GET", config }; state.calls.push(call);
    const custom = await options.fetch?.(call, state); if (custom !== undefined) return custom;
    if (path === "/auth/v1/user") return response(user(state.factors));
    if (path.endsWith("/rpc/check_security_ban_server")) return response(null);
    if (path.endsWith("/rpc/staff_authenticator_access")) return response(state.allowed);
    if (path.endsWith("/rpc/staff_mfa_enrollment_allowed")) return response(state.allowed);
    if (path.endsWith("/rpc/consume_rate_limit")) return response(true);
    if (path.endsWith("/rpc/staff_authenticator_operation")) {
      if (body.p_action === "acquire") { if (state.lock) return response(false); state.lock = body.p_operation_id; return response(true); }
      if (state.lock === body.p_operation_id) { state.lock = null; return response(true); } return response(false);
    }
    if (path.endsWith("/rpc/record_account_activity_server")) return response(1);
    if (path === "/auth/v1/factors") { state.factors.push(factor(pending, "unverified", body.friendly_name)); return response({ id: pending, totp: { secret: "ABCDEFGHIJKLMNOP", qr_code: '<svg xmlns="http://www.w3.org/2000/svg"></svg>' } }); }
    if (path.endsWith("/challenge")) return response({ id: challenge });
    if (path.endsWith("/verify")) { const id = path.split("/").at(-2); state.codes.push({ id, code: body.code }); state.factors.find(item => item.id === id).status = "verified"; return response({ user: user(state.factors), access_token: token("aal2"), refresh_token: "fixture-refreshed" }); }
    if (call.method === "DELETE") { state.factors = state.factors.filter(item => item.id !== path.split("/").at(-1)); return response({ id: path.split("/").at(-1) }); }
    throw new Error(`Unexpected fixture request ${path}`);
  };
  try { await run(state); } finally { globalThis.fetch = original; for (const [key, value] of previous) value === undefined ? delete process.env[key] : process.env[key] = value; }
}

test("authenticator list requires current allowed Discord staff and AAL2, and exposes no secrets", async () => fixture(async state => {
  const payload = await staffAuthenticators(req(), output(), "fixture");
  assert.equal(payload.authenticators.factors.length, 2); assert.doesNotMatch(JSON.stringify(payload), /must-not-leak|access_token|refresh_token/);
  await assert.rejects(staffAuthenticators(req(null, "aal1"), output(), "fixture"), { status: 403 });
  state.allowed = false; await assert.rejects(staffAuthenticators(req(), output(), "fixture"), { status: 403 });
  assert.equal(state.calls.some(call => call.method === "DELETE"), false);
}));

test("an already refreshed router session is reused with fresh staff permission and factor reads", async () => fixture(async state => {
  const request=req({ action: "enroll", label: "Spare device" }),res=output();
  request.headers.cookie=`brp_access=expired; brp_refresh=fixture-original-refresh; brp_csrf=${csrf}`;
  const session=await getSession(request,res,{required:true,provider:"discord"});
  await staffAuthenticators(request,res,"fixture",session);
  assert.equal(state.calls.filter(call=>call.path==="/auth/v1/token").length,1);
  assert.equal(state.calls.filter(call=>call.path==="/auth/v1/user").length,3);
  assert.ok(state.calls.some(call=>call.path.endsWith("/rpc/staff_authenticator_access")));
  request.headers["x-browserp-csrf"]="bad";
  await assert.rejects(staffAuthenticators(request,res,"fixture",session),{status:403});
},{fetch(call,state){
  if(call.path==="/auth/v1/user"&&call.config.headers.Authorization==="Bearer expired")return response({message:"Expired"},401);
  if(call.path==="/auth/v1/token")return response({user:user(state.factors),access_token:token("aal2"),refresh_token:"fixture-new-refresh"});
}}));

test("legacy enrollment cannot bypass existing staff verification, factor capacity or concurrent-operation guards", async () => fixture(async state => {
  async function legacy(aal) {
    const request = req({ friendlyName: "Another phone" }, aal); request.browserpRoute = "auth/mfa/enroll";
    const res = output(); res.end = value => { res.payload = JSON.parse(value); };
    await router(request, res); return res;
  }
  assert.equal((await legacy("aal1")).statusCode, 403);
  state.factors.push(factor(pending, "unverified"));
  assert.equal((await legacy("aal2")).statusCode, 409);
  state.factors.pop(); state.lock = "another-operation";
  assert.equal((await legacy("aal2")).statusCode, 409);
  assert.equal(state.calls.some(call => call.path === "/auth/v1/factors"), false);
  state.lock = null;
  const success = await legacy("aal2"); assert.equal(success.statusCode, 201); assert.equal(success.payload.factor.id, pending);
}));

test("writes reject CSRF, foreign origins, unsafe names and excess authenticators", async () => fixture(async state => {
  const badCsrf = req({ action: "enroll", label: "Backup" }); badCsrf.headers["x-browserp-csrf"] = "x".repeat(43);
  await assert.rejects(staffAuthenticators(badCsrf, output(), "fixture"), { status: 403 });
  const foreign = req({ action: "enroll", label: "Backup" }); foreign.headers.origin = "https://evil.example";
  await assert.rejects(staffAuthenticators(foreign, output(), "fixture"), { status: 403 });
  for (const label of ["<img src=x>", "x", "Backup\nphone", "a".repeat(41)]) await assert.rejects(staffAuthenticators(req({ action: "enroll", label }), output(), "fixture"), { status: 400 });
  state.factors.push(factor(pending, "unverified"));
  await assert.rejects(staffAuthenticators(req({ action: "enroll", label: "Another backup" }), output(), "fixture"), { status: 409 });
  assert.equal(state.calls.some(call => call.path === "/auth/v1/factors"), false); assert.equal(state.lock, null);
}));

test("backup setup uses BrowseRP issuer, stays unverified until a code is supplied, rotates session and audits without secrets", async () => fixture(async state => {
  const enrolled = await staffAuthenticators(req({ action: "enroll", label: "Spare device" }), output(), "fixture");
  assert.match(enrolled.setup.qrCode, /^data:image\/svg\+xml;base64,/); assert.equal(enrolled.setup.secret, "ABCDEFGHIJKLMNOP");
  assert.equal(state.factors.find(item => item.id === pending).status, "unverified");
  assert.equal(state.calls.find(call => call.path === "/auth/v1/factors").body.issuer, "BrowseRP");
  const res = output(); await staffAuthenticators(req({ action: "verify", factorId: pending, code: "123456" }), res, "fixture");
  assert.equal(state.factors.find(item => item.id === pending).status, "verified"); assert.ok(res.getHeader("Set-Cookie").some(item => item.startsWith("brp_access=")));
  const audit = state.calls.filter(call => call.path.endsWith("/rpc/record_account_activity_server"));
  assert.deepEqual(audit.map(call => call.body.p_event_type), ["auth.mfa_enrolled", "auth.mfa_verified"]);
  assert.doesNotMatch(JSON.stringify(audit.map(call => call.body)), /ABCDEFGHIJKLMNOP|123456|qr_code|access_token/);
}));

test("removal verifies a different working factor before deleting, and never removes the last verified factor", async () => fixture(async state => {
  await assert.rejects(staffAuthenticators(req({ action: "remove", factorId: first, alternateFactorId: first, code: "123456" }), output(), "fixture"), { status: 409 });
  const res = output(); await staffAuthenticators(req({ action: "remove", factorId: first, alternateFactorId: backup, code: "123456" }), res, "fixture");
  assert.deepEqual(state.codes, [{ id: backup, code: "123456" }]); assert.deepEqual(state.factors.map(item => item.id), [backup]);
  const verifiedAt = state.calls.findIndex(call => call.path.endsWith(`/${backup}/verify`)); const removedAt = state.calls.findIndex(call => call.method === "DELETE"); assert.ok(verifiedAt < removedAt);
  await assert.rejects(staffAuthenticators(req({ action: "remove", factorId: backup, alternateFactorId: first, code: "123456" }), output(), "fixture"), { status: 409 });
  assert.equal(state.calls.filter(call => call.method === "DELETE").length, 1);
  assert.equal(state.calls.findLast(call => call.path.endsWith("/rpc/record_account_activity_server")).body.p_event_type, "auth.mfa_removed");
}));

test("an invalid alternate code or revoked staff access cannot remove an authenticator", async () => {
  for (const failure of ["code", "revoked"]) await fixture(async state => {
    await assert.rejects(staffAuthenticators(req({ action: "remove", factorId: first, alternateFactorId: backup, code: "123456" }), output(), "fixture"), { status: failure === "code" ? 400 : 403 });
    assert.equal(state.calls.some(call => call.method === "DELETE"), false);
  }, { fetch(call, state) { if (call.path.endsWith("/verify")) { if (failure === "code") return response({ message: "Invalid code" }, 422); state.allowed = false; } } });
});

test("concurrent removals cannot each delete the other operation's remaining factor", async () => {
  let unblock, reached; const waiting = new Promise(resolve => { reached = resolve; });
  await fixture(async state => {
    const removingFirst = staffAuthenticators(req({ action: "remove", factorId: first, alternateFactorId: backup, code: "123456" }), output(), "first-request");
    await waiting;
    await assert.rejects(staffAuthenticators(req({ action: "remove", factorId: backup, alternateFactorId: first, code: "654321" }), output(), "second-request"), { status: 409 });
    unblock(); await removingFirst; assert.deepEqual(state.factors.map(item => item.id), [backup]);
    assert.equal(state.calls.filter(call => call.method === "DELETE").length, 1);
  }, { async fetch(call) { if (call.path.endsWith("/challenge")) { reached(); await new Promise(resolve => { unblock = resolve; }); } } });
});

test("uncertain provider writes retain the lease, and foreign factors are never acted on", async () => {
  await fixture(async state => {
    await assert.rejects(staffAuthenticators(req({ action: "remove", factorId: pending }), output(), "fixture"), { status: 404 });
    assert.equal(state.calls.some(call => call.method === "DELETE"), false);
    await assert.rejects(staffAuthenticators(req({ action: "remove", factorId: first, alternateFactorId: backup, code: "123456" }), output(), "fixture"), { status: 503 });
    assert.ok(state.lock);
  }, { fetch(call) { if (call.method === "DELETE") return response({ message: "Provider unavailable" }, 503); } });
});

test("unfinished setups can be cancelled without touching a verified authenticator", async () => fixture(async state => {
  await staffAuthenticators(req({ action: "remove", factorId: pending }), output(), "fixture");
  assert.deepEqual(state.factors.map(item => item.id), [first]); assert.equal(state.codes.length, 0);
}, { factors: [factor(first), factor(pending, "unverified")] }));
