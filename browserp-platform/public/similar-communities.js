(() => {
  "use strict";
  const section = document.querySelector("#similar-communities-v1");
  if (!section || !/^\/server\/[a-z0-9]+(?:-[a-z0-9]+)*\/?$/.test(location.pathname)) return;
  const list = section.querySelector("[data-similar-list]");
  const state = section.querySelector("[data-similar-state]");
  const retry = section.querySelector("[data-similar-retry]");
  const browse = section.querySelector("[data-similar-browse]");
  const slug = location.pathname.split("/").filter(Boolean).at(-1);
  const names = { fivem: "FiveM", redm: "RedM", minecraft: "Minecraft", roblox: "Roblox" };
  const platform = section.closest("#server-detail-v3")?.dataset.platform || "";
  let request = 0;
  let playerExpiryTimer = null;

  function item(tag, className = "", copy) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (copy !== undefined) element.textContent = copy;
    return element;
  }
  function initials(value) {
    return String(value || "RP").trim().split(/\s+/).slice(0, 2).map(part => part[0] || "").join("").toUpperCase() || "RP";
  }
  function safeImage(value) {
    try {
      const url = new URL(String(value || ""), location.origin);
      return url.protocol === "https:" && !url.username && !url.password ? url.href : "";
    } catch { return ""; }
  }
  function card(server) {
    const card = item("div", "server-card discovery-card-v10");
    const listingHref = `/server/${encodeURIComponent(server.slug)}`;
    window.BrowseRPPlatforms?.theme?.(card, window.BrowseRPPlatforms.idFor(server));
    const media = item("div", "server-card-media");
    const fallback = item("span", "server-initials", initials(server.name));
    const source = safeImage(server.logo_url) || safeImage(server.banner_url);
    if (source) {
      const image = new Image();
      image.className = "server-card-media-image";
      image.loading = "lazy";
      image.alt = "";
      image.addEventListener("error", () => image.replaceWith(fallback), { once: true });
      image.src = source;
      media.append(image);
    } else media.append(fallback);
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
    const statusText = playerState === "listing" ? "Community listing" : playerState === "live" ? "Live count" : playerState === "stale" ? "Needs refresh" : playerState === "offline" ? "Reported offline" : "Status unavailable";
    const top = item("div", "server-card-top discovery-card-identity-v10");
    const heading = item("h3", ""); const title = item("a", "discovery-card-title-v10", server.name || "Roleplay community"); title.href = listingHref; heading.append(title);
    const status = item("span", `status ${playerState}`, statusText); status.dataset.playerState = playerState;
    top.append(media, heading, status);
    card.append(top, item("p", "server-description", server.description || "Open the listing to learn more about this community."));
    if (window.BrowseRPPlatforms?.discoveryMetadata) card.append(window.BrowseRPPlatforms.discoveryMetadata(server));
    else card.append(item("p", "server-meta", [server.platform_name, server.region, server.language].filter(Boolean).join(" · ")));
    const serverTags = item("div", "server-tags");
    (Array.isArray(server.tags) ? server.tags : []).slice(0, 3).forEach((tag) => {
      const label = String(tag || "").trim(); if (!label) return;
      const filters = new URLSearchParams({ feature: label });
      const platformId = window.BrowseRPPlatforms?.idFor?.(server) || "other"; if (platformId !== "other") filters.set("platform", platformId);
      const tagLink = item("a", "", label); tagLink.href = `/servers?${filters}`;
      tagLink.setAttribute("aria-label", `Find communities tagged ${label}`); serverTags.append(tagLink);
    });
    card.append(serverTags);
    const bottom = item("div", "server-card-bottom");
    const playerText = playerState === "listing" ? "Live player count not provided" : playerState === "live"
      ? `${players.toLocaleString()}${capacity !== null ? ` / ${capacity.toLocaleString()}` : ""} players${server.count_scope === "network" ? " across the network" : ""}`
      : playerState === "stale" ? "Player count needs a refresh" : "Player count unavailable";
    const playerCount = item("strong", `player-count-v10 is-${playerState}${freshCount ? " is-live" : ""}`, playerText);
    playerCount.title = playerState === "listing" ? "This community does not publish a live player count" : playerState === "live" ? "A recently checked player count" : playerState === "stale" ? "The last player count is no longer recent" : "No current player count is available";
    const view = item("a", "server-card-action", "View listing"); view.href = listingHref;
    bottom.append(playerCount, view); card.append(bottom);
    if (freshCount) card.dataset.playerFreshUntil = String(checkedAt + 300000);
    return window.BrowseRPShortlist?.wrap?.(card, server) || card;
  }
  function clearPlayerExpiry() {
    if (playerExpiryTimer !== null) window.clearTimeout(playerExpiryTimer);
    playerExpiryTimer = null;
  }
  function expirePlayerState(card) {
    card.removeAttribute("data-player-fresh-until");
    const status = card.querySelector(".status");
    if (status) { status.className = "status stale"; status.dataset.playerState = "stale"; status.textContent = "Needs refresh"; }
    const count = card.querySelector(".player-count-v10");
    if (count) { count.className = "player-count-v10 is-stale"; count.title = "The last player count is no longer recent"; count.textContent = "Player count needs a refresh"; }
  }
  function schedulePlayerExpiry() {
    clearPlayerExpiry();
    const now = Date.now(), cards = [...list.querySelectorAll(".server-card[data-player-fresh-until]")];
    cards.filter(card => Number(card.dataset.playerFreshUntil) <= now).forEach(expirePlayerState);
    const next = cards.map(card => Number(card.dataset.playerFreshUntil)).filter(value => Number.isFinite(value) && value > now).sort((a, b) => a - b)[0];
    if (next) playerExpiryTimer = window.setTimeout(schedulePlayerExpiry, Math.min(next - now, 2147483647));
  }
  function show(mode, message) {
    section.hidden = false;
    section.dataset.state = mode;
    section.removeAttribute("aria-busy");
    list.hidden = mode !== "ready";
    state.hidden = mode === "ready";
    retry.hidden = mode !== "error";
    state.querySelector("h3").textContent = mode === "error" ? "Similar communities are temporarily unavailable." : "No close matches yet.";
    state.querySelector("p").textContent = message;
  }
  async function load() {
    const ticket = ++request;
    section.setAttribute("aria-busy", "true");
    retry.disabled = true;
    try {
      const response = await fetch(`/api/servers?similar=${encodeURIComponent(slug)}`, { credentials: "same-origin", headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error("Unavailable");
      const payload = await response.json();
      if (!Array.isArray(payload.servers) || payload.servers.length > 3) throw new Error("Invalid response");
      if (ticket !== request) return;
      const servers = payload.servers.filter(server => server && typeof server === "object"
        && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(String(server.slug || "")) && server.slug !== slug).slice(0, 3);
      list.replaceChildren(...servers.map(card));
      schedulePlayerExpiry();
      if (servers.length) show("ready", "");
      else show("empty", "Browse more communities from this game.");
    } catch {
      if (ticket === request) show("error", "Try again or browse more communities from this game.");
    } finally {
      if (ticket === request) retry.disabled = false;
    }
  }
  browse.href = names[platform] ? `/servers?platform=${encodeURIComponent(platform)}` : "/servers";
  browse.textContent = names[platform] ? `Browse more ${names[platform]} communities` : "Browse more communities";
  retry.addEventListener("click", load);
  document.addEventListener("visibilitychange", () => { if (document.visibilityState !== "hidden") schedulePlayerExpiry(); });
  window.addEventListener("pageshow", schedulePlayerExpiry);
  window.addEventListener("pagehide", clearPlayerExpiry);
  load();
})();
