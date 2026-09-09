import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";

const read = file => readFileSync(new URL(`../public/${file}`, import.meta.url), "utf8");
// Match the server page's real stylesheet order, including its later overrides.
const files = ["browserp-v3.css", "public-layout.css", "product-polish.css", "server-imports.css", "server-detail.css"];

function styles({ width, reduced = false, coarse = false, forced = false, page = "server" }) {
  const source = new JSDOM("<head></head>");
  const output = [];
  const applies = condition => condition.split(",").some(branch => {
    if ([...branch.matchAll(/min-width:\s*(\d+)px/g)].some(match => width < Number(match[1]))) return false;
    if ([...branch.matchAll(/max-width:\s*(\d+)px/g)].some(match => width > Number(match[1]))) return false;
    if (/max-height:\s*740px/.test(branch)) return false;
    if (/prefers-reduced-motion:\s*reduce\)/.test(branch) && !reduced) return false;
    if (/prefers-reduced-motion:\s*no-preference/.test(branch) && reduced) return false;
    if (/forced-colors:\s*active/.test(branch) && !forced) return false;
    if (/hover:\s*none|pointer:\s*coarse/.test(branch) && !coarse) return false;
    if (/hover:\s*hover|pointer:\s*fine/.test(branch) && coarse) return false;
    return true;
  });
  const collect = rules => {
    for (const rule of rules) {
      if (rule.type === 4) { if (applies(rule.conditionText)) collect(rule.cssRules); }
      else if (rule.type === 1) {
        // jsdom has no pseudo-element layout. Represent decorations as inert
        // children to exercise the complete selector cascade, not screenshots.
        const selector = rule.selectorText.replaceAll("::before", " > .fixture-face").replaceAll("::after", " > .fixture-chevron")
          .replaceAll(":hover", ".fixture-hover").replaceAll(":active", ".fixture-active").replaceAll(":focus-visible", ".fixture-focus");
        output.push(`${selector} { ${rule.style.cssText} }`);
      }
    }
  };
  const pageFiles = page === "home" ? [...files.slice(0, 3), "homepage.css"] : files;
  for (const file of pageFiles) {
    const style = source.window.document.createElement("style");
    style.textContent = read(file); source.window.document.head.append(style); collect(style.sheet.cssRules);
  }
  source.window.close();
  return output.join("\n");
}

const buttons = () => `<button type="button" class="ad-arrow-v3 ad-arrow-previous-v3" aria-label="Previous advert" data-ad-direction="previous">‹<span class="fixture-face" aria-hidden="true"></span><span class="fixture-chevron" aria-hidden="true"></span></button>
  <button type="button" class="ad-arrow-v3 ad-arrow-next-v3" aria-label="Next advert" data-ad-direction="next">›<span class="fixture-face" aria-hidden="true"></span><span class="fixture-chevron" aria-hidden="true"></span></button>`;

function harness(t, options) {
  const dom = new JSDOM(`<style>${styles(options)}</style><body data-page="${options.page || "server"}">
    <div class="content-with-rail-v3"><aside id="directory-ad" class="side-ad-v3"><div class="side-ad-stage-v3">${buttons()}</div></aside><div>Results</div></div>
    <aside id="banner-ad" class="side-ad-v3 banner-ad-v7"><div class="side-ad-stage-v3"><img class="side-ad-image-v3" alt=""><div class="side-ad-copy-v3"><strong>Put your community in front of roleplayers</strong><span>Personalised picture placements are reviewed before they go live.</span><a href="/advertise">Advertise here</a></div>${buttons()}</div></aside>
    <main id="server-detail-v3" class="server-page-v7"><aside id="server-ad" class="side-ad-v3 server-ad-rail-v7"><div class="side-ad-stage-v3">${buttons()}</div></aside></main>`);
  t.after(() => dom.window.close());
  return { doc: dom.window.document, css: element => dom.window.getComputedStyle(element) };
}

