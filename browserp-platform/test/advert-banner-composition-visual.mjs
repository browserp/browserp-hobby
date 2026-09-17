// Optional rendered regression check against the local visual fixture.
// Start test/visual-fixture.mjs, then pass the installed Playwright package
// directory as argv[2]. No real member data or writes are used.
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

if (!process.argv[2]) throw new Error("Pass the installed Playwright package directory.");
const engines = await import(pathToFileURL(resolve(process.argv[2], "index.mjs")).href);
const browser = await engines[process.env.BROWSERP_BROWSER || "chromium"].launch({ headless: true });
const base = process.env.BROWSERP_VISUAL_URL || "http://127.0.0.1:4189";

try {
  for (const width of [1425, 768, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: "reduce" });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`${base}/games`);
    const banner = page.locator("main .banner-ad-v7").first();
    await banner.waitFor({ state: "visible" });
    await banner.locator(".ad-dot-v3").nth(2).click();
    await banner.locator(".side-ad-image-v3").evaluate(image => new Promise((resolve, reject) => {
      if (image.complete) return image.naturalWidth ? resolve() : reject(new Error("Advert artwork unavailable"));
      image.addEventListener("load", resolve, { once: true });
      image.addEventListener("error", () => reject(new Error("Advert artwork unavailable")), { once: true });
    }));

    for (const theme of ["default", "dark", "light"]) {
      await page.evaluate(value => { document.documentElement.dataset.theme = value; }, theme);
      const result = await banner.evaluate(element => {
        const bounds = selector => element.querySelector(selector)?.getBoundingClientRect();
        const stage = bounds(".side-ad-stage-v3"), image = bounds(".side-ad-image-v3"), shade = bounds(".side-ad-shade-v3");
        const copy = bounds(".side-ad-copy-v3"), cta = bounds(".side-ad-copy-v3 a");
        const previous = bounds(".ad-arrow-previous-v3"), next = bounds(".ad-arrow-next-v3");
        const controls = bounds(".ad-controls-v3");
        const inside = (inner, outer) => inner && outer && inner.left >= outer.left - 1 && inner.right <= outer.right + 1 && inner.top >= outer.top - 1 && inner.bottom <= outer.bottom + 1;
        return { stageWidth: stage.width, stageHeight: stage.height,
          imageFullBleed: Math.abs(image.left - stage.left) <= 1 && Math.abs(image.right - stage.right) <= 1 && Math.abs(image.top - stage.top) <= 1 && Math.abs(image.bottom - stage.bottom) <= 1,
          shadeFullBleed: Math.abs(shade.left - stage.left) <= 1 && Math.abs(shade.right - stage.right) <= 1,
          cover: getComputedStyle(element.querySelector(".side-ad-image-v3")).objectFit === "cover",
          copyContained: inside(copy, stage), ctaContained: inside(cta, stage), arrowsContained: inside(previous, stage) && inside(next, stage),
          controlsBelow: controls.top >= stage.bottom - 1 && controls.left >= element.getBoundingClientRect().left - 1 && controls.right <= element.getBoundingClientRect().right + 1,
          noHorizontalOverflow: document.documentElement.scrollWidth <= innerWidth + 1,
          theme: document.documentElement.dataset.theme };
      });
      assert.equal(result.theme, theme);
      if (width === 1425) {
        assert.ok(Math.abs(result.stageWidth - 1040) <= 2, `${theme}: approved wide banner width`);
        assert.ok(Math.abs(result.stageHeight - 364) <= 3, `${theme}: approved wide banner height and artwork crop`);
      }
      for (const key of ["imageFullBleed", "shadeFullBleed", "cover", "copyContained", "ctaContained", "arrowsContained", "controlsBelow", "noHorizontalOverflow"]) {
        assert.equal(result[key], true, `${theme} ${width}px: ${key}`);
      }
    }
    assert.deepEqual(errors, [], `${width}px: no page errors`);
    console.log(`${width}px: approved banner composition and controls across Default/Dark/Light`);
    await context.close();
  }
} finally { await browser.close(); }
