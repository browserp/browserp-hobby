(() => {
  "use strict";
  const state = { session: null, csrf: "" };
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const make = (tag, text, className = "") => { const el = document.createElement(tag); if (className) el.className = className; if (text !== undefined) el.textContent = String(text); return el; };
  const pendingForms = new WeakSet();

  function beginFormSubmission(form) {
    if (pendingForms.has(form)) return null;
    pendingForms.add(form);
    const controls = $$("button,input,textarea,select", form).map((control) => [control, control.disabled]);
    const previousBusy = form.getAttribute("aria-busy");
    form.setAttribute("aria-busy", "true");
    controls.forEach(([control]) => { control.disabled = true; });
    return () => {
      pendingForms.delete(form);
      if (previousBusy === null) form.removeAttribute("aria-busy"); else form.setAttribute("aria-busy", previousBusy);
      controls.forEach(([control, disabled]) => { control.disabled = disabled; });
    };
  }

  async function permissionOverrides() {
    const form = $("#permission-form-v3");
    if (!form) return;
    const [{ staff }, { control }] = await Promise.all([api("/api/admin/staff"), api("/api/admin/permissions")]);
    const people = (staff?.members || []).filter((person) => person.roleKey !== "owner" && person.userId);
    const permissions = (control?.permissions || []).filter((permission) => permission.delegatable);
    const overrides = control?.overrides || [];
    const select = $("#permission-user", form); const grid = $("#permission-grid-v3", form);
    const feedback = make("p", "", "staff-state-v3"); feedback.setAttribute("role", "status"); form.append(feedback);
    select.replaceChildren(...people.map((person) => { const option = make("option", `${person.displayName || person.discordUserId} · ${person.roleName || person.roleKey}`); option.value = person.discordUserId; return option; }));
    let baseline = new Map();
    const render = () => {
      const person = people.find((item) => item.discordUserId === select.value);
      baseline = new Map();
      grid.replaceChildren(...permissions.map((permission) => {
        const label = make("label", undefined, "permission-item-v3"); const choice = document.createElement("select"); choice.dataset.permission = permission.key;
        for (const [value, text] of [["", "Use role default"], ["true", "Allow"], ["false", "Deny"]]) { const option = make("option", text); option.value = value; choice.append(option); }
        const existing = overrides.find((item) => item.userId === person?.userId && item.permissionKey === permission.key);
        choice.value = existing ? String(existing.allowed) : ""; baseline.set(permission.key, choice.value);
        label.append(make("span", permission.description), choice); return label;
      }));
    };
    select.addEventListener("change", render); render();
    if (!people.length) { feedback.textContent = "Assign a staff role to a signed-in member to set individual permissions."; form.querySelectorAll("button,input,textarea,select").forEach((item) => { item.disabled = true; }); return; }
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const changes = $$('[data-permission]', form).filter((choice) => baseline.get(choice.dataset.permission) !== choice.value).map((choice) => [choice.dataset.permission, choice.value]);
      if (!changes.length) { feedback.textContent = "No permission changes to save."; return; }
      const reason = new FormData(form).get("reason"); const discordUserId = select.value;
      const release = beginFormSubmission(form);
      if (!release) return;
      feedback.textContent = "Saving permission changes…";
      try {
        for (const [permissionKey, value] of changes) {
          await api("/api/admin/permissions", { method: "POST", body: JSON.stringify({ discordUserId, permissionKey, allowed: value === "" ? null : value === "true", reason }) });
          baseline.set(permissionKey, value);
          const user = people.find((item) => item.discordUserId === discordUserId);
          const index = overrides.findIndex((item) => item.userId === user?.userId && item.permissionKey === permissionKey);
          if (index >= 0) overrides.splice(index, 1);
          if (value !== "") overrides.push({ userId: user?.userId, permissionKey, allowed: value === "true" });
        }
        feedback.textContent = "Permission changes saved.";
      } catch (error) { feedback.textContent = `${error.message} Any completed changes are saved; retry to finish the remaining changes.`; }
      finally { release(); }
    });
  }

  async function securityControls(mount, permissions = {}) {
    const keys = new Set(permissions.keys || []);
    mount.replaceChildren();
    const tasks = [];
    const section = (title) => { const details = make("details", undefined, "staff-section-v3"); details.append(make("summary", title)); const body = make("div", undefined, "staff-security-controls-body"); details.append(body); mount.append(details); return body; };
    const failure = (body, error) => body.append(make("p", error.message || "This section could not be loaded.", "staff-state-v3"));
    if (permissions.isOwner || permissions.manageStaff) {
      const body = section("Staff sign-in protection");
      tasks.push((async () => {
        try {
          const { policy } = await api("/api/admin/security?view=policy");
          const banner = make("div", undefined, "security-banner-v3"); banner.id = "mfa-enforcement-v3";
          banner.append(make("strong", policy.staffMfaRequired ? "Staff two-factor verification is required." : "Staff two-factor verification is currently optional.")); body.append(banner);
          if (policy.staffMfaRequired || !permissions.isOwner) return;
          if (state.session.aal === "aal2") {
            const activate = make("button", "Require two-factor verification", "button-v3 button-primary-v3"); activate.type = "button";
            activate.addEventListener("click", async () => {
              const input = await decision({ title: "Require two-factor verification for staff?", description: "All staff will need their authenticator when accessing the panel.", fields: [{ name: "reason", label: "Reason", type: "textarea", minlength: 5, maxlength: 500 }], submitLabel: "Require verification" });
              if (!input) return;
              try { await api("/api/admin/security", { method: "POST", body: JSON.stringify({ action: "activate_mfa", reason: input.reason }) }); location.reload(); } catch (error) { failure(body, error); }
            }); body.append(activate);
          } else {
            body.append(make("p", "Verify your own authenticator before making two-factor verification mandatory for staff."));
            const setup = make("button", state.session.mfa?.enrolled ? "Verify authenticator" : "Set up authenticator", "button-v3 button-secondary-v3"); setup.type = "button";
            setup.addEventListener("click", () => state.session.mfa?.enrolled ? showMfa() : setupAuthenticatorHere()); body.append(setup);
          }
        } catch (error) { failure(body, error); }
      })());
    }
    if (permissions.isOwner || keys.has("security.network.request") || keys.has("security.network.approve")) {
      const body = section("Protected IP requests");
      tasks.push((async () => {
        try {
          const { revealRequests = [] } = await api("/api/admin/security?view=requests");
          if (!revealRequests.length) body.append(make("p", "No protected IP requests."));
          for (const request of revealRequests) {
            const card = make("article", undefined, "staff-section-v3");
            card.append(make("h3", request.requesterName || "Staff member"), make("p", `${request.maskedNetwork || "Network unavailable"} · ${request.status} · ${date(request.createdAt)}`), make("p", request.reason));
            if (permissions.isOwner && request.status === "pending") {
              for (const [approved, text] of [[true, "Approve one-time view"], [false, "Deny request"]]) { const button = make("button", text, "button-v3 button-secondary-v3"); button.type = "button"; button.addEventListener("click", () => decideNetwork(request.requestId, approved)); card.append(button); }
            }
            if (request.requestedByMe && request.status === "approved") { const button = make("button", "View approved IP", "button-v3 button-secondary-v3"); button.type = "button"; button.addEventListener("click", async () => { button.disabled = true; await viewNetwork(request.activityId, request.requestId); }); card.append(button); }
            body.append(card);
          }
        } catch (error) { failure(body, error); }
      })());
    }
    if (permissions.readSecurity) {
      const body = section("Account retention history");
      tasks.push((async () => {
        try {
          const { retention = [] } = await api("/api/admin/security?view=retention");
          if (!retention?.length) body.append(make("p", "No accounts awaiting retention review."));
          for (const record of retention || []) { const card = make("article", undefined, "staff-section-v3"); card.append(make("h3", record.displayName || "Former member"), make("p", `${record.status} · Last active ${date(record.lastActiveAt)} · Review due ${date(record.dueAt)}`)); if (record.blockReason) card.append(make("p", record.blockReason)); body.append(card); }
        } catch (error) { failure(body, error); }
      })());
    }
    await Promise.allSettled(tasks);
  }

  function preferredTheme() {
    return "dark";
  }

  function applyTheme() {
    document.documentElement.dataset.theme = "dark";
  }

  function themeButton() {
    return make("span", "Dark workspace", "staff-theme-v3");
  }

  applyTheme(preferredTheme());

  function brand() {
    const link = make("a", undefined, "logo-v3"); link.href = "/"; link.setAttribute("aria-label", "BrowseRP home");
    const lockup = make("span", undefined, "logo-lockup-v3");
    const image = new Image(); image.src = "/assets/browserp-logo-v5.png"; image.alt = "BrowseRP"; image.className = "logo-full-v5";
    lockup.append(image); link.append(lockup); return link;
  }

  function decision({ title, description = "", fields = [], submitLabel = "Confirm", danger = false, expiresInSeconds = 0 }) {
    return new Promise((resolve) => {
      const dialog = make("dialog", undefined, "staff-dialog-v3");
      dialog.setAttribute("aria-label", title);
      const form = make("form", undefined, "staff-dialog-card-v3"); form.method = "dialog";
      form.append(make("span", "Recorded staff action", "eyebrow-v3"), make("h2", title));
      if (description) form.append(make("p", description, "staff-dialog-copy-v3"));
      for (const spec of fields) {
        const label = make("label", undefined, "field-v3"); label.append(make("span", spec.label));
        let control;
        if (spec.type === "select") {
          control = document.createElement("select");
          for (const optionSpec of spec.options || []) { const option = make("option", optionSpec.label); option.value = optionSpec.value; control.append(option); }
        } else if (spec.type === "textarea") control = document.createElement("textarea");
        else { control = document.createElement("input"); control.type = spec.type || "text"; }
        control.name = spec.name; control.required = spec.required !== false;
        if (spec.value !== undefined) control.value = spec.value;
        if (spec.minlength) control.minLength = spec.minlength;
        if (spec.maxlength) control.maxLength = spec.maxlength;
        label.append(control); form.append(label);
      }
      const actions = make("div", undefined, "staff-dialog-actions-v3");
      const cancel = make("button", "Cancel", "button-v3 button-secondary-v3"); cancel.type = "button";
      const submit = make("button", submitLabel, danger ? "button-v3 staff-danger-v3" : "button-v3 button-primary-v3"); submit.type = "submit";
      actions.append(cancel, submit); form.append(actions); dialog.append(form); document.body.append(dialog);
      let settled = false; let expiry;
      const finish = (value) => { if (settled) return; settled = true; if (expiry) clearTimeout(expiry); dialog.close(); dialog.remove(); resolve(value); };
      cancel.addEventListener("click", () => finish(null));
      dialog.addEventListener("cancel", (event) => { event.preventDefault(); finish(null); });
      form.addEventListener("submit", (event) => { event.preventDefault(); finish(Object.fromEntries(new FormData(form))); });
      dialog.showModal(); $("input,select,textarea", form)?.focus();
      if (expiresInSeconds > 0) expiry = setTimeout(() => finish(null), expiresInSeconds * 1000);
    });
  }

  async function api(path, options = {}) {
    const method = String(options.method || "GET").toUpperCase();
    const response = await fetch(path, { ...options, method, credentials: "same-origin", headers: { Accept: "application/json", ...(options.body ? { "Content-Type": "application/json" } : {}), ...(!["GET","HEAD"].includes(method) && state.csrf ? { "X-BrowseRP-CSRF": state.csrf } : {}), ...(options.headers || {}) } });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(payload.error || "The staff request failed."), { status: response.status });
    return payload;
  }
  function status(message, error = false) { const el = $("#staff-status-v3"); if (!el) return; el.textContent = message; el.style.color = error ? "#ff8192" : "#57d7a2"; }
  function date(value) { const d = new Date(value); return Number.isNaN(d.getTime()) ? "—" : new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(d); }
  function row(cells) { const tr = make("tr"); cells.forEach((cell) => { const td = make("td"); if (cell instanceof Node) td.append(cell); else td.textContent = String(cell ?? "—"); tr.append(td); }); return tr; }
  function tableRows(target, rows) { target?.replaceChildren(...rows); }

  async function loadSession() {
    state.session = await api("/api/auth/session"); state.csrf = state.session.csrfToken || "";
    return state.session;
  }

  function mountAccessCard(card) {
    const root = $("#staff-app-v3");
    if (!root) return;
    document.body.classList.remove("staff-menu-open");
    const menu = $("#staff-menu-v3");
    menu?.setAttribute("aria-expanded", "false");
    menu?.setAttribute("aria-label", "Open staff navigation");
    card.tabIndex = -1;
    root.replaceChildren(card);
  }

  function accessActions(card) {
    const actions = make("div", undefined, "staff-access-actions-v3");
    const home = make("a", "Return to BrowseRP", "button-v3 button-quiet-v3"); home.href = "/"; actions.append(home);
    if (state.session?.authenticated) {
      const signOut = make("button", "Sign out", "button-v3 button-secondary-v3"); signOut.type = "button";
      const feedback = make("p", "", "staff-form-status-v3"); feedback.setAttribute("role", "status");
      signOut.addEventListener("click", async () => {
        if (signOut.disabled) return;
        signOut.disabled = true; feedback.textContent = "Signing out…";
        try { await api("/api/auth/logout", { method: "POST", body: "{}" }); state.session = null; state.csrf = ""; showLogin(); }
        catch (error) { feedback.textContent = error.message; signOut.disabled = false; }
      });
      actions.append(signOut); card.append(actions, feedback);
    } else card.append(actions);
  }

  function showSessionUnavailable(error) {
    const card = make("section", undefined, "staff-login-card-v3");
    card.append(themeButton(), brand(), make("span", "Connection interrupted", "eyebrow-v3"), make("h1", "Staff access could not be checked"), make("p", "We couldn’t confirm your staff access. Try again in a moment, or return to BrowseRP."));
    const feedback = make("p", error?.message || "The sign-in service could not be reached.", "staff-form-status-v3"); feedback.setAttribute("role", "status");
    const retry = make("button", "Try again", "button-v3 button-primary-v3"); retry.type = "button"; retry.addEventListener("click", () => location.reload());
    card.append(feedback, retry); accessActions(card); mountAccessCard(card);
  }

  function showLogin() {
    const root = $("#staff-app-v3");
    if (!root) return;
    const card = make("section", undefined, "staff-login-card-v3");
    card.append(themeButton(), brand(), make("span", "BrowseRP staff workspace", "eyebrow-v3"), make("h1", "Welcome to the staff panel"), make("p", "Continue with the Discord account assigned to your BrowseRP staff role."));
    const authState = new URLSearchParams(location.search).get("auth");
    if (authState) { const feedback = make("p", authState === "backend-not-configured" || authState === "provider-unavailable" ? "Discord sign-in is temporarily unavailable. Please try again later." : "Sign-in was not completed. Please try again with your staff Discord account.", "staff-form-status-v3"); feedback.setAttribute("role", "status"); card.append(feedback); }
    const returnTo = /^\/staffpanel\/(overview|moderation|scrapers)$/.test(location.pathname) ? location.pathname : "/staffpanel/overview";
    const login = make("a", undefined, "button-v3 button-primary-v3 provider-button-v4 provider-discord-v4"); login.href = `/api/auth/discord?returnTo=${encodeURIComponent(returnTo)}`;
    const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg"); icon.classList.add("provider-icon-v4"); icon.setAttribute("aria-hidden", "true");
    const use = document.createElementNS("http://www.w3.org/2000/svg", "use"); use.setAttribute("href", "/assets/provider-icons-v4.svg#provider-discord"); icon.append(use); login.append(icon, make("span", "Continue with Discord"));
    card.append(login, make("p", "Staff access is available to approved team members. Your personal account settings stay on your profile.", "access-note")); accessActions(card); mountAccessCard(card);
  }

  function showDenied() {
    const root = $("#staff-app-v3");
    if (!root) return;
    const card = make("section", undefined, "staff-login-card-v3");
    card.append(themeButton(), brand(), make("span", "Access not assigned", "eyebrow-v3"), make("h1", "Staff access required"), make("p", "This Discord account does not have an active BrowseRP staff rank."));
    accessActions(card); mountAccessCard(card);
  }

  function showMfa() {
    const root = $("#staff-app-v3"); const factors = state.session?.mfa?.factors || []; const verified = factors.find((factor) => factor.status === "verified");
    const card = make("section", undefined, "staff-login-card-v3"); card.append(themeButton(), brand(), make("span", "Two-factor verification", "eyebrow-v3"), make("h1", verified ? "Enter your authenticator code" : "Secure your staff account"), make("p", verified ? "Open Google Authenticator or another authenticator app and enter the current six-digit code." : "Protect your staff account with an authenticator app. You’ll use its six-digit code after signing in with Discord."));
    if (!verified) { const enroll = make("button", "Set up authenticator", "button-v3 button-primary-v3"); enroll.type = "button"; enroll.addEventListener("click", enrollMfa); card.append(enroll); }
    else card.append(mfaVerifyForm(verified.id));
    accessActions(card); mountAccessCard(card);
  }

  function mfaVerifyForm(factorId) {
    const form = make("form", undefined, "staff-form-v3");
    const label = make("label", undefined, "field-v3");
    const input = document.createElement("input");
    input.name = "code"; input.inputMode = "numeric"; input.autocomplete = "one-time-code"; input.pattern = "[0-9]{6}"; input.maxLength = 6; input.required = true;
    label.append(make("span", "Six-digit code"), input);
    const submit = make("button", "Verify and continue", "button-v3 button-primary-v3"); submit.type = "submit";
    const formStatus = make("p", "", "staff-form-status-v3"); formStatus.setAttribute("role", "status");
    form.append(label, submit, formStatus);
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (submit.disabled || !form.reportValidity()) return;
      const code = input.value;
      input.disabled = true; submit.disabled = true; form.setAttribute("aria-busy", "true"); formStatus.textContent = "Verifying your code…";
      try { await api("/api/auth/mfa/verify", { method: "POST", body: JSON.stringify({ factorId, code }) }); location.reload(); }
      catch (error) { formStatus.textContent = error.message; formStatus.style.color = "#ff8192"; input.focus(); }
      finally { input.disabled = false; submit.disabled = false; form.removeAttribute("aria-busy"); }
    });
    return form;
  }

  function authenticatorSetup(card, factor) {
    card.replaceChildren(make("span", "Authenticator setup", "eyebrow-v3"), make("h1", "Scan the QR code"), make("p", "Add BrowseRP to Google Authenticator, 1Password, Microsoft Authenticator or another TOTP app."));
    if (factor.qrCode) {
      const frame = make("div", undefined, "qr-frame-v3");
      const image = new Image(); image.className = "qr-v3"; image.src = factor.qrCode; image.alt = "BrowseRP authenticator QR code";
      image.addEventListener("error", () => { frame.replaceChildren(make("p", "The QR image could not be displayed. Use the setup key below instead.", "access-note")); });
      frame.append(image); card.append(frame);
    }
    if (factor.secret) {
      const reveal = make("button", "Can’t scan? Show setup key", "button-v3 button-quiet-v3"); reveal.type = "button"; reveal.setAttribute("aria-expanded", "false");
      const key = make("code", factor.secret, "secret-v3"); key.hidden = true;
      reveal.addEventListener("click", () => { const open = key.hidden; key.hidden = !open; reveal.setAttribute("aria-expanded", String(open)); reveal.textContent = open ? "Hide setup key" : "Can’t scan? Show setup key"; });
      card.append(reveal, key);
    }
    card.append(mfaVerifyForm(factor.id));
  }

  async function enrollMfa(event) {
    const button = event?.currentTarget;
    if (button?.disabled) return;
    const card = $(".staff-login-card-v3");
    let feedback = $(".staff-enrollment-status-v3", card);
    if (!feedback) { feedback = make("p", "", "staff-form-status-v3 staff-enrollment-status-v3"); feedback.setAttribute("role", "status"); card.append(feedback); }
    if (button) button.disabled = true;
    feedback.textContent = "Preparing your authenticator…";
    try {
      const { factor } = await api("/api/auth/mfa/enroll", { method: "POST", body: JSON.stringify({ friendlyName: "BrowseRP staff" }) });
      authenticatorSetup(card, factor);
    } catch (error) { feedback.textContent = error.message; }
    finally { if (button) button.disabled = false; }
  }

  async function ensureStaff() {
    try { await loadSession(); } catch (error) { showSessionUnavailable(error); return false; }
    if (!state.session.authenticated || state.session.provider !== "discord") { showLogin(); return false; }
    if (!state.session.staffAccess) { showDenied(); return false; }
    const verifiedFactor = state.session.mfa?.factors?.some((factor) => factor.status === "verified");
    if (state.session.mfa?.required !== false && (!verifiedFactor || state.session.aal !== "aal2")) { showMfa(); return false; }
    if (document.body.dataset.staffPage === "login") { location.replace("/staffpanel/overview"); return false; }
    return true;
  }

  function overview(data) {
    const value = data.overview || {};
    const metrics = value.metrics || value;
    const root = $("#staff-metrics-v3");
    root?.replaceChildren(...[[metrics.pendingSubmissions,"Listing reviews"],[metrics.openReports,"Open reports"],[metrics.openModeration,"Moderation items"],[metrics.securityAlerts,"Security signals"]].map(([number,label]) => { const card=make("article",undefined,"staff-stat-v3"); card.append(make("strong",Number(number||0).toLocaleString()),make("span",label)); return card; }));
  }

  async function accounts() {
    const { activity = [], revealRequests = [], status: securityStatus = {} } = await api("/api/admin/security");
    tableRows($("#account-activity-rows"), activity.map((item) => {
      const actions = make("div", undefined, "staff-row-actions-v3");
      const ownRequest = revealRequests.find((request) => request.activityId === item.id && request.requestedByMe && ["pending","approved"].includes(request.status));
      if (securityStatus.isOwner || ownRequest?.status === "approved") {
        const view = make("button", "View protected IP", "button-v3 button-quiet-v3"); view.type = "button";
        view.addEventListener("click", () => viewNetwork(item.id, securityStatus.isOwner ? null : ownRequest.requestId)); actions.append(view);
      } else if (ownRequest?.status === "pending") {
        const pending = make("span", "Awaiting owner", "staff-state-v3"); actions.append(pending);
      } else {
        const request = make("button", "Request IP", "button-v3 button-quiet-v3"); request.type = "button"; request.addEventListener("click", () => networkRequest(item.id)); actions.append(request);
      }
      const ban = make("button", "Ban", "button-v3 button-quiet-v3"); ban.type = "button"; ban.addEventListener("click", () => applyBan(item)); actions.append(ban);
      if (item.userId) { const revoke = make("button", "End sessions", "button-v3 button-quiet-v3"); revoke.type = "button"; revoke.addEventListener("click", () => revokeSessions(item)); actions.append(revoke); }
      return row([item.displayName||item.userId,item.eventType,item.provider,item.maskedNetwork||"Unavailable",[item.browser,item.os,item.device].filter(Boolean).join(" · "),date(item.createdAt),actions]);
    }));
  }
  async function networkRequest(activityId) {
    const input = await decision({ title: "Request protected IP evidence", description: "Explain why the masked network is not enough. The owner will see and audit this reason.", fields: [{ name: "reason", label: "Reason", type: "textarea", minlength: 10, maxlength: 500 }], submitLabel: "Send request" });
    if (!input) return; try { await api("/api/admin/security",{method:"POST",body:JSON.stringify({action:"request_network",activityId,reason:input.reason})}); status("Reveal request sent to the owner."); } catch(error){status(error.message,true);}
  }
  async function viewNetwork(activityId, requestId) {
    try { const { result } = await api("/api/admin/security", { method: "POST", body: JSON.stringify({ action: "reveal_network", activityId, requestId }) }); await decision({ title: "Protected IP evidence", description: `IP address: ${result.address}\n\nThis audited view closes after 60 seconds.`, fields: [], submitLabel: "Close", expiresInSeconds: 60 }); } catch (error) { status(error.message, true); }
  }
  async function applyBan(item) {
    const input = await decision({ title: "Apply a permanent platform ban", description: "Choose the restriction for this activity. An IP ban matches the exact address and can affect a shared connection. A device ban uses this browser’s device token.", fields: [
      { name: "targetType", label: "Ban target", type: "select", options: [{value:"account",label:"Account"},{value:"device",label:"Browser / device token"},{value:"network_prefix",label:"IP address"}] },
      { name: "reasonCode", label: "Public reason code", value: "platform-abuse", minlength: 3, maxlength: 80 },
      { name: "reason", label: "Internal decision reason", type: "textarea", minlength: 10, maxlength: 500 }
    ], submitLabel: "Apply permanent ban", danger: true });
    if (!input) return; try { const { result } = await api("/api/admin/bans", { method: "POST", body: JSON.stringify({ action: "apply", activityId: item.id, targetType: input.targetType, scope: "platform", reasonCode: input.reasonCode, reason: input.reason, permanent: true }) }); status(`Ban applied. Appeal reference: ${result.reference}`); } catch (error) { status(error.message, true); }
  }
  async function revokeSessions(item) {
    const input = await decision({ title: "End every active session", description: "BrowseRP accounts use Discord or Google OAuth, so there is no BrowseRP password to reset. This immediately signs the account out everywhere so the provider recovery flow can be used safely.", fields: [{ name: "reason", label: "Security reason", type: "textarea", minlength: 10, maxlength: 500 }], submitLabel: "End sessions", danger: true });
    if (!input) return; try { await api("/api/admin/security", { method: "POST", body: JSON.stringify({ action: "revoke_sessions", userId: item.userId, reason: input.reason }) }); status("All active sessions were revoked."); } catch (error) { status(error.message, true); }
  }

  async function staffAccess() {
    const [{ staff }, { control }] = await Promise.all([api("/api/admin/staff"), api("/api/admin/permissions")]);
    const permissions = control?.permissions || []; const overrides = control?.overrides || [];
    let accessForm;
    tableRows($("#staff-members-rows"),(staff?.members||[]).map((member)=>{
      const manage = member.roleKey === "owner" ? make("span", "Protected owner", "staff-state-v3") : make("button", "Manage", "button-v3 button-quiet-v3");
      if (member.roleKey !== "owner") { manage.type="button"; manage.addEventListener("click",()=>{ if (!accessForm) return; accessForm.elements.discordUserId.value=member.discordUserId||""; accessForm.elements.roleKey.value=member.roleKey||"support"; accessForm.elements.action.value=member.status==="active"?"change_role":"reactivate"; accessForm.elements.expectedVersion.value=member.version||0; accessForm.elements.reason.focus(); accessForm.scrollIntoView({behavior:"smooth",block:"center"}); }); }
      return row([member.displayName||"Not signed in",member.discordUserId,member.roleName||member.roleKey,member.status,date(member.updatedAt),manage]);
    }));
    const select=$("#permission-user"); select?.replaceChildren(...(staff?.members||[]).filter((m)=>m.roleKey!=="owner"&&m.userId).map((m)=>{const option=make("option",`${m.displayName||m.discordUserId} — ${m.roleName||m.roleKey}`);option.value=m.discordUserId;return option;}));
    const grid=$("#permission-grid-v3"); grid?.replaceChildren(...permissions.filter((p)=>p.delegatable).map((permission)=>{const label=make("label",undefined,"permission-item-v3");const copy=make("span",`${permission.key} — ${permission.description}`);const box=document.createElement("select");box.dataset.permission=permission.key;[["","Use rank default"],["true","Allow"],["false","Deny"]].forEach(([value,text])=>{const option=make("option",text);option.value=value;box.append(option);});label.append(copy,box);return label;}));
    $("#permission-user")?.addEventListener("change",()=>{const user=(staff?.members||[]).find((m)=>m.discordUserId===$("#permission-user").value); $$('[data-permission]').forEach((box)=>{const found=overrides.find((o)=>o.userId===user?.userId&&o.permissionKey===box.dataset.permission);box.value=found?String(found.allowed):"";});}); $("#permission-user")?.dispatchEvent(new Event("change"));
    const section=$("#staff-members-rows")?.closest(".staff-section-v3"); const form=make("form",undefined,"staff-form-v3"); accessForm=form; form.id="staff-access-form-v3"; const accessGrid=make("div",undefined,"staff-form-grid-v3");
    const idField=field("Discord user ID","discordUserId"); const roleField=field("Rank","roleKey","select"); (staff?.roles||[]).filter((role)=>role.key!=="owner").forEach((role)=>{const option=make("option",role.name);option.value=role.key;$("select",roleField).append(option);}); const actionField=field("Action","action","select"); [["assign","Assign new staff"],["change_role","Change rank"],["suspend","Suspend"],["reactivate","Reactivate"],["revoke","Revoke"]].forEach(([value,text])=>{const option=make("option",text);option.value=value;$("select",actionField).append(option);}); const versionField=field("Current version (filled when managing existing staff)","expectedVersion"); $("input",versionField).type="number";$("input",versionField).min="0";$("input",versionField).value="0"; const reasonField=field("Reason","reason","textarea"); [idField,roleField,actionField,versionField,reasonField].forEach((item)=>accessGrid.append(item)); const submit=make("button","Apply staff access change","button-v3 button-primary-v3");submit.type="submit";form.append(make("h3","Assign or change staff access"),accessGrid,submit);form.addEventListener("submit",saveStaffAccess);section?.append(form);
  }

  async function saveStaffAccess(event){event.preventDefault();const form=event.currentTarget;const data=Object.fromEntries(new FormData(form));const release=beginFormSubmission(form);if(!release)return;status("Applying staff access change…");try{await api("/api/admin/staff",{method:"POST",body:JSON.stringify({...data,expectedVersion:Number(data.expectedVersion)})});location.reload();}catch(error){release();status(error.message,true);}}

  async function savePermission(event) { event.preventDefault(); const form=event.currentTarget; const discordUserId=$("#permission-user",form).value; const reasonText=new FormData(form).get("reason"); const entries=$$('[data-permission]',form).map((box)=>[box.dataset.permission,box.value]); const release=beginFormSubmission(form); if(!release)return; status("Saving permission overrides…"); try { for(const [permissionKey,value] of entries) await api("/api/admin/permissions",{method:"POST",body:JSON.stringify({discordUserId,permissionKey,allowed:value===""?null:value==="true",reason:reasonText})}); status("Permission overrides saved."); } catch(error){status(error.message,true);} finally { release(); } }

  async function profileQueue() { const { profiles=[] }=await api("/api/admin/profiles"); tableRows($("#profile-review-rows"),profiles.map((profile)=>{const actions=make("div",undefined,"staff-row-actions-v3");if(profile.bioStatus==="pending_review")["approve","reject"].forEach((action)=>{const button=make("button",`${action} bio`,"button-v3 button-quiet-v3");button.type="button";button.addEventListener("click",()=>reviewProfile(profile.userId,"bio",action));actions.append(button);});if(!actions.childElementCount)actions.append(make("span","No action needed","staff-state-v3"));const avatar=make("div",undefined,"profile-evidence-v3");if(profile.avatarUrl){const image=new Image();image.src=profile.avatarUrl;image.alt=`Live profile picture for ${profile.displayName}`;image.referrerPolicy="no-referrer";avatar.append(image);}avatar.append(make("span",profile.avatarStatus));return row([profile.displayName,avatar,profile.bioStatus,profile.bio||"—",date(profile.joinedAt),actions]);})); }
  async function reviewProfile(userId,field,action){const input=await decision({title:`${action==="approve"?"Approve":"Reject"} ${field}`,description:"This decision controls what can appear on public BrowseRP pages and is recorded in the audit log.",fields:[{name:"reason",label:"Decision reason",type:"textarea",minlength:5,maxlength:500}],submitLabel:action==="approve"?"Approve":"Reject",danger:action==="reject"});if(!input)return;try{await api("/api/admin/profiles",{method:"POST",body:JSON.stringify({userId,field,action,reason:input.reason})});location.reload();}catch(error){status(error.message,true);}}

  function field(labelText,name,type="input") { const label=make("label",undefined,"field-v3"); label.append(make("span",labelText)); const control=document.createElement(type); control.name=name; control.required=true; label.append(control); return label; }
  async function content() {
    const [{adverts=[]},{posts=[]}]=await Promise.all([api("/api/admin/adverts"),api("/api/admin/blogs")]);
    tableRows($("#advert-rows"),adverts.map((ad)=>{const actions=make("div",undefined,"staff-row-actions-v3");const edit=make("button","Edit","button-v3 button-quiet-v3");edit.type="button";edit.addEventListener("click",()=>editAdvert(ad));actions.append(edit);if(ad.status==="active"){const pause=make("button","Pause","button-v3 button-quiet-v3");pause.type="button";pause.addEventListener("click",()=>advertAction(ad,"pause"));actions.append(pause);} const archive=make("button","Archive","button-v3 button-quiet-v3");archive.type="button";archive.addEventListener("click",()=>advertAction(ad,"archive"));actions.append(archive);return row([ad.headline,ad.placement,ad.status,actions]);}));
    tableRows($("#blog-rows"),posts.map((post)=>{const actions=make("div",undefined,"staff-row-actions-v3");const edit=make("button","Edit","button-v3 button-quiet-v3");edit.type="button";edit.addEventListener("click",()=>editBlog(post));actions.append(edit);const archive=make("button","Archive","button-v3 button-quiet-v3");archive.type="button";archive.addEventListener("click",()=>blogArchive(post));actions.append(archive);return row([post.title,post.slug,post.status,actions]);}));
    const advertSection=$("#advert-rows")?.closest(".staff-section-v3"); const advertForm=make("form",undefined,"staff-form-v3"); advertForm.id="advert-create-v3"; const advertGrid=make("div",undefined,"staff-form-grid-v3");
    const placement=field("Placement","placement","select");[["top","Top carousel"],["side","Side rail"],["directory","Directory"],["server_detail","Server detail"]].forEach(([value,text])=>{const option=make("option",text);option.value=value;$("select",placement).append(option);});
    [field("Internal name","name"),placement,field("Headline","headline"),field("Button label","ctaLabel"),field("Destination","destinationUrl"),field("Advert image path","imageUrl"),field("Advert copy","body","textarea"),field("Audit reason","reason","textarea")].forEach((item)=>advertGrid.append(item)); const advertButtons=make("div",undefined,"hero-actions-v3");const save=make("button","Save draft","button-v3 button-secondary-v3");save.type="submit";save.value="save";save.name="action";const activate=make("button","Publish advert","button-v3 button-primary-v3");activate.type="submit";activate.value="activate";activate.name="action";advertButtons.append(save,activate);advertForm.append(make("h3","Create advert"),make("p","Use a reviewed BrowseRP image path such as /assets/adverts/campaign-name.jpg. Side placements require an image.","prose-v3"),advertGrid,advertButtons);advertForm.addEventListener("submit",saveAdvert);advertSection?.append(advertForm);
    const blogSection=$("#blog-rows")?.closest(".staff-section-v3"); const blogForm=make("form",undefined,"staff-form-v3"); blogForm.id="blog-create-v3"; const blogGrid=make("div",undefined,"staff-form-grid-v3"); [field("Title","title"),field("URL slug","slug"),field("Excerpt","excerpt","textarea"),field("SEO title","seoTitle"),field("SEO description","seoDescription","textarea"),field("Article body (Markdown)","body","textarea"),field("Audit reason","reason","textarea")].forEach((item)=>blogGrid.append(item)); const blogButtons=make("div",undefined,"hero-actions-v3");const draft=make("button","Save draft","button-v3 button-secondary-v3");draft.type="submit";draft.value="save";draft.name="action";const publish=make("button","Publish article","button-v3 button-primary-v3");publish.type="submit";publish.value="publish";publish.name="action";blogButtons.append(draft,publish);blogForm.append(make("h3","Create blog post"),blogGrid,blogButtons);blogForm.addEventListener("submit",saveBlog);blogSection?.append(blogForm);
  }
  function editAdvert(ad){const form=$("#advert-create-v3");if(!form)return;form.dataset.id=ad.id;form.dataset.version=ad.version;for(const [name,value] of Object.entries({name:ad.name,placement:ad.placement,headline:ad.headline,ctaLabel:ad.ctaLabel,destinationUrl:ad.destinationUrl,imageUrl:ad.imageUrl,body:ad.body}))if(form.elements[name])form.elements[name].value=value||"";$("h3",form).textContent="Edit advert";form.scrollIntoView({behavior:"smooth",block:"start"});}
  function editBlog(post){const form=$("#blog-create-v3");if(!form)return;form.dataset.id=post.id;for(const [name,value] of Object.entries({title:post.title,slug:post.slug,excerpt:post.excerpt,body:post.body,seoTitle:post.seoTitle,seoDescription:post.seoDescription}))if(form.elements[name])form.elements[name].value=value||"";$("h3",form).textContent="Edit blog post";form.scrollIntoView({behavior:"smooth",block:"start"});}
  async function saveAdvert(event){event.preventDefault();const form=event.currentTarget;const data=Object.fromEntries(new FormData(form));const action=event.submitter?.value||"save";const release=beginFormSubmission(form);if(!release)return;status(action==="activate"?"Publishing advert…":"Saving advert draft…");try{await api("/api/admin/adverts",{method:"POST",body:JSON.stringify({...data,id:form.dataset.id||null,action,expectedVersion:Number(form.dataset.version||0)})});location.reload();}catch(error){release();status(error.message,true);}}
  async function advertAction(ad,action){const input=await decision({title:`${action==="pause"?"Pause":"Archive"} advert`,description:ad.headline,fields:[{name:"reason",label:"Publishing reason",type:"textarea",minlength:5,maxlength:500}],submitLabel:action==="pause"?"Pause advert":"Archive advert",danger:action==="archive"});if(!input)return;try{await api("/api/admin/adverts",{method:"POST",body:JSON.stringify({id:ad.id,action,expectedVersion:ad.version,reason:input.reason})});location.reload();}catch(error){status(error.message,true);}}
  async function saveBlog(event){event.preventDefault();const form=event.currentTarget;const data=Object.fromEntries(new FormData(form));const action=event.submitter?.value||"save";const release=beginFormSubmission(form);if(!release)return;status(action==="publish"?"Publishing article…":"Saving article draft…");try{await api("/api/admin/blogs",{method:"POST",body:JSON.stringify({...data,id:form.dataset.id||null,action})});location.reload();}catch(error){release();status(error.message,true);}}
  async function blogArchive(post){const input=await decision({title:"Archive blog post",description:post.title,fields:[{name:"reason",label:"Publishing reason",type:"textarea",minlength:5,maxlength:500}],submitLabel:"Archive post",danger:true});if(!input)return;try{await api("/api/admin/blogs",{method:"POST",body:JSON.stringify({id:post.id,action:"archive",reason:input.reason})});location.reload();}catch(error){status(error.message,true);}}

  async function moderation() {
    const { overview = {} } = await api("/api/admin/overview"); overview && window.requestAnimationFrame(() => overviewPageSafe(overview));
    const records = [
      ...(overview.listingQueue || []).map((item) => ({ ...item, kind: "Listing" })),
      ...(overview.reportQueue || []).map((item) => ({ ...item, kind: "Report" })),
      ...(overview.moderationQueue || []).map((item) => ({ ...item, kind: "Moderation" })),
      ...(overview.securityEvents || []).map((item) => ({ ...item, kind: "Security" }))
    ];
    tableRows($("#moderation-rows"), records.map((item) => { const review=make("button","Review","button-v3 button-quiet-v3");review.type="button";review.addEventListener("click",()=>openReview(item));return row([item.kind,item.name||item.title||item.target_type||item.event_type||item.id,item.status||item.confidence||item.severity,date(item.created_at||item.createdAt),review]); }));
  }

  async function openReview(record) {
    const baseKind = record.kind.toLowerCase();
    const normalKind = baseKind === "queue" ? "moderation" : baseKind;
    const kind = normalKind === "moderation" && (record.target_type || record.targetType) === "server_comment" ? "comment" : normalKind;
    try {
      const { item } = await api(`/api/admin/item?kind=${encodeURIComponent(kind)}&id=${encodeURIComponent(record.id)}`);
      const actionMap = {
        listing: [["approved","Approve and publish"],["changes_requested","Request changes"],["rejected","Reject"]],
        report: [["triaged","Mark triaged"],["resolved","Resolve"],["dismissed","Dismiss"]],
        moderation: [["claimed","Claim"],["resolved","Resolve"],["dismissed","Dismiss"]],
        comment: [["approve","Publish comment"],["reject","Reject comment"],["hide","Hide comment"]],
        security: [["resolved","Resolve alert"]]
      };
      const evidence = Object.entries(item || {}).filter(([key])=>!["moderationReasons","reasons"].includes(key)).map(([key,value])=>`${key}: ${typeof value === "object" ? JSON.stringify(value) : value}`).join("\n");
      const input = await decision({ title: `Review ${kind}`, description: evidence, fields: [
        { name: "action", label: "Decision", type: "select", options: (actionMap[kind]||[]).map(([value,label])=>({value,label})) },
        { name: "reason", label: "Decision reason", type: "textarea", minlength: 5, maxlength: 500 }
      ], submitLabel: "Record decision" });
      if (!input) return;
      await api("/api/admin/action", { method: "POST", body: JSON.stringify({ kind, id: record.id, action: input.action, reason: input.reason }) });
      location.reload();
    } catch (error) { status(error.message, true); }
  }

  function overviewPageSafe(overviewData) { overview({ overview: overviewData }); }

  async function securityPage() {
    const [{ status: securityStatus = {}, revealRequests = [], flags = [], retention = [] }, { control = {} }] = await Promise.all([api("/api/admin/security"), api("/api/admin/bans")]);
    const banner = $("#mfa-enforcement-v3");
    banner.classList.toggle("good", securityStatus.staffMfaRequired === true);
    banner.replaceChildren(make("strong", securityStatus.staffMfaRequired ? "Mandatory staff MFA is active." : "Mandatory staff MFA is not active yet."), make("p", securityStatus.staffMfaRequired ? "Every staff API request now requires a Discord OAuth session verified at AAL2 with TOTP." : "The owner must enrol and verify an authenticator before activating enforcement."));
    const activate = $("#mfa-activate-form-v3");
    if (!securityStatus.staffMfaRequired && state.session.aal === "aal2") { activate.hidden = false; activate.inert = false; }
    if (!securityStatus.staffMfaRequired && !state.session.mfa?.enrolled) {
      const setup = make("button", "Set up authenticator", "button-v3 button-primary-v3"); setup.type = "button"; setup.addEventListener("click", setupAuthenticatorHere); banner.append(setup);
    }
    tableRows($("#network-request-rows"),revealRequests.map((request)=>{const actions=make("div",undefined,"staff-row-actions-v3");if(securityStatus.isOwner&&request.status==="pending")[[true,"Approve"],[false,"Deny"]].forEach(([approved,label])=>{const button=make("button",label,"button-v3 button-quiet-v3");button.type="button";button.addEventListener("click",()=>decideNetwork(request.requestId,approved));actions.append(button);});else actions.append(make("span",request.status,"staff-state-v3"));return row([request.requesterName,request.maskedNetwork||"Unavailable",request.reason,request.status,date(request.createdAt),actions]);}));
    tableRows($("#security-flag-rows"),flags.map((flag)=>{const actions=make("div",undefined,"staff-row-actions-v3");if(!flag.resolvedAt){const button=make("button","Resolve","button-v3 button-quiet-v3");button.type="button";button.addEventListener("click",()=>resolveSecurityFlag(flag));actions.append(button);}else actions.append(make("span","Resolved","staff-state-v3"));return row([flag.eventType,flag.displayName||"Unknown account",flag.severity,JSON.stringify(flag.details||{}),date(flag.createdAt),actions]);}));
    tableRows($("#retention-flag-rows"),retention.map((flag)=>row([flag.displayName||flag.userId,flag.status,date(flag.lastActiveAt),date(flag.dueAt),flag.blockReason||"None"])));
    tableRows($("#security-ban-rows"),(control.bans||[]).map((ban)=>{const button=make("button","Revoke","button-v3 button-quiet-v3");button.type="button";button.addEventListener("click",()=>revokeBan(ban));return row([ban.reference,ban.targetType,ban.scope,ban.reason,date(ban.createdAt),button]);}));
    tableRows($("#security-appeal-rows"),(control.appeals||[]).map((appeal)=>{const actions=make("div",undefined,"staff-row-actions-v3");[[true,"Approve"],[false,"Deny"]].forEach(([approved,label])=>{const button=make("button",label,"button-v3 button-quiet-v3");button.type="button";button.addEventListener("click",()=>decideAppeal(appeal.id,approved));actions.append(button);});return row([appeal.reference,appeal.statement,date(appeal.createdAt),actions]);}));
  }

  async function setupAuthenticatorHere() {
    try { const { factor }=await api("/api/auth/mfa/enroll",{method:"POST",body:JSON.stringify({friendlyName:"BrowseRP staff"})}); authenticatorSetup($("#mfa-enforcement-v3"), factor); } catch(error){status(error.message,true);} }
  async function resolveSecurityFlag(flag){const input=await decision({title:"Resolve security flag",description:`${flag.eventType} · ${flag.displayName||"Unknown account"}`,fields:[{name:"reason",label:"Resolution reason",type:"textarea",minlength:5,maxlength:500}],submitLabel:"Mark resolved"});if(!input)return;try{await api("/api/admin/security",{method:"POST",body:JSON.stringify({action:"resolve_flag",eventId:flag.id,reason:input.reason})});location.reload();}catch(error){status(error.message,true);}}
  async function decideNetwork(requestId,approved){const input=await decision({title:`${approved?"Approve":"Deny"} protected IP request`,description:approved?"The requesting staff member gets one view within ten minutes. The address remains encrypted at rest.":"The requester will not receive the address.",fields:[{name:"reason",label:"Owner decision reason",type:"textarea",minlength:10,maxlength:500}],submitLabel:approved?"Approve one-time view":"Deny request",danger:!approved});if(!input)return;try{await api("/api/admin/security",{method:"POST",body:JSON.stringify({action:"decide_network",requestId,approved,reason:input.reason})});location.reload();}catch(error){status(error.message,true);}}
  async function decideAppeal(appealId,approved){const input=await decision({title:`${approved?"Approve":"Deny"} ban appeal`,description:approved?"Approval revokes the active ban immediately.":"The restriction remains active.",fields:[{name:"reason",label:"Decision reason",type:"textarea",minlength:10,maxlength:500}],submitLabel:approved?"Approve and revoke ban":"Deny appeal",danger:!approved});if(!input)return;try{await api("/api/admin/bans",{method:"POST",body:JSON.stringify({action:"decide_appeal",appealId,approved,reason:input.reason})});location.reload();}catch(error){status(error.message,true);}}
  async function revokeBan(ban){const input=await decision({title:`Revoke ban ${ban.reference}`,description:"This restores access for this ban target and records the reason.",fields:[{name:"reason",label:"Revocation reason",type:"textarea",minlength:10,maxlength:500}],submitLabel:"Revoke ban"});if(!input)return;try{await api("/api/admin/bans",{method:"POST",body:JSON.stringify({action:"revoke",banId:ban.id,reason:input.reason})});location.reload();}catch(error){status(error.message,true);}}

  function wireForms(){ $("#permission-form-v3")?.addEventListener("submit",savePermission); $("#mfa-activate-form-v3")?.addEventListener("submit",async(event)=>{event.preventDefault();try{await api("/api/admin/security",{method:"POST",body:JSON.stringify({action:"activate_mfa",reason:new FormData(event.currentTarget).get("reason")})});location.reload();}catch(error){status(error.message,true);}}); }
  function mobile(){
    const main=$(".staff-main-v3")||$(".staff-login-v3");
    if(main){if(!main.id)main.id="staff-main-content";main.tabIndex=-1;const skip=make("a","Skip to staff content","skip-link");skip.href="#staff-app-v3";skip.addEventListener("click",event=>{event.preventDefault();const target=$(".staff-login-card-v3")||$(".staff-main-v3")||main;target.focus();});document.body.prepend(skip);}
    const button=$("#staff-menu-v3"); const sidebar=$(".staff-sidebar-v3");
    if(!button||!sidebar)return;
    const compact=window.matchMedia?.("(max-width: 760px)")||{matches:false};
    sidebar.id="staff-sidebar-v3";button.setAttribute("aria-controls",sidebar.id);
    function setOpen(value,restoreFocus=false){
      const open=compact.matches&&value;
      document.body.classList.toggle("staff-menu-open",open);
      button.setAttribute("aria-expanded",String(open));button.setAttribute("aria-label",open?"Close staff navigation":"Open staff navigation");
      sidebar.inert=compact.matches&&!open;
      if(compact.matches&&!open)sidebar.setAttribute("aria-hidden","true");else sidebar.removeAttribute("aria-hidden");
      if(main)main.inert=open;
      if(restoreFocus)button.focus();
    }
    button.addEventListener("click",()=>setOpen(!document.body.classList.contains("staff-menu-open")));
    sidebar.addEventListener("click",event=>{if(event.target.closest("a")&&compact.matches)setOpen(false);});
    document.addEventListener("keydown",event=>{
      if(!compact.matches||!document.body.classList.contains("staff-menu-open"))return;
      if(event.key==="Escape"){event.preventDefault();setOpen(false,true);return;}
      if(event.key!=="Tab")return;
      const targets=[button,...$$('a[href],button,summary,[tabindex="0"]',sidebar).filter(item=>!item.disabled&&item.getClientRects().length)];
      const first=targets[0],last=targets.at(-1);
      if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
      else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
    });
    compact.addEventListener?.("change",()=>setOpen(false));setOpen(false);
  }
  async function init(){
    const legacy = { profiles: "profiles", accounts: "activity", staff: "staff", security: "bans" };
    const pageKey = document.body.dataset.staffPage;
    if (legacy[pageKey]) { location.replace(`/staffpanel/moderation#${legacy[pageKey]}`); return; }
    if (pageKey === "content") { location.replace("/staffpanel/overview#overview-adverts"); return; }
    if (pageKey === "overview" && location.hash === "#overview-roles") { location.replace("/staffpanel/moderation#staff"); return; }
    mobile();const top=$(".staff-top-v3");if(top){top.append(themeButton());applyTheme(document.documentElement.dataset.theme||preferredTheme());}if(!await ensureStaff())return;void window.BrowseRPStaffRefreshHealth?.init({api});window.BrowseRPStaffScrapers?.init({api});try{const page=document.body.dataset.staffPage;if(page==="overview") {
      let toolsMounted = false;
      await window.BrowseRPStaffOverview.init({ api, onAuthFailure: showLogin, onLoad: async (website) => {
        if (toolsMounted) return;
        toolsMounted = true;
        await Promise.allSettled([
          window.BrowseRPStaffAdverts.init({ api, permissions: website.permissions }),
          window.BrowseRPStaffPublishing.init({ api, permissions: website.permissions })
        ]);
      }});
    }if(page==="moderation")await window.BrowseRPStaffModeration.init({api,onAuthFailure:showLogin,actions:{openReview,applyBan,viewNetwork,networkRequest,revokeSessions,reviewProfile,decideNetwork,resolveSecurityFlag,decideAppeal,revokeBan,permissionOverrides,securityControls}});if(page==="accounts")await accounts();if(page==="staff")await staffAccess();if(page==="profiles")await profileQueue();if(page==="content")await content();if(page==="security")await securityPage();if(page!=="moderation")wireForms();}catch(error){if(error.status===401||error.status===403){showLogin();}else status(error.message,true);}}
  init();
})();
