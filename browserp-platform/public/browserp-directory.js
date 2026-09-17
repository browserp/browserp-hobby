(() => {
  "use strict";

  const page = document.body.dataset.page || "";
  const state = {
    session: { authenticated: false, user: null },
    filters: { query: "", platform: "all", region: "all", online: false, verified: false, beginner: false, sort: "recommended" }
  };
  const select = (selector, root = document) => root.querySelector(selector);
  const DISCOVER_GAME_IDS = Object.freeze(["fivem", "redm", "roblox", "minecraft"]);
  let playerExpiryTimer = null;
  let featuredExpiryTimer = null;
  let featuredExpiresAt = 0;

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
      window.__browserpReveal?.register?.(row, index * 35, false);
      if (!row.classList.contains("reveal-v3")) row.classList.add("reveal-v3");
      row.classList.add("is-revealed");
      return row;
    }));
  }

  function serverCard(server, directoryPreview = false) {
    const slug = String(server.slug || "").trim();
    const card = element("div", "server-card discovery-card-v10");
    window.BrowseRPPlatforms.theme(card, window.BrowseRPPlatforms.idFor(server));
    const listingHref = `/server/${encodeURIComponent(slug)}`;
    const media = element("div", "server-card-media");
    const initial = element("span", "server-initials", initials(server.name));
    const artwork = [...new Set([server.logo_url, server.banner_url].map(value => String(value || "").trim()))]
      .filter(value => /^(?:https?:\/\/[^/]+|\/(?!\/))/i.test(value));
    if (artwork.length) {
      const image = new Image();
      image.className = "server-card-media-image";
      image.loading = "lazy";
      image.alt = "";
      let sourceIndex = 0;
      image.addEventListener("error", () => {
        if (++sourceIndex < artwork.length) image.src = artwork[sourceIndex];
        else image.replaceWith(initial);
      });
      image.src = artwork[0];
      media.append(image);
    } else media.append(initial);

    const playerNumber = (value) => {
      if (value === null || value === undefined || value === "" || typeof value === "boolean") return null;
      const parsed = Number(value);
      return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
    };
    const checkedAt = Date.parse(String(server.checked_at || server.checkedAt || server.observed_at || server.observedAt || ""));
    const players = playerNumber(server.players);
    const capacity = playerNumber(server.capacity ?? server.max_players);
    const freshCount = !server.applicationOnly && server.online === true && players !== null
      && (capacity === null || capacity >= players) && Number.isFinite(checkedAt)
      && checkedAt <= Date.now() + 60000 && Date.now() - checkedAt <= 300000;
    const playerState = server.applicationOnly ? "listing" : freshCount ? "live" : server.online === true ? "stale" : server.online === false ? "offline" : "unknown";
    const top = element("div", "server-card-top discovery-card-identity-v10");
    const heading = element("h3", "");
    const titleLink = element("a", "discovery-card-title-v10", server.name || "Roleplay server");
    titleLink.href = listingHref; heading.append(titleLink);
    top.append(media, heading);
    card.append(top);
    card.append(element("p", "server-description", server.description || "Open the listing to learn more about this community."));
    // Preview-only omission of optional unknowns. Do not change the source
    // record, joining requirements, status, or detail/compare disclosures.
    const preview = directoryPreview ? { ...server } : server;
    if (directoryPreview) {
      for (const key of ["region", "language", "framework"]) {
        if (/^(?:unknown|not confirmed|not specified|unspecified|unavailable|n\/a)$/i.test(String(preview[key] || "").trim())) preview[key] = "";
      }
    }
    card.append(window.BrowseRPPlatforms.discoveryMetadata(preview));

    const tags = element("div", "server-tags");
    const availableTags = Array.isArray(server.tags) ? server.tags : [];
    [...availableTags.filter(tag => String(tag || "").trim() === "18+"), ...availableTags.filter(tag => String(tag || "").trim() !== "18+")]
      .slice(0, directoryPreview ? 2 : 3).forEach((tag) => {
      const label = String(tag || "").trim();
      if (!label) return;
      const link = element("a", label === "18+" ? "server-age-tag-v11" : "", label);
      const platform = window.BrowseRPPlatforms.idFor(server);
      const filters = new URLSearchParams({ feature: label });
      if (platform !== "other") filters.set("platform", platform);
      link.href = `/servers?${filters}`;
      link.setAttribute("aria-label", label === "18+" ? "Find communities tagged 18+ minimum joining age" : `Find communities tagged ${label}`);
      tags.append(link);
    });
    card.append(tags);

    const bottom = element("div", "server-card-bottom");
    const playerText = playerState === "listing" ? "Live player count not provided" : playerState === "live"
      ? `${players.toLocaleString()}${capacity !== null ? ` / ${capacity.toLocaleString()}` : ""} players${server.count_scope === "network" ? " across the network" : ""}`
      : playerState === "stale" ? "Player count needs a refresh" : playerState === "offline" ? "Reported offline · player count unavailable" : "Player count unavailable";
    const view = element("a", "server-card-action", "View listing"); view.href = listingHref;
    const playerCount = element("strong", `player-count-v10 is-${playerState}${freshCount ? " is-live" : ""}`, playerText);
    playerCount.dataset.playerState = playerState;
    playerCount.title = playerState === "listing" ? "This community does not publish a live player count" : playerState === "live" ? "A recently checked player count" : playerState === "stale" ? "The last player count is no longer recent" : "No current player count is available";
    bottom.append(playerCount, view);
    card.append(bottom);
    if (freshCount) card.dataset.playerFreshUntil = String(checkedAt + 300000);
    const item = window.BrowseRPShortlist?.wrap(card, server) || card;
    if (server.staffBoosted) { item.classList.add("server-boosted-v11"); item.title = "Boosted server"; }
    return item;
  }

  function directoryAdvert(list) {
    if (page !== "servers" || list.id !== "server-list") return null;
    return document.getElementById("directory-advert");
  }

  function placeDirectoryAdvert(list) {
    if (!list) return;
    const advert = directoryAdvert(list);
    if (!advert) return;
    advert.setAttribute("aria-live", "off");
    const rows = [...list.children].filter(item => item.matches(".server-card, .server-shortlist-card"));
    const sixth = rows[Math.min(6, rows.length) - 1];
    if (sixth) sixth.after(advert);
    else list.append(advert);
  }

  function renderServers(list, servers) {
    if (!list) return;
    const advert = directoryAdvert(list);
    // Keep the mounted advert connected and untouched: its creative, pause
    // state, focus, image handlers and visibility observer survive redraws.
    if (advert) {
      if (advert.parentElement !== list) list.append(advert);
      [...list.childNodes].forEach(child => { if (child !== advert) child.remove(); });
    } else list.replaceChildren();
    if (!servers.length) { list.setAttribute("aria-busy", "false"); clearPlayerStateExpiry(); return; }
    servers.forEach((server, index) => {
      const item = serverCard(server, page === "servers" && list.id === "server-list");
      window.__browserpReveal?.register?.(item, Math.min(index, 8) * 12, true);
      if (!item.classList.contains("reveal-v3")) {
        item.classList.add("reveal-v3");
      }
      if (advert && index < 6) list.insertBefore(item, advert);
      else list.append(item);
    });
    list.setAttribute("aria-busy", "false");
    schedulePlayerStateExpiry(list);
  }

  function clearPlayerStateExpiry() {
    if (playerExpiryTimer !== null) window.clearTimeout(playerExpiryTimer);
    playerExpiryTimer = null;
  }

  function expirePlayerState(card) {
    card.removeAttribute("data-player-fresh-until");
    const count = select(".player-count-v10", card);
    if (count) { count.className = "player-count-v10 is-stale"; count.dataset.playerState = "stale"; count.title = "The last player count is no longer recent"; count.textContent = "Player count needs a refresh"; }
  }

  function schedulePlayerStateExpiry(list) {
    clearPlayerStateExpiry();
    const now = Date.now();
    const cards = [...list.querySelectorAll(".server-card[data-player-fresh-until]")];
    cards.filter(card => Number(card.dataset.playerFreshUntil) <= now).forEach(expirePlayerState);
    const next = cards.map(card => Number(card.dataset.playerFreshUntil)).filter(value => Number.isFinite(value) && value > now).sort((a, b) => a - b)[0];
    if (!next) return;
    playerExpiryTimer = window.setTimeout(() => schedulePlayerStateExpiry(list), Math.min(next - now, 2147483647));
  }

  function cancelFeaturedExpiryTimer() {
    if (featuredExpiryTimer !== null) window.clearTimeout(featuredExpiryTimer);
    featuredExpiryTimer = null;
  }

  function clearFeaturedExpiry() {
    cancelFeaturedExpiryTimer(); featuredExpiresAt = 0;
  }

  function removeFeaturedDecoration() {
    const list = select("#featured-server-list");
    list?.querySelectorAll(".server-boosted-v11").forEach(item => { item.classList.remove("server-boosted-v11"); item.removeAttribute("title"); });
    list?.querySelectorAll(".server-boost-flame-v11").forEach(item => item.remove());
  }

  function scheduleFeaturedExpiry(expiresAt) {
    clearFeaturedExpiry();
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) return false;
    featuredExpiresAt = expiresAt;
    featuredExpiryTimer = window.setTimeout(() => {
      featuredExpiryTimer = null;
      if (document.visibilityState === "hidden") return;
      featuredExpiresAt = 0; removeFeaturedDecoration(); void featured();
    }, Math.min(expiresAt - Date.now(), 2147483647));
    return true;
  }

  async function featured() {
    const list = select("#featured-server-list");
    const empty = select("#featured-empty");
    if (!list || !empty) return;
    try {
      const payload = await api("/api/servers?sort=recommended&limit=4&featured=true");
      const servers = Array.isArray(payload.servers) ? payload.servers : [];
      const boostExpiresAt = Date.parse(String(payload.featuredBoost?.expiresAt || payload.featuredBoost?.expires_at || ""));
      if (payload.featuredBoost?.slug && scheduleFeaturedExpiry(boostExpiresAt)) {
        const boosted = servers.find((server) => server.slug === payload.featuredBoost.slug);
        if (boosted) boosted.staffBoosted = true;
      } else clearFeaturedExpiry();
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

  function bindSuggestionKeyboard(input, list) {
    if (!input || !list) return;
    input.setAttribute("role", "combobox");
    input.setAttribute("aria-autocomplete", "list");
    input.setAttribute("aria-expanded", "false");
    list.setAttribute("role", "listbox");
    const closeOnLeave = () => {
      setTimeout(() => {
        if (document.activeElement === input || list.contains(document.activeElement)) return;
        list.classList.remove("search-suggestions-open");
        list.hidden = true;
        list.inert = true;
        input.setAttribute("aria-expanded", "false");
      }, 0);
    };
    input.addEventListener("blur", closeOnLeave);
    list.addEventListener("focusout", closeOnLeave);
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

  function home() { window.BrowseRPSearch.home(); featured(); }

  function refreshExpiredFeatured() {
    if (page !== "home" || document.visibilityState === "hidden") return;
    if (featuredExpiresAt) {
      if (Date.now() >= featuredExpiresAt) {
        clearFeaturedExpiry(); removeFeaturedDecoration(); void featured();
      } else scheduleFeaturedExpiry(featuredExpiresAt);
    }
    const list = select("#featured-server-list"); if (list) schedulePlayerStateExpiry(list);
  }
  document.addEventListener("visibilitychange", refreshExpiredFeatured);
  window.addEventListener("pageshow", refreshExpiredFeatured);
  window.addEventListener("pagehide", () => { clearPlayerStateExpiry(); cancelFeaturedExpiryTimer(); });

  async function loadPlatforms(target, includeAll = false, discoverOnly = false) {
    if (!target) return [];
    try {
      const { platforms = [] } = await api("/api/platforms");
      const first = includeAll ? [Object.assign(document.createElement("option"), { value: "all", textContent: "All games" })] : [];
      const choices = discoverOnly
        ? DISCOVER_GAME_IDS.map((id) => platforms.find((platform) => platform.id === id)).filter(Boolean)
        : platforms;
      const options = choices.map((platform) => Object.assign(document.createElement("option"), { value: platform.id, textContent: platform.name }));
      target.replaceChildren(...first, ...options);
      return choices;
    } catch { return []; }
  }

  function directory() {
    select("[data-directory-loading-controls]")?.remove();
    placeDirectoryAdvert(select("#server-list"));
    window.BrowseRPSearch.mount({ root: select("#discovery-controls"), list: select("#server-list"), empty: select("#directory-empty"), count: select("#result-count"), render: renderServers });
  }

  function setFormStatus(message, tone = "") {
    const status = select("#listing-status");
    status.textContent = message;
    status.className = `form-status${tone ? ` ${tone}` : ""}`;
  }

  const LISTING_TAGS = Object.freeze([
    ["economy", "Economy"],
    ["serious-roleplay", "Serious RP"],
    ["semi-serious", "Semi-serious RP"],
    ["beginner-friendly", "Beginner friendly"],
    ["custom-clothing", "Custom clothing"],
    ["custom-cars", "Custom vehicles"],
    ["custom-jobs", "Custom jobs"],
    ["player-businesses", "Player businesses"],
    ["housing", "Housing"],
    ["police", "Police"],
    ["ems", "EMS"],
    ["gangs", "Gangs"],
    ["civilian-jobs", "Civilian jobs"],
    ["outlaw-rp", "Outlaw RP"],
    ["lawmen", "Lawmen"],
    ["ranching", "Ranching"],
    ["horses", "Horses"],
    ["hunting", "Hunting"],
    ["crafting", "Crafting"],
    ["java", "Java Edition"],
    ["bedrock", "Bedrock Edition"],
    ["crossplay", "Crossplay"],
    ["modded", "Modded"],
    ["vanilla", "Vanilla"],
    ["land-claims", "Land claims"],
    ["pve", "PvE"],
    ["pvp", "PvP"],
    ["quests", "Quests"],
    ["custom-worlds", "Custom worlds"],
    ["voice-chat", "Voice chat"],
    ["events", "Community events"],
    ["custom-avatars", "Custom avatars"],
    ["vehicles", "Vehicles"],
    ["jobs", "Jobs"],
    ["mobile-friendly", "Mobile friendly"],
    ["controller-support", "Controller support"]
  ]);
  const LISTING_TAGS_BY_GAME = Object.freeze({
    fivem: Object.freeze(["serious-roleplay", "semi-serious", "beginner-friendly", "economy", "custom-cars", "custom-clothing", "custom-jobs", "player-businesses", "housing", "police", "ems", "civilian-jobs", "gangs"]),
    redm: Object.freeze(["serious-roleplay", "semi-serious", "beginner-friendly", "economy", "outlaw-rp", "lawmen", "ranching", "horses", "hunting", "crafting", "player-businesses", "housing"]),
    minecraft: Object.freeze(["beginner-friendly", "java", "bedrock", "crossplay", "modded", "vanilla", "land-claims", "pve", "pvp", "quests", "custom-worlds", "voice-chat", "economy"]),
    roblox: Object.freeze(["beginner-friendly", "serious-roleplay", "semi-serious", "events", "voice-chat", "custom-avatars", "vehicles", "housing", "jobs", "mobile-friendly", "controller-support"])
  });
  window.BrowseRPListingFeatures = Object.freeze({ keys: platform => [...(LISTING_TAGS_BY_GAME[platform] || [])] });

  function setupTagPicker(form, platform = "fivem") {
    const picker = select(".tag-picker-v3", form);
    if (!picker) return;
    const selectedValues = new Set([...picker.querySelectorAll('input:checked')].map(input => input.value));
    const keys = LISTING_TAGS_BY_GAME[platform] || [];
    const available = keys.map(key => LISTING_TAGS.find(([value]) => value === key)).filter(Boolean);
    picker.replaceChildren(...available.map(([value, labelText]) => {
      const label = element("label", "check-v3");
      const input = document.createElement("input");
      input.type = "checkbox";
      input.name = "tags";
      input.value = value;
      input.checked = selectedValues.has(value);
      label.append(input, document.createTextNode(` ${labelText}`));
      return label;
    }));
    const updateLimit = () => {
      const baseline = new Set(JSON.parse(picker.dataset.existingFeatures || "[]"));
      const selected = [...picker.querySelectorAll('input[name="tags"]:checked')].filter(input => !baseline.has(input.value)).length;
      const total = picker.querySelectorAll('input[name="tags"]:checked').length + Number(picker.dataset.preservedCount || 0);
      const full = total >= Number(picker.dataset.maximumFeatures || 8);
      picker.querySelectorAll('input[name="tags"]:not(:checked)').forEach((input) => {
        input.disabled = full || (selected >= 8 && !baseline.has(input.value));
      });
    };
    picker.onchange = updateLimit;
    updateLimit();
  }

  async function listing() {
    const gate = select("#listing-auth-gate");
    const form = select("#listing-form");
    const accountNotice = select("#listing-account-notice");
    const providerNote = select("#provider-note");
    const query = new URLSearchParams(location.search);
    const correctionId = query.get("submission");
    const ownerListingId = correctionId === null ? query.get("listing") : null;
    const requestedPlatform = DISCOVER_GAME_IDS.includes(query.get("platform")) ? query.get("platform") : "";
    const returnTo = correctionId !== null ? `/list-server?submission=${encodeURIComponent(correctionId)}` : ownerListingId !== null ? `/list-server?listing=${encodeURIComponent(ownerListingId)}` : requestedPlatform ? `/list-server?platform=${requestedPlatform}` : "/list-server";
    document.querySelectorAll("[data-auth-provider]").forEach(link => { link.href = `/api/auth/${link.dataset.authProvider}?returnTo=${encodeURIComponent(returnTo)}`; });
    const fields = select(".form-grid-v3", form);
    const submit = select("#submit-listing", form);
    const abort = new AbortController();
    let accountId = null, ended = false, busy = false, attempt = null, uncertain = false, dirty = false, checkingSession = false;
    function endCreateSession({ showSignIn = true } = {}) {
      if (ended) return;
      ended = true; abort.abort(); attempt = null; accountId = null; dirty = false;
      state.session = { authenticated: false, user: null };
      form.reset(); form.hidden = true; form.inert = true; fields.inert = true;
      for (const field of form.querySelectorAll("input,textarea,select")) { field.value = ""; if (field.type === "checkbox") field.checked = false; }
      accountNotice.textContent = ""; setFormStatus("");
      const toastNode = select("#site-toast"); if (toastNode) { toastNode.textContent = ""; toastNode.classList.remove("show"); }
      gate.hidden = !showSignIn; gate.inert = !showSignIn;
      if (!showSignIn) return;
      gate.querySelector("h2").textContent = "Sign in again before sending a listing.";
      gate.querySelector("p").textContent = "Your account changed or its session ended. Reopen this form after signing in. If you already sent a listing, check My account before starting another.";
      api("/api/auth/providers").then(payload => {
        let available = false;
        gate.querySelectorAll("[data-auth-provider]").forEach(link => { const enabled = Boolean(payload.providers?.[link.dataset.authProvider]); link.hidden = !enabled; link.inert = !enabled; available ||= enabled; });
        providerNote.hidden = available; providerNote.textContent = "Sign-in is temporarily unavailable. Please try again later.";
      }).catch(() => { providerNote.hidden = false; providerNote.textContent = "Sign-in is temporarily unavailable. Please try again later."; });
    }
    if (correctionId === null && ownerListingId === null) {
      window.addEventListener("browserp:session-ended", endCreateSession);
      window.addEventListener("pagehide", () => endCreateSession({ showSignIn: false }));
      window.addEventListener("pageshow", event => { if (event.persisted) { endCreateSession({ showSignIn: false }); location.reload(); } });
      window.addEventListener("beforeunload", event => { if (dirty && !ended) { event.preventDefault(); event.returnValue = ""; } });
    }
    setupTagPicker(form);
    const platformSelect = select('[name="platform"]', form);
    await loadPlatforms(platformSelect, false, true);
    if (ended) return;
    if (requestedPlatform) platformSelect.value = requestedPlatform;
    const cfxField = select('[data-cfx-field]', form);
    const frameworkInput = select('[name="framework"]', form);
    const robloxFields = select('[data-roblox-fields]', form);
    const readRoblox = () => platformSelect.value === "roblox" ? Object.fromEntries([...robloxFields.querySelectorAll('[data-roblox-key]')].map(field => [field.dataset.robloxKey, field.value.trim()])) : null;
    function updateRobloxKind() {
      select("#roblox-kind-help", form).textContent = form.elements.robloxKind.value === "creator_experience"
        ? "You or your creator team control the Roblox experience being listed."
        : "Your RP community uses an experience made by someone else, such as ER:LC or Brookhaven.";
    }
    form.elements.robloxKind.addEventListener("change", updateRobloxKind);
    function validateRobloxLinks() {
      for (const key of ["experienceUrl", "communityGroupUrl"]) {
        const field = robloxFields.querySelector(`[data-roblox-key="${key}"]`);
        const path = key === "experienceUrl" ? "games" : "(?:communities|groups)";
        const pattern = new RegExp(`^https://(?:www\\.)?roblox\\.com/${path}/[1-9][0-9]{0,19}(?:/[A-Za-z0-9_-]+)?/?$`);
        const valid = !field.value.trim() || pattern.test(field.value.trim());
        field.setCustomValidity(platformSelect.value !== "roblox" || valid ? "" : key === "experienceUrl" ? "Use a public https://www.roblox.com/games/123456 page, without a query, share link or private-server code." : "Use a public Roblox /communities/123456 or /groups/123456 page, without a query or private access link.");
      }
    }
    robloxFields.addEventListener("input", validateRobloxLinks);
    const FRAMEWORK_SUGGESTIONS = Object.freeze({
      fivem: ["QBCore", "ESX", "vMenu", "Custom setup", "Default game setup"],
      redm: ["VORP", "RedEM:RP", "RSG Core", "Custom setup"],
      roblox: ["Brookhaven", "Emergency Response: Liberty County", "Custom Roblox world"],
      minecraft: ["Vanilla roleplay", "Paper", "Fabric", "Forge", "Fantasy SMP", "Towny"],
      forza: ["Forza Horizon 5", "Forza Motorsport", "Cruising", "Car meet roleplay"]
    });
    const SETUP_FIELDS = Object.freeze({
      fivem: { label: "Server setup", example: "e.g. QBCore, ESX or vMenu", kind: "Server setup" },
      redm: { label: "Server setup", example: "e.g. VORP, RedEM:RP or RSG Core", kind: "Server setup" },
      roblox: { label: "Roblox experience", example: "e.g. Brookhaven or Emergency Response: Liberty County", kind: "Experience" },
      minecraft: { label: "Modpack or game mode", example: "e.g. Fantasy SMP, Towny or your modpack name", kind: "Game mode / setup" }
    });
    const setupField = () => SETUP_FIELDS[platformSelect?.value] || { label: "Game mode or setup", example: "e.g. your game mode or custom setup", kind: "Game mode / setup" };
    if (frameworkInput) {
      const suggestionRoot = element("div", "search-suggestions-v3 listing-suggestions-v3");
      suggestionRoot.id = "framework-suggestions-v3"; suggestionRoot.hidden = true; frameworkInput.parentElement.append(suggestionRoot);
      frameworkInput.setAttribute("aria-controls", suggestionRoot.id); bindSuggestionKeyboard(frameworkInput, suggestionRoot);
      const updateFrameworkSuggestions = () => {
        const term = frameworkInput.value.trim().toLowerCase();
        const options = (FRAMEWORK_SUGGESTIONS[platformSelect?.value] || ["Custom game mode", "Default game setup"])
          .filter((item) => !term || item.toLowerCase().includes(term)).slice(0, 6);
        if (!options.length) { suggestionRoot.classList.remove("search-suggestions-open"); suggestionRoot.hidden=true;suggestionRoot.inert=true;frameworkInput.setAttribute("aria-expanded","false");return; }
        suggestionRoot.replaceChildren(...options.map((item) => { const option=element("button","search-suggestion-v3");option.type="button";option.setAttribute("role","option");option.append(element("span","search-suggestion-kind-v3",setupField().kind),element("strong","",item));option.addEventListener("click",()=>{frameworkInput.value=item;frameworkInput.focus();suggestionRoot.classList.remove("search-suggestions-open");suggestionRoot.hidden=true;suggestionRoot.inert=true;frameworkInput.setAttribute("aria-expanded","false");});return option; }));
        suggestionRoot.hidden=false;suggestionRoot.inert=false;frameworkInput.setAttribute("aria-expanded","true");requestAnimationFrame(()=>suggestionRoot.classList.add("search-suggestions-open"));
      };
      frameworkInput.addEventListener("focus", updateFrameworkSuggestions);
      frameworkInput.addEventListener("input", updateFrameworkSuggestions);
    }
    function updatePlatformFields() {
      setupTagPicker(form, platformSelect?.value);
      const setupLabel = frameworkInput?.parentElement.querySelector("span");
      if (setupLabel) setupLabel.textContent = setupField().label;
      const cfxPlatform = ["fivem", "redm"].includes(platformSelect?.value);
      if (cfxField) { cfxField.hidden = !cfxPlatform; cfxField.inert = !cfxPlatform; }
      const cfxInput = select('[name="cfxJoinUrl"]', form);
      cfxInput.disabled = !cfxPlatform;
      if (!cfxPlatform) cfxInput.value = "";
      const isRoblox = platformSelect.value === "roblox";
      robloxFields.hidden = !isRoblox; robloxFields.inert = !isRoblox; robloxFields.disabled = !isRoblox;
      updateRobloxKind();
      const communityInput = select('[name="communityUrl"]', form);
      communityInput.required = isRoblox;
      if (frameworkInput) { frameworkInput.placeholder = setupField().example; frameworkInput.required = isRoblox; frameworkInput.minLength = isRoblox ? 2 : 0; }
      if (correctionId === null) {
        form.querySelector(".form-heading-v3 .eyebrow-v3").textContent = isRoblox ? "Roblox application" : "New listing";
        submit.textContent = isRoblox ? "Send application for review" : "Submit for review";
      }
      validateRobloxLinks();
      if (document.activeElement === frameworkInput) frameworkInput.dispatchEvent(new Event("input"));
    }
    platformSelect?.addEventListener("change", () => { if (frameworkInput) frameworkInput.value = ""; updatePlatformFields(); });
    updatePlatformFields();

    try {
      const current = await api("/api/auth/session");
      if (ended) return;
      state.session = current;
    } catch {
      state.session = { authenticated: false, user: null };
    }

    if (ended) return;
    if (state.session.authenticated && state.session.user?.id) {
      accountId = state.session.user.id;
      gate.hidden = true;
      gate.inert = true;
      form.hidden = correctionId !== null || ownerListingId !== null;
      form.inert = correctionId !== null || ownerListingId !== null;
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

    if (correctionId !== null || ownerListingId !== null) {
      if (accountId) {
        if (!window.BrowseRPSubmissionCorrection) { form.before(element("p", "form-status error", "The correction form could not be loaded. Refresh this page to try again.")); return; }
        await window.BrowseRPSubmissionCorrection.mount({ id: correctionId || ownerListingId, listingId: ownerListingId, accountId: state.session.user.id, form, api, updatePlatformFields, readRoblox, setFormStatus, toast });
      }
      return;
    }

    function syncCreate() {
      fields.inert = busy || uncertain || ended;
      submit.disabled = busy || ended || !accountId;
      submit.textContent = busy ? "Sending…" : uncertain ? "Try sending again" : platformSelect.value === "roblox" ? "Send application for review" : "Submit for review";
    }
    async function confirmAccount() {
      const current = await api("/api/auth/session", { signal: abort.signal });
      if (ended) return false;
      if (!current.authenticated || current.user?.id !== accountId) { endCreateSession(); return false; }
      state.session = current;
      return true;
    }
    async function checkReturningSession() {
      if (ended || !accountId || busy || checkingSession || document.visibilityState === "hidden") return;
      checkingSession = true;
      try { await confirmAccount(); }
      catch (error) { if (!ended && [401,403].includes(error.status)) endCreateSession(); }
      finally { checkingSession = false; }
    }
    window.addEventListener("focus", checkReturningSession);
    document.addEventListener("visibilitychange", checkReturningSession);
    form.addEventListener("input", () => { if (!busy && !uncertain && !ended) dirty = true; });
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (ended || busy || !accountId) return;
      if (!attempt) {
        validateRobloxLinks();
        if (!form.reportValidity()) return;
        const formData = new FormData(form);
        const data = Object.fromEntries(formData);
        attempt = { key: crypto.randomUUID(), body: JSON.stringify({
          expectedAccountId: accountId,
          platform: data.platform,
          name: data.name,
          region: data.region,
          language: data.language,
          framework: data.framework,
          description: data.description,
          communityUrl: data.communityUrl,
          cfxJoinUrl: ["fivem", "redm"].includes(data.platform) ? data.cfxJoinUrl : "",
          accessType: data.accessType,
          roblox: readRoblox(),
          tags: formData.getAll("tags").slice(0, 8),
          agreement: data.agreement === "on"
        }) };
      }
      busy = true; syncCreate();
      setFormStatus("Checking your account and sending your listing for review…");
      let sent = false;
      try {
        if (!await confirmAccount()) return;
        sent = true;
        const payload = await api("/api/submissions", {
          method: "POST", headers: { "Idempotency-Key": attempt.key }, body: attempt.body, signal: abort.signal
        });
        if (ended) return;
        if (!payload.submission?.id) throw new Error("The result could not be confirmed. Retry the same application safely.");
        const completedPlatform = platformSelect.value;
        form.reset();
        platformSelect.value = completedPlatform;
        updatePlatformFields();
        attempt = null; uncertain = false; dirty = false;
        setFormStatus(`Listing received. Reference: ${payload.submission.id}. You can follow its review in My account.`, "success");
        toast("Your listing was submitted for review.");
      } catch (error) {
        if (ended) return;
        if ([401,403].includes(error.status)) { endCreateSession(); return; }
        uncertain = sent && (!error.status || error.status >= 500);
        if (!uncertain) attempt = null;
        const message = uncertain ? "We couldn't confirm whether your listing arrived. Retry the same application safely, or check My account before starting another. Your details are kept unchanged for this retry." : error.message;
        setFormStatus(message, "error");
        toast(message, "error");
      } finally { busy = false; if (!ended) syncCreate(); }
    });
    syncCreate();
  }

  window.BrowseRPDirectory = { render: renderServers };
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
