(() => {
  "use strict";
  const root = document.getElementById("overview-featured-boost");
  if (!root) return;
  const status = root.querySelector("[data-boost-status]");
  const select = root.querySelector("[data-boost-server]");
  const duration = root.querySelector("[data-boost-duration]");
  const reason = root.querySelector("[data-boost-reason]");
  const start = root.querySelector("[data-boost-start]");
  const end = root.querySelector("[data-boost-end]");
  const retry = root.querySelector("[data-boost-retry]");
  let api;
  let version = null;
  let busy = false;
  let ready = false;
  let generation = 0;
  let active = null;
  let expiryTimer = null;
  const date = (value) => new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
  const message = (value, error = false) => { status.textContent = value; status.classList.toggle("is-error", error); };
  const current = token => token === generation && api && root.isConnected;
  function controls() {
    for (const control of [select, duration, reason, start]) control.disabled = busy || !ready;
    end.disabled = busy || !ready || !active;
    retry.disabled = busy;
    root.setAttribute("aria-busy", String(busy));
  }
  function reset() {
    generation++;
    clearTimeout(expiryTimer); expiryTimer = null;
    api = null; version = null; busy = false; ready = false; active = null;
    select.replaceChildren(new Option("Choose a published server", ""));
    duration.value = "1"; reason.value = "";
    end.hidden = retry.hidden = root.hidden = true;
    root.inert = true; root.setAttribute("inert", "");
    message("Loading boost controls…"); controls();
  }
  function showActive(token) {
    if (!current(token)) return;
    clearTimeout(expiryTimer); expiryTimer = null;
    if (active && Date.parse(active.expiresAt) <= Date.now()) active = null;
    end.hidden = !active;
    message(active ? `${active.name} is boosted until ${date(active.expiresAt)}. A new boost will replace it.` : "No server is currently boosted. Boosted listings appear first on the homepage until the chosen time ends.");
    if (active) expiryTimer = setTimeout(() => showActive(token), Math.min(Date.parse(active.expiresAt) - Date.now(), 2_147_483_647));
    controls();
  }
  function failed(error, token, saved = false) {
    if (!current(token)) return;
    if ([401, 403].includes(error.status)) { reset(); return; }
    ready = false; retry.hidden = false;
    message(saved ? "The boost was saved, but its current state could not be loaded. Reload boost controls to check it." : error.message || "Boost controls are unavailable. Reload them to try again.", true);
  }
  async function load(token, saved = false) {
    const chosen = select.value;
    ready = false; busy = true; retry.hidden = true;
    clearTimeout(expiryTimer); expiryTimer = null;
    controls();
    try {
      const { feature } = await api("/api/admin/featured-boost");
      if (!current(token)) return;
      if (feature?.canManage === false) { reset(); return; }
      if (feature?.canManage !== true || !Number.isSafeInteger(feature.version) || feature.version < 0
          || !Array.isArray(feature.servers) || feature.servers.some(server => typeof server?.id !== "string" || typeof server.name !== "string")
          || (feature.active && (!feature.active.serverId || !Number.isFinite(Date.parse(feature.active.expiresAt))))) {
        throw new Error("The boost controls could not be loaded. Reload them to try again.");
      }
      version = feature.version; active = feature.active || null;
      select.replaceChildren(new Option("Choose a published server", ""), ...feature.servers.map(server => new Option(server.name, server.id)));
      select.value = feature.servers.some(server => server.id === chosen) ? chosen : active?.serverId || "";
      ready = true; showActive(token);
    } catch (error) { failed(error, token, saved); }
    finally { if (current(token)) { busy = false; controls(); } }
  }
  async function mutate(action) {
    if (busy || !ready || !api || !root.isConnected || root.hidden) return;
    if (action === "end" && (!active || Date.parse(active.expiresAt) <= Date.now())) { showActive(generation); return; }
    if (action === "start" && !select.value) { message("Choose a published server first.", true); select.focus(); return; }
    if (reason.value.trim().length < 5 || reason.value.trim().length > 500) { message("Add a reason of 5 to 500 characters.", true); reason.focus(); return; }
    const hours = Number(duration.value);
    if (action === "start" && (!Number.isSafeInteger(hours) || hours < 1 || hours > 720)) { message("Choose a duration from 1 hour to 30 days.", true); duration.focus(); return; }
    const token = generation;
    busy = true; clearTimeout(expiryTimer); expiryTimer = null; controls();
    try {
      await api("/api/admin/featured-boost", { method: "POST", body: JSON.stringify({
        action, serverId: action === "start" ? select.value : null, durationHours: action === "start" ? hours : null, expectedVersion: version,
        reason: reason.value.trim()
      }) });
      if (!current(token)) return;
      reason.value = "";
      await load(token, true);
    } catch (error) { failed(error, token); }
    finally { if (current(token)) { busy = false; controls(); } }
  }
  start.addEventListener("click", () => mutate("start"));
  end.addEventListener("click", () => mutate("end"));
  retry.addEventListener("click", () => { if (!busy && api) void load(generation); });
  window.addEventListener("browserp:session-ended", reset);
  window.addEventListener("pagehide", reset);
  window.BrowseRPStaffFeaturedBoost = { reset, init: async ({ api: request }) => {
    reset(); api = request;
    root.hidden = false; root.inert = false; root.removeAttribute("inert");
    await load(generation);
  } };
  reset();
})();
