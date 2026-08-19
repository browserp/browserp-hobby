import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (file) => readFileSync(join(root, file), "utf8");

test("the public directory is cross-game and the side advert is a visual carousel", () => {
  const home = read("public/index.html");
  const servers = read("public/servers.html");
  const listing = read("public/list-server.html");
  const directory = read("public/browserp-directory.js");
  const shell = read("public/browserp-v3.js");
  const css = read("public/browserp-v3.css");
  for (const game of ["FiveM", "RedM", "Roblox", "Minecraft", "Forza"]) assert.match(home, new RegExp(game));
  assert.match(servers, /id="platform-filter"/);
  assert.match(listing, /name="platform"/);
  assert.doesNotMatch(directory, /platform:\s*"fivem"/);
  assert.match(shell, /side-ad-stage-v3/);
  assert.match(shell, /ArrowLeft/);
  assert.match(css, /min-height:\s*570px/);
  assert.match(css, /side-ad-image-v3/);
});

test("profile media, retention and duplicate signals stay behind reviewed boundaries", () => {
  const migration = read("supabase/migrations/20260819214000_profile_retention_security.sql");
  const router = read("api/router.js");
  assert.match(migration, /member_update_profile\(\s*p_display_name text,p_bio text,p_visibility text,p_avatar_url text/);
  assert.match(migration, /avatar_review_status/);
  assert.match(migration, /interval '45 days'/);
  assert.match(migration, /interval '60 days'/);
  assert.match(migration, /not exists\(select 1 from public\.staff_memberships/);
  assert.match(migration, /financial-retention/);
  assert.match(migration, /submission\.duplicate_pattern/);
  assert.match(router, /reviewedAvatarUrl/);
  assert.match(router, /staff_security_flag_control/);
});

test("authenticator QR markup is normalised and setup secrets are not displayed by default", () => {
  const router = read("api/router.js");
  const staff = read("public/staffpanel-v3.js");
  assert.match(router, /qrCodeDataUri/);
  assert.match(router, /data:image\/svg\+xml;base64/);
  assert.match(staff, /Can’t scan\? Show setup key/);
  assert.match(staff, /key\.hidden = true/);
  assert.doesNotMatch(staff, /append\(make\("span",factor\.secret/);
});

test("signed-in navigation uses an avatar menu and supports light and dark themes", () => {
  const shell = read("public/browserp-v3.js");
  const css = read("public/browserp-v3.css");
  assert.match(shell, /account-trigger-v3/);
  assert.match(shell, /Profile & settings/);
  assert.match(shell, /browserp-theme/);
  assert.match(css, /:root\[data-theme="light"\]/);
  assert.match(css, /account-popover-v3/);
});
