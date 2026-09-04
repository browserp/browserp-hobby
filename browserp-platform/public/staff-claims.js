(() => {
  "use strict";
  const make = (tag, text, className = "") => { const el = document.createElement(tag); if (text !== undefined) el.textContent = String(text); el.className = className; return el; };
  const button = (text, primary = false) => { const el = make("button", text, `button-v3 ${primary ? "button-primary-v3" : "button-secondary-v3"}`); el.type = "button"; return el; };
  const date = (value) => { const parsed = new Date(value); return value && Number.isFinite(parsed.getTime()) ? new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(parsed) + " UTC" : "Not recorded"; };
  const proofLabel = { verified: "Discord owner verified", pending_check: "Not yet checked", not_owner: "Discord ownership not confirmed", unavailable: "Check unavailable", needs_discord: "Discord consent needed" };
  function evidenceLink(value, text) { try { const url = new URL(value); if (url.protocol !== "https:" || url.username || url.password) return null; const link = make("a", text || url.href); link.href = url.href; link.target = "_blank"; link.rel = "noopener noreferrer"; return link; } catch { return null; } }
  async function init({ api, root } = {}) {
    if (typeof root === "string") root = document.querySelector(root);
    if (!root || typeof api !== "function") return null;
    root.classList.add("staff-claims"); let offset = 0; let total = 0; let canReview = false; let busy = false; let destroyed = false; let generation = 0; let activeDialog = null;
    const heading = make("div", undefined, "staff-claims-heading"); heading.append(make("span", "Community ownership", "eyebrow-v3"), make("h2", "Server ownership claims"), make("p", "Discord verification confirms ownership of the linked Discord community. Staff must still review ownership of the game server before approving a claim.", "staff-claims-copy"));
    const filters = make("form", undefined, "staff-claims-filters"); filters.setAttribute("aria-label", "Ownership claim filters");
    const searchLabel = make("label", undefined, "field-v3"); const search = make("input"); search.name = "q"; search.type = "search"; search.maxLength = 200; search.placeholder = "Server, claimant or Discord ID"; searchLabel.append(make("span", "Search claims"), search);
    function select(name, text, values) { const label = make("label", undefined, "field-v3"); const control = make("select"); control.name = name; for (const [value, title] of values) { const option = make("option", title); option.value = value; control.append(option); } label.append(make("span", text), control); filters.append(label); return control; }
    filters.append(searchLabel);
    const statusFilter = select("status", "Status", [["pending", "Pending review"], ["approved", "Approved"], ["denied", "Declined"], ["superseded", "Superseded"], ["all", "All statuses"]]); statusFilter.value = "pending";
    const verificationFilter = select("verification", "Discord verification", [["all", "All verification states"], ["verified", "Verified Discord owners"], ["unverified", "Not verified"]]); verificationFilter.value = "all";
    const find = button("Search", true); find.type = "submit"; const reload = button("Refresh claims"); filters.append(find, reload);
    const status = make("p", "Loading claims…", "staff-claims-status"); status.setAttribute("role", "status");
    const records = make("div", undefined, "staff-claims-list"); const pagination = make("div", undefined, "staff-claims-pagination"); const previous = button("Previous"); const next = button("Next"); const pageLabel = make("span"); pagination.append(previous, pageLabel, next);
    root.replaceChildren(heading, filters, status, records, pagination);
    const message = (text, error = false) => { status.textContent = text; status.dataset.error = String(error); };
    const updatePagination = () => { previous.disabled = busy || offset === 0; next.disabled = busy || offset + 25 >= total; pageLabel.textContent = total ? `${offset + 1}–${Math.min(offset + 25, total)} of ${total}` : "No claims"; };
    function setBusy(value) { busy = value; root.setAttribute("aria-busy", String(value)); filters.querySelectorAll("button,input,select").forEach((el) => { el.disabled = value; }); updatePagination(); }
    function render(items) {
      records.replaceChildren(...items.map((claim) => {
        const card = make("article", undefined, "staff-claim"); const head = make("div", undefined, "staff-claim-heading"); const title = make("div"); title.append(make("h3", claim.serverName || "Server listing"), make("span", `${claim.claimantName || "Claimant"} · ${claim.status}`, "staff-claims-help"));
        const badge = make("span", proofLabel[claim.verificationStatus] || "Not verified", "staff-claim-proof"); badge.dataset.verified = String(claim.verificationStatus === "verified"); head.append(title, badge); card.append(head);
        const info = make("dl", undefined, "staff-claim-meta");
        for (const [label, value] of [["Submitted", date(claim.createdAt)], ["Discord user ID", claim.discordUserId || "Not recorded"], ["Linked Discord community", claim.guildName || "Not verified"], ["Ownership check", date(claim.verificationCheckedAt || claim.verifiedAt)]]) info.append(make("dt", label), make("dd", value));
        card.append(info, make("p", claim.message || "No claim message recorded.", "staff-claim-message"));
        const links = make("div", undefined, "staff-claim-links"); for (const [value, text] of [[claim.communityUrl, "Open linked Discord community ↗"], [claim.evidenceUrl, "Open submitted evidence ↗"]]) { const link = evidenceLink(value, text); if (link) links.append(link); } card.append(links);
        if (claim.verificationStatus === "verified") card.append(make("p", `Discord proof matches${claim.guildName ? ` ${claim.guildName}` : " the linked community"}. This does not establish game-server ownership by itself.`, "staff-claims-help"));
        if (claim.decisionReason) card.append(make("p", `Decision: ${claim.decisionReason}`, "staff-claims-copy"));
        if (claim.status === "pending" && canReview) { const actions = make("div", undefined, "staff-claims-actions"); const approve = button("Review approval", true); const deny = button("Decline claim"); approve.addEventListener("click", () => decision(claim, "approve")); deny.addEventListener("click", () => decision(claim, "deny")); actions.append(approve, deny); card.append(actions); }
        return card;
      }));
      if (!items.length) records.append(make("p", "No ownership claims match these filters.", "staff-claims-copy"));
    }
    async function refresh() {
      const revision = ++generation; setBusy(true);
      try {
        const query = new URLSearchParams({ status: statusFilter.value, verification: verificationFilter.value, q: search.value.trim(), offset: String(offset) });
        const payload = await api(`/api/admin/server-claims?${query}`); if (destroyed || revision !== generation) return false;
        const workspace = payload.workspace; if (!workspace || !Array.isArray(workspace.items) || !Number.isSafeInteger(workspace.total)) throw new Error("Claim records could not be read. Please refresh.");
        canReview = workspace.canReview === true; total = workspace.total; render(workspace.items); message(`${total} matching claim${total === 1 ? "" : "s"}${canReview ? "" : " · Review actions are unavailable to your role"}`); updatePagination(); return true;
      } catch (error) { if (!destroyed && revision === generation) message(error.message, true); return false; }
      finally { if (!destroyed && revision === generation) setBusy(false); }
    }
    function decision(claim, action) {
      if (busy || activeDialog || !canReview) return;
      const previousFocus = document.activeElement; const dialog = make("dialog", undefined, "staff-claim-dialog"); activeDialog = dialog; const form = make("form"); const title = make("h3", action === "approve" ? "Approve this server claim?" : "Decline this server claim?"); title.id = "staff-claim-decision-heading"; dialog.setAttribute("aria-labelledby", title.id);
      const note = action === "approve" ? claim.verificationStatus === "verified" ? "The linked Discord owner is verified. Approve only when the submitted evidence also supports ownership of this game server." : "This claim has not passed Discord owner verification. Review independent ownership evidence before approving." : "The claimant will see your reason. Explain what is missing or why this request cannot be approved.";
      const label = make("label", undefined, "field-v3"); const reason = make("textarea"); reason.name = "reason"; reason.required = true; reason.minLength = 5; reason.maxLength = 500; reason.rows = 4; label.append(make("span", "Reason for this decision"), reason, make("small", "5–500 characters. Recorded in the staff audit history.", "staff-claims-help"));
      const actions = make("div", undefined, "staff-claims-actions"); const cancel = button("Cancel"); const submit = button(action === "approve" ? "Approve ownership" : "Decline claim", action === "approve"); submit.type = "submit"; actions.append(cancel, submit);
      const feedback = make("p", "", "staff-claims-status"); feedback.setAttribute("role", "status"); form.append(title, make("p", `${claim.serverName || "Server listing"} · ${claim.claimantName || "Claimant"}`, "staff-claims-copy"), make("p", note, "staff-claim-verification-note"), label, actions, feedback); dialog.append(form); document.body.append(dialog);
      let saving = false;
      const close = () => { if (saving) return; dialog.close(); dialog.remove(); activeDialog = null; previousFocus?.focus(); };
      cancel.addEventListener("click", close); dialog.addEventListener("cancel", (event) => { event.preventDefault(); close(); });
      form.addEventListener("submit", async (event) => {
        event.preventDefault(); if (saving || !form.reportValidity()) return; saving = true; submit.disabled = true; cancel.disabled = true; reason.disabled = true; feedback.textContent = "Recording decision…"; feedback.dataset.error = "false";
        try {
          await api("/api/admin/server-claims", { method: "POST", body: JSON.stringify({ id: claim.id, expectedVersion: claim.version, decision: action, reason: reason.value.trim() }) });
          saving = false; close(); if (!destroyed) { if (await refresh()) message(action === "approve" ? "Claim approved. Listing ownership has been assigned." : "Claim declined. The decision is recorded."); else { records.replaceChildren(); message("The decision was recorded, but claims could not refresh. Refresh claims before continuing.", true); } }
        } catch (error) { feedback.textContent = error.message; feedback.dataset.error = "true"; }
        finally { saving = false; submit.disabled = false; cancel.disabled = false; reason.disabled = false; }
      });
      dialog.showModal(); reason.focus();
    }
    filters.addEventListener("submit", (event) => { event.preventDefault(); if (!busy) { offset = 0; void refresh(); } });
    statusFilter.addEventListener("change", () => { offset = 0; void refresh(); }); verificationFilter.addEventListener("change", () => { offset = 0; void refresh(); }); reload.addEventListener("click", () => { if (!busy) void refresh(); });
    previous.addEventListener("click", () => { if (!busy && offset) { offset = Math.max(0, offset - 25); void refresh(); } }); next.addEventListener("click", () => { if (!busy && offset + 25 < total) { offset += 25; void refresh(); } });
    await refresh();
    return { refresh, destroy() { destroyed = true; generation += 1; activeDialog?.close(); activeDialog?.remove(); activeDialog = null; root.replaceChildren(); } };
  }
  window.BrowseRPStaffClaims = Object.freeze({ init, evidenceLink });
})();
