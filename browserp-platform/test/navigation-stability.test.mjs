import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";

const read = name => readFileSync(new URL(`../public/${name}`, import.meta.url), "utf8");
const sheets = ["browserp-v3.css", "public-layout.css", "product-polish.css", "server-imports.css", "server-detail.css"];

// jsdom does not evaluate viewport media queries. Flatten the stylesheet's
// applicable width branches, then use its normal CSS cascade on the real DOM.
function stylesAtWidth(width) {
  const source = new JSDOM("<head></head>");
  const output = [];
  const activeMedia = condition => condition.split(",").some(branch => {
    if (/prefers-reduced-motion|forced-colors|hover:\s*none|pointer:\s*coarse/.test(branch)) return false;
    const minimum = [...branch.matchAll(/min-width:\s*(\d+)px/g)].every(match => width >= Number(match[1]));
    const maximum = [...branch.matchAll(/max-width:\s*(\d+)px/g)].every(match => width <= Number(match[1]));
    return minimum && maximum;
  });
  const collect = rules => {
    for (const rule of rules) {
      if (rule.type === 4) { if (activeMedia(rule.conditionText)) collect(rule.cssRules); }
      else if (rule.type === 1 || rule.type === 7) output.push(rule.cssText);
    }
  };
  for (const name of sheets) {
    const style = source.window.document.createElement("style"); style.textContent = read(name); source.window.document.head.append(style); collect(style.sheet.cssRules);
  }
  source.window.close();
  return output.join("\n");
}

function harness(t, width) {
  const dom = new JSDOM(`<style>${stylesAtWidth(width)}</style>
    <main id="server-detail-v3" class="server-page-v7"><div class="server-frame-v7">
      <aside class="side-ad-v3 server-ad-rail-v7 server-ad-left-v7" hidden></aside>
      <div class="server-content-v7">Server details</div>
      <aside class="side-ad-v3 server-ad-rail-v7 server-ad-right-v7" hidden></aside>
    </div></main>
    <div class="content-with-rail-v3 directory-layout-v3"><aside class="side-ad-v3" hidden></aside><div class="directory-main-v3">Directory results</div></div>
    <div class="content-with-rail-v3"><aside class="side-ad-v3" hidden></aside><div class="editorial-v3">Homepage editorial</div></div>`);
  t.after(() => dom.window.close());
  const doc = dom.window.document;
  return { doc, css: selector => dom.window.getComputedStyle(doc.querySelector(selector)) };
}

test("desktop server and directory content stay in the content track while adverts load", t => {
  for (const width of [1280, 1920]) {
    const h = harness(t, width);
    for (const loaded of [false, true, false]) {
      h.doc.querySelectorAll(".side-ad-v3").forEach(advert => { advert.hidden = !loaded; });
      assert.equal(h.css(".server-content-v7").gridColumn, "2", `server at ${width}, adverts ${loaded}`);
      assert.equal(h.css(".server-content-v7").gridRow, "1");
      assert.equal(h.css(".server-ad-left-v7").gridColumn, "1");
      assert.equal(h.css(".server-ad-right-v7").gridColumn, "3");
      for (const selector of [".directory-main-v3", ".editorial-v3"]) {
        assert.equal(h.css(selector).gridColumn, "2", `${selector} at ${width}, adverts ${loaded}`);
        assert.equal(h.css(selector).gridRow, "1");
      }
      assert.equal(h.css(".content-with-rail-v3 > .side-ad-v3").gridColumn, "1");
    }
  }
});

test("mobile and tablet server content reset to column one without implicit sidebar tracks", t => {
  for (const width of [390, 768, 1024]) {
    const h = harness(t, width);
    assert.equal(h.css(".server-content-v7").gridColumn, "1", `${width}px`);
    assert.equal(h.css(".server-content-v7").gridRow, "1");
    assert.equal(h.css(".server-ad-left-v7").gridColumn, "1");
    assert.equal(h.css(".server-ad-left-v7").gridRow, "2");
    h.doc.querySelector(".server-ad-right-v7").hidden = false;
    assert.equal(h.css(".server-ad-right-v7").display, "none");
    if (width <= 760) {
      assert.equal(h.css(".content-with-rail-v3").display, "flex");
      for (const selector of [".directory-main-v3", ".editorial-v3", ".content-with-rail-v3 > .side-ad-v3"]) {
        assert.equal(h.css(selector).gridColumn, "auto");
        assert.equal(h.css(selector).gridRow, "auto");
      }
    }
  }
});

test("ordinary navigation does not animate or fade the entire main element", t => {
  const h = harness(t, 1920), style = h.css("main");
  assert.ok(!style.animation || style.animation === "none", `Unexpected page-wide animation: ${style.animation}`);
  assert.ok(!style.animationName || style.animationName === "none");
  assert.notEqual(style.opacity, "0");
});
