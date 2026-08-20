import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { assessDisplayName } from "../lib/moderation.js";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("profile avatars publish immediately while bios remain reviewed", async () => {
  const [router, portal, migration] = await Promise.all([
    read("api/router.js"),
    read("public/browserp-portal-v2.js"),
    read("supabase/migrations/20260820023114_profile_avatar_immediate_name_filter.sql")
  ]);

  assert.match(router, /moderation_status:\s*"approved"/);
  assert.match(router, /publication:\s*"immediate"/);
  assert.match(router, /field !== "bio"/);
  assert.match(portal, /published immediately/i);
  assert.match(portal, /Bio changes remain screened/i);
  assert.match(migration, /avatar_review_status='approved'/);
  assert.match(migration, /approved_avatar_url=avatar_url/);
  assert.match(migration, /bio_review_status='pending_review'/);
});

test("display-name safety exists in both application and database boundaries", async () => {
  const [moderation, migration, retirement] = await Promise.all([
    read("lib/moderation.js"),
    read("supabase/migrations/20260820023114_profile_avatar_immediate_name_filter.sql"),
    read("supabase/migrations/20260820023211_retire_legacy_profile_update.sql")
  ]);

  assert.match(moderation, /export function assessDisplayName/);
  assert.match(moderation, /externalContact/);
  assert.equal(assessDisplayName("County Roleplay").allowed, true);
  assert.equal(assessDisplayName("BrowseRP Admin").allowed, false);
  assert.equal(assessDisplayName("discord.gg/example").allowed, false);
  assert.match(migration, /private\.profile_display_name_allowed/);
  assert.match(migration, /if not private\.profile_display_name_allowed\(v_name\)/);
  assert.match(retirement, /revoke execute on function public\.member_update_profile\(text,text,text,text\)/);
  assert.match(retirement, /authenticated/);
});
