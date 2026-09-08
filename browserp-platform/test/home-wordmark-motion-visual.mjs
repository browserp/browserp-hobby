import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const engines = await import(pathToFileURL(resolve(process.argv[2], "index.mjs")).href);
const base = process.env.BROWSERP_VISUAL_URL || "http://127.0.0.1:4189";

function horizontal(value) {
  const number = Number.parseFloat(String(value || "").split(" ")[0]);
  return Number.isFinite(number) ? number : 0;
}

async function rowState(page) {
  return page.locator(".home-hero-wordmark-row").evaluateAll(rows => rows.slice(0, 2).map(row => {
    const before = getComputedStyle(row, "::before");
    const after = getComputedStyle(row, "::after");
    return {
      beforePosition: before.backgroundPosition,
      afterPosition: after.backgroundPosition,
      beforeName: before.animationName,
      afterName: after.animationName,
      beforeState: before.animationPlayState,
      afterState: after.animationPlayState
    };
  }));
}

const browser = await engines.chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 }, reducedMotion: "no-preference" });
  const page = await context.newPage();
  await page.goto(`${base}/`);
  await page.locator('.home-hero-pattern[data-motion="running"] .home-hero-wordmark-row').first().waitFor();
  const brand = await page.locator(".public-nav-v6 > .navigation-brand-v6 img").evaluate(image => ({
    complete: image.complete,
    naturalWidth: image.naturalWidth,
    naturalHeight: image.naturalHeight,
    width: image.getBoundingClientRect().width,
    height: image.getBoundingClientRect().height
  }));
  assert.deepEqual({ complete: brand.complete, naturalWidth: brand.naturalWidth, naturalHeight: brand.naturalHeight }, { complete: true, naturalWidth: 1400, naturalHeight: 358 });
  assert.ok(brand.width <= 190 * 1.041 && brand.height <= 54 * 1.041 && brand.width > 160 && brand.height > 40, "the new asset stays inside the existing header geometry and its retained 4% breathe animation");
  const first = await rowState(page);
  await page.waitForTimeout(1200);
  const second = await rowState(page);
  assert.match(first[0].beforeName, /home-wordmark-row-drift/);
  assert.match(first[0].afterName, /home-wordmark-row-drift.*home-wordmark-wave/);
  assert.equal(first[0].beforeState, "running");
  assert.match(first[0].afterState, /running/);
  const oddTravel = horizontal(second[0].beforePosition) - horizontal(first[0].beforePosition);
  const evenTravel = horizontal(second[1].beforePosition) - horizontal(first[1].beforePosition);
  assert.ok(Math.abs(oddTravel) > .5, `odd row moved only ${oddTravel}px`);
  assert.ok(Math.abs(evenTravel) > .5, `even row moved only ${evenTravel}px`);
  assert.ok(oddTravel * evenTravel < 0, "adjacent rows drift in opposite directions");
  assert.ok(Math.abs(horizontal(second[0].afterPosition) - horizontal(first[0].afterPosition)) > .5, "the wave overlay travels with its row");
  await context.close();

  const reduced = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
  const reducedPage = await reduced.newPage();
  await reducedPage.goto(`${base}/`);
  await reducedPage.locator(".home-hero-wordmark-row").first().waitFor();
  const reducedState = await rowState(reducedPage);
  assert.equal(reducedState[0].beforeName, "none");
  assert.equal(reducedState[0].afterName, "none");
  await reduced.close();
} finally {
  await browser.close();
}
