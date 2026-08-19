export const platforms = [
  { id: "fivem", name: "FiveM", short_name: "5M", accent: "#d2519a" },
  { id: "redm", name: "RedM", short_name: "RM", accent: "#b76a3a" },
  { id: "minecraft", name: "Minecraft", short_name: "MC", accent: "#57d7a2" },
  { id: "roblox", name: "Roblox", short_name: "RB", accent: "#6bd5ed" },
  { id: "forza", name: "Forza", short_name: "FZ", accent: "#8d73ff" },
  { id: "gmod", name: "Garry's Mod", short_name: "GM", accent: "#5e9bea" },
  { id: "arma", name: "ARMA", short_name: "AR", accent: "#86a977" },
  { id: "vrchat", name: "VRChat", short_name: "VR", accent: "#54b7ff" },
  { id: "dayz", name: "DayZ", short_name: "DZ", accent: "#87937b" },
  { id: "project-zomboid", name: "Project Zomboid", short_name: "PZ", accent: "#9d92a0" },
  { id: "ets2", name: "Euro Truck Simulator 2", short_name: "ETS2", accent: "#f1bd6b" },
  { id: "assetto-corsa", name: "Assetto Corsa", short_name: "AC", accent: "#e37272" },
  { id: "beamng", name: "BeamNG.drive", short_name: "BNG", accent: "#ee9f55" },
  { id: "other", name: "Other roleplay game", short_name: "RP", accent: "#929baa" }
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
