import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const engines = await import(pathToFileURL(resolve(process.argv[2], "index.mjs")).href);
const base = process.env.BROWSERP_VISUAL_URL || "http://127.0.0.1:4189";

async function motionState(page) {
  return page.evaluate(() => {
    const matrix = transform => transform === "none" ? new DOMMatrixReadOnly() : new DOMMatrixReadOnly(transform);
    const rows = [...document.querySelectorAll(".home-hero-wordmark-row")].map(row => {
      const style = getComputedStyle(row), before = getComputedStyle(row, "::before"), after = getComputedStyle(row, "::after");
      const movement = matrix(style.transform), wave = matrix(after.transform);
      return {
        x: movement.m41, rowScale: movement.m22, rowName: style.animationName,
        rowDuration: style.animationDuration, rowState: style.animationPlayState,
        beforePosition: before.backgroundPosition, afterPosition: after.backgroundPosition,
        beforeLeft: parseFloat(before.left), beforeRight: parseFloat(before.right),
        afterLeft: parseFloat(after.left), afterRight: parseFloat(after.right),
        beforeName: before.animationName, afterName: after.animationName,
        afterState: after.animationPlayState, afterDelay: parseFloat(after.animationDelay),
        waveOpacity: parseFloat(after.opacity), waveScale: wave.m22, waveX: wave.m41
      };
    });
    const plane = getComputedStyle(document.querySelector(".home-hero-wordmarks"));
    const brand = document.querySelector(".public-nav-v6 > .navigation-brand-v6");
    const image = getComputedStyle(brand.querySelector("img")), halo = getComputedStyle(brand, "::before");
    return { rows, planeTransform: plane.transform, planeName: plane.animationName, planeDuration: plane.animationDuration,
      brandName: image.animationName, brandState: image.animationPlayState, brandScale: matrix(image.transform).m11,
      haloName: halo.animationName, haloOpacity: parseFloat(halo.opacity) };
  });
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
  const first = await motionState(page);
  await page.waitForTimeout(600);
  const middle = await motionState(page);
  await page.waitForTimeout(600);
  const second = await motionState(page);
  assert.equal(first.rows[0].rowName, "home-wordmark-row-drift");
  assert.equal(first.rows[0].rowDuration, "64s");
  assert.equal(first.rows[0].rowState, "running");
  assert.equal(first.rows[0].beforeName, "none");
  assert.equal(first.rows[0].afterName, "home-wordmark-wave");
  assert.equal(first.rows[0].afterState, "running");
  const oddTravel = second.rows[0].x - first.rows[0].x;
  const evenTravel = second.rows[1].x - first.rows[1].x;
  assert.ok(Math.abs(oddTravel) > .5, `odd row moved only ${oddTravel}px`);
  assert.ok(Math.abs(evenTravel) > .5, `even row moved only ${evenTravel}px`);
  assert.ok(oddTravel * evenTravel < 0, "adjacent rows drift in opposite directions");
  for (const [index, row] of second.rows.entries()) {
    assert.equal(row.beforePosition, first.rows[index].beforePosition, "base images are static painted content");
    assert.equal(row.afterPosition, first.rows[index].afterPosition, "glow images inherit row travel without repainting their backgrounds");
    assert.equal(row.rowScale, 1); assert.equal(row.waveX, 0, "the wave's transform remains independent of row translation");
    assert.ok([row.beforeLeft, row.beforeRight, row.afterLeft, row.afterRight].every(inset => inset === -120), "both layers cover a complete repeat in either direction");
    assert.ok(Math.abs((row.waveScale - 1) / .045 - row.waveOpacity / .48) < .002, "wave brightness and growth remain synchronized");
  }
  assert.ok([first, middle, second].some(frame => frame.rows.some(row => row.waveOpacity > .01 && row.waveScale > 1)), "the glow/growth wave runs while rows travel");
  assert.ok(second.rows.some((row, index) => Math.abs(row.waveOpacity - first.rows[index].waveOpacity) > .01), "the wave progresses between rows");
  assert.ok(Math.abs(first.rows[1].afterDelay - first.rows[0].afterDelay - .32 * 1.3333333333) < .001, "row ordering retains the diagonal wave delay");
  assert.equal(first.planeName, "home-wordmark-drift"); assert.equal(first.planeDuration, "96s");
  assert.notEqual(first.planeTransform, second.planeTransform, "the whole rotated plane continues drifting");
  assert.equal(first.brandName, "navigation-brand-breathe"); assert.equal(first.brandState, "running");
  assert.equal(first.haloName, "navigation-brand-glow");
  assert.ok(Math.max(first.brandScale, middle.brandScale, second.brandScale) - Math.min(first.brandScale, middle.brandScale, second.brandScale) > .0001, "the header keeps breathing concurrently");
  assert.ok(Math.max(first.haloOpacity, middle.haloOpacity, second.haloOpacity) - Math.min(first.haloOpacity, middle.haloOpacity, second.haloOpacity) > .001, "the header halo keeps glowing concurrently");
  await page.locator(".home-hero-pattern").evaluate(pattern => { pattern.dataset.motion = "paused"; });
  const paused = await motionState(page);
  await page.waitForTimeout(200);
  const still = await motionState(page);
  assert.equal(still.rows[0].rowState, "paused"); assert.equal(still.rows[0].afterState, "paused");
  assert.equal(still.planeTransform, paused.planeTransform);
  assert.deepEqual(still.rows.map(row => [row.x, row.waveOpacity, row.waveScale]), paused.rows.map(row => [row.x, row.waveOpacity, row.waveScale]), "pausing freezes row movement and its separate wave together");
  await context.close();

  const reduced = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" });
  const reducedPage = await reduced.newPage();
  await reducedPage.goto(`${base}/`);
  await reducedPage.locator(".home-hero-wordmark-row").first().waitFor();
  await reducedPage.locator(".public-nav-v6 > .navigation-brand-v6 img").waitFor();
  const reducedState = await motionState(reducedPage);
  assert.equal(reducedState.rows[0].rowName, "none");
  assert.equal(reducedState.rows[0].beforeName, "none");
  assert.equal(reducedState.rows[0].afterName, "none");
  assert.equal(reducedState.planeName, "none");
  await reduced.close();
} finally {
  await browser.close();
}
