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
    const link = item("a", "server-card");
    link.href = `/server/${encodeURIComponent(server.slug)}`;
    link.setAttribute("aria-label", `View ${server.name || "community"}`);
    window.BrowseRPPlatforms?.theme?.(link, window.BrowseRPPlatforms.idFor(server));
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
    link.append(top, item("h3", "", server.name || "Roleplay community"));
    link.append(item("p", "server-description", server.description || "Open the listing to learn more about this community."));
    if (window.BrowseRPPlatforms?.metadata) link.append(window.BrowseRPPlatforms.metadata(server));
    else link.append(item("p", "server-meta", [server.platform_name, server.region, server.language].filter(Boolean).join(" · ")));
    const serverTags = item("div", "server-tags");
    (Array.isArray(server.tags) ? server.tags : []).slice(0, 3).forEach(tag => serverTags.append(item("span", "", tag)));
    link.append(serverTags);
    const bottom = item("div", "server-card-bottom");
    bottom.append(item("strong", "", server.region || "View community details"), item("span", "server-card-action", "View listing"));
    link.append(bottom);
    return window.BrowseRPShortlist?.wrap?.(link, server) || link;
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
