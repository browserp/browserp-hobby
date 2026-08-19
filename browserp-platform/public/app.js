const page = document.body.dataset.page || "";
const state = {
  session: null,
  providers: { discord: false, google: false },
  filters: {
    query: "",
    region: "all",
    online: false,
    verified: false,
    beginner: false,
    sort: "recommended"
  }
};

const $ = (selector, root = document) => root.querySelector(selector);
const escapeHtml = (value) => String(value ?? "")
  .replaceAll("&", "&amp;")
  .replaceAll("<", "&lt;")
  .replaceAll(">", "&gt;")
  .replaceAll('"', "&quot;")
  .replaceAll("'", "&#039;");

function initials(name) {
  return String(name || "BR")
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0])
    .join("")
    .toUpperCase();
}

function safeHttpsUrl(value) {
  try {
    const url = new URL(String(value || ""));
    return url.protocol === "https:" ? url.href : "";
  } catch {
    return "";
  }
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) }
  });
  const payload = await response.json().catch(() => ({ error: "The response could not be read." }));
  if (!response.ok) {
    const error = new Error(payload.error || "Request failed.");
    error.status = response.status;
    throw error;
  }
  return payload;
}

let toastTimer;
function showToast(message, tone = "success") {
  const toast = $("#site-toast");
  if (!toast) return;
  toast.textContent = message;
  toast.classList.toggle("error", tone === "error");
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 3400);
}

function renderServerCard(server) {
  const tags = (Array.isArray(server.tags) ? server.tags : []).slice(0, 3);
  const statusLabel = server.online ? "Online" : "Status unavailable";
  const playerLabel = server.online
    ? `${Number(server.players || 0).toLocaleString()} / ${Number(server.capacity || 0).toLocaleString()} players`
    : "Player count unavailable";
  const details = [server.region, server.framework, server.language].filter(Boolean).map(escapeHtml).join(" · ");
  const communityUrl = safeHttpsUrl(server.community_url);
  const primaryAction = communityUrl
    ? `<a href="${escapeHtml(communityUrl)}" target="_blank" rel="nofollow noopener noreferrer">Visit community</a>`
    : `<a href="/server/${encodeURIComponent(server.slug)}">View server</a>`;

  return `
    <article class="server-card">
      <div class="server-card-head">
        <span class="server-monogram" aria-hidden="true">${escapeHtml(initials(server.name))}</span>
        <span class="server-status${server.online ? " online" : ""}">${escapeHtml(statusLabel)}</span>
      </div>
      <h3>${escapeHtml(server.name)}</h3>
      <div class="server-card-meta">${details || "FiveM roleplay"}${server.verified ? " · Owner verified" : ""}</div>
      <p>${escapeHtml(server.description)}</p>
      <div class="server-tags">${tags.map((tag) => `<span>${escapeHtml(tag)}</span>`).join("")}</div>
      <div class="server-card-footer"><strong>${escapeHtml(playerLabel)}</strong>${primaryAction}</div>
    </article>`;
}

async function loadFeaturedServers() {
  const list = $("#featured-server-list");
  if (!list) return;
  try {
    const { servers = [] } = await api("/api/servers?platform=fivem&sort=recommended&limit=3");
    list.setAttribute("aria-busy", "false");
    list.innerHTML = servers.map(renderServerCard).join("");
    list.hidden = servers.length === 0;
    $("#featured-empty").hidden = servers.length !== 0;
  } catch (error) {
    list.setAttribute("aria-busy", "false");
    list.hidden = true;
    const empty = $("#featured-empty");
    empty.hidden = false;
    $("h3", empty).textContent = "The server list is temporarily unavailable.";
    $("p", empty).textContent = "Please try again shortly.";
    showToast(error.message, "error");
  }
}

function wireHome() {
  $("#home-search-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const query = $("#home-search").value.trim();
    const destination = new URL("/servers", location.origin);
    if (query) destination.searchParams.set("q", query);
    location.assign(`${destination.pathname}${destination.search}`);
  });
  loadFeaturedServers();
}

function filtersFromUrl() {
  const params = new URLSearchParams(location.search);
  state.filters.query = (params.get("q") || "").slice(0, 120);
  state.filters.region = (params.get("region") || "all").slice(0, 60);
  state.filters.online = params.get("online") === "true";
  state.filters.verified = params.get("verified") === "true";
  state.filters.beginner = params.get("beginner") === "true";
  state.filters.sort = (params.get("sort") || "recommended").slice(0, 30);
}

function writeFiltersToControls() {
  $("#directory-search").value = state.filters.query;
  $("#region-filter").value = [...$("#region-filter").options].some((option) => option.value === state.filters.region) ? state.filters.region : "all";
  $("#sort-filter").value = [...$("#sort-filter").options].some((option) => option.value === state.filters.sort) ? state.filters.sort : "recommended";
  $("#online-filter").checked = state.filters.online;
  $("#verified-filter").checked = state.filters.verified;
  $("#beginner-filter").checked = state.filters.beginner;
}

function updateDirectoryUrl() {
  const params = new URLSearchParams();
  if (state.filters.query) params.set("q", state.filters.query);
  if (state.filters.region !== "all") params.set("region", state.filters.region);
  if (state.filters.online) params.set("online", "true");
  if (state.filters.verified) params.set("verified", "true");
  if (state.filters.beginner) params.set("beginner", "true");
  if (state.filters.sort !== "recommended") params.set("sort", state.filters.sort);
  history.replaceState(null, "", `${location.pathname}${params.size ? `?${params}` : ""}`);
}

