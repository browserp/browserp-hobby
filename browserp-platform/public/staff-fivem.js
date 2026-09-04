(() => {
  "use strict";
  const make = (tag, text, className = "") => { const el = document.createElement(tag); if (text !== undefined) el.textContent = String(text); el.className = className; return el; };
  const button = (text, primary = false) => { const el = make("button", text, `button-v3 ${primary ? "button-primary-v3" : "button-secondary-v3"}`); el.type = "button"; return el; };
  const date = (value) => { const parsed = new Date(value); return value && Number.isFinite(parsed.getTime()) ? new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(parsed) + " UTC" : "Not recorded"; };
  const list = (value) => Array.isArray(value) ? value : [];
  function secureUrl(value) {
    try { if (/[\s\u0000-\u001f\u007f]/.test(String(value || ""))) return null; const url = new URL(String(value || "")); return url.protocol === "https:" && !url.username && !url.password ? url.href : null; } catch { return null; }
  }
  function parseInputs(value) {
    const inputs = [...new Set(String(value || "").trim().split(/[\s,]+/).filter(Boolean))];
    if (!inputs.length || inputs.length > 10) throw new Error("Enter between 1 and 10 Cfx join codes or Cfx links.");
    return inputs;
  }
  function confirmAction(title, text, action) {
    return new Promise((resolve) => {
      const previous = document.activeElement; const dialog = make("dialog", undefined, "fivem-confirm"); const form = make("form");
      const heading = make("h3", title); heading.id = "fivem-confirm-heading"; dialog.setAttribute("aria-labelledby", heading.id);
      const cancel = button("Cancel"); const accept = button(action, true); accept.type = "submit";
      const actions = make("div", undefined, "fivem-actions"); actions.append(cancel, accept); form.append(heading, make("p", text), actions); dialog.append(form); document.body.append(dialog);
      let settled = false;
      const finish = (value) => { if (settled) return; settled = true; dialog.close(); dialog.remove(); previous?.focus(); resolve(value); };
      cancel.addEventListener("click", () => finish(false)); dialog.addEventListener("cancel", (event) => { event.preventDefault(); finish(false); }); form.addEventListener("submit", (event) => { event.preventDefault(); finish(true); });
      dialog.showModal(); cancel.focus();
    });
  }

  async function init({ api, root, imageUrl, platform = "fivem" } = {}) {
    if (!["fivem", "redm"].includes(platform)) throw new Error("Choose FiveM or RedM.");
    const platformName = platform === "redm" ? "RedM" : "FiveM";
    const endpoint = `/api/admin/${platform}`;
    if (typeof root === "string") root = document.querySelector(root);
    if (!root || typeof api !== "function") return null;
    root.dataset.platform = platform;
    root.classList.add("staff-fivem");
    let destroyed = false; let request = 0; let items = []; let current = null; let dirty = false; let busy = false; let canManage = false; let offset = 0; let total = 0;
    const header = make("div", undefined, "fivem-heading"); const heading = make("div"); heading.append(make("span", platformName, "eyebrow-v3"), make("h2", "Import server details"), make("p", "Fetch public source information, review it, then choose what to publish. Missing details stay blank.", "fivem-help"));
    const reload = button("Reload imports"); header.append(heading, reload);
    const status = make("p", "Loading imports…", "fivem-status"); status.setAttribute("role", "status");
    const tools = make("section", undefined, "fivem-fetch"); tools.hidden = true;
    const fetchForm = make("form"); const sourceLabel = make("label", undefined, "field-v3"); const inputs = make("textarea"); inputs.name = "inputs"; inputs.rows = 3; inputs.maxLength = 3000; inputs.required = true; inputs.placeholder = "abc123\nhttps://cfx.re/join/xyz789";
    sourceLabel.append(make("span", `${platformName} join codes or Cfx links`), inputs, make("small", "Up to 10, separated by spaces, commas or new lines.", "fivem-help"));
    const fetchActions = make("div", undefined, "fivem-actions"); const fetchButton = button("Fetch for review", true); fetchButton.type = "submit"; const featuredButton = button("Find featured servers"); fetchActions.append(fetchButton); if (platform === "fivem") fetchActions.append(featuredButton); fetchForm.append(sourceLabel, fetchActions);
    const featured = make("div", undefined, "fivem-featured"); const fetchStatus = make("p", "", "fivem-status"); fetchStatus.setAttribute("role", "status"); tools.append(fetchForm, fetchStatus, featured);
    const errors = make("ul", undefined, "fivem-errors"); errors.hidden = true;
    const filterLabel = make("label", undefined, "fivem-filter"); const filter = make("select"); filter.setAttribute("aria-label", "Import status");
    for (const [value, text] of [["pending", "Needs review"], ["published", "Published"], ["dismissed", "Dismissed"], ["all", "All imports"]]) { const option = make("option", text); option.value = value; filter.append(option); } filter.value = "pending"; filterLabel.append(make("span", "Show"), filter);
    const records = make("div", undefined, "fivem-list");
    const pagination = make("div", undefined, "fivem-pagination"); const previous = button("Previous"); const next = button("Next"); const pageLabel = make("span"); pagination.append(previous, pageLabel, next);
    const editor = make("form", undefined, "fivem-editor"); editor.hidden = true; const editorHeading = make("h3", "Review import"); const sourceSummary = make("p", "", "fivem-help");
    const warnings = make("section", undefined, "fivem-warnings"); const evidence = make("details", undefined, "fivem-evidence");
    const fields = make("div", undefined, "fivem-fields"); const controls = {};
    function field(name, label, options = {}) {
      const wrapper = make("label", undefined, `field-v3${options.wide ? " fivem-wide" : ""}`); const control = make(options.type === "textarea" ? "textarea" : options.type === "select" ? "select" : "input");
      if (control.tagName === "INPUT") control.type = options.type || "text";
      control.name = name; control.required = options.required !== false;
      for (const key of ["minLength", "maxLength", "rows", "placeholder"]) if (options[key] !== undefined) control[key] = options[key];
      for (const [value, text] of options.choices || []) { const option = make("option", text); option.value = value; control.append(option); }
      wrapper.append(make("span", label), control); if (options.help) wrapper.append(make("small", options.help, "fivem-help")); fields.append(wrapper); controls[name] = control;
    }
    field("name", "Server name", { minLength: 3, maxLength: 80, wide: true });
    field("description", "Description", { type: "textarea", minLength: 40, maxLength: 3000, rows: 5, wide: true, help: "40–3,000 characters. Review source text before making it public." });
    const platformLabel = make("div", undefined, "fivem-platform"); platformLabel.append(make("span", "Platform"), make("strong", platformName)); fields.append(platformLabel);
    field("region", "Region", { minLength: 2, maxLength: 60, placeholder: "Not provided by source" });
    field("language", "Language", { minLength: 2, maxLength: 60, placeholder: "Not provided by source" });
    field("framework", "Framework / mode", { required: false, maxLength: 80, placeholder: "Unknown", help: "Leave blank if the source does not establish a framework." });
    field("accessType", "Access", { type: "select", choices: [["", "Choose access"], ["unknown", "Not confirmed"], ["public", "Public"], ["allowlisted", "Allowlisted"], ["application", "Application required"]], help: "Choose Not confirmed when source information is missing or conflicting." });
    field("discordUrl", "Discord community URL", { type: "url", required: false, maxLength: 1000, help: `A Discord invite for the community. This is separate from the ${platformName} join link.` });
    field("websiteUrl", "Community website URL", { type: "url", required: false, maxLength: 1000 });
    field("bannerUrl", "Banner image URL", { type: "url", required: false, maxLength: 1000 });
    field("logoUrl", "Server logo URL", { type: "url", required: false, maxLength: 1000 });
    field("tags", "Tags", { required: false, maxLength: 1258, help: "Up to 30 tags, 2–40 characters each, separated with commas. No links." });
    field("keywords", "Search keywords", { required: false, maxLength: 1258, help: "Up to 30 search terms, 2–40 characters each, separated with commas. No links." });
    field("reason", "Reason for publishing or changing this import", { type: "textarea", minLength: 5, maxLength: 500, rows: 2, wide: true });
    const media = make("div", undefined, "fivem-media"); const join = make("p", "", "fivem-join");
    const editActions = make("div", undefined, "fivem-actions"); const publish = button("Publish reviewed listing", true); publish.type = "submit";
    const sourceRefresh = button("Refresh live player count"); const dismiss = button("Dismiss import"); const close = button("Close review"); editActions.append(publish, sourceRefresh, dismiss, close);
    const editorStatus = make("p", "", "fivem-status"); editorStatus.setAttribute("role", "status"); editor.append(editorHeading, sourceSummary, join, warnings, evidence, fields, media, editActions, editorStatus);
    root.replaceChildren(header, status, tools, errors, filterLabel, records, pagination, editor);
    const message = (element, text, error = false) => { element.textContent = text; element.dataset.error = String(error); };
    function updatePagination() { previous.disabled = busy || offset === 0; next.disabled = busy || offset + 25 >= total; pageLabel.textContent = total ? `${offset + 1}–${Math.min(offset + items.length, total)} of ${total}` : "No imports"; }
    function setBusy(value) { busy = value; root.setAttribute("aria-busy", String(value)); root.querySelectorAll("button,input,textarea,select").forEach((el) => { el.disabled = value; }); for (const control of Object.values(controls)) control.disabled = value || !canManage; updatePagination(); }
    function renderRecords() {
      const selected = items;
      records.replaceChildren(...selected.map((item) => {
        const card = make("article", undefined, "fivem-item"); const copy = make("div"); const candidate = item.candidate || {};
        copy.append(make("strong", candidate.name || "Name not provided"), make("span", `cfx.re/join/${item.joinCode || candidate.joinCode || "Unknown"}`, "fivem-help"), make("small", `Source checked ${date(candidate.checkedAt)} · ${list(candidate.warnings).length} source warnings`, "fivem-help"));
        const actions = make("div", undefined, "fivem-actions"); const state = make("span", item.status || "Unknown", "fivem-state"); state.dataset.state = item.status;
        const review = button(canManage ? "Review" : "View source"); review.setAttribute("aria-label", `Review ${platformName} import: ${candidate.name || item.joinCode}`); review.addEventListener("click", () => open(item)); actions.append(state, review); card.append(copy, actions); return card;
      }));
      if (!selected.length) records.append(make("p", "No imports in this view.", "fivem-help"));
    }
    async function refresh() {
      const revision = ++request;
      try {
        const payload = await api(`${endpoint}?status=${encodeURIComponent(filter.value)}&offset=${offset}`); if (destroyed || revision !== request) return false;
        const workspace = payload.workspace; if (!workspace || !Array.isArray(workspace.items)) throw new Error("The import list could not be read. Please reload.");
        items = workspace.items; total = Number.isSafeInteger(workspace.total) ? workspace.total : items.length; canManage = workspace.canManage === true; tools.hidden = !canManage; renderRecords(); updatePagination();
        message(status, `${Number.isSafeInteger(workspace.total) ? workspace.total : items.length} import${workspace.total === 1 ? "" : "s"}${canManage ? " · Review source details before publishing" : " · Your role can view imports"}`); return true;
      } catch (error) { if (!destroyed && revision === request) message(status, error.message, true); return false; }
    }
    function showEvidence(candidate) {
      warnings.replaceChildren(); const entries = list(candidate.warnings); warnings.hidden = !entries.length;
      if (entries.length) { warnings.append(make("h4", "Source warnings")); const warningList = make("ul"); for (const item of entries) { const row = make("li"); row.dataset.severity = item.severity || "warning"; row.append(make("strong", item.field ? `${item.field}: ` : ""), make("span", item.message || item.code || "Review this source field.")); warningList.append(row); } warnings.append(warningList, make("p", "Check these warnings and correct the fields below before publishing.", "fivem-help")); }
      const proof = list(candidate.evidence); evidence.replaceChildren(make("summary", `Source evidence (${proof.length})`));
      const rows = make("dl", undefined, "fivem-evidence-list"); for (const item of proof) { rows.append(make("dt", item.field || "Source field"), make("dd", `${item.value === undefined || item.value === null || item.value === "" ? "Not provided" : typeof item.value === "object" ? JSON.stringify(item.value) : item.value} · Source: ${item.source || "Not recorded"}${item.confidence === undefined ? "" : ` · Confidence: ${item.confidence}`}`)); } evidence.append(rows);
      const url = secureUrl(candidate.sourceUrl); if (url) { const link = make("a", "Open original source ↗"); link.href = url; link.target = "_blank"; link.rel = "noopener noreferrer"; evidence.append(link); }
    }
    function renderMedia() {
      media.replaceChildren();
      for (const [name, label] of [["bannerUrl", "Banner preview"], ["logoUrl", "Logo preview"]]) {
        const value = secureUrl(controls[name].value); if (!value) continue;
        const card = make("figure"); card.append(make("figcaption", label));
        let source = null; try { source = typeof imageUrl === "function" ? imageUrl(value) : null; } catch { /* The image boundary rejected this source. */ }
        if (source && String(source).startsWith("/") && !String(source).startsWith("//")) { const image = make("img"); image.src = source; image.alt = label; image.loading = "lazy"; image.addEventListener("error", () => { image.hidden = true; card.append(make("p", "This source image could not be loaded.", "fivem-help")); }); card.append(image); }
        else card.append(make("p", "Image address recorded. Preview is unavailable for this source.", "fivem-help")); media.append(card);
      }
    }
    async function discard() { return !dirty || await confirmAction("Discard unsaved review edits?", "These changes have not been published.", "Discard edits"); }
    let curation = null;
    async function open(item) {
      if (busy || !await discard() || destroyed) return;
      current = item; dirty = false; const candidate = item.candidate || {}; editorHeading.textContent = `Review ${candidate.name || item.joinCode || `${platformName} import`}`;
      for (const [name, control] of Object.entries(controls)) control.value = name === "reason" ? "" : ["tags", "keywords"].includes(name) ? list(candidate[name]).join(", ") : candidate[name] ?? "";
      sourceSummary.textContent = `Imported snapshot from ${date(candidate.checkedAt)} · ${list(candidate.evidence).length} evidence fields · ${typeof candidate.players === "number" ? candidate.players : "Unknown"} players / ${typeof candidate.capacity === "number" ? candidate.capacity : "unknown capacity"} · ${candidate.online === true ? "Reported online" : candidate.online === false ? "Reported offline" : "Online status unknown"}. Published listings refresh their player counts separately.`;
      join.replaceChildren(make("strong", `${platformName} join link: `)); const url = secureUrl(candidate.joinUrl); if (url) { const link = make("a", url); link.href = url; link.target = "_blank"; link.rel = "noopener noreferrer"; join.append(link); } else join.append(make("span", "Not provided by source"));
      showEvidence(candidate); renderMedia(); message(editorStatus, ""); editor.hidden = false;
      curation?.show(candidate,controls,()=>{dirty=true;renderMedia();});
      for (const control of Object.values(controls)) control.disabled = !canManage;
      publish.hidden = !canManage; sourceRefresh.hidden = !canManage || !item.serverId; dismiss.hidden = !canManage || item.status === "dismissed"; publish.textContent = item.status === "published" ? "Publish reviewed update" : "Publish reviewed listing"; controls.name.focus();
    }
    function payload() { const data = {}; for (const [name, control] of Object.entries(controls)) if (name !== "reason") data[name] = ["tags", "keywords"].includes(name) ? [...new Set(control.value.split(",").map((value) => value.trim()).filter(Boolean))] : control.value.trim(); return data; }
    async function mutate(action) {
      if (busy || !current || !canManage) return;
      if (action === "publish" ? !editor.reportValidity() : !controls.reason.reportValidity()) return;
      const titles = { publish: `Publish these reviewed ${platformName} details?`, archive: "Dismiss this import?", refresh: "Refresh this server’s live player count?" };
      const copy = { publish: "These details will be public. Community ownership still requires an approved claim.", archive: "The import will leave the review queue. Its review history is retained.", refresh: "Check the latest available player observation. Your listing review edits will stay here." };
      setBusy(true);
      if (!await confirmAction(titles[action], copy[action], action === "publish" ? "Publish listing" : action === "archive" ? "Dismiss import" : "Check player count")) { setBusy(false); return; }
      if (destroyed) return;
      message(editorStatus, action === "refresh" ? "Checking live player information…" : "Saving reviewed import…");
      try {
        const id = current.id; const body = { action, id, expectedVersion: current.version, reason: controls.reason.value.trim() }; if (action === "publish") body.data = payload();
        const response = await api(endpoint, { method: "POST", body: JSON.stringify(body) }); if (destroyed) return;
        if (action === "refresh") {
          const live = response.result;
          const observation = Number.isInteger(live?.players) && Number.isInteger(live?.capacity)
            ? `Latest ${platformName} observation: ${live.players} / ${live.capacity} players · ${date(live.checkedAt)}.`
            : live?.unchanged ? `${platformName} has no newer observation than ${date(live.checkedAt)}.`
            : response.message || "Live player count checked.";
          message(editorStatus, `${observation} Your review edits are preserved.`); return;
        }
        dirty = false; if (action === "publish") { filter.value = "published"; offset = 0; } const loaded = await refresh(); const updated = items.find((item) => item.id === id);
        if (loaded && updated) current = updated; else if (response.result?.version) current = { ...current, version: response.result.version };
        controls.reason.value = "";
        message(status, action === "publish" ? "Reviewed listing published. Open it again to review any further changes." : "Import dismissed.");
        editor.hidden = true; filter.focus();
        if (!loaded) { editor.hidden = true; current = null; message(status, "Saved successfully, but the import list could not refresh. Reload it before making another change.", true); }
      } catch (error) { if (!destroyed) message(editorStatus, error.message, true); }
      finally { setBusy(false); }
    }
    fetchForm.addEventListener("submit", async (event) => {
      event.preventDefault(); if (busy || !canManage) return;
      let values; try { values = parseInputs(inputs.value); } catch (error) { message(fetchStatus, error.message, true); return; }
      setBusy(true); message(fetchStatus, `Fetching public ${platformName} information…`); errors.replaceChildren(); errors.hidden = true;
      try {
        const failed = []; let count = 0;
        for (let index = 0; index < values.length; index += 1) {
          if (destroyed) return;
          message(fetchStatus, `Fetching source ${index + 1} of ${values.length}… ${count} ready for review.`);
          try { const payload = await api(endpoint, { method: "POST", body: JSON.stringify({ action: "fetch", inputs: [values[index]] }) }); count += list(payload.candidates).length; failed.push(...list(payload.errors)); }
          catch (error) { failed.push({ input: values[index], message: error.message }); if (error.status === 401 || error.status === 403 || error.status === 429) { for (const input of values.slice(index + 1)) failed.push({ input, message: "Not fetched. Retry after resolving the request error." }); break; } }
        }
        if (destroyed) return;
        errors.hidden = !failed.length; for (const error of failed) errors.append(make("li", `${error.input || error.joinCode || "Source"}: ${error.message || error.error || "Could not fetch details"}`));
        message(fetchStatus, `${count} source${count === 1 ? "" : "s"} fetched for review${failed.length ? `; ${failed.length} could not be fetched` : ""}. Fetching does not publish listings.`);
        filter.value = "pending"; offset = 0; await refresh();
      } catch (error) { message(fetchStatus, error.message, true); }
      finally { setBusy(false); }
    });
    featuredButton.addEventListener("click", async () => {
      if (busy || !canManage) return; setBusy(true); message(fetchStatus, "Loading featured source suggestions…");
      try {
        const payload = await api(endpoint, { method: "POST", body: JSON.stringify({ action: "featured" }) }); if (destroyed) return;
        featured.replaceChildren(make("p", "Choose a suggestion to add its join code, then fetch it for review.", "fivem-help"));
        const suggestions = list(payload.servers).slice(0, 30); for (const item of suggestions) { const choose = button(item.name || item.joinCode); choose.addEventListener("click", () => { const values = inputs.value.trim().split(/[\s,]+/).filter(Boolean); if (!values.includes(item.joinCode)) values.push(item.joinCode); if (values.length > 10) { message(fetchStatus, "Fetch the current 10 sources before adding another.", true); return; } inputs.value = values.join("\n"); inputs.focus(); }); featured.append(choose); }
        message(fetchStatus, suggestions.length ? `${suggestions.length} source suggestions. None have been imported or published.` : "No featured source suggestions are available.");
      } catch (error) { message(fetchStatus, error.message, true); }
      finally { setBusy(false); }
    });
    editor.addEventListener("input", () => { dirty = true; }); editor.addEventListener("submit", (event) => { event.preventDefault(); void mutate("publish"); });
    sourceRefresh.addEventListener("click", () => mutate("refresh")); dismiss.addEventListener("click", () => mutate("archive"));
    close.addEventListener("click", async () => { if (!busy && await discard()) { editor.hidden = true; dirty = false; filter.focus(); } });
    controls.bannerUrl.addEventListener("change", renderMedia); controls.logoUrl.addEventListener("change", renderMedia);
    filter.addEventListener("change", () => { offset = 0; void refresh(); }); reload.addEventListener("click", () => { if (!busy) void refresh(); });
    previous.addEventListener("click", () => { if (!busy && offset) { offset = Math.max(0, offset - 25); void refresh(); } }); next.addEventListener("click", () => { if (!busy && offset + 25 < total) { offset += 25; void refresh(); } });
    const beforeUnload = (event) => { if (dirty) { event.preventDefault(); event.returnValue = ""; } }; window.addEventListener("beforeunload", beforeUnload);
    await refresh();
    if (!destroyed && canManage && window.BrowseRPStaffCuration) { try { curation = await window.BrowseRPStaffCuration.init({api,root,platform,inputs}); } catch { /* Manual import remains available if research cannot load. */ } }
    return { refresh, async canLeave() {
      if (busy) { message(status, "Wait for the current import action to finish before switching games."); return false; }
      const allowed = await discard();
      if (!allowed && !editor.hidden) controls.name.focus();
      return allowed;
    }, destroy() { destroyed = true; request += 1; window.removeEventListener("beforeunload", beforeUnload); root.replaceChildren(); } };
  }
  window.BrowseRPStaffFiveM = Object.freeze({ init, parseInputs, secureUrl });
})();
