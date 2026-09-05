(function () {
  "use strict";
  const kinds = { copy: "A copy of my data", delete: "Account deletion", correction: "A correction to my data" };
  const statuses = { submitted: "Request received", reviewing: "Under review", information_needed: "More information needed", ready: "Ready for follow-up", declined: "Declined", withdrawn: "Withdrawn" };
  const make = (tag, text, className) => { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (className) node.className = className; return node; };
  const button = (text, primary = false) => { const node = make("button", text, `button-v3 ${primary ? "button-primary-v3" : "button-secondary-v3"}`); node.type = "button"; return node; };
  const field = (label, input) => { const node = make("label", undefined, "field-v3"); node.append(make("span", label), input); return node; };
  const select = (name, options) => { const node = make("select"); node.name = name; Object.entries(options).forEach(([value, label]) => { const option = make("option", label); option.value = value; node.append(option); }); return node; };
  const date = value => { const parsed = new Date(value); return Number.isFinite(parsed.getTime()) ? parsed.toLocaleString() : "Date unavailable"; };
  function textArea(name, minimum = 0) { const node = make("textarea"); node.name = name; node.maxLength = 1000; node.minLength = minimum; node.required = minimum > 0; node.rows = 4; return node; }

  function init({ api: request, accountId, root, staff = false, allowed = false, onAuthFailure } = {}) {
    if (!root || typeof request !== "function" || (staff && !allowed)) return null;
    const api = (path, options = {}) => request(path, { ...options, headers: { ...(options.headers || {}), "X-BrowseRP-Account": accountId || "" } });
    root.classList.add("privacy-requests");
    const host = root.matches("details") ? root.querySelector("[data-privacy-requests-content]") : root;
    if (!host) return null;
    let destroyed = false, busy = false, generation = 0, next = null, loaded = false;
    const feedback = make("p", "", "privacy-request-status"); feedback.setAttribute("role", "status"); feedback.tabIndex = -1;
    const controls = make("div", undefined, "privacy-request-controls");
    const list = make("div", undefined, "privacy-request-list");
    const refresh = button("Refresh requests"), more = button("Load more requests"); more.hidden = true;
    const tools = make("div", undefined, "privacy-request-actions"); tools.append(refresh, more);
    const base = staff ? "/api/admin/data-requests" : "/api/me/data-requests";
    const typeFilter = select("kind", { "": "All request types", ...kinds });
    const statusFilter = select("status", { open: "Open requests", all: "All requests", ...statuses });
    const url = (cursor = null) => {
      if (!staff) return base;
      const query = new URLSearchParams({ kind: typeFilter.value, status: statusFilter.value });
      if (cursor) { query.set("before", cursor.createdAt); query.set("beforeId", cursor.id); }
      return `${base}?${query}`;
    };
    const post = value => api(base, { method: "POST", body: JSON.stringify(value) });
    async function run(action, done, pending = "Checking requests…") {
      if (busy || destroyed) return;
      busy = true; const current = generation; host.setAttribute("aria-busy", "true"); feedback.textContent = pending;
      const previous = [...host.querySelectorAll("button,input,textarea,select")].map(node => [node, node.disabled]); previous.forEach(([node]) => { node.disabled = true; });
      try {
        const result = await action();
        if (!destroyed && current === generation) done(result);
      } catch (error) {
        if (!destroyed && current === generation) {
          if ([401, 403].includes(error.status)) {
            list.replaceChildren(); controls.replaceChildren(); next = null; more.hidden = true;
            feedback.textContent = "Sign in again before viewing private requests."; onAuthFailure?.(error);
          } else feedback.textContent = error.message || "Your requests could not be loaded. Try Refresh requests.";
        }
      } finally {
        busy = false;
        if (!destroyed) { host.removeAttribute("aria-busy"); previous.forEach(([node, disabled]) => { if (node.isConnected) node.disabled = disabled; }); }
      }
    }
    function editDetails(item, row) {
      if (row.querySelector("form")) return;
      const form = make("form", undefined, "privacy-request-form"), text = textArea("details", 20); text.value = item.details;
      const send = button("Send updated details", true); send.type = "submit";
      const cancel = button("Cancel"); cancel.addEventListener("click", () => form.remove());
      const actions = make("div", undefined, "privacy-request-actions"); actions.append(send, cancel);
      form.append(field("Your updated request details", text), make("p", "Keep this to what we need to handle your request. Do not include passwords, codes, ID documents or other people's personal information."), actions);
      form.addEventListener("submit", event => { event.preventDefault(); if (!form.reportValidity()) return;
        void run(async () => { await post({ action: "update", id: item.id, version: item.version, details: text.value }); return api(url()); }, payload => { render(payload); feedback.textContent = "Your updated details were sent for review."; }, "Sending your updated details…");
      }); row.append(form); text.focus();
    }
    function staffForm(item) {
      const form = make("form", undefined, "privacy-request-form");
      const decision = select("status", { reviewing: statuses.reviewing, information_needed: "Ask for more information", ready: statuses.ready, declined: "Decline request" });
      if (Object.hasOwn({ reviewing: 1, information_needed: 1, ready: 1 }, item.status)) decision.value = item.status;
      const reply = textArea("reply", 10); reply.value = item.staffReply;
      let key = crypto.randomUUID(); form.addEventListener("input", () => { if (!busy) key = crypto.randomUUID(); });
      const send = button("Record review", true); send.type = "submit";
      form.append(field("Review decision", decision), field("Reply visible to this member", reply),
        make("p", "This records your review. It does not export files, change personal data or delete an account. Ready for follow-up still needs a separate, verified action."), send);
      form.addEventListener("submit", event => { event.preventDefault(); if (!form.reportValidity()) return;
        const body = { id: item.id, version: item.version, status: decision.value, reply: reply.value, key };
        void run(async () => { await post(body); return api(url()); }, payload => { render(payload); feedback.textContent = "Review recorded. No account data was exported or deleted."; feedback.focus({ preventScroll: true }); }, "Recording your review…");
      }); return form;
    }
    function render(payload, append = false) {
      if (!Array.isArray(payload?.items)) throw new Error("Requests could not be confirmed. Try Refresh requests.");
      const rows = payload.items.map(item => {
        const row = make("article", undefined, "privacy-request-card");
        const head = make("div", undefined, "privacy-request-heading"); head.append(make("h3", kinds[item.kind] || "Data request"), make("span", statuses[item.status] || "Status unavailable", "privacy-request-badge")); row.append(head);
        row.append(make("p", `Sent ${date(item.createdAt)} · Updated ${date(item.updatedAt)}`, "privacy-request-date"));
        if (item.status === "ready") row.append(make("p", "Your request has been reviewed and needs follow-up. No data has been exported, corrected or deleted through this form.", "privacy-request-note"));
        const detail = make("details"); detail.append(make("summary", staff ? `View request · ${item.displayName || "Member"}` : "View request details"));
        if (staff) detail.append(make("p", `Account: ${item.accountId}`));
        detail.append(make("p", `Request: ${item.id}`, "privacy-request-reference"));
        if (item.details) detail.append(make("p", item.details, "privacy-request-text"));
        if (item.staffReply) detail.append(make("strong", "Latest staff reply"), make("p", item.staffReply, "privacy-request-text"));
        const closed = ["declined", "withdrawn"].includes(item.status);
        if (staff && !closed) detail.append(staffForm(item));
        if (!staff && !closed) {
          const actions = make("div", undefined, "privacy-request-actions");
          if (["submitted", "information_needed"].includes(item.status)) { const update = button("Update request details"); update.addEventListener("click", () => editDetails(item, detail)); actions.append(update); }
          const withdraw = button("Withdraw request"); withdraw.addEventListener("click", () => { void run(async () => { await post({ action: "withdraw", id: item.id, version: item.version }); return api(url()); }, payload => { render(payload); feedback.textContent = "Request withdrawn. Your account and data stay as they are."; }, "Withdrawing this request…"); }); actions.append(withdraw); detail.append(actions);
        }
        row.append(detail); return row;
      });
      if (append) list.append(...rows); else list.replaceChildren(...rows);
      if (!list.childElementCount) list.append(make("p", staff ? "No requests match these filters." : "You haven’t sent any data requests."));
      next = payload.next || null; more.hidden = !staff || !next; loaded = true; feedback.textContent = "";
    }
    function load(append = false) { const cursor = append ? next : null; return run(() => api(url(cursor)), payload => render(payload, append)); }
    if (staff) {
      controls.append(field("Request type", typeFilter), field("Request status", statusFilter));
      for (const filter of [typeFilter, statusFilter]) filter.addEventListener("change", () => { if (!busy) void load(); });
    } else {
      const form = make("form", undefined, "privacy-request-form"), kind = select("kind", kinds), text = textArea("details");
      let key = crypto.randomUUID();
      const help = make("p", "Tell us what you need. Do not include passwords, authentication codes, ID documents or another person's personal information.");
      const send = button("Send request", true); send.type = "submit";
      kind.addEventListener("change", () => { text.required = kind.value === "correction"; text.minLength = text.required ? 20 : 0; });
      form.addEventListener("input", () => { if (!busy) key = crypto.randomUUID(); });
      form.append(field("What do you need?", kind), field("Details (optional, unless requesting a correction)", text), help,
        make("p", "Sending a request does not immediately change or delete your account. We review ownership, appeals and any security records that may need to be kept."), send);
      form.addEventListener("submit", event => { event.preventDefault(); if (!form.reportValidity()) return;
        const body = { action: "create", kind: kind.value, details: text.value, key };
        void run(async () => { await post(body); return api(url()); }, payload => { key = crypto.randomUUID(); text.value = ""; render(payload); feedback.textContent = "Request received. You can follow its progress below."; }, "Sending your request…");
      }); controls.append(form);
    }
    host.replaceChildren(make("p", staff ? "Private account requests. Only staff granted data-request permission can review this queue. Replies are visible to the member." : "Ask for a copy, correction or deletion of your BrowseRP data and follow your request here. Your most recent 50 requests are shown."), controls, tools, feedback, list);
    refresh.addEventListener("click", () => { void load(); }); more.addEventListener("click", () => { if (next) void load(true); });
    function toggle() { if (root.open && !loaded) void load(); }
    function destroy() {
      if (destroyed) return; destroyed = true; generation++; host.querySelectorAll("textarea,input").forEach(node => { node.value = ""; }); host.replaceChildren();
      root.removeEventListener("toggle", toggle); window.removeEventListener("pagehide", leave); window.removeEventListener("browserp:session-ended", destroy);
    }
    function leave() {
      destroy();
      // Do not restore cached private requests after returning from another
      // page. A fresh navigation rechecks the account before rebuilding them.
      const resume = event => { window.removeEventListener("pageshow", resume); if (event.persisted) location.reload(); };
      window.addEventListener("pageshow", resume);
    }
    window.addEventListener("pagehide", leave); window.addEventListener("browserp:session-ended", destroy);
    if (root.matches("details")) { root.addEventListener("toggle", toggle); if (root.open) void load(); } else void load();
    return { destroy };
  }
  window.BrowseRPPrivacyRequests = Object.freeze({ initMember: options => init({ ...options, staff: false }), initStaff: options => init({ ...options, staff: true }) });
})();
