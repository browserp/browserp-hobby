import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { readFileSync } from "node:fs";
import { createPublicPageHandler, handlesPublicPage } from "../lib/public-pages.js";
import { basicMemberAvatar, memberProfileVisible, publicMemberByUsername, publicMemberContents, publicMemberView } from "../lib/public-members.js";

const alice = "01234567-1234-4234-8234-0123456789ab";
const bob = "11234567-1234-4234-8234-0123456789ab";
const server = { name: "Moon City", slug: "moon-city", platform_id: "fivem", region: "United Kingdom", language: "English", framework: "Custom", access_type: "public", description: "Character-led city roleplay.", status: "published", age_rating: "everyone", tags: [] };
const member = { username: "gamer_one", displayName: "Gamer & One", bio: "A helpful roleplayer <script>private</script>", avatarUrl: null, joinedAt: "2026-09-01T10:00:00Z", bannerStyle: "afterglow", visibility: "public", staffRole: "Admin", badges: [{ kind: "new_joiner", label: "New Joiner", description: "Displayed for the first five days after joining." }], servers: [server] };
async function request(path, data) {
  const res = { statusCode: 0, headers: {}, body: "", setHeader(key, value) { this.headers[key.toLowerCase()] = value; }, end(body) { this.body = body || ""; } };
  await createPublicPageHandler({ data })({ url: path, method: "GET", headers: {} }, res);
  return { ...res, document: new JSDOM(res.body).window.document };
}

test("public member pages show only approved presentation, real badge explanations and posted listings", async () => {
  const data = { member: async username => username === member.username ? member : null };
  const page = await request("/user/gamer_one", data);
  assert.equal(page.statusCode, 200);
  assert.equal(page.document.querySelector("h1").textContent, member.displayName);
  assert.equal(page.document.querySelector("#member-banner-v7").dataset.banner, "afterglow");
  assert.equal(page.document.querySelector('a[href="/server/moon-city"]').textContent.includes("Moon City"), true);
  assert.equal(page.document.querySelectorAll(".member-badge-v7").length, 2);
  assert.match(page.document.querySelector('.member-badge-v7[data-kind="staff_role"]').getAttribute("aria-label"), /Admin: Active BrowseRP staff role/);
  assert.match(page.document.querySelector('.member-badge-v7[data-kind="new_joiner"]').getAttribute("data-description"), /five days/);
  assert.equal(page.document.querySelector("script[src*=member-public]") !== null, true);
  assert.equal(page.document.querySelector('script:not([src]):not([type="application/ld+json"])'), null, "member content must not become executable markup");
  assert.match(page.document.querySelector("#member-bio-v7").textContent, /<script>private<\/script>/);
  assert.equal(page.document.querySelector("#member-report-form-v7").dataset.username, "gamer_one");
  assert.equal(page.document.querySelector("#member-message-v7").getAttribute("href"), "/dashboard?message=gamer_one#inbox");
  assert.equal(page.document.querySelector("#member-message-v7").hidden, true, "contact action waits for session status");
  assert.match(page.headers["cache-control"], /no-store/);
  assert.match(page.document.querySelector('link[rel="canonical"]').href, /\/user\/gamer_one$/);
});

