import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const css = readFileSync(new URL("../public/premium-pages.css", import.meta.url), "utf8");

test("premium page layer remains public and page-scoped", () => {
  assert.match(css, /body\[data-page="games"\]/);
  assert.match(css, /body\[data-blog-page="index"\]/);
  assert.match(css, /body\[data-page="about"\]/);
  assert.match(css, /body\[data-page="staff-public"\]/);
  assert.match(css, /body\[data-page="member"\]/);
  assert.doesNotMatch(css, /staffpanel|\.staff-v3\s+main|\.server-card|\.server-shortlist-card/);
});

test("game and journal labels have explicit narrow-width wrapping", () => {
  assert.match(css, /\.game-official-card-v6\.game-hub-card-v4 > b\s*\{[^}]*white-space: normal;[^}]*overflow-wrap: anywhere;/);
  assert.match(css, /@media \(max-width: 480px\)[\s\S]*?\.game-official-card-v6\.game-hub-card-v4 > b\s*\{[^}]*grid-column: 1 \/ -1;/);
  assert.match(css, /\.journal-hero-v6 h1 br\s*\{[^}]*display: inline-block;[^}]*width: \.3em;/);
  assert.match(css, /\.journal-heading-v6\s*\{[^}]*flex-wrap: wrap;/);
  assert.match(css, /\.journal-heading-v6 > span\s*\{[^}]*overflow-wrap: anywhere;/);
});

test("game cards keep their full-bleed artwork while restoring the content rail", () => {
  assert.match(css, /body\[data-page="games"\] main :is\(\.game-hub-grid-v4, \.game-future-grid-v6\) \.game-official-card-v6 \.game-hub-mark-v4\s*\{[^}]*border-radius: 19px 19px 0 0;/);
  assert.match(css, /body\[data-page="games"\] main :is\(\.game-hub-grid-v4, \.game-future-grid-v6\) \.game-official-card-v6\.game-hub-card-v4 \.game-hub-copy-v4\s*\{[^}]*padding-left: clamp\(16px, 1\.4vw, 22px\);/);
  assert.match(css, /body\[data-page="games"\] main :is\(\.game-hub-grid-v4, \.game-future-grid-v6\) \.game-official-card-v6\.game-hub-card-v4 > b\s*\{[^}]*margin-right: clamp\(16px, 1\.4vw, 22px\);/);
  assert.match(css, /@media \(max-width: 480px\)[\s\S]*?\.game-hub-copy-v4\s*\{[^}]*padding-left: 16px;/);
  assert.match(css, /@media \(max-width: 480px\)[\s\S]*?\.game-official-card-v6\.game-hub-card-v4 > b\s*\{[^}]*grid-row: 3;[^}]*margin: 0 16px;/);
});

test("public team names and narrow member badge help remain visible", () => {
  assert.match(css, /\.staff-public-card h3\s*\{[^}]*white-space: normal;[^}]*overflow-wrap: anywhere;/);
  assert.match(css, /@media \(max-width: 680px\)[\s\S]*?\.member-badge-v7::after\s*\{[^}]*position: fixed;[^}]*inset: auto 16px 16px;[^}]*max-width: none;/);
});

test("policy and enquiry copy stays legible at zoom or phone widths", () => {
  assert.match(css, /\.legal-v3 :is\(p, li, a, code\),[\s\S]*?overflow-wrap: anywhere;/);
  assert.match(css, /\.policy-nav-v3\s*\{[^}]*overflow-x: auto;/);
  assert.match(css, /\.policy-nav-v3 a\s*\{[^}]*min-height: 44px;/);
});

test("light journal failures use a readable brand text color", () => {
  assert.match(css, /:root\[data-theme="light"\] body\[data-blog-page\] \.journal-status-v6\[data-error="true"\]\s*\{[^}]*color: var\(--pink-strong\);/);
});

test("visual treatment respects reduced motion and forced colors", () => {
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /@media \(forced-colors: active\)/);
  assert.doesNotMatch(css, /@keyframes|animation:\s*(?!none)/);
});
