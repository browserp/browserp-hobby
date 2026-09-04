import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { JSDOM } from "jsdom";
import { discoverServers } from "../lib/discovery.js";
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

test("the retired demo has no public promotion, data, artwork or dedicated route", () => {
  for (const file of ["public/index.html", "public/browserp-directory.js", "public/browserp-games.js", "public/discovery-model.js", "lib/discovery.js", "dev-server.mjs", "vercel.json"]) {
    assert.doesNotMatch(read(file), /san-andreas-county-roleplay-showcase|San Andreas County Roleplay|SHOWCASE_SERVER|FIVEM_SHOWCASE|model\.showcase/, file);
  }
  assert.equal(existsSync(join(root, "public/example-server.html")), false);
  assert.equal(existsSync(join(root, "public/assets/san-andreas-county-rp-mark-v4.svg")), false);
});

test("public discovery preserves real server totals and paging without adding demo results", async () => {
  const before = { SUPABASE_URL: process.env.SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY: process.env.SUPABASE_PUBLISHABLE_KEY };
  const originalFetch = globalThis.fetch;
  process.env.SUPABASE_URL = "https://fixture.supabase.co";
  process.env.SUPABASE_PUBLISHABLE_KEY = "fixture-public-key";
  try {
    for (const result of [{ servers: [], total: 0, facets: {} }, { servers: [{ slug: "real-community", platform_id: "fivem" }], total: 30, facets: { platform: [{ value: "fivem", count: 30 }] } }]) {
      globalThis.fetch = async (url, options) => {
        assert.equal(new URL(url).pathname, "/rest/v1/rpc/search_public_directory");
        assert.equal(JSON.parse(options.body).p_filters.platform, "fivem");
        return new Response(JSON.stringify(result), { status: 200 });
      };
      const response = await discoverServers({ platform: "fivem" });
      assert.deepEqual(response.servers, result.servers);
      assert.equal(response.total, result.total);
      assert.deepEqual(response.facets, result.facets);
      assert.equal(response.nextOffset, result.total ? 24 : null);
    }
  } finally {
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries(before)) value === undefined ? delete process.env[key] : process.env[key] = value;
  }
});

test("homepage featured listings render only the backend response and show the real empty state", async () => {
  for (const servers of [[], [{ slug: "real-community", name: "Real community", platform_id: "fivem", online: true, players: 12 }]]) {
    const dom = new JSDOM('<body data-page="home"><div id="featured-server-list"></div><div id="featured-empty"><h3></h3><p></p></div></body>', { url: "https://browserp.test/", runScripts: "outside-only" });
    const w = dom.window;
    w.BrowseRPSearch = { home() {} };
    w.eval(read("public/browserp-platforms.js"));
    w.fetch = async () => ({ ok: true, json: async () => ({ servers }) });
    try {
      w.eval(read("public/browserp-directory.js"));
      await new Promise(resolve => setTimeout(resolve, 10));
      assert.equal(w.document.querySelectorAll(".server-card").length, servers.length);
      assert.equal(w.document.querySelector("#featured-empty").hidden, servers.length > 0);
      if (servers.length) assert.equal(w.document.querySelector(".server-card").getAttribute("href"), "/server/real-community");
    } finally { dom.window.close(); }
  }
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