test("invisible and malformed member paths return the existing safe missing page", async () => {
  const data = { member: async () => null };
  for (const path of ["/user/gamer_one", "/user/Bad!User", "/user/x"]) {
    const page = await request(path, data);
    assert.equal(page.statusCode, 404, path);
    assert.doesNotMatch(page.body, /private bio|gamer_one's account details/);
  }
  assert.equal(handlesPublicPage("/user/gamer_one"), true);
  assert.equal(memberProfileVisible("public", null, alice), true);
  assert.equal(memberProfileVisible("members", null, alice), false);
  assert.equal(memberProfileVisible("members", bob, alice), true);
  assert.equal(memberProfileVisible("private", bob, alice), false);
  assert.equal(memberProfileVisible("private", alice, alice), true);
  assert.equal(memberProfileVisible("basic", null, alice), true);
});

test("opt-in basic profile exposes only handle and approved picture, never private details", async () => {
  const row = { id: alice, username: "gamer_one", profile_visibility: "basic", display_name: "Secret Display", approved_bio: "Secret bio", bio_review_status: "approved", approved_avatar_url: `https://www.browserp.com/api/public/profile-avatar?id=${bob}`, avatar_review_status: "approved", joined_at: "2026-09-01T10:00:00Z", banner_style: "afterglow" };
  const view = publicMemberView(row, { staffRole: "Admin", badges: [{ label: "Private badge" }] }, [server]);
  assert.deepEqual(view, { username: "gamer_one", avatarUrl: "/api/public/basic-profile-avatar?username=gamer_one", visibility: "basic" });
  const page = await request("/user/gamer_one", { member: async () => view });
  assert.equal(page.statusCode, 200);
  assert.equal(page.document.querySelector("h1").textContent, "@gamer_one");
  assert.equal(page.document.querySelector(".member-basic-v7 img").getAttribute("src"), view.avatarUrl);
  assert.equal(page.document.querySelector("#member-message-v7").getAttribute("href"), "/dashboard?message=gamer_one#inbox");
  assert.equal(page.document.querySelector("#member-bio-v7, #member-banner-v7, #member-joined-v7, #member-badges-v7, #member-server-grid-v7, #member-report-form-v7"), null);
  for (const secret of [alice, bob, "Secret Display", "Secret bio", "Admin", "Private badge", "Moon City", "afterglow"]) assert.equal(page.body.includes(secret), false, secret);
  assert.match(page.headers["cache-control"], /no-store/);
  assert.equal(page.document.querySelector('meta[name="robots"]').content, "noindex,follow");
  assert.equal(page.document.querySelector('link[rel="canonical"]'), null);
});

test("basic profile lookup stays public and does not query full details or old private accounts", async () => {
  const makeRow = visibility => ({ id: alice, username: "gamer_one", profile_visibility: visibility, avatar_review_status: "pending_review", approved_avatar_url: `https://www.browserp.com/api/public/profile-avatar?id=${bob}` });
  const paths = [];
  const basic = await publicMemberByUsername("gamer_one", {}, {}, { restClient: async path => { paths.push(path); return [makeRow("basic")]; } });
  assert.deepEqual(basic, { username: "gamer_one", avatarUrl: null, visibility: "basic" });
  assert.equal(paths.length, 1, "basic pages must not read submissions, badges or server listings");
  const direct = await publicMemberContents(makeRow("basic"), { restClient: async () => { throw new Error("full details queried"); }, rpcClient: async () => { throw new Error("badges queried"); } });
  assert.deepEqual(direct, basic);
  assert.equal(memberProfileVisible("private", null, alice), false);
  assert.equal(memberProfileVisible("members", null, alice), false);
});

test("basic approved picture proxy hides the submission UUID and rechecks approval", async () => {
  const approved = `https://www.browserp.com/api/public/profile-avatar?id=${bob}`;
  const bytes = Buffer.from("synthetic approved picture");
  const calls = [];
  const image = await basicMemberAvatar("gamer_one", {
    restClient: async path => { calls.push(path); return [{ username: "gamer_one", profile_visibility: "basic", avatar_review_status: "approved", approved_avatar_url: approved }]; },
    rpcClient: async (name, args) => { calls.push([name, args]); return { assetId: alice, version: 2 }; },
    assetReader: async (submission, asset) => { calls.push([submission, asset]); return { bytes, mimeType: "image/png" }; }
  });
  assert.equal(image.bytes, bytes);
  assert.equal(image.mimeType, "image/png");
  assert.equal(calls.length, 5);
  await assert.rejects(basicMemberAvatar("gamer_one", { restClient: async () => [{ username: "gamer_one", profile_visibility: "private", avatar_review_status: "approved", approved_avatar_url: approved }] }), { status: 404 });
  await assert.rejects(basicMemberAvatar("gamer_one", { restClient: async () => [{ username: "gamer_one", profile_visibility: "members", avatar_review_status: "approved", approved_avatar_url: approved }] }), { status: 404 });
  let version = 0;
  await assert.rejects(basicMemberAvatar("gamer_one", {
    restClient: async () => [{ username: "gamer_one", profile_visibility: "basic", avatar_review_status: "approved", approved_avatar_url: approved }],
    rpcClient: async () => ({ assetId: alice, version: ++version }),
    assetReader: async () => ({ bytes, mimeType: "image/png" })
  }), { status: 404 });
  let profileRead = 0;
  await assert.rejects(basicMemberAvatar("gamer_one", {
    restClient: async () => [{ username: "gamer_one", profile_visibility: ++profileRead === 1 ? "basic" : "private", avatar_review_status: "approved", approved_avatar_url: approved }],
    rpcClient: async () => ({ assetId: alice, version: 1 }),
    assetReader: async () => ({ bytes, mimeType: "image/png" })
  }), { status: 404 });
});

test("basic visibility is additive in the editor, API and migration", () => {
  const portal = readFileSync(new URL("../public/browserp-portal-v2.js", import.meta.url), "utf8");
  const router = readFileSync(new URL("../api/router.js", import.meta.url), "utf8");
  const migration = readFileSync(new URL("../supabase/migrations/20260917023624_basic_public_profile_visibility.sql", import.meta.url), "utf8");
  assert.match(portal, /\["basic", "Basic profile — username and approved picture only"\]/);
  assert.match(router, /\["public", "members", "private", "basic"\]\.includes\(visibility\)/);
  assert.match(migration, /default 'public'|existing public default/);
  assert.match(migration, /'public','members','private','basic'/);
});

test("approved profile fields and published safe listings survive projection while pending and adult content do not", () => {
  const profile = { id: alice, username: "gamer_one", display_name: "Gamer One", profile_visibility: "public", approved_bio: "Approved bio", bio_review_status: "pending_review", approved_avatar_url: "https://evil.example/pixel.png", avatar_review_status: "approved", joined_at: "2026-09-01T10:00:00Z", banner_style: "unknown" };
  const view = publicMemberView(profile, { badges: [{ kind: "new_joiner", label: "New Joiner", description: "Joined recently" }], staffRole: null }, [server, { ...server, slug: "adult", age_rating: "adult" }, { ...server, slug: "draft", status: "draft" }]);
  assert.equal(view.bio, ""); assert.equal(view.avatarUrl, null); assert.equal(view.bannerStyle, "aurora");
  assert.deepEqual(view.servers.map(item => item.slug), ["moon-city"]);
});

test("an account with an archived submission still loads its profile without querying nonexistent server fields", async () => {
  const profile = { id: alice, username: "gamer_one", display_name: "Gamer One", profile_visibility: "public", joined_at: "2026-09-01T10:00:00Z" };
  const databaseColumns = new Set(["slug", "name", "description", "region", "language", "framework", "access_type", "platform_id", "status", "age_rating", "verified"]);
  let queriedServers = false;
  const restClient = async path => {
    if (path.startsWith("server_submissions?")) return [{ id: bob }];
    if (!path.startsWith("servers?")) throw new Error(`Unexpected query: ${path}`);
    queriedServers = true;
    const params = new URL(path, "https://database.example").searchParams;
    for (const field of params.get("select").split(",")) {
      if (!databaseColumns.has(field)) throw new Error(`Missing database column: ${field}`);
    }
    assert.equal(params.get("source_submission_id"), `in.(${bob})`);
    assert.equal(params.get("status"), "eq.published");
    assert.equal(params.get("age_rating"), "neq.adult");
    return [];
  };
  const view = await publicMemberContents(profile, { restClient, rpcClient: async () => ({ badges: [], staffRole: "" }) });
  assert.equal(queriedServers, true);
  assert.equal(view.username, "gamer_one");
  assert.deepEqual(view.servers, []);
});

test("a submitted listing links to its public member while imported listings keep no invented creator", async () => {
  const data = { server: async slug => slug === "moon-city" ? { server, creator: { username: "gamer_one", displayName: "Gamer One", avatarUrl: null } } : null };
  const posted = await request("/server/moon-city", data);
  assert.equal(posted.statusCode, 200);
  assert.equal(posted.document.querySelector("#server-listed-by-v7").hidden, false);
  assert.equal(posted.document.querySelector('#server-listed-by-v7 a[href="/user/gamer_one"]').textContent, "GGamer One");
  const imported = await request("/server/moon-city", { server: async () => ({ server }) });
  assert.equal(imported.document.querySelector("#server-listed-by-v7").hidden, true);
});
