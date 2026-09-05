import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { JSDOM } from "jsdom";

const root = new URL("../", import.meta.url);
const read = path => readFileSync(new URL(path, root), "utf8");

function pngSize(path) {
  const bytes = readFileSync(new URL(path, root));
  assert.equal(bytes.toString("ascii", 12, 16), "IHDR", `${path} must be a valid PNG`);
  return [bytes.readUInt32BE(16), bytes.readUInt32BE(20)];
}

function pngColourType(path) {
  const bytes = readFileSync(new URL(path, root));
  assert.equal(bytes.toString("ascii", 12, 16), "IHDR", `${path} must be a valid PNG`);
  return bytes[25];
}

function icoSizes(path) {
  const bytes = readFileSync(new URL(path, root));
  assert.deepEqual([...bytes.subarray(0, 4)], [0, 0, 1, 0], `${path} must be a valid ICO`);
  const count = bytes.readUInt16LE(4);
  return Array.from({ length: count }, (_, index) => {
    const offset = 6 + index * 16;
    return [bytes[offset] || 256, bytes[offset + 1] || 256];
  });
}

test("every user-facing document publishes one consistent BrowseRP browser identity", () => {
  const publicDirectory = new URL("../public/", import.meta.url);
  const pages = readdirSync(publicDirectory).filter(name => name.endsWith(".html"));
  assert.ok(pages.length >= 25);
  for (const page of pages) {
    const html = read(`public/${page}`);
    const document = new JSDOM(html).window.document;
    assert.match(document.title, /BrowseRP/, `${page} title`);
    assert.equal(document.querySelector('meta[name="application-name"]')?.content, "BrowseRP", `${page} application name`);
    assert.equal(document.querySelector('meta[name="apple-mobile-web-app-title"]')?.content, "BrowseRP", `${page} Apple title`);
    assert.equal(document.querySelector('meta[property="og:site_name"]')?.content, "BrowseRP", `${page} social site name`);
    assert.equal(document.querySelector('meta[property="og:image"]')?.content, "https://www.browserp.com/browserp-mark-v3.png", `${page} social logo`);
    assert.equal(document.querySelector('meta[property="og:image:type"]')?.content, "image/png", `${page} social image type`);
    assert.equal(document.querySelector('meta[property="og:image:width"]')?.content, "1254", `${page} social image width`);
    assert.equal(document.querySelector('meta[property="og:image:height"]')?.content, "1254", `${page} social image height`);
    assert.equal(document.querySelector('meta[name="twitter:card"]')?.content, "summary", `${page} social card`);
    assert.equal(document.querySelector('meta[name="twitter:image:alt"]')?.content, "BrowseRP RP logo", `${page} social image description`);
    assert.equal(document.querySelector('meta[name="theme-color"]')?.content, "#07080b", `${page} browser theme`);
    document.querySelectorAll("nav.shell-v3.nav-v3").forEach(nav => assert.equal(nav.getAttribute("aria-label"), "Main navigation", `${page} navigation label`));
    document.querySelectorAll("[data-menu-v3]").forEach(button => assert.equal(button.getAttribute("aria-label"), "Open menu", `${page} menu label`));
    const icons = [...document.querySelectorAll('link[rel="icon"]')].map(link => ({
      href: link.getAttribute("href"),
      sizes: link.getAttribute("sizes"),
      type: link.getAttribute("type"),
    }));
    assert.deepEqual(icons, [
      { href: "/favicon.ico", sizes: "32x32 48x48", type: null },
      { href: "/assets/browserp-icon-32.png", sizes: "32x32", type: "image/png" },
      { href: "/assets/browserp-icon-48.png", sizes: "48x48", type: "image/png" },
    ], `${page} favicons`);
    const appleIcon = document.querySelector('link[rel="apple-touch-icon"]');
    assert.equal(appleIcon?.getAttribute("href"), "/apple-touch-icon.png", `${page} Apple icon`);
    assert.equal(appleIcon?.getAttribute("sizes"), "180x180", `${page} Apple icon size`);
    assert.equal(document.querySelector('link[rel="manifest"]')?.getAttribute("href"), "/manifest.webmanifest", `${page} manifest`);
  }
});

