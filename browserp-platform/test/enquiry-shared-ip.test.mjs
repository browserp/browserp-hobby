import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { memberRateLimit, rateLimit } from "../lib/rate-limit.js";
import { clientSignal } from "../lib/http.js";
import { memberAdvertisingEnquiries, staffAdvertisingEnquiries } from "../lib/advertising-enquiries.js";

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const SECRET = "shared-ip-test-only-not-a-production-secret";
const csrf = "c".repeat(43);
const memberHash = id => createHmac("sha256", SECRET).update("browserp:rate-limit:member:v1:").update(id.toLowerCase()).digest("hex");
const request = (ip = "192.0.2.10") => ({ method: "POST", headers: { host: "localhost:8080" }, socket: { remoteAddress: ip } });
const response = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const output = () => { const headers = new Map(); return { setHeader: (k, v) => headers.set(k, v), getHeader: k => headers.get(k) }; };

// Every fetch is intercepted. These tests neither use real accounts nor contact providers.
async function fixture(run, { environment = {}, intercept } = {}) {
  const values = {
    NODE_ENV: "test", VERCEL: "0", APP_URL: "http://localhost:8080",
    SUPABASE_URL: "https://rate-limit-fixture.invalid", SUPABASE_PUBLISHABLE_KEY: "sb_publishable_fixture",
    SUPABASE_SECRET_KEY: "sb_secret_fixture", PRIVACY_HASH_SECRET: SECRET, ...environment
  };
  const previous = new Map(Object.keys(values).map(key => [key, process.env[key]]));
  const originalFetch = globalThis.fetch;
  const calls = [], buckets = new Map();
  let now = 0;
  Object.assign(process.env, values);
  globalThis.fetch = async (value, options = {}) => {
    const call = { path: new URL(value).pathname, options, body: options.body ? JSON.parse(options.body) : null };
    calls.push(call);
    if (intercept) { const custom = await intercept(call); if (custom !== undefined) return custom; }
    if (call.path.endsWith("/rpc/consume_rate_limit")) {
      const data = call.body, key = `${data.p_action}:${data.p_key_hash}`;
      let bucket = buckets.get(key);
      if (!bucket || bucket.resetAt <= now) { bucket = { count: 0, resetAt: now + data.p_window_seconds * 1000 }; buckets.set(key, bucket); }
      bucket.count += 1;
      return response(bucket.count <= data.p_limit);
    }
    if (call.path === "/auth/v1/user") {
      const token = options.headers.Authorization.replace(/^Bearer /, "");
      const claims = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
      return response({ id: claims.sub, app_metadata: { provider: "discord", providers: ["discord"] }, identities: [{ provider: "discord", provider_id: "fixture" }] });
    }
    if (call.path.endsWith("/rpc/check_security_ban_server")) return response(null);
    if (call.path.endsWith("/rpc/member_advertising_enquiries") || call.path.endsWith("/rpc/staff_review_advertising_enquiry")) return response({ enquiry: { status: "submitted" } });
    throw new Error(`Unexpected outbound request: ${call.path}`);
  };
  try { await run({ calls, buckets, advance: milliseconds => { now += milliseconds; } }); }
  finally { globalThis.fetch = originalFetch; for (const [key, value] of previous) value === undefined ? delete process.env[key] : process.env[key] = value; }
}

const limited = (req, id, action = "enquiry-fixture", cap = 20) => memberRateLimit(req, action, 2, 60, id, cap);
const denies = promise => assert.rejects(promise, { status: 429 });

test("existing anonymous/IP-only quotas are unchanged", async () => fixture(async () => {
  await rateLimit(request(), "anonymous-fixture", 2, 60);
  await rateLimit(request(), "anonymous-fixture", 2, 60);
  await denies(rateLimit(request(), "anonymous-fixture", 2, 60));
}));

test("two verified accounts on one IP retain separate personal quotas", async () => fixture(async () => {
  for (const id of [A, B]) { await limited(request(), id); await limited(request(), id); await denies(limited(request(), id)); }
}));

test("a personal quota follows the account across IP and cookie changes", async () => fixture(async () => {
  await limited(request("192.0.2.10"), A);
  const changed = request("192.0.2.11"); changed.headers.cookie = "untrusted_session=new";
  await limited(changed, A);
  await denies(limited(request("192.0.2.12"), A));
}));

test("body/header identity spoofing cannot choose a different personal quota", async () => fixture(async () => {
  const req = request();
  await limited(req, A); await limited(req, A);
  req.headers["x-browserp-account"] = B; req.headers["x-forwarded-for"] = "192.0.2.99"; req.body = { userId: B, accountId: B };
  await denies(limited(req, A));
  await limited(req, B);
}));

test("the shared-network cap still rejects excessive traffic across accounts", async () => fixture(async () => {
  for (const id of [A, B]) { await limited(request(), id, "network-fixture", 4); await limited(request(), id, "network-fixture", 4); }
  await denies(limited(request(), C, "network-fixture", 4));
}));

test("already-throttled accounts do not consume their neighbours' network allowance", async () => fixture(async () => {
  await limited(request(), A, "neighbour-fixture", 4); await limited(request(), A, "neighbour-fixture", 4);
  for (let index = 0; index < 20; index++) await denies(limited(request(), A, "neighbour-fixture", 4));
  await limited(request(), B, "neighbour-fixture", 4); await limited(request(), B, "neighbour-fixture", 4);
}));

