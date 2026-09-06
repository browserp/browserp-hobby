// Optional local browser regression. Never contacts the production database.
// node test/navigation-visual.mjs <path-to-playwright-package>
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require(process.argv[2] || "playwright");
const browser = await chromium.launch({ channel: "chrome", headless: true });
const base = "http://127.0.0.1:4189";
const results = [];
try {
  for (const reducedMotion of ["reduce", "no-preference"]) for (const width of [2503, 1366, 768, 390]) {
    for (const path of ["/server/preview-community-0", "/servers", "/"]) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion });
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", error => errors.push(error.message));
      let releaseNavigation, releaseSession;
      const navigationGate = new Promise(resolve => { releaseNavigation = resolve; });
      const sessionGate = new Promise(resolve => { releaseSession = resolve; });
      await page.route("**/navigation.js?*", async route => { await navigationGate; await route.continue(); });
      await page.route("**/api/auth/session", async route => { await sessionGate; await route.continue(); });
      await page.goto(base + path, { waitUntil: "commit" });
      const server = path.startsWith("/server/");
      const selector = server ? ".server-content-v7" : ".content-with-rail-v3 > :not(.side-ad-v3)";
      await page.locator(selector).first().waitFor({ state: "visible" });
      await page.waitForFunction(() => getComputedStyle(document.querySelector("header nav")).minHeight === (innerWidth <= 520 ? "68px" : "88px"));
      const measure = () => page.evaluate(selector => {
        const content = document.querySelector(selector).getBoundingClientRect();
        return { x: content.x, width: content.width, header: document.querySelector("header").getBoundingClientRect().height,
          pageWidth: document.documentElement.scrollWidth, mainAnimation: getComputedStyle(document.querySelector("main")).animationName };
      }, selector);
      const before = await measure();
      assert.equal(before.mainAnimation, "none");
      releaseNavigation();
      await page.locator(".public-nav-v6").waitFor({ state: "visible" });
      const enhanced = await measure();
      assert.equal(enhanced.header, before.header, `${path} ${width}px header upgrade must not shift the page`);
      releaseSession();
      await page.locator(".side-ad-v3:not([hidden])").first().waitFor({ state: "visible" });
      if (server) await page.getByRole("heading", { name: "Preview Community 1", exact: true }).waitFor();
      const after = await measure();
      assert.ok(Math.abs(before.width - after.width) < 1, `${path} ${width}px content width changed: ${before.width} to ${after.width}`);
      assert.ok(Math.abs(before.x - after.x) < 1, `${path} ${width}px content moved horizontally`);
      assert.ok(after.pageWidth <= width, `${path} ${width}px overflow`);
      assert.deepEqual(errors, [], "No uncaught browser errors");
      results.push({ path, viewport: width, reducedMotion, before, after });
      if (server && width === 1366) await page.screenshot({ path: "test/navigation-stability-desktop.local.png" });
      if (server && width === 390) await page.screenshot({ path: "test/navigation-stability-mobile.local.png" });
      await context.close();
    }
  }
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  const page = await context.newPage();
  await page.goto(base + "/servers");
  await page.locator('a[href="/server/preview-community-0"]').first().click();
  await page.getByRole("heading", { name: "Preview Community 1", exact: true }).waitFor();
  await page.getByRole("link", { name: "Discover servers", exact: true }).click();
  await page.locator('a[href="/server/preview-community-0"]').first().waitFor();
  await context.close();
  console.log(JSON.stringify({ status: "passed", cases: results.length, clickNavigation: "passed", results }, null, 2));
} finally { await browser.close(); }
