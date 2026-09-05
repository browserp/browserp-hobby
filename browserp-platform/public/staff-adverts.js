(() => {
  "use strict";
  const placements = { top: "Top carousel", side: "Side carousel", directory: "Server directory", server_detail: "Server details" };
  const make = (tag, text, className = "") => { const element = document.createElement(tag); if (text !== undefined) element.textContent = String(text); element.className = className; return element; };
  const button = (text, primary = false) => { const element = make("button", text, `button-v3 ${primary ? "button-primary-v3" : "button-secondary-v3"}`); element.type = "button"; return element; };
  function allowedImage(value) {
    const image = String(value || "").trim();
    return image === "" || (!image.includes("..") && /^(?:\/assets\/adverts\/[a-z0-9][a-z0-9_/-]*\.(?:avif|webp|png|jpe?g)|https:\/\/www\.browserp\.com\/assets\/adverts\/[a-z0-9][a-z0-9_/-]*\.(?:avif|webp|png|jpe?g)|https:\/\/kywabzfgjoqiznnxygbq\.supabase\.co\/storage\/v1\/object\/public\/advertisements\/[a-z0-9][a-z0-9_./-]*\.(?:avif|webp|png|jpe?g))$/i.test(image));
  }
  function allowedDestination(value) {
    const destination = String(value || "").trim();
    if (!destination || /[\\\u0000-\u0020\u007f]/.test(destination)) return false;
    if (destination.startsWith("/") && !destination.startsWith("//")) return true;
    try { const url = new URL(destination); return url.protocol === "https:" && !url.username && !url.password; } catch { return false; }
  }
  function localDate(value) {
    const date = new Date(value); if (!value || Number.isNaN(date.getTime())) return "";
    return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  }
  function dateLabel(value) {
    const date = new Date(value); return value && !Number.isNaN(date.getTime()) ? new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(date) : "No date set";
  }
  async function prepareArtwork(file) {
    if (!file || !["image/png", "image/jpeg", "image/webp"].includes(file.type) || /\.svg$/i.test(file.name || "")) throw new Error("Choose a PNG, JPG or WebP image.");
    if (!file.size || file.size > 5 * 1024 * 1024) throw new Error("Choose an image under 5 MB.");
    // Data URLs work within BrowseRP's existing image policy; no blob-source
    // exception or wider external image access is needed for local previews.
    const url = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(new Error("This image could not be read. Choose it again.")); reader.readAsDataURL(file); });
    const image = new Image();
    await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = () => reject(new Error("This image could not be opened. Choose another file.")); image.src = url; });
    if (image.naturalWidth < 320 || image.naturalHeight < 180) throw new Error("Choose an image at least 320 × 180 pixels.");
    if (image.naturalWidth > 8192 || image.naturalHeight > 8192 || image.naturalWidth * image.naturalHeight > 40_000_000) throw new Error("Choose an image up to 8192 pixels per side and 40 megapixels.");
    let scale = Math.min(1, 1600 / image.naturalWidth, 1600 / image.naturalHeight);
    const canvas = document.createElement("canvas"); const context = canvas.getContext("2d");
    if (!context) throw new Error("Image preparation is unavailable. Try another browser or use an approved image address.");
    for (let attempt = 0; attempt < 8; attempt++) {
      const width = Math.floor(image.naturalWidth * scale), height = Math.floor(image.naturalHeight * scale);
      if (width < 320 || height < 180) break;
      canvas.width = width; canvas.height = height; context.drawImage(image, 0, 0, width, height);
      const data = canvas.toDataURL("image/png");
      if (data.length < 1_398_000) return { data, width, height, name: file.name || "Advert artwork" };
      scale *= 0.8;
    }
    throw new Error("This image is too detailed to prepare under 1 MB. Crop it or choose a smaller image.");
  }
  function confirmAction(title, copy, label) {
    return new Promise((resolve) => {
      const dialog = make("dialog", undefined, "staff-dialog-v3 adverts-dialog");
      const form = make("form", undefined, "staff-dialog-card-v3"); form.method = "dialog";
      const heading = make("h2", title); heading.id = "advert-confirm-heading"; dialog.setAttribute("aria-labelledby", heading.id);
      const actions = make("div", undefined, "adverts-actions"); const cancel = button("Cancel"); const confirm = button(label, true); confirm.type = "submit";
      actions.append(cancel, confirm); form.append(heading, make("p", copy), actions); dialog.append(form); document.body.append(dialog);
      let finished = false;
      const finish = (value) => { if (finished) return; finished = true; dialog.close(); dialog.remove(); resolve(value); };
      cancel.addEventListener("click", () => finish(false)); form.addEventListener("submit", (event) => { event.preventDefault(); finish(true); }); dialog.addEventListener("cancel", (event) => { event.preventDefault(); finish(false); });
      dialog.showModal(); cancel.focus();
    });
  }

  async function init({ api, permissions = {}, prepareImage = prepareArtwork } = {}) {
    const root = document.querySelector("#overview-adverts");
    if (!root || root.dataset.initialized === "true" || typeof api !== "function") return;
    root.dataset.initialized = "true"; root.classList.add("staff-adverts");
    const header = make("div", undefined, "adverts-heading"); const headingCopy = make("div");
    headingCopy.append(make("span", "Website placements", "eyebrow-v3"), make("h2", "Advertisements"), make("p", "Create and manage the campaigns shown across BrowseRP.", "adverts-copy"));
    const create = button("Create advert", true); header.append(headingCopy, create); root.replaceChildren(header);
    if (!permissions.manageAdverts) { create.hidden = true; root.append(make("p", "Your role does not have permission to manage advertisements.", "adverts-copy")); return; }
    const loadStatus = make("p", "Loading advertisements…", "adverts-status"); loadStatus.setAttribute("role", "status");
    const retry = button("Reload adverts"); retry.hidden = true;
    const list = make("div", undefined, "adverts-list");
    const form = make("form", undefined, "adverts-form"); form.hidden = true;
    const editorTitle = make("h3", "New advert"); const activeNotice = make("p", "This advert is active. Publish to apply changes, or move it to draft to remove it from the website.", "adverts-notice"); activeNotice.hidden = true;
    const fields = make("div", undefined, "adverts-fields"); const controls = {};
    function field(name, text, options = {}) {
      const wrapper = make("label", undefined, `field-v3${options.wide ? " adverts-wide" : ""}`);
      const control = make(options.type === "textarea" ? "textarea" : options.type === "select" ? "select" : "input");
      if (control.tagName === "INPUT") control.type = options.type || "text";
      control.name = name; control.required = options.required !== false;
      for (const key of ["minLength", "maxLength", "rows", "placeholder"]) if (options[key] !== undefined) control[key] = options[key];
      for (const [value, label] of Object.entries(options.choices || {})) { const option = make("option", label); option.value = value; control.append(option); }
      wrapper.append(make("span", text), control); if (options.help) wrapper.append(make("small", options.help, "adverts-help"));
      (options.container || fields).append(wrapper); controls[name] = control;
    }
    field("name", "Campaign name", { minLength: 3, maxLength: 100, help: "An internal name for your team. 3–100 characters." });
    field("placement", "Placement", { type: "select", choices: placements });
    field("headline", "Headline", { minLength: 3, maxLength: 100, wide: true });
    field("body", "Advert text", { type: "textarea", minLength: 10, maxLength: 300, rows: 3, wide: true, help: "10–300 characters. Keep it clear and relevant." });
    field("ctaLabel", "Button text", { minLength: 2, maxLength: 40, placeholder: "Explore this community" });
    field("destinationUrl", "Button destination", { maxLength: 500, placeholder: "/servers", help: "A BrowseRP page path or a secure https:// address." });
    const artwork = make("div", undefined, "adverts-artwork adverts-wide");
    const artworkActions = make("div", undefined, "adverts-actions");
    const chooseImage = button("Upload image"); const removeImage = button("Remove image"); removeImage.hidden = true;
    const fileInput = make("input"); fileInput.type = "file"; fileInput.accept = "image/png,image/jpeg,image/webp"; fileInput.hidden = true;
    const artworkStatus = make("p", "No image selected.", "adverts-status"); artworkStatus.setAttribute("role", "status");
    const advanced = make("details", undefined, "adverts-image-address"); advanced.append(make("summary", "Use an approved image address"));
    field("imageUrl", "Image address", { container: advanced, required: false, maxLength: 500, placeholder: "/assets/adverts/campaign-name.jpg", help: "For an existing BrowseRP advert image. Other image hosts are not supported." });
    artworkActions.append(chooseImage, removeImage, fileInput);
    artwork.append(make("span", "Artwork", "adverts-artwork-label"), make("p", "PNG, JPG or WebP · up to 5 MB · at least 320 × 180 pixels. We resize larger images for fast loading. Images are public once uploaded; they appear in a placement only after publishing.", "adverts-help"), artworkActions, artworkStatus, advanced); fields.append(artwork);
    field("startsAt", "Start (your local time)", { type: "datetime-local", required: false, help: "Leave blank to start when published." });
    field("endsAt", "End (your local time)", { type: "datetime-local", required: false, help: "Leave blank for no scheduled end." });
    field("reason", "Reason for this change", { type: "textarea", minLength: 5, maxLength: 500, rows: 2, wide: true, help: "5–500 characters. Saved in the staff audit log." });
    const preview = make("details", undefined, "adverts-preview"); preview.open = true;
    const previewCard = make("article", undefined, "adverts-preview-card"); const previewImage = make("img"); previewImage.alt = "Advert image preview"; previewImage.hidden = true;
    const imageStatus = make("p", "", "adverts-help"); imageStatus.setAttribute("role", "status");
    const previewCopy = make("div", undefined, "adverts-preview-copy"); const previewHeadline = make("h4", "Your advert headline"); const previewBody = make("p"); const previewCta = make("span", "Your button", "adverts-preview-cta");
    previewCopy.append(make("span", "ADVERTISEMENT", "adverts-label"), previewHeadline, previewBody, previewCta); previewCard.append(previewImage, previewCopy); preview.append(make("summary", "Advert preview"), previewCard, imageStatus);
    const actions = make("div", undefined, "adverts-actions");
    const save = button("Save draft"); save.type = "submit"; save.value = "save";
    const publish = button("Publish advert", true); publish.type = "submit"; publish.value = "activate";
    const pause = button("Pause advert"); pause.hidden = true;
    const archive = button("Archive advert"); archive.hidden = true;
    const close = button("Close editor"); actions.append(save, publish, pause, archive, close);
    const formStatus = make("p", "", "adverts-status"); formStatus.setAttribute("role", "status");
    form.append(editorTitle, activeNotice, fields, preview, actions, formStatus); root.append(loadStatus, retry, list, form);
    let items = []; let current = null; let dirty = false; let busy = false; let previewSource = ""; let selectedImage = null;
    window.addEventListener("beforeunload", (event) => {
      if (dirty && form.isConnected) { event.preventDefault(); event.returnValue = ""; }
    });
    const status = (text, error = false) => { formStatus.textContent = text; formStatus.dataset.error = String(error); };
    const setBusy = (value) => { busy = value; root.setAttribute("aria-busy", String(value)); root.querySelectorAll("button,input,textarea,select").forEach((element) => { element.disabled = value; }); };
    function updateActions() { const active = current?.status === "active"; activeNotice.hidden = !active; save.textContent = active ? "Move to draft" : "Save draft"; pause.hidden = !active; archive.hidden = !current || current.status === "completed"; }
    function renderPreview() {
      previewHeadline.textContent = controls.headline.value.trim() || "Your advert headline"; previewBody.textContent = controls.body.value.trim() || "Your advert text will appear here."; previewCta.textContent = controls.ctaLabel.value.trim() || "Your button";
      previewCard.dataset.placement = controls.placement.value;
      controls.imageUrl.required = false;
      chooseImage.textContent = selectedImage || controls.imageUrl.value.trim() ? "Replace image" : "Upload image";
      removeImage.hidden = !selectedImage && !controls.imageUrl.value.trim();
      if (selectedImage) {
        artworkStatus.textContent = `${selectedImage.name} · ${selectedImage.width} × ${selectedImage.height} · ready to save`;
        if (previewSource !== selectedImage.data) { previewSource = selectedImage.data; previewImage.hidden = false; imageStatus.textContent = ""; previewImage.src = selectedImage.data; }
        return;
      }
      artworkStatus.textContent = controls.imageUrl.value.trim() ? "Existing image selected." : "No image selected. An image is required except for the top carousel.";
      const value = controls.imageUrl.value.trim();
      if (!value || !allowedImage(value)) { previewImage.hidden = true; previewImage.removeAttribute("src"); previewSource = ""; imageStatus.textContent = value ? "Use an approved BrowseRP image address to see its preview." : "No image selected."; return; }
      const source = value.replace(/^https:\/\/www\.browserp\.com(?=\/assets\/adverts\/)/i, "");
      if (source !== previewSource) { previewSource = source; previewImage.hidden = false; imageStatus.textContent = "Loading image preview…"; previewImage.src = source; }
    }
    previewImage.addEventListener("load", () => { previewImage.hidden = false; imageStatus.textContent = ""; });
    previewImage.addEventListener("error", () => { previewImage.hidden = true; imageStatus.textContent = "The image could not be loaded. Check that it is uploaded and its address is correct."; });
    function renderList() {
      list.replaceChildren(...items.map((item) => {
        const card = make("article", undefined, "adverts-item");
        if (item.imageUrl && allowedImage(item.imageUrl)) { const image = make("img", undefined, "adverts-thumbnail"); image.src = item.imageUrl.replace(/^https:\/\/www\.browserp\.com(?=\/assets\/adverts\/)/i, ""); image.alt = ""; image.loading = "lazy"; image.addEventListener("error", () => { image.hidden = true; }); card.append(image); }
        const copy = make("div", undefined, "adverts-item-copy"); copy.append(make("strong", item.name), make("span", item.headline), make("small", `${placements[item.placement] || item.placement} · Updated ${dateLabel(item.updatedAt)}`, "adverts-help"));
        const state = make("span", item.status === "completed" ? "Archived" : item.status === "active" && item.startsAt && new Date(item.startsAt) > new Date() ? "Scheduled" : item.status === "active" && item.endsAt && new Date(item.endsAt) <= new Date() ? "Ended" : item.status === "active" ? "Live" : item.status, "adverts-state"); state.dataset.state = item.status;
        const edit = button("Edit"); edit.setAttribute("aria-label", `Edit advert: ${item.name}`); edit.addEventListener("click", () => openEditor(item));
        const rowActions = make("div", undefined, "adverts-item-actions"); rowActions.append(state, edit); card.append(copy, rowActions); return card;
      }));
      loadStatus.textContent = items.length ? `${items.length} campaign${items.length === 1 ? "" : "s"}` : "No advertisements yet. Create a campaign when you are ready."; loadStatus.dataset.error = "false";
    }
    async function refresh() {
      retry.hidden = true;
      try { const payload = await api("/api/admin/adverts"); if (!Array.isArray(payload.adverts)) throw new Error("Invalid response. Please retry."); items = payload.adverts; renderList(); return true; }
      catch (error) { loadStatus.textContent = `Unable to load advertisements: ${error.message}`; loadStatus.dataset.error = "true"; retry.hidden = false; return false; }
    }
    async function discard() { return !dirty || await confirmAction("Discard unsaved changes?", "Your changes have not been saved. Close this advert and discard them?", "Discard changes"); }
    async function openEditor(item = null) {
      if (busy || !await discard()) return;
      current = item; form.reset(); dirty = false; selectedImage = null; advanced.open = false;
      for (const [name, control] of Object.entries(controls)) control.value = name === "reason" ? "" : ["startsAt", "endsAt"].includes(name) ? localDate(item?.[name]) : item?.[name] || (name === "placement" ? "top" : "");
      editorTitle.textContent = item ? "Edit advert" : "New advert"; updateActions(); renderPreview(); status(""); form.hidden = false; controls.name.focus();
    }
    async function submit(action) {
      if (busy) return;
      if (["pause", "archive"].includes(action)) { if (!current || !controls.reason.reportValidity()) return; }
      else {
        if (!form.reportValidity()) return;
        if (!allowedDestination(controls.destinationUrl.value)) { status("Use a BrowseRP page path or a secure https:// destination.", true); controls.destinationUrl.focus(); return; }
        if (!selectedImage && !allowedImage(controls.imageUrl.value)) { status("Use an approved BrowseRP advert image address. Other image hosts and file types are not supported.", true); advanced.open = true; controls.imageUrl.focus(); return; }
        if (!selectedImage && !controls.imageUrl.value.trim() && controls.placement.value !== "top") { status("Choose an image for this placement.", true); chooseImage.focus(); return; }
        if (controls.endsAt.value && new Date(controls.endsAt.value) <= new Date(controls.startsAt.value || Date.now())) { status("Choose an end time after the start time.", true); controls.endsAt.focus(); return; }
      }
      const confirmation = { activate: ["Publish this advert?", "This advert will appear in its selected website placement during the scheduled dates.", "Publish advert"], pause: ["Pause this advert?", "This removes it from the website until you publish it again. Unsaved content changes will not be applied.", "Pause advert"], archive: ["Archive this advert?", "This removes it from the website and keeps its content and audit history. Unsaved content changes will not be applied.", "Archive advert"], save: ["Move this advert to draft?", "Your changes will be saved as a draft and the live advert will be removed from the website.", "Move to draft"] };
      setBusy(true);
      if ((action !== "save" || current?.status === "active") && !await confirmAction(...confirmation[action])) { setBusy(false); return; }
      status("Saving advert…");
      let uploadedAsset = null;
      try {
        const data = { id: current?.id || null, action, expectedVersion: current?.version || 0 };
        for (const [name, control] of Object.entries(controls)) data[name] = ["startsAt", "endsAt"].includes(name) ? control.value ? new Date(control.value).toISOString() : null : control.value.trim();
        if (["save", "activate"].includes(action) && selectedImage) {
          status("Uploading image…");
          const upload = await api("/api/admin/adverts/media", { method: "POST", body: JSON.stringify({ action: "upload", imageData: selectedImage.data }) });
          if (!upload.asset?.id || !upload.asset.imageUrl || !allowedImage(upload.asset.imageUrl)) throw new Error("The image upload could not be confirmed. Please try again.");
          uploadedAsset = upload.asset; data.imageUrl = upload.asset.imageUrl; status("Saving advert…");
        }
        const response = await api("/api/admin/adverts", { method: "POST", body: JSON.stringify(data) });
        uploadedAsset = null;
        if (["save", "activate"].includes(action)) { controls.imageUrl.value = data.imageUrl; selectedImage = null; fileInput.value = ""; renderPreview(); }
        dirty = Boolean(selectedImage); const result = response.result || {}; const id = result.id || current?.id;
        const refreshed = await refresh();
        current = (refreshed && items.find((item) => item.id === id)) || { ...current, ...data, id, status: action === "activate" ? "active" : action === "pause" ? "paused" : action === "archive" ? "completed" : "draft", version: result.version ?? current?.version };
        controls.reason.value = ""; updateActions(); editorTitle.textContent = "Edit advert";
        status(`Advert ${action === "activate" ? "published" : action === "save" ? "saved as a draft" : action === "pause" ? "paused" : "archived"}.${refreshed ? "" : " Saved successfully, but the campaign list could not refresh. Reload adverts to check its latest state."}`);
      } catch (error) {
        if (uploadedAsset) {
          try { await api("/api/admin/adverts/media", { method: "POST", body: JSON.stringify({ action: "remove", assetId: uploadedAsset.id }) }); }
          catch { /* Registered unused images are collected by the server cleanup. */ }
        }
        status(error.message, true);
      }
      finally { setBusy(false); }
    }
    create.addEventListener("click", () => openEditor()); retry.addEventListener("click", refresh);
    chooseImage.addEventListener("click", () => { if (!busy) fileInput.click(); });
    fileInput.addEventListener("change", async () => {
      const file = fileInput.files?.[0]; if (!file || busy) return;
      setBusy(true); status("Preparing image…");
      try { selectedImage = await prepareImage(file); dirty = true; renderPreview(); status("Image ready. Save the advert to upload it."); }
      catch (error) { status(error.message, true); }
      finally { fileInput.value = ""; setBusy(false); }
    });
    removeImage.addEventListener("click", () => { if (busy) return; selectedImage = null; controls.imageUrl.value = ""; fileInput.value = ""; dirty = true; renderPreview(); status("Image removed from this edit. Save to apply the change."); chooseImage.focus(); });
    controls.imageUrl.addEventListener("input", () => { selectedImage = null; renderPreview(); });
    form.addEventListener("input", () => { dirty = true; renderPreview(); }); form.addEventListener("change", () => { dirty = true; renderPreview(); });
    form.addEventListener("submit", (event) => { event.preventDefault(); submit(event.submitter?.value || "save"); }); pause.addEventListener("click", () => submit("pause")); archive.addEventListener("click", () => submit("archive"));
    close.addEventListener("click", async () => { if (!busy && await discard()) { form.hidden = true; dirty = false; selectedImage = null; fileInput.value = ""; previewImage.removeAttribute("src"); previewSource = ""; create.focus(); } });
    await refresh();
  }
  window.BrowseRPStaffAdverts = Object.freeze({ init, allowedImage, allowedDestination, prepareArtwork });
})();