test("desktop and mobile advert arrows retain 44px targets around smaller rounded-square faces", t => {
  for (const width of [390, 768, 1280, 1920]) {
    const h = harness(t, { width, coarse: width < 768 });
    for (const button of h.doc.querySelectorAll(".ad-arrow-v3")) {
      const host = h.css(button), face = h.css(button.querySelector(".fixture-face"));
      for (const property of ["width", "height", "minWidth", "minHeight"]) assert.equal(host[property], "44px", `${width}px ${button.closest("aside").id} ${property}`);
      assert.equal(host.fontSize, "0px", "The text glyph is visually replaced, not duplicated");
      assert.equal(host.backgroundColor, "rgba(0, 0, 0, 0)");
      assert.equal(host.borderTopWidth, "0px");
      assert.equal(face.inset, "6px");
      assert.equal(44 - 2 * Number.parseFloat(face.inset), 32, "The visual face is 32px inside the unchanged tap target");
      assert.equal(face.borderRadius, "7px");
      assert.equal(face.pointerEvents, "none");
      assert.equal(h.css(button.querySelector(".fixture-chevron")).pointerEvents, "none");
    }
  }
});

test("CSS chevrons have distinct directions while native labelled buttons stay clickable", t => {
  const h = harness(t, { width: 1280 });
  const previous = h.doc.querySelector('[data-ad-direction="previous"]'), next = h.doc.querySelector('[data-ad-direction="next"]');
  assert.equal(h.css(previous.querySelector(".fixture-chevron")).transform, "rotate(-135deg)");
  assert.equal(h.css(next.querySelector(".fixture-chevron")).transform, "rotate(45deg)");
  for (const button of [previous, next]) {
    const chevron = h.css(button.querySelector(".fixture-chevron"));
    assert.equal(chevron.width, "7px"); assert.equal(chevron.height, "7px");
    assert.equal(chevron.borderTopWidth, "1.5px"); assert.equal(chevron.borderRightWidth, "1.5px");
    assert.equal(button.type, "button"); assert.equal(button.tabIndex, 0);
    assert.match(button.getAttribute("aria-label"), /^(Previous|Next) advert$/);
    let clicks = 0; button.addEventListener("click", () => clicks++); button.click(); assert.equal(clicks, 1);
    button.disabled = true; button.click(); assert.equal(clicks, 1, "Native-disabled controls cannot navigate");
  }
});

test("failed-artwork controls remain in normal flow and anchor their own decoration", t => {
  for (const width of [390, 1280]) {
    const h = harness(t, { width });
    for (const aside of h.doc.querySelectorAll("aside")) {
      aside.classList.add("artwork-unavailable");
      for (const button of aside.querySelectorAll(".ad-arrow-v3")) {
        const style = h.css(button);
        assert.equal(style.position, "relative", `${aside.id} anchors its own face`);
        for (const property of ["top", "left", "right"]) assert.equal(style[property], "auto", `${aside.id} ${property}`);
        assert.equal(style.marginTop, "0px");
      }
    }
  }
});

