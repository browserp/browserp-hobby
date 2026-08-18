const state = {
  platforms: [],
  servers: [],
  filters: {
    query: "",
    platform: "all",
    region: "all",
    online: false,
    verified: false,
    beginner: false,
    sort: "recommended"
  },
  visible: 5,
  session: null,
  favourites: new Set(JSON.parse(localStorage.getItem("browserp:favourites") || "[]")),
  clientId: localStorage.getItem("browserp:client-id") || crypto.randomUUID()
};
localStorage.setItem("browserp:client-id", state.clientId);

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const escapeHtml = (value) => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#039;");
const initials = (name) => name.split(/\s+/).slice(0, 2).map((word) => word[0]).join("").toUpperCase();

let toastTimer;
function showToast(message, tone = "success") {
  const toast = $("#toast");
  toast.querySelector("span").textContent = tone === "error" ? "!" : "✓";
  toast.querySelector("p").textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 3200);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {})
    }
  });
  const payload = await response.json().catch(() => ({ error: "The response could not be read." }));
  if (!response.ok) throw new Error(payload.error || "Request failed.");
  return payload;
}

function platformClass(platform) {
  const allowed = new Set(["fivem", "redm", "minecraft", "roblox", "gmod", "ets2"]);
  return allowed.has(platform) ? platform : "all";
}

function renderPlatforms() {
  const list = $("#platform-list");
  const select = $("#platform-select");
  const listingSelect = $("#listing-platform");
  for (const platform of state.platforms) {
    const button = document.createElement("button");
    button.className = "platform-pill";
    button.type = "button";
    button.dataset.platform = platform.id;
    button.innerHTML = `<span class="platform-logo platform-${platformClass(platform.id)}">${escapeHtml(platform.short_name)}</span><span><strong>${escapeHtml(platform.name)}</strong><small>Roleplay worlds</small></span>`;
    list.append(button);

    const option = document.createElement("option");
    option.value = platform.id;
    option.textContent = platform.name;
    select.append(option);
  }

  // The listing form is authored with options so it remains usable without JS.
  const knownListingOptions = new Set([...listingSelect.options].map((option) => option.value));
  for (const platform of state.platforms) {
    if (knownListingOptions.has(platform.id)) continue;
    const option = document.createElement("option");
    option.value = platform.id;
    option.textContent = platform.name;
    listingSelect.append(option);
  }

  $$('[data-platform]', list).forEach((button) => {
    button.addEventListener("click", () => {
      state.filters.platform = button.dataset.platform;
      $("#platform-select").value = state.filters.platform;
      state.visible = 5;
      updatePlatformButtons();
      loadServers();
      document.querySelector("#discover").scrollIntoView({ behavior: "smooth", block: "start" });
    });
  });
}

function updatePlatformButtons() {
  $$('[data-platform]', $("#platform-list")).forEach((button) => {
    button.classList.toggle("active", button.dataset.platform === state.filters.platform);
  });
}

function renderPulse(servers) {
  const online = servers.filter((server) => server.online).slice(0, 3);
  $("#pulse-list").innerHTML = online.map((server) => `
    <div class="pulse-row">
      <span class="pulse-logo art-${platformClass(server.platform_id)}">${escapeHtml(initials(server.name))}</span>
      <span class="pulse-info"><strong>${escapeHtml(server.name)}</strong><small>${escapeHtml(server.platform_name)} · ${escapeHtml(server.tags[0])}</small></span>
      <span class="pulse-player">${Number(server.players).toLocaleString()}</span>
    </div>
  `).join("");
}

