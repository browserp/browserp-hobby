// Optional local-only Chrome check; pass an installed Playwright package path.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)(process.argv[2] || "playwright");
const browser = await chromium.launch({ channel: "chrome", headless: true });
try {
  for (const width of [1366, 390]) {
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.goto("http://127.0.0.1:4189/servers");
    await page.locator(".server-card .platform-badge-v5").first().waitFor();
    assert.equal(await page.locator(".platform-badge-v5 svg").count(), 0);
    await page.locator("#directory-search").fill("five");
    const choice = page.getByRole("option", { name: "Game FiveM", exact: true });
    await choice.waitFor();
    const geometry = await choice.evaluate(row => {
      const label = row.querySelector(".search-suggestion-kind-v3"), value = row.querySelector("strong");
      const r = row.getBoundingClientRect(), l = label.getBoundingClientRect(), v = value.getBoundingClientRect();
      return { background: getComputedStyle(label).backgroundColor, labelWidth: l.width, labelEnd: l.right, valueStart: v.left, valueEnd: v.right, rowEnd: r.right, width: r.width };
    });
    assert.equal(geometry.background, "rgba(0, 0, 0, 0)");
    assert.ok(geometry.labelWidth < 70, "Game category is not stretched into a bar");
    assert.ok(geometry.labelEnd <= geometry.valueStart && geometry.valueEnd <= geometry.rowEnd, "Category and value fit without overlap");
    await page.locator("#directory-search-suggestions").screenshot({ path: `test/navigation-stability-game-label-${width}.png` });
    await choice.click();
    assert.equal(await page.locator("#platform-filter").inputValue(), "fivem");
    await page.getByRole("button", { name: "Open menu", exact: true }).click();
    assert.equal(await page.locator(".navigation-game-v6 svg").count(), 0);
    assert.equal(await page.locator(".navigation-game-v6").count(), 4);
    await page.getByRole("button", { name: "Close menu", exact: true }).click();
    await page.goto("http://127.0.0.1:4189/server/preview-community-0");
    await page.getByRole("heading", { name: "Preview Community 1", exact: true }).waitFor();
    assert.equal(await page.locator(".platform-badge-v5 svg").count(), 0);
    assert.ok(await page.locator(".platform-badge-v5").count() >= 2);
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ viewport: width, status: "passed", geometry, badges: "text only", menu: "4 text game links", selection: "fivem" }));
    await page.close();
  }
} finally { await browser.close(); }
