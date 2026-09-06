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
