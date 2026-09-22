import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { JSDOM } from "jsdom";

const page = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const css = readFileSync(new URL("../public/homepage-journeys.css", import.meta.url), "utf8");

test("homepage makes its visual game quadrants explicit, labelled links", t => {
  const dom = new JSDOM(page, { url: "https://www.browserp.com/" });
  t.after(() => dom.window.close());
  const links = [...dom.window.document.querySelectorAll(".home-hero-visual a.hero-game-link")];
  assert.equal(links.length, 4);
  assert.deepEqual(links.map(link => link.getAttribute("aria-label")), [
    "Explore FiveM roleplay", "Explore RedM roleplay", "Explore Roblox roleplay", "Explore Minecraft roleplay"
  ]);
  assert.deepEqual(links.map(link => link.querySelector(".hero-game-label")?.textContent), ["FiveM", "RedM", "Roblox", "Minecraft"]);
  assert.ok(links.every(link => link.querySelector(".hero-game-label")?.getAttribute("aria-hidden") === "true"));
});

test("homepage offers three clear discovery paths using existing public routes", t => {
  const dom = new JSDOM(page, { url: "https://www.browserp.com/" });
  t.after(() => dom.window.close());
  const section = dom.window.document.querySelector(".home-journeys-v12");
  const journeys = [...section.querySelectorAll(".home-journey-card-v12")];
  assert.equal(section.getAttribute("aria-labelledby"), "home-journeys-heading");
  assert.equal(section.querySelector(".home-journey-grid-v12")?.getAttribute("aria-label"), "Ways to explore BrowseRP");
  assert.deepEqual(journeys.map(link => link.getAttribute("href")), ["/servers", "/find-server", "/compare"]);
  assert.deepEqual(journeys.map(link => link.querySelector("strong")?.textContent), [
    "Browse the directory", "Get a guided match", "Compare your shortlist"
  ]);
  assert.equal(section.querySelectorAll("a a, button, [role='button']").length, 0, "journey cards do not contain nested controls");
  assert.equal(section.querySelector(".home-journeys-footnote-v12 a")?.getAttribute("href"), "/servers?sort=newest");
});

test("journey styling is responsive and respects motion and high-contrast preferences", () => {
  assert.match(css, /body\[data-page="home"\] \.home-journeys-v12/);
  assert.match(css, /grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(css, /@media \(max-width: 760px\)[\s\S]*?\.home-journey-grid-v12\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /@media \(forced-colors: active\)/);
  assert.match(css, /\.home-journey-card-v12:focus-visible/);
});