function renderServerCard(server) {
  const hot = server.boost_score >= 70;
  const favourite = state.favourites.has(server.id);
  const fill = Math.max(0, Math.min(100, Math.round((server.players / Math.max(server.capacity, 1)) * 10) * 10));
  const tags = server.tags.slice(0, 4).map((tag) => `<span>${escapeHtml(tag)}</span>`).join("");
  return `
    <article class="server-card${hot ? " hot" : ""}" data-server-id="${escapeHtml(server.id)}">
      <div class="server-art art-${platformClass(server.platform_id)}">
        <span class="server-initials">${escapeHtml(initials(server.name))}</span>
        <span class="art-status${server.online ? "" : " offline"}"><i></i>${server.online ? "Online" : "Offline"}</span>
      </div>
      <div class="server-main">
        <div class="server-meta">
          <span class="server-platform">${escapeHtml(server.platform_name)} · ${escapeHtml(server.region)}</span>
          ${server.verified ? '<span class="verified-badge" title="Verified server owner">✓</span>' : ""}
          ${hot ? '<span class="hot-badge">✦ Spotlight</span>' : ""}
        </div>
        <h3>${escapeHtml(server.name)}</h3>
        <p>${escapeHtml(server.description)}</p>
        <div class="server-tags">${tags}</div>
      </div>
      <div class="server-side">
        <div class="player-count">
          <span>${Number(server.players).toLocaleString()}<small> / ${Number(server.capacity).toLocaleString()}</small></span>
          <span class="player-state${server.online ? "" : " offline"}"><i></i>${server.online ? "Live" : "Away"}</span>
        </div>
        <div class="capacity-bar" aria-label="${fill}% capacity"><i class="fill-${fill}"></i></div>
        <div class="server-actions">
          <a class="button button-dark view-server" href="/server/${encodeURIComponent(server.slug)}">View profile</a>
          <button class="favorite-button${favourite ? " active" : ""}" type="button" aria-label="${favourite ? "Remove from" : "Add to"} favourites" aria-pressed="${favourite}">${favourite ? "♥" : "♡"}</button>
        </div>
        <button class="boost-button" type="button">✦ Give free boost</button>
      </div>
    </article>
  `;
}

function bindServerCards() {
  $$(".server-card[data-server-id]").forEach((card) => {
    const id = card.dataset.serverId;
    $(".favorite-button", card).addEventListener("click", (event) => {
      if (state.favourites.has(id)) state.favourites.delete(id);
      else state.favourites.add(id);
      localStorage.setItem("browserp:favourites", JSON.stringify([...state.favourites]));
      const active = state.favourites.has(id);
      event.currentTarget.classList.toggle("active", active);
      event.currentTarget.textContent = active ? "♥" : "♡";
      event.currentTarget.setAttribute("aria-pressed", String(active));
      event.currentTarget.setAttribute("aria-label", `${active ? "Remove from" : "Add to"} favourites`);
      showToast(active ? "Saved to your local favourites." : "Removed from favourites.");
    });

    $(".boost-button", card).addEventListener("click", async (event) => {
      const button = event.currentTarget;
      button.disabled = true;
      button.textContent = "Boosting…";
      try {
        const payload = await api("/api/boosts", { method: "POST", body: JSON.stringify({ serverId: id }) });
        $("#boost-balance").textContent = payload.remaining;
        button.textContent = "✓ Boosted today";
        const server = state.servers.find((item) => item.id === id);
        showToast(`${server?.name || "The community"} received your free boost.`);
      } catch (error) {
        button.disabled = false;
        button.textContent = "✦ Give free boost";
        showToast(error.message, "error");
      }
    });

  });
}

async function loadServers({ firstLoad = false } = {}) {
  const params = new URLSearchParams({ sort: state.filters.sort, limit: "100" });
  if (state.filters.query) params.set("query", state.filters.query);
  if (state.filters.platform !== "all") params.set("platform", state.filters.platform);
  if (state.filters.region !== "all") params.set("region", state.filters.region);
  if (state.filters.online) params.set("online", "true");
  if (state.filters.verified) params.set("verified", "true");
  if (state.filters.beginner) params.set("beginner", "true");
  $("#server-list").setAttribute("aria-busy", "true");
  try {
    const payload = await api(`/api/servers?${params}`);
    state.servers = payload.servers;
    const visible = state.servers.slice(0, state.visible);
    $("#server-list").innerHTML = visible.map(renderServerCard).join("");
    $("#result-count").textContent = state.servers.length;
    $("#server-list").hidden = state.servers.length === 0;
    $("#empty-state").hidden = state.servers.length !== 0;
    $("#load-more").hidden = state.servers.length <= state.visible;
    $("#server-list").setAttribute("aria-busy", "false");
    bindServerCards();
    updateActiveFilterCount();
    if (firstLoad) {
      renderPulse(state.servers);
      const totalPlayers = state.servers.filter((server) => server.online).reduce((sum, server) => sum + server.players, 0);
      $("#live-player-total").textContent = totalPlayers.toLocaleString();
    }
  } catch (error) {
    $("#server-list").innerHTML = "";
    $("#server-list").setAttribute("aria-busy", "false");
    $("#empty-state").hidden = false;
    $("#empty-state p").textContent = "The directory could not load. Check that the BrowseRP server is running.";
    showToast(error.message, "error");
  }
}

