import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";

const page = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const css = readFileSync(new URL("../public/homepage-attention.css", import.meta.url), "utf8");

test("the four homepage artwork quadrants are independent accessible game destinations", t => {
  const dom = new JSDOM(page, { url: "https://www.browserp.com/" });
  t.after(() => dom.window.close());
  const artwork = dom.window.document.querySelector(".home-hero-visual");
  assert.ok(artwork?.matches("nav[aria-label]"));
  assert.notEqual(artwork.getAttribute("aria-hidden"), "true");
  const links = [...artwork.querySelectorAll("a.hero-game-link")];
  assert.equal(links.length, 4);
  assert.deepEqual(links.map(link => link.getAttribute("href")), [
    "/games/fivem", "/games/redm", "/games/roblox", "/games/minecraft"
  ]);
  assert.deepEqual(links.map(link => link.textContent.trim()), [
    "Explore FiveM roleplay", "Explore RedM roleplay", "Explore Roblox roleplay", "Explore Minecraft roleplay"
  ]);
  assert.ok(links.every(link => !link.closest(".home-game-discovery, .game-grid-v3")), "hero links are not intercepted by homepage game filters");
  assert.equal(artwork.querySelectorAll("a a, button, [role='button']").length, 0);
  assert.equal(dom.window.document.querySelector(".home-hero-pattern")?.getAttribute("aria-hidden"), "true", "decorative motion remains inert");
});

test("artwork crops, responsive placement and motion alternatives are explicitly styled", () => {
  for (const quadrant of ["fivem", "redm", "roblox", "minecraft"]) {
    assert.match(css, new RegExp(`\\.hero-game-${quadrant}\\s*\\{\\s*background-position:`));
  }
  assert.match(css, /background-image:\s*url\("\/assets\/games\/all-games-collage\.webp"\)/);
  assert.match(css, /\.hero-game-link:is\(:hover, :focus-visible\)[^}]*transform:\s*scale\(1\.055\)/s);
  assert.match(css, /animation:\s*hero-collage-float\s+8s/);
  assert.match(css, /@media \(max-width: 700px\)[\s\S]*\.home-hero-visual\s*\{[^}]*position:\s*relative;[^}]*margin:\s*38px auto 0;[^}]*opacity:\s*1;/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.home-hero-visual\s*\{\s*animation:\s*none;/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*\.hero-game-link:is\(:hover, :focus-visible, :active\)\s*\{\s*transform:\s*none;/);
});
