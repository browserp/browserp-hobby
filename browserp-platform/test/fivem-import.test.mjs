import test from "node:test";
import assert from "node:assert/strict";
import { fetchFiveMFeatured, fetchFiveMServer, normalizeFiveMServer, parseFiveMJoinCode, safeFiveMImageUrl } from "../lib/fivem-import.js";

const now = "2026-09-04T12:00:00.000Z";
const make = (data = {}, vars = {}) => ({ EndPoint: "abc123", Data: { hostname: "^3Example City", clients: 12, svMaxclients: 64, lastSeen: "2026-09-04T11:59:30Z", iconVersion: 42, resources: ["qb-core"], ...data, vars: { gamename: "gta5", sv_projectName: "^6Example Roleplay", sv_projectDesc: "A friendly roleplay community with businesses and character stories.", locale: "en_GB", tags: "roleplay, custom-cars, player_owned_businesses", sv_appearAllowlisted: "false", ...vars } } });
const normalize = (raw) => normalizeFiveMServer(raw, { now });
const json = (value, init = {}) => new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json; charset=utf-8" }, ...init });

test("FiveM identifiers accept current seven-character codes without allowing URL or path injection", () => {
  for (const [value, expected] of [["abc123", "abc123"], [" https://cfx.re/join/6MYR996/ ", "6myr996"], ["cfx.re/join/abc123", "abc123"]]) assert.equal(parseFiveMJoinCode(value), expected);
  for (const value of [null, "a", "a".repeat(13), "https://discord.gg/abc123", "http://cfx.re/join/abc123", "https://cfx.re.evil.com/join/abc123", "https://cfx.re@evil.com/join/abc123", "https://cfx.re/join/abc123?q=1", "https://cfx.re/join/abc123#extra", "https://cfx.re/join/abc123/extra", "https://127.0.0.1/info.json", "../abc123", "abc123%2f"]) assert.throws(() => parseFiveMJoinCode(value), { code: "invalid_join_code" }, String(value));
});

test("FiveM normalization classifies mislabeled links by destination and never puts URLs into tags", () => {
  const result = normalize(make({}, { join: "https://discord.gg/OurCity", discord: "roleplay, cars", tags: "roleplay, https://discord.com/invite/OurCity, custom-cars", website: "https://cfx.re/join/abc123", banner_detail: "https://discord.gg/OurCity" }));
  assert.equal(result.links.communityUrl, "https://discord.gg/OurCity");
  assert.equal(result.links.cfxJoinUrl, "https://cfx.re/join/abc123");
  assert.equal(result.links.websiteUrl, null);
  assert.deepEqual(result.tags, ["roleplay", "custom cars"]);
  assert.equal(result.images.bannerUrl, null);
  assert.ok(result.issues.some((entry) => entry.code === "mislabeled_field"));
  assert.ok(result.issues.some((entry) => entry.code === "invalid_image"));
  assert.equal(result.name, "Example Roleplay");
  assert.equal(result.language, "English"); assert.equal(result.region, "United Kingdom"); assert.equal(result.framework, "QBCore");
  assert.equal(result.access, "public");
  assert.ok(result.evidence.some((entry) => entry.field === "links.communityUrl" && ["vars.tags", "vars.join"].includes(entry.source)));
  assert.ok(result.requiresReview);
});

test("Conflicting, deceptive, mismatching and non-invite Discord links are not silently selected", () => {
  const result = normalize(make({}, { discord: "https://discord.gg/alpha", community: "https://discord.com/invite/beta", join: "https://cfx.re/join/xyz789", fake: "https://discord.gg.evil.com/invite/alpha", other: "https://discord.com/channels/123/456", website: "https://community.example.org/about" }));
  assert.equal(result.links.communityUrl, null); assert.equal(result.links.cfxJoinUrl, "https://cfx.re/join/abc123");
  assert.equal(result.links.websiteUrl, "https://community.example.org/about");
  assert.ok(result.issues.some((entry) => entry.code === "different_join_link" && entry.severity === "error"));
  assert.ok(result.issues.some((entry) => entry.code === "conflicting_links"));
  assert.equal(result.confidence, "low");
  assert.throws(() => normalizeFiveMServer(make(), { joinCode: "xyz789", now }), { code: "mismatched_server" });
  assert.throws(() => normalize(make({}, { gamename: "rdr3" })), { code: "wrong_platform" });
});

