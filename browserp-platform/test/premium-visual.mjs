// Local-only interaction review. Run visual-fixture.mjs first and pass Playwright's package path.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)(process.argv[2] || "playwright");
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  for (const mode of ["desktop", "reduced", "touch"]) {
    const page = await browser.newPage({ viewport: { width: mode === "touch" ? 390 : 1366, height: 900 },
      reducedMotion: mode === "reduced" ? "reduce" : "no-preference", hasTouch: mode === "touch", isMobile: mode === "touch" });
    const errors = [];
    page.setDefaultTimeout(8000);
    page.on("pageerror", error => errors.push(error.message));
    await page.goto("http://127.0.0.1:4189/servers");
    const card = page.locator(".server-card").first();
    await card.waitFor();
    assert.equal(await page.locator(".platform-badge-v5 svg").count(), 0);
    if (mode !== "touch") {
      await card.hover();
      await page.waitForFunction(() => getComputedStyle(document.querySelector(".server-card"), "::after").opacity === "1");
      assert.equal(await card.evaluate(el => getComputedStyle(el, "::after").pointerEvents), "none");
      await card.screenshot({ path: `test/navigation-stability-premium-card-${mode}.png` });
      const action = page.locator(".public-nav-actions-v6 > .button-primary-v3");
      await action.hover();
      assert.equal(await action.evaluate(el => getComputedStyle(el, "::after").animationName), mode === "reduced" ? "none" : "touch-sweep-v3");
      await page.getByRole("button", { name: "Open account menu for Preview Member", exact: true }).click();
      const profile = page.locator(".account-popover-v3[data-open=true]").getByRole("link", { name: "Profile", exact: true });
      await page.keyboard.press("Tab");
      assert.equal(await profile.evaluate(el => el === document.activeElement), true);
      await page.waitForFunction(() => getComputedStyle(document.activeElement).boxShadow.includes("inset"));
      await page.keyboard.press("Escape");
    }
    await page.getByRole("button", { name: "Open menu", exact: true }).click();
    const close = page.getByRole("button", { name: "Close menu", exact: true });
    await close.waitFor();
    await page.waitForFunction(() => getComputedStyle(document.querySelector(".navigation-dialog-v6")).opacity === "1"
      && [...document.querySelectorAll(".navigation-enter-v6")].every(el => getComputedStyle(el).opacity === "1"));
    const before = await close.boundingBox();
    const tile = page.locator(".navigation-link-v6").first();
    if (mode !== "touch") await tile.hover();
    const iconTransform = await tile.locator(".navigation-link-icon-v6").evaluate(el => getComputedStyle(el).transform);
    if (mode !== "desktop") assert.equal(iconTransform, "none");
    assert.deepEqual(await close.boundingBox(), before, "Close button must never move with decorated menu tiles");
    await page.screenshot({ path: `test/navigation-stability-premium-menu-${mode}.png` });
    await close.click();
    assert.equal(await page.locator("main").evaluate(el => getComputedStyle(el).animationName), "none");
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ mode, status: "passed", mainMotion: "none", fixedClose: true, noGameSymbols: true }));
    await page.close();
  }
} finally { await browser.close(); }
