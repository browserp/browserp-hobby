const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const escapeHtml = (value) => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#039;");
const initials = (name) => String(name || "BR").split(/\s+/).slice(0, 2).map((word) => word[0]).join("").toUpperCase();
const safeHttpsUrl = (value) => {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "https:" ? url.href : "";
  } catch {
    return "";
  }
};
const dateLabel = (value) => {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Unknown" : date.toLocaleString([], {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit"
  });
};

const authState = {
  providers: { discord: false, google: false },
  configured: false,
  session: { authenticated: false, user: null }
};

const LOCAL_STAFF_DEMO_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

function isLoopbackStaffPage() {
  return document.body.dataset.page === "staff"
    && LOCAL_STAFF_DEMO_HOSTS.has(location.hostname.toLowerCase());
}

function localStaffDemoRequested() {
  return isLoopbackStaffPage()
    && new URLSearchParams(location.search).get("staffDemo") === "1";
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) }
  });
  const payload = await response.json().catch(() => ({ error: "The response could not be read." }));
  if (!response.ok) {
    throw Object.assign(new Error(payload.error || "Request failed."), {
      status: response.status,
      requestId: payload.requestId
    });
  }
  return payload;
}

function authMessage(value) {
  const messages = {
    failed: "Sign-in could not be completed. Please try again.",
    "discord-not-configured": "Discord sign-in is not enabled yet.",
    "google-not-configured": "Google sign-in is not enabled yet.",
    "backend-not-configured": "BrowseRP sign-in is waiting for its production backend settings."
  };
  return messages[value] || "";
}

function providerButtons(returnTo, { staffOnly = false } = {}) {
  const encoded = encodeURIComponent(returnTo);
  const links = [];
  if (authState.providers.discord) {
    links.push(`<a class="button discord-button" href="/api/auth/discord?returnTo=${encoded}">Continue with Discord</a>`);
  }
  if (!staffOnly && authState.providers.google) {
    links.push(`<a class="button button-secondary" href="/api/auth/google?returnTo=${encoded}">Continue with Google</a>`);
  }
  if (!links.length) {
    return `<p class="availability-note">Sign-in providers are not available yet.</p>`;
  }
  return `<div class="access-actions">${links.join("")}</div>`;
}

function signInGate(title, message, { staffOnly = false } = {}) {
  return `<section class="access-gate">
    <span class="brand-mark"><span>B</span></span>
    <h1>${escapeHtml(title)}</h1>
    <p>${escapeHtml(message)}</p>
    ${providerButtons(location.pathname + location.search, { staffOnly })}
  </section>`;
}

async function loadAuth() {
  const [providersResult, sessionResult] = await Promise.allSettled([
    api("/api/auth/providers"),
    api("/api/auth/session")
  ]);
  if (providersResult.status === "fulfilled") {
    authState.configured = Boolean(providersResult.value.configured);
    authState.providers = { ...authState.providers, ...(providersResult.value.providers || {}) };
  }
  if (sessionResult.status === "fulfilled") authState.session = sessionResult.value;
  else authState.session = { authenticated: false, user: null, error: sessionResult.reason.message };

  const requestedState = new URLSearchParams(location.search).get("auth");
  if (!authState.session.authenticated && requestedState) authState.session.error = authMessage(requestedState);

  const button = $("#page-auth");
  if (button) {
    if (authState.session.authenticated) {
      button.textContent = authState.session.user.profile?.display_name || "Dashboard";
      button.href = "/dashboard";
      button.tabIndex = 0;
      button.removeAttribute("aria-disabled");
    } else {
      const staffPage = document.body.dataset.page === "staff";
      const provider = authState.providers.discord ? "discord" : !staffPage && authState.providers.google ? "google" : null;
      button.textContent = provider ? "Sign in" : "Sign-in pending";
      if (provider) button.href = `/api/auth/${provider}?returnTo=${encodeURIComponent(location.pathname + location.search)}`;
      else button.removeAttribute("href");
      button.tabIndex = provider ? 0 : -1;
      button.setAttribute("aria-disabled", String(!provider));
    }
  }
  return authState.session;
}

function metric(label, value, note) {
  return `<article class="metric-card"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong><small>${escapeHtml(note)}</small></article>`;
}

