(() => {
  "use strict";
  const games = { fivem: "FiveM", redm: "RedM", roblox: "Roblox", minecraft: "Minecraft" };
  const defaults = { query: "", platform: "all", region: "all", mode: "all", feature: "all", access: "all", language: "all", online: false, verified: false, beginner: false, sort: "recommended", offset: 0, limit: 24 };
  const fields = { platform: "platform_id", region: "region", mode: "framework", feature: "tags", access: "access_type", language: "language", online: "online", verified: "verified", beginner: "beginner_friendly" };
  const labels = { platform: "Game", region: "Region", mode: "Game mode", feature: "Features", access: "How to join", language: "Language", online: "Online now", verified: "Owner verified", beginner: "Beginner friendly" };
  const accessNames = { public: "Open to everyone", allowlisted: "Approval required", application: "Application required", whitelisted: "Approval required" };
  const normal = value => String(value || "").toLowerCase().replace(/[-_]/g, " ").replace(/\s+/g, " ").trim();
  const display = (key, value) => key === "platform" ? games[value] || value : key === "access" ? accessNames[value] || value : String(value).replace(/[-_]/g, " ").replace(/^./, letter => letter.toUpperCase());
  function normalize(input = {}) {
    const result = { ...defaults };
    result.query = String(input.query || input.q || "").trim().slice(0, 120);
    result.platform = Object.hasOwn(games, input.platform) ? input.platform : "all";
    for (const key of ["region", "mode", "feature", "access", "language"]) result[key] = String(input[key] || "all").trim().slice(0, 80) || "all";
    for (const key of ["online", "verified", "beginner"]) result[key] = input[key] === true || input[key] === "true";
    result.sort = ["recommended", "players", "newest", "trending", "uptime"].includes(input.sort) ? input.sort : "recommended";
    result.offset = Math.min(1000000, Math.max(0, Math.floor(Number(input.offset) || 0)));
    result.limit = Math.min(100, Math.max(1, Math.floor(Number(input.limit) || 24)));
    return result;
  }
  function matches(server, raw, omit = []) {
    const filters = normalize(raw);
    if (!Object.hasOwn(games, server.platform_id)) return false;
    const text = normal([server.name, server.description, server.platform_name, server.region, server.language, server.framework, ...(server.tags || [])].join(" "));
    if (filters.query && !normal(filters.query).split(" ").every(word => text.includes(word))) return false;
    return Object.entries(fields).every(([key, field]) => {
      if (omit.includes(key) || filters[key] === "all" || filters[key] === false) return true;
      if (typeof filters[key] === "boolean") return Boolean(server[field]);
      return (Array.isArray(server[field]) ? server[field] : [server[field]]).some(value => normal(value) === normal(filters[key]));
    });
  }
  function facetOmissions(key) {
    return key === "platform" ? Object.keys(fields) : key === "region" ? Object.keys(fields).filter(field => field !== "platform") : [key];
  }
  function facets(servers, raw) {
    const result = {};
    for (const [key, field] of Object.entries(fields)) {
      const counts = new Map();
      for (const server of servers.filter(server => matches(server, raw, facetOmissions(key)))) {
        const values = typeof defaults[key] === "boolean" ? (server[field] ? ["true"] : []) : Array.isArray(server[field]) ? server[field] : [server[field]];
        for (const value of new Set(values.filter(Boolean))) counts.set(String(value), (counts.get(String(value)) || 0) + 1);
      }
      result[key] = [...counts].map(([value, count]) => ({ value, count })).sort((a, b) => a.value.localeCompare(b.value));
    }
    return result;
  }
  function mergeFacets(left, right) {
    const result = {};
    for (const key of Object.keys(fields)) {
      const counts = new Map();
      for (const item of [...(left?.[key] || []), ...(right?.[key] || [])]) counts.set(item.value, (counts.get(item.value) || 0) + Number(item.count));
      result[key] = [...counts].map(([value, count]) => ({ value, count })).sort((a, b) => a.value.localeCompare(b.value));
    }
    return result;
  }
  const showcase = { slug: "san-andreas-county-roleplay-showcase", showcase_url: "/server/san-andreas-county-roleplay-showcase", name: "San Andreas County Roleplay", platform_id: "fivem", platform_name: "FiveM", region: "United States", framework: "vMenu", language: "English", access_type: "public", verified: true, beginner_friendly: true, online: false, logo_url: "/assets/san-andreas-county-rp-mark-v4.svg", description: "A complete BrowseRP showcase for a public-safety focused county community, with departments, civilian careers and structured roleplay.", tags: ["Public safety", "Civilian life", "Custom vehicles"], showcase: true };
  function params(filters) {
    const result = new URLSearchParams();
    for (const [key, value] of Object.entries(normalize(filters))) if (value !== defaults[key]) result.set(key === "query" ? "q" : key, String(value));
    return result;
  }
  globalThis.BrowseRPDiscovery = Object.freeze({ games, defaults, fields, labels, normalize, normal, display, matches, facets, mergeFacets, showcase, params });
})();
