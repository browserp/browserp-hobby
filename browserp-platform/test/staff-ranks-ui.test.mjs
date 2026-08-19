import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const portal = readFileSync(resolve(root, "public/browserp-portal-v2.js"), "utf8");
const styles = readFileSync(resolve(root, "public/browserp-portal-v2.css"), "utf8");
const vercel = JSON.parse(readFileSync(resolve(root, "vercel.json"), "utf8"));

test("owner staff controls use the consolidated admin route", () => {
  assert.ok(vercel.rewrites.some((route) => (
    route.source === "/api/admin/staff"
    && route.destination === "/api/router?_route=admin/staff"
  )));
  assert.match(portal, /await api\("\/api\/admin\/staff"\)/);
  assert.match(portal, /await api\("\/api\/admin\/staff", \{ method: "POST"/);
});

test("rank management is owner-gated and cannot grant or edit the owner role", () => {
  assert.match(portal, /function hasOwnerStaffAccess\(overview\)/);
  assert.match(portal, /roleKey === "owner"/);
  assert.match(portal, /\.filter\(\(role\) => role\.key && role\.key !== "owner"\)/);
  assert.match(portal, /const protectedOwner = member\.protected \|\| member\.roleKey === "owner"/);
  assert.match(portal, /if \(ownerStaffAccess\) sections\.push\(staffManagementSection/);
});

test("staff mutations validate IDs, require reasons and carry optimistic versions", () => {
  assert.match(portal, /discordInput\.pattern = "\[0-9\]\{17,20\}"/);
  assert.match(portal, /action: "assign"/);
  assert.match(portal, /expectedVersion: 0/);
  assert.match(portal, /changeRole\.dataset\.staffRankAction = "change_role"/);
  assert.match(portal, /expectedVersion: member\.version/);
  assert.match(portal, /reason\.minLength = 5/);
  assert.match(portal, /window\.confirm\(`Revoke all staff access/);
  assert.match(portal, /error\.status === 409/);
});

test("staff UI stays DOM-rendered, labelled and responsive", () => {
  assert.doesNotMatch(portal, /innerHTML/);
  assert.match(portal, /setAttribute\("aria-label", "Add a staff member"\)/);
  assert.match(portal, /setAttribute\("role", "status"\)/);
  assert.match(styles, /\.staff-member-row/);
  assert.match(styles, /@media \(max-width: 760px\)[\s\S]*\.staff-member-controls \{ grid-template-columns: 1fr; \}/);
});
