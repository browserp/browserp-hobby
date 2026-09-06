(() => {
  "use strict";
  const KEY = "browserp-recommendations-v1";
  const TTL = 30 * 24 * 60 * 60 * 1000;
  const games = new Set(["fivem", "redm", "minecraft", "roblox"]);
  function region(value) {
    const text = typeof value === "string" ? value.trim().slice(0, 60) : "";
    if (/^(uk|gb|gbr|united kingdom|great britain)$/i.test(text)) return "United Kingdom";
    if (/^(us|usa|united states(?: of america)?)$/i.test(text)) return "United States";
    return /^[\p{L} .'-]{2,60}$/u.test(text) && !/^(all|unknown|global|international|not specified)$/i.test(text) ? text : "";
  }
  function create(storage, now = Date.now) {
    function read() {
      try {
        const data = JSON.parse(storage.getItem(KEY) || "null");
        if (data?.enabled !== true) return { enabled: false, views: [] };
        const views = (Array.isArray(data.views) ? data.views : []).filter(v => v && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(v.slug) && v.slug.length <= 160 && games.has(v.game) && region(v.region) && Number.isFinite(v.at) && v.at <= now() && v.at > now() - TTL).slice(0, 80).map(v => ({ slug: v.slug, game: v.game, region: region(v.region), at: v.at }));
        return { enabled: true, views };
      } catch { return { enabled: false, views: [] }; }
    }
    function save(data) { try { storage.setItem(KEY, JSON.stringify(data)); return true; } catch { return false; } }
    function enable(value) {
      if (value) return save({ enabled: true, views: read().views });
      try { storage.removeItem(KEY); return true; } catch { return false; }
    }
    function record(server) {
      const data = read(), slug = server?.slug, game = server?.platform_id, area = region(server?.region);
      if (!data.enabled || !games.has(game) || !area || typeof slug !== "string" || slug.length > 160 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) return false;
      if (data.views.some(v => v.slug === slug && now() - v.at < 30 * 60 * 1000)) return false;
      data.views.unshift({ slug, game, region: area, at: now() }); data.views = data.views.slice(0, 80);
      return save(data);
    }
    function preferred(game) {
      const views = read().views.filter(v => !game || v.game === game);
      if (views.length < 3) return "";
      const scores = new Map();
      views.forEach(v => scores.set(v.region, (scores.get(v.region) || 0) + Math.pow(0.5, (now() - v.at) / (7 * 86400000))));
      return [...scores].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] || "";
    }
    function rank(servers, filters = {}) {
      if ((filters.sort && filters.sort !== "recommended") || filters.query || (filters.region && filters.region !== "all")) return [...servers];
      const area = preferred(filters.platform === "all" ? undefined : filters.platform);
      return area ? servers.map((server, index) => ({ server, index })).sort((a, b) => Number(region(b.server.region) === area) - Number(region(a.server.region) === area) || a.index - b.index).map(row => row.server) : [...servers];
    }
    return { read, enable, record, preferred, rank, clear: () => read().enabled ? save({ enabled: true, views: [] }) : enable(false), prune: () => { const data = read(); if (data.enabled) save(data); } };
  }
  globalThis.BrowseRPRecommendationModel = { create, region, key: KEY };
  if (typeof document === "undefined" || location.pathname.startsWith("/staffpanel")) return;
  let storage;
  try { storage = localStorage; } catch { storage = { getItem: () => null, setItem: () => { throw Error("Storage unavailable"); }, removeItem: () => {} }; }
  const model = create(storage); model.prune();
  window.BrowseRPRecommendations = model;
  const el = (tag, className, text) => { const item = document.createElement(tag); item.className = className; if (text) item.textContent = text; return item; };
  let section, results, message, request = 0, controller;
  const routeGame = /^\/games\/(fivem|redm|roblox|minecraft)$/.exec(location.pathname)?.[1];
  function changed() { window.dispatchEvent(new Event("browserp:recommendations-changed")); }
  function controls(root) {
    if (root.dataset.recommendationMounted) return;
    root.dataset.recommendationMounted = "true";
    const heading = el("h3", "", "Your discovery preferences");
    const copy = el("p", "", "Use the servers you view on BrowseRP to suggest communities in regions you enjoy. Optional, stored only in this browser for up to 30 days. Never your activity on other websites.");
    const label = el("label", "recommendation-toggle");
    const input = document.createElement("input"); input.type = "checkbox"; input.checked = model.read().enabled;
    label.append(input, el("span", "", "Personalise with my BrowseRP history"));
    const clear = el("button", "button-v3 button-secondary-v3", "Clear recommendation history"); clear.type = "button";
    const status = el("p", "recommendation-status"); status.setAttribute("role", "status");
    input.addEventListener("change", () => { const okay = model.enable(input.checked); input.checked = model.read().enabled; status.textContent = okay ? input.checked ? "Personalisation is on for this browser." : "Personalisation is off and its history has been cleared." : "Your browser could not save this preference."; changed(); });
    clear.addEventListener("click", () => { status.textContent = model.clear() ? "Recommendation history cleared." : "Your browser could not clear this history."; changed(); });
    root.classList.add("recommendation-settings"); root.replaceChildren(heading, copy, label, clear, status);
    window.addEventListener("browserp:recommendations-changed", () => { input.checked = model.read().enabled; clear.disabled = !model.read().views.length; });
    clear.disabled = !model.read().views.length;
  }
  model.mountSettings = root => root?.querySelectorAll("[data-recommendation-settings]").forEach(controls);
  async function refresh() {
    if (!section) return;
    const id = ++request; controller?.abort(); results.replaceChildren(); results.hidden = true;
    const enabled = model.read().enabled;
    const area = model.preferred(routeGame);
    section.querySelector("[data-enable-recommendations]").hidden = enabled;
    section.querySelector("[data-reset-recommendations]").hidden = !enabled;
    message.textContent = !enabled ? "Discover more communities in the regions you enjoy. Turn on optional, browser-only recommendations." : !area ? "As you explore a few server pages, communities from your favourite regions will appear here." : `More ${area} communities, based on the servers you viewed on BrowseRP.`;
    if (!enabled || !area) return;
    controller = new AbortController();
    const currentController = controller;
    const timeout = setTimeout(() => currentController.abort(), 10000);
    try {
      const params = new URLSearchParams({ region: area, sort: "recommended", limit: "3", ...(routeGame ? { platform: routeGame } : {}) });
      const response = await fetch(`/api/servers?${params}`, { credentials: "same-origin", signal: controller.signal });
      if (!response.ok) throw Error("Unavailable");
      const data = await response.json();
      if (id !== request || !model.read().enabled) return;
      const servers = (Array.isArray(data.servers) ? data.servers : []).filter(server => region(server.region) === area && (!routeGame || server.platform_id === routeGame)).slice(0, 3);
      window.BrowseRPDirectory?.render(results, servers); results.hidden = !servers.length;
      results.querySelectorAll(".reveal-v3").forEach(card => card.classList.add("is-revealed"));
      if (!servers.length) message.textContent = `No published ${area} communities are available right now. Your usual directory is unchanged.`;
    } catch { if (id === request) message.textContent = "Recommendations are taking a moment. You can still browse the full directory below."; }
    finally { clearTimeout(timeout); }
  }
  function init() {
    document.querySelectorAll("[data-recommendation-settings]").forEach(controls);
    const page = document.body.dataset.page;
    const anchor = page === "home" ? document.querySelector("#featured-server-list")?.closest("section") : document.querySelector("#discovery-controls, #game-discovery-controls");
    if (!anchor || (location.pathname.startsWith("/games/") && !routeGame)) return;
    section = el("section", "recommendations-v7"); section.setAttribute("aria-label", "Personalised discovery");
    const inner = el("div", page === "home" ? "shell-v3" : "");
    const head = el("div", "recommendation-heading"); const copy = el("div", "");
    copy.append(el("span", "eyebrow-v3", "Your discovery"), el("h2", "", "For you"));
    message = el("p", "recommendation-message"); copy.append(message);
    const actions = el("div", "recommendation-actions");
    const enable = el("button", "button-v3 button-secondary-v3", "Enable recommendations"); enable.type = "button"; enable.dataset.enableRecommendations = "";
    enable.addEventListener("click", () => { if (model.enable(true)) changed(); else message.textContent = "Your browser could not save this preference. Recommendations remain off."; });
    const reset = el("button", "button-v3 button-quiet-v3", "Turn off & clear"); reset.type = "button"; reset.dataset.resetRecommendations = "";
    reset.addEventListener("click", () => { if (model.enable(false)) changed(); else message.textContent = "Your browser could not clear this preference. Please clear BrowseRP site data in browser settings."; });
    actions.append(enable, reset); head.append(copy, actions);
    results = el("div", "recommendation-results"); results.hidden = true; inner.append(head, results); section.append(inner); anchor.before(section);
    refresh();
  }
  window.addEventListener("browserp:recommendations-changed", refresh);
  window.addEventListener("storage", event => { if (event.key === KEY || event.key === null) changed(); });
  document.addEventListener("DOMContentLoaded", init, { once: true });
})();
