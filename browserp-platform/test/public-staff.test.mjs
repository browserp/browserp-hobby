import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { JSDOM } from "jsdom";
import { publicStaffView, safePublicStaffAvatar } from "../lib/public-staff.js";

const root = resolve(import.meta.dirname, "..");
const page = readFileSync(resolve(root, "public/staff.html"), "utf8");
const script = readFileSync(resolve(root, "public/staff-public.js"), "utf8");
const styles = readFileSync(resolve(root, "public/staff-public.css"), "utf8");
const resources = readFileSync(resolve(root, "api/resources.js"), "utf8");
const router = readFileSync(resolve(root, "api/router.js"), "utf8");
const publicStaff = readFileSync(resolve(root, "lib/public-staff.js"), "utf8");
const staffPanel = readFileSync(resolve(root, "public/staffpanel-v3.js"), "utf8");
const about = readFileSync(resolve(root, "public/about.html"), "utf8");
const vercel = JSON.parse(readFileSync(resolve(root, "vercel.json"), "utf8"));

const ownerId = "11111111-1111-4111-8111-111111111111";
const adminId = "22222222-2222-4222-8222-222222222222";
const revokedId = "33333333-3333-4333-8333-333333333333";
const memberships = [
  { user_id: adminId, role_key: "custom_direct_manager", status: "active", granted_at: "2026-09-07T16:33:11.907685Z" },
  { user_id: revokedId, role_key: "moderator", status: "revoked", granted_at: "2026-08-20T10:00:00Z" },
  { user_id: ownerId, role_key: "owner", status: "active", granted_at: "2026-08-19T17:49:30.567198Z" }
];
const roles = [
  { key: "custom_direct_manager", name: "Direct Manager", rank: 799 },
  { key: "moderator", name: "Moderator", rank: 600 },
  { key: "owner", name: "Owner", rank: 1000 }
];
const presence = [
  { userId: adminId, online: true },
  { userId: ownerId, online: false },
  { userId: revokedId, online: true }
];
const profiles = [
  { id: ownerId, display_name: "BrowseRP Owner", avatar_review_status: "approved", approved_avatar_url: `https://kywabzfgjoqiznnxygbq.supabase.co/storage/v1/object/public/profile-media/${ownerId}/avatar.png` },
  { id: adminId, display_name: "Community Admin", avatar_review_status: "approved", approved_avatar_url: "https://cdn.discordapp.com/avatars/123456789012345678/avatar_hash.png" },
  { id: revokedId, display_name: "Former Staff", avatar_review_status: "approved", approved_avatar_url: "https://cdn.discordapp.com/avatars/123456789012345679/old.png" }
];

test("public staff projection exposes every active member with a boolean presence and orders by rank", () => {
  const staff = publicStaffView(memberships, roles, profiles, presence);
  assert.equal(staff.length, 2);
  assert.deepEqual(staff.map((member) => member.roleName), ["Owner", "Direct Manager"]);
  assert.deepEqual(staff.map((member) => member.online), [false, true]);
  assert.deepEqual(Object.keys(staff[0]).sort(), ["avatarUrl", "displayName", "joinedAt", "online", "roleName"].sort());
  assert.equal(staff.some((member) => member.displayName === "Former Staff"), false);
  assert.equal(staff[0].joinedAt, "2026-08-19T17:49:30.567Z");
  for (const member of staff) {
    for (const privateKey of ["userId", "roleKey", "rank", "status", "permissions", "discordId", "email", "mfa", "lastSeenAt"]) assert.equal(privateKey in member, false);
  }
});

