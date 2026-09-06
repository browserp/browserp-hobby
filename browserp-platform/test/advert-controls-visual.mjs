// Optional isolated Chrome check. Start test/visual-fixture.mjs first.
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
const { chromium } = await import(pathToFileURL(resolve(process.argv[2], "index.mjs")).href);
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  for (const [name, width, touch, reduced, blocked] of [
    ["desktop", 1366, false, false, false], ["wide", 2503, false, false, false],
    ["tablet", 768, true, false, false], ["phone", 390, true, false, false],
    ["reduced", 1366, false, true, false], ["blocked", 1366, false, true, true]
  ]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, hasTouch: touch, isMobile: touch, reducedMotion: reduced ? "reduce" : "no-preference" });
    const page = await context.newPage(), errors = [];
    page.on("pageerror", error => errors.push(error.message));
    if (blocked) await page.route("**/assets/adverts/**", route => route.abort());
    for (const route of ["/", "/server/preview-community-0"]) {
      await page.goto(`http://127.0.0.1:4189${route}`);
      await page.locator(".side-ad-v3 .ad-arrow-v3").first().waitFor();
      const adverts = page.locator(".side-ad-v3:visible");
      for (let index = 0; index < await adverts.count(); index++) {
        const advert = adverts.nth(index);
        await advert.scrollIntoViewIfNeeded();
        const next = advert.getByRole("button", { name: "Next advert", exact: true });
        const previous = advert.getByRole("button", { name: "Previous advert", exact: true });
        const first = await advert.locator("[data-ad-copy] strong").textContent();
        await next.click({ position: { x: 2, y: 2 } }); // The invisible hit-area edge works too.
        assert.notEqual(await advert.locator("[data-ad-copy] strong").textContent(), first);
        await previous.focus();
        await previous.press("Enter");
        assert.equal(await advert.locator("[data-ad-copy] strong").textContent(), first);
        const style = await next.evaluate(button => {
          const s = getComputedStyle(button), face = getComputedStyle(button, "::before"), arrow = getComputedStyle(button, "::after");
          const rect = button.getBoundingClientRect(), stage = button.closest(".side-ad-stage-v3").getBoundingClientRect();
          return { width: rect.width, height: rect.height, radius: face.borderRadius, inset: face.top, background: s.backgroundColor,
            font: s.fontSize, transform: s.transform, pointer: [face.pointerEvents, arrow.pointerEvents],
            transition: face.transitionDuration, position: s.position,
            contained: rect.left >= stage.left && rect.right <= stage.right && rect.top >= stage.top && rect.bottom <= stage.bottom };
        });
        assert.equal(style.width, 44); assert.equal(style.height, 44);
        assert.equal(style.radius, "7px"); assert.equal(style.inset, "6px");
        assert.equal(style.background, "rgba(0, 0, 0, 0)"); assert.equal(style.font, "0px");
        assert.equal(style.transform, "none"); assert.deepEqual(style.pointer, ["none", "none"]);
        assert.equal(style.contained, true);
        if (reduced) assert.ok(style.transition.split(",").every(value => parseFloat(value) <= .00001));
        if (blocked) assert.equal(style.position, "relative");
      }
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      if (["desktop", "phone", "blocked"].includes(name)) {
        await adverts.first().screenshot({ path: `test/navigation-stability-advert-controls-${name}-${route === "/" ? "home" : "server"}.png` });
      }
    }
    assert.deepEqual(errors, []);
    console.log(`${name}: arrows, 44px targets, compact faces, keyboard, layout and fallback passed`);
    await context.close();
  }
} finally { await browser.close(); }
