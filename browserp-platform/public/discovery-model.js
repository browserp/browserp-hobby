(() => {
  "use strict";
  const games = { fivem: "FiveM", redm: "RedM", roblox: "Roblox", minecraft: "Minecraft" };
  const defaults = { query: "", platform: "all", region: "all", mode: "all", feature: "all", access: "all", language: "all", online: false, verified: false, beginner: false, sort: "recommended", offset: 0, limit: 24 };
  const fields = { platform: "platform_id", region: "region", mode: "framework", feature: "tags", access: "access_type", language: "language", online: "online", verified: "verified", beginner: "beginner_friendly" };
  const labels = { platform: "Game", region: "Region", mode: "Game mode", feature: "Features", access: "How to join", language: "Language", online: "Online now", verified: "Owner verified", beginner: "Beginner friendly" };
  const accessNames = { public: "Open to everyone", allowlisted: "Approval required", application: "Application required", whitelisted: "Approval required", unknown: "Not confirmed" };
  const normal = value => String(value || "").toLowerCase().replace(/[-_]/g, " ").replace(/\s+/g, " ").trim();
  const taxonomy = {
    fivem: { modeLabel: "Framework", modeAny: "Any framework", modes: [
      ["vmenu", "vMenu", "v menu"], ["esx", "ESX", "es extended"], ["qbcore", "QBCore", "qb core", "qb"], ["qbox", "Qbox", "qbx", "qbx core"], ["vrp", "vRP", "v rp"], ["ox core", "Ox Core", "oxcore"], ["standalone", "Standalone", "stand alone"]
    ], features: [
      ["serious rp", "Serious RP", "serious roleplay", "seriousrp", "seriousroleplay"], ["semi serious rp", "Semi-serious RP", "semi serious roleplay", "semiserious", "semi serious"], ["custom cars", "Custom cars", "custom vehicles", "customcars", "customvehicles"], ["economy", "Economy", "economy rp"], ["police rp", "Police RP", "law enforcement", "leo", "police roleplay"], ["ems", "EMS", "medical rp", "emergency medical services"], ["civilian life", "Civilian life", "civilian rp"], ["player owned businesses", "Player-owned businesses", "player businesses", "playerownedbusinesses"], ["housing", "Housing", "player housing"], ["custom maps", "Custom maps", "custom interiors", "mlo", "mlos"], ["racing", "Racing"], ["public safety", "Public safety"]
    ] },
    redm: { modeLabel: "Framework", modeAny: "Any framework", modes: [
      ["vorp", "VORP", "vorp core"], ["redem rp", "RedEM:RP", "redem", "redemrp", "redem:rp"], ["rsg", "RSG", "rsg core", "rsgcore"], ["qbr", "QBR", "qbr core"], ["standalone", "Standalone", "stand alone"]
    ], features: [
      ["serious rp", "Serious RP", "serious roleplay", "seriousrp", "seriousroleplay"], ["semi serious rp", "Semi-serious RP", "semi serious roleplay", "semi serious"], ["outlaw rp", "Outlaw RP", "outlaws", "outlaw roleplay"], ["lawmen", "Lawmen", "lawman", "sheriff", "law enforcement"], ["ranching", "Ranching", "ranches"], ["horses", "Horses", "horse training", "horse breeding"], ["hunting", "Hunting"], ["crafting", "Crafting"], ["economy", "Economy"], ["player owned businesses", "Player-owned businesses", "player businesses"], ["frontier life", "Frontier life", "western rp", "western roleplay"], ["housing", "Housing", "homesteads"]
    ] },
    minecraft: { modeLabel: "Game mode", modeAny: "Any game mode", modes: [
      ["survival", "Survival"], ["smp", "SMP", "survival multiplayer"], ["towny", "Towny"], ["skyblock", "Skyblock", "sky block"], ["factions", "Factions", "faction"], ["creative", "Creative"], ["roleplay", "Roleplay", "rp"], ["pixelmon", "Pixelmon"], ["prison", "Prison"], ["hardcore", "Hardcore"]
    ], features: [
      ["java", "Java Edition", "java edition"], ["bedrock", "Bedrock Edition", "bedrock edition"], ["crossplay", "Crossplay", "cross play", "java bedrock", "java and bedrock"], ["modded", "Modded", "mods", "modpack"], ["vanilla", "Vanilla"], ["economy", "Economy"], ["land claims", "Land claims", "land claiming", "claims", "grief prevention"], ["pve", "PvE", "player versus environment"], ["pvp", "PvP", "player versus player"], ["quests", "Quests", "questing"], ["custom worlds", "Custom worlds", "custom world"], ["voice chat", "Voice chat", "proximity chat"]
    ] },
    roblox: { modeLabel: "Experience style", modeAny: "Any experience style", modes: [
      ["city rp", "City RP", "city roleplay", "town rp", "town roleplay"], ["emergency rp", "Emergency services RP", "emergency services", "emergency roleplay", "police rp", "police roleplay"], ["military rp", "Military RP", "military roleplay"], ["school rp", "School RP", "school roleplay"], ["fantasy rp", "Fantasy RP", "fantasy roleplay"], ["family rp", "Family RP", "family roleplay"], ["animal rp", "Animal RP", "animal roleplay"], ["hangout", "Social hangout", "social", "social hangout"]
    ], features: [
      ["private servers", "Private servers", "private server"], ["public servers", "Public servers", "public server"], ["voice chat", "Voice chat", "vc"], ["custom avatars", "Custom avatars", "custom avatar"], ["vehicles", "Vehicles", "driving"], ["housing", "Housing", "houses"], ["jobs", "Jobs", "careers"], ["events", "Community events", "community events"], ["mobile friendly", "Mobile friendly", "mobile"], ["controller support", "Controller support", "console support"]
    ] }
  };
  const accessAliases = { whitelisted: "allowlisted", whitelist: "allowlisted", allowlist: "allowlisted", open: "public", "open access": "public", "application required": "application" };
  const entries = (key, platform) => key === "mode" ? taxonomy[platform]?.modes || [] : key === "feature" ? taxonomy[platform]?.features || [] : [];
  function canonical(key, value, platform = "all") {
    const normalized = normal(value);
    if (key === "access") return accessAliases[normalized] || normalized;
    const available = platform === "all" ? Object.keys(games).flatMap(game => entries(key, game)) : entries(key, platform);
    const entry = available.find(row => row.some(alias => normal(alias) === normalized));
    return entry ? entry[0] : normalized;
  }
  function display(key, value, platform = "all") {
    if (key === "platform") return games[value] || value;
    if (key === "access") return accessNames[canonical(key, value, platform)] || value;
    const keyValue = canonical(key, value, platform);
    const available = platform === "all" ? Object.keys(games).flatMap(game => entries(key, game)) : entries(key, platform);
    return available.find(row => row[0] === keyValue)?.[1] || String(value).replace(/[-_]/g, " ").replace(/\b\p{L}/gu, letter => letter.toUpperCase());
  }
  const label = (key, platform = "all") => key === "mode" ? taxonomy[platform]?.modeLabel || "Framework or game mode" : labels[key];
  function values(server, key) {
    const field = fields[key], platform = server.platform_id;
    let result = Array.isArray(server[field]) ? server[field] : [server[field]];
    if (key === "mode") {
      const known = new Set(entries(key, platform).map(row => row[0]));
      const tagModes = (server.tags || []).map(value => canonical(key, value, platform)).filter(value => known.has(value));
      if (["minecraft", "roblox"].includes(platform) || !server.framework) result = [...result, ...tagModes];
    }
    return [...new Set(result.filter(value => value !== undefined && value !== null && value !== "").map(value => typeof value === "boolean" ? String(value) : canonical(key, value, platform)))];
  }
  function normalize(input = {}) {
    const result = { ...defaults };
    result.query = String(input.query || input.q || "").trim().slice(0, 120);
    const platform = normal(input.platform);
    result.platform = Object.hasOwn(games, platform) ? platform : "all";
    for (const key of ["region", "mode", "feature", "access", "language"]) {
      const value = String(input[key] || "all").trim().slice(0, 80) || "all";
      result[key] = ["mode", "feature", "access"].includes(key) && value !== "all" ? canonical(key, value, result.platform) : value;
    }
    for (const key of ["online", "verified", "beginner"]) result[key] = input[key] === true || input[key] === "true";
    result.sort = ["recommended", "players", "newest", "trending", "uptime"].includes(input.sort) ? input.sort : "recommended";
    result.offset = Math.min(1000000, Math.max(0, Math.floor(Number(input.offset) || 0)));
    result.limit = Math.min(100, Math.max(1, Math.floor(Number(input.limit) || 24)));
    return result;
  }
  function searchText(server) {
    const aliases = ["mode", "feature"].flatMap(key => values(server, key).flatMap(value => entries(key, server.platform_id).find(row => row[0] === value) || [value]));
    return normal([server.name, server.description, server.platform_name, server.region, server.language, server.framework, ...(server.tags || []), ...(server.keywords || []), ...aliases].join(" "));
  }
  function matches(server, raw, omit = []) {
    const filters = normalize(raw);
    if (!Object.hasOwn(games, server.platform_id)) return false;
    const text = searchText(server);
    if (filters.query && !normal(filters.query).split(" ").every(word => text.includes(word))) return false;
    return Object.keys(fields).every(key => {
      if (omit.includes(key) || filters[key] === "all" || filters[key] === false) return true;
      if (typeof filters[key] === "boolean") return Boolean(server[fields[key]]);
      return values(server, key).includes(canonical(key, filters[key], server.platform_id));
    });
  }
  function facetOmissions(key) {
    return key === "platform" ? Object.keys(fields) : key === "region" ? Object.keys(fields).filter(field => field !== "platform") : [key];
  }
  function facetValue(key, value) { return ["region", "language"].includes(key) ? display(key, value) : value; }
  function sortOptions(rows, key, platform) { return rows.sort((a, b) => b.count - a.count || display(key, a.value, platform).localeCompare(display(key, b.value, platform))); }
  function facets(servers, raw) {
    const result = {};
    for (const key of Object.keys(fields)) {
      const counts = new Map();
      for (const server of servers.filter(server => !server.showcase && matches(server, raw, facetOmissions(key)))) {
        for (const value of values(server, key).filter(value => typeof defaults[key] !== "boolean" || value === "true")) counts.set(value, (counts.get(value) || 0) + 1);
      }
      result[key] = sortOptions([...counts].map(([value, count]) => ({ value: facetValue(key, value), count })), key, normalize(raw).platform);
    }
    return result;
  }
  function mergeFacets(left, right) {
    const result = {};
    for (const key of Object.keys(fields)) {
      const counts = new Map();
      for (const item of [...(left?.[key] || []), ...(right?.[key] || [])]) {
        const value = canonical(key, item.value); counts.set(value, (counts.get(value) || 0) + Number(item.count));
      }
      result[key] = sortOptions([...counts].map(([value, count]) => ({ value: facetValue(key, value), count })), key, "all");
    }
    return result;
  }
  function options(key, facets, filters) {
    const counts = new Map();
    for (const row of facets[key] || []) {
      const value = ["mode", "feature", "access"].includes(key) ? canonical(key, row.value, filters.platform) : row.value;
      counts.set(value, (counts.get(value) || 0) + Number(row.count));
    }
    const known = key === "platform" ? Object.keys(games) : entries(key, filters.platform).map(row => row[0]);
    for (const value of known) if (!counts.has(value)) counts.set(value, 0);
    const current = filters[key];
    if (current !== "all" && !counts.has(current)) counts.set(current, 0);
    return sortOptions([...counts].map(([value, count]) => ({ value, count })), key, filters.platform);
  }
  function params(filters) {
    const result = new URLSearchParams();
    for (const [key, value] of Object.entries(normalize(filters))) if (value !== defaults[key]) result.set(key === "query" ? "q" : key, String(value));
    return result;
  }
  globalThis.BrowseRPDiscovery = Object.freeze({ games, defaults, fields, labels, taxonomy, entries, canonical, label, options, normalize, normal, display, values, searchText, matches, facets, mergeFacets, params });
})();
