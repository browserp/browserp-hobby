import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";

const source = readFileSync(new URL("../public/staffpanel-v3.js", import.meta.url), "utf8");
const instrumented = source.replace(
  /\n  init\(\);\n\}\)\(\);\s*$/,
  "\n  window.__staffSubmissionTest = { permissionOverrides, saveStaffAccess, savePermission, saveAdvert, saveBlog };\n})();"
);
assert.notEqual(instrumented, source, "staff submission handlers should be exposed only inside this test");

const json = (value, status = 200) => ({ ok: status < 400, status, json: async () => value });
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};
const tick = () => new Promise((resolve) => setImmediate(resolve));

function harness(t, markup, fetcher) {
  const dom = new JSDOM(`<p id="staff-status-v3" role="status"></p>${markup}`, {
    url: "https://browserp.test/staffpanel/content",
    runScripts: "outside-only"
  });
  t.after(() => dom.window.close());
  dom.window.fetch = fetcher;
  dom.window.eval(instrumented);
  return {
    w: dom.window,
    actions: dom.window.__staffSubmissionTest,
    form: dom.window.document.querySelector("form"),
    status: () => dom.window.document.querySelector("#staff-status-v3").textContent
  };
}

function event(form, submitter) {
  return { preventDefault() {}, currentTarget: form, submitter };
}

test("staff access submissions lock once and restore the original control states after failure", async (t) => {
  const request = deferred(); const calls = [];
  const h = harness(t, `<form>
    <input name="discordUserId" value="staff-123">
    <select name="roleKey"><option value="moderator" selected>Moderator</option></select>
    <select name="action"><option value="assign" selected>Assign</option></select>
    <input name="expectedVersion" value="4">
    <textarea name="reason">Launch coverage</textarea>
    <button type="submit">Apply</button>
    <button type="button" disabled>Unavailable action</button>
  </form>`, async (path, options) => { calls.push({ path, options }); return request.promise; });

  const originalDisabled = h.form.querySelector("button[disabled]");
  const first = h.actions.saveStaffAccess(event(h.form));
  const duplicate = h.actions.saveStaffAccess(event(h.form));
  assert.equal(calls.length, 1);
  assert.equal(h.form.getAttribute("aria-busy"), "true");
  assert.ok([...h.form.elements].every((control) => control.disabled));
  assert.match(h.status(), /Applying staff access change/);
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    discordUserId: "staff-123", roleKey: "moderator", action: "assign",
    expectedVersion: 4, reason: "Launch coverage"
  });

  request.resolve(json({ error: "Staff record changed. Reload and try again." }, 409));
  await Promise.all([first, duplicate]);
  assert.equal(h.form.hasAttribute("aria-busy"), false);
  assert.equal(h.form.elements.discordUserId.disabled, false);
  assert.equal(originalDisabled.disabled, true);
  assert.match(h.status(), /Staff record changed/);
});

for (const scenario of [
  { name: "advert", method: "saveAdvert", path: "/api/admin/adverts", value: "activate", progress: /Publishing advert/, fields: `<input name="name" value="Launch"><input name="headline" value="Welcome"><button name="action" value="save">Save</button><button name="action" value="activate">Publish</button>` },
  { name: "blog", method: "saveBlog", path: "/api/admin/blogs", value: "publish", progress: /Publishing article/, fields: `<input name="title" value="Launch guide"><input name="slug" value="launch-guide"><button name="action" value="save">Save</button><button name="action" value="publish">Publish</button>` }
]) {
  test(`${scenario.name} publishing keeps the chosen action, blocks duplicates and recovers after failure`, async (t) => {
    const request = deferred(); const calls = [];
    const h = harness(t, `<form>${scenario.fields}</form>`, async (path, options) => { calls.push({ path, options }); return request.promise; });
    const submitter = [...h.form.querySelectorAll("button")].find((button) => button.value === scenario.value);

    const first = h.actions[scenario.method](event(h.form, submitter));
    const duplicate = h.actions[scenario.method](event(h.form, submitter));
    assert.equal(calls.length, 1);
    assert.equal(calls[0].path, scenario.path);
    assert.equal(JSON.parse(calls[0].options.body).action, scenario.value);
    assert.equal(h.form.getAttribute("aria-busy"), "true");
    assert.ok([...h.form.elements].every((control) => control.disabled));
    assert.match(h.status(), scenario.progress);

    request.resolve(json({ error: "Publishing service unavailable." }, 503));
    await Promise.all([first, duplicate]);
    assert.equal(h.form.hasAttribute("aria-busy"), false);
    assert.ok([...h.form.elements].every((control) => !control.disabled));
    assert.match(h.status(), /Publishing service unavailable/);
  });
}

test("legacy permission saving cannot run overlapping batches and becomes editable after an error", async (t) => {
  const request = deferred(); const calls = [];
  const h = harness(t, `<form>
    <select id="permission-user"><option value="staff-123" selected>Staff member</option></select>
    <select data-permission="servers.edit"><option value="true" selected>Allow</option></select>
    <textarea name="reason">Cover launch queue</textarea>
    <button type="submit">Save overrides</button>
  </form>`, async (path, options) => { calls.push({ path, options }); return request.promise; });

  const first = h.actions.savePermission(event(h.form));
  const duplicate = h.actions.savePermission(event(h.form));
  assert.equal(calls.length, 1);
  assert.equal(h.form.getAttribute("aria-busy"), "true");
  assert.match(h.status(), /Saving permission overrides/);
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    discordUserId: "staff-123", permissionKey: "servers.edit", allowed: true, reason: "Cover launch queue"
  });

  request.resolve(json({ error: "Permission update failed." }, 503));
  await Promise.all([first, duplicate]);
  assert.equal(h.form.hasAttribute("aria-busy"), false);
  assert.ok([...h.form.elements].every((control) => !control.disabled));
  assert.match(h.status(), /Permission update failed/);
});

test("the consolidated permission editor also exposes busy state and rejects duplicate submits", async (t) => {
  const mutation = deferred(); const calls = [];
  const h = harness(t, `<form id="permission-form-v3">
    <select id="permission-user"></select>
    <div id="permission-grid-v3"></div>
    <textarea name="reason">Cover launch queue</textarea>
    <button type="submit">Save overrides</button>
  </form>`, async (path, options = {}) => {
    calls.push({ path, options });
    if (path === "/api/admin/staff") return json({ staff: { members: [{ userId: "user-123", discordUserId: "staff-123", displayName: "Sam", roleKey: "moderator", roleName: "Moderator" }] } });
    if (path === "/api/admin/permissions" && options.method === "GET") return json({ control: { permissions: [{ key: "servers.edit", description: "Edit servers", delegatable: true }], overrides: [] } });
    return mutation.promise;
  });
  await h.actions.permissionOverrides();
  h.form.querySelector("[data-permission]").value = "true";

  h.form.dispatchEvent(new h.w.Event("submit", { bubbles: true, cancelable: true }));
  h.form.dispatchEvent(new h.w.Event("submit", { bubbles: true, cancelable: true }));
  assert.equal(calls.filter(({ options }) => options.method === "POST").length, 1);
  assert.equal(h.form.getAttribute("aria-busy"), "true");
  assert.ok([...h.form.elements].every((control) => control.disabled));

  mutation.resolve(json({ error: "Permission update failed." }, 503));
  await tick();
  assert.equal(h.form.hasAttribute("aria-busy"), false);
  assert.ok([...h.form.elements].every((control) => !control.disabled));
  assert.match(h.form.querySelector('[role="status"]').textContent, /retry to finish the remaining changes/i);
});
