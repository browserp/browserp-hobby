import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";

const css = readFileSync(new URL("../public/product-polish.css", import.meta.url), "utf8");
const marker = "/* Premium interaction detail:";
assert.ok(css.includes(marker), "The premium interaction section must remain identifiable for scoped safety checks");
const dom = new JSDOM(`<style>${css.slice(css.indexOf(marker))}</style>`);
const rules = [];
function collect(list, media = []) {
  for (const rule of list) {
    if (rule.type === 4) collect(rule.cssRules, [...media, rule.conditionText]);
    else if (rule.type === 1) rules.push({ selector: rule.selectorText, style: rule.style, media });
  }
}
collect(dom.window.document.styleSheets[0].cssRules);
dom.window.close();
const value = (rule, property) => rule.style.getPropertyValue(property).trim();
const reduced = rule => rule.media.some(condition => condition.includes("prefers-reduced-motion: reduce"));
const overlay = rules.find(rule => rule.selector.includes(".server-card:not(.server-card-skeleton)") && value(rule, "content"));

test("decorative card highlights are contained and never intercept clicks or decorate loading placeholders", () => {
  assert.ok(overlay);
  assert.equal(value(overlay, "position"), "absolute");
  assert.ok(value(overlay, "inset").split(/\s+/).every(part => /^0(?:px)?$/.test(part)), "The highlight stays within the card bounds");
  assert.equal(value(overlay, "pointer-events"), "none");
  assert.equal(value(overlay, "opacity"), "0");
  const fixture = new JSDOM(`<a class="server-card"></a><div class="server-card server-card-skeleton"></div>
    <div class="game-grid-v3"><a href="/games/fivem"></a></div><a class="game-official-card-v6"></a>`);
  try {
    const selected = [...fixture.window.document.querySelectorAll(overlay.selector.replaceAll("::after", ""))];
    assert.equal(selected.length, 3);
    assert.ok(selected.every(element => !element.classList.contains("server-card-skeleton")));
  } finally { fixture.window.close(); }
});

test("premium interaction additions do not animate document flow or create page-level transform containers", () => {
  const forbiddenProperties = new Set(["display", "width", "height", "min-width", "min-height", "max-width", "max-height", "padding", "margin", "gap", "grid-template-columns", "grid-column", "grid-row", "overflow", "isolation"]);
  for (const rule of rules) {
    for (let index = 0; index < rule.style.length; index++) {
      const property = rule.style[index];
      assert.ok(!forbiddenProperties.has(property), `${rule.selector} changes layout through ${property}`);
    }
    assert.ok(!/(?:^|[\s,])(?:html|body|main)(?:$|[\s,:.])/.test(rule.selector), `Page-wide effect: ${rule.selector}`);
    assert.ok(!/\.navigation-(?:dialog|panel|top)-v6/.test(rule.selector), "Do not transform fixed menu Close button ancestors");
  }
});

test("button sheen is one-pass, fine-pointer only, reduced-motion safe and excludes disabled controls", () => {
  const sheen = rules.find(rule => value(rule, "animation").startsWith("touch-sweep-v3"));
  assert.ok(sheen);
  const conditions = sheen.media.join(" ");
  for (const condition of ["hover: hover", "pointer: fine", "prefers-reduced-motion: no-preference"]) assert.ok(conditions.includes(condition), condition);
  assert.ok(!value(sheen, "animation").includes("infinite"));
  assert.match(value(sheen, "animation"), /\s1$/);
  const selector = sheen.selector.replaceAll("::after", "").replaceAll(":hover", ".simulate-hover").replaceAll(":focus-visible", ".simulate-keyboard");
  const fixture = new JSDOM("<body></body>");
  try {
    for (const kind of ["button-primary-v3", "button-primary", "small-button-primary"]) {
      for (const input of ["simulate-hover", "simulate-keyboard"]) {
        const button = fixture.window.document.createElement("button");
        button.className = `${kind} ${input}`;
        fixture.window.document.body.append(button);
        assert.equal(button.matches(selector), true, `${kind} ${input}`);
        button.disabled = true;
        assert.equal(button.matches(selector), false, "Native-disabled controls must not shine");
        button.disabled = false;
        button.setAttribute("aria-disabled", "true");
        assert.equal(button.matches(selector), false, "ARIA-disabled controls must not shine");
        button.remove();
      }
    }
  } finally { fixture.window.close(); }
});

test("keyboard focus receives card, menu icon and account-row feedback without relying on hover", () => {
  const focusRules = rules.filter(rule => rule.selector.includes(":focus-visible") && !reduced(rule));
  const availableWithoutHover = focusRules.filter(rule => !rule.media.some(condition => condition.includes("hover: hover")));
  assert.ok(availableWithoutHover.some(rule => rule.selector.includes(".server-card") && value(rule, "opacity") === "1"));
  assert.ok(availableWithoutHover.some(rule => rule.selector.includes(".navigation-link-icon-v6") && value(rule, "box-shadow")));
  assert.ok(availableWithoutHover.some(rule => rule.selector.includes(".account-popover-v3") && value(rule, "box-shadow")));
  assert.ok(availableWithoutHover.some(rule => rule.selector.includes(".account-danger-v3") && value(rule, "color") === "var(--danger)"));
});

test("reduced motion explicitly neutralizes each new effect at sufficient selector specificity", () => {
  const motionOff = rules.filter(reduced);
  const overlayReset = motionOff.find(rule => rule.selector.includes(".server-card") && value(rule, "transition") === "none");
  assert.ok(overlayReset);
  assert.ok(overlayReset.selector.includes(".server-card:not(.server-card-skeleton)") || overlayReset.style.getPropertyPriority("transition") === "important", "The reset must not lose to the more-specific base overlay selector");
  assert.ok(motionOff.some(rule => rule.selector.includes(".navigation-link-icon-v6") && value(rule, "transform") === "none"));
  assert.ok(motionOff.some(rule => rule.selector.includes(".button-primary-v3") && value(rule, "animation") === "none" && rule.style.getPropertyPriority("animation") === "important"));
  for (const selector of [".navigation-link-icon-v6", ".navigation-game-v6", ".account-popover-v3"]) {
    assert.ok(motionOff.some(rule => rule.selector.includes(selector) && value(rule, "transition") === "none" && value(rule, "animation") === "none"), selector);
  }
});
