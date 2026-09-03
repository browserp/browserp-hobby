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
  for (const game of ["FiveM", "RedM", "Roblox", "Minecraft"]) assert.match(home, new RegExp(game));
  assert.match(servers, /id="discovery-controls"/);
  assert.match(listing, /name="platform"/);
  assert.doesNotMatch(directory, /platform:\s*"fivem"/);
  assert.match(shell, /side-ad-stage-v3/);
  assert.match(shell, /ArrowLeft/);
  assert.match(css, /min-height:\s*570px/);
  assert.match(css, /side-ad-image-v3/);
});

test("profile media, retention and duplicate signals stay behind reviewed boundaries", () => {
  const migration = read("supabase/migrations/20260819214000_profile_retention_security.sql");
  const mediaMigration = read("supabase/migrations/20260819220307_profile_media_upload.sql");
  const router = read("api/router.js");
  assert.match(migration, /member_update_profile\(\s*p_display_name text,p_bio text,p_visibility text,p_avatar_url text/);
  assert.match(migration, /avatar_review_status/);
  assert.match(migration, /interval '45 days'/);
  assert.match(migration, /interval '60 days'/);
  assert.match(migration, /not exists\(select 1 from public\.staff_memberships/);
  assert.match(migration, /financial-retention/);
  assert.match(migration, /submission\.duplicate_pattern/);
  assert.doesNotMatch(router, /reviewedAvatarUrl/);
  assert.match(router, /staff_security_flag_control/);
  assert.match(mediaMigration, /member_set_profile_avatar/);
  assert.match(mediaMigration, /file_size_limit.*1048576/s);
  assert.match(mediaMigration, /revoke execute on function public\.member_set_profile_avatar/);
  assert.match(router, /profilePictureBytes/);
  assert.match(router, /"me\/avatar": endpoint/);
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

test("signed-in navigation uses a permission-backed avatar menu and dark-only theme", () => {
  const shell = read("public/browserp-v3.js");
  const portalShell = read("public/browserp-shell.js");
  const css = read("public/browserp-v3.css");
  assert.match(shell, /account-trigger-v3/);
  assert.match(shell, /\["Profile", "\/profile"\]/);
  assert.match(shell, /session\.staffAccess === true/);
  assert.doesNotMatch(shell, /browserp-theme/);
  assert.doesNotMatch(css, /:root\[data-theme="light"\]/);
  assert.match(css, /account-popover-v3/);
  assert.match(portalShell, /\["Blog", "\/blog"\]/);
  assert.match(portalShell, /\["Games", "\/games"\]/);
});

test("public search uses shared contextual choices and clear wording", () => {
  const search = read("public/smart-search.js");
  const model = read("public/discovery-model.js");
  assert.match(search, /facets\[key\]/);
  assert.match(search, /choice.key, choice.value/);
  assert.doesNotMatch(model, /"Framework"|"Tag"/);
  for (const page of ["index", "servers", "game"]) assert.match(read(`public/${page}.html`), /smart-search.js/);
});

test("homepage game cards use local original artwork instead of letter tiles", () => {
  const home = read("public/index.html");
  const css = read("public/browserp-v3.css");
  for (const game of ["fivem", "redm", "roblox", "minecraft"]) {
    assert.match(home, new RegExp(`game-art-${game}-v3`));
    assert.match(css, new RegExp(`/assets/games/${game}-roleplay\\.webp`));
  }
  assert.doesNotMatch(home, /<b>(5M|RM|RB|MC|FZ)<\/b>/);
  assert.doesNotMatch(home, /href="\/games\/forza"/);
  assert.match(home, /src="\/assets\/games\/all-games-logo\.png"/);
});

test("profile picture previews remain compatible with the strict image CSP", () => {
  const portal = read("public/browserp-portal-v2.js");
  assert.match(portal, /new FileReader\(\)/);
  assert.match(portal, /reader\.readAsDataURL\(file\)/);
  assert.doesNotMatch(portal, /URL\.createObjectURL\(file\)/);
  assert.doesNotMatch(portal, /URL\.revokeObjectURL\(url\)/);
});
