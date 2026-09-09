import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";

const source = readFileSync(new URL("../public/browserp-portal-v2.js", import.meta.url), "utf8");
const settle = async () => { for (let i = 0; i < 5; i++) await new Promise(resolve => setImmediate(resolve)); };

async function profilePage(t, profile) {
  const dom = new JSDOM('<body data-page="profile"><main id="portal-root"></main></body>', { url: "https://browserp.test/profile", runScripts: "outside-only" });
  t.after(() => dom.window.close());
  const w = dom.window;
  w.fetch = async path => ({ ok: true, json: async () => path === "/api/auth/session" ? { authenticated: true, csrfToken: "test-csrf", user: { profile } } : path === "/api/me/profile" ? { profile } : path === "/api/me/overview" ? { overview: { profile } } : { content: {} } });
  const events = [];
  w.addEventListener("browserp:profile-updated", event => events.push(event.detail.profile));
  w.eval(source); await settle();
  return { document: w.document, w, events };
}

test("profile heading and upload preview use the stored avatar for both API naming conventions", async t => {
  for (const field of ["avatar_url", "avatarUrl", "approved_avatar_url", "approvedAvatarUrl"]) await t.test(field, async t => {
    const profile = { display_name: "Gaming Member", [field]: "https://cdn.discordapp.com/avatars/test/current.png" };
    const { document, events } = await profilePage(t, profile);
    const images = document.querySelectorAll(".portal-head .portal-avatar img, .profile-picture-preview-v3 img");
    assert.equal(images.length, 2);
    for (const image of images) assert.equal(image.src, profile[field]);
    assert.equal(events.length, 1); assert.equal(events[0][field], profile[field]);
    assert.ok(document.querySelector(".profile-settings-layout-v7 .profile-form-v2"));
  });
});

test("a custom uploaded avatar takes precedence over the provider and approved fallback", async t => {
  const { document } = await profilePage(t, { display_name: "Gaming Member", custom_avatar_url: "https://example.test/my-upload.png", avatar_url: "https://example.test/provider.png", approved_avatar_url: "https://example.test/old.png" });
  assert.equal(document.querySelector(".portal-head .portal-avatar img").src, "https://example.test/my-upload.png");
});

test("broken or unsafe avatars fall back to initials without an empty broken image", async t => {
  const h = await profilePage(t, { display_name: "Gaming Member", avatar_url: "https://example.test/unavailable.png" });
  const headingAvatar = h.document.querySelector(".portal-head .portal-avatar");
  headingAvatar.querySelector("img").dispatchEvent(new h.w.Event("error"));
  assert.equal(headingAvatar.querySelector("img"), null); assert.equal(headingAvatar.textContent, "GM");
  const unsafe = await profilePage(t, { display_name: "Gaming Member", avatar_url: "javascript:alert(1)" });
  assert.equal(unsafe.document.querySelector(".portal-head .portal-avatar img"), null);
  assert.equal(unsafe.document.querySelector(".portal-head .portal-avatar").textContent, "GM");
});

