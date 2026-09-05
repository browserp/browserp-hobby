(() => {
  "use strict";
  const F = window.BrowseRPModerationFilters;
  const $ = (selector, root = document) => root.querySelector(selector);
  const make = (tag, text, className = "") => { const element = document.createElement(tag); if (text !== undefined) element.textContent = String(text); if (className) element.className = className; return element; };
  const number = new Intl.NumberFormat("en-GB");
  const date = (value) => { const parsed = new Date(value); return value && Number.isFinite(parsed.getTime()) ? new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(parsed) + " UTC" : "Not recorded"; };
  const human = (value) => String(value ?? "").replace(/[_-]/g, " ");
  const hasCount = (value) => typeof value === "number" && Number.isFinite(value) && value >= 0;
  const META = {
    summary: ["Summary", "An overview of the records and decisions available to your role.", null, null],
    members: ["Members", "Find registered accounts, inspect their profile and update approved account details.", "readMembers", "members"],
    servers: ["Servers", "Find and manage listings using their game, location, language and community features.", "readServers", "servers"],
    claims: ["Server claims", "Review ownership requests and filter verified Discord community owners.", "reviewClaims", null],
    reports: ["Reports", "Review active reports and their history. Deleted reports remain recoverable and audited.", "readReports", "reports"],
    queue: ["Listing reviews", "Review submitted server listings and record a decision.", "readListings", "listings"],
    content: ["Content reviews", "Review content and comments flagged for a moderation decision.", "readQueue", "queue"],
    profiles: ["Profiles", "Screen profile content before it appears publicly.", "reviewProfiles", "profiles"],
    activity: ["Account activity", "Inspect recorded account and sign-in events, with protected network evidence handled separately.", "readActivity", "activity"],
    staff: ["Staff & roles", "Create roles, assign staff and manage individual permission exceptions.", "manageStaff", "staff"],
    bans: ["Bans", "Review account, IP and browser/device restrictions. Handle security signals in Website risks.", "manageBans", "bans"],
    appeals: ["Appeals", "Review requests to restore access and record your decision.", "reviewAppeals", "appeals"],
    security: ["Website risks", "Investigate recorded site-wide security signals, MFA controls and protected evidence requests.", "readSecurity", "security"],
    logs: ["Logs", "Search recorded staff audit events. Account activity and security signals have their own sections.", "readAudit", "audit"]
  };
  const ACTIVE_VIEWS = ["reports", "queue", "content", "profiles", "bans", "appeals", "security"];
  const LABELS = { q: "Search", status: "Status", platform: "Game", region: "Region", language: "Language", mode: "Framework / mode", feature: "Feature / tag", access: "Access", online: "Online now", verified: "Verified", beginner: "Beginner friendly", from: "From", to: "To", severity: "Severity", targetType: "Target", userId: "Account ID" };
  const FALLBACKS = { reports: [["active", "Active"], ["history", "History"], ["deleted", "Deleted"], ["open", "Open"], ["triaged", "Triaged"], ["resolved", "Resolved"], ["dismissed", "Dismissed"]], servers: ["draft", "pending_review", "published", "suspended", "rejected", "archived"], queue: ["pending_review", "approved", "changes_requested", "rejected"], content: ["open", "claimed", "resolved"], profiles: ["pending_review", "approved", "rejected"], bans: ["active", "revoked"], appeals: ["submitted", "under_review", "approved", "denied"], security: ["open", "resolved"] };
  let active = null;
  function button(text, primary = false) { const element = make("button", text, `button-v3 ${primary ? "button-primary-v3" : "button-secondary-v3"}`); element.type = "button"; return element; }
  function field(label, name, { value = "", type = "text", required = false, minLength, maxLength, options = [], wide = false } = {}) {
    const wrapper = make("label", undefined, `field-v3${wide ? " moderation-editor-wide" : ""}`);
    const control = make(type === "textarea" ? "textarea" : type === "select" ? "select" : "input");
    if (control.tagName === "INPUT") control.type = type;
    control.name = name; control.required = required;
    if (minLength !== undefined) control.minLength = minLength;
    if (maxLength !== undefined) control.maxLength = maxLength;
    if (type === "select") for (const option of options) { const item = make("option", option.label ?? human(option.value)); item.value = option.value; control.append(item); }
    control.value = value ?? ""; wrapper.append(make("span", label), control); return { wrapper, control };
  }
  function safeLink(value) { try { const url = new URL(value, location.origin); return ["https:", "http:"].includes(url.protocol) ? url.href : null; } catch { return null; } }

  async function init({ api, onAuthFailure, actions = {} } = {}) {
    if (typeof api !== "function" || !F) throw new Error("The authorised moderation API is required.");
    if (!$("#moderation-workspace")) return null;
    active?.destroy();
    const initial = F.parse(location.hash);
    const state = { ...initial, summary: null, permissions: {}, keys: [], workspace: null, cursors: [null], request: 0, destroyed: false, busy: false, debounce: null, mountedStaff: false };
    const root = $("#moderation-content");
    const removers = [];
    let claimsController = null;
    const listen = (node, event, callback) => { node.addEventListener(event, callback); removers.push(() => node.removeEventListener(event, callback)); };
    const key = (name) => state.keys.includes(name);
    const allowed = (view) => view === "summary" || (view === "claims" ? key("servers.claims.review") || state.summary?.permissions?.isOwner === true : view === "staff" ? state.permissions.manageStaff || state.permissions.manageRoles : view === "queue" ? state.permissions.readListings || key("servers.review") : state.permissions[META[view]?.[2]]) === true;
    const status = (message, error = false) => { const target = $("#moderation-live-status"); target.textContent = message; target.dataset.error = String(error); };
    const busy = (value) => { state.busy = value; root.setAttribute("aria-busy", String(value)); $("#moderation-refresh").disabled = value; };
    const empty = (title, description) => { const box = make("div", undefined, "moderation-empty"); box.append(make("h3", title), make("p", description)); return box; };
    function updateUrl(replace = true) { const hash = F.serialize(state.view, state.filters); if (replace) history.replaceState(null, "", `${location.pathname}${location.search}${hash}`); else location.hash = hash; }
    function renderTabs() {
      $("#moderation-tabs").replaceChildren(...Object.keys(META).filter(allowed).map((view) => {
        const item = make("a", META[view][0]); item.href = F.serialize(view); if (view === state.view) item.setAttribute("aria-current", "page");
        const count = state.summary?.counts?.[META[view][3]]; if (hasCount(count)) item.append(make("span", number.format(count), "moderation-tab-count")); return item;
      }));
    }
    function heading(view) { const header = make("div", undefined, "moderation-section-head"); const copy = make("div"); copy.append(make("h2", META[view][0]), make("p", META[view][1])); header.append(copy); return header; }
    function summary() {
      root.replaceChildren(heading("summary"));
      const cards = make("div", undefined, "moderation-summary-grid");
      for (const view of ["reports", "members", "servers", "claims", "queue", "content", "profiles", "activity", "staff", "appeals", "logs"].filter(allowed)) {
        const card = make("a", undefined, "moderation-summary-card"); card.href = F.serialize(view); const count = state.summary?.counts?.[META[view][3]];
        card.append(make("span", META[view][0]), make("strong", hasCount(count) ? number.format(count) : view === "claims" ? "Review" : "—"), make("p", META[view][1])); cards.append(card);
      }
      if (cards.childElementCount) root.append(cards); else root.append(empty("No moderation access assigned", "Your account can open this workspace, but has not been assigned any record permissions."));
      if (allowed("security") || allowed("bans")) {
        const risks = make("section", undefined, "moderation-risk-panel"); risks.append(make("h3", "Website safety"), make("p", "Security signals and access restrictions are separate. Investigate website risks, review a restriction, or handle an appeal from the appropriate section.")); const links = make("div", undefined, "moderation-risk-links");
        for (const view of ["security", "bans", "appeals"].filter(allowed)) { const link = make("a", META[view][0], "button-v3 button-secondary-v3"); link.href = F.serialize(view); links.append(link); } risks.append(links); root.append(risks);
      }
    }
    function facetOptions(name, includeAll = true) {
      const list = state.workspace?.facets?.[name] || [];
      const options = list.map((item) => typeof item === "string" ? { value: item, label: human(item) } : { value: String(item.value ?? ""), label: `${item.label || human(item.value)}${hasCount(item.count) ? ` (${number.format(item.count)})` : ""}` });
      if (!options.length && name === "status") for (const item of FALLBACKS[state.view] || []) options.push(Array.isArray(item) ? { value: item[0], label: item[1] } : { value: item, label: human(item) });
      if (name === "status" && ACTIVE_VIEWS.includes(state.view)) {
        const groups = [{ value: "active", label: "Active" }, { value: "history", label: "History" }, ...(state.view === "reports" ? [{ value: "deleted", label: "Deleted" }] : [])];
        for (const group of groups.reverse()) if (!options.some((item) => item.value === group.value)) options.unshift(group);
      }
      const selected = state.filters[name]; if (selected && !options.some((option) => option.value === selected)) options.push({ value: selected, label: human(selected) });
      return [...(includeAll ? [{ value: name === "status" ? "all" : "", label: `All ${name === "status" ? "statuses" : name === "access" ? "access types" : `${LABELS[name]?.toLowerCase() || name}s`}` }] : []), ...options];
    }
    function applyFilter(name, value) {
      state.filters = F.change(state.view, state.filters, name, value); state.cursors = [null]; updateUrl(); void loadRecords();
    }
    function renderFilters() {
      const form = make("form", undefined, "moderation-filter"); form.setAttribute("aria-label", `${META[state.view][0]} filters`);
      const row = make("div", undefined, "moderation-search-row"); const label = make("label", undefined, "moderation-search-label"); const search = make("input"); search.type = "search"; search.name = "q"; search.value = state.filters.q || ""; search.maxLength = 200; search.placeholder = state.view === "servers" ? "Search names, descriptions or community features…" : state.view === "members" ? "Search name, BrowseRP ID or Discord ID…" : "Search these records…"; label.append(make("span", `Search ${META[state.view][0].toLowerCase()}`), search); const submit = button("Search", true); submit.type = "submit"; const clear = button("Clear filters"); clear.addEventListener("click", () => { state.filters = {}; state.cursors = [null]; updateUrl(); void loadRecords(); }); row.append(label, submit, clear); form.append(row);
      form.addEventListener("submit", (event) => { event.preventDefault(); clearTimeout(state.debounce); applyFilter("q", search.value); });
      const suggestions = make("div", undefined, "moderation-suggestions"); suggestions.setAttribute("aria-label", "Matching filters"); form.append(suggestions);
      search.addEventListener("input", () => {
        clearTimeout(state.debounce); suggestions.replaceChildren();
        const query = search.value.trim().toLowerCase();
        if (state.view === "servers" && query.length > 1) for (const name of ["platform", "region", "mode", "language"]) {
          for (const option of facetOptions(name, false).filter((item) => item.label.toLowerCase().includes(query)).slice(0, 2)) {
            const suggestion = make("button", `${LABELS[name]}: ${option.label}`); suggestion.type = "button"; suggestion.addEventListener("click", () => { clearTimeout(state.debounce); state.filters = F.change(state.view, { ...state.filters, q: "" }, name, option.value); state.cursors = [null]; updateUrl(); void loadRecords(); }); suggestions.append(suggestion);
          }
        }
        state.debounce = setTimeout(() => applyFilter("q", search.value), 450);
      });
      const primary = make("div", undefined, "moderation-filter-grid");
      const names = state.view === "servers" ? ["platform", "region", "mode"] : ["members", "reports", "queue", "content", "profiles", "bans", "appeals", "security"].includes(state.view) ? ["status"] : [];
      const select = (name, options) => { const item = field(LABELS[name], name, { value: state.filters[name] || (name === "status" ? ACTIVE_VIEWS.includes(state.view) ? "active" : "all" : ""), type: "select", options: options || facetOptions(name) }); item.control.addEventListener("change", () => applyFilter(name, item.control.value)); return item.wrapper; };
      for (const name of names) primary.append(select(name));
      if (state.view === "security") primary.append(select("severity", [{ value: "", label: "All severities" }, ...["low", "medium", "high", "critical"].map((value) => ({ value, label: human(value) }))]));
      if (state.view === "bans") primary.append(select("targetType", [{ value: "", label: "All restriction types" }, { value: "account", label: "Account" }, { value: "network_prefix", label: "IP address" }, { value: "device", label: "Browser/device token" }]));
      if (primary.childElementCount) form.append(primary);
      const advanced = make("details"); advanced.append(make("summary", "More filters")); const grid = make("div", undefined, "moderation-filter-grid");
      if (state.view === "servers") {
        for (const name of ["status", "language", "access"]) grid.append(select(name));
        const feature = field(LABELS.feature, "feature", { value: state.filters.feature || "", maxLength: 120 }); feature.control.addEventListener("change", () => applyFilter("feature", feature.control.value)); grid.append(feature.wrapper);
      }
      if (state.view === "queue") grid.append(select("platform"));
      for (const name of ["from", "to"]) { const item = field(`${LABELS[name]} date (UTC)`, name, { value: state.filters[name] || "", type: "date" }); item.control.addEventListener("change", () => applyFilter(name, item.control.value)); grid.append(item.wrapper); }
      if (["activity", "logs", "reports", "bans", "security"].includes(state.view)) { const account = field("Account ID", "userId", { value: state.filters.userId || "", maxLength: 80 }); account.control.addEventListener("change", () => applyFilter("userId", account.control.value)); grid.append(account.wrapper); }
      advanced.append(grid);
      if (state.view === "servers") { const flags = make("div", undefined, "moderation-filter-booleans"); for (const name of ["online", "verified", "beginner"]) { const label = make("label"); const control = make("input"); control.type = "checkbox"; control.name = name; control.checked = state.filters[name] === "true"; control.addEventListener("change", () => applyFilter(name, control.checked ? "true" : "")); label.append(control, make("span", LABELS[name])); flags.append(label); } advanced.append(flags); }
      advanced.open = Object.keys(state.filters).some((key) => !["q", ...names, "severity", "targetType"].includes(key)); form.append(advanced);
      const chips = make("div", undefined, "moderation-filter-chips");
      for (const [name, value] of Object.entries(state.filters)) { const chip = make("button", `${LABELS[name] || name}: ${value === "true" ? "Yes" : human(value)} ×`, "moderation-chip"); chip.type = "button"; chip.setAttribute("aria-label", `Remove ${LABELS[name] || name} filter`); chip.addEventListener("click", () => applyFilter(name, "")); chips.append(chip); } form.append(chips);
      return form;
    }
    function addAction(container, text, callback, permitted = true) { if (!permitted || !callback) return; const item = button(text); item.addEventListener("click", async () => { item.disabled = true; try { await callback(); if (!state.destroyed) await loadRecords(); } catch (error) { status(error.message || "The action could not be completed.", true); } finally { item.disabled = false; } }); container.append(item); }
    function details(record, fields) {
      const disclosure = make("details", undefined, "moderation-details"); disclosure.append(make("summary", "View full details")); const list = make("dl", undefined, "moderation-detail-grid");
      for (const [name, label] of fields) {
        const value = record[name]; const item = make("div"); const definition = make("dd");
        const text = value === undefined || value === null || value === "" ? "Not recorded" : typeof value === "boolean" ? value ? "Yes" : "No" : typeof value === "object" ? JSON.stringify(value, null, 2) : /(?:At|Date)$/.test(name) ? date(value) : String(value);
        if (/Url$/.test(name) && value && safeLink(value)) { const link = make("a", text); link.href = safeLink(value); link.target = "_blank"; link.rel = "noopener noreferrer"; definition.append(link); } else definition.textContent = text;
        item.append(make("dt", label), definition); list.append(item);
      }
      disclosure.append(list); return disclosure;
    }
    function recordCard(record) {
      const kind = state.view;
      const card = make("article", undefined, "moderation-record");
      const head = make("div", undefined, "moderation-record-head"); const copy = make("div", undefined, "moderation-record-title");
      const title = kind === "reports" ? record.category || "Member report" : kind === "logs" ? human(record.action || record.eventType || "Audit event") : kind === "activity" || kind === "security" ? human(record.eventType || record.title || "Recorded event") : kind === "bans" || kind === "appeals" ? record.reference || "Access restriction" : record.name || record.displayName || record.username || record.title || human(record.targetType || "Record");
      copy.append(make("h3", title));
      const meta = kind === "servers" || kind === "queue" ? [record.platform, record.region, record.language, record.framework, record.access].filter(Boolean).map(human).join(" · ") : [record.displayName !== title ? record.displayName : "", record.username ? `@${record.username}` : "", record.reporterName ? `Reported by ${record.reporterName}` : "", record.provider, date(record.createdAt || record.joinedAt)].filter(Boolean).join(" · ");
      copy.append(make("p", meta, "moderation-record-meta")); head.append(copy);
      const recordStatus = record.deletedAt ? "deleted" : record.status || (kind === "members" ? Number(record.activeBans) > 0 ? "banned" : record.staffStatus === "active" ? "staff" : "active" : record.severity || record.bioStatus || "");
      if (recordStatus) { const badge = make("span", human(recordStatus), "moderation-state"); badge.dataset.state = recordStatus; head.append(badge); } card.append(head);
      const body = record.details || record.description || record.statement || record.reason || record.bio;
      if (body) card.append(make("p", typeof body === "string" ? body.slice(0, 320) + (body.length > 320 ? "…" : "") : JSON.stringify(body), "moderation-record-copy"));
      const actionsRoot = make("div", undefined, "moderation-record-actions");
      if (kind === "members") {
        addAction(actionsRoot, "Edit member", () => edit(record, "member"), state.permissions.editMembers);
        if (state.permissions.readActivity) { const activity = make("a", "View activity", "button-v3 button-secondary-v3"); activity.href = F.serialize("activity", { userId: record.userId || record.id }); actionsRoot.append(activity); }
        addAction(actionsRoot, "End sessions", actions.revokeSessions ? () => actions.revokeSessions({ ...record, userId: record.userId || record.id }) : null, key("accounts.sessions.revoke"));
      }
      if (kind === "servers") {
        if (record.status === "published" && record.slug) { const link = make("a", "View server ↗", "button-v3 button-secondary-v3"); link.href = `/server/${encodeURIComponent(record.slug)}`; link.target = "_blank"; link.rel = "noopener"; actionsRoot.append(link); }
        addAction(actionsRoot, "Edit server", () => edit(record, "server"), state.permissions.editServers);
      }
      if (kind === "reports") {
        addAction(actionsRoot, "Review report", actions.openReview ? () => actions.openReview({ ...record, kind: "report" }) : null, !record.deletedAt && ["open", "triaged"].includes(record.status) && key("reports.resolve"));
        addAction(actionsRoot, record.deletedAt ? "Restore report" : "Delete report", () => reportAction(record, record.deletedAt ? "restore" : "delete"), state.permissions.manageReports);
      }
      if (kind === "queue" || kind === "content") addAction(actionsRoot, "Review item", actions.openReview ? () => actions.openReview({ ...record, kind: kind === "queue" ? "listing" : "moderation", target_type: record.targetType || record.target_type }) : null, kind === "queue" ? ["pending", "pending_review", "changes_requested"].includes(record.status) && key("servers.review") : ["open", "claimed"].includes(record.status) && (state.permissions.manageQueue || key("moderation.resolve")));
      if (kind === "profiles" && record.bioStatus === "pending_review") for (const action of ["approve", "reject"]) addAction(actionsRoot, `${action === "approve" ? "Approve" : "Reject"} bio`, actions.reviewProfile ? () => actions.reviewProfile(record.userId || record.id, "bio", action) : null, state.permissions.reviewProfiles);
      if (kind === "activity") {
        addAction(actionsRoot, "Apply restriction", actions.applyBan ? () => actions.applyBan(record) : null, state.permissions.manageBans);
        addAction(actionsRoot, "End sessions", actions.revokeSessions ? () => actions.revokeSessions(record) : null, record.userId && key("accounts.sessions.revoke"));
        addAction(actionsRoot, "View protected IP", actions.viewNetwork ? () => actions.viewNetwork(record.id, record.requestId || null) : null, key("security.network.approve") || record.networkRevealApproved === true);
        addAction(actionsRoot, "Request protected IP", actions.networkRequest ? () => actions.networkRequest(record.id) : null, key("security.network.request") && !key("security.network.approve") && !record.networkRevealApproved);
      }
      if (kind === "security") addAction(actionsRoot, "Resolve signal", actions.resolveSecurityFlag ? () => actions.resolveSecurityFlag(record) : null, !record.resolvedAt && state.permissions.readSecurity);
      if (kind === "bans") addAction(actionsRoot, "Revoke restriction", actions.revokeBan ? () => actions.revokeBan(record) : null, !record.revokedAt && record.status !== "revoked" && state.permissions.manageBans);
      if (kind === "appeals" && ["submitted", "under_review"].includes(record.status)) for (const approved of [true, false]) addAction(actionsRoot, approved ? "Approve appeal" : "Deny appeal", actions.decideAppeal ? () => actions.decideAppeal(record.id, approved) : null, state.permissions.reviewAppeals && state.permissions.manageBans);
      card.append(actionsRoot);
      const common = [["id", "Record ID"], ["createdAt", "Created"], ["updatedAt", "Updated"]];
      const specific = {
        members: [["userId", "Account ID"], ["discordId", "Discord user ID"], ["username", "Username"], ["displayName", "Display name"], ["bio", "Bio"], ["visibility", "Profile visibility"], ["joinedAt", "Joined"], ["lastSignInAt", "Last sign-in"], ["provider", "Sign-in provider"], ["staffRole", "Staff role"], ["activeBans", "Active restrictions"]],
        servers: [["name", "Name"], ["platform", "Game"], ["region", "Region"], ["language", "Language"], ["framework", "Framework"], ["access", "Access"], ["description", "Description"], ["tags", "Features"], ["ownerName", "Owner"], ["ownerId", "Owner account"], ["communityUrl", "Community URL"], ["websiteUrl", "Website URL"], ["cfxJoinUrl", "Cfx join link (FiveM / RedM)"], ["verified", "Verified"], ["beginnerFriendly", "Beginner friendly"], ["online", "Online"]],
        reports: [["reporterName", "Reporter"], ["reporterId", "Reporter account"], ["targetType", "Target type"], ["targetId", "Target ID"], ["details", "Report details"], ["resolutionNote", "Resolution note"], ["deletedAt", "Deleted at"], ["deletedReason", "Deletion reason"]],
        activity: [["userId", "Account ID"], ["eventType", "Event"], ["maskedNetwork", "Masked network"], ["browser", "Browser"], ["os", "Operating system"], ["device", "Device category"], ["details", "Recorded details"]],
        logs: [["actorName", "Staff member"], ["actorId", "Staff account"], ["action", "Action"], ["targetType", "Target type"], ["targetId", "Target ID"], ["reason", "Reason"], ["details", "Recorded details"]],
        security: [["eventType", "Signal"], ["actorId", "Account ID"], ["severity", "Severity"], ["details", "Recorded details"], ["resolvedAt", "Resolved at"]],
        bans: [["reference", "Reference"], ["targetType", "Restriction type"], ["scope", "Scope"], ["reason", "Reason"], ["endsAt", "Ends"], ["revokedAt", "Revoked"]],
        appeals: [["reference", "Restriction reference"], ["statement", "Appeal statement"], ["userId", "Account ID"], ["decisionNote", "Decision note"]],
        profiles: [["userId", "Account ID"], ["bio", "Bio"], ["bioStatus", "Bio status"], ["avatarStatus", "Avatar status"], ["avatarUrl", "Current avatar"], ["createdAt", "Joined"]],
        queue: [["platform", "Game"], ["region", "Region"], ["language", "Language"], ["framework", "Framework"], ["description", "Description"]],
        content: [["targetType", "Content type"], ["targetId", "Content ID"], ["confidence", "Review confidence"], ["details", "Details"]]
      };
      card.append(details(record, [...(specific[kind] || []), ...common])); return card;
    }
    function modal(title, description, build, saveLabel, save) {
      return new Promise((resolve) => {
        const dialog = make("dialog", undefined, "staff-dialog-v3 moderation-editor"); const form = make("form", undefined, "staff-dialog-card-v3"); const heading = make("h2", title); heading.id = "moderation-editor-title"; dialog.setAttribute("aria-labelledby", heading.id); form.append(heading, make("p", description, "staff-dialog-copy-v3"));
        const fields = make("div", undefined, "moderation-editor-fields"); const controls = build(fields); form.append(fields);
        const reason = field("Reason for this change", "reason", { type: "textarea", required: true, minLength: 5, maxLength: 500 }); form.append(reason.wrapper);
        const note = make("p", "", "staff-form-status-v3"); note.setAttribute("role", "status");
        const actionsRoot = make("div", undefined, "staff-dialog-actions-v3"); const cancel = button("Cancel"); const submit = button(saveLabel, true); submit.type = "submit"; actionsRoot.append(cancel, submit); form.append(note, actionsRoot); dialog.append(form); document.body.append(dialog);
        let saving = false; let closed = false;
        const finish = (saved) => { if (closed) return; closed = true; dialog.close(); dialog.remove(); resolve(saved); };
        cancel.addEventListener("click", () => { if (!saving) finish(false); });
        dialog.addEventListener("cancel", (event) => { event.preventDefault(); if (!saving) finish(false); });
        form.addEventListener("submit", async (event) => {
          event.preventDefault(); if (saving || !form.reportValidity()) return;
          saving = true; submit.disabled = true; cancel.disabled = true; form.setAttribute("aria-busy", "true"); note.textContent = "Saving…";
          try { await save(controls, reason.control.value); finish(true); status("Change saved. The decision was added to the staff audit log."); }
          catch (error) { note.textContent = error.status === 409 ? "This record changed while you were editing. Cancel and refresh before trying again. Your changes have not been applied." : error.message || "The change could not be saved. Please try again."; if (error.status === 401 && onAuthFailure) { finish(false); onAuthFailure(error); } }
          finally { saving = false; submit.disabled = false; cancel.disabled = false; form.removeAttribute("aria-busy"); }
        });
        dialog.showModal(); $("input,select,textarea", form)?.focus();
      });
    }
    function edit(record, kind) {
      return modal(kind === "member" ? "Edit member" : "Edit server", "Update this record and explain the change. The current version is checked before saving so another staff member’s work cannot be overwritten.", (grid) => {
        const controls = {};
        const add = (label, name, options = {}) => { const item = field(label, name, { value: record[name] ?? "", ...options }); controls[name] = item.control; grid.append(item.wrapper); };
        if (kind === "member") {
          add("Display name", "displayName", { required: true, minLength: 2, maxLength: 48 });
          add("Profile visibility", "visibility", { type: "select", required: true, options: ["public", "members", "private"].map((value) => ({ value, label: human(value) })) });
          add("Bio", "bio", { type: "textarea", maxLength: 500, wide: true });
        } else {
          add("Server name", "name", { required: true, minLength: 3, maxLength: 80, wide: true });
          const games = [...new Set(["fivem", "redm", "roblox", "minecraft", ...facetOptions("platform", false).map((item) => item.value), record.platform].filter(Boolean))];
          add("Game", "platform", { type: "select", required: true, options: games.map((value) => ({ value, label: ({ fivem: "FiveM", redm: "RedM", roblox: "Roblox", minecraft: "Minecraft" })[value] || human(value) })) });
          add("Region", "region", { required: true, minLength: 2, maxLength: 60 });
          add("Language", "language", { required: true, minLength: 2, maxLength: 60 });
          add("Framework / mode", "framework", { maxLength: 80 });
          add("Access", "access", { type: "select", required: true, options: [{ value: "public", label: "Public" }, { value: "allowlisted", label: "Allowlisted" }, { value: "application", label: "Application" }, { value: "unknown", label: "Not confirmed" }] });
          add("Listing status", "status", { type: "select", required: true, options: FALLBACKS.servers.map((value) => ({ value, label: human(value) })) });
          add("Description", "description", { type: "textarea", required: true, minLength: 40, maxLength: 3000, wide: true });
          add("Community URL", "communityUrl", { type: "url", maxLength: 500 });
          add("Website URL", "websiteUrl", { type: "url", maxLength: 500 });
          add("Cfx join link (FiveM / RedM)", "cfxJoinUrl", { type: "url", maxLength: 100, wide: true });
          for (const [name, label] of [["verified", "Owner verified"], ["beginnerFriendly", "Beginner friendly"]]) {
            const wrapper = make("label", undefined, "moderation-filter-booleans"); const input = make("input"); input.type = "checkbox"; input.name = name; input.checked = record[name] === true; controls[name] = input;
            const copy = make("span", label);
            if (name === "verified") {
              const help = make("small", "Confirms ownership of the listing, not server quality.", "staff-dialog-copy-v3"); help.id = "moderation-owner-verified-help";
              input.setAttribute("aria-describedby", help.id); copy.append(make("br"), help);
            }
            wrapper.append(input, copy); grid.append(wrapper);
          }
        }
        return controls;
      }, "Save changes", async (controls, reason) => {
        if (!Number.isSafeInteger(record.version) || record.version < 1) throw new Error("This record has no current version. Refresh the list before editing.");
        const data = {}; for (const [name, input] of Object.entries(controls)) data[name] = input.type === "checkbox" ? input.checked : input.value.trim();
        await api("/api/admin/moderation", { method: "POST", body: JSON.stringify({ kind, id: record.id, action: "edit", data, expectedVersion: record.version, reason }) });
      });
    }
    function reportAction(record, action) {
      return modal(action === "delete" ? "Delete report" : "Restore report", action === "delete" ? "This moves the report into Deleted. Its evidence and audit history are retained, and authorised staff can restore it." : "This restores the report with its previous status and retains the deletion history.", () => ({}), action === "delete" ? "Move to Deleted" : "Restore report", async (_, reason) => {
        if (!Number.isSafeInteger(record.version) || record.version < 1) throw new Error("Refresh this report before changing it.");
        await api("/api/admin/moderation", { method: "POST", body: JSON.stringify({ kind: "report", id: record.id, action, expectedVersion: record.version, reason }) });
      });
    }
    function preserveFocus(callback) {
      const element = document.activeElement; const name = element?.closest?.(".moderation-filter") ? element.name : null; const start = element?.selectionStart; const end = element?.selectionEnd;
      callback();
      if (name) { const next = $(`[name="${name}"]`, root); if (next) { next.focus({ preventScroll: true }); if (typeof start === "number" && typeof next.setSelectionRange === "function" && ["search", "text"].includes(next.type)) next.setSelectionRange(start, end); } }
    }
    async function renderRecords(workspace) {
      preserveFocus(() => {
        root.replaceChildren(heading(state.view), renderFilters());
        if (state.view === "bans") root.append(make("p", "IP restrictions match the IP address used for the recorded activity; shared connections may be affected. Browser/device restrictions use BrowseRP’s first-party device token.", "moderation-inline-note"));
        if (state.view === "security") { const extra = make("section"); extra.id = "moderation-security-controls"; root.append(extra); }
        const meta = make("p", `${number.format(workspace.items.length)} shown · ${hasCount(workspace.total) ? number.format(workspace.total) : "Unknown"} matching records`, "moderation-result-meta"); root.append(meta);
        const records = make("div", undefined, "moderation-records");
        if (workspace.items.length) records.append(...workspace.items.map(recordCard)); else records.append(empty("No matching records", "Try a different search or clear the filters. No placeholder results are shown.")); root.append(records);
        const paging = make("div", undefined, "moderation-pagination"); const previous = button("← Previous"); previous.disabled = state.cursors.length < 2; previous.addEventListener("click", () => { state.cursors.pop(); void loadRecords(); }); const next = button("Next →"); next.disabled = !workspace.nextCursor; next.addEventListener("click", () => { if (workspace.nextCursor) { state.cursors.push(workspace.nextCursor); void loadRecords(); } }); paging.append(previous, make("span", `Page ${state.cursors.length} · Up to 25 records per page`), next); root.append(paging);
      });
      if (state.view === "security" && actions.securityControls) {
        const mount = $("#moderation-security-controls");
        try { await actions.securityControls(mount, { ...state.permissions, keys: state.keys, isOwner: state.summary?.permissions?.isOwner === true }); }
        catch (error) { if (mount.isConnected) mount.append(make("p", `Security controls could not load: ${error.message}`, "moderation-inline-note")); }
      }
    }
    async function renderStaff() {
      if (state.mountedStaff && $("#overview-roles", root)) return;
      root.replaceChildren(heading("staff")); const roles = make("section", undefined, "moderation-staff-box"); roles.id = "overview-roles"; root.append(roles);
      const permissions = make("section", undefined, "moderation-staff-box");
      if (key("staff.permissions.manage")) {
        permissions.append(make("h3", "Individual permission overrides"), make("p", "Use the role default unless this person needs a specific exception. Every change requires a reason."));
        const form = make("form", undefined, "staff-form-v3"); form.id = "permission-form-v3";
        const user = field("Staff member", "staffMember", { type: "select", required: true }); user.control.id = "permission-user";
        const grid = make("div", undefined, "permission-grid-v3"); grid.id = "permission-grid-v3";
        const reason = field("Reason for this change", "reason", { type: "textarea", required: true, minLength: 5, maxLength: 500 }); const save = button("Save permission overrides", true); save.type = "submit"; form.append(user.wrapper, grid, reason.wrapper, save); permissions.append(form); root.append(permissions);
      }
      const tasks = [];
      if (window.BrowseRPStaffRoles) tasks.push(window.BrowseRPStaffRoles.init({ api, permissions: { manageRoles: state.permissions.manageRoles } }));
      if (actions.permissionOverrides && key("staff.permissions.manage")) tasks.push(actions.permissionOverrides());
      const results = await Promise.allSettled(tasks);
      for (const result of results) if (result.status === "rejected") root.append(make("p", `Some staff controls could not load: ${result.reason?.message || "Please refresh."}`, "moderation-inline-note"));
      state.mountedStaff = true;
    }
    async function loadRecords() {
      if (state.destroyed) return null;
      const request = ++state.request; const view = state.view; busy(true);
      if (view !== "claims") { claimsController?.destroy(); claimsController = null; }
      if (!allowed(view)) { root.replaceChildren(empty("Access not assigned", "Your current role does not have permission to view this section.")); busy(false); status("Choose an available section to continue."); return null; }
      try {
        if (view === "summary") { summary(); status(`Updated ${date(state.summary.generatedAt)}`); return state.summary; }
        if (view === "claims") {
          if (claimsController) await claimsController.refresh();
          else {
            const mount = make("section"); root.replaceChildren(mount);
            const controller = await window.BrowseRPStaffClaims.init({ api, root: mount });
            if (state.destroyed || request !== state.request || state.view !== view) { controller?.destroy(); return null; }
            claimsController = controller;
          }
          status("Review requests by status and Discord ownership evidence."); return null;
        }
        if (view === "staff") { await renderStaff(); status("Staff tools ready. Changes are checked by the server."); return null; }
        const payload = await api(F.query(view, state.filters, state.cursors.at(-1)));
        if (state.destroyed || request !== state.request || state.view !== view) return null;
        const workspace = payload.workspace;
        if (!workspace || !Array.isArray(workspace.items)) throw new Error("The workspace response was incomplete. Refresh to try again.");
        state.workspace = workspace; if (workspace.permissions) state.permissions = { ...state.permissions, ...workspace.permissions };
        await renderRecords(workspace);
        if (state.destroyed || request !== state.request || state.view !== view) return null;
        status(`Updated ${date(workspace.generatedAt)} · All dates in UTC`); return workspace;
      } catch (error) {
        if (state.destroyed || request !== state.request) return null;
        if (error.status === 401) { controller.destroy(); root.replaceChildren(empty("Sign in again", "Your staff session has ended.")); onAuthFailure?.(error); return null; }
        if (error.status === 403) { root.replaceChildren(empty("Access not assigned", "Your current role does not have permission to read these records.")); status("Access is checked for every request.", true); return null; }
        status(error.message || "Records could not load. Please refresh.", true);
        root.replaceChildren(heading(view), renderFilters(), empty("Records could not load", "No results are being presented as current. Use Refresh to try again.")); return null;
      } finally { if (!state.destroyed && request === state.request) busy(false); }
    }
    async function refresh() {
      if (state.destroyed) return null;
      busy(true);
      try {
        const { summary: value } = await api("/api/admin/moderation?view=summary");
        if (state.destroyed) return null;
        if (!value || !value.capabilities || !value.counts) throw new Error("The moderation summary is unavailable.");
        state.summary = value; state.permissions = value.capabilities; state.keys = Array.isArray(value.permissions) ? value.permissions : value.permissions?.keys || [];
        renderTabs(); return await loadRecords();
      } catch (error) {
        if (state.destroyed) return null;
        if ([401, 403].includes(error.status)) { controller.destroy(); onAuthFailure?.(error); return null; }
        status(error.message || "The workspace could not load. Please refresh.", true); root.replaceChildren(empty("Workspace unavailable", "Your current records could not be loaded. Use Refresh to try again.")); return null;
      } finally { if (!state.destroyed) busy(false); }
    }
    const controller = { refresh, destroy() { state.destroyed = true; claimsController?.destroy(); claimsController = null; state.request += 1; clearTimeout(state.debounce); removers.forEach((remove) => remove()); if (active === controller) active = null; } };
    active = controller;
    listen(window, "hashchange", () => { clearTimeout(state.debounce); const next = F.parse(location.hash); state.view = next.view; state.filters = next.filters; state.cursors = [null]; state.workspace = null; state.mountedStaff = false; renderTabs(); void loadRecords(); });
    listen(window, "pagehide", () => controller.destroy());
    listen($("#moderation-refresh"), "click", () => { clearTimeout(state.debounce); state.cursors = [null]; void refresh(); });
    await refresh(); return controller;
  }
  window.BrowseRPStaffModeration = Object.freeze({ init });
})();
