import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { JSDOM } from "jsdom";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (file) => readFileSync(join(root, file), "utf8");

test("server identity stays in one compact heading while details use the full card width", () => {
  const html = read("public/server.html");
  const dom = new JSDOM(html);
  const document = dom.window.document;
  try {
    const title = document.querySelector(".detail-title-launch-v6");
    const heading = title?.querySelector(".detail-heading-launch-v6");
    assert.ok(title);
    assert.ok(heading);
    assert.ok(heading.contains(document.querySelector("#server-initials-v3")));
    assert.ok(heading.contains(document.querySelector("#server-name-v3")));
    assert.equal(heading.contains(document.querySelector(".detail-meta-v3")), false);
    assert.equal(heading.contains(document.querySelector(".detail-actions-v3")), false);
    assert.match(html, /server-imports\.css\?v=2\.9\.1/);
  } finally { dom.window.close(); }
});

test("mobile server actions are compact and the logo never consumes its own row", () => {
  const css = read("public/server-imports.css");
  assert.match(css, /detail-heading-launch-v6[^}]*grid-template-columns: 72px minmax\(0, 1fr\)/s);
  assert.match(css, /detail-actions-v3[^}]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/s);
  assert.match(css, /#server-join-v3 \{ grid-column: 1 \/ -1; \}/);
  assert.match(css, /detail-banner-v3 \{ min-height: 0;/);
});

test("live FiveM refresh stores validated artwork and returns it immediately", () => {
  const workflow = read("lib/fivem-workflow.js");
  const migration = read("supabase/migrations/20260904010044_refresh_fivem_media_metadata.sql");
  assert.match(workflow, /persistServerImage\(source\.images\.logoUrl, code\)/);
  assert.match(workflow, /service_refresh_fivem_source/);
  assert.match(workflow, /logo_url: live\?\.logoUrl \?\? info\.logoUrl/);
  assert.match(migration, /storage\/v1\/object\/public\/server-media/);
  assert.match(migration, /revoke all on function public\.service_refresh_fivem_source/);
  assert.match(migration, /grant execute .* to service_role/);
});
