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
    const card = item("article", "server-card");
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
    const top = item("div", "server-card-top");
    top.append(media, item("span", "status", "Reviewed listing"));
    card.append(top, item("h3", "", server.name || "Roleplay community"));
    card.append(item("p", "server-description", server.description || "Open the listing to learn more about this community."));
    if (window.BrowseRPPlatforms?.metadata) card.append(window.BrowseRPPlatforms.metadata(server));
    else card.append(item("p", "server-meta", [server.platform_name, server.region, server.language].filter(Boolean).join(" · ")));
    const serverTags = item("div", "server-tags");
    const tags = (Array.isArray(server.tags) ? server.tags : []).map(tag => String(tag || "").trim()).filter(Boolean);
    tags.filter(tag => tag !== "18+").slice(0, 3).forEach(tag => {
      const query = new URLSearchParams({ feature: tag });
      const chip = item("a", "server-tag-chip-v10", tag);
      chip.href = `/servers?${query}`;
      chip.setAttribute("aria-label", `Browse communities with ${tag}`);
      serverTags.append(chip);
    });
    card.append(serverTags);
    if (tags.includes("18+")) card.append(item("div", "server-age-notice-v10", "18+ community · Players must be 18 or older"));
    const bottom = item("div", "server-card-bottom");
    bottom.append(item("strong", "", server.region || "View community details"), item("span", "server-card-action", "View listing"));
    card.append(bottom);
    const cover = item("a", "server-card-cover-v10");
    cover.href = `/server/${encodeURIComponent(server.slug)}`;
    cover.setAttribute("aria-label", `View ${server.name || "community"}`);
    card.append(cover);
    return window.BrowseRPShortlist?.wrap?.(card, server) || card;
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
  load();
})();