async function loadDirectory() {
  const list = $("#server-list");
  list.setAttribute("aria-busy", "true");
  const params = new URLSearchParams({ platform: "fivem", sort: state.filters.sort, limit: "100" });
  if (state.filters.query) params.set("query", state.filters.query);
  if (state.filters.region !== "all") params.set("region", state.filters.region);
  if (state.filters.online) params.set("online", "true");
  if (state.filters.verified) params.set("verified", "true");
  if (state.filters.beginner) params.set("beginner", "true");

  try {
    const { servers = [] } = await api(`/api/servers?${params}`);
    list.innerHTML = servers.map(renderServerCard).join("");
    list.hidden = servers.length === 0;
    list.setAttribute("aria-busy", "false");
    $("#directory-empty").hidden = servers.length !== 0;
    $("#result-count").textContent = String(servers.length);
    updateDirectoryUrl();
  } catch (error) {
    list.innerHTML = "";
    list.hidden = true;
    list.setAttribute("aria-busy", "false");
    $("#directory-empty").hidden = false;
    $("#result-count").textContent = "0";
    showToast(error.message, "error");
  }
}

function clearDirectoryFilters() {
  state.filters = { query: "", region: "all", online: false, verified: false, beginner: false, sort: "recommended" };
  writeFiltersToControls();
  loadDirectory();
}

function wireDirectory() {
  filtersFromUrl();
  writeFiltersToControls();
  let searchTimer;
  $("#directory-search").addEventListener("input", (event) => {
    clearTimeout(searchTimer);
    state.filters.query = event.target.value.trim();
    searchTimer = setTimeout(loadDirectory, 180);
  });
  $("#region-filter").addEventListener("change", (event) => { state.filters.region = event.target.value; loadDirectory(); });
  $("#sort-filter").addEventListener("change", (event) => { state.filters.sort = event.target.value; loadDirectory(); });
  [["#online-filter", "online"], ["#verified-filter", "verified"], ["#beginner-filter", "beginner"]].forEach(([selector, key]) => {
    $(selector).addEventListener("change", (event) => { state.filters[key] = event.target.checked; loadDirectory(); });
  });
  $("#clear-filters").addEventListener("click", clearDirectoryFilters);
  $("#filter-toggle").addEventListener("click", (event) => {
    const open = $("#filter-panel").classList.toggle("open");
    event.currentTarget.setAttribute("aria-expanded", String(open));
  });
  loadDirectory();
}

async function loadSession() {
  try {
    state.session = await api("/api/auth/session");
  } catch {
    state.session = { authenticated: false, user: null };
  }
  document.querySelectorAll("[data-account-link]").forEach((link) => {
    link.textContent = state.session?.authenticated ? "My account" : "Sign in";
  });
  return state.session;
}

async function loadProviders() {
  try {
    const payload = await api("/api/auth/providers");
    state.providers = { ...state.providers, ...(payload.providers || {}) };
  } catch {
    state.providers = { discord: false, google: false };
  }
  document.querySelectorAll("[data-auth-provider]").forEach((link) => {
    link.hidden = !state.providers[link.dataset.authProvider];
  });
  const available = Object.values(state.providers).some(Boolean);
  if (!available && $("#auth-provider-list")) {
    $("#auth-provider-list").insertAdjacentHTML("beforeend", '<p class="form-status">Sign-in is not configured in this local preview.</p>');
  }
}

function setListingStatus(message, tone = "") {
  const status = $("#listing-status");
  status.textContent = message;
  status.className = `form-status${tone ? ` ${tone}` : ""}`;
}

function showSignInDialog() {
  const dialog = $("#sign-in-dialog");
  if (dialog?.showModal) dialog.showModal();
}

async function wireListing() {
  const [session] = await Promise.all([loadSession(), loadProviders()]);
  const notice = $("#auth-notice");
  if (session?.authenticated) {
    const name = session.user?.profile?.display_name || session.user?.email || "your account";
    notice.textContent = `Signed in as ${name}. Review updates will appear in My account.`;
  } else {
    notice.textContent = "You can fill in the form now, but you must sign in before submitting.";
  }

  $("[data-close-dialog]")?.addEventListener("click", () => $("#sign-in-dialog").close());
  $("#sign-in-dialog")?.addEventListener("click", (event) => {
    if (event.target === event.currentTarget) event.currentTarget.close();
  });

  $("#listing-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!state.session?.authenticated) {
      setListingStatus("Sign in before submitting your listing.", "error");
      showSignInDialog();
      return;
    }
    if (!event.currentTarget.reportValidity()) return;

    const button = $("#submit-listing");
    const data = Object.fromEntries(new FormData(event.currentTarget));
    button.disabled = true;
    button.textContent = "Submitting…";
    setListingStatus("Sending your listing for review…");
    try {
      const { submission } = await api("/api/submissions", {
        method: "POST",
        body: JSON.stringify({
          platform: "fivem",
          name: data.name,
          region: data.region,
          language: data.language,
          framework: data.framework,
          description: data.description,
          communityUrl: data.communityUrl
        })
      });
      event.currentTarget.reset();
      setListingStatus(`Listing received. Reference: ${submission.id}`, "success");
      showToast("Your listing was submitted for review.");
    } catch (error) {
      setListingStatus(error.message, "error");
      showToast(error.message, "error");
    } finally {
      button.disabled = false;
      button.textContent = "Submit for review";
    }
  });
}

async function init() {
  if (page === "home") wireHome();
  if (page === "servers") wireDirectory();
  if (page === "list-server") await wireListing();
  if (page !== "list-server") loadSession();

  const auth = new URLSearchParams(location.search).get("auth");
  const authMessages = {
    failed: "Sign-in could not be completed. Please try again.",
    "backend-not-configured": "Sign-in is not configured yet.",
    "discord-not-configured": "Discord sign-in is not configured yet.",
    "google-not-configured": "Google sign-in is not configured yet."
  };
  if (authMessages[auth]) showToast(authMessages[auth], "error");
}

init();