function updateActiveFilterCount() {
  const count = [
    Boolean(state.filters.query),
    state.filters.platform !== "all",
    state.filters.region !== "all",
    state.filters.online,
    state.filters.verified,
    state.filters.beginner
  ].filter(Boolean).length;
  $("#active-filter-count").textContent = count;
}

function resetFilters() {
  state.filters = { query: "", platform: "all", region: "all", online: false, verified: false, beginner: false, sort: "recommended" };
  state.visible = 5;
  $("#directory-search").value = "";
  $("#platform-select").value = "all";
  $("#region-select").value = "all";
  $("#online-filter").checked = false;
  $("#verified-filter").checked = false;
  $("#beginner-filter").checked = false;
  $("#sort-select").value = "recommended";
  $("#mobile-sort-select").value = "recommended";
  updatePlatformButtons();
  loadServers();
}

async function renderCategories() {
  try {
    const { categories } = await api("/api/categories");
    const styles = [
      ["✦", "#f5f2ff", "#6c5be6", "#e9e5ff"],
      ["◎", "#edf8f4", "#23845f", "#def2e9"],
      ["↗", "#eef5fd", "#3d76b7", "#dceafb"],
      ["◇", "#fff4e9", "#bc6e2a", "#fde8d2"],
      ["✓", "#fff0f3", "#c9556d", "#fadce3"]
    ];
    $("#category-grid").innerHTML = categories.slice(0, 5).map((category, index) => {
      const [icon, background, color, iconBackground] = styles[index];
      return `<button class="category-card category-style-${index}" type="button" data-category="${escapeHtml(category.name)}"><span class="category-icon">${icon}</span><strong>${escapeHtml(category.name)}</strong><small>${category.count} ${category.count === 1 ? "community" : "communities"}</small></button>`;
    }).join("");
    $$("[data-category]").forEach((button) => button.addEventListener("click", () => {
      state.filters.query = button.dataset.category;
      $("#directory-search").value = state.filters.query;
      state.visible = 5;
      loadServers();
      $("#discover").scrollIntoView({ behavior: "smooth" });
    }));
  } catch {
    $("#category-grid").innerHTML = "";
  }
}

async function loadOverview() {
  try {
    const [{ overview }, balance] = await Promise.all([
      api("/api/public/overview"),
      api("/api/boosts/balance")
    ]);
    $("#boost-balance").textContent = balance.remaining;
    $("#admin-online").textContent = overview.online;
    $("#admin-pending").textContent = overview.pendingReviews;
    $("#admin-boosts").textContent = overview.boostsToday;
  } catch {
    $("#boost-balance").textContent = "3";
  }
}

function wireFilters() {
  let searchTimer;
  $("#directory-search").addEventListener("input", (event) => {
    clearTimeout(searchTimer);
    state.filters.query = event.target.value.trim();
    state.visible = 5;
    searchTimer = setTimeout(() => loadServers(), 180);
  });
  $("#platform-select").addEventListener("change", (event) => {
    state.filters.platform = event.target.value;
    state.visible = 5;
    updatePlatformButtons();
    loadServers();
  });
  $("#region-select").addEventListener("change", (event) => { state.filters.region = event.target.value; state.visible = 5; loadServers(); });
  [["#online-filter", "online"], ["#verified-filter", "verified"], ["#beginner-filter", "beginner"]].forEach(([selector, key]) => {
    $(selector).addEventListener("change", (event) => { state.filters[key] = event.target.checked; state.visible = 5; loadServers(); });
  });
  const setSort = (value) => {
    state.filters.sort = value;
    $("#sort-select").value = value;
    $("#mobile-sort-select").value = value;
    state.visible = 5;
    loadServers();
  };
  $("#sort-select").addEventListener("change", (event) => setSort(event.target.value));
  $("#mobile-sort-select").addEventListener("change", (event) => setSort(event.target.value));
  $("#clear-filters").addEventListener("click", resetFilters);
  $("#empty-clear").addEventListener("click", resetFilters);
  $("#load-more").addEventListener("click", () => { state.visible += 5; loadServers(); });
  $("#filters-button").addEventListener("click", (event) => {
    const open = $("#filters-panel").classList.toggle("open");
    event.currentTarget.setAttribute("aria-expanded", String(open));
  });
}

