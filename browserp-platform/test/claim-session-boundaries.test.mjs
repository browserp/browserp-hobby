import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM, VirtualConsole } from "jsdom";
import router from "../api/router.js";

const script = readFileSync(new URL("../public/server-claims.js", import.meta.url), "utf8");
const accountId = "00000000-0000-4000-8000-000000000001";
const otherId = "00000000-0000-4000-8000-000000000002";
const serverId = "00000000-0000-4000-8000-000000000101";
const claimId = "00000000-0000-4000-8000-000000000201";
const attemptId = "00000000-0000-4000-8000-000000000301";
const context = { accountId, authenticated: true, provider: "discord", claimable: true, isOwner: false, reconnectUrl: "/api/auth/discord?claimGuilds=1" };
const privateMessage = "Private ownership explanation for the account holder only.";
const claim = { id: claimId, serverId, status: "denied", message: privateMessage, evidenceUrl: "https://example.test/private-evidence", decisionReason: "Private staff response", verificationStatus: "not_owner" };
const json = (data, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => data });
const listing = (data = {}) => json({ context, csrfToken: "fixture-csrf", claims: [claim], ...data });
const settled = async () => { for (let i = 0; i < 4; i++) await new Promise(resolve => setImmediate(resolve)); };
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
function harness(t, fetch) {
  const errors = [];
  const console = new VirtualConsole(); console.on("jsdomError", error => errors.push(error.message));
  const dom = new JSDOM('<main id="claims"></main>', { url: "https://browserp.test/server/fixture?claim=1", runScripts: "outside-only", virtualConsole: console });
  t.after(() => dom.window.close());
  const w = dom.window; const root = w.document.querySelector("main"); const calls = [];
  w.fetch = (path, options) => { calls.push({ path, ...options }); return fetch(path, options); }; w.eval(script);
  const init = (owner = accountId) => w.BrowseRPServerClaims.init({ server: { id: serverId }, root, accountId: owner });
  const send = () => root.querySelector("form").dispatchEvent(new w.Event("submit", { bubbles: true, cancelable: true }));
  return { w, root, calls, errors, init, send, $: selector => root.querySelector(selector) };
}
function assertCleared(h, references = []) {
  assert.doesNotMatch(h.root.textContent, /Private ownership|Private staff response/);
  assert.equal(h.root.querySelector('a[href="https://example.test/private-evidence"]'), null);
  assert.equal(h.$("textarea"), null);
  for (const field of references) assert.equal(field.value, "");
}

test("session-ended erases displayed claims and detached draft fields, and blocks later submits", async t => {
  const h = harness(t, async () => listing()); const controller = await h.init();
  const message = h.$("textarea"), evidence = h.$("input"), form = h.$("form");
  message.value = privateMessage; evidence.value = "https://example.test/draft";
  assert.match(h.root.textContent, /Private ownership/);
  h.w.dispatchEvent(new h.w.Event("browserp:session-ended")); assertCleared(h, [message, evidence]);
  assert.match(h.root.textContent, /session changed/);
  form.dispatchEvent(new h.w.Event("submit", { cancelable: true }));
  await controller.refresh(); await settled(); assert.equal(h.calls.length, 1);
});

test("401 and 403 refreshes erase private state instead of leaving old claims beneath an error", async t => {
  for (const status of [401, 403]) {
    let denied = false; const h = harness(t, async () => denied ? json({ error: "Sign in again." }, status) : listing());
    const controller = await h.init(); const field = h.$("textarea"); field.value = privateMessage; denied = true;
    assert.equal(await controller.refresh(), false); assertCleared(h, [field]); assert.match(h.root.textContent, /session changed/);
  }
});

test("old account responses cannot render another account's claims", async t => {
  const h = harness(t, async () => listing({ context: { ...context, accountId: otherId } }));
  await h.init(); assertCleared(h); assert.match(h.root.textContent, /session changed/);
  assert.equal(h.calls[0].headers["X-BrowseRP-Account"], accountId);
});

test("anonymous claim options do not inherit authenticated responses", async t => {
  const anon = harness(t, async () => listing({ claims: [], context: { ...context, accountId: null, authenticated: false, provider: null } }));
  await anon.init(null); assert.equal(anon.calls[0].headers["X-BrowseRP-Account"], "");
  assert.equal(anon.$("form").hidden, true); assert.match(anon.root.textContent, /Continue with Discord/);
  const stale = harness(t, async () => listing()); await stale.init(null); assertCleared(stale);
});