test("launch-facing copy and submission choices name the four live games", () => {
  const home = read("public/index.html");
  const listing = read("public/list-server.html");
  const sitemap = read("public/sitemap.xml");
  for (const game of ["FiveM", "RedM", "Roblox", "Minecraft"]) assert.match(home, new RegExp(game));
  assert.doesNotMatch(home, /across every game|driving simulators and more/i);
  assert.doesNotMatch(listing, /<option value="(?:forza|gmod|arma|vrchat|dayz|project-zomboid|ets2|assetto-corsa|beamng)"/i);
  assert.doesNotMatch(sitemap, /\/games\/(?:forza|gmod|arma|vrchat|dayz|project-zomboid|ets2|assetto-corsa|beamng)/i);
});

test("the install and OAuth artwork use the square RP mark at provider-ready sizes", () => {
  const manifest = JSON.parse(read("public/manifest.webmanifest"));
  assert.equal(manifest.name, "BrowseRP");
  assert.equal(manifest.short_name, "BrowseRP");
  assert.equal(manifest.id, "/");
  assert.deepEqual(manifest.icons.map(icon => [icon.sizes, icon.purpose]), [
    ["192x192", "any"],
    ["512x512", "any"],
    ["512x512", "maskable"],
  ]);
  assert.deepEqual(icoSizes("public/favicon.ico"), [[32, 32], [48, 48]]);
  assert.deepEqual(pngSize("public/assets/browserp-oauth-icon-v1.png"), [120, 120]);
  assert.deepEqual(pngSize("public/assets/browserp-icon-180.png"), [180, 180]);
  assert.deepEqual(pngSize("public/apple-touch-icon.png"), [180, 180]);
  assert.equal(pngColourType("public/apple-touch-icon.png"), 2, "Apple icon must be opaque RGB");
  assert.deepEqual(pngSize("public/assets/browserp-icon-32.png"), [32, 32]);
  assert.deepEqual(pngSize("public/assets/browserp-icon-48.png"), [48, 48]);
  assert.deepEqual(pngSize("public/assets/browserp-icon-192.png"), [192, 192]);
  assert.deepEqual(pngSize("public/assets/browserp-icon-512.png"), [512, 512]);
  assert.deepEqual(pngSize("public/assets/browserp-icon-maskable-512.png"), [512, 512]);
  assert.equal(pngColourType("public/assets/browserp-icon-maskable-512.png"), 2, "maskable icon must be opaque RGB");
});

test("OAuth reviewers and users have stable, specific policy pages", () => {
  const privacy = read("public/privacy.html");
  const terms = read("public/terms.html");
  const vercel = JSON.parse(read("vercel.json"));
  assert.match(privacy, /Google supplies your provider identifier, name, email address and profile image/);
  assert.match(privacy, /Discord supplies your provider identifier, username, email address and avatar/);
  assert.match(privacy, /does not request access to Gmail, Google Drive, Google Calendar, Discord messages/);
  assert.match(terms, /Terms of service/);
  const routes = new Map(vercel.rewrites.map(route => [route.source, route.destination]));
  assert.equal(routes.get("/privacy"), "/privacy.html");
  assert.equal(routes.get("/terms"), "/terms.html");
});

test("scroll reveals start early and avoid paint-heavy transition work", () => {
  const css = read("public/browserp-v3.css");
  const js = read("public/browserp-v3.js");
  const reveal = css.match(/\.reveal-v3\s*\{([^}]*)\}/)?.[1] || "";
  const brandPulse = css.match(/@keyframes browserp-brand-pulse-v4\s*\{([\s\S]*?)\n\}/)?.[1] || "";
  assert.match(reveal, /opacity:\s*1/);
  assert.match(reveal, /120ms/);
  assert.doesNotMatch(reveal, /filter/);
  assert.match(css, /main \{ animation: page-enter-v3 \.16s/);
  assert.doesNotMatch(brandPulse, /filter|drop-shadow/);
  assert.match(css, /@media \(pointer: coarse\)[\s\S]*?\.header-v3 \{[^}]*backdrop-filter: none/);
  assert.match(js, /rootMargin: "0px 0px 35% 0px"/);
  assert.match(js, /prefersDirectScroll/);
  assert.match(css, /\.server-info-card-v5[^}]*caret-color:\s*transparent[^}]*user-select:\s*none/);
  assert.match(css, /@media \(hover: none\), \(pointer: coarse\)[\s\S]*?brightness\(1\.12\)/);
  assert.match(css, /@media \(hover: none\), \(pointer: coarse\)[\s\S]*?html \{ scroll-behavior: auto; \}/);
  assert.match(css, /@keyframes touch-sweep-v3/);
  assert.match(js, /function touchPolish\(\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
});
