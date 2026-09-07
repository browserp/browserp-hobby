// Optional isolated browser check. Start test/visual-fixture.mjs first, or set
// BROWSERP_VISUAL_URL to a local public preview. BROWSERP_BROWSER can select
// chromium (default), firefox or webkit; engines run one at a time.
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
const engines = await import(pathToFileURL(resolve(process.argv[2], "index.mjs")).href);
const browserName = process.env.BROWSERP_BROWSER || "chromium";
const browser = await engines[browserName].launch({ headless: true });
const base = process.env.BROWSERP_VISUAL_URL || "http://127.0.0.1:4189";
try {
  for (const [name, width, touch, reduced, blocked] of [
    ["desktop", 1366, false, false, false], ["wide", 2503, false, false, false],
    ["tablet", 768, true, false, false], ["phone", 390, true, false, false],
    ["reduced", 1366, false, true, false], ["blocked", 1366, false, true, true],
    ["blocked-narrow", 1040, false, true, true], ["blocked-phone", 390, true, true, true]
  ].filter(([name]) => !process.env.BROWSERP_VISUAL_CASES || process.env.BROWSERP_VISUAL_CASES.split(",").includes(name))) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, hasTouch: touch, isMobile: touch && browserName !== "firefox", reducedMotion: reduced ? "reduce" : "no-preference" });
    const page = await context.newPage(), errors = [];
    page.on("pageerror", error => errors.push(error.message));
    if (blocked) await page.route("**/assets/adverts/**", route => route.abort());
    for (const route of (process.env.BROWSERP_VISUAL_ROUTES || "/,/servers,/server/preview-community-0").split(",")) {
      await page.goto(`${base}${route}`);
      await page.locator(".side-ad-v3 .ad-arrow-v3").first().waitFor();
      const adverts = page.locator(".side-ad-v3:visible");
      for (let index = 0; index < await adverts.count(); index++) {
        const advert = adverts.nth(index);
        await advert.scrollIntoViewIfNeeded();
        const next = advert.getByRole("button", { name: "Next advert", exact: true });
        const previous = advert.getByRole("button", { name: "Previous advert", exact: true });
        const first = await advert.locator("[data-ad-copy] strong").textContent();
        await next.click({ position: { x: 2, y: 22 } }); // The hit-area edge, outside the smaller face (not its rounded corner).
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
        if (route === "/servers") {
          for (let slide = 0; slide < await advert.locator(".ad-dot-v3").count(); slide++) {
            if (blocked) await advert.locator(".side-ad-image-notice-v3").waitFor({ state: "visible" });
            assert.equal(await advert.evaluate(element => {
              const stage = element.querySelector(".side-ad-stage-v3").getBoundingClientRect();
              const copy = element.querySelector(".side-ad-copy-v3").getBoundingClientRect();
              return copy.left >= stage.left && copy.right <= stage.right && copy.top >= stage.top && copy.bottom <= stage.bottom;
            }), true, "Every directory advert keeps its full copy inside the stage");
            await next.click();
          }
        }
        if (blocked && route === "/servers") {
          // This directory failure state was absent from the earlier home and
          // detail-page checks. Exercise its actual loaded CSS and copy layout.
          const fallback = await advert.evaluate(element => {
            const stage = element.querySelector(".side-ad-stage-v3").getBoundingClientRect();
            const copy = element.querySelector(".side-ad-copy-v3").getBoundingClientRect();
            const notice = element.querySelector(".side-ad-image-notice-v3");
            return { failed: element.classList.contains("artwork-unavailable"), notice: !notice.hidden,
              brandWidth: notice.querySelector("img").getBoundingClientRect().width,
              stageHeight: stage.height, contained: copy.left >= stage.left && copy.right <= stage.right && copy.bottom <= stage.bottom };
          });
          assert.equal(fallback.failed, true); assert.equal(fallback.notice, true);
          assert.ok(fallback.brandWidth <= 128); assert.ok(fallback.stageHeight < 460);
          assert.equal(fallback.contained, true);
        }
      }
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      if (["desktop", "phone", "blocked"].includes(name)) {
        await adverts.first().screenshot({ path: `test/navigation-stability-advert-controls-${name}-${route === "/" ? "home" : route === "/servers" ? "directory" : "server"}.png` });
      }
    }
    assert.deepEqual(errors, []);
    console.log(`${name}: arrows, 44px targets, compact faces, keyboard, layout and fallback passed`);
    await context.close();
  }
} finally { await browser.close(); }
