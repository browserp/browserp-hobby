// Isolated local browser verification. Only synthetic fixture writes are allowed.
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(pathToFileURL(process.argv[2]).href);
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const origin = 'http://127.0.0.1:4189';
try {
  for (const [width, height, touch, theme] of [[1440,1000,false,'dark'],[2503,1222,false,'dark'],[768,1024,true,'dark'],[390,844,true,'dark'],[320,740,true,'dark']]) {
    const context = await browser.newContext({ viewport:{width,height},isMobile:touch,hasTouch:touch,reducedMotion:'reduce' });
    const page = await context.newPage(), errors=[];
    page.on('pageerror', error => errors.push(error.message));
    const fits = async label => assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`${label} overflow at ${width}`);
    await page.goto(origin+'/servers');
    const tools = page.locator('.server-shortlist-actions');
    await tools.first().locator('[data-shortlist-save]:enabled').waitFor();
    assert.equal(await page.locator('a.server-card button').count(),0);
    await tools.first().locator('[data-shortlist-save]').click();
    await tools.first().locator('[data-shortlist-save][aria-pressed="true"]').waitFor();
    await tools.first().locator('[data-shortlist-save]').click();
    await tools.first().locator('[data-shortlist-save][aria-pressed="false"]').waitFor();
    for(let i=0;i<3;i++) await tools.nth(i).locator('[data-shortlist-compare]').click();
    await tools.nth(3).locator('[data-shortlist-compare]').click();
    assert.match(await page.locator('[data-shortlist-status]').innerText(),/up to three/);
    await fits('directory');
    await tools.first().locator('[data-shortlist-open]').click();
    await page.waitForURL('**/compare?servers=*');
    await page.locator('#compare-results[aria-busy="false"] .compare-server-name').first().waitFor();
    assert.equal(await page.locator('.compare-server-name').count(),3);
    await fits('comparison');
    await page.evaluate(()=>scrollTo(0,0));
    await page.screenshot({path:`test/navigation-stability-phase-compare-${width}.png`,fullPage:true});
    await page.getByRole('button',{name:'Remove Preview Community 2 from comparison',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('#compare-count').textContent==='2 of 3 selected');
    await page.getByRole('button',{name:'Clear all',exact:true}).click();
    await page.locator('#compare-empty:not([hidden])').waitFor();
    await page.goto(origin+'/find-server');
    await page.locator('input[name="platform"][value="fivem"]').check();
    await page.getByRole('button',{name:'Continue',exact:true}).click();
    await page.locator('input[name="region"][value="United Kingdom"]').check();
    await page.getByRole('button',{name:'Continue',exact:true}).click();
    await page.locator('input[name="access"][value="whitelisted"]').check();
    await page.getByRole('button',{name:'Continue',exact:true}).click();
    await page.locator('input[name="feature"][value="economy"]').check();
    await fits('finder');
    await page.evaluate(()=>scrollTo(0,0));
    await page.screenshot({path:`test/navigation-stability-phase-finder-${width}.png`,fullPage:true});
    await page.getByRole('button',{name:'Show servers',exact:true}).click();
    await page.waitForURL('**/servers?*');
    const query=new URL(page.url()).searchParams;
    assert.equal(query.get('platform'),'fivem'); assert.equal(query.get('region'),'United Kingdom'); assert.equal(query.get('access'),'whitelisted'); assert.equal(query.get('feature'),'economy');
    await page.goto(origin+'/server/preview-community-0');
    await page.locator('.shortlist-detail-v9 [data-shortlist-save]:enabled').waitFor();
    await fits('detail');
    assert.deepEqual(errors,[]);
    console.log(JSON.stringify({width,height,touch,theme,save:'pass',compare:'pass',finder:'pass',detail:'pass',errors}));
    await context.close();
  }
} finally { await browser.close(); }
