export const platforms = [
  { id: "fivem", name: "FiveM", short_name: "5M", accent: "#e16eae" }
];

// Public listings must come from the reviewed production directory. Development
// and unconfigured environments intentionally show the same truthful zero-state.
export const servers = Object.freeze([]);

export function categoriesFromServers(items = servers) {
  const counts = new Map();
  for (const server of items) for (const tag of server.tags || []) counts.set(tag, (counts.get(tag) || 0) + 1);
  return [...counts].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

export const promotionPacks = Object.freeze({
  starter: { key: "starter", name: "Starter spotlight", credits: 5, maxQuantity: 4, currency: "gbp", unitAmount: 500 },
  growth: { key: "growth", name: "Growth spotlight", credits: 15, maxQuantity: 3, currency: "gbp", unitAmount: 1200 },
  launch: { key: "launch", name: "Launch spotlight", credits: 40, maxQuantity: 2, currency: "gbp", unitAmount: 2500 }
});