test("late initial responses after session end cannot repopulate a cleared panel", async t => {
  const pending = deferred(); const h = harness(t, () => pending.promise); const loading = h.init();
  h.w.dispatchEvent(new h.w.Event("browserp:session-ended")); pending.resolve(listing());
  await loading; assertCleared(h); assert.equal(h.calls[0].signal.aborted, true);
});

test("a late 401 from an older refresh cannot erase a newer successful response", async t => {
  const pending = deferred(); let count = 0;
  const h = harness(t, async () => ++count === 2 ? pending.promise : listing()); const controller = await h.init();
  const old = controller.refresh(); assert.equal(await controller.refresh(), true);
  pending.resolve(json({ error: "Old request expired" }, 401)); assert.equal(await old, false);
  assert.match(h.root.textContent, /Private ownership/); assert.doesNotMatch(h.root.textContent, /session changed/);
});

test("a replaced controller cannot erase or populate the newer account panel", async t => {
  const pending = deferred(); let count = 0;
  const h = harness(t, async () => ++count === 1 ? pending.promise : listing({ context: { ...context, accountId: otherId }, claims: [] }));
  const old = h.init(); await h.init(otherId); pending.resolve(json({ error: "Old account expired" }, 401));
  (await old).destroy(); assert.equal(h.$("form").hidden, false); assert.doesNotMatch(h.root.textContent, /session changed/);
  assert.deepEqual(h.calls.map(call => call.headers["X-BrowseRP-Account"]), [accountId, otherId]);
});

test("pagehide clears private history and drafts before BFCache; restoration requests a reload", async t => {
  const h = harness(t, async () => listing()); await h.init(); const field = h.$("textarea"); field.value = privateMessage;
  h.w.dispatchEvent(new h.w.PageTransitionEvent("pagehide", { persisted: true })); assertCleared(h, [field]);
  h.w.dispatchEvent(new h.w.PageTransitionEvent("pageshow", { persisted: true }));
  assert.equal(h.errors.filter(error => /navigation/.test(error)).length, 1, "jsdom observes the real location.reload call; browser restoration is verified separately");
  assert.equal(h.calls.length, 1);
});

test("uncertain submissions preserve one account, body and key; busy and edited DOM cannot change retries", async t => {
  let posts = 0; const pending = deferred();
  const h = harness(t, async (_path, options) => options.body ? (++posts === 1 ? pending.promise : json({ context, claim })) : listing({ claims: [] }));
  await h.init(); h.$("textarea").value = privateMessage; h.$("input").value = "https://example.test/evidence";
  h.send(); h.send(); assert.equal(posts, 1); pending.resolve(json({ error: "Unavailable" }, 503)); await settled();
  assert.equal(h.$("textarea").readOnly, true); assert.equal(h.$("input").readOnly, true); assert.match(h.$("form").textContent, /Retry the same claim/);
  h.$("textarea").value = "A different message must not replace an uncertain attempt."; h.send(); await settled();
  const sent = h.calls.filter(call => call.body); assert.equal(sent.length, 2);
  assert.equal(sent[0].body, sent[1].body); assert.equal(sent[0].headers["Idempotency-Key"], sent[1].headers["Idempotency-Key"]);
  assert.match(sent[0].headers["Idempotency-Key"], /^[0-9a-f-]{36}$/);
  assert.equal(JSON.parse(sent[0].body).message, privateMessage);
  assert.ok(h.calls.every(call => call.headers["X-BrowseRP-Account"] === accountId && call.cache === "no-store"));
});

test("definite validation failures preserve editable drafts and allocate a new key for corrected evidence", async t => {
  const h = harness(t, async (_path, options) => options.body ? json({ error: "Please correct this evidence." }, 409) : listing({ claims: [] }));
  await h.init(); h.$("textarea").value = privateMessage; h.send(); await settled();
  assert.equal(h.$("textarea").value, privateMessage); assert.equal(h.$("textarea").readOnly, false);
  h.$("textarea").value = "Corrected ownership evidence for staff to review."; h.send(); await settled();
  const sent = h.calls.filter(call => call.body); assert.notEqual(sent[0].headers["Idempotency-Key"], sent[1].headers["Idempotency-Key"]);
  assert.notEqual(sent[0].body, sent[1].body);
});

