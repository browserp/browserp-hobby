(() => {
  "use strict";

  const page = document.body.dataset.page || "";
  const root = document.querySelector("#portal-root");
  const state = { session: null, csrfToken: "", staffOverview: null, content: {} };

  function make(tag, className = "", text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined && text !== null) element.textContent = String(text);
    return element;
  }

  function append(parent, ...children) {
    children.flat().filter(Boolean).forEach((child) => parent.append(child));
    return parent;
  }

  function link(href, className, text) {
    const element = make("a", className, text);
    element.href = href;
    return element;
  }

  function button(className, text) {
    const element = make("button", className, text);
    element.type = "button";
    return element;
  }

  function apiError(payload, fallback) {
    if (typeof payload?.error === "string" && payload.error.trim()) return payload.error;
    if (typeof payload?.error?.message === "string" && payload.error.message.trim()) return payload.error.message;
    if (typeof payload?.message === "string" && payload.message.trim()) return payload.message;
    return fallback;
  }

  async function api(path, options = {}) {
    const method = String(options.method || "GET").toUpperCase();
    const changing = method !== "GET" && method !== "HEAD";
    if (changing && !state.csrfToken) {
      throw new Error("Your secure session has expired. Refresh the page before trying again.");
    }
    const headers = {
      Accept: "application/json",
      ...(options.body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(changing ? { "X-BrowseRP-CSRF": state.csrfToken } : {}),
      ...(options.headers || {})
    };
    const response = await fetch(path, { ...options, method, headers, credentials: "same-origin" });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(apiError(payload, "Something went wrong. Please try again."));
      error.status = response.status;
      throw error;
    }
    return payload;
  }

  async function loadSession() {
    try {
      const session = await api("/api/auth/session");
      state.session = session;
      state.csrfToken = typeof session.csrfToken === "string" ? session.csrfToken : "";
      return session;
    } catch {
      state.session = { authenticated: false, user: null, csrfToken: "" };
      state.csrfToken = "";
      return state.session;
    }
  }

  async function loadPublishedContent() {
    try {
      const payload = await api("/api/public/content");
      state.content = payload?.content && typeof payload.content === "object" ? payload.content : {};
    } catch {
      state.content = {};
    }
  }

  let toastTimer;
  function toast(message, tone = "") {
    const element = document.querySelector("#site-toast");
    if (!element) return;
    element.textContent = message;
    element.classList.toggle("error", tone === "error");
    element.classList.add("show");
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => element.classList.remove("show"), 3600);
  }

  function initials(value) {
    return String(value || "RP").trim().split(/\s+/).slice(0, 2).map((part) => part[0] || "").join("").toUpperCase() || "RP";
  }

  function safeHttpsUrl(value) {
    try {
      const parsed = new URL(String(value || ""));
      if (parsed.protocol !== "https:" || parsed.username || parsed.password) return "";
      return parsed.toString();
    } catch {
      return "";
    }
  }

  function safeInternalUrl(value) {
    try {
      const raw = String(value || "");
      if (!raw.startsWith("/") || raw.startsWith("//")) return "";
      const parsed = new URL(raw, location.origin);
      return parsed.origin === location.origin ? `${parsed.pathname}${parsed.search}${parsed.hash}` : "";
    } catch {
      return "";
    }
  }

  function dateLabel(value) {
    const date = new Date(value);
    if (!value || Number.isNaN(date.getTime())) return "Date unavailable";
    return new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(date);
  }

  function count(value) {
    const number = Number(value || 0);
    return Number.isFinite(number) ? number.toLocaleString("en-GB") : "0";
  }

  function friendlyStatus(value) {
    const normalized = String(value || "unknown").toLowerCase();
    const labels = {
      published: "Published",
      approved: "Approved",
      pending_review: "Waiting for review",
      changes_requested: "Changes requested",
      rejected: "Not approved",
      draft: "Draft",
      paused: "Paused",
      open: "Open",
      claimed: "In review",
      triaged: "Triaged",
      resolved: "Resolved",
      dismissed: "Dismissed",
      high: "High",
      critical: "Critical",
      medium: "Medium",
      low: "Low"
    };
    return labels[normalized] || normalized.replace(/[_-]+/g, " ").replace(/^./, (character) => character.toUpperCase());
  }

  function statusTone(value) {
    const normalized = String(value || "").toLowerCase();
    if (["published", "approved", "resolved"].includes(normalized)) return "success";
    if (["pending_review", "changes_requested", "open", "claimed", "triaged", "medium"].includes(normalized)) return "warning";
    if (["rejected", "critical", "high"].includes(normalized)) return "danger";
    return "info";
  }

  function statusChip(value) {
    return make("span", `status-chip ${statusTone(value)}`, friendlyStatus(value));
  }

  function setRoot(content) {
    root.className = "";
    root.setAttribute("aria-busy", "false");
    root.replaceChildren(content);
  }

  function emptyState(title, description, action) {
    const section = make("div", "portal-empty-v2");
    append(section, make("h3", "", title), make("p", "", description));
    if (action) section.append(action);
    return section;
  }

  async function signInGate({ staffOnly = false, title, description } = {}) {
    const gate = make("section", "access-gate-v2");
    append(gate, make("div", "portal-avatar", staffOnly ? "S" : "RP"));
    append(gate, make("span", "portal-kicker", staffOnly ? "Restricted workspace" : "Your BrowseRP account"));
    append(gate, make("h1", "", title || (staffOnly ? "Staff sign-in required" : "Sign in to continue")));
    append(gate, make("p", "", description || (staffOnly
      ? "Use the Discord account attached to an active BrowseRP staff membership."
      : "Sign in to manage listings, follow review progress and keep servers saved in one place.")));

    const actions = make("div", "access-actions");
    let providers = { discord: true, google: false };
    try {
      providers = (await api("/api/auth/providers")).providers || providers;
    } catch { /* A clear unavailable state is shown below if no provider works. */ }
    const returnTo = staffOnly ? "/staff" : "/dashboard";
    if (providers.discord) actions.append(link(`/api/auth/discord?returnTo=${encodeURIComponent(returnTo)}`, "button button-primary", "Continue with Discord"));
    if (!staffOnly && providers.google) actions.append(link(`/api/auth/google?returnTo=${encodeURIComponent(returnTo)}`, "button button-secondary", "Continue with Google"));
    if (actions.childElementCount === 0) actions.append(make("p", "portal-status error", "Sign-in is temporarily unavailable. Please try again later."));
    gate.append(actions);
    gate.append(make("small", "access-note", staffOnly ? "Access is checked again on every staff request." : "We only use account information needed to run your BrowseRP profile."));
    setRoot(gate);
  }

  function portalHead(kicker, title, description, displayName) {
    const head = make("header", "portal-head");
    const copy = make("div", "portal-head-copy");
    if (displayName) {
      const identity = make("div", "queue-label");
      append(identity, make("div", "portal-avatar", initials(displayName)));
      const words = make("div");
      append(words, make("span", "portal-kicker", kicker), make("h1", "", title), make("p", "", description));
      append(identity, words);
      copy.append(identity);
    } else {
      append(copy, make("span", "portal-kicker", kicker), make("h1", "", title), make("p", "", description));
    }
    const actions = make("div", "portal-head-actions");
    append(head, copy, actions);
    return { head, actions };
  }

  function portalNav(items) {
    const nav = make("nav", "portal-nav");
    nav.setAttribute("aria-label", "Page sections");
    items.forEach(([href, label]) => nav.append(link(href, "", label)));
    return nav;
  }

  function metric(value, label, note) {
    const card = make("article", "metric-v2");
    append(card, make("strong", "", count(value)), make("span", "", label), make("small", "", note));
    return card;
  }

  function panel(id, title, description, action) {
    const section = make("section", "portal-panel-v2");
    section.id = id;
    const heading = make("div", "portal-panel-head");
    const copy = make("div");
    append(copy, make("h2", "", title), make("p", "", description));
    append(heading, copy, action);
    section.append(heading);
    return section;
  }

  function listItem(title, meta, actions = [], options = {}) {
    const item = make("li", `portal-item${options.className ? ` ${options.className}` : ""}`);
    const main = make("div", "portal-item-main");
    append(main, make("strong", "", title));
    if (meta) main.append(make("small", "", meta));
    if (options.description) main.append(make("p", "", options.description));
    if (options.status) main.append(statusChip(options.status));
    const actionBox = make("div", "portal-item-actions");
    actions.forEach((action) => actionBox.append(action));
    append(item, main, actionBox.childElementCount ? actionBox : null);
    return item;
  }

  function displayName(session, overview) {
    return overview?.profile?.display_name || overview?.profile?.username || session?.user?.profile?.display_name || session?.user?.profile?.username || session?.user?.email || "Member";
  }

  async function signOut() {
    try {
      await api("/api/auth/logout", { method: "POST", body: "{}" });
      location.assign("/");
    } catch (error) {
      toast(error.message, "error");
    }
  }

  function dashboardListings(servers) {
    const section = panel("listings", "Your published listings", "Open the public page for any server already approved and published.", link("/list-server", "small-button small-button-primary", "List another server"));
    if (!servers.length) {
      section.append(emptyState("No published listings yet", "Submit your FiveM community and its progress will appear below.", link("/list-server", "button button-primary", "Create a listing")));
      return section;
    }
    const list = make("ul", "portal-list");
    servers.forEach((server) => {
      const actions = [];
      if (server.slug && String(server.status).toLowerCase() === "published") actions.push(link(`/server/${encodeURIComponent(server.slug)}`, "small-button", "View listing"));
      list.append(listItem(server.name || "FiveM server", `Updated ${dateLabel(server.updated_at)}`, actions, { status: server.status }));
    });
    section.append(list);
    return section;
  }

  function dashboardSubmissions(submissions) {
    const section = panel("submissions", "Submission progress", "Review decisions and requests for changes stay attached to your account.");
    if (!submissions.length) {
      section.append(emptyState("Nothing waiting for review", "When you submit a listing, its current review state will appear here."));
      return section;
    }
    const list = make("ul", "portal-list");
    submissions.forEach((submission) => {
      list.append(listItem(submission.name || "Server submission", `Submitted ${dateLabel(submission.created_at)}`, [], { status: submission.status }));
    });
    section.append(list);
    return section;
  }

  function dashboardFavorites(favorites, refresh) {
    const section = panel("saved", "Saved servers", "Keep communities here while you decide where to play.", link("/servers", "small-button", "Browse servers"));
    if (!favorites.length) {
      section.append(emptyState("No saved servers", "Use the Save button on a server page to keep it here.", link("/servers", "button button-secondary", "Find a server")));
      return section;
    }
    const list = make("ul", "portal-list");
    favorites.forEach((server) => {
      const view = link(`/server/${encodeURIComponent(server.slug || "")}`, "small-button", "View");
      const remove = button("small-button small-button-danger", "Remove");
      remove.addEventListener("click", async () => {
        remove.disabled = true;
        try {
          await api("/api/me/favorites", { method: "POST", body: JSON.stringify({ serverId: server.id }) });
          toast("Removed from saved servers.");
          await refresh();
        } catch (error) {
          remove.disabled = false;
          toast(error.message, "error");
        }
      });
      list.append(listItem(server.name || "FiveM server", `Saved ${dateLabel(server.created_at)}`, [view, remove]));
    });
    section.append(list);
    return section;
  }

  function dashboardNotifications(notifications, unread, refresh) {
    const markRead = unread > 0 ? button("small-button", "Mark all as read") : null;
    const section = panel("notifications", "Notifications", "Review updates about your listings and account.", markRead);
    if (markRead) {
      markRead.addEventListener("click", async () => {
        markRead.disabled = true;
        try {
          await api("/api/me/notifications/read", { method: "POST", body: "{}" });
          toast("Notifications marked as read.");
          await refresh();
        } catch (error) {
          markRead.disabled = false;
          toast(error.message, "error");
        }
      });
    }
    if (!notifications.length) {
      section.append(emptyState("You are all caught up", "Account and listing updates will appear here."));
      return section;
    }
    const list = make("ul", "portal-list");
    notifications.forEach((notification) => {
      const actions = [];
      const actionUrl = safeInternalUrl(notification.action_url);
      if (actionUrl) actions.push(link(actionUrl, "small-button", "Open"));
      list.append(listItem(notification.title || "BrowseRP update", dateLabel(notification.created_at), actions, {
        className: `notification-item${notification.read_at ? "" : " unread"}`,
        description: notification.body || ""
      }));
    });
    section.append(list);
    return section;
  }

  async function dashboardPage(session) {
    if (!session?.authenticated) {
      const authState = new URLSearchParams(location.search).get("auth");
      await signInGate({
        title: authState ? "Sign-in was not completed" : (state.content["dashboard.heading"] || "Your server owner workspace"),
        description: authState ? "Please try again with an available sign-in method." : (state.content["dashboard.intro"] || undefined)
      });
      return;
    }

    try {
      const payload = await api("/api/me/overview");
      const overview = payload.overview || {};
      const servers = Array.isArray(overview.servers) ? overview.servers : [];
      const submissions = Array.isArray(overview.submissions) ? overview.submissions : [];
      const favorites = Array.isArray(overview.favoriteServers) ? overview.favoriteServers : [];
      const notifications = Array.isArray(overview.notifications) ? overview.notifications : [];
      const unread = Number(overview.unreadNotifications || 0);
      const content = make("div", "dashboard-view");
      const name = displayName(session, overview);
      const heading = portalHead("My account", `Welcome back, ${name}`, state.content["dashboard.intro"] || "Manage listings, follow reviews and return to communities you saved.", name);
      heading.actions.append(link("/list-server", "button button-primary", "List a server"));
      const logout = button("button button-secondary", "Sign out");
      logout.addEventListener("click", signOut);
      heading.actions.append(logout);
      content.append(heading.head);
      content.append(portalNav([["#listings", "Listings"], ["#submissions", "Submissions"], ["#saved", "Saved"], ["#notifications", "Notifications"]]));

      const metrics = make("section", "metric-grid-v2");
      metrics.setAttribute("aria-label", "Account summary");
      append(metrics,
        metric(servers.length, "Published listings", "Live in the public directory"),
        metric(submissions.length, "Submissions", "Recent review records"),
        metric(favorites.length, "Saved servers", "Communities kept for later"),
        metric(unread, "Unread updates", "Account notifications")
      );
      content.append(metrics);
      const stack = make("div", "portal-stack");
      const refresh = async () => dashboardPage(state.session);
      append(stack,
        dashboardListings(servers),
        dashboardSubmissions(submissions),
        dashboardFavorites(favorites, refresh),
        dashboardNotifications(notifications, unread, refresh)
      );
      content.append(stack);
      setRoot(content);
    } catch (error) {
      if (error.status === 401) {
        state.session = { authenticated: false, user: null };
        await signInGate({ title: "Your session has ended", description: "Sign in again to return to your account." });
        return;
      }
      setRoot(emptyState("Your account could not be loaded", error.message, link("/dashboard", "button button-primary", "Try again")));
    }
  }

  function serverUnknown(title, description) {
    const section = make("section", "access-gate-v2 server-unknown");
    append(section, make("div", "portal-avatar", "?"), make("span", "portal-kicker", "Server listing"), make("h1", "", title), make("p", "", description));
    const actions = make("div", "access-actions");
    append(actions, link("/servers", "button button-primary", "Browse all servers"), link("/", "button button-secondary", "Return home"));
    section.append(actions);
    setRoot(section);
  }

  function serverFact(label, value) {
    const row = make("div", "server-fact");
    append(row, make("dt", "", label), make("dd", "", value));
    return row;
  }

  async function serverPage(session) {
    const pathParts = location.pathname.split("/").filter(Boolean);
    const rawSlug = pathParts[0] === "server" && pathParts.length > 1 ? pathParts.slice(1).join("/") : new URLSearchParams(location.search).get("slug") || "";
    let slug = "";
    try { slug = decodeURIComponent(rawSlug).trim(); } catch { slug = ""; }
    if (!slug) {
      serverUnknown("Server not found", "This address does not include a server listing.");
      return;
    }

    try {
      const payload = await api(`/api/servers?slug=${encodeURIComponent(slug)}&limit=1`);
      const servers = Array.isArray(payload.servers) ? payload.servers : [];
      const server = servers.find((item) => String(item.slug || "").toLowerCase() === slug.toLowerCase());
      if (!server) {
        serverUnknown("We couldn’t find that server", "It may not be published yet, or the listing address may have changed.");
        return;
      }

      document.title = `${server.name || "FiveM server"} — BrowseRP`;
      const descriptionMeta = document.querySelector('meta[name="description"]');
      if (descriptionMeta) descriptionMeta.content = String(server.description || "Read this FiveM roleplay server listing on BrowseRP.").slice(0, 155);

      let favoriteIds = [];
      if (session?.authenticated) {
        try {
          const favoritePayload = await api("/api/me/favorites");
          favoriteIds = Array.isArray(favoritePayload.serverIds) ? favoritePayload.serverIds.map(String) : [];
        } catch { /* Saving can still be attempted and will surface its own error. */ }
      }
      let saved = favoriteIds.includes(String(server.id));
      const content = make("div", "server-view");
      const breadcrumbs = make("nav", "server-breadcrumbs");
      breadcrumbs.setAttribute("aria-label", "Breadcrumb");
      append(breadcrumbs, link("/servers", "", "Browse servers"), make("span", "", "/"), make("span", "", server.name || "Server"));
      content.append(breadcrumbs);

      const hero = make("section", "server-hero-v2");
      append(hero, make("div", "server-logo-v2", initials(server.name)));
      const title = make("div", "server-title-v2");
      append(title, make("span", "portal-kicker", `FiveM roleplay · ${server.region || "Region not listed"}`), make("h1", "", server.name || "FiveM server"));
      const liveLine = server.online
        ? `${count(server.players)}${Number(server.capacity) > 0 ? ` of ${count(server.capacity)}` : ""} players online`
        : "Live status is currently unavailable";
      append(title, make("p", "", liveLine));
      hero.append(title);

      const actions = make("div", "server-hero-actions");
      const communityUrl = safeHttpsUrl(server.community_url);
      if (communityUrl) {
        const join = link(communityUrl, "button button-primary", "Visit community");
        join.target = "_blank";
        join.rel = "nofollow noopener noreferrer";
        actions.append(join);
      } else {
        const unavailable = button("button button-primary", "Join link unavailable");
        unavailable.disabled = true;
        actions.append(unavailable);
      }
      const save = button("button button-secondary", session?.authenticated ? (saved ? "Saved" : "Save server") : "Sign in to save");
      save.setAttribute("aria-pressed", String(saved));
      save.addEventListener("click", async () => {
        if (!session?.authenticated) {
          location.assign(`/api/auth/discord?returnTo=${encodeURIComponent(location.pathname)}`);
          return;
        }
        if (!server.id) return;
        save.disabled = true;
        try {
          const result = (await api("/api/me/favorites", { method: "POST", body: JSON.stringify({ serverId: server.id }) })).result || {};
          saved = Boolean(result.favorited);
          save.textContent = saved ? "Saved" : "Save server";
          save.setAttribute("aria-pressed", String(saved));
          toast(saved ? "Server saved to your account." : "Server removed from your saved list.");
        } catch (error) {
          toast(error.message, "error");
        } finally {
          save.disabled = false;
        }
      });
      actions.append(save);
      if (!communityUrl) actions.append(make("p", "join-note", "The owner has not supplied a secure community link."));
      hero.append(actions);
      content.append(hero);

      const layout = make("div", "server-detail-layout");
      const about = make("article", "server-card-v2");
      append(about, make("span", "portal-kicker", "About this community"), make("h2", "", "What to expect"), make("p", "server-description-v2", server.description || "This owner has not added a full description yet."));
      const tags = make("div", "server-tags-v2");
      (Array.isArray(server.tags) ? server.tags : []).slice(0, 10).forEach((tag) => tags.append(make("span", "", tag)));
      if (tags.childElementCount) about.append(tags);

      const factsCard = make("aside", "server-card-v2");
      factsCard.append(make("h2", "", "Server details"));
      const facts = make("dl", "server-facts");
      append(facts,
        serverFact("Status", server.online ? "Online now" : "Unavailable"),
        serverFact("Region", server.region || "Not listed"),
        serverFact("Language", server.language || "Not listed"),
        serverFact("Framework", server.framework || "Not listed"),
        serverFact("Beginner friendly", server.beginner_friendly ? "Yes" : "Not marked"),
        serverFact("Listing owner", server.verified ? "Owner verified" : "Not verified")
      );
      const uptime = Number(server.uptime_percent);
      if (Number.isFinite(uptime) && uptime > 0) facts.insertBefore(serverFact("30-day uptime", `${uptime.toFixed(1)}%`), facts.children[1] || null);
      factsCard.append(facts);
      factsCard.append(make("p", "verification-note", server.verified
        ? "Owner verified means BrowseRP confirmed control of this listing. It is not a guarantee of server quality or conduct."
        : "This listing has not completed owner verification. Read the details and community rules before joining."));
      append(layout, about, factsCard);
      content.append(layout);
      setRoot(content);
    } catch (error) {
      if (error.status === 404) serverUnknown("We couldn’t find that server", "It may not be published yet, or the listing address may have changed.");
      else serverUnknown("This server is temporarily unavailable", "The directory could not load this listing. Please try again shortly.");
    }
  }

  function queueActions(kind, permissions) {
    const has = (permission) => permissions.has(permission);
    if (kind === "listing" && has("servers.review")) return [
      ["approved", "Approve", "success"],
      ["changes_requested", "Request changes", ""],
      ["rejected", "Reject", "danger"]
    ];
    if (kind === "report" && has("reports.resolve")) return [["triaged", "Triage", ""], ["resolved", "Resolve", "success"], ["dismissed", "Dismiss", "danger"]];
    if (kind === "moderation" && has("moderation.resolve")) return [["claimed", "Claim", ""], ["resolved", "Resolve", "success"], ["dismissed", "Dismiss", "danger"]];
    if (kind === "security" && has("settings.manage")) return [["resolved", "Mark resolved", "success"]];
    return [];
  }

  function staffQueueSection({ id, title, description, items, empty, kind, permissions, itemTitle, itemMeta, symbol }) {
    const section = panel(id, title, description);
    if (!items.length) {
      section.append(emptyState(empty, "No action is needed right now."));
      return section;
    }
    const list = make("ul", "portal-list");
    items.forEach((item) => {
      const row = make("li", "portal-item staff-queue-row");
      const label = make("div", "queue-label");
      const main = make("div", "portal-item-main");
      append(main, make("strong", "", itemTitle(item)), make("small", "", itemMeta(item)));
      if (item.status || item.severity) main.append(statusChip(item.status || item.severity));
      append(label, make("span", "queue-symbol", symbol), main);
      const actionBox = make("div", "portal-item-actions");
      const actions = queueActions(kind, permissions);
      const inspect = button("small-button", actions.length ? "Review" : "Inspect");
      inspect.dataset.staffAction = "review";
      inspect.dataset.kind = kind;
      inspect.dataset.id = String(item.id || "");
      inspect.addEventListener("click", () => openReview(kind, item.id, itemTitle(item), actions));
      actionBox.append(inspect);
      append(row, label, actionBox);
      list.append(row);
    });
    section.append(list);
    return section;
  }

  function humanKey(value) {
    return String(value || "Field").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").replace(/^./, (character) => character.toUpperCase());
  }

  function evidenceValue(value) {
    if (value === null || value === undefined || value === "") return "Not supplied";
    if (typeof value === "object") return JSON.stringify(value, null, 2);
    return String(value);
  }

  function renderEvidence(item) {
    const list = make("dl", "evidence-list");
    Object.entries(item || {}).forEach(([key, value]) => {
      append(list, make("dt", "", humanKey(key)), make("dd", "", evidenceValue(value)));
    });
    return list;
  }

  function closeReview() {
    const dialog = document.querySelector("#review-dialog");
    if (dialog?.open) dialog.close();
  }

  async function openReview(kind, id, title, actions) {
    const dialog = document.querySelector("#review-dialog");
    const form = document.querySelector("#review-form");
    const evidence = document.querySelector("#review-evidence");
    const reason = document.querySelector("#review-reason");
    const reasonField = reason.closest("label");
    const actionBox = document.querySelector("#review-actions");
    const status = document.querySelector("#review-status");
    document.querySelector("#review-dialog-title").textContent = title;
    evidence.replaceChildren(make("p", "portal-status", "Loading permission-scoped evidence…"));
    actionBox.replaceChildren();
    status.textContent = "";
    status.className = "portal-status";
    reason.value = "";
    reasonField.hidden = actions.length === 0;
    reason.required = actions.length > 0;
    form.dataset.kind = kind;
    form.dataset.id = String(id || "");
    actions.forEach(([action, label, tone]) => {
      const actionButton = make("button", `small-button${tone ? ` small-button-${tone}` : ""}`, label);
      actionButton.type = "submit";
      actionButton.dataset.reviewAction = action;
      actionBox.append(actionButton);
    });
    if (!actions.length) actionBox.append(button("small-button", "Close"));
    actionBox.querySelector("button:not([data-review-action])")?.addEventListener("click", closeReview);
    dialog.showModal();
    try {
      const payload = await api(`/api/admin/item?kind=${encodeURIComponent(kind)}&id=${encodeURIComponent(String(id || ""))}`);
      evidence.replaceChildren(renderEvidence(payload.item));
    } catch (error) {
      evidence.replaceChildren(make("p", "portal-status error", error.message));
      actionBox.querySelectorAll("[data-review-action]").forEach((element) => { element.disabled = true; });
    }
  }

  function wireReviewDialog() {
    const dialog = document.querySelector("#review-dialog");
    const form = document.querySelector("#review-form");
    document.querySelector("[data-review-close]")?.addEventListener("click", closeReview);
    dialog?.addEventListener("click", (event) => {
      if (event.target === dialog) closeReview();
    });
    form?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const action = event.submitter?.dataset.reviewAction;
      if (!action) return;
      const reason = document.querySelector("#review-reason");
      if (!reason.reportValidity()) return;
      const status = document.querySelector("#review-status");
      const buttons = [...form.querySelectorAll("[data-review-action]")];
      buttons.forEach((element) => { element.disabled = true; });
      status.textContent = "Saving the decision and audit record…";
      status.className = "portal-status";
      try {
        await api("/api/admin/action", {
          method: "POST",
          body: JSON.stringify({ kind: form.dataset.kind, id: form.dataset.id, action, reason: reason.value.trim() })
        });
        status.textContent = "Decision saved.";
        status.className = "portal-status success";
        toast("Staff decision saved.");
        closeReview();
        await staffPage(state.session);
      } catch (error) {
        status.textContent = error.message;
        status.className = "portal-status error";
        buttons.forEach((element) => { element.disabled = false; });
      }
    });
  }

  function normalizeEntries(payload) {
    if (Array.isArray(payload?.entries)) return payload.entries;
    if (payload?.entries && typeof payload.entries === "object") {
      return Object.entries(payload.entries).map(([key, value]) => ({ key, value }));
    }
    return [];
  }

  function contentValue(entry) {
    if (Object.prototype.hasOwnProperty.call(entry, "draftValue")) return entry.draftValue;
    if (Object.prototype.hasOwnProperty.call(entry, "draft_value")) return entry.draft_value;
    if (Object.prototype.hasOwnProperty.call(entry, "value")) return entry.value;
    if (Object.prototype.hasOwnProperty.call(entry, "content")) return entry.content;
    return null;
  }

  function editorText(value) {
    if (typeof value === "boolean") return value ? "true" : "false";
    return String(value ?? "");
  }

  function containsRawHtml(value) {
    if (typeof value === "string") return /<\/?[a-z][^>]*>/i.test(value);
    if (Array.isArray(value)) return value.some(containsRawHtml);
    if (value && typeof value === "object") return Object.values(value).some(containsRawHtml);
    return false;
  }

  function parseEditorValue(text, type) {
    let value = text;
    if (type === "boolean") {
      const normalized = text.trim().toLowerCase();
      if (normalized !== "true" && normalized !== "false") throw new Error("This setting must be true or false.");
      value = normalized === "true";
    }
    if (containsRawHtml(value)) throw new Error("Use plain text fields, not HTML. The website controls presentation safely.");
    return value;
  }

  function contentSection(contentPayload) {
    const entries = normalizeEntries(contentPayload);
    const section = panel("content", "Website content", "Edit approved content keys as plain text or a true/false setting. Publishing never accepts raw HTML.");
    section.append(make("p", "permission-note", "Every save, publish and rollback requires a reason and uses a version check so one person cannot silently overwrite another person’s work."));
    if (!entries.length) {
      section.append(emptyState("No managed content keys", "The content store has not been given any approved keys yet."));
      return section;
    }
    const grid = make("div", "content-grid");
    entries.forEach((entry) => {
      const key = String(entry.key || "");
      const version = Number(entry.version ?? entry.currentVersion ?? entry.current_version ?? 0);
      const publishedVersion = Number(entry.publishedVersion ?? entry.published_version ?? 0);
      const type = entry.type === "boolean" ? "boolean" : "string";
      const value = contentValue(entry);
      const editor = make("form", "content-editor");
      editor.dataset.contentKey = key;
      editor.dataset.contentVersion = String(Number.isFinite(version) ? version : 0);
      const header = make("div", "content-editor-head");
      const identity = make("div");
      append(identity, make("span", "content-key", key), make("span", "content-meta", `Version ${Number.isFinite(version) ? version : 0} · published version ${Number.isFinite(publishedVersion) ? publishedVersion : 0}`));
      if (entry.updatedAt || entry.updated_at) identity.append(make("span", "content-meta", `Updated ${dateLabel(entry.updatedAt || entry.updated_at)}`));
      header.append(identity);
      if (entry.status || entry.published) header.append(statusChip(entry.status || "published"));
      editor.append(header);
      if (entry.description) editor.append(make("p", "content-description", entry.description));

      const valueLabel = make("label", "portal-field");
      const valueId = `content-value-${key.replace(/[^a-z0-9_-]/gi, "-")}`;
      let valueControl;
      if (type === "boolean") {
        valueControl = make("select");
        [["true", "True"], ["false", "False"]].forEach(([optionValue, label]) => {
          const option = make("option", "", label);
          option.value = optionValue;
          valueControl.append(option);
        });
      } else {
        valueControl = make("textarea");
        valueControl.spellcheck = true;
      }
      valueControl.id = valueId;
      valueControl.name = "value";
      valueControl.required = true;
      valueControl.value = editorText(value);
      append(valueLabel, make("span", "", "Content"), valueControl, make("small", "", type === "boolean" ? "Choose whether this setting is on or off." : "Plain text only. HTML is not accepted."));
      editor.append(valueLabel);

      const reasonLabel = make("label", "portal-field content-reason");
      const reason = make("input");
      reason.type = "text";
      reason.name = "reason";
      reason.minLength = 5;
      reason.maxLength = 500;
      reason.required = true;
      reason.placeholder = "Why are you making this change?";
      append(reasonLabel, make("span", "", "Change reason"), reason);
      editor.append(reasonLabel);

      const actions = make("div", "content-actions");
      [["save_draft", "Save draft", ""], ["publish", "Publish", "success"], ["rollback", "Roll back", "danger"]].forEach(([action, label, tone]) => {
        const actionButton = make("button", `small-button${tone ? ` small-button-${tone}` : ""}`, label);
        actionButton.type = "submit";
        actionButton.dataset.contentAction = action;
        actions.append(actionButton);
      });
      editor.append(actions);
      const status = make("p", "portal-status");
      status.setAttribute("role", "status");
      status.setAttribute("aria-live", "polite");
      editor.append(status);

      editor.addEventListener("submit", async (event) => {
        event.preventDefault();
        const action = event.submitter?.dataset.contentAction;
        if (!action || !editor.reportValidity()) return;
        const buttons = [...editor.querySelectorAll("[data-content-action]")];
        buttons.forEach((element) => { element.disabled = true; });
        status.textContent = action === "publish" ? "Publishing…" : action === "rollback" ? "Rolling back…" : "Saving draft…";
        status.className = "portal-status";
        try {
          const parsedValue = parseEditorValue(valueControl.value, type);
          await api("/api/admin/content", {
            method: "POST",
            body: JSON.stringify({
              key,
              value: parsedValue,
              action,
              reason: reason.value.trim(),
              expectedVersion: Number(editor.dataset.contentVersion)
            })
          });
          status.textContent = "Content updated.";
          status.className = "portal-status success";
          toast("Website content updated.");
          await staffPage(state.session);
        } catch (error) {
          status.textContent = error.status === 409 ? "This entry changed elsewhere. Reload the staff centre before trying again." : error.message;
          status.className = "portal-status error";
          buttons.forEach((element) => { element.disabled = false; });
        }
      });
      grid.append(editor);
    });
    section.append(grid);
    return section;
  }

  function staffAuditSection(items) {
    const section = panel("audit", "Audit log", "Reasons and outcomes for recent staff decisions.");
    if (!items.length) {
      section.append(emptyState("No staff actions recorded", "Audited decisions will appear here."));
      return section;
    }
    const list = make("ul", "portal-list");
    items.forEach((item) => {
      list.append(listItem(friendlyStatus(item.action), `${humanKey(item.target_type)} · ${dateLabel(item.created_at)}`, [], { description: item.reason || "No reason recorded." }));
    });
    section.append(list);
    return section;
  }

  async function staffPage(session) {
    if (!session?.authenticated) {
      await signInGate({ staffOnly: true });
      return;
    }
    if (session.provider !== "discord") {
      await signInGate({ staffOnly: true, title: "Discord staff identity required", description: "This account is signed in, but staff access is only checked against an authorized Discord identity." });
      return;
    }

    try {
      const payload = await api("/api/admin/overview");
      const overview = payload.overview || {};
      state.staffOverview = overview;
      const permissions = new Set(Array.isArray(overview.permissions) ? overview.permissions : []);
      let contentPayload = null;
      try {
        contentPayload = await api("/api/admin/content");
      } catch (error) {
        if (error.status !== 401 && error.status !== 403 && error.status !== 404) throw error;
      }

      const content = make("div", "staff-view");
      const intro = make("section", "staff-intro");
      const roleName = overview.role?.name || "Staff";
      const heading = portalHead(`Restricted staff centre · ${roleName}`, "Operations", "Review one item at a time, record a reason and leave an audit trail.");
      heading.head.querySelector(".portal-kicker")?.classList.add("staff-role");
      heading.actions.append(link("/legal#standards", "button button-secondary", "Community rules"));
      const logout = button("button button-secondary", "Sign out");
      logout.addEventListener("click", signOut);
      heading.actions.append(logout);
      intro.append(heading.head);
      content.append(intro);

      const sections = [];
      if (permissions.has("servers.review")) sections.push(staffQueueSection({
        id: "listings", title: "Listing reviews", description: "Check the submitted details before approving, requesting changes or rejecting.",
        items: Array.isArray(overview.listingQueue) ? overview.listingQueue : [], empty: "No listings need review", kind: "listing", permissions, symbol: "L",
        itemTitle: (item) => item.name || "Server submission",
        itemMeta: (item) => `${item.platform_id || "FiveM"} · ${item.region || "Region not listed"} · submitted ${dateLabel(item.created_at)}`
      }));
      if (permissions.has("reports.read")) sections.push(staffQueueSection({
        id: "reports", title: "Member reports", description: "Inspect report evidence before triage or resolution.",
        items: Array.isArray(overview.reportQueue) ? overview.reportQueue : [], empty: "No reports need attention", kind: "report", permissions, symbol: "!",
        itemTitle: (item) => friendlyStatus(item.category || "Member report"),
        itemMeta: (item) => `${humanKey(item.target_type)} · reported ${dateLabel(item.created_at)}`
      }));
      if (permissions.has("moderation.read")) sections.push(staffQueueSection({
        id: "moderation", title: "Moderation queue", description: "Use the recorded signals as evidence, then make a reasoned decision.",
        items: Array.isArray(overview.moderationQueue) ? overview.moderationQueue : [], empty: "The moderation queue is clear", kind: "moderation", permissions, symbol: "M",
        itemTitle: (item) => humanKey(item.target_type || "Moderation item"),
        itemMeta: (item) => `${friendlyStatus(item.confidence || "unknown")} confidence · score ${Number(item.score || 0)} · opened ${dateLabel(item.created_at)}`
      }));
      if (permissions.has("security.read")) sections.push(staffQueueSection({
        id: "security", title: "Security events", description: "Review privacy-preserving security signals. Raw network addresses are never shown here.",
        items: Array.isArray(overview.securityEvents) ? overview.securityEvents : [], empty: "No unresolved security events", kind: "security", permissions, symbol: "S",
        itemTitle: (item) => humanKey(item.event_type || "Security event"),
        itemMeta: (item) => `${friendlyStatus(item.severity)} severity · ${dateLabel(item.created_at)}`
      }));
      if (contentPayload) sections.push(contentSection(contentPayload));
      if (permissions.has("audit.read")) sections.push(staffAuditSection(Array.isArray(overview.recentAudit) ? overview.recentAudit : []));

      const navItems = [["#overview", "Overview"]];
      sections.forEach((section) => navItems.push([`#${section.id}`, section.querySelector("h2")?.textContent || humanKey(section.id)]));
      const nav = portalNav(navItems);
      content.append(nav);

      const metrics = make("section", "metric-grid-v2");
      metrics.setAttribute("aria-label", "Operations summary");
      append(metrics,
        metric(overview.pendingSubmissions, "Listing reviews", "Waiting for a decision"),
        metric(overview.openReports, "Open reports", "New or triaged"),
        metric(overview.openModeration, "Moderation cases", "Open or claimed"),
        metric(overview.securityAlerts, "Security alerts", "High or critical")
      );
      content.append(metrics);
      const stack = make("div", "portal-stack");
      if (sections.length) sections.forEach((section) => stack.append(section));
      else stack.append(emptyState("No assigned queues", "Your staff identity is active but has no operational permissions."));
      content.append(stack);
      setRoot(content);

    } catch (error) {
      if (error.status === 401 || error.status === 403) {
        await signInGate({ staffOnly: true, title: "Staff permission required", description: "This Discord account does not have an active BrowseRP staff membership." });
        return;
      }
      setRoot(emptyState("Staff centre unavailable", error.message, link("/staff", "button button-primary", "Try again")));
    }
  }

  async function init() {
    if (!root) return;
    wireReviewDialog();
    const [session] = await Promise.all([loadSession(), loadPublishedContent()]);
    if (page === "dashboard") await dashboardPage(session);
    if (page === "server") await serverPage(session);
    if (page === "staff") await staffPage(session);
  }

  init();
})();
