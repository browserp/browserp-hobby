import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";

const source = readFileSync(new URL("../public/owner-badge.js", import.meta.url), "utf8");
const tick = () => new Promise(resolve => setImmediate(resolve));

function harness(t, clipboard) {
  const dom = new JSDOM("<!doctype html><body></body>", { url: "https://www.browserp.com/dashboard", runScripts: "outside-only" });
  t.after(() => dom.window.close());
  if (clipboard !== undefined) Object.defineProperty(dom.window.navigator, "clipboard", { configurable: true, value: clipboard });
  dom.window.HTMLDialogElement.prototype.showModal = function showModal() { this.open = true; };
  dom.window.HTMLDialogElement.prototype.close = function close() { this.open = false; this.dispatchEvent(new dom.window.Event("close")); };
  dom.window.eval(source);
  return dom.window;
}

test("badge snippets use the canonical listing URL, unchanged logo, visible fixed label and escaped owner text", t => {
  const w = harness(t);
  const snippets = w.BrowseRPOwnerBadge.createSnippets("county-rp", 'County "RP" & <Friends> [EU]');
  assert.equal(snippets.listingUrl, "https://www.browserp.com/server/county-rp");
  const fragment = w.document.createRange().createContextualFragment(snippets.html);
  const link = fragment.querySelector("a"), image = link.querySelector("img"), label = link.querySelector("span");
  assert.equal(fragment.children.length, 1);
  assert.equal(link.getAttribute("href"), snippets.listingUrl);
  assert.equal(link.getAttribute("aria-label"), 'County "RP" & <Friends> [EU] is listed on BrowseRP');
  assert.match(link.getAttribute("style"), /display:inline-flex/); assert.match(link.getAttribute("style"), /max-width:100%/); assert.match(link.getAttribute("style"), /background:#fff/); assert.match(link.getAttribute("style"), /color:#211922/);
  assert.equal(image.getAttribute("src"), "https://www.browserp.com/assets/browserp-logo-v5.png?v=20260908");
  assert.equal(image.getAttribute("width"), "180"); assert.equal(image.getAttribute("alt"), ""); assert.equal(image.getAttribute("aria-hidden"), "true"); assert.match(image.getAttribute("style"), /max-width:100%/);
  assert.equal(label.textContent, "Listed on BrowseRP"); assert.match(label.getAttribute("style"), /font:600 13px\/1\.3/);
  assert.doesNotMatch(snippets.html, /<Friends>/);
  assert.equal(snippets.markdown, '[![County "RP" & <Friends> \\[EU\\] is listed on BrowseRP](https://www.browserp.com/assets/browserp-logo-v5.png?v=20260908)](https://www.browserp.com/server/county-rp)\n\n[**Listed on BrowseRP**](https://www.browserp.com/server/county-rp)');
  assert.doesNotMatch(`${snippets.html}\n${snippets.markdown}`, /verified|quality guarantee|recommended|safe community/i);
});

test("only a published listing with a strict safe slug receives a badge action", t => {
  const w = harness(t);
  const badge = w.BrowseRPOwnerBadge;
  assert.equal(badge.validSlug("county-rp"), "county-rp");
  for (const slug of ["", "County-RP", " county-rp", "county/rp", "county--rp", "a".repeat(101)]) assert.equal(badge.validSlug(slug), "");
  assert.equal(badge.createAction({ slug: "county-rp", status: "draft", serverName: "County RP" }), null);
  assert.equal(badge.createAction({ slug: "county/rp", status: "published", serverName: "County RP" }), null);
  assert.equal(badge.createAction({ slug: "county-rp", status: "published", serverName: "County RP" }).textContent, "Get owner badge");
});

test("the dialog keeps owner markup inert and copies HTML only after the copy click", async t => {
  const writes = [];
  const w = harness(t, { writeText: async value => writes.push(value) });
  const action = w.BrowseRPOwnerBadge.createAction({ slug: "county-rp", status: "published", serverName: '<img src=x onerror="alert(1)"> & Friends' });
  w.document.body.append(action);
  assert.deepEqual(writes, []);
  action.click();
  const dialog = w.document.querySelector(".owner-badge-dialog");
  assert.equal(dialog.open, true);
  assert.equal(dialog.getAttribute("aria-labelledby"), dialog.querySelector("h2").id);
  assert.match(dialog.querySelector("h2").textContent, /<img src=x onerror="alert\(1\)"> & Friends/);
  assert.equal(dialog.querySelector("h2 img"), null);
  assert.equal(dialog.querySelectorAll("img").length, 1);
  const preview = dialog.querySelector(".owner-badge-preview");
  assert.equal(preview.textContent, "Listed on BrowseRP"); assert.equal(preview.querySelector("img").getAttribute("src"), "https://www.browserp.com/assets/browserp-logo-v5.png?v=20260908");
  assert.equal(preview.getAttribute("aria-label"), '<img src=x onerror="alert(1)"> & Friends is listed on BrowseRP');
  assert.equal(preview.target, "_blank"); assert.equal(preview.rel, "noopener noreferrer"); assert.match(preview.getAttribute("style"), /max-width:100%/);
  const html = dialog.querySelector('[data-owner-badge-code="html"]');
  dialog.querySelector('[data-owner-badge-copy="html"]').click();
  await tick();
  assert.deepEqual(writes, [html.value]);
  assert.equal(dialog.querySelector("[data-owner-badge-status]").textContent, "HTML copied.");
});

test("clipboard failure selects the exact snippet and explains the manual fallback", async t => {
  const w = harness(t, { writeText: async () => { throw new Error("Permission denied"); } });
  const action = w.BrowseRPOwnerBadge.createAction({ slug: "county-rp", status: "published", serverName: "County RP" });
  w.document.body.append(action); action.click();
  const dialog = w.document.querySelector(".owner-badge-dialog");
  const markdown = dialog.querySelector('[data-owner-badge-code="markdown"]');
  dialog.querySelector('[data-owner-badge-copy="markdown"]').click();
  await tick();
  assert.equal(w.document.activeElement, markdown);
  assert.equal(markdown.selectionStart, 0);
  assert.equal(markdown.selectionEnd, markdown.value.length);
  assert.match(dialog.querySelector("[data-owner-badge-status]").textContent, /Select the code above and copy it manually/);
});