test("page banners clear the sticky rail offset and reserve mobile copy and control rows", t => {
  for (const width of [320, 390, 760, 761, 1280]) {
    const h = harness(t, { width, coarse: width < 768 });
    const banner = h.doc.querySelector("#banner-ad"), stage = banner.querySelector(".side-ad-stage-v3");
    const copy = banner.querySelector(".side-ad-copy-v3"), image = banner.querySelector(".side-ad-image-v3");
    const previous = banner.querySelector(".ad-arrow-previous-v3"), next = banner.querySelector(".ad-arrow-next-v3");
    const mobile = width <= 760;
    assert.equal(h.css(banner).position, "relative");
    assert.equal(h.css(banner).top, "auto", `${width}px banner must not inherit the rail's 96px offset`);
    // The accepted mobile repair lets long copy size the stage above the controls.
    // These are cascade checks; actual wrapping/overlap is covered by browser QA.
    assert.equal(h.css(stage).height, mobile ? "auto" : "190px");
    assert.equal(h.css(stage).minHeight, mobile ? "210px" : "0px");
    assert.equal(h.css(stage).maxHeight, mobile ? "none" : "190px");
    assert.equal(h.css(image).position, "absolute");
    assert.equal(h.css(image).width, "100%");
    assert.equal(h.css(image).height, "100%");
    assert.equal(h.css(image).objectFit, "cover");
    assert.equal(h.css(copy).position, mobile ? "relative" : "absolute");
    if (mobile) {
      assert.equal(h.css(stage).display, "grid");
      assert.equal(h.css(stage).gridTemplateColumns, "minmax(0,1fr) minmax(0,1fr)");
      assert.equal(h.css(copy).gridColumn, "1 / -1");
      assert.equal(h.css(copy).gridRow, "1");
      assert.equal(h.css(copy).minWidth, "0px");
      assert.equal(h.css(previous).gridColumn, "1");
      assert.equal(h.css(next).gridColumn, "2");
      assert.equal(h.css(next).justifySelf, "end");
    }
    for (const button of [previous, next]) {
      assert.equal(h.css(button).position, mobile ? "relative" : "absolute");
      assert.equal(h.css(button).top, mobile ? "auto" : "50%");
      if (mobile) {
        assert.equal(h.css(button).gridRow, "2");
        for (const property of ["left", "right"]) assert.equal(h.css(button)[property], "auto");
        assert.equal(h.css(button).marginTop, "0px");
      }
    }
    banner.classList.add("artwork-unavailable");
    assert.equal(h.css(stage).height, "auto");
    assert.equal(h.css(stage).minHeight, "0px");
    assert.equal(h.css(stage).maxHeight, "none");
    assert.equal(h.css(stage).display, "grid");
    assert.equal(h.css(stage).gridTemplateColumns, mobile ? "86px minmax(0,1fr)" : "120px minmax(0,1fr) 44px 44px");
    assert.equal(h.css(image).visibility, "hidden");
    assert.equal(h.css(copy).position, "static");
    assert.equal(h.css(copy).gridColumn, "2");
    assert.equal(h.css(copy).gridRow, "1");
    assert.equal(h.css(previous).gridColumn, mobile ? "1" : "3");
    assert.equal(h.css(next).gridColumn, mobile ? "2" : "4");
    for (const button of [previous, next]) assert.equal(h.css(button).gridRow, mobile ? "2" : "1");
  }
});

test("Home retains its separate artwork and copy columns instead of the page banner repair", t => {
  for (const width of [390, 1280]) {
    const h = harness(t, { width, page: "home" });
    const banner = h.doc.querySelector("#banner-ad"), stage = banner.querySelector(".side-ad-stage-v3");
    const copy = banner.querySelector(".side-ad-copy-v3"), image = banner.querySelector(".side-ad-image-v3");
    assert.equal(h.css(stage).gridTemplateColumns, width <= 760 ? "minmax(0, 1fr) minmax(0, 1.5fr)" : "180px minmax(0, 1fr)");
    assert.equal(h.css(stage).minHeight, "0px");
    assert.equal(h.css(copy).position, "static");
    assert.notEqual(h.css(copy).gridColumn, "1 / -1");
    assert.notEqual(h.css(image).position, "absolute");
    for (const button of banner.querySelectorAll(".ad-arrow-v3")) assert.notEqual(h.css(button).gridRow, "2");
  }
});

test("keyboard focus is visible and reduced motion stops press scaling without hiding chevrons", t => {
  for (const reduced of [false, true]) {
    const h = harness(t, { width: 390, coarse: true, reduced });
    for (const button of h.doc.querySelectorAll(".ad-arrow-v3")) {
      button.classList.add("fixture-focus", "fixture-active");
      const host = h.css(button), face = h.css(button.querySelector(".fixture-face"));
      // jsdom does not resolve custom properties in outline shorthand longhands.
      assert.match(host.outline, /^2px solid /);
      assert.ok(!host.transform || host.transform === "none", "Interaction never scales the tap target");
      assert.equal(face.transform, reduced ? "none" : "scale(.94)");
      if (reduced) assert.equal(face.transition, "none");
      assert.notEqual(h.css(button.querySelector(".fixture-chevron")).transform, "none", "Directional rotation remains meaningful under reduced motion");
    }
  }
});
