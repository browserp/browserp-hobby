(() => {
  "use strict";
  const make = (tag, text, className = "") => { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; node.className = className; return node; };
  const button = text => { const node = make("button", text, "button-v3 button-secondary-v3"); node.type = "button"; return node; };
  const fieldNames = { name: "name", platform: "platform_id", region: "region", language: "language", framework: "framework", description: "description", communityUrl: "community_url", cfxJoinUrl: "cfx_join_url", accessType: "access_type" };
  const labels = { pending_review: "Waiting for review", changes_requested: "Changes requested", approved: "Approved", rejected: "Not approved", withdrawn: "Withdrawn" };
  const date = value => { const time = new Date(value); return Number.isFinite(time.getTime()) ? time.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : ""; };

  async function mount({ id, listingId = null, accountId, form, api, updatePlatformFields, readRoblox, setFormStatus, toast }) {
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
    let record, ownerUpdate = null, preservedTags = [], busy = false, ended = false, attempt = null, uncertain = false, conflict = false, dirty = false, received = false;
    const active = () => !ended && notice.isConnected;
    const title = document.querySelector(".directory-intro-v3 h1"); if (title) title.textContent = "Give your listing another look.";
    document.title = "Correct your submission — BrowseRP";
    const intro = document.querySelector(".directory-intro-v3 p"); if (intro) intro.textContent = "Read the staff feedback, update your original submission and send it back for review.";
    const benefits = document.querySelector(".listing-benefits-v3"); if (benefits) benefits.hidden = true;
    form.querySelector(".form-heading-v3 .eyebrow-v3").textContent = "Correct your submission";
    form.querySelector(".form-heading-v3 h2").textContent = "Update the details staff asked about.";
    function sync() {
      const editable = active() && !received && !ownerUpdate?.unavailable && !ownerUpdate?.pendingStatus && (record?.status === "changes_requested" || (listingId && ownerUpdate?.serverId === listingId && record?.status === "owner_draft"));
      form.hidden = !editable; form.inert = !editable;
      fields.inert = busy || uncertain;
      submit.disabled = !editable || busy || conflict;
      submit.textContent = busy ? "Sending for review…" : uncertain ? "Try sending again" : listingId ? "Send update for review" : "Send corrections for review";
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
      for (const field of form.querySelectorAll('[data-roblox-key]')) field.value = data.roblox?.[field.dataset.robloxKey] || (field.dataset.robloxKey === "kind" ? "independent_community" : "");
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
    function ownerFields() {
      if (!ownerUpdate) return;
      const picker = form.querySelector(".tag-picker-v3");
      const featureGroup = picker.closest("fieldset");
      featureGroup.querySelector("legend").textContent = "Community features";
      featureGroup.querySelector(".field-help-v3").textContent = "Keep the features that still apply. You can add up to eight new features; existing researched keywords stay attached.";
      const editable = new Set(window.BrowseRPListingFeatures.keys(record.platform_id));
      const baseline = Array.isArray(ownerUpdate.live?.tags) ? ownerUpdate.live.tags : [];
      preservedTags = baseline.filter(value => !editable.has(value));
      picker.dataset.existingFeatures = JSON.stringify(baseline.filter(value => editable.has(value)));
      picker.dataset.preservedCount = String(preservedTags.length);
      picker.dataset.maximumFeatures = String(Math.max(30, baseline.length));
      for (const input of picker.querySelectorAll('input[name="tags"]')) {
        if (!editable.has(input.value)) input.closest("label").remove();
        else if (ownerUpdate.baselineVersion && ownerUpdate.baselineVersion !== ownerUpdate.serverVersion
            && baseline.includes(input.value) && !record.tags?.includes(input.value)) input.checked = true;
      }
      form.querySelector(".owner-preserved-features-v3")?.remove();
      if (preservedTags.length) {
        const details = make("details", undefined, "owner-preserved-features-v3 field-help-v3");
        details.append(make("summary", "Existing listing keywords"), make("p", "These researched keywords stay attached to your listing. Staff can review keyword removals."), make("p", preservedTags.join(", ")));
        picker.after(details);
      }
      picker.dispatchEvent(new Event("change", { bubbles: true }));
      document.title = "Update your listing — BrowseRP";
      if (title) title.textContent = "Keep your community's listing current.";
      if (intro) intro.textContent = "Propose a change for staff to review. Your current listing stays live until the update is approved.";
      form.querySelector(".form-heading-v3 .eyebrow-v3").textContent = "Update your listing";
      form.querySelector(".form-heading-v3 h2").textContent = "What should players know?";
      form.elements.description.maxLength = 3000;
      const privateHeading = form.querySelector(".roblox-private-evidence-v3"); if (privateHeading) privateHeading.hidden = true;
      // Locks are also checked against the current owner and source in the database.
      for (const name of ["platform", "cfxJoinUrl", ...(record.platform_id === "roblox" ? ["framework"] : [])]) {
        const field = form.elements.namedItem(name); field.value = ownerUpdate.live?.[fieldNames[name]] || "";
        if (field.tagName === "SELECT") field.disabled = true; else field.readOnly = true;
      }
      for (const field of form.querySelectorAll("[data-roblox-key]")) {
        const key = field.dataset.robloxKey;
        if (["applicantRole", "authorityEvidence"].includes(key)) {
          field.required = false; field.value = ""; field.closest("label").hidden = true;
        } else if (key !== "joiningInstructions") {
          field.value = ownerUpdate.live?.roblox?.[key] || "";
          if (field.tagName === "SELECT") field.disabled = true; else field.readOnly = true;
        }
      }
    }
    function renderFeedback(payload, showSaved) {
      feedback.replaceChildren(make("span", record.status === "owner_draft" ? "Current live listing" : labels[record.status] || "Submission status", "eyebrow-v3"), make("h2", record.name));
      if (record.review_note) feedback.append(make("strong", record.status === "changes_requested" ? "Staff feedback" : "Latest staff feedback"), make("p", record.review_note));
      if (record.reviewed_at) feedback.append(make("p", `Reviewed ${date(record.reviewed_at)}`, "field-help-v3"));
      if (ownerUpdate) {
        feedback.append(make("p", "Staff review your proposed public details. Your listing address, artwork, ownership and live player information stay attached to the same listing.", "field-help-v3"));
        if (ownerUpdate.unavailable) feedback.append(make("p", ownerUpdate.setupRequired ? "Staff need to complete this listing's reviewed Roblox experience details before owner updates can be accepted." : "This listing is no longer published. Ask staff about its status before requesting further changes."));
        if (ownerUpdate.pendingStatus) {
          feedback.append(make("p", "An update is already being reviewed. Follow that review instead of sending another."));
          if (ownerUpdate.pendingId) { const existing = make("a", "Open existing review", "button-v3 button-primary-v3"); existing.href = `/list-server?submission=${encodeURIComponent(ownerUpdate.pendingId)}`; feedback.append(existing); }
          else feedback.append(make("p", "Staff need to resolve an earlier owner's update first."));
        }
        const details = make("details"); details.append(make("summary", "Compare with the current live listing"));
        const list = make("dl"); const live = ownerUpdate.live || {};
        for (const [label, value] of [["Name",live.name],["Region",live.region],["Language",live.language],["Setup",live.framework],["Description",live.description],["Community link",live.community_url],["Access",live.access_type],["Features",live.tags?.join(", ")],["Joining instructions",live.roblox?.joiningInstructions]]) if (value) list.append(make("dt",label),make("dd",value));
        details.append(list); feedback.append(details);
        if (ownerUpdate.baselineVersion && ownerUpdate.baselineVersion !== ownerUpdate.serverVersion) {
          details.open = true;
          feedback.append(make("p", "The live listing changed after this proposal. Compare the current details before sending your corrections. Staff will review your complete proposed text.", "form-status"));
        }
      }
      if (showSaved) {
        const details = make("details"); details.append(make("summary", "Compare with the latest saved details")); const list = make("dl");
        for (const [label, value] of [["Name",record.name],["Game",record.platform_id],["Region",record.region],["Language",record.language],["Setup",record.framework],["Access",record.access_type],["Description",record.description],["Community link",record.community_url],["Connect link",record.cfx_join_url],["Features",record.tags?.join(", ")]]) {
          if (value) list.append(make("dt", label), make("dd", value));
        }
        if (record.platform_id === "roblox" && record.roblox) {
          const names = { kind: "Community type", experienceUrl: "Roblox experience link", communityGroupUrl: "Roblox community / group", joiningInstructions: "Joining instructions", applicantRole: "Your role — private", authorityEvidence: "Your control evidence — private" };
          for (const [key, label] of Object.entries(names)) if (record.roblox[key]) list.append(make("dt", label), make("dd", key === "kind" ? record.roblox[key] === "creator_experience" ? "Creator-run experience" : "Independent community" : record.roblox[key]));
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
        const payload = await api(`/api/submissions?${listingId ? "listing" : "id"}=${encodeURIComponent(id)}&account=${encodeURIComponent(accountId)}`, { signal: abort.signal });
        if (!active()) return;
        const current = payload.submission;
        if (current?.id !== id || !Number.isSafeInteger(current.review_version) || current.review_version < 1 || !Number.isSafeInteger(current.queue_version) || current.queue_version < 0) throw new Error("Your submission could not be loaded safely. Please try again.");
        record = current; ownerUpdate = payload.ownerUpdate || null; attempt = null; uncertain = false; conflict = false;
        if (listingId && (!ownerUpdate || ownerUpdate.serverId !== listingId)) throw new Error("Your listing's ownership could not be confirmed. Reopen it from My account.");
        status.className = "form-status";
        if (record.status !== "changes_requested") dirty = false;
        if (!preserveDraft) { fill(record); dirty = false; } else form.elements.agreement.checked = false;
        ownerFields();
        renderFeedback(payload, preserveDraft);
        refresh.hidden = !listingId && record.status !== "changes_requested"; refresh.textContent = listingId ? "Check current listing" : "Check latest review";
        status.textContent = listingId ? ownerUpdate.pendingStatus ? "Your existing update is shown above." : "Your current details are ready below. Changes to the game, live connection or Roblox experience identity need staff assistance."
          : record.status === "changes_requested"
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
      ended = true; abort.abort(); record = null; ownerUpdate = null; preservedTags = []; attempt = null; dirty = false;
      fields.inert = true; form.reset(); form.hidden = true; form.inert = true;
      for (const field of form.querySelectorAll("input,textarea,select")) { if (field.tagName === "SELECT") field.replaceChildren(); else field.value = ""; if (field.type === "checkbox") field.checked = false; }
      document.querySelector("#listing-account-notice").textContent = "";
      form.querySelector(".owner-preserved-features-v3")?.remove();
      const picker = form.querySelector(".tag-picker-v3"); delete picker.dataset.existingFeatures; delete picker.dataset.preservedCount; delete picker.dataset.maximumFeatures;
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
      if (!active() || busy || conflict || received || ownerUpdate?.unavailable || ownerUpdate?.pendingStatus
          || (listingId ? ownerUpdate?.serverId !== listingId || record?.status !== "owner_draft" : record?.status !== "changes_requested")) return;
      if (!attempt) {
        if (!form.reportValidity()) return;
        const data = new FormData(form); const values = Object.fromEntries(data);
        for (const name of Object.keys(fieldNames)) values[name] = form.elements.namedItem(name).value;
        const roblox = readRoblox();
        if (ownerUpdate && roblox) { delete roblox.applicantRole; delete roblox.authorityEvidence; }
        attempt = { key: crypto.randomUUID(), body: JSON.stringify({
          ...(listingId ? { listingUpdate: listingId } : { submissionId: id, expectedVersion: record.review_version, expectedQueueVersion: record.queue_version }), expectedAccountId: accountId,
          ...(ownerUpdate ? { ownerUpdate: true, expectedServerVersion: ownerUpdate.serverVersion } : {}),
          ...Object.fromEntries(Object.keys(fieldNames).map(name => [name, values[name]])),
          cfxJoinUrl: ["fivem","redm"].includes(values.platform) ? values.cfxJoinUrl : "",
          roblox,
          tags: [...new Set([...data.getAll("tags"), ...preservedTags])], agreement: values.agreement === "on"
        }) };
      }
      busy = true; sync(); setFormStatus("Sending your corrections for review…");
      try {
        if (ownerUpdate) {
          const currentSession = await api("/api/auth/session", { signal: abort.signal });
          if (!active()) return;
          if (!currentSession.authenticated || currentSession.user?.id !== accountId) { endSession(); return; }
        }
        const payload = await api("/api/submissions", { method: listingId ? "POST" : "PATCH", headers: { "Idempotency-Key": attempt.key }, body: attempt.body, signal: abort.signal });
        if (!active()) return;
        if ((!listingId && payload.submission?.id !== id) || !payload.submission?.id || !labels[payload.submission.status]) throw new Error("The result couldn't be confirmed. Try again safely or check the latest review.");
        record = { ...record, ...payload.submission }; attempt = null; uncertain = false; dirty = false;
        if (listingId) received = true;
        status.className = "form-status success";
        status.textContent = record.status === "pending_review" ? ownerUpdate ? "Update received. Staff will review it while your current listing stays live." : "Corrections received. Your original submission is back with staff for review." : "Your changes were received and the review has since moved on. Check My account for the latest decision.";
        refresh.hidden = true; feedback.replaceChildren(make("h2", ownerUpdate ? "Your update is with staff." : "Your submission is updated."));
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
