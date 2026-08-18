const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

/**
 * Organic quality remains the largest part of discovery. Boost influence is
 * deliberately capped so promotion cannot buy the entire ranking.
 */
export function calculateDiscoveryScore(server) {
  const playerActivity = clamp(server.players / Math.max(server.capacity, 1), 0, 1) * 100;
  const verified = server.verified ? 100 : 0;
  const boost = clamp(server.boost_score, 0, 100);

  return (
    server.quality_score * 0.28 +
    server.engagement_score * 0.22 +
    server.uptime_percent * 0.18 +
    playerActivity * 0.18 +
    verified * 0.08 +
    boost * 0.06
  );
}

export function sortServers(servers, sort = "recommended") {
  const copy = [...servers];
  const sorters = {
    recommended: (a, b) => calculateDiscoveryScore(b) - calculateDiscoveryScore(a),
    players: (a, b) => b.players - a.players,
    newest: (a, b) => new Date(b.created_at) - new Date(a.created_at),
    trending: (a, b) => b.engagement_score - a.engagement_score,
    uptime: (a, b) => b.uptime_percent - a.uptime_percent,
    boosted: (a, b) => b.boost_score - a.boost_score
  };

  return copy.sort(sorters[sort] || sorters.recommended);
}
