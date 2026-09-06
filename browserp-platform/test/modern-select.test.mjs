import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";

const script = readFileSync(new URL("../public/modern-select.js", import.meta.url), "utf8");
const markup = '<form><label><span>Region</span><select name="region" required><option value="">Choose a region</option><option value="uk" selected>United Kingdom</option><option value="us">United States</option><option value="ca" disabled>Canada</option><optgroup label="Europe"><option value="de">Germany</option></optgroup></select></label><button type="submit">Save</button></form>';
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

async function setup({ html = markup, coarse = false, popover = true, staff = false } = {}) {
  const dom = new JSDOM(`<body${staff ? ' data-staff-page="people"' : ""}>${html}</body>`, { url: "https://browserp.test/profile", runScripts: "outside-only" });
  const w = dom.window;
  const media = new w.EventTarget(); media.matches = !coarse;
  w.matchMedia = () => media;
  if (popover) {
    w.HTMLElement.prototype.showPopover = function () { this.dataset.open = "true"; };
    w.HTMLElement.prototype.hidePopover = function () { this.dataset.open = "false"; };
  }
  w.HTMLElement.prototype.getBoundingClientRect = () => ({ x: 20, y: 60, left: 20, top: 60, right: 320, bottom: 108, width: 300, height: 48 });
  w.eval(script);
  await settle();
  return { dom, w, media, select: w.document.querySelector("select"), button: w.document.querySelector(".modern-select-trigger"), popup: w.document.querySelector(".modern-select-popup") };
}

test("enhanced select retains its original label, native form data and input/change events", async () => {
  const { dom, w, select, button, popup } = await setup();
  try {
    assert.equal(select.parentElement.tagName, "LABEL");
    assert.equal(button.getAttribute("aria-label"), "Region");
    assert.equal(button.textContent, "United Kingdom");
    assert.equal(new w.FormData(w.document.querySelector("form")).get("region"), "uk");
    const events = [];
    select.addEventListener("input", () => events.push("input"));
    select.addEventListener("change", () => events.push("change"));
    button.click();
    assert.equal(button.getAttribute("aria-expanded"), "true");
    popup.querySelector('[data-index="2"]').click();
    assert.equal(select.value, "us");
    assert.deepEqual(events, ["input", "change"]);
    assert.equal(button.textContent, "United States");
    assert.equal(w.document.activeElement, button);
    assert.equal(button.getAttribute("aria-expanded"), "false");
  } finally { dom.window.close(); }
});

test("keyboard navigation skips disabled options, supports typeahead and cancels with Escape", async () => {
  const { dom, w, select, button } = await setup();
  try {
    const key = value => button.dispatchEvent(new w.KeyboardEvent("keydown", { key: value, bubbles: true, cancelable: true }));
    button.focus(); key("ArrowDown"); key("ArrowDown"); key("Enter");
    assert.equal(select.value, "de");
    key("Home"); key("Escape");
    assert.equal(select.value, "de", "Escape leaves the saved value unchanged");
    key("u");
    assert.equal(select.value, "uk");
    key("u");
    assert.equal(select.value, "us", "Repeated letters cycle matching options");
    button.click(); key("End"); key("Enter");
    assert.equal(select.value, "de");
    assert.equal(button.hasAttribute("aria-activedescendant"), false);
  } finally { dom.window.close(); }
});

test("dynamic search options and programmatic selected values refresh the open picker", async () => {
  const { dom, w, select, button, popup } = await setup();
  try {
    button.click();
    select.replaceChildren(new w.Option("All regions", "all"), new w.Option("France", "fr"), new w.Option("United Kingdom", "uk"));
    select.value = "fr";
    await settle();
    assert.equal(button.textContent, "France");
    assert.equal(popup.querySelectorAll('[role="option"]').length, 3);
    assert.equal(popup.querySelector('[aria-selected="true"]').textContent, "France");
    select.options[2].disabled = true;
    await settle();
    popup.querySelector('[data-index="2"]').click();
    assert.equal(select.value, "fr");
    const dynamic = w.document.createElement("select"); dynamic.append(new w.Option("Added later", "later"));
    w.document.body.append(dynamic);
    await settle();
    assert.equal(w.document.querySelectorAll(".modern-select-trigger").length, 2);
    dynamic.remove();
    await settle();
    assert.equal(w.document.querySelectorAll(".modern-select-popup").length, 1);
  } finally { dom.window.close(); }
});

test("required validation, disabled fieldsets and form reset keep native semantics", async () => {
  const { dom, w, select, button } = await setup();
  try {
    const form = select.form;
    select.value = ""; select.dispatchEvent(new w.Event("change", { bubbles: true }));
    assert.equal(form.checkValidity(), false);
    assert.equal(button.getAttribute("aria-invalid"), "true");
    assert.equal(w.document.activeElement, button);
    select.value = "de"; select.dispatchEvent(new w.Event("change", { bubbles: true }));
    assert.equal(button.hasAttribute("aria-invalid"), false);
    form.reset(); await settle();
    assert.equal(select.value, "uk"); assert.equal(button.textContent, "United Kingdom");
    const fieldset = w.document.createElement("fieldset");
    form.prepend(fieldset); fieldset.append(select.parentElement); fieldset.disabled = true;
    await settle();
    assert.equal(button.disabled, true);
    assert.equal(new w.FormData(form).has("region"), false);
    fieldset.disabled = false; await settle();
    assert.equal(button.disabled, false);
  } finally { dom.window.close(); }
});

test("outside clicks close the top-layer picker without stealing focus", async () => {
  const { dom, w, button, popup } = await setup();
  try {
    button.click();
    assert.equal(popup.getAttribute("popover"), "auto");
    assert.equal(popup.style.width, "300px");
    assert.equal(popup.style.left, "20px");
    button.getBoundingClientRect = () => ({ left: 980, right: 1280, top: 740, bottom: 788, width: 300, height: 48 });
    Object.defineProperty(popup, "scrollHeight", { value: 220 });
    w.dispatchEvent(new w.Event("resize"));
    assert.equal(popup.style.left, "712px", "The picker is clamped inside the right edge");
    assert.equal(popup.style.top, "514px", "The picker opens above a control near the bottom edge");
    w.document.querySelector('[type="submit"]').dispatchEvent(new w.Event("pointerdown", { bubbles: true }));
    assert.equal(button.getAttribute("aria-expanded"), "false");
  } finally { dom.window.close(); }
});

test("mobile, unsupported browsers, staff, multi-selects and explicit opt-outs stay native", async () => {
  for (const settings of [{ coarse: true }, { popover: false }, { staff: true }, { html: '<select multiple><option>One</option></select><select size="3"><option>One</option></select><select data-native-select><option>One</option></select>' }]) {
    const { dom, w } = await setup(settings);
    try { assert.equal(w.document.querySelectorAll(".modern-select-trigger").length, 0); }
    finally { dom.window.close(); }
  }
});

test("changing to a touch viewport restores native control attributes and removes the popup", async () => {
  const { dom, w, select, button, media } = await setup();
  try {
    button.click(); media.matches = false; media.dispatchEvent(new w.Event("change")); await settle();
    assert.equal(select.parentElement.tagName, "LABEL");
    assert.equal(select.hasAttribute("tabindex"), false);
    assert.equal(select.hasAttribute("aria-hidden"), false);
    assert.equal(w.document.querySelectorAll(".modern-select,.modern-select-popup").length, 0);
    media.matches = true; media.dispatchEvent(new w.Event("change")); await settle();
    assert.equal(w.document.querySelectorAll(".modern-select-trigger").length, 1);
  } finally { dom.window.close(); }
});
