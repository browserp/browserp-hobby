import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { normalizeFiveMServer } from "../lib/fivem-import.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (file) => readFileSync(join(root, file), "utf8");

test("FiveM numeric-string icon versions become safe Cfx artwork URLs", () => {
  const now = "2026-09-04T12:00:00.000Z";
  const result = normalizeFiveMServer({
    EndPoint: "abc123",
    Data: {
      hostname: "Example Roleplay",
      clients: 12,
      svMaxclients: 64,
      lastSeen: "2026-09-04T11:59:30Z",
      iconVersion: "42",
      resources: ["qb-core"],
      vars: {
        gamename: "gta5",
        sv_projectName: "Example Roleplay",
        sv_projectDesc: "A friendly roleplay community with businesses and character stories.",
        locale: "en_GB",
        tags: "roleplay, economy",
        sv_appearAllowlisted: "false"
      }
    }
  }, { now });
  assert.equal(result.images.logoUrl, "https://frontend.cfx-services.net/api/servers/icon/abc123/42.png");
});

test("server detail launch layout removes empty artwork height and compacts mobile actions", () => {
  const page = read("public/server.html");
  const css = read("public/server-detail-launch.css");
  assert.match(page, /server-detail-launch\.css\?v=1/);
  assert.match(page, /detail-heading-launch-v6/);
  assert.match(css, /detail-banner-v3:not\(\.has-server-artwork-v3\)/);
  assert.match(css, /grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(css, /@media \(max-width: 460px\)/);
});

test("launch build deletes the demo page, artwork and dedicated route", () => {
  const config = JSON.parse(read("vercel.json"));
  assert.equal(existsSync(join(root, "public/example-server.html")), false);
  assert.equal(existsSync(join(root, "public/assets/san-andreas-county-rp-mark-v4.svg")), false);
  assert.equal(config.rewrites.some(({ source, destination }) => /san-andreas-county-roleplay-showcase|example-server/.test(`${source} ${destination}`)), false);
});

test("live FiveM refresh persists only approved first-party artwork", () => {
  const workflow = read("lib/fivem-workflow.js");
  const migration = read("supabase/migrations/20260904010044_refresh_fivem_media_metadata.sql");
  assert.match(workflow, /persistServerImage\(source\.images\.logoUrl, code\)/);
  assert.match(workflow, /service_refresh_fivem_source/);
  assert.match(workflow, /logo_url: live\?\.logoUrl \?\? info\.logoUrl/);
  assert.match(migration, /storage\/v1\/object\/public\/server-media/);
  assert.match(migration, /revoke all on function public\.service_refresh_fivem_source/);
  assert.match(migration, /grant execute .* to service_role/);
});