function wireSearch() {
  $("#hero-search-form").addEventListener("submit", (event) => {
    event.preventDefault();
    state.filters.query = $("#hero-search-input").value.trim();
    $("#directory-search").value = state.filters.query;
    state.visible = 5;
    loadServers();
    $("#discover").scrollIntoView({ behavior: "smooth" });
  });
  $$('[data-search]').forEach((button) => button.addEventListener("click", () => {
    const query = button.dataset.search;
    $("#hero-search-input").value = query;
    state.filters.query = query;
    $("#directory-search").value = query;
    state.visible = 5;
    loadServers();
    $("#discover").scrollIntoView({ behavior: "smooth" });
  }));
}

function renderHash(result) {
  const values = [result.signed, result.unsigned, result.hexadecimal];
  $$("#hash-results strong").forEach((element, index) => { element.textContent = values[index]; });
}

function wireTools() {
  $("#hash-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const input = $("#hash-input").value.trim();
    if (!input) return showToast("Enter a value to hash.", "error");
    try {
      const result = await api("/api/tools/joaat", { method: "POST", body: JSON.stringify({ input }) });
      renderHash(result);
    } catch (error) {
      showToast(error.message, "error");
    }
  });

  $("#name-generator-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const body = {
      platform: $("#name-platform").value,
      theme: $("#name-theme").value,
      style: $("#name-style").value
    };
    try {
      const { names } = await api("/api/tools/name-generator", { method: "POST", body: JSON.stringify(body) });
      $("#name-results").innerHTML = names.map((name) => `<li><span>${escapeHtml(name)}</span><button type="button" data-copy-name="${escapeHtml(name)}">Copy</button></li>`).join("");
      $$('[data-copy-name]').forEach((button) => button.addEventListener("click", async () => {
        await navigator.clipboard.writeText(button.dataset.copyName);
        button.textContent = "Copied";
        showToast("Name copied.");
      }));
    } catch (error) {
      showToast(error.message, "error");
    }
  });
}

function wireNavigation() {
  $("#menu-button").addEventListener("click", (event) => {
    const open = $("#primary-nav").classList.toggle("open");
    event.currentTarget.setAttribute("aria-expanded", String(open));
  });
  $$("#primary-nav a").forEach((link) => link.addEventListener("click", () => {
    $("#primary-nav").classList.remove("open");
    $("#menu-button").setAttribute("aria-expanded", "false");
  }));
  const observed = ["discover", "platforms", "tools", "staff", "foundation"];
  const observer = new IntersectionObserver((entries) => {
    const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
    if (!visible) return;
    $$("#primary-nav a").forEach((link) => link.classList.toggle("active", link.getAttribute("href") === `#${visible.target.id}`));
  }, { rootMargin: "-25% 0px -65%", threshold: [0, .2, .6] });
  observed.forEach((id) => { const element = document.getElementById(id); if (element) observer.observe(element); });
}

function wireDialogs() {
  const signIn = $("#sign-in-dialog");
  $("#sign-in-button").addEventListener("click", () => {
    if (state.session?.authenticated) location.assign("/dashboard");
    else signIn.showModal();
  });
  const listing = $("#listing-dialog");
  $$('[data-open-listing]').forEach((button) => button.addEventListener("click", () => {
    if (!state.session?.authenticated) {
      signIn.showModal();
      return;
    }
    resetListingForm();
    listing.showModal();
  }));
  $$('[data-close-listing]').forEach((button) => button.addEventListener("click", () => listing.close()));
  [signIn, listing].forEach((dialog) => dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  }));
  $$('[data-toast]').forEach((button) => button.addEventListener("click", () => showToast(button.dataset.toast)));
}

let listingStep = 1;
function setListingStep(step) {
  listingStep = step;
  $$(".listing-step").forEach((panel) => panel.classList.toggle("active", Number(panel.dataset.step) === step));
  $$(".listing-progress > span").forEach((bar, index) => bar.classList.toggle("active", index < step));
  $("#listing-step-number").textContent = step;
  if (step === 4) renderSubmissionPreview();
}

function fieldsInStep(step) {
  return $$(`.listing-step[data-step="${step}"] [required]`);
}

function validateListingStep(step) {
  for (const field of fieldsInStep(step)) {
    if (!field.checkValidity()) {
      field.reportValidity();
      return false;
    }
  }
  return true;
}

