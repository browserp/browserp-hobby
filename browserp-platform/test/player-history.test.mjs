import test from "node:test";
import assert from "node:assert/strict";
import { historySelection, mapHistory, readPlayerHistory } from "../lib/player-history.js";
import handler from "../api/servers.js";

const end = Date.parse("2026-09-09T12:00:00Z"), start = end - 8 * 3600000;
const server = { id: "aaaaaaaa-0000-4000-8000-000000000001", slug: "county-rp", platform_id: "fivem", status: "published", age_rating: "teen", platforms: { enabled: true } };
const selection = range => new URLSearchParams({ slug: server.slug, history: range });
const row = (ago, players = 30) => ({ checked_at: new Date(end - ago).toISOString(), online: true, players, capacity: 128 });
const options = read => ({ read, limit: async () => {}, now: () => end });

test("history accepts only four fixed windows, one safe slug and no extra/duplicate controls", () => {
  for (const range of ["1h", "8h", "12h", "24h"]) assert.equal(historySelection(selection(range)).range, range);
  for (const query of ["slug=county-rp&history=365d", "slug=county-rp&history=48h", "slug=county-rp&history=7d", "slug=county-rp&history=", "history=8h", "slug=county-rp&history=8h&history=7d", "slug=county-rp&history=8h&limit=999999", "slug=x%26status%3Deq.draft&history=8h", "slug=county-rp&slug=other&history=8h"]) assert.throws(() => historySelection(new URLSearchParams(query)), error => error.status === 400);
});

test("mapping preserves actual zeroes, source times and gaps without turning unknown counts into zero", () => {
  const result = mapHistory([row(60000, 0), row(60000, 99), row(1800000, 20), { ...row(120000), online: false }, { ...row(150000), players: null }, null, row(-1000), row(9 * 3600000)], { start, end });
  assert.deepEqual(result.points.map(point => point.players), [20, 0]);
  assert.deepEqual(result.points.map(point => point.at), [row(1800000).checked_at, row(60000).checked_at]);
  assert.equal(result.gaps, 1); assert.equal(result.partial, true); assert.equal(result.lastAt, row(60000).checked_at);
  assert.equal(result.observations, 2);
});

test("complete source coverage differs from partial/empty histories and no point extends to now", () => {
  const rows = Array.from({ length: 480 }, (_, index) => row((index + 1) * 60000));
  const result = mapHistory(rows, { start, end });
  assert.equal(result.partial, false); assert.equal(result.sampled, false); assert.equal(result.gaps, 0);
  assert.equal(Date.parse(result.lastAt), end - 60000);
  assert.equal(mapHistory([], { start, end }).partial, true);
  assert.equal(mapHistory(rows, { start, end, truncated: true }).truncated, true);
});

test("large histories retain actual extremes and timestamps within 480 points", () => {
  const rows = Array.from({ length: 3000 }, (_, index) => row((index + 1) * 8000, index === 1310 ? 128 : index === 1311 ? 0 : 30));
  const result = mapHistory(rows, { start, end });
  assert.ok(result.points.length <= 480); assert.equal(result.observations, 3000); assert.equal(result.sampled, true);
  for (const point of result.points) assert.ok(rows.some(row => row.checked_at === point.at && row.players === point.players));
  assert.ok(result.points.some(point => point.players === 128)); assert.ok(result.points.some(point => point.players === 0));
  assert.equal(result.firstAt, result.points[0].at); assert.equal(result.lastAt, result.points.at(-1).at);
});

test("data reads are restricted to one published non-adult enabled-game listing, its provider, and a fixed time interval", async () => {
  const calls = [], quotas = [];
  const payload = await readPlayerHistory({}, selection("8h"), { ...options(async (path, opts) => { calls.push({ url: new URL(path, "https://example.invalid"), opts }); return path.startsWith("servers?") ? [server] : [row(60000)]; }), limit: async (...args) => quotas.push(args) });
  assert.equal(calls.length, 2); assert.deepEqual(quotas[0].slice(1), ["player-history", 20, 300]);
  for (const call of calls) assert.deepEqual(Object.keys(call.opts), ["signal"]);
  assert.equal(calls[0].url.searchParams.get("status"), "eq.published"); assert.equal(calls[0].url.searchParams.get("age_rating"), "neq.adult"); assert.equal(calls[0].url.searchParams.get("platforms.enabled"), "eq.true");
  assert.equal(calls[1].url.searchParams.get("server_id"), `eq.${server.id}`); assert.equal(calls[1].url.searchParams.get("provider_status"), "eq.cfx");
  assert.deepEqual(calls[1].url.searchParams.getAll("checked_at"), [`gte.${new Date(start).toISOString()}`, `lte.${new Date(end).toISOString()}`]);
  assert.equal(payload.points.length, 1);
});

