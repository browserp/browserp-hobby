import test from "node:test";
import assert from "node:assert/strict";
import { memberPreferences } from "../lib/member-preferences.js";

const accountId = "00000000-0000-4000-8000-000000000001";
const otherId = "00000000-0000-4000-8000-000000000002";
const csrf = "c".repeat(43);
const token = `fixture.${Buffer.from(JSON.stringify({ sub: accountId, aal: "aal1" })).toString("base64url")}.fixture`;
const user = { id: accountId, app_metadata: { provider: "google", providers: ["google"] }, identities: [{ provider: "google" }] };
const empty = { accountId, schemaVersion: 1, choice: null, version: 0, updatedAt: null };
const saved = (choice = "rejected", version = 1) => ({ accountId, schemaVersion: 1, choice, version, updatedAt: "2026-09-08T10:20:30.123456+00:00" });
const bodyFor = (choice = "accepted", expectedVersion = 0) => ({ schemaVersion: 1, choice, expectedVersion });
const response = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
const request = (body) => ({
  method: body === undefined ? "GET" : "POST", url: "/api/me/preferences", body,
  headers: { host: "localhost:8080", origin: "http://localhost:8080", "content-type": "application/json", "x-browserp-account": accountId, "x-browserp-csrf": csrf, cookie: `brp_access=${token}; brp_csrf=${csrf}` },
  socket: { remoteAddress: "127.0.0.1" }
});
function output() {
  const headers = new Map();
  return { setHeader: (key, value) => headers.set(key, value), getHeader: key => headers.get(key) };
}
const isPreference = call => call.path.endsWith("/member_recommendation_preferences") || call.path.endsWith("/member_set_recommendation_preferences");
async function fixture(run, handler = () => undefined) {
  const values = { SUPABASE_URL: "https://fixture.supabase.co", SUPABASE_PUBLISHABLE_KEY: "sb_publishable_fixture", SUPABASE_SECRET_KEY: "sb_secret_fixture", APP_URL: "http://localhost:8080", NODE_ENV: "test", VERCEL: "0", PRIVACY_HASH_SECRET: "fixture-private-hash" };
  const previous = new Map(Object.keys(values).map(key => [key, process.env[key]]));
  const original = globalThis.fetch, calls = [];
  Object.assign(process.env, values);
  globalThis.fetch = async (value, options = {}) => {
    const call = { path: new URL(value).pathname, options, body: options.body === undefined ? undefined : JSON.parse(options.body) };
    calls.push(call);
    const custom = await handler(call); if (custom !== undefined) return custom;
    if (call.path === "/auth/v1/user") return response(user);
    if (call.path.endsWith("/check_security_ban_server")) return response(null);
    if (call.path.endsWith("/member_recommendation_preferences")) return response(empty);
    if (call.path.endsWith("/member_set_recommendation_preferences")) return response(saved(call.body.p_choice, call.body.p_expected_version + 1));
    throw new Error(`Unexpected fixture request ${call.path}`);
  };
  try { await run(calls); }
  finally {
    globalThis.fetch = original;
    for (const [key, value] of previous) value === undefined ? delete process.env[key] : process.env[key] = value;
  }
}

test("preference reads return an account-bound empty record on the caller token without caching", async () => fixture(async calls => {
  const res = output();
  assert.deepEqual(await memberPreferences(request(), res), empty);
  assert.equal(res.getHeader("Cache-Control"), "no-store");
  const call = calls.find(isPreference);
  assert.deepEqual(call.body, {});
  assert.equal(call.options.headers.Authorization, `Bearer ${token}`);
  assert.equal(call.options.headers.apikey, "sb_publishable_fixture");
}));

test("preference writes forward only the exact versioned choice using the caller token", async () => fixture(async calls => {
  for (const choice of ["accepted", "rejected"]) {
    const result = await memberPreferences(request(bodyFor(choice, 4)), output());
    assert.deepEqual(result, saved(choice, 5));
  }
  const writes = calls.filter(call => call.path.endsWith("/member_set_recommendation_preferences"));
  assert.deepEqual(writes.map(call => call.body), ["accepted", "rejected"].map(p_choice => ({ p_schema_version: 1, p_choice, p_expected_version: 4 })));
  assert.ok(writes.every(call => call.options.headers.Authorization === `Bearer ${token}` && call.options.headers.apikey === "sb_publishable_fixture"));
  assert.equal(calls.some(call => /history|storage|theme|consume_rate_limit/.test(call.path)), false);
}));

test("preference writes reject unsupported consent versions, values and every unknown field", async () => fixture(async calls => {
  const valid = bodyFor();
  for (const body of [
    {}, [], "null", { ...valid, schemaVersion: 2 }, { ...valid, schemaVersion: "1" },
    { ...valid, choice: true }, { ...valid, choice: "allow" }, { ...valid, choice: null },
    ...[-1, 0.5, "0", null, Number.MAX_SAFE_INTEGER + 1].map(expectedVersion => ({ ...valid, expectedVersion })),
    ...["history", "visits", "accountId", "userId", "theme", "updatedAt", "version", "extra"].map(key => ({ ...valid, [key]: "forbidden" })),
    { schemaVersion: 1, choice: "rejected" }
  ]) await assert.rejects(memberPreferences(request(body), output()), { status: 400 });
  assert.equal(calls.some(isPreference), false);
}));

