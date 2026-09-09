import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { assessDisplayName } from "../lib/moderation.js";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("profile UI submits identity changes for review and preserves the approved public identity", async () => {
  const portal = await read("public/browserp-portal-v2.js");

  assert.match(portal, /checked before they appear publicly/i);
  assert.match(portal, /current approved picture stays live during review/i);
  assert.match(portal, /if\(result\.profile\)publishProfile\(result\.profile\)/);
  assert.doesNotMatch(portal, /result\.avatarUrl/);
  assert.doesNotMatch(portal, /published immediately/i);
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