test("Unknown and stale player snapshots never become a false live zero", () => {
  assert.deepEqual(normalize(make()).players, { online: 12, max: 64, observedAt: "2026-09-04T11:59:30.000Z", status: "online" });
  assert.equal(normalize(make({ clients: 0 })).players.online, 0);
  for (const data of [{ clients: undefined }, { clients: "42" }, { clients: -1 }, { clients: 65 }, { clients: 1.5 }, { lastSeen: "2026-09-04T11:00:00Z" }, { lastSeen: "2026-09-04T13:00:00Z" }, { fallback: true }]) {
    const result = normalize(make(data)); assert.equal(result.players.online, null, JSON.stringify(data)); assert.equal(result.players.observedAt, null);
  }
  assert.equal(normalize(make({ fallback: true })).players.status, "offline");
  const withoutTime = normalize(make({ lastSeen: undefined }));
  assert.equal(withoutTime.players.observedAt, now); assert.ok(withoutTime.issues.some((entry) => entry.code === "unknown_upstream_age"));
  assert.equal(normalize(make({ svMaxclients: null, sv_maxclients: 32 })).players.max, 32);
});

test("Conflicting access claims stay unknown instead of advertising an allowlist server as public", () => {
  const result = normalize(make({}, { sv_projectName: "Example Roleplay Allowlist", sv_appearAllowlisted: "false", tags: "roleplay,allowlist" }));
  assert.equal(result.access, null); assert.ok(result.issues.some((entry) => entry.code === "conflicting_access"));
  assert.equal(normalize(make({}, { sv_appearAllowlisted: "true", tags: "roleplay,public" })).access, null);
  assert.equal(normalize(make({}, { sv_appearAllowlisted: "true", tags: "roleplay,allowlist" })).access, "allowlisted");
});

test("Image candidates use only approved image sources and exclude private, unsafe, or mislabeled URLs", () => {
  const result = normalize(make({}, { banner_detail: "https://i.imgur.com/city.png", logo: "https://cdn.discordapp.com/attachments/123/456/logo.webp", image: "https://arbitrary.example.org/tracking.png", unsafe: "https://127.0.0.1/banner.png", local: "https://private.local/banner.png", port: "https://i.imgur.com:8443/city.png", credentials: "https://user:password@i.imgur.com/city.png", svg: "https://i.imgur.com/bad.svg" }));
  assert.equal(result.images.bannerUrl, "https://i.imgur.com/city.png");
  assert.equal(result.images.logoUrl, "https://frontend.cfx-services.net/api/servers/icon/abc123/42.png");
  assert.ok(result.issues.some((entry) => entry.code === "untrusted_image_host"));
  assert.ok(!JSON.stringify(result.images).includes("127.0.0.1"));
  assert.equal(normalize(make({ iconVersion: undefined }, { logo: "https://cdn.discordapp.com/attachments/123/456/logo.webp" })).images.logoUrl, "https://cdn.discordapp.com/attachments/123/456/logo.webp");
  assert.equal(safeFiveMImageUrl(result.images.logoUrl), result.images.logoUrl);
  assert.equal(safeFiveMImageUrl(result.images.bannerUrl), result.images.bannerUrl);
  for (const url of ["https://127.0.0.1/file.png", "https://arbitrary.example.org/file.png", "https://frontend.cfx-services.net/redirect/test.png", "https://i.imgur.com/file.svg", "https://discord.gg/notanimage"]) assert.equal(safeFiveMImageUrl(url), null);
});

