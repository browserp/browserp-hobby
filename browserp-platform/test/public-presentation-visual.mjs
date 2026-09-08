// Bounded public presentation check. Start test/visual-fixture.mjs first.
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const engines = await import(pathToFileURL(resolve(process.argv[2], "index.mjs")).href);
const browserName = process.env.BROWSERP_BROWSER || "chromium";
const browser = await engines[browserName].launch({ headless: true });
const base = process.env.BROWSERP_VISUAL_URL || "http://127.0.0.1:4189";
const cases = browserName === "chromium"
  ? [["desktop", 1366, 900, false], ["phone", 390, 700, false], ["narrow", 320, 640, false], ["reduced", 390, 700, true]]
  : [["phone", 390, 700, false], ["narrow", 320, 640, false]];

try {
  for (const [name, width, height, reduced] of cases) {
    const context = await browser.newContext({ viewport: { width, height }, hasTouch: width <= 390, isMobile: width <= 390 && browserName !== "firefox", reducedMotion: reduced ? "reduce" : "no-preference" });
    await context.addInitScript(() => localStorage.setItem("browserp-cookie-choice-v1", "rejected"));
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(`${base}/`);
    await page.locator(".navigation-toggle-v6").click();
    const dialog = page.locator("#public-navigation");
    await assert.doesNotReject(dialog.waitFor({ state: "visible" }));
    await dialog.locator('[data-theme-choice-v6="light"]').scrollIntoViewIfNeeded();
    await dialog.locator('[data-theme-choice-v6="light"]').click();
    assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), "light");
    assert.equal(await page.evaluate(() => localStorage.getItem("browserp-theme")), "light");
    assert.equal(await dialog.locator('[data-theme-choice-v6="light"]').getAttribute("aria-pressed"), "true");
    assert.equal(await dialog.locator('[data-theme-choice-v6="dark"]').getAttribute("aria-pressed"), "false");
    await page.waitForFunction(() => getComputedStyle(document.querySelector(".navigation-link-v6")).backgroundColor === "rgb(255, 253, 253)");
    const menuLayout = await dialog.evaluate(element => {
      const box = element.getBoundingClientRect(), close = element.querySelector(".navigation-close-v6").getBoundingClientRect();
      return { fits: box.left >= 0 && box.right <= innerWidth && box.top >= 0 && box.bottom <= innerHeight, closeFits: close.left >= 0 && close.right <= innerWidth && close.top >= 0 && close.bottom <= innerHeight, scrollable: element.querySelector(".navigation-scroll-v6").scrollHeight >= element.querySelector(".navigation-scroll-v6").clientHeight };
    });
    assert.equal(menuLayout.fits, true); assert.equal(menuLayout.closeFits, true); assert.equal(menuLayout.scrollable, true);
    const menuColours = await dialog.evaluate(element => ({ link: getComputedStyle(element.querySelector(".navigation-link-v6")).backgroundColor, game: getComputedStyle(element.querySelector(".navigation-game-v6")).backgroundColor, account: getComputedStyle(element.querySelector(".account-trigger-v3")).backgroundColor, roblox: getComputedStyle(element.querySelector('[data-platform="roblox"]')).color }));
    assert.deepEqual(menuColours, { link: "rgb(255, 253, 253)", game: "rgb(255, 253, 253)", account: "rgb(255, 253, 253)", roblox: "rgb(57, 64, 82)" });
    if (reduced) assert.equal(await page.locator(".public-nav-v6 > .navigation-brand-v6 img").evaluate(element => getComputedStyle(element).animationName), "none");
    await page.screenshot({ path: `test/public-presentation-${browserName}-${name}-light-menu.png`, fullPage: false });
    await page.locator(".navigation-close-v6").click();

    await page.goto(`${base}/servers`);
    assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), "light", "appearance persists across public pages");
    await page.locator(".server-card").first().waitFor();
    await page.waitForFunction(() => getComputedStyle(document.body).backgroundColor === "rgb(248, 245, 248)" && getComputedStyle(document.querySelector(".server-card")).backgroundColor === "rgb(255, 253, 253)");
    const light = await page.evaluate(() => {
      const body = getComputedStyle(document.body), card = getComputedStyle(document.querySelector(".server-card"));
      return { body: body.backgroundColor, text: body.color, card: card.backgroundColor, themeLink: Boolean(document.querySelector('link[data-public-theme]')), overflow: document.documentElement.scrollWidth > innerWidth };
    });
    assert.equal(light.themeLink, true); assert.equal(light.overflow, false);
    assert.match(light.body, /rgb\(248, 245, 248\)/); assert.match(light.text, /rgb\(33, 25, 34\)/); assert.match(light.card, /rgb\(255, 253, 253\)/);

    await page.goto(`${base}/server/preview-community-0`);
    await page.locator(".comment-v3").first().waitFor();
    assert.equal(await page.locator(".comment-v3").count(), 2);
    assert.equal(await page.locator('.comment-badge-v3[data-kind="server_owner"]').textContent(), "Server owner");
    assert.equal(await page.locator('.comment-badge-v3[data-kind="staff"]').textContent(), "Moderator");
    assert.equal(await page.locator(".comment-parent-v3").count(), 1);
    assert.equal(await page.locator(".comment-edited-v3").count(), 1);
    await page.locator(".comment-reply-v3").nth(1).click();
    const replyContext = page.locator(".comment-reply-context-v3");
    assert.match(await replyContext.textContent(), /Replying to Alex Rivers/);
    assert.equal(await page.locator('#comment-form-v3 input[name="parentCommentId"]').inputValue(), "44444444-4444-4444-8444-444444444444");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.locator(".server-comments-v7").screenshot({ path: `test/public-presentation-${browserName}-${name}-comments.png` });
    assert.deepEqual(errors, []);
    console.log(`${browserName} ${name}: menu, local light theme, narrow layout and comment reply presentation passed`);
    await context.close();
  }
} finally { await browser.close(); }
