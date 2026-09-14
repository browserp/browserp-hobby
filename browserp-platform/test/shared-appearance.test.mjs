import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";

const source = readFileSync(new URL("../public/browserp-v3.js", import.meta.url), "utf8");
const controllerEnd = source.indexOf("  function initials(value) {");
assert.ok(controllerEnd > 0);
const controller = source.slice(0, controllerEnd) + "})();";

for (const route of ["/profile", "/staffpanel", "/staffpanel/moderation"]) {
  test(`appearance on ${route} preserves saved choice, unsaved input and unrelated state`, t => {
    const dom = new JSDOM('<meta name="theme-color"><form><input name="draft" value="Unsaved draft"></form>', {
      url: `https://browserp.test${route}`, runScripts: "outside-only"
    });
    t.after(() => dom.window.close());
    const w = dom.window;
    if (route === "/staffpanel/moderation") w.document.body.dataset.staffPage = "moderation";
    w.localStorage.setItem("browserp-theme", "light");
    w.localStorage.setItem("browserp-compare", "fixture shortlist");
    w.document.cookie = "fixture-session=unchanged";
    let requests = 0;
    w.fetch = () => { requests++; throw new Error("Appearance must not make a network request"); };
    w.eval(controller);
    assert.equal(w.BrowseRPTheme.get(), "light");
    const input = w.document.querySelector("input");
    input.value = "Still editing";
    input.focus();
    const themes = [];
    w.addEventListener("browserp:theme-changed", event => themes.push(event.detail.theme));
    assert.equal(w.BrowseRPTheme.set("dark"), "dark");
    assert.equal(w.BrowseRPTheme.set("light"), "light");
    assert.equal(w.document.documentElement.dataset.theme, "light");
    assert.equal(w.document.documentElement.style.colorScheme, "light");
    assert.equal(w.document.querySelector("input"), input);
    assert.equal(input.value, "Still editing");
    assert.equal(w.document.activeElement, input);
    assert.equal(w.localStorage.getItem("browserp-compare"), "fixture shortlist");
    assert.equal(w.document.cookie, "fixture-session=unchanged");
    assert.equal(w.localStorage.getItem("browserp-theme"), "light");
    assert.equal(requests, 0);
    assert.deepEqual(themes, ["dark", "light"]);
    if (route.startsWith("/staffpanel")) {
      assert.equal(w.document.querySelector("link[data-public-theme]"), null,
        "shared appearance does not inject the public stylesheet into staff");
    }
  });
}
