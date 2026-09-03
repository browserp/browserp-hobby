import test from "node:test";
import assert from "node:assert/strict";
import { staffAccessMutation, customRoleMutation } from "../api/router.js";

test("staff assignment accepts custom role keys and continues to reject owner assignment", () => {
  const body = { discordUserId: "12345678901234567", action: "assign", roleKey: "custom_community_editor", expectedVersion: 0, reason: "Assign community publishing responsibilities" };
  assert.equal(staffAccessMutation(body).roleKey, "custom_community_editor");
  for (const roleKey of ["owner", "", "space role", "x".repeat(41)]) {
    assert.throws(() => staffAccessMutation({ ...body, roleKey }), /assignable staff rank/);
  }
  assert.throws(() => staffAccessMutation({ ...body, expectedVersion: -1 }), /Reload/);
});

test("custom role input limits permission grants and protects built-in role keys", () => {
  const body = { name: "Community editor", description: "Writes articles for the community", permissions: ["website.overview.read", "blogs.manage", "blogs.manage"], expectedVersion: 0, reason: "Create an editorial role" };
  assert.deepEqual(customRoleMutation(body).permissions, ["website.overview.read", "blogs.manage"]);
  assert.equal(customRoleMutation(body).key, null);
  assert.equal(customRoleMutation({ ...body, key: "custom_community_editor", expectedVersion: 2 }).key, "custom_community_editor");
  for (const key of ["owner", "administrator", "moderator", "custom_"]) {
    assert.throws(() => customRoleMutation({ ...body, key }), /custom role name/);
  }
  for (const permissions of [["staff.manage"], ["staff.permissions.manage"], ["security.network.approve"], [null], ["unknown role"], "blogs.manage"]) {
    assert.throws(() => customRoleMutation({ ...body, permissions }), /assignable permissions/);
  }
  assert.throws(() => customRoleMutation({ ...body, expectedVersion: 1.5 }), /Reload roles/);
  assert.throws(() => customRoleMutation({ ...body, reason: "" }), /reason/);
});
