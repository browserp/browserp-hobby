import { rpc } from "./supabase.js";
// Community activity is not the total across every instance of a Roblox experience.
export async function enrichRobloxApplications(servers) {
  const applications = servers.filter(server => server.platform_id === "roblox");
  if (!applications.length) return servers;
  const details = await rpc("public_roblox_listing_details", { p_server_ids: applications.map(server => server.id) });
  const byId = new Map((Array.isArray(details) ? details : []).map(item => [item.id, item.roblox]));
  return servers.map(server => server.platform_id !== "roblox" ? server : {
    ...server, applicationOnly: true, imported: false, online: false, players: null,
    capacity: null, max_players: null, checked_at: null, uptime: null, uptime_percent: null,
    roblox: publicRobloxDetails(byId.get(server.id))
  });
}
export function publicRobloxDetails(value) {
  if (!value || typeof value !== "object" || !["independent_community", "creator_experience"].includes(value.kind)
      || !/^https:\/\/www\.roblox\.com\/games\/[1-9][0-9]{0,19}$/.test(value.experienceUrl || "")) return null;
  return { kind: value.kind, experienceUrl: value.experienceUrl,
    communityGroupUrl: /^https:\/\/www\.roblox\.com\/communities\/[1-9][0-9]{0,19}$/.test(value.communityGroupUrl || "") ? value.communityGroupUrl : null,
    joiningInstructions: typeof value.joiningInstructions === "string" ? value.joiningInstructions.slice(0, 1500) : "" };
}