async function dashboardPage(session) {
  const root = $("#page-content");
  if (!session?.authenticated) {
    root.innerHTML = signInGate(
      "Your BrowseRP account",
      session?.error || "Sign in to manage your server listings, submissions, saved servers and review updates."
    );
    return;
  }
  try {
    const { overview } = await api("/api/me/overview");
    const profile = overview?.profile || session.user.profile || {};
    const servers = overview?.servers || [];
    const submissions = overview?.submissions || [];
    const favourites = overview?.favoriteServers || [];
    const notifications = overview?.notifications || [];
    root.innerHTML = `
      <div class="portal-welcome">
        <div><span class="section-kicker">MY ACCOUNT</span><h1>Welcome, ${escapeHtml(profile.display_name || "member")}.</h1><p>Manage your listings and keep up with review decisions.</p></div>
        <button class="button button-secondary" id="logout-button" type="button">Sign out</button>
      </div>
      <div class="metric-grid">
        ${metric("Your servers", servers.length, "Published listings")}
        ${metric("Saved servers", overview?.favorites || 0, "Your shortlist")}
        ${metric("Updates", overview?.unreadNotifications || 0, "Unread notifications")}
      </div>
      <div class="portal-grid">
        <section class="portal-panel"><h2>Your servers</h2><p>Published listings attached to this account.</p><div class="portal-list">${servers.length
          ? servers.map((server) => `<a class="portal-row" href="/server/${encodeURIComponent(server.slug)}"><span>${escapeHtml(initials(server.name))}</span><span><strong>${escapeHtml(server.name)}</strong><small>${escapeHtml(server.status)}</small></span><span>Open →</span></a>`).join("")
          : '<div class="portal-row"><span>＋</span><span><strong>No server listed yet</strong><small>Submit your FiveM server for review.</small></span><a href="/list-server">Start</a></div>'}</div></section>
        <section class="portal-panel"><h2>Review queue</h2><p>Your latest listing submissions.</p><div class="portal-list">${submissions.length
          ? submissions.map((item) => `<div class="portal-row"><span>◇</span><span><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.status)}</small></span><time>${dateLabel(item.created_at)}</time></div>`).join("")
          : "<p>No submissions yet.</p>"}</div></section>
      </div>
      <div class="portal-grid">
        <section class="portal-panel"><h2>Saved servers</h2><p>Your shortlist of communities to revisit.</p><div class="portal-list">${favourites.length
          ? favourites.map((server) => `<a class="portal-row" href="/server/${encodeURIComponent(server.slug)}"><span>♥</span><span><strong>${escapeHtml(server.name)}</strong><small>Saved ${dateLabel(server.created_at)}</small></span><span>Open →</span></a>`).join("")
          : "<p>No saved communities yet.</p>"}</div></section>
        <section class="portal-panel"><div class="staff-panel-head"><div><h2>Notifications</h2><p>Account and review updates.</p></div>${Number(overview?.unreadNotifications || 0) > 0 ? '<button class="staff-action" type="button" id="read-notifications">Mark all read</button>' : ""}</div><div class="portal-list">${notifications.length
          ? notifications.map((item) => `<div class="portal-row"><span>${item.read_at ? "✓" : "•"}</span><span><strong>${escapeHtml(item.title)}</strong><small>${escapeHtml(item.body)}</small></span><time>${dateLabel(item.created_at)}</time></div>`).join("")
          : "<p>No notifications yet.</p>"}</div></section>
      </div>`;

    $("#logout-button")?.addEventListener("click", async () => {
      await api("/api/auth/logout", { method: "POST", body: "{}" });
      location.assign("/");
    });
    $("#read-notifications")?.addEventListener("click", async (event) => {
      event.currentTarget.disabled = true;
      try {
        await api("/api/me/notifications/read", { method: "POST", body: "{}" });
        await dashboardPage(session);
      } catch (error) {
        event.currentTarget.disabled = false;
        event.currentTarget.textContent = error.message;
      }
    });
  } catch (error) {
    root.innerHTML = signInGate("Dashboard connection pending", error.message);
  }
}

