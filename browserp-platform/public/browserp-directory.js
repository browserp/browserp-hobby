(() => {
  "use strict";

  const page = document.body.dataset.page || "";
  const state = {
    session: { authenticated: false, user: null },
    filters: { query: "", region: "all", online: false, verified: false, beginner: false, sort: "recommended" }
  };
  const select = (selector, root = document) => root.querySelector(selector);

  async function api(path, options = {}) {
    const method = String(options.method || "GET").toUpperCase();
    const writeRequest = method !== "GET" && method !== "HEAD";
    const csrfHeaders = writeRequest && state.session?.csrfToken
      ? { "X-BrowseRP-CSRF": state.session.csrfToken }
      : {};
    const response = await fetch(path, {
      ...options,
      credentials: "same-origin",
      headers: { Accept: "application/json", ...(options.body ? { "Content-Type": "application/json" } : {}), ...csrfHeaders, ...(options.headers || {}) }
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload.error || "Something went wrong. Please try again.");
      error.status = response.status;
      throw error;
    }
    return payload;
  }

  let toastTimer;
  function toast(message, tone = "") {
    const element = select("#site-toast");
    if (!element) return;
    element.textContent = message;
    element.classList.toggle("error", tone === "error");
    element.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => element.classList.remove("show"), 3600);
  }

  function initials(value) {
    return String(value || "RP").trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
  }

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  function serverCard(server) {
    const slug = String(server.slug || "").trim();
    const card = element("a", "server-card");
    card.href = `/server/${encodeURIComponent(slug)}`;
    card.setAttribute("aria-label", `View ${String(server.name || "server")}`);

    const top = element("div", "server-card-top");
    top.append(element("span", "server-initials", initials(server.name)));
    const status = element("span", `status${server.online ? " online" : ""}`, server.online ? "Online now" : "Status unavailable");
    top.append(status);
    card.append(top);

    card.append(element("h3", "", server.name || "FiveM server"));
    const details = [server.region, server.framework, server.language].filter(Boolean);
    if (server.verified) details.push("Owner verified");
    card.append(element("div", "server-meta", details.join(" · ") || "FiveM roleplay"));
    card.append(element("p", "server-description", server.description || "Open the listing to learn more about this community."));

    const tags = element("div", "server-tags");
    (Array.isArray(server.tags) ? server.tags : []).slice(0, 3).forEach((tag) => tags.append(element("span", "", tag)));
    card.append(tags);

    const bottom = element("div", "server-card-bottom");
    const playerText = server.online
      ? `${Number(server.players || 0).toLocaleString()}${server.capacity ? ` / ${Number(server.capacity).toLocaleString()}` : ""} players`
      : "Player count unavailable";
    bottom.append(element("strong", "", playerText), element("span", "", "View listing →"));
    card.append(bottom);
    return card;
  }

  function renderServers(list, servers) {
    list.replaceChildren(...servers.map(serverCard));
    list.setAttribute("aria-busy", "false");
  }

  async function featured() {
    const list = select("#featured-server-list");
    const empty = select("#featured-empty");
    if (!list || !empty) return;
    try {
      const payload = await api("/api/servers?platform=fivem&sort=recommended&limit=3");
      const servers = Array.isArray(payload.servers) ? payload.servers : [];
      renderServers(list, servers);
      list.hidden = servers.length === 0;
      empty.hidden = servers.length !== 0;
    } catch (error) {
      list.replaceChildren();
      list.hidden = true;
      list.setAttribute("aria-busy", "false");
      empty.hidden = false;
      select("h3", empty).textContent = "The directory is taking a moment.";
      select("p", empty).textContent = "Please refresh the page shortly.";
      toast(error.message, "error");
    }
  }

  function home() {
    select("#home-search-form")?.addEventListener("submit", (event) => {
      event.preventDefault();
      const query = select("#home-search")?.value.trim() || "";
      const destination = new URL("/servers", location.origin);
      if (query) destination.searchParams.set("q", query.slice(0, 120));
      location.assign(`${destination.pathname}${destination.search}`);
    });
    featured();
  }

  function readFilters() {
    const params = new URLSearchParams(location.search);
    state.filters.query = (params.get("q") || "").slice(0, 120);
    state.filters.region = (params.get("region") || "all").slice(0, 60);
    state.filters.sort = (params.get("sort") || "recommended").slice(0, 30);
    state.filters.online = params.get("online") === "true";
    state.filters.verified = params.get("verified") === "true";
    state.filters.beginner = params.get("beginner") === "true";
  }

  function syncControls() {
    const search = select("#directory-search");
    const region = select("#region-filter");
    const sort = select("#sort-filter");
    search.value = state.filters.query;
    region.value = [...region.options].some((option) => option.value === state.filters.region) ? state.filters.region : "all";
    sort.value = [...sort.options].some((option) => option.value === state.filters.sort) ? state.filters.sort : "recommended";
    select("#online-filter").checked = state.filters.online;
    select("#verified-filter").checked = state.filters.verified;
    select("#beginner-filter").checked = state.filters.beginner;
  }

  function syncUrl() {
    const params = new URLSearchParams();
    if (state.filters.query) params.set("q", state.filters.query);
    if (state.filters.region !== "all") params.set("region", state.filters.region);
    if (state.filters.sort !== "recommended") params.set("sort", state.filters.sort);
    if (state.filters.online) params.set("online", "true");
    if (state.filters.verified) params.set("verified", "true");
    if (state.filters.beginner) params.set("beginner", "true");
    history.replaceState(null, "", `${location.pathname}${params.size ? `?${params}` : ""}`);
  }

  async function directoryResults() {
    const list = select("#server-list");
    const empty = select("#directory-empty");
    list.hidden = false;
    list.setAttribute("aria-busy", "true");
    empty.hidden = true;

    const params = new URLSearchParams({ platform: "fivem", sort: state.filters.sort, limit: "100" });
    if (state.filters.query) params.set("query", state.filters.query);
    if (state.filters.region !== "all") params.set("region", state.filters.region);
    if (state.filters.online) params.set("online", "true");
    if (state.filters.verified) params.set("verified", "true");
    if (state.filters.beginner) params.set("beginner", "true");

    try {
      const payload = await api(`/api/servers?${params}`);
      const servers = Array.isArray(payload.servers) ? payload.servers : [];
      renderServers(list, servers);
      list.hidden = servers.length === 0;
      empty.hidden = servers.length !== 0;
      const filtersActive = Boolean(state.filters.query || state.filters.region !== "all" || state.filters.online || state.filters.verified || state.filters.beginner);
      select("#result-count").textContent = `${servers.length} ${servers.length === 1 ? "server" : "servers"}`;
      if (!servers.length) {
        select("h3", empty).textContent = filtersActive ? "No servers match those filters." : "No servers are live yet.";
        select("p", empty).textContent = filtersActive
          ? "Clear a filter or try a broader search."
          : "Run a FiveM community? Submit it for review and be one of the first listings.";
      }
      syncUrl();
    } catch (error) {
      list.replaceChildren();
      list.hidden = true;
      list.setAttribute("aria-busy", "false");
      empty.hidden = false;
      select("#result-count").textContent = "0 servers";
      select("h3", empty).textContent = "The directory could not be loaded.";
      select("p", empty).textContent = "Please try again shortly.";
      toast(error.message, "error");
    }
  }

  function resetFilters() {
    state.filters = { query: "", region: "all", online: false, verified: false, beginner: false, sort: "recommended" };
    syncControls();
    directoryResults();
  }

  function directory() {
    readFilters();
    syncControls();
    let searchTimer;
    select("#directory-search").addEventListener("input", (event) => {
      clearTimeout(searchTimer);
      state.filters.query = event.target.value.trim().slice(0, 120);
      searchTimer = window.setTimeout(directoryResults, 220);
    });
    select("#region-filter").addEventListener("change", (event) => { state.filters.region = event.target.value; directoryResults(); });
    select("#sort-filter").addEventListener("change", (event) => { state.filters.sort = event.target.value; directoryResults(); });
    [["#online-filter", "online"], ["#verified-filter", "verified"], ["#beginner-filter", "beginner"]].forEach(([selector, key]) => {
      select(selector).addEventListener("change", (event) => { state.filters[key] = event.target.checked; directoryResults(); });
    });
    select("#clear-filters").addEventListener("click", resetFilters);
    const filterButton = select("#filter-toggle");
    const filterPanel = select("#filter-panel");
    const mobileFilters = window.matchMedia("(max-width: 760px)");
    let filterCloseTimer;

    function setFilterPanel(open, immediate = false) {
      clearTimeout(filterCloseTimer);
      if (!mobileFilters.matches) {
        filterPanel.hidden = false;
        filterPanel.inert = false;
        filterPanel.dataset.open = "true";
        filterPanel.setAttribute("aria-hidden", "false");
        filterButton.setAttribute("aria-expanded", "false");
        return;
      }

      filterButton.setAttribute("aria-expanded", String(open));
      filterPanel.setAttribute("aria-hidden", String(!open));
      filterPanel.inert = !open;
      if (open) {
        filterPanel.hidden = false;
        requestAnimationFrame(() => { filterPanel.dataset.open = "true"; });
        return;
      }
      filterPanel.dataset.open = "false";
      if (immediate || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        filterPanel.hidden = true;
        return;
      }
      filterCloseTimer = window.setTimeout(() => { filterPanel.hidden = true; }, 240);
    }

    filterButton.addEventListener("click", () => {
      const open = filterButton.getAttribute("aria-expanded") !== "true";
      setFilterPanel(open);
    });
    mobileFilters.addEventListener?.("change", () => setFilterPanel(false, true));
    setFilterPanel(false, true);
    directoryResults();
  }

  function setFormStatus(message, tone = "") {
    const status = select("#listing-status");
    status.textContent = message;
    status.className = `form-status${tone ? ` ${tone}` : ""}`;
  }

  const LISTING_TAGS = Object.freeze([
    ["economy", "Economy"], ["whitelisted", "Whitelisted"], ["public-access", "Public access"],
    ["serious-roleplay", "Serious RP"], ["semi-serious", "Semi-serious RP"],
    ["beginner-friendly", "Beginner friendly"], ["custom-clothing", "Custom clothing"],
    ["custom-cars", "Custom vehicles"], ["custom-jobs", "Custom jobs"],
    ["player-businesses", "Player businesses"], ["housing", "Housing"], ["police", "Police"],
    ["ems", "EMS"], ["gangs", "Gangs"], ["civilian-jobs", "Civilian jobs"],
    ["controller-friendly", "Controller friendly"], ["streamer-friendly", "Streamer friendly"]
  ]);

  function setupTagPicker(form) {
    const picker = select(".tag-picker-v3", form);
    if (!picker) return;
    picker.replaceChildren(...LISTING_TAGS.map(([value, labelText]) => {
      const label = element("label", "check-v3");
      const input = document.createElement("input");
      input.type = "checkbox";
      input.name = "tags";
      input.value = value;
      label.append(input, document.createTextNode(` ${labelText}`));
      return label;
    }));
    const updateLimit = () => {
      const selected = picker.querySelectorAll('input[name="tags"]:checked').length;
      picker.querySelectorAll('input[name="tags"]:not(:checked)').forEach((input) => {
        input.disabled = selected >= 8;
      });
    };
    picker.addEventListener("change", updateLimit);
    updateLimit();
  }

  async function listing() {
    const gate = select("#listing-auth-gate");
    const form = select("#listing-form");
    const accountNotice = select("#listing-account-notice");
    const providerNote = select("#provider-note");
    let submissionAttemptKey = crypto.randomUUID();
    setupTagPicker(form);

    try {
      state.session = await api("/api/auth/session");
    } catch {
      state.session = { authenticated: false, user: null };
    }

    if (state.session.authenticated) {
      gate.hidden = true;
      gate.inert = true;
      form.hidden = false;
      form.inert = false;
      const name = state.session.user?.profile?.display_name || state.session.user?.email || "your account";
      accountNotice.textContent = `Signed in as ${name}. Review updates will appear in My account.`;
    } else {
      gate.hidden = false;
      gate.inert = false;
      form.hidden = true;
      form.inert = true;
      try {
        const payload = await api("/api/auth/providers");
        const providers = payload.providers || {};
        let available = false;
        document.querySelectorAll("[data-auth-provider]").forEach((link) => {
          const enabled = Boolean(providers[link.dataset.authProvider]);
          link.hidden = !enabled;
          link.inert = !enabled;
          available ||= enabled;
        });
        providerNote.hidden = available;
        if (!available) providerNote.textContent = "Sign-in is temporarily unavailable. Please try again later.";
      } catch {
        providerNote.hidden = false;
        providerNote.textContent = "Sign-in is temporarily unavailable. Please try again later.";
      }
    }

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!state.session.authenticated || !form.reportValidity()) return;
      const submit = select("#submit-listing");
      const formData = new FormData(form);
      const data = Object.fromEntries(formData);
      const tags = formData.getAll("tags").slice(0, 8);
      submit.disabled = true;
      submit.textContent = "Submitting…";
      setFormStatus("Sending your listing for review…");
      try {
        const payload = await api("/api/submissions", {
          method: "POST",
          headers: { "Idempotency-Key": submissionAttemptKey },
          body: JSON.stringify({
            platform: "fivem",
            name: data.name,
            region: data.region,
            language: data.language,
            framework: data.framework,
            description: data.description,
            communityUrl: data.communityUrl,
            cfxJoinUrl: data.cfxJoinUrl,
            accessType: data.accessType,
            tags,
            agreement: data.agreement === "on"
          })
        });
        form.reset();
        submissionAttemptKey = crypto.randomUUID();
        setFormStatus(`Listing received. Reference: ${payload.submission.id}`, "success");
        toast("Your listing was submitted for review.");
      } catch (error) {
        setFormStatus(error.message, "error");
        toast(error.message, "error");
      } finally {
        submit.disabled = false;
        submit.textContent = "Submit for review";
      }
    });
  }

  if (page === "home") home();
  if (page === "servers") directory();
  if (page === "list-server") listing();

  const authResult = new URLSearchParams(location.search).get("auth");
  const authMessages = {
    failed: "Sign-in could not be completed. Please try again.",
    "backend-not-configured": "Sign-in is temporarily unavailable.",
    "discord-not-configured": "Discord sign-in is temporarily unavailable.",
    "google-not-configured": "Google sign-in is temporarily unavailable."
  };
  if (authMessages[authResult]) toast(authMessages[authResult], "error");
})();
