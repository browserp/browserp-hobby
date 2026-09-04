(() => {
  "use strict";
  const make = (tag, text, className = "") => { const el = document.createElement(tag); if (text !== undefined) el.textContent = String(text); el.className = className; return el; };
  const button = (text, primary = false) => { const el = make("button", text, `button-v3 ${primary ? "button-primary-v3" : "button-secondary-v3"}`); el.type = "button"; return el; };
  const dates = (value) => { const date = new Date(value); return value && Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(date) : "Not recorded"; };
  const labels = { pending_check: "Discord ownership not checked", verified: "Discord owner verified", not_owner: "Discord ownership not confirmed", unavailable: "Discord check unavailable", needs_discord: "Discord permission needed" };
  function sameOriginPath(value) { return typeof value === "string" && /^\/(?!\/)/.test(value) && !/[\\\u0000-\u0020\u007f]/.test(value) ? value : null; }
  function https(value) { if (!value) return true; try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password && !/\s/.test(value); } catch { return false; } }
  async function init({ server, root } = {}) {
    if (typeof root === "string") root = document.querySelector(root);
    const serverId = server?.id || server?.serverId;
    if (!root || !serverId) return null;
    root.classList.add("server-claims"); root.hidden = false;
    let csrf = ""; let context = {}; let claims = []; let busy = false; let destroyed = false; let generation = 0;
    const header = make("div", undefined, "claims-heading"); header.append(make("span", "Community ownership", "eyebrow-v3"), make("h2", "Claim this listing"));
    const intro = make("p", "If you own this community, submit a claim for BrowseRP staff to review.", "claims-copy");
    const status = make("p", "Loading claim options…", "claims-status"); status.setAttribute("role", "status");
    const retry = button("Refresh claim status");
    const entry = make("div", undefined, "claims-entry"); const history = make("div", undefined, "claims-history");
    const form = make("form", undefined, "claims-form"); form.hidden = true;
    const messageLabel = make("label", undefined, "field-v3"); const message = make("textarea"); message.name = "message"; message.rows = 4; message.required = true; message.minLength = 20; message.maxLength = 2000; message.placeholder = "Explain your role in the community and how staff can verify ownership."; messageLabel.append(make("span", "Tell us why this listing belongs to you"), message, make("small", "20–2,000 characters. Include useful ownership information, never passwords or access tokens.", "claims-help"));
    const evidenceLabel = make("label", undefined, "field-v3"); const evidence = make("input"); evidence.name = "evidenceUrl"; evidence.type = "url"; evidence.maxLength = 1000; evidence.placeholder = "https://"; evidenceLabel.append(make("span", "Supporting evidence link (optional)"), evidence, make("small", "A public, secure link that helps staff confirm your role.", "claims-help"));
    const submit = button("Submit ownership claim", true); submit.type = "submit"; const formStatus = make("p", "", "claims-status"); formStatus.setAttribute("role", "status");
    form.append(messageLabel, evidenceLabel, make("p", "Discord verification checks whether you own the Discord community linked to this listing. It does not automatically approve the server claim.", "claims-help"), submit, formStatus);
    root.replaceChildren(header, intro, status, retry, entry, form, history);
    const feedback = (element, text, error = false) => { element.textContent = text; element.dataset.error = String(error); };
    const setBusy = (value) => { busy = value; root.setAttribute("aria-busy", String(value)); root.querySelectorAll("button,input,textarea").forEach((el) => { el.disabled = value; }); };
    async function api(path, options = {}) {
      const response = await fetch(path, { credentials: "same-origin", ...options, headers: { Accept: "application/json", ...(options.body ? { "Content-Type": "application/json", "X-BrowseRP-CSRF": csrf } : {}), ...(options.headers || {}) } });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw Object.assign(new Error(payload.error || "The ownership request could not be completed."), { status: response.status });
      return payload;
    }
    function connectLink(text) { const url = sameOriginPath(context.reconnectUrl); if (!url) return null; const link = make("a", text, "button-v3 button-secondary-v3"); link.href = url; return link; }
    function render() {
      entry.replaceChildren(); history.replaceChildren();
      const pending = claims.some((claim) => claim.status === "pending");
      header.children[1].textContent = context.isOwner ? "You manage this listing" : "Claim this listing";
      form.hidden = !context.claimable || context.isOwner || !context.authenticated || context.provider !== "discord" || pending;
      if (context.isOwner) { entry.append(make("p", "Your ownership claim is approved. Manage your community from your dashboard.", "claims-copy")); const link = make("a", "Open dashboard", "button-v3 button-primary-v3"); link.href = "/dashboard"; entry.append(link); }
      else if (!context.claimable) entry.append(make("p", "This listing is not currently available to claim.", "claims-copy"));
      else if (!context.authenticated || context.provider !== "discord") { entry.append(make("p", "Continue with the Discord account you use to manage this community.", "claims-copy")); const link = connectLink("Continue with Discord"); if (link) entry.append(link); }
      else if (pending) entry.append(make("p", "Your claim is awaiting a staff decision. You can verify Discord ownership while it is being reviewed.", "claims-copy"));
      if (claims.length) history.append(make("h3", "Your ownership requests"));
      for (const claim of claims) {
        const card = make("article", undefined, "claims-item"); const top = make("div", undefined, "claims-item-heading"); const badge = make("span", labels[claim.verificationStatus] || "Discord ownership not checked", "claims-proof"); badge.dataset.verified = String(claim.verificationStatus === "verified");
        top.append(make("strong", claim.status === "pending" ? "Awaiting staff review" : claim.status === "approved" ? "Claim approved" : claim.status === "denied" ? "Claim declined" : "Claim superseded"), badge); card.append(top, make("small", `Submitted ${dates(claim.createdAt)}`, "claims-help"));
        if (claim.verificationStatus === "verified") card.append(make("p", `Discord ownership verified${claim.guildName ? ` for ${claim.guildName}` : ""}${claim.verifiedAt ? ` on ${dates(claim.verifiedAt)}` : ""}. ${claim.status === "pending" ? "BrowseRP staff still need to approve this listing claim." : "This verification concerns the linked Discord community."}`, "claims-copy"));
        else if (claim.verificationStatus === "not_owner") card.append(make("p", "The Discord check did not establish that you own the community linked on this listing. Staff can still review the evidence you submitted.", "claims-copy"));
        else if (claim.verificationStatus === "unavailable") card.append(make("p", "The Discord ownership check could not be completed. You can try again or let staff review your supporting evidence.", "claims-copy"));
        if (claim.decisionReason) card.append(make("p", `Staff response: ${claim.decisionReason}`, "claims-copy"));
        const details = make("details"); details.append(make("summary", "Submitted information"), make("p", claim.message || "No message recorded.", "claims-message")); if (claim.evidenceUrl && https(claim.evidenceUrl)) { const link = make("a", "View your evidence link ↗"); link.href = claim.evidenceUrl; link.target = "_blank"; link.rel = "noopener noreferrer"; details.append(link); } card.append(details);
        if (claim.status === "pending" && claim.verificationStatus !== "verified") {
          const actions = make("div", undefined, "claims-actions");
          if (claim.verificationStatus === "needs_discord") { card.append(make("p", "Allow BrowseRP to check the Discord communities you own. You will return here after Discord consent.", "claims-help")); const link = connectLink("Allow Discord ownership check"); if (link) actions.append(link); }
          const verify = button(claim.verificationStatus === "unavailable" || claim.verificationStatus === "not_owner" ? "Retry Discord ownership check" : "Verify Discord ownership"); verify.addEventListener("click", () => verifyClaim(claim.id)); actions.append(verify); card.append(actions);
        }
        history.append(card);
      }
    }
    async function refresh() {
      const current = ++generation;
      try {
        const payload = await api(`/api/server-claims?serverId=${encodeURIComponent(serverId)}`); if (destroyed || current !== generation) return false;
        context = payload.context || {}; csrf = payload.csrfToken || csrf; claims = Array.isArray(payload.claims) ? payload.claims : Array.isArray(payload.claims?.items) ? payload.claims.items : [];
        render(); feedback(status, ""); return true;
      } catch (error) { if (!destroyed && current === generation) feedback(status, error.message, true); return false; }
    }
    async function verifyClaim(claimId) {
      if (busy) return; if (!csrf) { feedback(status, "Refresh claim status before checking ownership.", true); return; } setBusy(true); feedback(status, "Checking linked Discord ownership…");
      try {
        await api("/api/server-claims", { method: "POST", body: JSON.stringify({ action: "verify", claimId }) }); if (destroyed) return;
        if (await refresh()) { const claim = claims.find((item) => item.id === claimId); feedback(status, claim?.verificationStatus === "verified" ? "Discord ownership verified. Your claim still awaits the staff decision." : claim?.verificationStatus === "needs_discord" ? "Discord consent is needed to complete this check. Use the link on your request." : "Ownership check finished. See your request for the result."); }
      } catch (error) { if (!destroyed) feedback(status, error.message, true); }
      finally { setBusy(false); }
    }
    form.addEventListener("submit", async (event) => {
      event.preventDefault(); if (busy || !form.reportValidity()) return;
      if (!https(evidence.value.trim())) { feedback(formStatus, "Use a secure https:// evidence link without credentials.", true); evidence.focus(); return; }
      if (!csrf) { feedback(formStatus, "Refresh claim status before submitting.", true); return; }
      setBusy(true); feedback(formStatus, "Submitting your claim…");
      try {
        await api("/api/server-claims", { method: "POST", body: JSON.stringify({ action: "request", serverId, message: message.value.trim(), evidenceUrl: evidence.value.trim() || null }) }); if (destroyed) return;
        message.value = ""; evidence.value = ""; form.hidden = true;
        if (await refresh()) feedback(status, "Claim submitted for staff review. Check Discord ownership to support your request.");
        else feedback(status, "Your claim was submitted, but its status could not refresh. Refresh claim status to see it.", true);
      } catch (error) { if (!destroyed) feedback(formStatus, error.message, true); }
      finally { setBusy(false); }
    });
    retry.addEventListener("click", () => { if (!busy) void refresh(); });
    await refresh();
    return { refresh, destroy() { destroyed = true; generation += 1; root.replaceChildren(); } };
  }
  window.BrowseRPServerClaims = Object.freeze({ init, sameOriginPath, https });
})();
