(() => {
  "use strict";

  const page = document.body.dataset.page || "";
  const state = {
    session: { authenticated: false, user: null },
    filters: { query: "", platform: "all", region: "all", online: false, verified: false, beginner: false, sort: "recommended" }
  };
  const select = (selector, root = document) => root.querySelector(selector);
  const SEARCH_SUGGESTIONS = Object.freeze([
    ["Game", "FiveM roleplay", "fivem"], ["Game", "RedM roleplay", "redm"], ["Game", "Roblox roleplay", "roblox"], ["Game", "Minecraft roleplay", "minecraft"],
    ["Game", "Forza cruising", "forza"], ["Game", "Garry's Mod roleplay", "gmod"], ["Game", "DayZ roleplay", "dayz"], ["Game", "Euro Truck Simulator roleplay", "ets2"],
    ["Framework", "QBCore"], ["Framework", "ESX"], ["Framework", "vMenu"], ["Framework", "Fantasy SMP"],
    ["Tag", "serious roleplay"], ["Tag", "economy"], ["Tag", "whitelisted"], ["Tag", "custom clothing"],
    ["Tag", "custom vehicles"], ["Tag", "player businesses"], ["Tag", "beginner friendly"], ["Access", "public servers"],
    ["Region", "United Kingdom"], ["Region", "United States"], ["Region", "Europe"], ["Region", "Australia"],
    ["Game", "ARMA roleplay", "arma"], ["Game", "VRChat roleplay", "vrchat"],
    ["Game", "Project Zomboid roleplay", "project-zomboid"], ["Game", "Assetto Corsa roleplay", "assetto-corsa"],
    ["Game", "BeamNG.drive roleplay", "beamng"]
  ]);
  const INITIAL_SEARCH_SUGGESTIONS = Object.freeze([0, 2, 8, 9, 12, 19, 20].map((index) => SEARCH_SUGGESTIONS[index]));
  const SHOWCASE_SERVER = Object.freeze({
    slug: "san-andreas-county-roleplay-showcase",
    showcase_url: "/server/san-andreas-county-roleplay-showcase",
    name: "San Andreas County Roleplay",
    platform_id: "fivem",
    platform_name: "FiveM",
    region: "United States",
    framework: "vMenu",
    language: "English",
    verified: true,
    beginner_friendly: true,
    online: false,
    logo_url: "/assets/san-andreas-county-rp-mark-v4.svg",
    description: "A complete BrowseRP showcase for a public-safety focused county community, with departments, civilian careers and structured roleplay.",
    tags: ["Public safety", "Civilian life", "Custom vehicles"],
    showcase: true
  });

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

  function serverSkeletonCard() {
    const card = element("a", "server-card server-card-skeleton");
    card.href = "/servers";
    card.setAttribute("aria-hidden", "true");
    card.tabIndex = -1;
    card.append(
      element("div", "server-card-top server-card-top-skeleton"),
      element("h3", "server-title-skeleton"),
      element("div", "server-meta-skeleton"),
      element("p", "server-description-skeleton"),
      element("div", "server-tags server-tags-skeleton"),
      element("div", "server-card-bottom"),
      element("span", "server-card-action-skeleton", "\u00a0")
    );
    return card;
  }

  function setLoadingState(list, count = 6) {
    if (!list) return;
    list.setAttribute("aria-busy", "true");
    list.replaceChildren(...Array.from({ length: count }, (_, index) => {
      const row = serverSkeletonCard();
      row.style.setProperty("--card-reveal-delay", `${index * 35}ms`);
      window.__browserpReveal?.register?.(row, index * 35, false);
      if (!row.classList.contains("reveal-v3")) row.classList.add("reveal-v3");
      row.classList.add("is-revealed");
      return row;
    }));
  }

  function serverCard(server) {
    const slug = String(server.slug || "").trim();
    const platformId = String(server.platform_id || "other").toLowerCase();
    const card = element("a", "server-card");
    window.BrowseRPPlatforms.theme(card, window.BrowseRPPlatforms.idFor(server));
    card.href = server.showcase_url || `/server/${encodeURIComponent(slug)}`;
    card.setAttribute("aria-label", `View ${String(server.name || "server")}`);
    const media = element("div", "server-card-media");
    const initial = element("span", "server-initials", initials(server.name));
    const logo = String(server.banner_url || server.logo_url || "").trim();
    if (logo && /^\/|^https?:\/\/[^/]+/i.test(logo)) {
      const image = new Image();
      image.className = "server-card-media-image";
      image.loading = "lazy";
      image.src = logo;
      image.alt = "";
      media.append(image);
    } else {
      media.append(initial);
    }
    const imageFallback = /[a-z]/i.test(platformId) ? element("span", "server-card-media-fallback", platformId.charAt(0).toUpperCase()) : null;
    if (imageFallback && !logo) media.append(imageFallback);

    const top = element("div", "server-card-top");
    top.append(media);
    const status = element("span", `status${server.online ? " online" : ""}${server.showcase ? " showcase" : ""}`, server.showcase ? "BrowseRP showcase" : server.online ? "Online now" : "Status unavailable");
    top.append(status);
    card.append(top);

    card.append(element("h3", "", server.name || "Roleplay server"));
    card.append(window.BrowseRPPlatforms.metadata(server));
    card.append(element("p", "server-description", server.description || "Open the listing to learn more about this community."));

    const tags = element("div", "server-tags");
    (Array.isArray(server.tags) ? server.tags : []).slice(0, 3).forEach((tag) => tags.append(element("span", "", tag)));
    card.append(tags);

    const bottom = element("div", "server-card-bottom");
    const playerText = server.online
      ? `${Number(server.players || 0).toLocaleString()}${server.capacity ? ` / ${Number(server.capacity).toLocaleString()}` : ""} players`
      : server.showcase ? "Complete demo listing" : "Player count unavailable";
    bottom.append(element("strong", "", playerText), element("span", "server-card-action", "View listing"));
    card.append(bottom);
    return card;
  }

  function renderServers(list, servers) {
    if (!list) return;
    list.replaceChildren();
    if (!servers.length) {
      list.setAttribute("aria-busy", "false");
      return;
    }
    servers.forEach((server, index) => {
      const item = serverCard(server);
      window.__browserpReveal?.register?.(item, Math.min(index, 12) * 40, true);
      if (!item.classList.contains("reveal-v3")) {
        item.classList.add("reveal-v3");
        item.style.setProperty("--card-reveal-delay", `${Math.min(index, 12) * 40}ms`);
      }
      list.append(item);
    });
    list.setAttribute("aria-busy", "false");
  }

  async function featured() {
    const list = select("#featured-server-list");
    const empty = select("#featured-empty");
    if (!list || !empty) return;
    try {
      const payload = await api("/api/servers?sort=recommended&limit=4");
      const servers = [SHOWCASE_SERVER, ...(Array.isArray(payload.servers) ? payload.servers : [])];
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

  function renderSearchSuggestions(searchInput, query) {
    const listId = searchInput?.getAttribute("aria-controls");
    const list = listId ? document.getElementById(listId) : null;
    if (!list || !searchInput) return;
    const term = String(query || "").trim().toLowerCase();
    const matches = term
      ? SEARCH_SUGGESTIONS.filter(([, value]) => value.toLowerCase().includes(term)).slice(0, 7)
      : INITIAL_SEARCH_SUGGESTIONS;
    if (!matches.length) {
      list.classList.remove("search-suggestions-open");
      list.hidden = true;
      list.inert = true;
      searchInput.setAttribute("aria-expanded", "false");
      return;
    }
    list.hidden = false;
    list.inert = false;
    searchInput.setAttribute("aria-expanded", "true");
    requestAnimationFrame(() => list.classList.add("search-suggestions-open"));
    list.replaceChildren(
      ...matches.map(([kind, item, platform]) => {
        const button = element("button", "search-suggestion-v3");
        button.type = "button";
        if (platform) window.BrowseRPPlatforms.theme(button, platform);
        button.setAttribute("role", "option");
        button.append(element("span", "search-suggestion-kind-v3", kind), element("strong", "", item));
        button.addEventListener("pointerdown", (event) => event.preventDefault());
        button.addEventListener("click", () => {
          searchInput.value = item;
          state.filters.query = item;
          list.classList.remove("search-suggestions-open");
          list.hidden = true;
          list.inert = true;
          searchInput.setAttribute("aria-expanded", "false");
          searchInput.focus();
          if (document.body.dataset.page !== "home") directoryResults();
        });
        return button;
      })
    );
  }

  function bindSuggestionKeyboard(input, list) {
    if (!input || !list) return;
    input.setAttribute("role", "combobox");
    input.setAttribute("aria-autocomplete", "list");
    input.setAttribute("aria-expanded", "false");
    list.setAttribute("role", "listbox");
    input.addEventListener("keydown", (event) => {
      const options = [...list.querySelectorAll('[role="option"]')];
      if (!options.length || list.hidden) return;
      let index = options.indexOf(document.activeElement);
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        index = event.key === "ArrowDown" ? Math.min(index + 1, options.length - 1) : (index <= 0 ? options.length - 1 : index - 1);
        options[index].focus();
      } else if (event.key === "Escape") {
        list.classList.remove("search-suggestions-open"); list.hidden = true; list.inert = true; input.setAttribute("aria-expanded", "false");
      }
    });
    list.addEventListener("keydown", (event) => {
      const options = [...list.querySelectorAll('[role="option"]')];
      const index = options.indexOf(document.activeElement);
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const next = event.key === "ArrowDown" ? (index + 1) % options.length : (index - 1 + options.length) % options.length;
        options[next].focus();
      } else if (event.key === "Escape") { event.preventDefault(); input.focus(); list.classList.remove("search-suggestions-open"); list.hidden = true; list.inert = true; input.setAttribute("aria-expanded", "false"); }
    });
  }

  function home() {
    select("#home-search-form")?.addEventListener("submit", (event) => {
      event.preventDefault();
      const query = select("#home-search")?.value.trim() || "";
      const destination = new URL("/servers", location.origin);
      if (query) destination.searchParams.set("q", query.slice(0, 120));
      location.assign(`${destination.pathname}${destination.search}`);
    });
    const homeSearch = select("#home-search");
    if (homeSearch) {
      const wrapper = homeSearch.closest("form") || homeSearch.parentElement;
      const suggestions = document.createElement("div");
      suggestions.className = "search-suggestions-v3";
      suggestions.id = "home-search-suggestions";
      suggestions.hidden = true;
      wrapper.append(suggestions);
      homeSearch.setAttribute("aria-controls", suggestions.id);
      bindSuggestionKeyboard(homeSearch, suggestions);
      homeSearch.addEventListener("focus", () => renderSearchSuggestions(homeSearch, homeSearch.value));
      homeSearch.addEventListener("input", () => renderSearchSuggestions(homeSearch, homeSearch.value));
      homeSearch.addEventListener("blur", () => {
        suggestions.classList.remove("search-suggestions-open");
        setTimeout(() => { suggestions.hidden = true; suggestions.inert = true; }, 220);
      });
    }
    featured();
  }

  function readFilters() {
    const params = new URLSearchParams(location.search);
    state.filters.query = (params.get("q") || "").slice(0, 120);
    state.filters.platform = (params.get("platform") || "all").slice(0, 40);
    state.filters.region = (params.get("region") || "all").slice(0, 60);
    state.filters.sort = (params.get("sort") || "recommended").slice(0, 30);
    state.filters.online = params.get("online") === "true";
    state.filters.verified = params.get("verified") === "true";
    state.filters.beginner = params.get("beginner") === "true";
  }

  function syncControls() {
    const search = select("#directory-search");
    const platform = select("#platform-filter");
    const region = select("#region-filter");
    const sort = select("#sort-filter");
    search.value = state.filters.query;
    platform.value = [...platform.options].some((option) => option.value === state.filters.platform) ? state.filters.platform : "all";
    window.BrowseRPPlatforms.theme(platform, platform.value);
    region.value = [...region.options].some((option) => option.value === state.filters.region) ? state.filters.region : "all";
    sort.value = [...sort.options].some((option) => option.value === state.filters.sort) ? state.filters.sort : "recommended";
    select("#online-filter").checked = state.filters.online;
    select("#verified-filter").checked = state.filters.verified;
    select("#beginner-filter").checked = state.filters.beginner;
    document.querySelectorAll(".game-strip-v3 [data-game]").forEach((link) => {
      const selected = link.dataset.game === state.filters.platform;
      link.classList.toggle("is-selected", selected);
      if (selected) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    });
  }

  function syncUrl() {
    const params = new URLSearchParams();
    if (state.filters.query) params.set("q", state.filters.query);
    if (state.filters.platform !== "all") params.set("platform", state.filters.platform);
    if (state.filters.region !== "all") params.set("region", state.filters.region);
    if (state.filters.sort !== "recommended") params.set("sort", state.filters.sort);
    if (state.filters.online) params.set("online", "true");
    if (state.filters.verified) params.set("verified", "true");
    if (state.filters.beginner) params.set("beginner", "true");
    history.replaceState(null, "", `${location.pathname}${params.size ? `?${params}` : ""}`);
  }

  function showcaseMatchesFilters() {
    if (state.filters.online) return false;
    if (state.filters.platform !== "all" && state.filters.platform !== SHOWCASE_SERVER.platform_id) return false;
    if (state.filters.region !== "all" && state.filters.region !== SHOWCASE_SERVER.region) return false;
    const query = state.filters.query.trim().toLowerCase();
    if (!query) return true;
    return [SHOWCASE_SERVER.name, SHOWCASE_SERVER.platform_name, SHOWCASE_SERVER.framework, SHOWCASE_SERVER.region, ...SHOWCASE_SERVER.tags]
      .some((value) => String(value).toLowerCase().includes(query));
  }

  async function directoryResults() {
    const list = select("#server-list");
    const empty = select("#directory-empty");
    setLoadingState(list, 5);
    list.hidden = false;
    empty.hidden = true;

    const params = new URLSearchParams({ sort: state.filters.sort, limit: "100" });
    if (state.filters.platform !== "all") params.set("platform", state.filters.platform);
    if (state.filters.query) params.set("query", state.filters.query);
    if (state.filters.region !== "all") params.set("region", state.filters.region);
    if (state.filters.online) params.set("online", "true");
    if (state.filters.verified) params.set("verified", "true");
    if (state.filters.beginner) params.set("beginner", "true");

    try {
      const payload = await api(`/api/servers?${params}`);
      const servers = [
        ...(showcaseMatchesFilters() ? [SHOWCASE_SERVER] : []),
        ...(Array.isArray(payload.servers) ? payload.servers : [])
      ];
      renderServers(list, servers);
      list.hidden = servers.length === 0;
      empty.hidden = servers.length !== 0;
      const filtersActive = Boolean(state.filters.query || state.filters.platform !== "all" || state.filters.region !== "all" || state.filters.online || state.filters.verified || state.filters.beginner);
      select("#result-count").textContent = `${servers.length} ${servers.length === 1 ? "server" : "servers"}`;
      if (!servers.length) {
        select("h3", empty).textContent = filtersActive ? "No servers match those filters." : "No servers are live yet.";
        select("p", empty).textContent = filtersActive
          ? "Clear a filter or try a broader search."
          : "Run a roleplay community? Submit it for review and be one of the first listings.";
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
    state.filters = { query: "", platform: "all", region: "all", online: false, verified: false, beginner: false, sort: "recommended" };
    syncControls();
    directoryResults();
  }

  async function loadPlatforms(target, includeAll = false) {
    if (!target) return [];
    try {
      const { platforms = [] } = await api("/api/platforms");
      const first = includeAll ? [Object.assign(document.createElement("option"), { value: "all", textContent: "All games" })] : [];
      const options = platforms.map((platform) => Object.assign(document.createElement("option"), { value: platform.id, textContent: platform.name }));
      target.replaceChildren(...first, ...options);
      return platforms;
    } catch { return []; }
  }

  async function directory() {
    readFilters();
    await loadPlatforms(select("#platform-filter"), true);
    syncControls();
    let searchTimer;
    const directorySearch = select("#directory-search");
    const searchContainer = directorySearch?.closest(".field-v3");
    if (searchContainer) {
      const suggestionRoot = document.createElement("div");
      suggestionRoot.className = "search-suggestions-v3";
      suggestionRoot.id = "directory-search-suggestions";
      suggestionRoot.hidden = true;
      searchContainer.append(suggestionRoot);
      directorySearch.setAttribute("aria-controls", suggestionRoot.id);
      bindSuggestionKeyboard(directorySearch, suggestionRoot);
    }
    directorySearch?.addEventListener("focus", () => renderSearchSuggestions(directorySearch, state.filters.query));
    directorySearch?.addEventListener("input", (event) => {
      clearTimeout(searchTimer);
      state.filters.query = event.target.value.trim().slice(0, 120);
      renderSearchSuggestions(directorySearch, state.filters.query);
      searchTimer = window.setTimeout(directoryResults, 220);
    });
    directorySearch?.addEventListener("blur", () => {
      const suggestionRoot = select("#directory-search-suggestions");
      if (suggestionRoot) {
        setTimeout(() => {
          suggestionRoot.classList.remove("search-suggestions-open");
          suggestionRoot.hidden = true;
          suggestionRoot.inert = true;
        }, 220);
      }
    });
    select("#platform-filter").addEventListener("change", (event) => { state.filters.platform = event.target.value; directoryResults(); });
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
    filterPanel?.classList.add("reveal-v3");
    filterPanel?.style.setProperty("--card-reveal-delay", "60ms");
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
    const platformSelect = select('[name="platform"]', form);
    await loadPlatforms(platformSelect, false);
    const cfxField = select('[data-cfx-field]', form);
    const frameworkInput = select('[name="framework"]', form);
    const FRAMEWORK_SUGGESTIONS = Object.freeze({
      fivem: ["QBCore", "ESX", "vMenu", "Custom framework", "No framework"],
      redm: ["VORP", "RedEM:RP", "RSG Core", "Custom framework"],
      roblox: ["Brookhaven", "Emergency Response: Liberty County", "Custom Roblox world"],
      minecraft: ["Vanilla roleplay", "Paper", "Fabric", "Forge", "Fantasy SMP", "Towny"],
      forza: ["Forza Horizon 5", "Forza Motorsport", "Cruising", "Car meet roleplay"]
    });
    if (frameworkInput) {
      const suggestionRoot = element("div", "search-suggestions-v3 listing-suggestions-v3");
      suggestionRoot.id = "framework-suggestions-v3"; suggestionRoot.hidden = true; frameworkInput.parentElement.append(suggestionRoot);
      frameworkInput.setAttribute("aria-controls", suggestionRoot.id); bindSuggestionKeyboard(frameworkInput, suggestionRoot);
      const updateFrameworkSuggestions = () => {
        const term = frameworkInput.value.trim().toLowerCase();
        const options = (FRAMEWORK_SUGGESTIONS[platformSelect?.value] || ["Custom roleplay framework", "No framework"])
          .filter((item) => !term || item.toLowerCase().includes(term)).slice(0, 6);
        if (!options.length) { suggestionRoot.classList.remove("search-suggestions-open"); suggestionRoot.hidden=true;suggestionRoot.inert=true;frameworkInput.setAttribute("aria-expanded","false");return; }
        suggestionRoot.replaceChildren(...options.map((item) => { const option=element("button","search-suggestion-v3");option.type="button";option.setAttribute("role","option");option.append(element("span","search-suggestion-kind-v3","Framework"),element("strong","",item));option.addEventListener("click",()=>{frameworkInput.value=item;suggestionRoot.classList.remove("search-suggestions-open");suggestionRoot.hidden=true;suggestionRoot.inert=true;frameworkInput.focus();});return option; }));
        suggestionRoot.hidden=false;suggestionRoot.inert=false;frameworkInput.setAttribute("aria-expanded","true");requestAnimationFrame(()=>suggestionRoot.classList.add("search-suggestions-open"));
      };
      frameworkInput.addEventListener("focus", updateFrameworkSuggestions);
      frameworkInput.addEventListener("input", updateFrameworkSuggestions);
      frameworkInput.addEventListener("blur",()=>setTimeout(()=>{suggestionRoot.classList.remove("search-suggestions-open");suggestionRoot.hidden=true;suggestionRoot.inert=true;frameworkInput.setAttribute("aria-expanded","false");},220));
    }
    function updatePlatformFields() {
      const cfxPlatform = ["fivem", "redm"].includes(platformSelect?.value);
      if (cfxField) { cfxField.hidden = !cfxPlatform; cfxField.inert = !cfxPlatform; }
      if (frameworkInput) frameworkInput.placeholder = cfxPlatform ? "e.g. QBCore, ESX or custom" : "e.g. roleplay framework, modpack or game mode";
      if (document.activeElement === frameworkInput) frameworkInput.dispatchEvent(new Event("input"));
    }
    platformSelect?.addEventListener("change", updatePlatformFields);
    updatePlatformFields();

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
            platform: data.platform,
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
