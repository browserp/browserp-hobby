export function joaat(input) {
  let hash = 0;
  for (const character of String(input).toLowerCase()) {
    hash += character.charCodeAt(0);
    hash += hash << 10;
    hash ^= hash >>> 6;
  }
  hash += hash << 3;
  hash ^= hash >>> 11;
  hash += hash << 15;
  return hash >>> 0;
}

export function generateNames({ platform, theme, style }) {
  const starts = {
    fivem: ["Northstar", "Civic", "Harbor", "Pioneer", "Avenue"],
    redm: ["Frontier", "Ironwood", "Canyon", "Sundown", "Homestead"],
    minecraft: ["Everwild", "Stonehaven", "Aether", "Oakspire", "Embervale"],
    roblox: ["Brightside", "Metroline", "Coastview", "Beacon", "Skyline"],
    default: ["Horizon", "Waypoint", "Commonwealth", "Arcadia", "Northlight"]
  };
  const middles = {
    city: ["City", "Metro", "State", "Stories", "Collective"],
    fantasy: ["Realms", "Legends", "Chronicles", "Kingdoms", "Tales"],
    scifi: ["Outpost", "Frontier", "Nexus", "Expedition", "Horizons"],
    community: ["Community", "Stories", "Together", "Network", "Worlds"],
    default: ["Roleplay", "Stories", "Network", "Worlds", "Collective"]
  };
  const suffixes = style === "serious" ? ["Roleplay", "Stories", "Project", "Collective", "Network"] : ["RP", "Worlds", "Hub", "Stories", "Community"];
  const first = starts[platform] || starts.default;
  const second = middles[theme] || middles.default;
  return first.map((word, index) => `${word} ${second[index % second.length]}${index === 0 ? ` ${suffixes[index]}` : ""}`.replace(/\s+/g, " "));
}
