import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = file => readFileSync(new URL(`../public/${file}`, import.meta.url), "utf8");

test("public display typography uses sturdy sans-serif across page types", () => {
  const shared = read("public-design.css");
  const editorial = read("premium-pages.css");
  const detail = read("server-detail.css");
  const finder = read("server-finder.css");
  assert.match(shared, /--font-display:\s*Inter,\s*ui-sans-serif/);
  assert.match(editorial, /--premium-display:\s*var\(--font-display/);
  for (const css of [editorial, detail, finder]) {
    assert.doesNotMatch(css, /ui-serif|Georgia|Cambria|Times New Roman|Iowan Old Style|Palatino Linotype/);
  }
  assert.match(detail, /\.detail-title-v3 h1\s*\{[^}]*font-weight:\s*800/s);
  assert.match(finder, /\.finder-heading h1\s*\{[^}]*font-weight:\s*800/s);
});

test("server facts keep narrow labels intact and action styling has no idle pulse", () => {
  const detail = read("server-detail.css");
  const actions = read("design-system.css");
  assert.match(detail, /\.server-info-card-v5 dt\s*\{[^}]*white-space:\s*nowrap/s);
  assert.match(detail, /\.server-info-card-v5\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)/s);
  assert.match(actions, /--brand-action-gradient:\s*linear-gradient/);
  assert.doesNotMatch(actions, /primary-colour-drift|primary-light-pulse/);
  assert.match(actions, /\.button-primary-v3[^}]*animation:\s*none/s);
});

test("all public templates load the new display styles without the retired motion controller", () => {
  const pages = ["404", "about", "advertise", "appeal", "blog-post", "blog", "coins", "compare", "dashboard", "find-server", "game", "index", "legal", "list-server", "privacy", "profile", "server", "servers", "staff", "terms", "user"];
  for (const page of pages) {
    const html = read(`${page}.html`);
    assert.match(html, /public-design\.css\?v=[a-zA-Z0-9-]+/);
    assert.match(html, /premium-pages\.css\?v=[a-zA-Z0-9-]+/);
    assert.match(html, /design-system\.css\?v=20260915-blocktype-buttons1/);
    assert.doesNotMatch(html, /primary-motion\.js/);
  }
});