test("public roster uses only approved, allowlisted avatar locations", () => {
  assert.match(safePublicStaffAvatar("https://cdn.discordapp.com/avatars/123456789012345678/hash.png"), /^https:\/\/cdn\.discordapp\.com\//);
  assert.match(safePublicStaffAvatar("https://lh3.googleusercontent.com/a/example"), /^https:\/\/lh3\.googleusercontent\.com\//);
  assert.match(safePublicStaffAvatar(`https://kywabzfgjoqiznnxygbq.supabase.co/storage/v1/object/public/profile-media/${ownerId}/avatar.png`), /profile-media/);
  for (const url of ["http://cdn.discordapp.com/avatars/123456789012345678/hash.png", "https://evil.example/avatar.png", "https://kywabzfgjoqiznnxygbq.supabase.co/storage/v1/object/public/advertisements/x.png", "https://user:password@cdn.discordapp.com/avatars/123456789012345678/hash.png"]) assert.equal(safePublicStaffAvatar(url), null, url);
  const hidden = publicStaffView(memberships, roles, profiles.map((profile) => profile.id === adminId ? { ...profile, avatar_review_status: "pending_review" } : profile));
  assert.equal(hidden.find((member) => member.roleName === "Direct Manager").avatarUrl, null);
});

test("missing join timestamps stay explicitly unavailable instead of being invented", () => {
  const staff = publicStaffView([{ ...memberships[0], granted_at: null }], roles, profiles);
  assert.equal(staff[0].joinedAt, null);
});

test("staff page is a clean public page with current roster states and no private controls", () => {
  assert.equal(vercel.cleanUrls, true);
  assert.match(page, /<link rel="canonical" href="https:\/\/www\.browserp\.com\/staff">/);
  assert.match(page, /<title>Browse RP Staff — Meet the team \| BrowseRP<\/title>/);
  assert.match(page, /<h1>Browse RP Staff<\/h1>/);
  assert.match(page, /All current staff shown/);
  assert.match(page, /id="staff-public-grid"/);
  assert.match(page, /id="staff-public-empty"[^>]*hidden/);
  assert.match(page, /id="staff-public-error"[^>]*hidden/);
  const staticPage = new JSDOM(page);
  try {
    assert.equal(staticPage.window.document.querySelectorAll("[data-permission], [data-security-token], [data-discord-id], form, input, select, textarea").length, 0);
  } finally {
    staticPage.window.close();
  }
  assert.match(about, /href="\/staff">Meet the staff<\/a>/);
});

test("public roster client renders its dynamic join label with DOM APIs, safe avatar fallback and a truthful retry state", async t => {
  assert.match(script, /fetch\("\/api\/public\/staff"/);
  assert.match(script, /grid\.replaceChildren/);
  assert.match(script, /image\.addEventListener\("error"/);
  assert.match(script, /Date unavailable/);
  assert.match(script, /Roster temporarily unavailable/);
  assert.doesNotMatch(script, /innerHTML|insertAdjacentHTML|document\.write/);
  assert.match(styles, /\.staff-public-grid/);
  assert.match(styles, /@media \(max-width: 680px\)[\s\S]*grid-template-columns: 1fr/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(styles, /staff-public-presence-ping/);

  const dom = new JSDOM(page, { url: "https://browserp.test/staff", runScripts: "outside-only" });
  t.after(() => dom.window.close());
  dom.window.fetch = async () => ({
    ok: true,
    json: async () => ({ staff: [
      {
        displayName: "BrowseRP Owner",
        roleName: "Owner",
        joinedAt: "2026-08-19T17:49:30.567Z",
        avatarUrl: null,
        online: true
      },
      {
        displayName: "Community Admin",
        roleName: "Direct Manager",
        joinedAt: "2026-09-07T16:33:11.907685Z",
        avatarUrl: null,
        online: false
      }
    ] })
  });
  dom.window.eval(script);
  for (let i = 0; i < 3; i++) await new Promise(resolve => setImmediate(resolve));
  const joined = dom.window.document.querySelector(".staff-public-joined");
  assert.ok(joined);
  assert.equal(joined.querySelector("strong")?.textContent, "Joined staff");
  assert.equal(joined.querySelector("time")?.textContent, "19 August 2026");
  assert.equal(dom.window.document.querySelectorAll(".staff-public-card").length, 2, "offline staff remain listed");
  assert.equal(dom.window.document.querySelector(".staff-public-presence.is-online")?.textContent, "Online");
  assert.equal(dom.window.document.querySelector(".staff-public-presence.is-offline")?.textContent, "Offline");
  assert.equal(dom.window.document.querySelector("#staff-public-count")?.textContent, "2 staff members");
});

test("existing API functions expose the safe roster without creating a thirteenth Vercel function", () => {
  assert.match(resources, /publicStaffRoster/);
  assert.match(resources, /view === "staff"/);
  assert.match(resources, /publicJson\(res, \{ staff:/);
  assert.match(resources, /view !== "resources"/);
  assert.match(publicStaff, /service_public_staff_presence/);
  assert.match(router, /publicStaffRoster/);
  assert.match(router, /"public\/staff": endpoint\("GET"/);
  assert.match(router, /publicJson\(res, \{ staff: await publicStaffRoster\(\) \}, 15\)/);
  assert.match(router, /"admin\/presence": endpoint\("POST"/);
  assert.match(router, /rpc\("staff_presence_touch"/);
  assert.match(staffPanel, /api\("\/api\/admin\/presence"/);
  assert.match(staffPanel, /30_000/);
  assert.ok(vercel.rewrites.some((rewrite) => rewrite.source === "/api/admin/presence" && rewrite.destination.includes("admin/presence")));
  assert.ok(vercel.rewrites.some((rewrite) => rewrite.source === "/api/public/staff" && rewrite.destination.includes("public/staff")));
});