test("all ranges stop at their fixed row/page budgets and mark conservative truncation", async () => {
  for (const [range, pages] of [["1h", 1], ["8h", 2], ["12h", 2], ["24h", 3]]) {
    let reads = 0;
    const payload = await readPlayerHistory({}, selection(range), options(async path => {
      if (path.startsWith("servers?")) return [server];
      const query = new URL(path, "https://example.invalid").searchParams;
      assert.equal(Number(query.get("offset")), reads++ * 1000); assert.equal(query.get("limit"), "1000");
      return Array.from({ length: 1000 }, (_, index) => row((Number(query.get("offset")) + index + 1) * 1000));
    }));
    assert.equal(reads, pages); assert.equal(payload.truncated, true); assert.equal(payload.partial, true); assert.equal(payload.observations, pages * 1000); assert.ok(JSON.stringify(payload).length < 64000);
  }
});

test("short first pages stop, Roblox never reads player data, Minecraft retains network scope", async () => {
  for (const platform of ["roblox", "minecraft"]) {
    const calls = [];
    const result = await readPlayerHistory({}, selection("24h"), options(async path => { calls.push(path); return path.startsWith("servers?") ? [{ ...server, platform_id: platform }] : []; }));
    assert.equal(result.supported, platform === "minecraft"); assert.equal(calls.length, platform === "minecraft" ? 2 : 1);
    assert.equal(result.points.length, 0);
    if (platform === "minecraft") { assert.equal(result.scope, "network"); assert.match(calls[1], /provider_status=eq.minecraft/); }
  }
});

test("hidden servers, table denial, deadline and oversized backend responses fail without fallbacks", async () => {
  let blockedReads = 0;
  await assert.rejects(readPlayerHistory({}, selection("8h"), { ...options(async () => { blockedReads++; }), limit: async () => { throw Object.assign(new Error("Too many requests"), { status: 429 }); } }), error => error.status === 429);
  assert.equal(blockedReads, 0);
  for (const invalidServer of [[], [{ ...server, status: "draft" }], [{ ...server, age_rating: "adult" }], [{ ...server, platforms: { enabled: false } }]]) {
    let calls = 0;
    await assert.rejects(readPlayerHistory({}, selection("8h"), options(async () => { calls++; return invalidServer; })), error => error.status === 404);
    assert.equal(calls, 1);
  }
  let calls = 0;
  const denial = Object.assign(new Error("permission denied for table server_status_snapshots"), { status: 403 });
  await assert.rejects(readPlayerHistory({}, selection("8h"), options(async path => { calls++; if (path.startsWith("servers?")) return [server]; throw denial; })), error => error === denial);
  assert.equal(calls, 2);
  const controller = new AbortController();
  await assert.rejects(readPlayerHistory({}, selection("8h"), { ...options(async () => { controller.abort(); return [server]; }), signal: controller.signal }), /abort/i);
  for (const badBatch of [Array(1001).fill(row(1000)), [{ ...row(1000), checked_at: "x".repeat(260000) }], { rows: [] }]) await assert.rejects(readPlayerHistory({}, selection("8h"), options(async path => path.startsWith("servers?") ? [server] : badBatch)), error => error.status === 502);
});

test("HTTP history branch uses public-key data reads, existing quota and 60-second cache without auth or source refresh", async () => {
  const env = { SUPABASE_URL: "https://fixture.supabase.co", SUPABASE_PUBLISHABLE_KEY: "sb_publishable_fixture", SUPABASE_SECRET_KEY: "sb_secret_fixture", NODE_ENV: "test", VERCEL: "0", PRIVACY_HASH_SECRET: "history-test-only" };
  const previous = new Map(Object.keys(env).map(key => [key, process.env[key]])), originalFetch = globalThis.fetch, calls = [];
  Object.assign(process.env, env);
  globalThis.fetch = async (url, options) => {
    const path = new URL(url).pathname; calls.push(path);
    if (path.endsWith("/consume_rate_limit")) { assert.equal(options.headers.apikey, "sb_secret_fixture"); return new Response("true"); }
    assert.equal(options.headers.apikey, "sb_publishable_fixture"); assert.equal(options.headers.Authorization, undefined);
    if (path.endsWith("/servers")) return new Response(JSON.stringify([server]));
    if (path.endsWith("/server_status_snapshots")) return new Response("[]");
    throw new Error(`Unexpected auth or refresh request: ${path}`);
  };
  const headers = new Map(), response = { setHeader: (key, value) => headers.set(key, value), end(body) { this.body = JSON.parse(body); } };
  try {
    await handler({ method: "GET", url: "/api/servers?slug=county-rp&history=8h", headers: { cookie: "brp_access=do-not-forward" }, socket: { remoteAddress: "127.0.0.1" } }, response);
    assert.equal(response.statusCode, 200); assert.equal(response.body.supported, true); assert.equal(calls.length, 3);
    assert.equal(headers.get("Cache-Control"), "public, max-age=0, s-maxage=60, stale-while-revalidate=240");
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of previous) value === undefined ? delete process.env[key] : process.env[key] = value;
  }
});
