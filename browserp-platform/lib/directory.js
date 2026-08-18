import { calculateDiscoveryScore, sortServers } from "./ranking.js";

export function normalizeServer(server) {
  const normalized = {
    ...server,
    tags: Array.isArray(server.tags) ? server.tags : [],
    players: Number(server.players || 0),
    capacity: Number(server.capacity || 0),
    quality_score: Number(server.quality_score || 0),
    engagement_score: Number(server.engagement_score || 0),
    uptime_percent: Number(server.uptime_percent || 0),
    boost_score: Number(server.boost_score || 0),
    online: Boolean(server.online),
    verified: Boolean(server.verified),
    beginner_friendly: Boolean(server.beginner_friendly)
  };
  normalized.discovery_score = Number(calculateDiscoveryScore(normalized).toFixed(2));
  return normalized;
}

export function filterServers(items, filters = {}) {
  let results = items.map(normalizeServer);
  const query = String(filters.query || "").trim().toLocaleLowerCase();
  if (query) {
    results = results.filter((server) => [
      server.name, server.description, server.platform_name, server.region,
      server.language, server.framework, ...(server.tags || [])
    ].join(" ").toLocaleLowerCase().includes(query));
  }
  if (filters.platform && filters.platform !== "all") results = results.filter((server) => server.platform_id === filters.platform);
  if (filters.region && filters.region !== "all") results = results.filter((server) => server.region === filters.region);
  if (String(filters.online) === "true") results = results.filter((server) => server.online);
  if (String(filters.verified) === "true") results = results.filter((server) => server.verified);
  if (String(filters.beginner) === "true") results = results.filter((server) => server.beginner_friendly);
  const limit = Math.min(Math.max(Number(filters.limit) || 30, 1), 100);
  return sortServers(results, filters.sort).slice(0, limit);
}