function renderSubmissionPreview() {
  const form = $("#listing-form");
  const data = new FormData(form);
  const platform = state.platforms.find((item) => item.id === data.get("platform"))?.name || data.get("platform");
  $("#submission-preview").innerHTML = `
    <div><span>Community</span><strong>${escapeHtml(data.get("name"))}</strong></div>
    <div><span>Platform</span><strong>${escapeHtml(platform)}</strong></div>
    <div><span>Region</span><strong>${escapeHtml(data.get("region"))}</strong></div>
    <div><span>Language</span><strong>${escapeHtml(data.get("language"))}</strong></div>
    <div><span>Review path</span><strong>Rules → risk signals → staff queue</strong></div>
  `;
}

function resetListingForm() {
  $("#listing-form").reset();
  $("#listing-success").hidden = true;
  $(".listing-progress").hidden = false;
  setListingStep(1);
}

function wireListingForm() {
  $$(".listing-next").forEach((button) => button.addEventListener("click", () => {
    if (validateListingStep(listingStep)) setListingStep(Math.min(4, listingStep + 1));
  }));
  $$(".listing-back").forEach((button) => button.addEventListener("click", () => setListingStep(Math.max(1, listingStep - 1))));
  $("#listing-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!validateListingStep(4)) return;
    const button = $("#submit-listing");
    button.disabled = true;
    button.textContent = "Submitting…";
    const data = Object.fromEntries(new FormData(event.currentTarget));
    try {
      const { submission } = await api("/api/submissions", {
        method: "POST",
        body: JSON.stringify({
          platform: data.platform,
          name: data.name,
          region: data.region,
          language: data.language,
          framework: data.framework,
          description: data.description,
          communityUrl: data.communityUrl
        })
      });
      $$(".listing-step").forEach((step) => step.classList.remove("active"));
      $(".listing-progress").hidden = true;
      $("#listing-success").hidden = false;
      $("#submission-id").textContent = submission.id;
      showToast("Listing submitted to the review queue.");
      loadOverview();
    } catch (error) {
      showToast(error.message, "error");
    } finally {
      button.disabled = false;
      button.textContent = "Submit for review";
    }
  });
}

function wireMisc() {
  $("#hash-input").value = "adder";
  const query = new URLSearchParams(location.search).get("q");
  if (query) {
    state.filters.query = query.slice(0, 100);
    $("#directory-search").value = state.filters.query;
    $("#hero-search-input").value = state.filters.query;
  }
}

async function loadSession() {
  try {
    state.session = await api("/api/auth/session");
    if (state.session.authenticated) {
      const name = state.session.user.profile?.display_name || "Dashboard";
      $("#sign-in-button").textContent = name.length > 16 ? "Dashboard" : name;
    }
  } catch {
    state.session = { authenticated: false, user: null };
  }
}

function wireCheckout() {
  $$('[data-buy-pack]').forEach((button) => button.addEventListener("click", async () => {
    if (!state.session?.authenticated) {
      $("#sign-in-dialog").showModal();
      return;
    }
    if (!$("#purchase-authorized").checked) {
      showToast("Confirm that you are authorized to purchase first.", "error");
      $("#purchase-authorized").focus();
      return;
    }
    button.disabled = true;
    const original = button.textContent;
    button.textContent = "Opening secure checkout…";
    try {
      const payload = await api("/api/checkout", {
        method: "POST",
        body: JSON.stringify({
          pack: button.dataset.buyPack,
          quantity: 1,
          authorizedPurchase: true,
          attemptId: crypto.randomUUID()
        })
      });
      location.assign(payload.checkoutUrl);
    } catch (error) {
      showToast(error.message, "error");
      button.disabled = false;
      button.textContent = original;
    }
  }));
}

async function init() {
  wireNavigation();
  wireSearch();
  wireFilters();
  wireTools();
  wireDialogs();
  wireListingForm();
  wireMisc();
  wireCheckout();
  try {
    await loadSession();
    const { platforms } = await api("/api/platforms");
    state.platforms = platforms;
    renderPlatforms();
    await Promise.all([loadServers({ firstLoad: true }), renderCategories(), loadOverview()]);
  } catch (error) {
    showToast(`BrowseRP could not initialise: ${error.message}`, "error");
  }
  if (new URLSearchParams(location.search).get("auth") === "failed") showToast("Discord sign-in could not be completed. Please try again.", "error");
}

init();
