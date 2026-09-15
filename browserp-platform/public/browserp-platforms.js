(() => {
  "use strict";

  // IDs are allowlisted so API labels can never become markup or CSS selectors.
  const names = Object.freeze({
    fivem: "FiveM", redm: "RedM", roblox: "Roblox", minecraft: "Minecraft",
    forza: "Forza", gmod: "Garry's Mod", arma: "ARMA", vrchat: "VRChat", dayz: "DayZ",
    "project-zomboid": "Project Zomboid", ets2: "Euro Truck Simulator 2",
    "assetto-corsa": "Assetto Corsa", beamng: "BeamNG.drive"
  });
  const aliases = { "garrys mod": "gmod", "truck sim": "ets2", "euro truck simulator": "ets2", "beamng drive": "beamng" };
  const normalize = (value) => String(value || "").toLowerCase().replace(/[’']/g, "").replace(/[.\s_-]+/g, " ").trim();
  function resolve(value) {
    const key = normalize(value);
    return Object.keys(names).find((id) => normalize(id) === key || normalize(names[id]) === key) || (Object.hasOwn(aliases, key) ? aliases[key] : "other");
  }
  function idFor(server) { return resolve(server.platform_id || server.platform_name || server.platform_short); }
  function theme(element, value) { element.dataset.platform = resolve(value); return element; }
  function node(tag, className, text) {
    const element = document.createElement(tag);
    element.className = className;
    if (text !== undefined) element.textContent = String(text);
    return element;
  }
  function badge(value, label = names[resolve(value)] || "Roleplay") {
    const item = theme(node("span", "platform-badge-v5"), value);
    item.append(node("span", "", label));
    return item;
  }
  // Preserve this public metadata order: platform, region, language, framework, access.
  function entries(server, engagement = {}) {
    const access = engagement.accessType || server.access_type;
    const accessLabel = ({ public: "Open to everyone", allowlisted: "Approval required", whitelisted: "Approval required", application: "Application required", unknown: "Not confirmed" })[access] || access;
    return [
      ["Game", server.platform_name || names[idFor(server)] || server.platform_short || "Roleplay"],
      ["Region", server.region], ["Language", server.language], [idFor(server) === "roblox" ? "Roblox experience" : "Server setup", server.framework],
      ["Access", accessLabel]
    ];
  }
  const categoryKeys = ["platform", "region", "language", "mode", "access"];
  function categoryHref(server, engagement, index) {
    const platform = idFor(server);
    const raw = index === 0 ? platform : index === 4 ? (engagement.accessType || server.access_type) : entries(server, engagement)[index][1];
    if (!raw || String(raw).trim().toLowerCase() === "unknown" || (index === 0 && platform === "other")) return "";
    const query = new URLSearchParams();
    if (index > 2 && platform !== "other") query.set("platform", platform);
    query.set(categoryKeys[index], String(raw));
    return `/servers?${query}`;
  }
  function categoryLink(server, engagement, index, label, value, className) {
    const href = categoryHref(server, engagement, index);
    if (!href) return null;
    const link = node("a", className);
    link.href = href;
    link.setAttribute("aria-label", `Browse servers filtered by ${label}: ${value}`);
    link.append(index === 0 ? badge(idFor(server), value) : document.createTextNode(String(value)));
    return link;
  }
  function metadata(server, engagement = {}, linked = false) {
    const row = node("div", "server-meta platform-meta-v5");
    entries(server, engagement).forEach(([label, value], index) => {
      if (!value) return;
      const item = (linked && categoryLink(server, engagement, index, label, value, `server-category-link-v10${index ? " metadata-value-v5" : " game-category-link-v10"}`))
        || (index === 0 ? badge(idFor(server), value) : node("span", "metadata-value-v5", value));
      if (!item.href) item.setAttribute("aria-label", `${label}: ${value}`);
      row.append(item);
    });
    if (server.verified) row.append(node("span", "metadata-value-v5", "Owner verified"));
    return row;
  }
  function facts(server, engagement = {}) {
    const list = theme(node("dl", "server-info-grid-v5"), idFor(server));
    const rows = [...entries(server, engagement), ["Player status", server.applicationOnly ? "Live player count not provided" : server.online ? `${server.players || 0} / ${server.capacity || "?"} online` : "Status unavailable"]];
    rows.forEach(([label, value], index) => {
      const card = node("div", `server-info-card-v5${index >= 4 ? " server-info-wide-v5" : ""}`);
      const detail = node("dd", "");
      detail.append(index < 5 && value && categoryLink(server, engagement, index, label, value, "server-fact-link-v10")
        || (index === 0 ? badge(idFor(server), value) : document.createTextNode(String(value || "Not specified"))));
      card.append(node("dt", "", label), detail);
      list.append(card);
    });
    return list;
  }
  window.BrowseRPPlatforms = Object.freeze({ names, resolve, idFor, theme, badge, entries, metadata, facts });
})();