function staffButtons(kind, id, actions, enabled = true) {
  if (!enabled) return "";
  return `<div class="portal-actions">${actions.map(([action, label, tone = "secondary"]) => `<button type="button" class="staff-action staff-action-${escapeHtml(tone)}" data-staff-kind="${escapeHtml(kind)}" data-staff-id="${escapeHtml(id)}" data-staff-action="${escapeHtml(action)}">${escapeHtml(label)}</button>`).join("")}</div>`;
}

function staffQueueSection({ id, title, description, items, empty, render }) {
  return `<section class="portal-panel staff-panel-wide" id="${escapeHtml(id)}" tabindex="-1"><div class="staff-panel-head"><div><h2>${escapeHtml(title)}</h2><p>${escapeHtml(description)}</p></div><span>${items.length}</span></div><div class="portal-list">${items.length ? items.map(render).join("") : `<p class="queue-empty">${escapeHtml(empty)}</p>`}</div></section>`;
}

function systemBadge(label, value, ready) {
  return `<div class="system-badge ${ready ? "ready" : "pending"}"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`;
}

function renderEvidenceValue(value) {
  if (value === null || value === undefined || value === "") return "Not supplied";
  if (Array.isArray(value)) return value.length ? value.map((item) => escapeHtml(typeof item === "object" ? JSON.stringify(item) : item)).join(" · ") : "None";
  if (typeof value === "object") return escapeHtml(JSON.stringify(value));
  if (/(_at|date)$/i.test(String(value))) return escapeHtml(String(value));
  return escapeHtml(value);
}

function renderEvidence(item) {
  const record = item?.record || item?.item || item || {};
  const preferred = ["name", "status", "platform_id", "region", "language", "framework", "description", "community_url", "category", "details", "target_type", "target_id", "confidence", "score", "reasons", "severity", "event_type", "created_at"];
  const entries = Object.entries(record).sort(([left], [right]) => {
    const a = preferred.indexOf(left); const b = preferred.indexOf(right);
    return (a < 0 ? 999 : a) - (b < 0 ? 999 : b) || left.localeCompare(right);
  });
  if (!entries.length) return '<p class="queue-empty">No additional evidence is available.</p>';
  return entries.map(([key, value]) => `<div class="evidence-row"><span>${escapeHtml(key.replaceAll("_", " "))}</span><strong>${renderEvidenceValue(value)}</strong></div>`).join("");
}

let localStaffDemoEvidence = new Map();

function demoInspectButton(kind, id, label) {
  return `<button type="button" class="staff-action" data-demo-inspect data-demo-kind="${escapeHtml(kind)}" data-demo-id="${escapeHtml(id)}" aria-label="Inspect sample ${escapeHtml(kind)}: ${escapeHtml(label)}">Inspect evidence</button>`;
}

function wireStaffNavigation() {
  const navigation = $(".portal-side");
  if (!navigation) return;
  const links = $$('a[href^="#"]', navigation);
  const select = (link, { updateHistory = true, focus = true } = {}) => {
    const hash = link?.getAttribute("href") || "#overview";
    const target = $(hash);
    if (!target) return;
    links.forEach((item) => {
      const active = item === link;
      item.classList.toggle("active", active);
      if (active) item.setAttribute("aria-current", "location");
      else item.removeAttribute("aria-current");
    });
    if (updateHistory) history.replaceState(null, "", `${location.pathname}${location.search}${hash}`);
    target.scrollIntoView({ behavior: "smooth", block: "start" });
    if (focus) requestAnimationFrame(() => target.focus({ preventScroll: true }));
  };

  links.forEach((link) => { link.hidden = !$(link.getAttribute("href")); });
  if (navigation.dataset.staffNavigationWired !== "true") {
    navigation.dataset.staffNavigationWired = "true";
    navigation.addEventListener("click", (event) => {
      const link = event.target.closest('a[href^="#"]');
      if (!link || !navigation.contains(link) || link.hidden) return;
      event.preventDefault();
      select(link);
    });
  }

  const requested = links.find((link) => link.getAttribute("href") === location.hash && !link.hidden)
    || links.find((link) => link.getAttribute("href") === "#overview" && !link.hidden);
  if (requested) requestAnimationFrame(() => select(requested, { updateHistory: false, focus: Boolean(location.hash) }));
}

