import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (file) => readFileSync(join(root, file), "utf8");

test("public navigation has scoped motion and respects reduced motion", () => {
  const css = read("public/navigation.css");
  assert.match(css, /navigation-arrive-v6/);
  assert.match(css, /navigation-dialog-v6::backdrop/);
  assert.match(css, /100dvh/);
  assert.match(css, /overscroll-behavior: contain/);
  assert.match(css, /prefers-reduced-motion/);
});

test("all supported games have dedicated pages, local marks and selected states", () => {
  const page = read("public/game.html");
  const games = read("public/browserp-games.js");
  const marks = read("public/assets/game-marks-v4.svg");
  const directory = read("public/smart-search.js");
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

test("search supports typed choices with keyboard navigation", () => {
  const search = read("public/smart-search.js");
  assert.match(search, /aria-activedescendant/);
  assert.match(search, /addEventListener\("focus", render\)/);
  assert.match(search, /choose\(choice\)/);
});

test("launch discovery contains only real server listings", () => {
  const home = read("public/index.html");
  const directory = read("public/browserp-directory.js");
  const routes = read("vercel.json");
  for (const content of [home, directory, routes]) {
    assert.doesNotMatch(content, /San Andreas County Roleplay/);
    assert.doesNotMatch(content, /san-andreas-county-roleplay-showcase/);
  }
  assert.doesNotMatch(directory, /SHOWCASE_SERVER|Complete demo listing|showcase_url/);
  assert.doesNotMatch(routes, /example-server/);
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
