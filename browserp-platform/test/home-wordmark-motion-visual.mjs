import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const engines = await import(pathToFileURL(resolve(process.argv[2], 'index.mjs')).href);
const base = process.env.BROWSERP_VISUAL_URL || 'http://127.0.0.1:4189';
const near = (actual, expected, label) => assert.ok(Math.abs(actual - expected) < .002, `${label}: ${actual} differs from ${expected}`);

async function state(page) {
  return page.evaluate(() => {
    const canvas = document.querySelector('.home-hero-wordmark-canvas');
    const brand = document.querySelector('.public-nav-v6 > .navigation-brand-v6');
    const image = getComputedStyle(brand.querySelector('img')), halo = getComputedStyle(brand, '::before'), cyan = getComputedStyle(brand, '::after');
    return { ...canvas.wordmarkFrame, pixels: [canvas.width, canvas.height],
      dpr: devicePixelRatio, brandName: image.animationName, brandState: image.animationPlayState,
      brandTransform: image.transform, haloName: halo.animationName, haloOpacity: halo.opacity, haloState: halo.animationPlayState, cyanName: cyan.animationName, cyanOpacity: cyan.opacity, cyanState: cyan.animationPlayState };
  });
}

const engine = process.env.BROWSERP_BROWSER_ENGINE || 'chromium';
console.log(JSON.stringify({ engine, status: 'started' }));
const browser = await engines[engine].launch({ headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 }, reducedMotion: 'no-preference' });
  await context.addInitScript(() => {
    localStorage.setItem('browserp-theme', 'dark');
    const schedule = window.requestAnimationFrame.bind(window);
    window.wordmarkRequests = 0;
    window.requestAnimationFrame = callback => {
      if (callback.name === 'tick') window.wordmarkRequests += 1;
      return schedule(callback);
    };
  });
  const page = await context.newPage();
  await page.goto(`${base}/`);
  await page.locator('.home-hero-pattern[data-renderer="canvas"] canvas').waitFor();
  await page.locator('.public-nav-v6 > .navigation-brand-v6 img').waitFor();
  const first = await state(page); await page.waitForTimeout(600);
  const middle = await state(page); await page.waitForTimeout(600);
  const second = await state(page);
  const travel = second.rows[0].x - first.rows[0].x;
  assert.ok(travel > 0, 'the rows move left to right along the rotated plane');
  for (let i = 0; i < second.rows.length; i += 1) near(second.rows[i].x - first.rows[i].x, travel, `row ${i} has the shared speed`);
  near(travel / ((second.time - first.time) / 1000), 2.5, 'steady visible travel in pixels per second');
  assert.equal(second.planeX, 0, 'no plane movement cancels the shared row movement');
  assert.equal(second.geometry.width, 92);
  near(second.geometry.baseOpacity, .07, 'the small resting wordmarks remain lightly visible');
  near(second.geometry.waveOpacity, .24, 'the travelling pulse defines the wordmarks');
  assert.ok(second.rows.some((row, i) => Math.abs(row.opacity - first.rows[i].opacity) > .01), 'the wave travels while the rows move');
  assert.equal(second.pixels[0], Math.ceil(second.geometry.viewportWidth * second.dpr));
  assert.equal(second.pixels[1], Math.ceil(second.geometry.viewportHeight * second.dpr));
  assert.equal(first.brandName, 'navigation-brand-breathe'); assert.equal(first.brandState, 'running');
  assert.equal(first.haloName, 'navigation-brand-glow');
  assert.equal(first.cyanName, 'navigation-brand-glow-cyan');
  assert.ok(new Set([first.brandTransform, middle.brandTransform, second.brandTransform]).size > 1, 'header breathing continues concurrently');
  assert.ok(new Set([first.haloOpacity, middle.haloOpacity, second.haloOpacity]).size > 1, 'header glow continues concurrently');

  const colors = await page.evaluate(() => {
    const brand = document.querySelector('.public-nav-v6 > .navigation-brand-v6');
    const animations = brand.getAnimations({ subtree: true });
    const saved = animations.map(animation => animation.currentTime);
    const phase = time => {
      animations.forEach(animation => { animation.pause(); animation.currentTime = time; });
      return { pink: Number(getComputedStyle(brand, '::before').opacity), cyan: Number(getComputedStyle(brand, '::after').opacity),
        filter: getComputedStyle(brand.querySelector('img')).filter, width: brand.offsetWidth, height: brand.offsetHeight };
    };
    const pink = phase(3000), cyan = phase(9000);
    animations.forEach((animation, index) => { animation.currentTime = saved[index]; animation.play(); });
    return { pink, cyan };
  });
  assert.ok(colors.pink.pink > colors.pink.cyan && colors.cyan.cyan > colors.cyan.pink, 'soft pink and cyan halos take turns');
  assert.equal(colors.pink.filter, 'none'); assert.equal(colors.cyan.filter, 'none');
  assert.equal(colors.pink.width, colors.cyan.width); assert.equal(colors.pink.height, colors.cyan.height);

  // Sample the CSS fallback, hidden and paused at the exact
  // drawn canvas time. Browser CSS interpolation is an independent timing oracle.
  const oracle = await page.evaluate(time => {
    const original = document.querySelector('.home-hero-pattern');
    const copy = original.cloneNode(true);
    delete copy.dataset.renderer; copy.dataset.motion = 'paused';
    copy.style.visibility = 'hidden'; copy.querySelector('canvas').remove();
    original.parentElement.append(copy);
    getComputedStyle(copy.querySelector('.home-hero-wordmarks')).transform;
    for (const animation of copy.getAnimations({ subtree: true })) { animation.pause(); animation.currentTime = time; }
    const matrix = value => value === 'none' ? new DOMMatrixReadOnly() : new DOMMatrixReadOnly(value);
    const rows = [...copy.querySelectorAll('.home-hero-wordmark-row')].map(row => {
      const body = getComputedStyle(row), wave = getComputedStyle(row, '::after');
      return { x: matrix(body.transform).m41, opacity: Number(wave.opacity), scale: matrix(wave.transform).m22 };
    });
    const plane = matrix(getComputedStyle(copy.querySelector('.home-hero-wordmarks')).transform);
    copy.remove(); return { rows, planeX: plane.m41, planeY: plane.m42 };
  }, second.time);
  assert.equal(oracle.rows.length, second.rows.length);
  for (let i = 0; i < oracle.rows.length; i += 1) {
    near(second.rows[i].x, oracle.rows[i].x, `row ${i} travel`);
    near(second.rows[i].opacity, oracle.rows[i].opacity, `row ${i} brightness`);
    near(second.rows[i].scale, oracle.rows[i].scale, `row ${i} growth`);
  }
  near(oracle.planeX, -second.geometry.extent / 2 + second.planeX * Math.SQRT1_2, 'plane horizontal transform');
  near(oracle.planeY, -second.geometry.planeHeight / 2 - second.planeX * Math.SQRT1_2, 'plane vertical transform');

  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  const paused = await state(page), pausedRequests = await page.evaluate(() => window.wordmarkRequests);
  await page.waitForTimeout(200);
  assert.deepEqual((await state(page)).rows, paused.rows, 'page lifecycle pause stops row and wave updates');
  assert.equal(paused.brandState, 'paused'); assert.equal(paused.haloState, 'paused'); assert.equal(paused.cyanState, 'paused');
  assert.equal(await page.evaluate(() => window.wordmarkRequests), pausedRequests, 'a paused renderer schedules no animation frames');
  await page.evaluate(() => window.dispatchEvent(new Event('pageshow')));
  await page.waitForTimeout(200); assert.ok((await state(page)).time > paused.time, 'resuming continues the saved phase');
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  await page.locator('.home-hero-pattern[data-motion="paused"]').waitFor({ state: 'attached' });
  const offscreenRequests = await page.evaluate(() => window.wordmarkRequests);
  await page.waitForTimeout(200);
  assert.equal(await page.evaluate(() => window.wordmarkRequests), offscreenRequests, 'offscreen artwork schedules no animation frames');
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.locator('.home-hero-pattern[data-motion="running"]').waitFor({ state: 'attached' });

  // Fail resize preparation after successful activation, then recover it.
  await page.evaluate(() => {
    const descriptor = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
    window.failWordmarkBake = true;
    Object.defineProperty(HTMLImageElement.prototype, 'src', { ...descriptor, set(value) {
      if (window.failWordmarkBake && value.startsWith('data:image/svg+xml')) {
        queueMicrotask(() => this.dispatchEvent(new Event('error'))); return;
      }
      descriptor.set.call(this, value);
    } });
  });
  await page.setViewportSize({ width: 1250, height: 900 });
  await page.locator('.home-hero-pattern:not([data-renderer]) .home-hero-wordmark-row').first().waitFor();
  assert.equal(await page.locator('.home-hero-wordmark-canvas').count(), 0, 'a failed resize removes the stale canvas');
  await page.evaluate(() => { window.failWordmarkBake = false; });
  await page.setViewportSize({ width: 1251, height: 900 });
  await page.locator('.home-hero-pattern[data-renderer="canvas"] canvas').waitFor();
  assert.equal((await state(page)).geometry.viewportWidth, 1251, 'a later successful resize restores correctly sized artwork');
  await context.close();

  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, hasTouch: true, reducedMotion: 'no-preference' });
  await mobile.addInitScript(() => localStorage.setItem('browserp-theme', 'dark'));
  const mobilePage = await mobile.newPage(); await mobilePage.goto(`${base}/`);
  await mobilePage.locator('.home-hero-pattern[data-renderer="canvas"] canvas').waitFor();
  await mobilePage.locator('.public-nav-v6 > .navigation-brand-v6 img').waitFor();
  const mobileFirst = await state(mobilePage); await mobilePage.waitForTimeout(800);
  const mobileSecond = await state(mobilePage);
  near((mobileSecond.rows[0].x - mobileFirst.rows[0].x) / ((mobileSecond.time - mobileFirst.time) / 1000), 2.5, 'phone viewport retains the same diagonal speed');
  assert.ok(mobileSecond.rows.every(row => row.x === mobileSecond.rows[0].x));
  assert.equal(mobileSecond.pixels[0], Math.ceil(mobileSecond.geometry.viewportWidth * 3));
  assert.equal(mobileSecond.brandState, 'running');
  assert.ok(await mobilePage.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'the decorative pattern creates no phone overflow');
  await mobile.close();

  const reduced = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  await reduced.addInitScript(() => localStorage.setItem('browserp-theme', 'dark'));
  const reducedPage = await reduced.newPage(); await reducedPage.goto(`${base}/`);
  await reducedPage.locator('.home-hero-pattern[data-renderer="canvas"] canvas').waitFor();
  await reducedPage.locator('.public-nav-v6 > .navigation-brand-v6 img').waitFor();
  const staticFrame = await state(reducedPage); await reducedPage.waitForTimeout(200);
  assert.equal(staticFrame.planeX, 0);
  assert.equal(staticFrame.brandName, 'none'); assert.equal(staticFrame.haloName, 'none'); assert.equal(staticFrame.cyanName, 'none');
  assert.ok(staticFrame.rows.every(row => row.x === 0 && row.scale === 1 && row.opacity === 0));
  assert.equal((await state(reducedPage)).time, staticFrame.time, 'reduced motion schedules no continuing renderer frames');
  await reduced.close();
} finally { await browser.close(); }

console.log(JSON.stringify({ engine, status: 'passed', profiles: ['desktop motion', 'mobile DPR 3 motion', 'mobile reduced motion'] }));
