(() => {
  "use strict";
  const placements = { any: "Help me choose", homepage: "Homepage", directory: "Server directory", game_pages: "Game pages" };
  const statuses = { submitted: "Received", reviewing: "Under review", replied: "Reply available", closed: "Closed", withdrawn: "Withdrawn" };
  const make = (tag, text, className = "") => { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; node.className = className; return node; };
  const button = (text, primary = false) => { const node = make("button", text, `button-v3 ${primary ? "button-primary-v3" : "button-secondary-v3"}`); node.type = "button"; return node; };
  const date = value => Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString() : "Date unavailable";
  const choices = (name, options) => { const control = make("select"); control.name = name; for (const [value, text] of Object.entries(options)) { const option = make("option", text); option.value = value; control.append(option); } return control; };
  const field = (label, control, help = "") => { const node = make("label", undefined, "field-v3"); node.append(make("span", label), control); if (help) node.append(make("small", help)); return node; };
  const input = (name, min, max, multiline = false) => { const node = make(multiline ? "textarea" : "input"); node.name = name; node.minLength = min; node.maxLength = max; node.required = true; if (multiline) node.rows = 5; return node; };
  const active = item => !["closed", "withdrawn"].includes(item.status);
  function destination(value) {
    if (typeof value !== "string" || value.length < 10 || value.length > 1000) return false;
    try {
      const url = new URL(value);
      return url.protocol === "https:" && !url.username && !url.password && !url.port
        && !/[\s\\\u0000-\u001f\u007f]/.test(value)
        && /^https:\/\/[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?(?:[/?#]|$)/i.test(value)
        && /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i.test(url.hostname)
        && !/(?:^|\.)(?:localhost|local|internal|test|invalid|example|lan|home|onion)$/i.test(url.hostname);
    } catch { return false; }
  }
  function init({ api: request, root, accountId, session, staff = false, onAuthFailure } = {}) {
    if (!root || typeof request !== "function" || root.dataset.enquiriesInitialized === "true") return null;
    root.dataset.enquiriesInitialized = "true"; root.classList.add("advertising-enquiries");
    let ended = false, generation = 0, next = null, loading = false, writing = false, pendingWrite = null;
    const drafts = new Map(); let blockedControls = null, canRead = !staff;
    accountId ||= session?.authenticated ? session.user?.id : null;
    const api = (path, options = {}) => request(path, { ...options, headers: { ...(options.headers || {}), "X-BrowseRP-Account": accountId || "" } });
    const base = staff ? "/api/admin/advertising-enquiries" : "/api/me/advertising-enquiries";
    const feedback = make("p", "", "enquiry-feedback"); feedback.setAttribute("role", "status"); feedback.tabIndex = -1;
    const list = make("div", undefined, "enquiry-list"), tools = make("div", undefined, "enquiry-actions"), compose = make("div");
    const refresh = button("Refresh enquiries"), more = button("Load more enquiries"); more.hidden = true;
    const filter = choices("status", { open: "Open enquiries", all: "All enquiries", ...statuses });
    tools.append(refresh); if (staff) { tools.append(field("Show", filter)); refresh.disabled = true; more.disabled = true; filter.disabled = true; } tools.append(more);
    const url = cursor => { const query = new URLSearchParams(); if (staff) query.set("status", filter.value); if (cursor) { query.set("before", cursor.createdAt); query.set("beforeId", cursor.id); } return `${base}${query.size ? `?${query}` : ""}`; };
    function clear() { generation++; pendingWrite = null; blockedControls = null; drafts.clear(); root.querySelectorAll("input,textarea").forEach(node => { node.value = ""; }); compose.replaceChildren(); list.replaceChildren(); tools.replaceChildren(); }
    async function signIn(message = "Sign in to send an enquiry and read private replies here.") {
      clear(); root.replaceChildren(make(staff ? "h3" : "h2", "Advertising enquiries"), make("p", message));
      if (staff) return;
      const current = generation, actions = make("div", undefined, "enquiry-actions"); root.append(actions);
      try {
        const { providers = {} } = await request("/api/auth/providers"); if (ended || current !== generation) return;
        for (const provider of ["discord", "google"]) if (providers[provider] === true) {
          const link = make("a", undefined, `button-v3 ${provider === "discord" ? "button-primary-v3" : "button-secondary-v3"} provider-button-v4 provider-${provider}-v4`);
          link.href = `/api/auth/${provider}?returnTo=%2Fadvertise`;
          const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg"); icon.classList.add("provider-icon-v4"); icon.setAttribute("aria-hidden", "true");
          const use = document.createElementNS("http://www.w3.org/2000/svg", "use"); use.setAttribute("href", `/assets/provider-icons-v4.svg#provider-${provider}`); icon.append(use);
          link.append(icon, make("span", `Continue with ${provider === "discord" ? "Discord" : "Google"}`)); actions.append(link);
        }
        if (!actions.childElementCount) actions.append(make("p", "Sign-in is temporarily unavailable. Please try again later."));
      } catch { if (!ended && current === generation) actions.append(make("p", "Sign-in options could not load. Refresh the page to try again.")); }
    }
    function authFailure(error) { clear(); accountId = null; void signIn("Your account or access has changed. Sign in again to view your enquiries."); onAuthFailure?.(error); }
    function lock(form, value) { for (const node of form.querySelectorAll("input,textarea,select,button")) node.disabled = value; }
    function unblock() { if (blockedControls) for (const [node, disabled] of blockedControls) if (node.isConnected) node.disabled = disabled; blockedControls = null; }
    async function write(body, form, done, retry) {
      if (ended || writing || loading || (pendingWrite && pendingWrite.body !== body)) return;
      writing = true; const current = generation;
      blockedControls ||= [...root.querySelectorAll("input,textarea,select,button")].map(node => [node, node.disabled]);
      for (const [node] of blockedControls) node.disabled = true;
      feedback.textContent = "Saving your enquiry…";
      try {
        const payload = await api(base, { method: "POST", body: JSON.stringify(body) });
        if (ended || current !== generation) return;
        if (!payload?.enquiry?.id) throw new Error("The saved enquiry could not be confirmed.");
        pendingWrite = null; unblock(); retry.hidden = true; done(payload.enquiry); feedback.textContent = body.action === "create" ? "Enquiry received. Check back here for a reply; no booking or payment has been made." : body.action === "withdraw" ? "Enquiry withdrawn. Any published reply is kept below." : body.status === "reviewing" ? "Enquiry marked under review. No reply has been published yet." : "Enquiry updated. The reply is visible to the member here.";
      } catch (error) {
        if (ended || current !== generation) return;
        if ([401, 403].includes(error.status)) { authFailure(error); return; }
        if (!error.status || error.status >= 500) {
          pendingWrite = { body, form }; retry.hidden = false; retry.disabled = false;
          blockedControls ||= [...root.querySelectorAll("input,textarea,select,button")].map(node => [node, node.disabled]);
          for (const [node] of blockedControls) node.disabled = node !== retry;
          feedback.textContent = "We couldn’t confirm whether this was saved. Use Retry save to check the same enquiry safely. Your details are kept here.";
        } else {
          pendingWrite = null; unblock(); retry.hidden = true; lock(form, false);
          feedback.textContent = error.status === 409 ? "This enquiry changed. Your draft is kept here. Refresh enquiries before making a new decision." : error.message || "Check the details and try again.";
        }
      } finally { writing = false; if (!ended && current === generation && !pendingWrite) { unblock(); lock(form, false); } }
    }
    function formWriter(form, makeBody, done) {
      const retry = button("Retry save"); retry.hidden = true; form.append(retry); let body = null;
      form.addEventListener("input", () => { if (!writing && !pendingWrite) body = null; });
      const send = () => { if (!form.reportValidity() || writing || pendingWrite) return; body ||= { ...makeBody(), key: crypto.randomUUID() }; void write(body, form, done, retry); };
      form.addEventListener("submit", event => { event.preventDefault(); send(); });
      retry.addEventListener("click", () => { if (pendingWrite?.form === form) void write(pendingWrite.body, form, done, retry); });
    }
    function card(item) {
      const row = make("details", undefined, "enquiry-card"); row.dataset.enquiryId = item.id;
      const summary = make("summary"), heading = make("span", item.subject, "enquiry-subject"), badge = make("span", statuses[item.status] || "Status unavailable", "enquiry-state"); summary.append(heading, badge); row.append(summary);
      const body = make("div", undefined, "enquiry-card-body"); row.append(body);
      body.append(make("p", `Sent ${date(item.createdAt)} · Updated ${date(item.updatedAt)}`, "enquiry-date"));
      if (staff) body.append(make("p", item.displayName || "BrowseRP member", "enquiry-member"));
      body.append(make("p", `Preferred placement: ${placements[item.placement] || "Not specified"}`));
      if (destination(item.destinationUrl || "")) { const link = make("a", item.destinationUrl); link.href = item.destinationUrl; link.target = "_blank"; link.rel = "noopener noreferrer"; body.append(field("Destination", link)); }
      body.append(make("p", item.message, "enquiry-message"));
      if (item.reply) { const reply = make("div", undefined, "enquiry-reply"); reply.append(make("h4", "BrowseRP reply"), make("p", item.reply, "enquiry-message")); body.append(reply); }
      if (staff && !active(item) && drafts.get(item.id)?.reply) body.append(make("h4", "Your unsent draft"), make("p", drafts.get(item.id).reply, "enquiry-message"), make("p", "This enquiry has closed. Your draft was not published."));
      if (staff && active(item)) {
        const form = make("form", undefined, "enquiry-form");
        const options = item.reply ? { closed: "Close enquiry" } : { ...(item.status === "submitted" ? { reviewing: "Mark under review" } : {}), replied: "Publish a reply", closed: "Close with an explanation" };
        const decision = choices("status", options), reply = input("reply", 20, 2000, true), replyField = field("Reply visible to the member", reply, "Replies appear here. This does not send an email or create a campaign.");
        const draft = drafts.get(item.id); if (draft && !item.reply) { if (Object.hasOwn(options, draft.status)) decision.value = draft.status; reply.value = draft.reply; }
        function mode() { replyField.hidden = decision.value === "reviewing" || Boolean(item.reply); reply.required = !replyField.hidden; if (replyField.hidden) reply.value = ""; }
        mode(); decision.addEventListener("change", mode); const send = button("Save decision", true); send.type = "submit";
        form.append(field("Next step", decision), replyField); if (item.reply) form.append(make("p", "Closing keeps the published reply. It does not reserve or publish advertising.")); form.append(send);
        form.addEventListener("input", () => { if (!writing && !pendingWrite) drafts.set(item.id, { status: decision.value, reply: reply.value }); });
        if (draft?.reply && item.reply) body.append(make("h4", "Your unsent draft"), make("p", draft.reply, "enquiry-message"), make("p", "A reply has already been published. Your draft has not replaced it."));
        formWriter(form, () => ({ action: "review", id: item.id, version: item.version, status: decision.value, reply: replyField.hidden ? "" : reply.value.trim() }), result => { drafts.delete(item.id); replaceRow(row, result); }); body.append(form);
      } else if (!staff && active(item)) {
        const form = make("form", undefined, "enquiry-withdraw"), confirm = make("input"); confirm.type = "checkbox"; confirm.required = true; confirm.name = "confirm";
        const label = make("label", undefined, "enquiry-confirm"); label.append(confirm, make("span", "I no longer need a reply to this enquiry."));
        const withdraw = button("Withdraw enquiry"); withdraw.type = "submit"; form.append(label, withdraw);
        formWriter(form, () => ({ action: "withdraw", id: item.id, version: item.version }), result => replaceRow(row, result)); body.append(form);
      }
      return row;
    }
    function replaceRow(row, item) { const fresh = card(item); fresh.open = true; row.replaceWith(fresh); fresh.querySelector("summary")?.focus({ preventScroll: true }); }
    function render(items, append = false) {
      const rows = items.map(card); if (append) { const seen = new Set([...list.querySelectorAll("[data-enquiry-id]")].map(node => node.dataset.enquiryId)); list.append(...rows.filter(node => !seen.has(node.dataset.enquiryId))); } else list.replaceChildren(...rows);
      if (!list.childElementCount) list.append(make("p", staff ? "No enquiries match this view." : "You haven’t sent an advertising enquiry yet.", "enquiry-empty"));
    }
    async function load(append = false) {
      if (ended || loading || writing || pendingWrite || !accountId || !canRead) return;
      loading = true; const current = generation; feedback.textContent = "Loading enquiries…"; refresh.disabled = true; more.disabled = true; filter.disabled = true;
      const formControls = [...root.querySelectorAll("form input,form textarea,form select,form button")].map(node => [node, node.disabled]); for (const [node] of formControls) node.disabled = true;
      try {
        const payload = await api(url(append ? next : null)); if (ended || current !== generation) return;
        if (!Array.isArray(payload?.items)) throw new Error("Enquiries could not be confirmed. Try Refresh enquiries.");
        render(payload.items, append); next = payload.next || null; more.hidden = !next; feedback.textContent = "";
      } catch (error) { if (!ended && current === generation) { if ([401, 403].includes(error.status)) authFailure(error); else feedback.textContent = error.message || "Enquiries could not load. Try Refresh enquiries."; } }
      finally { loading = false; if (!ended && current === generation) { refresh.disabled = false; more.disabled = false; filter.disabled = false; for (const [node, disabled] of formControls) if (node.isConnected) node.disabled = disabled; } }
    }
    function memberForm() {
      const form = make("form", undefined, "enquiry-form"), grid = make("div", undefined, "enquiry-fields"), subject = input("subject", 3, 120), link = input("destinationUrl", 1, 1000), placement = choices("placement", placements), message = input("message", 20, 2000, true); link.type = "url"; link.placeholder = "https://your-community.example.com";
      link.addEventListener("input", () => link.setCustomValidity(""));
      grid.append(field("What would you like to promote?", subject, "Your community, recruitment campaign or roleplay service."), field("Where should the advert lead?", link, "A public HTTPS website or community invite. No private codes or sign-in links."), field("Where are you interested in appearing?", placement));
      const messageField = field("Tell us what you have in mind", message, "Include your audience and any preferred dates. Keep passwords, private codes and payment details out of your enquiry."); messageField.classList.add("enquiry-wide"); grid.append(messageField);
      const send = button("Send enquiry", true); send.type = "submit";
      form.append(make("h3", "Send an enquiry"), grid, make("p", "We’ll review your idea and reply here. This does not confirm availability, pricing or a booking.", "enquiry-help"), send);
      form.addEventListener("submit", () => { link.setCustomValidity(destination(link.value.trim()) ? "" : "Use a public HTTPS website or community invite without a sign-in, port or local address."); });
      formWriter(form, () => ({ action: "create", subject: subject.value.trim(), destinationUrl: link.value.trim(), placement: placement.value, message: message.value.trim() }), item => { form.reset(); list.querySelector(".enquiry-empty")?.remove(); const row = card(item); row.open = true; list.prepend(row); row.querySelector("summary")?.focus({ preventScroll: true }); });
      compose.append(form);
    }
    function endSession() { clear(); accountId = null; void signIn("You’ve signed out. Sign in again to return to your private enquiries."); }
    function destroy() { if (ended) return; ended = true; clear(); root.replaceChildren(); window.removeEventListener("browserp:session-ended", endSession); window.removeEventListener("pagehide", leave); }
    function leave() { destroy(); const back = event => { window.removeEventListener("pageshow", back); if (event.persisted) location.reload(); }; window.addEventListener("pageshow", back); }
    window.addEventListener("browserp:session-ended", endSession); window.addEventListener("pagehide", leave);
    root.replaceChildren(make(staff ? "h3" : "h2", "Advertising enquiries"), make("p", staff ? "Review advertising ideas and reply privately on BrowseRP. Enquiries are separate from campaigns and payments." : "Discuss your idea with BrowseRP and follow its progress here. Replies stay with the account that sent the enquiry."), compose, tools, feedback, list);
    refresh.addEventListener("click", () => void load()); more.addEventListener("click", () => void load(true)); filter.addEventListener("change", () => void load());
    if (!accountId) void signIn();
    else if (staff) { const current = generation; void api(`${base}?access=1`).then(access => { if (!ended && current === generation) { if (access.canReview === true) { canRead = true; void load(); } else { clear(); root.replaceChildren(make("h3", "Advertising enquiries"), make("p", "Your role does not have permission to review advertising enquiries.")); } } }).catch(error => { if (!ended && current === generation) { if ([401,403].includes(error.status)) authFailure(error); else { feedback.textContent = "Enquiry access could not be checked. Refresh this page to try again."; tools.hidden = true; } } }); }
    else { memberForm(); void load(); }
    return { destroy };
  }
  window.BrowseRPAdvertisingEnquiries = Object.freeze({ initMember: options => init({ ...options, staff: false }), initStaff: options => init({ ...options, staff: true }) });
})();
