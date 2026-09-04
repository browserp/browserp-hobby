import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";

const source = file => readFileSync(new URL(`../public/${file}.js`, import.meta.url), "utf8");
const settle = async () => { for (let i = 0; i < 4; i += 1) await new Promise(resolve => setImmediate(resolve)); };

for (const kind of ["blog", "announcement", "advert"]) {
  test(`${kind} warns only for unsaved edits, retains the warning after save failure, and clears it after save or discard`, async t => {
    const dom = new JSDOM('<main><section id="overview-publishing"></section><section id="overview-adverts"></section></main>', { url: "https://browserp.test/staffpanel/overview", runScripts: "outside-only" });
    const w = dom.window; t.after(() => w.close());
    w.HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
    w.HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
    const $ = selector => w.document.querySelector(selector);
    const click = text => { const button = [...w.document.querySelectorAll("button")].find(element => element.textContent === text); assert.ok(button, text); button.click(); };
    const guarded = () => { const event = new w.Event("beforeunload", { cancelable: true }); w.dispatchEvent(event); return event.defaultPrevented; };
    let fail = true; const posts = [];
    const api = async (_path, options = {}) => {
      if (options.method === "POST") { posts.push(JSON.parse(options.body)); if (fail) throw new Error("Synthetic save failure"); return { result: { id: "saved-fixture", version: 2 } }; }
      return { posts: [], announcements: [], adverts: [] };
    };
    w.eval(source("publishing-content"));
    w.eval(source(kind === "advert" ? "staff-adverts" : "staff-publishing"));
    if (kind === "advert") await w.BrowseRPStaffAdverts.init({ api, permissions: { manageAdverts: true } });
    else await w.BrowseRPStaffPublishing.init({ api, permissions: { manageBlogs: kind === "blog", manageAnnouncements: kind === "announcement" } });
    assert.equal(guarded(), false);
    click({ blog: "Write an article", announcement: "New announcement", advert: "Create advert" }[kind]); await settle();
    assert.equal(guarded(), false, "Opening a clean editor is not an unsaved change");
    const form = $(kind === "advert" ? ".adverts-form" : ".publishing-form-v6");
    const values = kind === "advert" ? { name: "Fixture campaign", placement: "top", headline: "A reviewed headline", body: "A welcoming community and a new campaign.", ctaLabel: "Explore", destinationUrl: "/servers", reason: "Review this draft" } : { title: "Fixture article", slug: "fixture-article", excerpt: "An introduction to this synthetic article.", body: "This synthetic article contains enough text to verify that unsaved drafts stay protected during navigation.", seoTitle: "A guide to the fixture community", seoDescription: "This is a synthetic description used for safe draft validation.", reason: "Review this draft", level: "info" };
    for (const [name, value] of Object.entries(values)) { const field = form.querySelector(`[name="${name}"]`); if (field) { field.value = value; field.dispatchEvent(new w.Event("input", { bubbles: true })); } }
    assert.equal(guarded(), true);
    const save = () => form.dispatchEvent(new w.SubmitEvent("submit", { cancelable: true, bubbles: true, submitter: form.querySelector('button[value="save"]') }));
    save(); await settle();
    assert.equal(posts.length, 1); assert.match(form.textContent, /Synthetic save failure/);
    assert.equal(guarded(), true, "A failed save cannot remove draft protection");
    fail = false; save(); await settle();
    assert.equal(posts.length, 2); assert.equal(guarded(), false, "A successful draft save no longer warns");
    const field = form.querySelector(kind === "advert" ? '[name="headline"]' : '[name="title"]');
    field.value = "Another unsaved change"; field.dispatchEvent(new w.Event("input", { bubbles: true }));
    assert.equal(guarded(), true);
    click("Close editor"); await settle();
    $("dialog").dispatchEvent(new w.Event("cancel", { cancelable: true })); await settle();
    assert.equal(guarded(), true); assert.equal(field.value, "Another unsaved change");
    click("Close editor"); await settle();
    $("dialog form").dispatchEvent(new w.Event("submit", { bubbles: true, cancelable: true })); await settle();
    assert.equal(form.hidden, true); assert.equal(guarded(), false, "Explicit discard clears protection");
  });
}
