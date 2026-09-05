(() => {
  "use strict";
  const make = (tag, text, className = "") => { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; node.className = className; return node; };
  const button = text => { const node = make("button", text, "button-v3 button-secondary-v3"); node.type = "button"; return node; };
  const fieldNames = { name: "name", platform: "platform_id", region: "region", language: "language", framework: "framework", description: "description", communityUrl: "community_url", cfxJoinUrl: "cfx_join_url", accessType: "access_type" };
  const labels = { pending_review: "Waiting for review", changes_requested: "Changes requested", approved: "Approved", rejected: "Not approved", withdrawn: "Withdrawn" };
  const date = value => { const time = new Date(value); return Number.isFinite(time.getTime()) ? time.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : ""; };

  async function mount({ id, accountId, form, api, updatePlatformFields, setFormStatus, toast }) {
    const submit = form.querySelector("#submit-listing");
    const fields = form.querySelector(".form-grid-v3");
    const gate = document.querySelector("#listing-auth-gate");
    const notice = make("section", undefined, "panel-v3 submission-correction-v3");
    notice.setAttribute("aria-label", "Submission review");
    const feedback = make("div");
    const status = make("p", "Loading your submission and review feedback…", "form-status"); status.setAttribute("role", "status");
    const actions = make("div", undefined, "hero-actions-v3");
    const refresh = button("Try loading again"); refresh.hidden = true;
    const dashboard = make("a", "Back to My account", "button-v3 button-quiet-v3"); dashboard.href = "/dashboard#submissions";
    actions.append(refresh, dashboard); notice.append(feedback, status, actions); form.before(notice);
    const abort = new AbortController();
    let record, busy = false, ended = false, attempt = null, uncertain = false, conflict = false, dirty = false;
    const active = () => !ended && notice.isConnected;
    const title = document.querySelector(".directory-intro-v3 h1"); if (title) title.textContent = "Give your listing another look.";
    document.title = "Correct your submission — BrowseRP";
    const intro = document.querySelector(".directory-intro-v3 p"); if (intro) intro.textContent = "Read the staff feedback, update your original submission and send it back for review.";
    const benefits = document.querySelector(".listing-benefits-v3"); if (benefits) benefits.hidden = true;
    form.querySelector(".form-heading-v3 .eyebrow-v3").textContent = "Correct your submission";
    form.querySelector(".form-heading-v3 h2").textContent = "Update the details staff asked about.";
    function sync() {
      const editable = active() && record?.status === "changes_requested";
      form.hidden = !editable; form.inert = !editable;
      fields.inert = busy || uncertain;
      submit.disabled = !editable || busy || conflict;
      submit.textContent = busy ? "Sending corrections…" : uncertain ? "Try sending again" : "Send corrections for review";
      refresh.disabled = busy;
    }
    function fill(data) {
      for (const [name, key] of Object.entries(fieldNames)) {
        const field = form.elements.namedItem(name); const value = data[key] || "";
        if (field.tagName === "SELECT" && value && ![...field.options].some(option => option.value === value)) {
          field.append(Object.assign(document.createElement("option"), { value, textContent: value }));
        }
        field.value = value;
      }
      updatePlatformFields();
      const picker = form.querySelector(".tag-picker-v3");
      // Preserve previous valid features even if the current picker has changed.
      for (const value of Array.isArray(data.tags) ? data.tags : []) {
        if (!/^[a-z0-9-]{2,40}$/.test(value)) continue;
        if (![...picker.querySelectorAll("input")].some(input => input.value === value)) {
          const label = make("label", undefined, "check-v3"); const input = document.createElement("input");
          input.type = "checkbox"; input.name = "tags"; input.value = value;
          label.append(input, document.createTextNode(` ${value.replaceAll("-", " ")}`)); picker.append(label);
        }
      }
      for (const input of picker.querySelectorAll("input")) input.checked = data.tags?.includes(input.value) || false;
      picker.dispatchEvent(new Event("change", { bubbles: true }));
      form.elements.agreement.checked = false;
    }
    function renderFeedback(payload, showSaved) {
      feedback.replaceChildren(make("span", labels[record.status] || "Submission status", "eyebrow-v3"), make("h2", record.name));
      if (record.review_note) feedback.append(make("strong", record.status === "changes_requested" ? "Staff feedback" : "Latest staff feedback"), make("p", record.review_note));
      if (record.reviewed_at) feedback.append(make("p", `Reviewed ${date(record.reviewed_at)}`, "field-help-v3"));
      if (showSaved) {
        const details = make("details"); details.append(make("summary", "Compare with the latest saved details")); const list = make("dl");
        for (const [label, value] of [["Name",record.name],["Game",record.platform_id],["Region",record.region],["Language",record.language],["Setup",record.framework],["Access",record.access_type],["Description",record.description],["Community link",record.community_url],["Connect link",record.cfx_join_url],["Features",record.tags?.join(", ")]]) {
          if (value) list.append(make("dt", label), make("dd", value));
        }
        details.append(list); feedback.append(details);
      }
      const history = Array.isArray(payload.history) ? payload.history : [];
      if (history.length) {
        const details = make("details"); details.append(make("summary", "Previous review feedback")); const list = make("ul");
        const seen = new Set([`${record.reviewed_at}:${record.review_note}`]);
        for (const item of history) {
          const key = `${item.reviewed_at}:${item.review_note}`; if (!item.review_note || seen.has(key)) continue; seen.add(key);
          list.append(make("li", `${date(item.reviewed_at || item.recorded_at)} — ${item.review_note}`));
        }
        if (list.childElementCount) { details.append(list); feedback.append(details); }
      }
    }
    async function load({ preserveDraft = false } = {}) {
      if (!active() || busy) return;
      busy = true; sync(); status.textContent = "Checking the latest submission and feedback…";
      try {
        const payload = await api(`/api/submissions?id=${encodeURIComponent(id)}&account=${encodeURIComponent(accountId)}`, { signal: abort.signal });
        if (!active()) return;
        const current = payload.submission;
        if (current?.id !== id || !Number.isSafeInteger(current.review_version) || current.review_version < 1 || !Number.isSafeInteger(current.queue_version) || current.queue_version < 0) throw new Error("Your submission could not be loaded safely. Please try again.");
        record = current; attempt = null; uncertain = false; conflict = false;
        status.className = "form-status";
        if (record.status !== "changes_requested") dirty = false;
        if (!preserveDraft) { fill(record); dirty = false; } else form.elements.agreement.checked = false;
        renderFeedback(payload, preserveDraft);
        refresh.hidden = record.status !== "changes_requested"; refresh.textContent = "Check latest review";
        status.textContent = record.status === "changes_requested"
          ? preserveDraft ? "Latest review loaded. Your unsent edits are still below. Check the feedback and saved details before sending." : "Your original details are ready to edit below. Sending corrections keeps this submission and its review history together."
          : record.status === "pending_review" ? "Your submission is already waiting for review. You don't need to send it again." : "This review is closed. You can see the decision and your listings in My account.";
        setFormStatus("");
      } catch (error) {
        if (!active()) return;
        status.textContent = error.message; status.className = "form-status error";
        refresh.hidden = false; refresh.textContent = "Try loading again";
        if ([401,403].includes(error.status)) endSession();
      } finally { busy = false; if (active()) sync(); }
    }
    function endSession({ showSignIn = true } = {}) {
      if (ended) return;
      ended = true; abort.abort(); record = null; attempt = null; dirty = false;
      fields.inert = true; form.reset(); form.hidden = true; form.inert = true;
      for (const field of form.querySelectorAll("input,textarea,select")) { if (field.tagName === "SELECT") field.replaceChildren(); else field.value = ""; if (field.type === "checkbox") field.checked = false; }
      document.querySelector("#listing-account-notice").textContent = "";
      feedback.replaceChildren(); notice.hidden = true; notice.inert = true; setFormStatus("");
      gate.hidden = !showSignIn; gate.inert = !showSignIn;
      if (!showSignIn) return;
      gate.querySelector("h2").textContent = "Sign in again to continue your corrections.";
      gate.querySelector("p").textContent = "Your saved submission is safe. Sign back in to load its current review.";
      api("/api/auth/providers").then(payload => {
        const providers = payload.providers || {}; let available = false;
        gate.querySelectorAll("[data-auth-provider]").forEach(link => { const enabled = Boolean(providers[link.dataset.authProvider]); link.hidden = !enabled; link.inert = !enabled; available ||= enabled; });
        const note = document.querySelector("#provider-note"); note.hidden = available; note.textContent = "Sign-in is temporarily unavailable. Please try again later.";
      }).catch(() => { gate.querySelectorAll("[data-auth-provider]").forEach(link => { link.hidden = true; link.inert = true; }); });
    }
    async function send(event) {
      event.preventDefault();
      if (!active() || busy || conflict || record?.status !== "changes_requested") return;
      if (!attempt) {
        if (!form.reportValidity()) return;
        const data = new FormData(form); const values = Object.fromEntries(data);
        attempt = { key: crypto.randomUUID(), body: JSON.stringify({
          submissionId: id, expectedVersion: record.review_version, expectedQueueVersion: record.queue_version, expectedAccountId: accountId,
          ...Object.fromEntries(Object.keys(fieldNames).map(name => [name, values[name]])),
          cfxJoinUrl: ["fivem","redm"].includes(values.platform) ? values.cfxJoinUrl : "",
          tags: data.getAll("tags"), agreement: values.agreement === "on"
        }) };
      }
      busy = true; sync(); setFormStatus("Sending your corrections for review…");
      try {
        const payload = await api("/api/submissions", { method: "PATCH", headers: { "Idempotency-Key": attempt.key }, body: attempt.body, signal: abort.signal });
        if (!active()) return;
        if (payload.submission?.id !== id || !labels[payload.submission.status]) throw new Error("The result couldn't be confirmed. Try again safely or check the latest review.");
        record = { ...record, ...payload.submission }; attempt = null; uncertain = false; dirty = false;
        status.className = "form-status success";
        status.textContent = record.status === "pending_review" ? "Corrections received. Your original submission is back with staff for review." : "Your correction was received and the review has since moved on. Check My account for the latest decision.";
        refresh.hidden = true; feedback.replaceChildren(make("h2", "Your submission is updated."));
        toast("Your corrections have been received."); dashboard.focus();
        if (record.status === "changes_requested") { busy = false; await load(); }
      } catch (error) {
        if (!active()) return;
        if ([401,403].includes(error.status)) { endSession(); return; }
        conflict = error.status === 409;
        uncertain = !error.status || error.status >= 500;
        if (!uncertain) attempt = null;
        setFormStatus(uncertain ? "We couldn't confirm whether your corrections arrived. Retry the same changes safely, or check the latest review before editing further." : error.message, "error");
        refresh.hidden = false; refresh.textContent = "Check latest review";
      } finally { busy = false; if (active()) sync(); }
    }
    refresh.addEventListener("click", () => load({ preserveDraft: Boolean(record) }));
    form.addEventListener("submit", send);
    form.addEventListener("input", () => { if (!busy && !uncertain) dirty = true; });
    window.addEventListener("beforeunload", event => { if (dirty && active()) { event.preventDefault(); event.returnValue = ""; } });
    window.addEventListener("browserp:session-ended", endSession);
    // Tab switching preserves edits. Navigation clears the private page before
    // a browser can freeze it into BFCache; Back must check the session afresh.
    window.addEventListener("pagehide", () => endSession({ showSignIn: false }));
    window.addEventListener("pageshow", event => {
      if (!event.persisted) return;
      endSession({ showSignIn: false });
      location.reload();
    });
    sync();
    if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id)) {
      status.textContent = "Choose a submission from My account to correct."; return;
    }
    await load();
  }
  window.BrowseRPSubmissionCorrection = Object.freeze({ mount });
})();