function openLocalDemoEvidence(button) {
  const dialog = $("#review-dialog");
  const form = $("#review-form");
  const reason = $("#review-reason");
  if (!dialog || !form || !reason) return;
  const kind = button.dataset.demoKind;
  const id = button.dataset.demoId;
  const record = localStaffDemoEvidence.get(`${kind}:${id}`);
  dialog.dataset.mode = "demo";
  $("#review-dialog-title").textContent = `Inspect sample ${kind}`;
  $("#review-evidence").innerHTML = renderEvidence({ record });
  const reasonField = reason.closest("label");
  if (reasonField) reasonField.hidden = true;
  reason.disabled = true;
  reason.required = false;
  $("#review-actions").innerHTML = '<p class="demo-readonly-note">Read-only preview. Connect an authorised Discord staff account to record a real decision.</p>';
  $("#review-status").textContent = "Sample evidence only — no live data was requested.";
  wireReviewDialogShell();
  dialog.showModal();
}

function renderLocalStaffDemo(payload) {
  const root = $("#page-content");
  const overview = payload.overview || {};
  const health = payload.health || {};
  const listings = overview.listingQueue || [];
  const reports = overview.reportQueue || [];
  const moderation = overview.moderationQueue || [];
  const security = overview.securityEvents || [];
  const audit = overview.recentAudit || [];
  localStaffDemoEvidence = new Map(Object.entries(payload.evidence || {}));
  document.body.dataset.staffMode = "demo";
  const navigation = $(".portal-side");
  if (navigation) navigation.hidden = false;
  const authButton = $("#page-auth");
  if (authButton) {
    authButton.textContent = "Exit demo";
    authButton.href = "/staff";
    authButton.tabIndex = 0;
    authButton.removeAttribute("aria-disabled");
  }

  const sections = [
    staffQueueSection({
      id: "listings", title: "Listing reviews", description: "Check the submitted server details before a listing goes public.", items: listings, empty: "No sample listings.",
      render: (item) => `<div class="portal-row staff-queue-row"><span>◇</span><span><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.platform_id)} · ${escapeHtml(item.region)} · ${escapeHtml(item.moderation_confidence)} · ${dateLabel(item.created_at)}</small></span>${demoInspectButton("listing", item.id, item.name)}</div>`
    }),
    staffQueueSection({
      id: "reports", title: "Member reports", description: "Read what was reported and the listing it relates to.", items: reports, empty: "No sample reports.",
      render: (item) => `<div class="portal-row staff-queue-row"><span>!</span><span><strong>${escapeHtml(item.category)}</strong><small>${escapeHtml(item.target_type)} · ${escapeHtml(item.status)} · ${dateLabel(item.created_at)}</small></span>${demoInspectButton("report", item.id, item.category)}</div>`
    }),
    staffQueueSection({
      id: "moderation", title: "Moderation queue", description: "Review clear risk signals before a person makes the final call.", items: moderation, empty: "No sample moderation cases.",
      render: (item) => `<div class="portal-row staff-queue-row"><span>✓</span><span><strong>${escapeHtml(item.target_type)}</strong><small>${escapeHtml(item.confidence)} · score ${escapeHtml(item.score)} · ${escapeHtml(item.status)} · ${dateLabel(item.created_at)}</small></span>${demoInspectButton("moderation", item.id, item.target_type)}</div>`
    }),
    staffQueueSection({
      id: "security", title: "Security signals", description: "See privacy-safe summaries of activity that needs checking.", items: security, empty: "No sample security signals.",
      render: (item) => `<div class="portal-row staff-queue-row"><span>⌾</span><span><strong>${escapeHtml(item.event_type)}</strong><small>${escapeHtml(item.severity)} · ${dateLabel(item.created_at)}</small></span>${demoInspectButton("security", item.id, item.event_type)}</div>`
    }),
    staffQueueSection({
      id: "audit", title: "Audit log", description: "Keep a permanent explanation of each staff decision.", items: audit, empty: "No sample audit entries.",
      render: (item) => `<div class="portal-row staff-queue-row"><span>↗</span><span><strong>${escapeHtml(item.action)}</strong><small>${escapeHtml(item.target_type)} · ${escapeHtml(item.reason)}</small></span>${demoInspectButton("audit", item.id, item.action)}</div>`
    })
  ];
  const integrations = health.integrations || {};
  root.innerHTML = `
    <section class="staff-demo-banner" id="overview" tabindex="-1" aria-label="Local demo status"><span class="staff-demo-label">LOCAL · SYNTHETIC · READ ONLY</span><div><strong>This is a working preview of the staff centre.</strong><p>The records below are fictional. You can navigate and inspect evidence, but nothing can be approved, deleted or written.</p></div></section>
    <div class="portal-welcome"><div><span class="section-kicker">STAFF WORKSPACE PREVIEW</span><h1>Staff centre</h1><p>One place to review listings, reports, moderation and security without exposing private data.</p></div><div class="portal-welcome-actions"><a class="button button-secondary" href="/legal#standards">Standards</a><a class="button button-secondary" href="/staff">Exit demo</a></div></div>
    <div class="system-strip" aria-label="Local preview status">
      ${systemBadge("Release", health.version || "local demo", true)}
      ${systemBadge("Database", integrations.database || "sample data", false)}
      ${systemBadge("Server boundary", integrations.serverBoundary || "locked", false)}
      ${systemBadge("Discord", "not signed in", false)}
      ${systemBadge("Payments", integrations.payments || "disabled", false)}
    </div>
    <div class="metric-grid">${metric("Listing reviews", overview.pendingSubmissions || 0, "Sample waiting")}${metric("Moderation", overview.openModeration || 0, "Sample case")}${metric("Reports", overview.openReports || 0, "Sample report")}${metric("Security", overview.securityAlerts || 0, "Sample signal")}</div>
    <p class="staff-live-status" id="staff-live-status" role="status" aria-live="polite">Local preview is read only.</p>
    <div class="staff-workspace">${sections.join("")}</div>`;
  $$('[data-demo-inspect]', root).forEach((button) => button.addEventListener("click", () => openLocalDemoEvidence(button)));
  wireReviewDialogShell();
  wireStaffNavigation();
}