test("origin and CSRF rejection occur before Auth or preference requests", async () => fixture(async calls => {
  for (const change of [{ origin: "https://other.example" }, { "sec-fetch-site": "cross-site" }, { "x-browserp-csrf": "wrong" }]) {
    const req = request(bodyFor("rejected")); Object.assign(req.headers, change);
    await assert.rejects(memberPreferences(req, output()), { status: 403 });
  }
  assert.equal(calls.length, 0);
}));

test("both reads and writes require the displayed account and stop on a switched cookie account", async () => fixture(async calls => {
  for (const body of [undefined, bodyFor("accepted"), bodyFor("rejected")]) {
    for (const account of [undefined, otherId, [accountId]]) {
      const req = request(body); req.headers["x-browserp-account"] = account;
      await assert.rejects(memberPreferences(req, output()), { status: 401 });
    }
  }
  assert.equal(calls.some(isPreference), false);
}));

test("guests and revoked sessions cannot read or write preferences", async () => {
  await fixture(async calls => {
    for (const body of [undefined, bodyFor("rejected")]) {
      const req = request(body); req.headers.cookie = `brp_csrf=${csrf}`;
      await assert.rejects(memberPreferences(req, output()), { status: 401 });
    }
    assert.equal(calls.some(isPreference), false);
  });
  await fixture(async () => {
    for (const body of [undefined, bodyFor("rejected")]) await assert.rejects(memberPreferences(request(body), output()), { status: 403 });
  }, call => isPreference(call) ? response({ message: "An active, unrestricted sign-in is required" }, 403) : undefined);
});

test("conflicts, throttling and backend outages propagate without retrying or inventing an acceptance", async () => {
  for (const status of [409, 429, 503]) await fixture(async calls => {
    await assert.rejects(memberPreferences(request(bodyFor()), output()), { status });
    assert.equal(calls.filter(isPreference).length, 1);
  }, call => isPreference(call) ? response({ message: "Fixture refusal" }, status) : undefined);
  await fixture(async calls => {
    await assert.rejects(memberPreferences(request(), output()), { status: 503 });
    assert.equal(calls.filter(isPreference).length, 1);
  }, call => isPreference(call) ? response({ message: "Unavailable" }, 503) : undefined);
});

test("malformed, cross-account or contradictory backend records cannot authorize collection", async () => {
  for (const value of [
    null, [], { ...empty, choice: "accepted" }, { ...empty, updatedAt: saved().updatedAt },
    { ...saved(), accountId: otherId }, { ...saved(), schemaVersion: 2 },
    { ...saved(), choice: true }, { ...saved(), version: "1" }, { ...saved(), version: Number.MAX_SAFE_INTEGER + 1 },
    { ...saved(), updatedAt: null }, { ...saved(), updatedAt: "September 8, 2026" }
  ]) await fixture(async () => {
    await assert.rejects(memberPreferences(request(), output()), { status: 503 });
  }, call => isPreference(call) ? response(value) : undefined);
  for (const value of [empty, saved("accepted", 0), saved("rejected", 1), saved("accepted", 4)]) await fixture(async () => {
    await assert.rejects(memberPreferences(request(bodyFor()), output()), { status: 503 });
  }, call => isPreference(call) ? response(value) : undefined);
  await fixture(async () => {
    await assert.rejects(memberPreferences(request(bodyFor("rejected")), output()), { status: 503 });
  }, call => isPreference(call) ? response(saved("accepted")) : undefined);
});

test("extra response data is stripped and stale rejection responses need not exceed the caller version", async () => {
  await fixture(async () => {
    assert.deepEqual(await memberPreferences(request(), output()), saved());
  }, call => isPreference(call) ? response({ ...saved(), history: ["private"], secret: "never-return" }) : undefined);
  await fixture(async () => {
    assert.deepEqual(await memberPreferences(request(bodyFor("rejected", 20)), output()), saved("rejected", 4));
  }, call => isPreference(call) ? response(saved("rejected", 4)) : undefined);
});

test("unsupported methods, content types and oversized payloads do not reach the preference RPC", async () => fixture(async calls => {
  const req = request(); req.method = "DELETE"; const res = output();
  await assert.rejects(memberPreferences(req, res), { status: 405 });
  assert.equal(res.getHeader("Allow"), "GET, POST"); assert.equal(calls.length, 0);
  const badType = request(bodyFor()); badType.headers["content-type"] = "text/plain";
  await assert.rejects(memberPreferences(badType, output()), { status: 415 });
  await assert.rejects(memberPreferences(request({ ...bodyFor(), history: "x".repeat(2000) }), output()), { status: 413 });
  assert.equal(calls.some(isPreference), false);
}));
