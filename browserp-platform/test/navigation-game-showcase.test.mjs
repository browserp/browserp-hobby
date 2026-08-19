import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (file) => readFileSync(join(root, file), "utf8");

test("navigation can collapse without leaving hidden controls interactive", () => {
  const shell = read("public/browserp-v3.js");
  const portalShell = read("public/browserp-shell.js");
  const css = read("public/browserp-v3.css");
  assert.match(shell, /nav\.dataset\.expanded = String\(active\)/);
  assert.match(shell, /links\.inert = !active/);
  assert.match(shell, /actions\.inert = !active/);
  assert.match(shell, /Hide navigation/);
  assert.match(portalShell, /menu\.inert = !active/);
  assert.match(portalShell, /Hide navigation/);
  assert.match(css, /\.nav-v3\[data-expanded="false"\]/);
  assert.match(css, /browserp-brand-pulse-v4/);
  assert.match(css, /prefers-reduced-motion/);
});

test("all supported games have dedicated pages, local marks and selected states", () => {
  const page = read("public/game.html");
  const games = read("public/browserp-games.js");
  const marks = read("public/assets/game-marks-v4.svg");
  const directory = read("public/browserp-directory.js");
  const routes = read("vercel.json");
  for (const id of ["fivem", "redm", "roblox", "minecraft", "forza", "gmod", "arma", "vrchat", "dayz", "project-zomboid", "ets2", "assetto-corsa", "beamng"]) {
    assert.match(games, new RegExp(`id: "${id}"`));
    assert.match(marks, new RegExp(`id="mark-${id}"`));
  }
  assert.match(page, /id="game-page-nav-v4"/);
  assert.match(routes, /"source": "\/games\/:slug"/);
  assert.match(games, /aria-current", "page"/);
  assert.match(directory, /classList\.toggle\("is-selected", selected\)/);
});

test("search opens useful initial suggestions and selections fill the field", () => {
  const directory = read("public/browserp-directory.js");
  assert.match(directory, /INITIAL_SEARCH_SUGGESTIONS/);
  assert.match(directory, /: INITIAL_SEARCH_SUGGESTIONS/);
  assert.match(directory, /searchInput\.value = item/);
  assert.match(directory, /addEventListener\("focus", \(\) => renderSearchSuggestions/);
});

test("the county showcase is honest, fully routed and uses an original local logo", () => {
  const home = read("public/index.html");
  const example = read("public/example-server.html");
  const directory = read("public/browserp-directory.js");
  const logo = read("public/assets/san-andreas-county-rp-mark-v4.svg");
  const routes = read("vercel.json");
  for (const content of [home, example, directory]) assert.match(content, /San Andreas County Roleplay/);
  assert.match(example, /not affiliated with SACRP/i);
  assert.match(example, /showcase does not represent a live community/i);
  assert.match(directory, /showcase_url: "\/server\/san-andreas-county-roleplay-showcase"/);
  assert.match(routes, /"source": "\/server\/san-andreas-county-roleplay-showcase"/);
  assert.match(logo, /<svg/);
  assert.match(logo, /COUNTY RP/);
});

test("Discord and Google sign-in buttons retain real OAuth routes and branded icons", () => {
  const listing = read("public/list-server.html");
  const portal = read("public/browserp-portal-v2.js");
  const staff = read("public/staffpanel-v3.js");
  const icons = read("public/assets/provider-icons-v4.svg");
  assert.match(listing, /\/api\/auth\/discord\?returnTo=%2Flist-server/);
  assert.match(listing, /\/api\/auth\/google\?returnTo=%2Flist-server/);
  assert.match(listing, /provider-icons-v4\.svg#provider-discord/);
  assert.match(listing, /provider-icons-v4\.svg#provider-google/);
  assert.match(portal, /providerButton\(`/);
  assert.match(staff, /provider-icons-v4\.svg#provider-discord/);
  assert.match(icons, /id="provider-discord"/);
  assert.match(icons, /id="provider-google"/);
});
