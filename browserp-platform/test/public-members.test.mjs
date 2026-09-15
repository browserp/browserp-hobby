import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { createPublicPageHandler, handlesPublicPage } from "../lib/public-pages.js";
import { memberProfileVisible, publicMemberView } from "../lib/public-members.js";

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
});

test("approved profile fields and published safe listings survive projection while pending and adult content do not", () => {
  const profile = { id: alice, username: "gamer_one", display_name: "Gamer One", profile_visibility: "public", approved_bio: "Approved bio", bio_review_status: "pending_review", approved_avatar_url: "https://evil.example/pixel.png", avatar_review_status: "approved", joined_at: "2026-09-01T10:00:00Z", banner_style: "unknown" };
  const view = publicMemberView(profile, { badges: [{ kind: "new_joiner", label: "New Joiner", description: "Joined recently" }], staffRole: null }, [server, { ...server, slug: "adult", age_rating: "adult" }, { ...server, slug: "draft", status: "draft" }]);
  assert.equal(view.bio, ""); assert.equal(view.avatarUrl, null); assert.equal(view.bannerStyle, "aurora");
  assert.deepEqual(view.servers.map(item => item.slug), ["moon-city"]);
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
