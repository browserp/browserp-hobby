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
    const mark = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    mark.setAttribute("aria-hidden", "true");
    const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
    use.setAttribute("href", `/assets/game-marks-v4.svg#mark-${resolve(value)}`);
    mark.append(use);
    item.append(mark, node("span", "", label));
    return item;
  }
  // Preserve this public metadata order: platform, region, language, framework, access.
  function entries(server, engagement = {}) {
    return [
      ["Platform", server.platform_name || names[idFor(server)] || server.platform_short || "Roleplay"],
      ["Region", server.region], ["Language", server.language], ["Framework", server.framework],
      ["Access", engagement.accessType || server.access_type]
    ];
  }
  function metadata(server, engagement = {}) {
    const row = node("div", "server-meta platform-meta-v5");
    entries(server, engagement).forEach(([label, value], index) => {
      if (!value) return;
      const item = index === 0 ? badge(idFor(server), value) : node("span", "metadata-value-v5", value);
      item.setAttribute("aria-label", `${label}: ${value}`);
      row.append(item);
    });
    if (server.verified) row.append(node("span", "metadata-value-v5", "Owner verified"));
    return row;
  }
  function facts(server, engagement = {}) {
    const list = theme(node("dl", "server-info-grid-v5"), idFor(server));
    const rows = [...entries(server, engagement), ["Player status", server.online ? `${server.players || 0} / ${server.capacity || "?"} online` : "Status unavailable"]];
    rows.forEach(([label, value], index) => {
      const card = node("div", `server-info-card-v5${index >= 4 ? " server-info-wide-v5" : ""}`);
      const detail = node("dd", "");
      detail.append(index === 0 ? badge(idFor(server), value) : document.createTextNode(String(value || "Not specified")));
      card.append(node("dt", "", label), detail);
      list.append(card);
    });
    return list;
  }
  window.BrowseRPPlatforms = Object.freeze({ names, resolve, idFor, theme, badge, entries, metadata, facts });
})();