test("private content status shows reasons and sends a versioned appeal while the approved avatar stays public", async t => {
  const profile = { display_name: "Gaming Member", avatar_url: "https://cdn.discordapp.com/avatars/test/approved.png" };
  const item = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", kind: "avatar", status: "blocked", reason: "The image could be mistaken for another member.", appealStatus: "none", createdAt: "2026-09-09T09:00:00Z", version: 6 }; let currentItem = item;
  const writes = []; const profileWrites = [];
  const dom = new JSDOM('<body data-page="profile"><main id="portal-root"></main><div id="site-toast"></div></body>', { url: "https://browserp.test/profile", runScripts: "outside-only" });
  t.after(() => dom.window.close()); const w = dom.window;
  const mountedPatterns = [];
  w.BrowseRPWordmarks = { mount() { mountedPatterns.push(w.document.querySelector(".home-hero-pattern")); } };
  w.fetch = async (path, options = {}) => {
    const payload = path === "/api/auth/session" ? { authenticated: true, csrfToken: "test-csrf", user: { id: "member-1", profile } }
      : path === "/api/me/profile" ? { profile }
        : path === "/api/me/overview" ? { overview: { profile } }
          : String(path).startsWith("/api/me/content-moderation") ? { items: [currentItem], nextBefore: null }
            : {};
    if (path === "/api/me/content-moderation" && options.method === "POST") { writes.push(JSON.parse(options.body)); currentItem = { ...item, appealStatus: "pending", version: 7 }; return { ok: true, json: async () => ({ item: currentItem }) }; }
    if (path === "/api/me/profile" && options.method === "POST") { profileWrites.push(JSON.parse(options.body)); return { ok: true, json: async () => ({ profile, moderation: { status: "pending_review" } }) }; }
    return { ok: true, json: async () => payload };
  };
  w.eval(source); await settle(); await settle();
  const firstPattern = w.document.querySelector(".portal-head[data-wordmark-surface] > .home-hero-pattern");
  assert.ok(firstPattern, "the asynchronous profile intro gets the shared decorative pattern");
  assert.equal(firstPattern.getAttribute("aria-hidden"), "true");
  assert.deepEqual(mountedPatterns, [firstPattern], "mount runs after the profile is attached");
  assert.equal(w.document.querySelectorAll(".home-hero-pattern").length, 1);
  const headingImage = w.document.querySelector(".portal-head .portal-avatar img");
  assert.equal(headingImage.src, profile.avatar_url);
  const privatePreview = w.document.querySelector("#content-status .member-moderation-avatar-v3");
  assert.match(privatePreview.src, /\/api\/content-moderation\/preview\?id=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa$/);
  assert.match(w.document.querySelector("#content-status").textContent, /Blocked.*Review reason: The image could be mistaken/i);
  const form = w.document.querySelector(".member-moderation-appeal-v3"); form.querySelector("textarea").value = "This is my own artwork and does not copy another member.";
  form.dispatchEvent(new w.Event("submit", { bubbles: true, cancelable: true })); await settle();
  assert.deepEqual(writes[0], { id: item.id, action: "appeal", statement: "This is my own artwork and does not copy another member.", expectedVersion: 6 });
  assert.equal(w.document.querySelector(".member-moderation-appeal-v3"), null, "an already-open appeal cannot be submitted again");
  assert.equal(w.document.querySelector(".portal-head .portal-avatar img").src, profile.avatar_url);
  const profileForm = w.document.querySelector(".profile-form-v2"); profileForm.querySelector('textarea[name="bio"]').value = "A revised private bio";
  profileForm.dispatchEvent(new w.Event("submit", { bubbles: true, cancelable: true })); await settle(); await settle();
  assert.equal(profileWrites[0].bio, "A revised private bio");
  assert.match(w.document.querySelector("#site-toast").textContent, /Saved for review.*current approved profile details stay live/i);
  assert.equal(w.document.querySelector(".portal-head .portal-avatar img").src, profile.avatar_url);
  assert.doesNotMatch(source, /result\.avatarUrl/, "avatar submission responses are never promoted into the public profile client-side");
  assert.equal(mountedPatterns.length, 2, "saving profile details remounts the shared lifecycle");
  assert.equal(firstPattern.isConnected, false);
  assert.equal(mountedPatterns[1], w.document.querySelector(".portal-head[data-wordmark-surface] > .home-hero-pattern"));
  assert.equal(w.document.querySelectorAll(".home-hero-pattern").length, 1, "refresh cannot duplicate the decoration");
  w.dispatchEvent(new w.CustomEvent("browserp:session-ended", { detail: { reason: "connection-removed" } }));
  await settle();
  assert.equal(w.document.querySelector(".home-hero-pattern"), null);
  assert.equal(mountedPatterns.length, 3);
  assert.equal(mountedPatterns.at(-1), null, "the access gate calls mount with no pattern so the shared renderer disposes");

});
