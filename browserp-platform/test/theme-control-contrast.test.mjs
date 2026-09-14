import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";

const css = ["browserp-v3.css", "product-polish.css", "navigation.css", "theme.css", "design-system.css"]
  .map(name => readFileSync(new URL(`../public/${name}`, import.meta.url), "utf8"));

for (const theme of ["dark", "light"]) test(`${theme} theme switches control surfaces with labels and preserves other transitions`, t => {
  const dom = new JSDOM('<button class="navigation-toggle-v6">Menu</button><button class="navigation-close-v6">Close</button><section class="cookie-prompt-v3"><button class="button-v3 button-secondary-v3">Accept recommendations</button><button class="button-v3 button-secondary-v3">Reject recommendations</button></section><a class="navigation-game-v6" data-platform="roblox" href="/games/roblox">Roblox</a>');
  t.after(() => dom.window.close());
  const { document } = dom.window;
  for (const source of css) { const style = document.createElement("style"); style.textContent = source; document.head.append(style); }
  document.documentElement.dataset.theme = theme;
  const style = element => dom.window.getComputedStyle(element);
  const controls = [...document.querySelectorAll("button,.navigation-game-v6")];
  for (const control of controls) {
    const properties = style(control).transitionProperty.split(",").map(value => value.trim());
    assert.ok(properties.includes("border-color"), "border feedback is retained");
    assert.ok(!properties.some(value => ["all", "color", "background", "background-color"].includes(value)), "theme contrast never passes through a mismatched background");
  }
  const consent = controls.slice(2);
  assert.equal(style(consent[0]).transitionProperty, style(consent[1]).transitionProperty);
  assert.equal(style(consent[0]).background, style(consent[1]).background);
  assert.equal(style(consent[0]).color, style(consent[1]).color);
  assert.ok(style(consent[0]).transitionProperty.includes("transform"));
  assert.ok(style(consent[0]).transitionProperty.includes("box-shadow"));
  const root = style(document.documentElement);
  const token = name => root.getPropertyValue(name).trim();
  for (const surface of ["--bg", "--panel", "--panel-2", "--control-bg", "--surface-hover", "--selection-surface"]) {
    for (const label of ["--text", "--copy", "--muted", "--cyan", "--pink", "--violet", "--danger", "--success", "--warning"]) {
      assert.ok(contrast(token(label), token(surface)) >= 4.5, `${label} on ${surface} has readable text contrast`);
    }
  }
  assert.ok(contrast(token("--control-border"), token("--control-bg")) >= 3, "field boundary remains visible");
  assert.ok(contrast(token("--violet"), token("--selection-surface")) >= 4.5, "selected controls retain readable labels");
  assert.equal(token("--brand-action-gradient").match(/#[a-f0-9]{6}/gi)?.length, 3, "action gradient exposes its three tested colour stops");
  for (const stop of token("--brand-action-gradient").match(/#[a-f0-9]{6}/gi) || []) assert.ok(contrast("#ffffff", stop) >= 4.5, "primary gradient supports white labels");
  assert.equal(root.getPropertyValue("--panel").trim(), theme === "light" ? "#ffffff" : "#171717", "neutral surface palette is applied");
  assert.equal(root.getPropertyValue("--text").trim(), theme === "light" ? "#1c1c1c" : "#f5f5f5", "neutral label palette is applied");
});

function contrast(a, b) {
  const luminance = hex => {
    assert.match(hex, /^#[a-f0-9]{6}$/i, "contrast checks use resolved palette values");
    const rgb = hex.slice(1).match(/../g).map(value => parseInt(value, 16) / 255)
      .map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
    return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
  };
  const values = [luminance(a), luminance(b)].sort((a, b) => b - a);
  return (values[0] + .05) / (values[1] + .05);
}
