(() => {
  "use strict";
  const make = (tag, text, className = "") => {
    const element = document.createElement(tag);
    if (text !== undefined) element.textContent = String(text);
    if (className) element.className = className;
    return element;
  };
  const date = (value) => {
    const parsed = new Date(value);
    return value && !Number.isNaN(parsed.getTime()) ? new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(parsed) : "—";
  };
  function localDate(value) {
    if (!value) return "";
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return "";
    return new Date(parsed.getTime() - parsed.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  }
  const button = (text, primary = false) => {
    const element = make("button", text, `button-v3 ${primary ? "button-primary-v3" : "button-secondary-v3"}`);
    element.type = "button";
    return element;
  };

  function confirmAction(title, description, label) {
    return new Promise((resolve) => {
      const dialog = make("dialog", undefined, "staff-dialog-v3 publishing-dialog-v6");
      const form = make("form", undefined, "staff-dialog-card-v3");
      form.method = "dialog";
      const heading = make("h2", title); heading.id = "publishing-confirm-title";
      dialog.setAttribute("aria-labelledby", heading.id);
      const cancel = button("Cancel"); const confirm = button(label, true); confirm.type = "submit";
      const actions = make("div", undefined, "publishing-actions-v6"); actions.append(cancel, confirm);
      form.append(heading, make("p", description), actions); dialog.append(form); document.body.append(dialog);
      let finished = false;
      const finish = (result) => { if (finished) return; finished = true; dialog.close(); dialog.remove(); resolve(result); };
      cancel.addEventListener("click", () => finish(false));
      dialog.addEventListener("cancel", (event) => { event.preventDefault(); finish(false); });
      form.addEventListener("submit", (event) => { event.preventDefault(); finish(true); });
      dialog.showModal(); cancel.focus();
    });
  }

  function field(name, labelText, options = {}) {
    const wrapper = make("label", undefined, `field-v3 ${options.wide ? "publishing-wide-v6" : ""}`);
    const control = make(options.type === "textarea" ? "textarea" : options.type === "select" ? "select" : "input");
    if (control.tagName === "INPUT") control.type = options.type || "text";
    control.name = name; control.required = options.required !== false;
    for (const key of ["minLength", "maxLength", "pattern", "placeholder", "rows"]) if (options[key] !== undefined) control[key] = options[key];
    if (options.choices) for (const [value, label] of options.choices) { const option = make("option", label); option.value = value; control.append(option); }
    wrapper.append(make("span", labelText), control);
    if (options.help) wrapper.append(make("small", options.help, "publishing-help-v6"));
    return { wrapper, control };
  }

  function editorSection(kind, api) {
    const isBlog = kind === "blog";
    const noun = isBlog ? "article" : "announcement";
    const endpoint = `/api/admin/${isBlog ? "blogs" : "announcements"}`;
    const panel = make("section", undefined, "publishing-panel-v6");
    panel.id = `overview-${isBlog ? "blogs" : "announcements"}`;
    const head = make("div", undefined, "publishing-section-head-v6");
    const heading = make("h3", isBlog ? "Blog posts" : "Announcements");
    const create = button(isBlog ? "Write an article" : "New announcement", true);
    head.append(heading, create);
    const intro = make("p", isBlog ? "Write a guide or import a text file. Published articles appear on the Blog page." : "Share an update across the website. Schedule its start and end, or publish it straight away.", "publishing-copy-v6");
    const list = make("div", undefined, "publishing-list-v6");
    const listStatus = make("p", "Loading…", "publishing-status-v6"); listStatus.setAttribute("role", "status");
    const retry = button("Retry loading"); retry.hidden = true;
    const form = make("form", undefined, "publishing-form-v6"); form.hidden = true;
    const editorTitle = make("h4", `New ${noun}`);
    const editNotice = make("p", "", "publishing-copy-v6"); editNotice.hidden = true;
    const grid = make("div", undefined, "publishing-fields-v6");
    const controls = {};
    const add = (name, label, options) => { const item = field(name, label, options); controls[name] = item.control; grid.append(item.wrapper); };
    add("title", "Title", { minLength: 3, maxLength: isBlog ? 140 : 120, wide: true });
    if (isBlog) {
      add("slug", "Page address", { minLength: 3, maxLength: 160, pattern: "[a-z0-9-]{3,160}", help: "Lowercase letters, numbers and hyphens. Example: choosing-your-first-server", wide: true });
      add("excerpt", "Short introduction", { type: "textarea", minLength: 20, maxLength: 400, rows: 3, wide: true, help: "20–400 characters. Shown on the Blog page." });
      const upload = field("upload", "Import an article", { type: "file", required: false, wide: true, help: "Markdown (.md) or text (.txt), up to 64 KB. Import fills the editor; it does not publish." });
      upload.control.accept = ".md,.txt,text/plain,text/markdown"; controls.upload = upload.control; grid.append(upload.wrapper);
      add("body", "Article text", { type: "textarea", minLength: 80, maxLength: 20000, rows: 14, wide: true, help: "80–20,000 characters. Use # or ## for headings, blank lines for paragraphs and - for lists. HTML is not supported." });
      add("seoTitle", "Search result title", { minLength: 10, maxLength: 160, help: "10–160 characters." });
      add("seoDescription", "Search result description", { type: "textarea", minLength: 40, maxLength: 300, rows: 3, help: "40–300 characters." });
    } else {
      add("body", "Announcement text", { type: "textarea", minLength: 1, maxLength: 1000, rows: 5, wide: true, help: "Up to 1,000 characters of plain text." });
      add("level", "Appearance", { type: "select", choices: [["info", "Information"], ["success", "Good news"], ["warning", "Important update"]] });
      add("startsAt", "Start (your local time)", { type: "datetime-local", required: false, help: "Leave blank to start when published." });
      add("endsAt", "End (your local time)", { type: "datetime-local", required: false, help: "Leave blank to keep it visible until archived." });
    }
    add("reason", "Reason for this change", { type: "textarea", minLength: 5, maxLength: 500, rows: 2, wide: true, help: "5–500 characters. Saved in the staff audit log." });
    const preview = make("details", undefined, "publishing-preview-v6");
    const previewContent = make("article", undefined, "publishing-preview-content-v6 prose-v3");
    preview.append(make("summary", isBlog ? "Preview article" : "Preview announcement"), previewContent);
    const actions = make("div", undefined, "publishing-actions-v6");
    const save = button("Save draft"); save.type = "submit"; save.name = "action"; save.value = "save";
    const publish = button(isBlog ? "Publish article" : "Publish announcement", true); publish.type = "submit"; publish.name = "action"; publish.value = "publish";
    const archive = button("Archive"); archive.hidden = true;
    const cancel = button("Close editor");
    actions.append(save, publish, archive, cancel);
    const formStatus = make("p", "", "publishing-status-v6"); formStatus.setAttribute("role", "status");
    form.append(editorTitle, editNotice, grid, preview, actions, formStatus);
    panel.append(head, intro, listStatus, retry, list, form);
    let current = null; let busy = false; let dirty = false; let items = [];
    window.addEventListener("beforeunload", (event) => {
      if (dirty && panel.isConnected) { event.preventDefault(); event.returnValue = ""; }
    });
    const status = (message, error = false) => { formStatus.textContent = message; formStatus.dataset.error = String(error); };
    const setBusy = (value) => { busy = value; panel.setAttribute("aria-busy", String(value)); panel.querySelectorAll("button,input,textarea,select").forEach((element) => { element.disabled = value; }); };
    function renderPreview() {
      previewContent.replaceChildren(make("h2", controls.title.value.trim() || "Untitled"));
      if (isBlog) {
        previewContent.append(make("p", controls.excerpt.value, "publishing-preview-intro-v6"));
        const body = make("div"); window.BrowseRPContent.renderArticle(body, controls.body.value); previewContent.append(body);
      } else {
        previewContent.dataset.level = controls.level.value;
        previewContent.append(make("p", controls.body.value));
      }
    }
    function renderList() {
      list.replaceChildren(...items.map((item) => {
        const row = make("article", undefined, "publishing-item-v6");
        const copy = make("div"); copy.append(make("strong", item.title), make("span", `Updated ${date(item.updatedAt)}`, "publishing-help-v6"));
        const itemState = make("span", item.status, "publishing-state-v6"); itemState.dataset.state = item.status;
        const edit = button("Edit"); edit.setAttribute("aria-label", `Edit ${item.title}`); edit.addEventListener("click", () => openEditor(item));
        const itemActions = make("div", undefined, "publishing-item-actions-v6"); itemActions.append(itemState, edit);
        if (isBlog && item.status === "published") { const view = make("a", "View", "button-v3 button-quiet-v3"); view.href = `/blog/${encodeURIComponent(item.slug)}`; itemActions.append(view); }
        if (!isBlog && item.status === "published") copy.append(make("small", `${item.startsAt && new Date(item.startsAt) > new Date() ? "Scheduled" : item.endsAt && new Date(item.endsAt) <= new Date() ? "Ended" : "Live"} · ${date(item.startsAt)}${item.endsAt ? ` to ${date(item.endsAt)}` : " onwards"}`, "publishing-help-v6"));
        row.append(copy, itemActions); return row;
      }));
      listStatus.textContent = items.length ? `${items.length} ${isBlog ? "article" : "announcement"}${items.length === 1 ? "" : "s"}` : `No ${isBlog ? "articles" : "announcements"} yet. Create your first ${noun} when you are ready.`;
      listStatus.dataset.error = "false";
    }
    async function refresh() {
      retry.hidden = true;
      try { const payload = await api(endpoint); items = payload[isBlog ? "posts" : "announcements"] || []; renderList(); return true; }
      catch (error) { listStatus.textContent = `Unable to load ${isBlog ? "articles" : "announcements"}: ${error.message}`; listStatus.dataset.error = "true"; retry.hidden = false; return false; }
    }
    async function discardChanges() {
      return !dirty || await confirmAction("Discard unsaved changes?", "Your current changes have not been saved. Close this editor and discard them?", "Discard changes");
    }
    async function openEditor(item = null) {
      if (busy || !await discardChanges()) return;
      current = item; form.reset(); dirty = false;
      for (const [name, control] of Object.entries(controls)) {
        if (name === "upload" || name === "reason") continue;
        control.value = ["startsAt", "endsAt"].includes(name) ? localDate(item?.[name]) : item?.[name] || (name === "level" ? "info" : "");
      }
      editorTitle.textContent = item ? `Edit ${noun}` : `New ${noun}`;
      save.textContent = item?.status === "published" ? "Move to draft" : "Save draft";
      editNotice.hidden = item?.status !== "published";
      editNotice.textContent = "This is published. Publish to apply your changes, or move it to draft to remove it from the public website.";
      archive.hidden = !item || item.status === "archived";
      status(""); renderPreview(); form.hidden = false; controls.title.focus();
    }
    function payload(action) {
      const value = { id: current?.id || null, action };
      for (const [name, control] of Object.entries(controls)) if (name !== "upload") value[name] = control.value.trim();
      if (!isBlog) {
        value.expectedVersion = current?.version ?? null;
        for (const name of ["startsAt", "endsAt"]) value[name] = value[name] ? new Date(value[name]).toISOString() : null;
      }
      return value;
    }
    async function submit(action) {
      if (busy) return;
      if (action === "archive") {
        if (!controls.reason.reportValidity()) return;
      } else {
        if (!form.reportValidity()) return;
        if (/<\/?[a-z][^>]*>/i.test(controls.body.value)) { status("Use plain text or Markdown without HTML.", true); controls.body.focus(); return; }
        if (!isBlog && controls.endsAt.value && new Date(controls.endsAt.value) <= new Date(controls.startsAt.value || Date.now())) { status("Choose an end time after the start time.", true); controls.endsAt.focus(); return; }
      }
      const titles = { publish: `Publish this ${noun}?`, archive: `Archive this ${noun}?`, save: `Move this ${noun} to draft?` };
      const descriptions = { publish: isBlog ? "This article will be available to everyone on the Blog page." : "This announcement will appear across the website during its scheduled dates.", archive: "This removes it from the public website. Its content and audit history are kept.", save: "This saves your changes as a draft and removes the current version from the public website." };
      setBusy(true);
      if ((action !== "save" || current?.status === "published") && !await confirmAction(titles[action], descriptions[action], action === "publish" ? "Publish" : action === "archive" ? "Archive" : "Move to draft")) { setBusy(false); return; }
      status("Saving…");
      try {
        const data = payload(action);
        const response = await api(endpoint, { method: "POST", body: JSON.stringify(data) });
        dirty = false;
        const savedId = response.result?.id || current?.id;
        const refreshed = await refresh();
        if (refreshed) current = items.find((item) => item.id === savedId) || null;
        else if (savedId) current = { ...current, ...data, id: savedId, status: action === "publish" ? "published" : action === "archive" ? "archived" : "draft", version: response.result?.version ?? current?.version };
        controls.reason.value = "";
        archive.hidden = !current || current.status === "archived";
        save.textContent = current?.status === "published" ? "Move to draft" : "Save draft";
        editNotice.hidden = current?.status !== "published";
        editNotice.textContent = "This is published. Publish to apply your changes, or move it to draft to remove it from the public website.";
        editorTitle.textContent = `Edit ${noun}`;
        status(`${isBlog ? "Article" : "Announcement"} ${action === "publish" ? "published" : action === "archive" ? "archived" : "saved as a draft"}.${refreshed ? "" : " Saved successfully, but the list could not refresh. Retry loading before editing again."}`);
      } catch (error) { status(error.message, true); }
      finally { setBusy(false); }
    }
    form.addEventListener("submit", (event) => { event.preventDefault(); submit(event.submitter?.value || "save"); });
    form.addEventListener("input", () => { dirty = true; renderPreview(); });
    archive.addEventListener("click", () => submit("archive"));
    cancel.addEventListener("click", async () => { if (!busy && await discardChanges()) { form.hidden = true; dirty = false; create.focus(); } });
    create.addEventListener("click", () => openEditor()); retry.addEventListener("click", refresh);
    if (isBlog) {
      controls.title.addEventListener("blur", () => {
        if (!controls.slug.value && !current) controls.slug.value = window.BrowseRPContent.slugify(controls.title.value);
        if (!controls.seoTitle.value) controls.seoTitle.value = controls.title.value;
      });
      controls.excerpt.addEventListener("blur", () => { if (!controls.seoDescription.value) controls.seoDescription.value = controls.excerpt.value.slice(0, 300); });
      controls.upload.addEventListener("change", async () => {
        const file = controls.upload.files?.[0]; if (!file) return;
        try {
          const text = await window.BrowseRPContent.importArticle(file);
          if (controls.body.value && !await confirmAction("Replace article text?", "The imported file will replace the text currently in your editor. Other fields will stay the same.", "Replace text")) return;
          controls.body.value = text; dirty = true; renderPreview(); status(`Imported ${file.name}. Review the article and save when ready.`);
        } catch (error) { status(error.message, true); }
        finally { controls.upload.value = ""; }
      });
    }
    return { panel, refresh };
  }

  async function init({ api, permissions = {} } = {}) {
    const root = document.querySelector("#overview-publishing");
    if (!root || root.dataset.initialized === "true" || typeof api !== "function") return;
    root.dataset.initialized = "true";
    root.classList.add("publishing-v6");
    const heading = make("div", undefined, "publishing-heading-v6");
    const title = make("div"); title.append(make("span", "Share with your community", "eyebrow-v3"), make("h2", "Publishing"));
    const view = make("a", "View the Blog page ↗", "button-v3 button-quiet-v3"); view.href = "/blog";
    heading.append(title, view); root.replaceChildren(heading);
    const panels = [];
    for (const [kind, allowed] of [["blog", permissions.manageBlogs], ["announcement", permissions.manageAnnouncements]]) {
      if (!allowed) continue;
      const section = editorSection(kind, api); panels.push(section); root.append(section.panel);
    }
    if (!panels.length) root.append(make("p", "Your role does not have access to publishing. Ask a staff administrator if you need to manage articles or announcements.", "publishing-copy-v6"));
    await Promise.allSettled(panels.map((section) => section.refresh()));
  }
  window.BrowseRPStaffPublishing = Object.freeze({ init });
})();