test("Normalization exposes bounded review evidence without copying private source fields or inferring absent metadata", () => {
  const result = normalize(make({ players: [{ name: "NeverExposePlayer", identifiers: ["NeverExposeDiscord"] }], connectEndPoints: ["NeverExposeIP"], ownerAvatar: "NeverExposeAvatar", resources: ["qb-core", "es_extended"] }, { sv_licenseKeyToken: "NeverExposeToken", rcon_password: "NeverExposePassword", discord_webhook: "https://discord.gg/NeverExposeWebhook", locale: "root-AQ", sv_projectDesc: "<script>Example</script> \u202e" + "A".repeat(4_000), tags: Array.from({ length: 100 }, (_, n) => `tag${n}`).join(","), sv_appearAllowlisted: "maybe" }));
  assert.doesNotMatch(JSON.stringify(result), /NeverExpose/);
  assert.equal(result.framework, null); assert.equal(result.language, null); assert.equal(result.region, null); assert.equal(result.access, null);
  assert.equal(result.description.length, 3_000); assert.ok(result.tags.length <= 24); assert.ok(result.tags.every((tag) => tag.length <= 40)); assert.ok(result.keywords.length <= 30); assert.ok(result.evidence.length <= 80); assert.ok(result.issues.length <= 40);
  assert.ok(result.issues.some((entry) => entry.code === "conflicting_frameworks"));
  assert.ok(result.issues.some((entry) => entry.code === "content_review"));
  assert.doesNotMatch(result.description, /[<>\u202e]/);
});

test("FiveM fetches one fixed endpoint with timeout, redirect blocking and no player endpoint requests", async () => {
  const calls = [];
  const result = await fetchFiveMServer("https://cfx.re/join/abc123", { now, fetchImpl: async (url, options) => { calls.push({ url, options }); return json(make()); } });
  assert.equal(calls.length, 1); assert.equal(calls[0].url, "https://frontend.cfx-services.net/api/servers/single/abc123");
  assert.equal(calls[0].options.redirect, "error"); assert.equal(calls[0].options.cache, "no-store"); assert.ok(calls[0].options.signal instanceof AbortSignal);
  assert.equal(result.source.fetchedAt, now);
  await assert.rejects(fetchFiveMServer("https://127.0.0.1/info.json", { fetchImpl: () => assert.fail("Invalid input must not make a request") }), { code: "invalid_join_code" });
});

test("Upstream limits, blocked access, invalid JSON, body limits, redirects and timeouts fail explicitly without fallback fetching", async () => {
  for (const [status, code] of [[404, "not_found"], [403, "upstream_unavailable"], [429, "upstream_rate_limited"], [500, "upstream_error"]]) await assert.rejects(fetchFiveMServer("abc123", { fetchImpl: async () => new Response("unavailable", { status }) }), { code });
  await assert.rejects(fetchFiveMServer("abc123", { fetchImpl: async () => new Response("<!doctype html>", { headers: { "content-type": "text/html" } }) }), { code: "invalid_response" });
  await assert.rejects(fetchFiveMServer("abc123", { fetchImpl: async () => new Response("{", { headers: { "content-type": "application/json" } }) }), { code: "invalid_response" });
  await assert.rejects(fetchFiveMServer("abc123", { fetchImpl: async () => new Response(" ".repeat(1_048_577), { headers: { "content-type": "application/json" } }) }), { code: "response_too_large" });
  await assert.rejects(fetchFiveMServer("abc123", { fetchImpl: async () => new Response("{}", { headers: { "content-type": "application/json", "content-length": "1048577" } }) }), { code: "response_too_large" });
  await assert.rejects(fetchFiveMServer("abc123", { fetchImpl: async () => { throw new TypeError("redirect encountered"); } }), { code: "upstream_unavailable" });
  await assert.rejects(fetchFiveMServer("abc123", { timeoutMs: 10, fetchImpl: async (_url, { signal }) => new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(signal.reason), { once: true })) }), { code: "upstream_timeout" });
});

test("Featured discovery is bounded, deduplicates current IDs, and does not automatically fetch or import candidates", async () => {
  const calls = [];
  const result = await fetchFiveMFeatured({ limit: 3, now, fetchImpl: async (url) => { calls.push(url); return json({ servers: [{ name: "Collection", hash_ids: ["abc123", "6myr996"] }, { name: "Same", hash_id: "abc123" }, { name: "Malicious", hash_id: "https://evil.example.org" }], pinnedServers: ["xyz789", "aaaaaa", "abc123"] }); } });
  assert.deepEqual(result.servers.map((entry) => entry.joinCode), ["abc123", "6myr996", "xyz789"]);
  assert.equal(calls.length, 1); assert.equal(calls[0], "https://gss.cfx-services.net/v1/public/featured-servers/fivem");
  assert.match(result.notice, /freeroam/);
  await assert.rejects(fetchFiveMFeatured({ limit: 21, fetchImpl: () => assert.fail("invalid limits must not fetch") }), { code: "invalid_limit" });
});