async function loadLocalStaffDemo() {
  if (!localStaffDemoRequested()) return false;
  try {
    const response = await fetch("/__dev/staff-demo?staffDemo=1", {
      cache: "no-store",
      headers: { Accept: "application/json" }
    });
    if (!response.ok) return false;
    const payload = await response.json();
    if (payload.mode !== "synthetic-read-only") return false;
    renderLocalStaffDemo(payload);
    return true;
  } catch {
    return false;
  }
}

function closeReviewDialog() {
  const dialog = $("#review-dialog");
  if (dialog?.open) dialog.close();
  $("#review-form")?.reset();
  if ($("#review-status")) $("#review-status").textContent = "";
}

function wireReviewDialogShell() {
  const dialog = $("#review-dialog");
  if (!dialog || dialog.dataset.shellWired === "true") return;
  dialog.dataset.shellWired = "true";
  $$('[data-review-close]', dialog).forEach((button) => button.addEventListener("click", closeReviewDialog));
  dialog.addEventListener("click", (event) => {
    if (event.target === event.currentTarget) closeReviewDialog();
  });
}

async function openReviewDialog(button, session) {
  const dialog = $("#review-dialog");
  const reason = $("#review-reason");
  if (!dialog || !reason) return;
  const kind = button.dataset.staffKind;
  const id = button.dataset.staffId;
  const row = button.closest(".staff-queue-row");
  const options = $$(`[data-staff-kind="${CSS.escape(kind)}"][data-staff-id="${CSS.escape(id)}"]`, row || document).map((item) => ({
    action: item.dataset.staffAction,
    label: item.textContent.trim(),
    tone: item.classList.contains("staff-action-danger") ? "danger" : item.classList.contains("staff-action-success") ? "success" : "secondary"
  }));
  $("#review-dialog-title").textContent = `Review ${kind} item`;
  $("#review-evidence").innerHTML = '<p class="queue-empty">Loading the permission-scoped evidence…</p>';
  $("#review-actions").innerHTML = options.map((option) => `<button class="staff-action staff-action-${escapeHtml(option.tone)}" type="submit" data-review-action="${escapeHtml(option.action)}">${escapeHtml(option.label)}</button>`).join("");
  dialog.dataset.mode = "live";
  const reasonField = reason.closest("label");
  if (reasonField) reasonField.hidden = false;
  reason.disabled = false;
  reason.required = true;
  $("#review-form").dataset.kind = kind;
  $("#review-form").dataset.id = id;
  $("#review-form").dataset.sessionProvider = session.provider || "";
  dialog.showModal();
  try {
    const { item } = await api(`/api/admin/item?kind=${encodeURIComponent(kind)}&id=${encodeURIComponent(id)}`);
    $("#review-evidence").innerHTML = renderEvidence(item);
  } catch (error) {
    $("#review-evidence").innerHTML = `<p class="queue-empty">${escapeHtml(error.message)}</p>`;
    $$("[data-review-action]").forEach((action) => { action.disabled = true; });
  }
}

