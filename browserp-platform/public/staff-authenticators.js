(function () {
  "use strict";
  let active;
  const make = (tag, text, className) => { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (className) node.className = className; return node; };
  const button = (text, primary = false) => { const node = make("button", text, `button-v3 ${primary ? "button-primary-v3" : "button-secondary-v3"}`); node.type = "button"; return node; };
  function field(text, input) { const node = make("label", undefined, "field-v3"); node.append(make("span", text), input); return node; }
  function codeInput() { const input = make("input"); input.name = "code"; input.inputMode = "numeric"; input.autocomplete = "one-time-code"; input.pattern = "[0-9]{6}"; input.maxLength = 6; input.required = true; return input; }

  function init({ api } = {}) {
    const root = document.querySelector("#overview-authenticators");
    if (!root || typeof api !== "function") return null;
    active?.destroy();
    const content = root.querySelector("[data-authenticators-content]");
    const state = { factors: [], canAdd: false, busy: false, destroyed: false, generation: 0 };
    const feedback = make("p", "", "staff-form-status-v3"); feedback.setAttribute("role", "status");
    const tools = make("div", undefined, "staff-authenticator-tools");
    const editor = make("div", undefined, "staff-authenticator-editor");
    content.replaceChildren(make("p", "Keep a backup authenticator on another device or in a secure password manager. You will need a working code from another authenticator before removing one."), tools, editor, feedback);
    const say = text => { feedback.textContent = text; };
    const clearEditor = () => { editor.querySelectorAll("input").forEach(input => { input.value = ""; }); editor.querySelectorAll("img").forEach(image => image.removeAttribute("src")); editor.replaceChildren(); };
    function busy(value) {
      state.busy = value; content.setAttribute("aria-busy", String(value));
      content.querySelectorAll("button,input,select").forEach(element => { element.disabled = value; });
    }
    function accept(payload) {
      const data = payload?.authenticators;
      if (!data || !Array.isArray(data.factors)) throw new Error("Authenticators could not be loaded. Please refresh.");
      state.factors = data.factors; state.canAdd = data.canAdd === true;
      render();
    }
    async function run(action, pending, done) {
      if (state.busy || state.destroyed) return;
      const generation = state.generation;
      busy(true); say(pending);
      try {
        const payload = await action();
        if (state.destroyed || generation !== state.generation || !root.open) return;
        done(payload);
      } catch (error) {
        if (!state.destroyed && generation === state.generation && root.open) {
          say(error.message || "This change could not be completed. Refresh and try again.");
          if (!tools.childElementCount) { const retry = button("Refresh authenticators"); retry.addEventListener("click", () => { void load(); }); tools.append(retry); }
        }
      }
      finally {
        if (!state.destroyed) {
          busy(false);
          if (generation !== state.generation && root.open) void load();
        }
      }
    }
    const post = body => api("/api/admin/authenticators", { method: "POST", body: JSON.stringify(body) });
    function closeForm() { clearEditor(); render(); say(""); }
    function editForm(heading, description, submitText, onSubmit) {
      clearEditor();
      const form = make("form", undefined, "staff-form-v3");
      const fields = make("div", undefined, "staff-authenticator-fields");
      const actions = make("div", undefined, "staff-authenticator-actions");
      const submit = button(submitText, true); submit.type = "submit";
      const cancel = button("Cancel"); cancel.addEventListener("click", closeForm);
      actions.append(submit, cancel); form.append(make("h3", heading), make("p", description), fields, actions);
      form.addEventListener("submit", event => { event.preventDefault(); if (!state.busy && form.reportValidity()) onSubmit(form); });
      editor.append(form); return { form, fields };
    }
    function setupForm(setup) {
      const { fields } = editForm(`Verify ${setup.label}`, "Add BrowseRP to your authenticator app, then enter its current code to finish. Until you verify it, this authenticator cannot protect your account.", "Verify backup", form => {
        const value = form.elements.code.value;
        void run(() => post({ action: "verify", factorId: setup.id, code: value }), "Verifying your backup…", payload => { clearEditor(); accept(payload); say("Your backup authenticator is verified and ready to use."); });
      });
      if (typeof setup.qrCode === "string" && /^data:image\/svg\+xml(?:;base64)?,/i.test(setup.qrCode)) {
        const frame = make("div", undefined, "qr-frame-v3"); const image = make("img", undefined, "qr-v3"); image.src = setup.qrCode; image.alt = "BrowseRP backup authenticator QR code";
        image.addEventListener("error", () => { frame.replaceChildren(make("p", "Use the setup key below if the QR image does not load.")); }); frame.append(image); fields.append(frame);
      }
      if (setup.secret) {
        const reveal = button("Show setup key"); reveal.setAttribute("aria-expanded", "false"); const key = make("code", setup.secret, "secret-v3"); key.hidden = true;
        reveal.addEventListener("click", () => { key.hidden = !key.hidden; reveal.setAttribute("aria-expanded", String(!key.hidden)); reveal.textContent = key.hidden ? "Show setup key" : "Hide setup key"; }); fields.append(reveal, key);
      } else fields.append(make("p", "Use the code from the authenticator you already scanned. If you no longer have its setup key, cancel and remove this unfinished setup, then add it again."));
      const input = codeInput(); fields.append(field("Six-digit code from this backup", input)); input.focus();
    }
    function addForm() {
      const { fields } = editForm("Add a backup authenticator", "Give it a name you will recognise, such as Backup phone. Keep it separate from your main authenticator.", "Set up backup", form => {
        void run(() => post({ action: "enroll", label: form.elements.label.value }), "Preparing your backup…", payload => { accept(payload); setupForm(payload.setup); say("Scan the QR code or enter the setup key in your authenticator app."); });
      });
      const input = make("input"); input.name = "label"; input.autocomplete = "off"; input.maxLength = 40; input.minLength = 2; input.required = true; fields.append(field("Authenticator name", input)); input.focus();
    }
    function removeForm(factor) {
      const verified = factor.status === "verified";
      const alternatives = state.factors.filter(item => item.id !== factor.id && item.status === "verified");
      if (verified && !alternatives.length) { say("Add and verify a backup before removing your last authenticator."); return; }
      const { fields } = editForm(`Remove ${factor.label}?`, verified ? "Choose the authenticator you are keeping and enter its code. Make sure it is available on a different device if you are replacing your phone." : "This setup was never verified. Removing it will leave your working authenticators in place.", verified ? "Verify and remove" : "Remove unfinished setup", form => {
        const body = { action: "remove", factorId: factor.id };
        if (verified) { body.alternateFactorId = form.elements.alternate.value; body.code = form.elements.code.value; }
        void run(() => post(body), "Checking and removing the authenticator…", payload => { clearEditor(); accept(payload); say("Authenticator removed. Your other verified authenticator stays available."); });
      });
      if (verified) {
        const select = make("select"); select.name = "alternate";
        alternatives.forEach(item => { const option = make("option", item.label); option.value = item.id; select.append(option); });
        const input = codeInput(); select.addEventListener("change", () => { input.value = ""; input.focus(); }); fields.append(field("Authenticator to keep", select), field("Six-digit code from the authenticator you are keeping", input)); input.focus();
      }
    }
    function render() {
      const list = make("ul", undefined, "staff-authenticator-list");
      for (const factor of state.factors) {
        const row = make("li"); const copy = make("div"); copy.append(make("strong", factor.label), make("span", factor.status === "verified" ? "Verified" : "Setup unfinished"));
        const actions = make("div", undefined, "staff-authenticator-actions");
        if (factor.status !== "verified") { const verify = button("Finish setup"); verify.addEventListener("click", () => setupForm(factor)); actions.append(verify); }
        if (factor.status !== "verified" || state.factors.filter(item => item.status === "verified").length > 1) { const remove = button("Remove"); remove.addEventListener("click", () => removeForm(factor)); actions.append(remove); }
        else actions.append(make("small", "Keep until a backup is verified"));
        row.append(copy, actions); list.append(row);
      }
      const actions = make("div", undefined, "staff-authenticator-actions");
      if (state.canAdd) { const add = button("Add backup authenticator", true); add.addEventListener("click", addForm); actions.append(add); }
      else actions.append(make("p", "Three authenticators are already on this account. Remove an unused or unfinished one to add another."));
      const refresh = button("Refresh authenticators"); refresh.addEventListener("click", () => { clearEditor(); void load(); }); actions.append(refresh); tools.replaceChildren(list, actions);
    }
    const load = () => run(() => api("/api/admin/authenticators"), "Checking your authenticators…", payload => { accept(payload); say(""); });
    function toggle() {
      if (root.open) { if (!state.busy) void load(); }
      else { state.generation++; clearEditor(); tools.replaceChildren(); say(""); }
    }
    function leave() { clearEditor(); }
    root.addEventListener("toggle", toggle); window.addEventListener("pagehide", leave);
    const controller = { destroy() { state.destroyed = true; state.generation++; clearEditor(); tools.replaceChildren(); root.removeEventListener("toggle", toggle); window.removeEventListener("pagehide", leave); if (active === controller) active = null; } };
    active = controller; if (root.open) void load(); return controller;
  }
  window.BrowseRPStaffAuthenticators = Object.freeze({ init });
})();
