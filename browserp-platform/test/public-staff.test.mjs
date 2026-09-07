import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { publicStaffView, safePublicStaffAvatar } from "../lib/public-staff.js";

const root = resolve(import.meta.dirname, "..");
const page = readFileSync(resolve(root, "public/staff.html"), "utf8");
const script = readFileSync(resolve(root, "public/staff-public.js"), "utf8");
const styles = readFileSync(resolve(root, "public/staff-public.css"), "utf8");
const resources = readFileSync(resolve(root, "api/resources.js"), "utf8");
const about = readFileSync(resolve(root, "public/about.html"), "utf8");
const vercel = JSON.parse(readFileSync(resolve(root, "vercel.json"), "utf8"));

const ownerId = "11111111-1111-4111-8111-111111111111";
const adminId = "22222222-2222-4222-8222-222222222222";
const revokedId = "33333333-3333-4333-8333-333333333333";
const memberships = [
  { user_id: adminId, role_key: "administrator", status: "active", granted_at: "2026-09-07T16:33:11.907685Z" },
  { user_id: revokedId, role_key: "moderator", status: "revoked", granted_at: "2026-08-20T10:00:00Z" },
  { user_id: ownerId, role_key: "owner", status: "active", granted_at: "2026-08-19T17:49:30.567198Z" }
];
const roles = [
  { key: "administrator", name: "Administrator", rank: 800 },
  { key: "moderator", name: "Moderator", rank: 600 },
  { key: "owner", name: "Owner", rank: 1000 }
];
const profiles = [
  { id: ownerId, display_name: "BrowseRP Owner", avatar_review_status: "approved", approved_avatar_url: `https://kywabzfgjoqiznnxygbq.supabase.co/storage/v1/object/public/profile-media/${ownerId}/avatar.png` },
  { id: adminId, display_name: "Community Admin", avatar_review_status: "approved", approved_avatar_url: "https://cdn.discordapp.com/avatars/123456789012345678/avatar_hash.png" },
  { id: revokedId, display_name: "Former Staff", avatar_review_status: "approved", approved_avatar_url: "https://cdn.discordapp.com/avatars/123456789012345679/old.png" }
];

test("public staff projection exposes active roster fields only and orders by rank", () => {
  const staff = publicStaffView(memberships, roles, profiles);
  assert.equal(staff.length, 2);
  assert.deepEqual(staff.map((member) => member.roleName), ["Owner", "Administrator"]);
  assert.deepEqual(Object.keys(staff[0]).sort(), ["avatarUrl", "displayName", "joinedAt", "roleName"].sort());
  assert.equal(staff.some((member) => member.displayName === "Former Staff"), false);
  assert.equal(staff[0].joinedAt, "2026-08-19T17:49:30.567Z");
  for (const member of staff) {
    for (const privateKey of ["userId", "roleKey", "rank", "status", "permissions", "discordId", "email", "mfa"]) assert.equal(privateKey in member, false);
  }
});

test("public roster uses only approved, allowlisted avatar locations", () => {
  assert.match(safePublicStaffAvatar("https://cdn.discordapp.com/avatars/123456789012345678/hash.png"), /^https:\/\/cdn\.discordapp\.com\//);
  assert.match(safePublicStaffAvatar("https://lh3.googleusercontent.com/a/example"), /^https:\/\/lh3\.googleusercontent\.com\//);
  assert.match(safePublicStaffAvatar(`https://kywabzfgjoqiznnxygbq.supabase.co/storage/v1/object/public/profile-media/${ownerId}/avatar.png`), /profile-media/);
  for (const url of ["http://cdn.discordapp.com/avatars/123456789012345678/hash.png", "https://evil.example/avatar.png", "https://kywabzfgjoqiznnxygbq.supabase.co/storage/v1/object/public/advertisements/x.png", "https://user:password@cdn.discordapp.com/avatars/123456789012345678/hash.png"]) assert.equal(safePublicStaffAvatar(url), null, url);
  const hidden = publicStaffView(memberships, roles, profiles.map((profile) => profile.id === adminId ? { ...profile, avatar_review_status: "pending_review" } : profile));
  assert.equal(hidden.find((member) => member.roleName === "Administrator").avatarUrl, null);
});

test("missing join timestamps stay explicitly unavailable instead of being invented", () => {
  const staff = publicStaffView([{ ...memberships[0], granted_at: null }], roles, profiles);
  assert.equal(staff[0].joinedAt, null);
});

test("staff page is a clean public page with current roster states and no private controls", () => {
  assert.equal(vercel.cleanUrls, true);
  assert.match(page, /<link rel="canonical" href="https:\/\/www\.browserp\.com\/staff">/);
  assert.match(page, /id="staff-public-grid"/);
  assert.match(page, /id="staff-public-empty"[^>]*hidden/);
  assert.match(page, /id="staff-public-error"[^>]*hidden/);
  assert.match(page, /Joined staff/);
  assert.doesNotMatch(page, /Discord ID|permission overrides|security token/i);
  assert.match(about, /href="\/staff">Meet the staff<\/a>/);
});

test("public roster client renders with DOM APIs, safe avatar fallback and a truthful retry state", () => {
  assert.match(script, /fetch\("\/api\/resources\?view=staff"/);
  assert.match(script, /grid\.replaceChildren/);
  assert.match(script, /image\.addEventListener\("error"/);
  assert.match(script, /Date unavailable/);
  assert.match(script, /Roster temporarily unavailable/);
  assert.doesNotMatch(script, /innerHTML|insertAdjacentHTML|document\.write/);
  assert.match(styles, /\.staff-public-grid/);
  assert.match(styles, /@media \(max-width: 680px\)[\s\S]*grid-template-columns: 1fr/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
});

test("existing resources function multiplexes staff without creating a thirteenth Vercel function", () => {
  assert.match(resources, /publicStaffRoster/);
  assert.match(resources, /view === "staff"/);
  assert.match(resources, /publicJson\(res, \{ staff:/);
  assert.match(resources, /view !== "resources"/);
});
