import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";

const css = ["browserp-v3.css", "product-polish.css", "navigation.css", "theme.css"]
  .map(name => readFileSync(new URL(`../public/${name}`, import.meta.url), "utf8"));

for (const theme of ["dark", "light"]) test(`${theme} theme switches control surfaces with labels and preserves other transitions`, t => {
  const dom = new JSDOM('<button class="navigation-toggle-v6">Menu</button><button class="navigation-close-v6">Close</button><section class="cookie-prompt-v3"><button class="button-v3 button-secondary-v3">Accept recommendations</button><button class="button-v3 button-secondary-v3">Reject recommendations</button></section>');
  t.after(() => dom.window.close());
  const { document } = dom.window;
  for (const source of css) { const style = document.createElement("style"); style.textContent = source; document.head.append(style); }
  document.documentElement.dataset.theme = theme;
  const style = element => dom.window.getComputedStyle(element);
  const controls = [...document.querySelectorAll("button")];
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
  assert.equal(root.getPropertyValue("--panel").trim(), theme === "light" ? "#fffdfd" : "#111116", "existing surface colours are unchanged");
  assert.equal(root.getPropertyValue("--text").trim(), theme === "light" ? "#211922" : "#fffaff", "existing label colours are unchanged");
});