let activeStaffSession = null;

function wireReviewDialog(session) {
  activeStaffSession = session;
  wireReviewDialogShell();
  const form = $("#review-form");
  if (!form || form.dataset.liveSubmitWired === "true") return;
  form.dataset.liveSubmitWired = "true";
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if ($("#review-dialog")?.dataset.mode !== "live") return;
    const actionButton = event.submitter;
    if (!actionButton?.dataset.reviewAction) return;
    const form = event.currentTarget;
    const reason = $("#review-reason").value.trim();
    if (reason.length < 5) {
      $("#review-reason").reportValidity();
      return;
    }
    const status = $("#review-status");
    $$("[data-review-action]", form).forEach((button) => { button.disabled = true; });
    status.textContent = "Writing the decision and audit record…";
    try {
      await api("/api/admin/action", {
        method: "POST",
        body: JSON.stringify({
          kind: form.dataset.kind,
          id: form.dataset.id,
          action: actionButton.dataset.reviewAction,
          reason
        })
      });
      status.textContent = "Decision saved.";
      closeReviewDialog();
      if (activeStaffSession) await staffPage(activeStaffSession);
    } catch (error) {
      status.textContent = error.message;
      $$("[data-review-action]", form).forEach((button) => { button.disabled = false; });
    }
  });
}