test("a definite rejection after an uncertain retry unlocks the original draft", async t => {
  let posts = 0;
  const h = harness(t, async (_path, options) => options.body ? json({ error: "Correct the ownership evidence." }, ++posts === 1 ? 503 : 400) : listing({ claims: [] }));
  const controller = await h.init(); h.$("textarea").value = privateMessage; h.send(); await settled();
  assert.equal(h.$("textarea").readOnly, true); h.send(); await settled();
  assert.equal(h.$("textarea").readOnly, false); assert.equal(h.$("textarea").value, privateMessage);
  assert.match(h.$("form").textContent, /Correct the ownership evidence/);
  await controller.refresh(); assert.equal(h.$("form").hidden, false);
  const sent = h.calls.filter(call => call.body); assert.equal(sent[0].body, sent[1].body);
  assert.equal(sent[0].headers["Idempotency-Key"], sent[1].headers["Idempotency-Key"]);
  h.$("textarea").value = "Corrected evidence for this server ownership request."; h.send(); await settled();
  assert.notEqual(h.calls.filter(call => call.body)[2].headers["Idempotency-Key"], sent[0].headers["Idempotency-Key"]);
});

test("pending status confirms an uncertain claim and clears its locked draft", async t => {
  let received = false;
  const h = harness(t, async (_path, options) => { if (options.body) { received = true; throw new Error("Connection closed"); } return listing({ claims: received ? [{ ...claim, status: "pending" }] : [] }); });
  const controller = await h.init(); h.$("textarea").value = privateMessage; h.send(); await settled();
  assert.equal(h.$("textarea").readOnly, true); await controller.refresh();
  assert.equal(h.$("form").hidden, true); assert.equal(h.$("textarea").value, ""); assert.equal(h.$("textarea").readOnly, false);
});

test("late post success and failure cannot restore private details or submission feedback after sign-out", async t => {
  for (const result of [json({ context, claim }), json({ error: "Denied" }, 401)]) {
    const pending = deferred(); const h = harness(t, async (_path, options) => options.body ? pending.promise : listing({ claims: [] }));
    await h.init(); const field = h.$("textarea"); field.value = privateMessage; h.send();
    h.w.dispatchEvent(new h.w.Event("browserp:session-ended")); pending.resolve(result); await settled();
    assertCleared(h, [field]); assert.match(h.root.textContent, /session changed/); assert.equal(h.calls.length, 2);
  }
});

const csrf = "c".repeat(43);
const token = `fixture.${Buffer.from(JSON.stringify({ sub: accountId, aal: "aal2" })).toString("base64url")}.fixture`;
const user = { id: accountId, app_metadata: { provider: "discord", providers: ["discord"] }, identities: [{ provider: "discord", provider_id: "111111111111111111" }] };
const server = { id: serverId, name: "Fixture server", slug: "fixture", status: "published", owner_id: null, community_url: "https://discord.gg/fixture" };
function request(method = "GET", headers = {}, body) {
  return { method, browserpRoute: "server-claims", url: `/api/server-claims?serverId=${serverId}`, body, headers: {
    host: "localhost:8080", origin: "http://localhost:8080", "content-type": "application/json", cookie: `brp_access=${token}; brp_csrf=${csrf}`,
    "x-browserp-csrf": csrf, "x-browserp-account": accountId, "idempotency-key": attemptId, ...headers
  }, socket: { remoteAddress: "127.0.0.1" } };
}
function output() { const headers = new Map(); return { headers, setHeader: (key, value) => headers.set(key, value), getHeader: key => headers.get(key), end(value) { this.body = JSON.parse(value); } }; }
async function fixture(run) {
  const env = { SUPABASE_URL: "https://fixture.supabase.co", SUPABASE_PUBLISHABLE_KEY: "sb_publishable_fixture", SUPABASE_SECRET_KEY: "sb_secret_fixture", APP_URL: "http://localhost:8080", NODE_ENV: "test", VERCEL: "0", PRIVACY_HASH_SECRET: "fixture-private-hash" };
  const previous = new Map(Object.keys(env).map(key => [key, process.env[key]])); const original = globalThis.fetch; const calls = []; Object.assign(process.env, env);
  globalThis.fetch = async (value, options = {}) => {
    const url = new URL(value); const body = options.body ? JSON.parse(options.body) : undefined; calls.push({ url, options, body });
    const answer = data => new Response(JSON.stringify(data), { headers: { "Content-Type": "application/json" } });
    if (url.pathname === "/auth/v1/user") return answer(user);
    if (url.pathname.endsWith("/rpc/check_security_ban_server")) return answer(null);
    if (url.pathname.endsWith("/rpc/consume_rate_limit")) return answer(true);
    if (url.pathname === "/rest/v1/servers") return answer([server]);
    if (url.pathname.endsWith("/rpc/member_server_claims")) return answer({ items: [{ ...claim, status: "pending" }] });
    if (url.pathname.endsWith("/rpc/member_server_claim") || url.pathname.endsWith("/rpc/service_verify_server_claim")) return answer({ ...claim, status: "pending", verificationStatus: "needs_discord" });
    throw new Error(`Unexpected fixture endpoint: ${url.pathname}`);
  };
  try { await run(calls); } finally { globalThis.fetch = original; for (const [key, value] of previous) value === undefined ? delete process.env[key] : process.env[key] = value; }
}
const write = { action: "request", serverId, message: privateMessage, evidenceUrl: null };

