(() => {
  "use strict";

  const SITE_ORIGIN = "https://www.browserp.com";
  const LOGO_URL = "https://www.browserp.com/assets/browserp-logo-v5.png?v=20260908";
  const BADGE_LABEL = "Listed on BrowseRP";
  const BADGE_IMAGE_WIDTH = 180;
  const BADGE_LINK_STYLE = "display:inline-flex;max-width:100%;box-sizing:border-box;flex-direction:column;align-items:flex-start;gap:6px;padding:9px 11px;border:1px solid #c9b8c9;border-radius:10px;background:#fff;color:#211922;text-decoration:none;vertical-align:middle";
  const BADGE_IMAGE_STYLE = "display:block;max-width:100%;height:auto";
  const BADGE_LABEL_STYLE = "display:block;color:#211922;font:600 13px/1.3 system-ui,-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;letter-spacing:.01em";
  const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

  function validSlug(value) {
    return typeof value === "string" && value.length <= 100 && SLUG_PATTERN.test(value) ? value : "";
  }

  function plainName(value) {
    const name = String(value || "").replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
    return name || "This roleplay community";
  }

  function escapeHtmlAttribute(value) {
    return String(value).replace(/[&<>"']/g, character => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "\"": "&quot;",
      "'": "&#39;"
    })[character]);
  }

  function escapeMarkdownAlt(value) {
    return String(value).replace(/\\/g, "\\\\").replace(/([\[\]])/g, "\\$1");
  }

  function createSnippets(slugValue, serverName) {
    const slug = validSlug(slugValue);
    if (!slug) return null;
    const listingUrl = `${SITE_ORIGIN}/server/${encodeURIComponent(slug)}`;
    const alt = `${plainName(serverName)} is listed on BrowseRP`;
    return Object.freeze({
      listingUrl,
      html: `<a href="${escapeHtmlAttribute(listingUrl)}" aria-label="${escapeHtmlAttribute(alt)}" style="${BADGE_LINK_STYLE}"><img src="${escapeHtmlAttribute(LOGO_URL)}" width="${BADGE_IMAGE_WIDTH}" alt="" aria-hidden="true" style="${BADGE_IMAGE_STYLE}"><span style="${BADGE_LABEL_STYLE}">${BADGE_LABEL}</span></a>`,
      markdown: `[![${escapeMarkdownAlt(alt)}](${LOGO_URL})](${listingUrl})\n\n[**${BADGE_LABEL}**](${listingUrl})`
    });
  }

  function make(tag, className = "", text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = String(text);
    return element;
  }

  function button(className, text) {
    const element = make("button", className, text);
    element.type = "button";
    return element;
  }

  function closeDialog(dialog) {
    if (dialog.open && typeof dialog.close === "function") dialog.close();
    else dialog.remove();
  }

  function codeField({ format, value, status }) {
    const field = make("div", "portal-field");
    const id = `owner-badge-${format.toLowerCase()}`;
    const label = make("label", "", format); label.htmlFor = id;
    const code = make("textarea");
    code.id = id; code.readOnly = true; code.spellcheck = false; code.rows = format === "HTML" ? 4 : 3; code.value = value;
    code.dataset.ownerBadgeCode = format.toLowerCase();
    const copy = button("small-button", `Copy ${format}`);
    copy.dataset.ownerBadgeCopy = format.toLowerCase();
    copy.addEventListener("click", async () => {
      copy.disabled = true;
      status.className = "portal-status";
      try {
        if (!navigator.clipboard || typeof navigator.clipboard.writeText !== "function") throw new Error("Clipboard unavailable");
        await navigator.clipboard.writeText(value);
        status.textContent = `${format} copied.`;
        status.classList.add("success");
      } catch {
        code.focus();
        code.select();
        code.setSelectionRange?.(0, code.value.length);
        status.textContent = "Copy is unavailable. Select the code above and copy it manually.";
        status.classList.add("error");
      } finally {
        copy.disabled = false;
      }
    });
    field.append(label, code, copy);
    return field;
  }

  function openBadgeDialog({ slug, serverName }) {
    const snippets = createSnippets(slug, serverName);
    if (!snippets) return null;
    document.querySelectorAll(".owner-badge-dialog").forEach(dialog => closeDialog(dialog));

    const dialog = make("dialog", "portal-dialog owner-badge-dialog");
    dialog.setAttribute("aria-labelledby", "owner-badge-title");
    const form = make("div", "dialog-form profile-form-v2");
    const head = make("div", "dialog-head");
    const heading = make("div");
    const title = make("h2", "", `Share ${plainName(serverName)}`); title.id = "owner-badge-title";
    heading.append(make("span", "portal-kicker", "Owner badge"), title);
    const dismiss = button("icon-button", "×");
    dismiss.setAttribute("aria-label", "Close owner badge");
    dismiss.addEventListener("click", () => closeDialog(dialog));
    head.append(heading, dismiss);

    const intro = make("p", "", "Add this static BrowseRP badge to your community website. It links directly to your published listing.");
    const preview = make("a", "owner-badge-preview");
    preview.href = snippets.listingUrl; preview.target = "_blank"; preview.rel = "noopener noreferrer";
    preview.setAttribute("aria-label", `${plainName(serverName)} is listed on BrowseRP`);
    preview.setAttribute("style", BADGE_LINK_STYLE);
    const previewImage = make("img");
    previewImage.src = LOGO_URL; previewImage.width = BADGE_IMAGE_WIDTH; previewImage.alt = ""; previewImage.setAttribute("aria-hidden", "true"); previewImage.setAttribute("style", BADGE_IMAGE_STYLE);
    const previewLabel = make("span", "", BADGE_LABEL); previewLabel.setAttribute("style", BADGE_LABEL_STYLE);
    preview.append(previewImage, previewLabel);
    const status = make("p", "portal-status");
    status.dataset.ownerBadgeStatus = ""; status.setAttribute("role", "status"); status.setAttribute("aria-live", "polite");
    const fields = make("div", "content-grid");
    fields.append(
      codeField({ format: "HTML", value: snippets.html, status }),
      codeField({ format: "Markdown", value: snippets.markdown, status })
    );
    const actions = make("div", "dialog-actions");
    const done = button("button button-secondary", "Close");
    done.addEventListener("click", () => closeDialog(dialog));
    actions.append(done);
    form.append(head, intro, preview, fields, status, actions);
    dialog.append(form);
    dialog.addEventListener("close", () => dialog.remove(), { once: true });
    document.body.append(dialog);
    if (typeof dialog.showModal === "function") dialog.showModal();
    else dialog.setAttribute("open", "");
    return dialog;
  }

  function createAction({ slug, status, serverName } = {}) {
    if (String(status || "").toLowerCase() !== "published" || !validSlug(slug)) return null;
    const action = button("small-button", "Get owner badge");
    action.dataset.ownerBadgeAction = "";
    action.addEventListener("click", () => openBadgeDialog({ slug, serverName }));
    return action;
  }

  window.addEventListener("browserp:session-ended", () => {
    document.querySelectorAll(".owner-badge-dialog").forEach(dialog => closeDialog(dialog));
  });

  window.BrowseRPOwnerBadge = Object.freeze({ createAction, createSnippets, validSlug });
})();