async function staffPage(session) {
  const root = $("#page-content");
  if (!session?.authenticated) {
    document.body.dataset.staffMode = "locked";
    const navigation = $(".portal-side");
    if (navigation) navigation.hidden = true;
    root.innerHTML = signInGate(
      "Staff access",
      session?.error || "Sign in with the Discord account attached to your authorized staff membership.",
      { staffOnly: true }
    );
    if (isLoopbackStaffPage() && !authState.providers.discord) {
      const hash = location.hash || "#overview";
      $(".access-gate", root)?.insertAdjacentHTML("beforeend", `<div class="local-demo-gate"><span>Building locally?</span><a class="button button-secondary" href="/staff?staffDemo=1${escapeHtml(hash)}">Open the read-only staff demo</a></div>`);
    }
    return;
  }
  if (session.provider !== "discord") {
    document.body.dataset.staffMode = "locked";
    const navigation = $(".portal-side");
    if (navigation) navigation.hidden = true;
    root.innerHTML = signInGate("Discord staff identity required", "Member sign-in is active, but staff access is restricted to an allowlisted Discord identity.", { staffOnly: true });
    return;
  }
  try {
    document.body.dataset.staffMode = "live";
    const navigation = $(".portal-side");
    if (navigation) navigation.hidden = false;
    const [{ overview }, health] = await Promise.all([api("/api/admin/overview"), api("/api/health")]);
    const permissions = new Set(overview.permissions || []);
    const listings = overview.listingQueue || [];
    const reports = overview.reportQueue || [];
    const moderation = overview.moderationQueue || [];
    const security = overview.securityEvents || [];
    const audit = overview.recentAudit || [];
    const sections = [];

    if (permissions.has("servers.review")) sections.push(staffQueueSection({
      id: "listings", title: "Listing reviews", description: "Inspect the full safe submission evidence before approving, requesting changes or rejecting.", items: listings, empty: "No listing submissions need review.",
      render: (item) => `<div class="portal-row staff-queue-row"><span>◇</span><span><strong>${escapeHtml(item.name)}</strong><small>${escapeHtml(item.platform_id)} · ${escapeHtml(item.region)} · ${escapeHtml(item.moderation_confidence)} (${escapeHtml(item.moderation_score)}) · ${dateLabel(item.created_at)}</small></span>${staffButtons("listing", item.id, [["approved", "Approve", "success"], ["changes_requested", "Changes"], ["rejected", "Reject", "danger"]])}</div>`
    }));
    if (permissions.has("reports.read")) sections.push(staffQueueSection({
      id: "reports", title: "Member reports", description: "Inspect report details under RLS, then triage or resolve one item at a time.", items: reports, empty: "No reports need attention.",
      render: (item) => `<div class="portal-row staff-queue-row"><span>!</span><span><strong>${escapeHtml(item.category)}</strong><small>${escapeHtml(item.target_type)} · ${escapeHtml(item.status)} · ${dateLabel(item.created_at)}</small></span>${staffButtons("report", item.id, [["triaged", "Triage"], ["resolved", "Resolve", "success"], ["dismissed", "Dismiss", "danger"]], permissions.has("reports.resolve"))}</div>`
    }));
    if (permissions.has("moderation.read")) sections.push(staffQueueSection({
      id: "moderation", title: "Moderation queue", description: "Review deterministic risk signals and record a reasoned outcome.", items: moderation, empty: "The moderation queue is clear.",
      render: (item) => `<div class="portal-row staff-queue-row"><span>✓</span><span><strong>${escapeHtml(item.target_type)}</strong><small>${escapeHtml(item.confidence)} · score ${escapeHtml(item.score)} · ${escapeHtml(item.status)} · ${dateLabel(item.created_at)}</small></span>${staffButtons("moderation", item.id, [["claimed", "Claim"], ["resolved", "Resolve", "success"], ["dismissed", "Dismiss", "danger"]], permissions.has("moderation.resolve"))}</div>`
    }));
    if (permissions.has("security.read")) sections.push(staffQueueSection({
      id: "security", title: "Security signals", description: "Privacy-preserving summaries only; raw network addresses are not exposed.", items: security, empty: "No unresolved security signals.",
      render: (item) => `<div class="portal-row staff-queue-row"><span>⌾</span><span><strong>${escapeHtml(item.event_type)}</strong><small>${escapeHtml(item.severity)} · ${dateLabel(item.created_at)}</small></span>${staffButtons("security", item.id, [["resolved", "Mark resolved", "success"]], permissions.has("settings.manage"))}</div>`
    }));
    if (permissions.has("audit.read")) sections.push(staffQueueSection({
      id: "audit", title: "Audit log", description: "Every staff decision retains its target, reason and request context.", items: audit, empty: "No staff actions have been recorded.",
      render: (item) => `<div class="portal-row"><span>↗</span><span><strong>${escapeHtml(item.action)}</strong><small>${escapeHtml(item.target_type)} · ${escapeHtml(item.reason)}</small></span><time>${dateLabel(item.created_at)}</time></div>`
    }));

    const integrations = health.integrations || {};
    root.innerHTML = `
      <div class="portal-welcome" id="overview" tabindex="-1"><div><span class="section-kicker">ACCOUNTABLE OPERATIONS · ${escapeHtml(overview.role?.name || "Staff")}</span><h1>Staff centre</h1><p>Permission-scoped evidence, explicit reasons and audited single-item decisions.</p></div><div class="portal-welcome-actions"><a class="button button-secondary" href="/legal#standards">Standards</a><button class="button button-secondary" id="staff-logout" type="button">Sign out</button></div></div>
      <div class="system-strip" aria-label="Release and integration status">
        ${systemBadge("Release", health.version || "unknown", health.status === "ok")}
        ${systemBadge("Database", integrations.database || "unknown", integrations.database === "ready")}
        ${systemBadge("Server boundary", integrations.serverBoundary || "unknown", integrations.serverBoundary === "ready")}
        ${systemBadge("Discord", integrations.authentication?.discord ? "ready" : "pending", Boolean(integrations.authentication?.discord))}
        ${systemBadge("Payments", integrations.payments || "disabled", integrations.payments === "ready")}
      </div>
      <div class="metric-grid">${metric("Listing reviews", overview.pendingSubmissions, "Awaiting review")}${metric("Moderation", overview.openModeration, "Open cases")}${metric("Reports", overview.openReports, "Needs triage")}${metric("Security", overview.securityAlerts, "High-priority alerts")}</div>
      <p class="staff-live-status" id="staff-live-status" role="status" aria-live="polite"></p>
      <div class="staff-workspace">${sections.join("") || '<section class="portal-panel"><h2>No assigned queues</h2><p>Your staff role is active but has no readable operations queues.</p></section>'}</div>`;

    $("#staff-logout")?.addEventListener("click", async () => {
      await api("/api/auth/logout", { method: "POST", body: "{}" });
      location.assign("/");
    });
    $$('[data-staff-action]', root).forEach((button) => button.addEventListener("click", () => openReviewDialog(button, session)));
    wireReviewDialog(session);
    wireStaffNavigation();
  } catch (error) {
    document.body.dataset.staffMode = "locked";
    const navigation = $(".portal-side");
    if (navigation) navigation.hidden = true;
    root.innerHTML = signInGate("Staff permission required", error.status === 403 || error.status === 401 ? "This account does not have access to staff systems." : error.message, { staffOnly: true });
  }
}