test("keys are private, account-canonical, action-scoped and retain the old network bucket", async () => fixture(async ({ calls }) => {
  await limited(request(), A.toUpperCase(), "first-action");
  await limited(request(), A, "first-action");
  await denies(limited(request(), A, "first-action"));
  await limited(request(), A, "second-action");
  const limits = calls.filter(call => call.path.endsWith("/rpc/consume_rate_limit"));
  assert.equal(limits[0].body.p_key_hash, memberHash(A));
  assert.equal(limits[1].body.p_key_hash, clientSignal(request()));
  assert.equal(limits[0].body.p_limit, 2); assert.equal(limits[1].body.p_limit, 20);
  assert.equal(limits[0].body.p_action, limits[1].body.p_action);
  for (const call of limits) {
    assert.match(call.body.p_key_hash, /^[a-f0-9]{64}$/);
    assert.equal(call.options.headers.apikey, "sb_secret_fixture");
    assert.equal(JSON.stringify(call.body).includes(A), false);
    assert.equal(JSON.stringify(call.body).includes("192.0.2.10"), false);
  }
}));

test("missing verified identities and invalid policy values fail before database access", async () => fixture(async ({ calls }) => {
  for (const id of [undefined, "", "attacker", 42, {}]) await assert.rejects(limited(request(), id), { status: 403 });
  for (const [action, limit, window, network] of [["", 2, 60, 20], ["x".repeat(81), 2, 60, 20], ["check", 0, 60, 20], ["check", 2.5, 60, 20], ["check", 2, 0, 20], ["check", 2, 86401, 20], ["check", 2, 60, 1], ["check", 2, 60, 1001]]) {
    await assert.rejects(memberRateLimit(request(), action, limit, window, A, network), { status: 500 });
  }
  assert.equal(calls.length, 0);
}));

test("backend failures remain closed and missing production privacy secrets fail before fetch", async () => {
  await fixture(async () => { await assert.rejects(limited(request(), A), { status: 503 }); }, { intercept: call => call.path.endsWith("/rpc/consume_rate_limit") ? response({ message: "Fixture backend unavailable." }, 503) : undefined });
  await fixture(async ({ calls }) => {
    await assert.rejects(limited(request(), A), { status: 503, code: "PRIVACY_HASH_NOT_CONFIGURED" }); assert.equal(calls.length, 0);
  }, { environment: { NODE_ENV: "production", PRIVACY_HASH_SECRET: "" } });
});

test("local development fallback retains personal and shared quotas without outbound requests", async () => fixture(async ({ calls }) => {
  await limited(request(), A, "local-fixture", 4); await limited(request(), A, "local-fixture", 4); await denies(limited(request(), A, "local-fixture", 4));
  await limited(request(), B, "local-fixture", 4); await limited(request(), B, "local-fixture", 4); await denies(limited(request(), C, "local-fixture", 4));
  assert.equal(calls.length, 0);
}, { environment: { SUPABASE_URL: "", SUPABASE_PUBLISHABLE_KEY: "", SUPABASE_SECRET_KEY: "" } }));

test("parallel requests cannot exceed the backend's atomic account quota and reset uses the original window", async () => fixture(async ({ advance }) => {
  const results = await Promise.allSettled(Array.from({ length: 5 }, () => limited(request(), A, "parallel-fixture")));
  assert.equal(results.filter(result => result.status === "fulfilled").length, 2);
  assert.ok(results.filter(result => result.status === "rejected").every(result => result.reason.status === 429));
  advance(60000); await limited(request(), A, "parallel-fixture");
}));

function enquiryRequest(id, { staff = false, aal = staff ? "aal2" : "aal1" } = {}) {
  const req = request(), claims = Buffer.from(JSON.stringify({ sub: id, aal })).toString("base64url");
  req.url = `/api/${staff ? "admin" : "me"}/advertising-enquiries`;
  Object.assign(req.headers, { origin: "http://localhost:8080", "content-type": "application/json", "x-browserp-csrf": csrf, "x-browserp-account": id, cookie: `brp_access=fixture.${claims}.fixture; brp_csrf=${csrf}` });
  req.body = staff ? { action: "review", id: C, version: 1, status: "reviewing", reply: "", key: C } : {
    action: "create", subject: "Community campaign", destinationUrl: "https://example.com/community", placement: "directory", message: "Please discuss a reviewed campaign for our roleplay community.", key: C, userId: B
  };
  return req;
}

test("member enquiry writes use the verified session account and retain the 12/hour personal cap", async () => fixture(async ({ calls }) => {
  for (let index = 0; index < 12; index++) await memberAdvertisingEnquiries(enquiryRequest(A), output());
  await denies(memberAdvertisingEnquiries(enquiryRequest(A), output()));
  await memberAdvertisingEnquiries(enquiryRequest(B), output());
  const limits = calls.filter(call => call.path.endsWith("/rpc/consume_rate_limit"));
  assert.equal(limits[0].body.p_key_hash, memberHash(A)); assert.equal(limits[0].body.p_limit, 12); assert.equal(limits[0].body.p_window_seconds, 3600);
  assert.equal(limits[1].body.p_limit, 120);
  assert.equal(calls.filter(call => call.path.endsWith("/rpc/member_advertising_enquiries")).length, 13);
}));

test("staff enquiry writes retain MFA and use explicit personal/shared policy limits", async () => fixture(async ({ calls }) => {
  await assert.rejects(staffAdvertisingEnquiries(enquiryRequest(A, { staff: true, aal: "aal1" }), output()), { status: 403 });
  assert.equal(calls.some(call => call.path.endsWith("/rpc/consume_rate_limit")), false);
  await staffAdvertisingEnquiries(enquiryRequest(A, { staff: true }), output());
  const limits = calls.filter(call => call.path.endsWith("/rpc/consume_rate_limit"));
  assert.equal(limits[0].body.p_key_hash, memberHash(A)); assert.equal(limits[0].body.p_limit, 40); assert.equal(limits[0].body.p_window_seconds, 600); assert.equal(limits[1].body.p_limit, 400);
}));