test("actual claims route rejects missing, changed and ambiguous account headers before private reads or writes", async () => fixture(async calls => {
  for (const method of ["GET", "POST"]) for (const expected of [undefined, "", otherId, [accountId]]) {
    calls.length = 0; const res = output(); await router(request(method, { "x-browserp-account": expected }, method === "POST" ? write : undefined), res);
    assert.equal(res.statusCode, 401); assert.match(res.body.error, /account has changed/); assert.equal(res.headers.get("Cache-Control"), "no-store");
    assert.ok(calls.every(call => /\/auth\/v1\/user$|\/rpc\/check_security_ban_server$/.test(call.url.pathname)));
    assert.equal(JSON.stringify(res.body).includes(privateMessage), false);
  }
}));

test("actual route exposes account identity only for the matching session and leaves anonymous options public", async () => fixture(async calls => {
  const member = output(); await router(request(), member); assert.equal(member.statusCode, 200);
  assert.equal(member.body.context.accountId, accountId); assert.equal(member.body.claims[0].message, privateMessage);
  for (const expected of [undefined, "", accountId]) {
    calls.length = 0; const res = output(); await router(request("GET", { cookie: "", "x-browserp-account": expected }), res);
    assert.equal(res.statusCode, expected === accountId ? 401 : 200);
    if (res.statusCode === 200) { assert.equal(res.body.context.accountId, null); assert.equal(res.body.context.authenticated, false); assert.deepEqual(res.body.claims, []); }
    assert.equal(calls.some(call => call.url.pathname.endsWith("/rpc/member_server_claims")), false);
  }
}));

test("actual route carries the preserved attempt key into the authenticated claim RPC; rejects malformed keys and CSRF", async () => fixture(async calls => {
  for (let i = 0; i < 2; i++) {
    const res = output(); await router(request("POST", {}, write), res); assert.equal(res.statusCode, 200); assert.equal(res.body.context.accountId, accountId);
    assert.notEqual(res.headers.get("X-Request-ID"), attemptId);
  }
  const writes = calls.filter(call => call.url.pathname.endsWith("/rpc/member_server_claim")); assert.equal(writes.length, 2);
  assert.ok(writes.every(call => call.body.p_request_id === attemptId && call.options.headers.Authorization === `Bearer ${token}`));
  for (const headers of [{ "idempotency-key": undefined }, { "idempotency-key": "not-a-key" }, { "idempotency-key": [attemptId] }, { "x-browserp-csrf": "b".repeat(43) }, { origin: "https://attacker.test" }]) {
    calls.length = 0; const res = output(); await router(request("POST", headers, write), res);
    assert.equal(res.statusCode, Object.hasOwn(headers, "idempotency-key") ? 400 : 403);
    assert.equal(calls.some(call => call.url.pathname.endsWith("/rpc/member_server_claim") || call.url.pathname.endsWith("/rpc/service_verify_server_claim")), false);
  }
}));