async function serverPage(session) {
  const root = $("#server-content");
  const slug = location.pathname.split("/").filter(Boolean).pop() || new URLSearchParams(location.search).get("slug");
  try {
    const { servers } = await api(`/api/servers?slug=${encodeURIComponent(slug || "")}&limit=1`);
    const server = servers[0];
    if (!server || server.slug !== slug) throw Object.assign(new Error("This server is not published or could not be found."), { status: 404 });
    document.title = `${server.name} — BrowseRP`;
    const communityUrl = safeHttpsUrl(server.community_url);
    const action = communityUrl
      ? `<a class="button button-primary" href="${escapeHtml(communityUrl)}" target="_blank" rel="nofollow noopener noreferrer">Visit community</a>`
      : '<a class="button button-secondary" href="/servers">Back to server list</a>';
    const playerCount = server.online ? Number(server.players || 0).toLocaleString() : "—";
    const capacity = Number(server.capacity || 0).toLocaleString();
    const uptime = Number.isFinite(Number(server.uptime_percent)) ? `${Number(server.uptime_percent).toFixed(1)}%` : "Unavailable";
    root.innerHTML = `<section class="server-profile-hero"><div class="shell server-profile-head"><div class="server-profile-logo">${escapeHtml(initials(server.name))}</div><div><span class="section-kicker server-kicker">FiveM · ${escapeHtml(server.region)}</span><h1>${escapeHtml(server.name)}</h1><p>${server.online ? "Online now" : "Status unavailable"} · ${escapeHtml(server.language)} · ${escapeHtml(server.framework || "Framework not listed")}</p><div class="server-profile-tags">${(server.tags || []).slice(0, 6).map((tag) => `<span>${escapeHtml(tag)}</span>`).join("")}</div></div><div class="server-live"><strong>${playerCount}</strong><small>${server.online ? `of ${capacity} players` : "player count unavailable"}</small></div></div></section><main class="shell server-detail-grid"><article class="detail-card"><span class="section-kicker">ABOUT THIS SERVER</span><h2>What to expect</h2><p>${escapeHtml(server.description)}</p>${action}</article><aside class="detail-card"><h2>Server information</h2><div class="signal-list"><div class="signal-row"><span>Listing owner</span><strong>${server.verified ? "Verified" : "Not verified"}</strong></div><div class="signal-row"><span>30-day uptime</span><strong>${uptime}</strong></div><div class="signal-row"><span>Beginner friendly</span><strong>${server.beginner_friendly ? "Yes" : "Not marked"}</strong></div><div class="signal-row"><span>Region</span><strong>${escapeHtml(server.region)}</strong></div></div><p class="server-verification-note">Owner verification confirms control of this listing. It is not a guarantee of server quality.</p></aside></main>`;
  } catch (error) {
    root.innerHTML = `<main class="shell page-main"><section class="access-gate"><span class="brand-mark"><span>B</span></span><h1>Server not found</h1><p>${escapeHtml(error.message)}</p><a class="button button-primary" href="/servers?q=${encodeURIComponent(slug || "")}">Search the server list</a></section></main>`;
  }
}

async function init() {
  const page = document.body.dataset.page;
  if (page === "staff" && await loadLocalStaffDemo()) return;
  const session = await loadAuth();
  if (page === "dashboard") await dashboardPage(session);
  if (page === "staff") await staffPage(session);
  if (page === "server") await serverPage(session);
}

init();
