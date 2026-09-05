import { sanitizePlainText } from "./moderation.js";
const bad = message => Object.assign(new Error(message), { status: 400 });
export function canonicalRobloxUrl(value, kind = "experience") {
  const raw = String(value || "").trim();
  if (!raw && kind === "community") return null;
  let url;
  try { url = new URL(raw); } catch { throw bad("Use the public Roblox experience or community page link."); }
  const pattern = kind === "experience" ? /^\/games\/([1-9][0-9]{0,19})(?:\/[A-Za-z0-9_-]+)?\/?$/ : /^\/(?:groups|communities)\/([1-9][0-9]{0,19})(?:\/[A-Za-z0-9_-]+)?\/?$/;
  const match = url.pathname.match(pattern);
  if (raw.length > 300 || !/^https:\/\/(?:www\.)?roblox\.com\//i.test(raw) || raw.includes("?") || raw.includes("\\") || url.protocol !== "https:" || !["roblox.com", "www.roblox.com"].includes(url.hostname)
      || url.port || url.username || url.password || url.search || url.hash || raw.includes("#") || !match) {
    throw bad("Use the public Roblox page link without tracking, share codes or private-server access links.");
  }
  return `https://www.roblox.com/${kind === "experience" ? "games" : "communities"}/${match[1]}`;
}
export function robloxApplication(value, platform, framework, communityUrl) {
  if (platform !== "roblox") {
    if (value != null) throw bad("Roblox details belong only to Roblox applications.");
    return null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)
      || Object.keys(value).some(key => !["kind", "experienceUrl", "communityGroupUrl", "joiningInstructions", "applicantRole", "authorityEvidence"].includes(key))) throw bad("Complete the Roblox application details.");
  if (!["independent_community", "creator_experience"].includes(value.kind)) throw bad("Choose what you are listing on Roblox.");
  const fields = {};
  for (const [key, min, max, label] of [["joiningInstructions", 40, 1500, "Joining instructions"], ["applicantRole", 2, 120, "Your role"], ["authorityEvidence", 40, 2000, "Evidence of community control"]]) {
    if (typeof value[key] !== "string" || value[key].trim().length > max) throw bad(`${label} must be between ${min} and ${max} characters.`);
    fields[key] = sanitizePlainText(value[key], max);
    if (fields[key].length < min) throw bad(`${label} must be between ${min} and ${max} characters.`);
  }
  if (framework.length < 2 || !communityUrl || /^https:\/\/(?:www\.)?cfx\.re\//i.test(communityUrl)) throw bad("Add the Roblox experience name and your community's public joining destination.");
  return { kind: value.kind, experienceUrl: canonicalRobloxUrl(value.experienceUrl), communityGroupUrl: canonicalRobloxUrl(value.communityGroupUrl, "community"), ...fields };
}
