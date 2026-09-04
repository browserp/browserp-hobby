import { isIP } from "node:net";
import { assessContent } from "./moderation.js";

// These endpoints are used by the official https://servers.fivem.net client.
// The source is a self-reported directory snapshot, not proof of ownership or accuracy.
const API = "https://frontend.cfx-services.net/api/servers";
const FEATURED = "https://gss.cfx-services.net/v1/public/featured-servers/fivem";
const MAX_BODY = 1_048_576;
const STALE_AFTER_MS = 5 * 60_000;
const IMAGE_HOSTS = new Set(["cdn.discordapp.com", "media.discordapp.net", "i.imgur.com", "i.postimg.cc", "res.cloudinary.com"]);
const SECRET_KEY = /(?:password|secret|token|license|webhook|credential|rcon|api.?key|steam.?key)/i;
const URL_PATTERN = /(?:https?:\/\/|(?:www\.)?(?:discord\.gg\/|discord(?:app)?\.com\/invite\/|cfx\.re\/join\/))[^\s<>"'`|,;]+/gi;
const plain = (value, max = 500) => typeof value === "string" ? value.normalize("NFKC").replace(/\^[0-9]/g, "").replace(/<[^>]*>/g, "").replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "";
const object = (value) => value && typeof value === "object" && !Array.isArray(value);
const timestamp = (value) => typeof value === "string" && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null;
const unique = (values) => [...new Set(values)];

export class FiveMImportError extends Error {
  constructor(code, message, status = 502) { super(message); this.name = "FiveMImportError"; this.code = code; this.status = status; }
}

export function parseFiveMJoinCode(input) {
  if (typeof input !== "string" || input.length > 160) throw new FiveMImportError("invalid_join_code", "Enter a FiveM join code or a cfx.re/join link.", 400);
  const value = input.trim();
  if (/^[a-z0-9]{6,12}$/i.test(value)) return value.toLowerCase();
  let url;
  try { url = new URL(/^cfx\.re\//i.test(value) ? `https://${value}` : value); } catch { /* rejected below */ }
  if (url && url.protocol === "https:" && url.hostname === "cfx.re" && !url.username && !url.password && !url.port && !url.search && !url.hash && /^\/join\/[a-z0-9]{6,12}\/?$/i.test(url.pathname)) return url.pathname.split("/")[2].toLowerCase();
  throw new FiveMImportError("invalid_join_code", "Use a 6–12 character FiveM join code or an HTTPS cfx.re/join link.", 400);
}

function safeUrl(value) {
  if (typeof value !== "string" || value.length > 1_000 || /[\s\\\u0000-\u001f]/.test(value)) return null;
  try {
    const url = new URL(/^(?:www\.)?(?:discord\.gg|discord(?:app)?\.com|cfx\.re)\//i.test(value) ? `https://${value.replace(/^www\./i, "")}` : value);
    const host = url.hostname.toLowerCase();
    if (url.protocol !== "https:" || url.username || url.password || url.port || isIP(host.replace(/^\[|\]$/g, "")) || !host.includes(".") || /(?:^|\.)(?:localhost|local|internal|test|invalid)$/.test(host)) return null;
    url.hash = "";
    return url;
  } catch { return null; }
}

function classifyUrl(value) {
  const url = safeUrl(value);
  if (!url) return null;
  const host = url.hostname.replace(/^www\./, "");
  const invite = host === "discord.gg" ? url.pathname.match(/^\/([a-z0-9_-]{2,100})\/?$/i) : ["discord.com", "discordapp.com"].includes(host) ? url.pathname.match(/^\/invite\/([a-z0-9_-]{2,100})\/?$/i) : null;
  if (invite) return { type: "discord", url: `https://discord.gg/${invite[1]}` };
  if (host === "cfx.re") {
    try { const code = parseFiveMJoinCode(`${url.origin}${url.pathname}`); return { type: "join", url: `https://cfx.re/join/${code}`, joinCode: code }; } catch { return null; }
  }
  if (!IMAGE_HOSTS.has(host) && /(?:^|\.)discord(?:app)?\.(?:com|gg|gift)$/.test(host)) return null;
  const image = /\.(?:png|jpe?g|webp|gif)$/i.test(url.pathname) || host === "res.cloudinary.com" && /\/image\/upload\//.test(url.pathname);
  if (image) return { type: "image", url: url.href, trusted: IMAGE_HOSTS.has(host) };
  return { type: "website", url: url.href };
}

export function safeFiveMImageUrl(value) {
  const url = safeUrl(value);
  if (!url) return null;
  if (url.hostname === "frontend.cfx-services.net" && /^\/api\/servers\/icon\/[a-z0-9]{6,12}\/\d{1,16}\.png$/.test(url.pathname) && !url.search) return url.href;
  const result = classifyUrl(value);
  return result?.type === "image" && result.trusted ? result.url : null;
}

function fieldStrings(data, vars) {
  const fields = [{ source: "hostname", value: data.hostname }, { source: "gametype", value: data.gametype }];
  for (const [key, value] of Object.entries(vars).slice(0, 160)) {
    if (!SECRET_KEY.test(key) && typeof value === "string") fields.push({ source: `vars.${key.slice(0, 80)}`, value: value.slice(0, 4_000) });
  }
  return fields.filter((field) => typeof field.value === "string");
}

export function normalizeFiveMServer(raw, { joinCode: requested, now = new Date() } = {}) {
  if (!object(raw) || !object(raw.Data)) throw new FiveMImportError("invalid_response", "FiveM returned an invalid server record.");
  const joinCode = parseFiveMJoinCode(raw.EndPoint);
  if (requested && parseFiveMJoinCode(requested) !== joinCode) throw new FiveMImportError("mismatched_server", "FiveM returned a different server. Nothing was imported.");
  const fetchedAt = new Date(now).toISOString();
  const data = raw.Data;
  const vars = object(data.vars) ? data.vars : {};
  if (typeof vars.gamename === "string" && !["gta5", "gta5_enhanced"].includes(vars.gamename.toLowerCase())) throw new FiveMImportError("wrong_platform", "This listing is not a FiveM server.", 422);
  const evidence = [], issues = [];
  const issue = (code, field, message, severity = "warning") => { if (!issues.some((item) => item.code === code && item.field === field) && issues.length < 40) issues.push({ code, field, severity, message }); };
  const record = (field, source, value, confidence = "high") => { if (value !== null && value !== "" && evidence.length < 80) evidence.push({ field, source, value, confidence }); };
  const fields = fieldStrings(data, vars);
  const candidates = [];
  for (const field of fields) {
    for (const match of field.value.match(URL_PATTERN) || []) {
      const value = match.replace(/[).\]}!?]+$/, "");
      const link = classifyUrl(value);
      if (link && candidates.length < 80) candidates.push({ ...link, source: field.source });
      else issue("invalid_link", field.source, "An unsafe or invalid link was excluded.");
    }
  }
  const cfxJoinUrl = `https://cfx.re/join/${joinCode}`;
  record("links.cfxJoinUrl", "EndPoint", cfxJoinUrl);
  for (const entry of candidates.filter((item) => item.type === "join")) if (entry.joinCode !== joinCode) issue("different_join_link", entry.source, "A join link points to another server and was excluded.", "error");
  function choose(type, field, preferred) {
    const matches = candidates.filter((entry) => entry.type === type).sort((a, b) => Number(preferred.test(b.source)) - Number(preferred.test(a.source)));
    const urls = unique(matches.map((entry) => entry.url));
    if (urls.length > 1) { issue("conflicting_links", field, "Several different links were found. Choose the correct one during review."); return null; }
    const selected = matches[0];
    if (!selected) return null;
    record(field, selected.source, selected.url, preferred.test(selected.source) ? "high" : "medium");
    if (!preferred.test(selected.source)) issue("reclassified_link", field, "A link was classified by its destination rather than its field label.", "info");
    return selected.url;
  }
  const communityUrl = choose("discord", "links.communityUrl", /discord|community/i);
  // An unrelated link in a description is not sufficient evidence of a community website.
  const websites = candidates.filter((entry) => entry.type === "website" && /website|homepage|weburl/i.test(entry.source));
  const websiteUrls = unique(websites.map((entry) => entry.url));
  const websiteUrl = websiteUrls.length === 1 ? websiteUrls[0] : null;
  if (websiteUrl) record("links.websiteUrl", websites[0].source, websiteUrl, "medium");
  if (websiteUrls.length > 1) issue("conflicting_links", "links.websiteUrl", "Several website links were found. Choose the correct one during review.");
  for (const field of fields.filter((entry) => /discord|(?:^|[._])join(?:url|link)?$/i.test(entry.source))) {
    if (field.value.trim() && !(field.value.match(URL_PATTERN) || []).some((entry) => classifyUrl(entry.replace(/[).\]}!?]+$/, "")))) issue("mislabeled_field", field.source, "A link field contains text that is not a valid link; it was excluded.");
  }
  const withoutLinks = (value, max) => plain(typeof value === "string" ? value.replace(URL_PATTERN, " ") : "", max);
  const nameSource = withoutLinks(vars.sv_projectName, 80).length >= 3 ? "vars.sv_projectName" : "hostname";
  const name = withoutLinks(nameSource === "hostname" ? data.hostname : vars.sv_projectName, 80);
  const description = withoutLinks(vars.sv_projectDesc, 3_000);
  record("name", nameSource, name);
  record("description", "vars.sv_projectDesc", description);
  if (name.length < 3) issue("missing_name", "name", "Add a clear community name before publishing.", "error");
  if (description.length < 40) issue("short_description", "description", "Add an accurate description of at least 40 characters before publishing.");
  const tags = unique((typeof vars.tags === "string" ? vars.tags.slice(0, 4_000).split(/[,;|\n]/) : []).map((value) => value.match(URL_PATTERN) ? "" : plain(value, 40).toLowerCase().replace(/[_-]+/g, " ")).filter((value) => value.length >= 2 && /^[\p{L}\p{N}][\p{L}\p{N} .+'/-]*$/u.test(value))).slice(0, 24);
  if (typeof vars.tags === "string" && vars.tags.match(URL_PATTERN)) issue("link_removed_from_tags", "tags", "Links were removed from tags and checked separately.", "info");
  record("tags", "vars.tags", tags);
  const stopWords = new Set("the and for with from your our this that are join server community roleplay welcome into all have has its you a an to of in on is we it be us".split(" "));
  const keywords = unique([...tags, ...(plain(`${name} ${description}`, 3_100).toLowerCase().match(/[\p{L}\p{N}]{3,32}/gu) || []).filter((word) => !stopWords.has(word))]).slice(0, 30);
  let locale = null, language = null, region = null;
  if (typeof vars.locale === "string" && vars.locale.length <= 35) {
    try {
      const value = new Intl.Locale(vars.locale.replaceAll("_", "-"));
      if (value.language !== "root" && value.region !== "AQ") {
        const languages = new Intl.DisplayNames(["en"], { type: "language", fallback: "none" });
        const regions = new Intl.DisplayNames(["en"], { type: "region", fallback: "none" });
        language = languages.of(value.language) || null; region = value.region ? regions.of(value.region) || null : null;
        if (language) locale = value.baseName;
      }
    } catch { /* unconfigured locales remain unknown */ }
  }
  record("language", "vars.locale", language, "medium"); record("region", "vars.locale", region, "low");
  issue("self_reported_metadata", "metadata", "Names, descriptions and tags are self-reported. Review them before publishing.", "info");
  if (region) issue("locale_region", "region", "The suggested region comes from the language locale, not a verified server location.", "info");
  if (!language) issue("unknown_language", "language", "The listing does not provide a usable primary language.");
  const resources = Array.isArray(data.resources) ? data.resources.filter((value) => typeof value === "string").slice(0, 2_000) : [];
  const frameworks = [["qbx_core", "Qbox"], ["qb-core", "QBCore"], ["es_extended", "ESX"], ["vrp", "vRP"], ["ox_core", "Ox Core"]].filter(([resource]) => resources.some((value) => value.toLowerCase() === resource));
  let framework = frameworks.length === 1 ? frameworks[0][1] : null;
  if (framework) record("framework", `resources.${frameworks[0][0]}`, framework, "medium");
  if (frameworks.length > 1) issue("conflicting_frameworks", "framework", "Several framework resources were found. Confirm the active setup.");
  if (!framework && !frameworks.length) {
    const declared = plain(vars.framework, 80).toLowerCase();
    const known = { esx: "ESX", qbcore: "QBCore", "qb-core": "QBCore", qbox: "Qbox", vrp: "vRP", "ox core": "Ox Core" };
    framework = known[declared] || null;
    if (framework) record("framework", "vars.framework", framework, "low");
  }
  let access = String(vars.sv_appearAllowlisted).toLowerCase() === "true" ? "allowlisted" : String(vars.sv_appearAllowlisted).toLowerCase() === "false" ? "public" : null;
  const claimsRestrictedAccess = /\b(?:allowlist|whitelist)(?:ed)?\b/i.test(name) || tags.some((tag) => /^(?:allowlist|whitelist)(?:ed)?$/.test(tag));
  const claimsPublicAccess = tags.some((tag) => /^(?:public|no (?:allowlist|whitelist)|free access)$/.test(tag));
  if (access === "public" && claimsRestrictedAccess || access === "allowlisted" && claimsPublicAccess) { access = null; issue("conflicting_access", "access", "The access flag conflicts with the name or tags. Confirm whether approval is required."); }
  if (access) record("access", "vars.sv_appearAllowlisted", access, "medium");
  const imageEntries = candidates.filter((entry) => entry.type === "image");
  for (const entry of imageEntries.filter((image) => !image.trusted)) { record("images.untrusted", entry.source, entry.url, "low"); issue("untrusted_image_host", "images", "An image uses an unsupported host. Upload or replace it during review."); }
  const banners = imageEntries.filter((entry) => entry.trusted && /banner|photo|image/i.test(entry.source)).sort((a, b) => Number(/banner_detail/i.test(b.source)) - Number(/banner_detail/i.test(a.source)));
  const bannerUrl = banners[0]?.url || null;
  if (bannerUrl) record("images.bannerUrl", banners[0].source, bannerUrl, "medium");
  const logos = imageEntries.filter((entry) => entry.trusted && /logo|icon/i.test(entry.source));
  const iconVersion = Number.isSafeInteger(data.iconVersion) && data.iconVersion >= 0 ? data.iconVersion : null;
  const logoUrl = iconVersion !== null ? `${API}/icon/${joinCode}/${iconVersion}.png` : unique(logos.map((entry) => entry.url)).length === 1 ? logos[0].url : null;
  if (logoUrl) record("images.logoUrl", iconVersion !== null ? "iconVersion" : logos[0].source, logoUrl, "medium");
  for (const field of fields.filter((entry) => /banner|logo|icon/i.test(entry.source))) if (field.value && !candidates.some((entry) => entry.source === field.source && entry.type === "image")) issue("invalid_image", field.source, "An image field did not contain a supported image URL; it was excluded.");
  const lastSeen = timestamp(data.lastSeen);
  const age = lastSeen ? Date.parse(fetchedAt) - Date.parse(lastSeen) : null;
  const stale = data.fallback === true || age !== null && (age > STALE_AFTER_MS || age < -60_000);
  const count = (value) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= 2_048 ? value : null;
  let online = count(data.clients), max = count(data.svMaxclients ?? data.sv_maxclients);
  if (max === 0) max = null;
  if (online !== null && max !== null && online > max) { issue("inconsistent_players", "players", "The reported player count exceeds the reported capacity. The count was excluded."); online = null; }
  if (stale) { online = null; issue("stale_snapshot", "players", "The directory snapshot is offline, stale or has an invalid timestamp. No live count is shown."); }
  if (!lastSeen) issue("unknown_upstream_age", "players", "FiveM did not supply a last-seen time; the count is only a snapshot fetched now.");
  if (online === null && !stale) issue("unknown_players", "players", "A reliable player count was not supplied.");
  const players = { online, max, observedAt: online === null ? null : lastSeen || fetchedAt, status: data.fallback === true ? "offline" : online === null ? "unknown" : "online" };
  if (online !== null) record("players.online", "clients", online);
  if (max !== null) record("players.max", "svMaxclients", max);
  const moderation = assessContent({ name, description, tags: tags.join(", "), communityUrl, websiteUrl });
  for (const reason of moderation.reasons) issue("content_review", "content", reason, moderation.action === "reject" ? "error" : "warning");
  if (!vars.gamename) issue("missing_game_name", "platform", "The source did not explicitly identify its game. Confirm this is FiveM.");
  return { joinCode, platform: "fivem", name, description, links: { cfxJoinUrl, communityUrl, websiteUrl }, players, images: { logoUrl, bannerUrl }, tags, keywords, locale, language, region, framework, access, evidence, issues, confidence: issues.some((entry) => entry.severity === "error") ? "low" : issues.some((entry) => entry.severity === "warning") ? "medium" : "high", source: { provider: "cfx", url: `${API}/single/${joinCode}`, listingUrl: `https://servers.fivem.net/servers/detail/${joinCode}`, fetchedAt, lastSeen }, requiresReview: true };
}

async function readJson(url, { fetchImpl = globalThis.fetch, timeoutMs = 5_000, maxBytes = MAX_BODY } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.min(Math.max(timeoutMs, 1), 5_000));
  try {
    const response = await fetchImpl(url, { method: "GET", headers: { accept: "application/json", "user-agent": "BrowseRP/1.0 (+https://www.browserp.com)" }, redirect: "error", signal: controller.signal, cache: "no-store" });
    if (!response.ok) {
      await response.body?.cancel();
      const code = response.status === 404 ? "not_found" : response.status === 429 ? "upstream_rate_limited" : [401, 403].includes(response.status) ? "upstream_unavailable" : "upstream_error";
      throw new FiveMImportError(code, response.status === 404 ? "That server is not in the FiveM list. Check its join code." : response.status === 429 ? "FiveM is limiting requests. Try again later." : "The FiveM list is unavailable. No existing data was changed.", response.status === 404 ? 404 : response.status === 429 ? 429 : 502);
    }
    if (!/^application\/(?:json|[a-z0-9.+-]+\+json)(?:;|$)/i.test(response.headers.get("content-type") || "")) { await response.body?.cancel(); throw new FiveMImportError("invalid_response", "FiveM returned an unexpected response. Try again later."); }
    if (Number(response.headers.get("content-length")) > maxBytes) { await response.body?.cancel(); throw new FiveMImportError("response_too_large", "The FiveM record is too large to safely import."); }
    const reader = response.body?.getReader();
    if (!reader) throw new FiveMImportError("invalid_response", "FiveM returned an empty response.");
    const chunks = []; let size = 0;
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > maxBytes) { await reader.cancel(); throw new FiveMImportError("response_too_large", "The FiveM record is too large to safely import."); }
      chunks.push(value);
    }
    try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw new FiveMImportError("invalid_response", "FiveM returned an invalid response."); }
  } catch (error) {
    if (error instanceof FiveMImportError) throw error;
    throw new FiveMImportError(controller.signal.aborted ? "upstream_timeout" : "upstream_unavailable", controller.signal.aborted ? "FiveM took too long to respond. Try again later." : "The FiveM list could not be reached. No existing data was changed.");
  } finally { clearTimeout(timer); }
}

export async function fetchFiveMServer(input, { fetchImpl, now, timeoutMs } = {}) {
  const joinCode = parseFiveMJoinCode(input);
  const raw = await readJson(`${API}/single/${joinCode}`, { fetchImpl, timeoutMs });
  return normalizeFiveMServer(raw, { joinCode, now });
}

export async function fetchFiveMFeatured({ limit = 20, fetchImpl, timeoutMs, now = new Date() } = {}) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 20) throw new FiveMImportError("invalid_limit", "Choose between 1 and 20 featured servers.", 400);
  const raw = await readJson(FEATURED, { fetchImpl, timeoutMs, maxBytes: 262_144 });
  if (!object(raw) || !Array.isArray(raw.pinnedServers) && !Array.isArray(raw.servers)) throw new FiveMImportError("invalid_response", "FiveM returned an invalid featured list.");
  const entries = [];
  function add(code, name) { try { const joinCode = parseFiveMJoinCode(code); if (!entries.some((entry) => entry.joinCode === joinCode) && entries.length < limit) entries.push({ joinCode, name: plain(name, 80) || null, sourceUrl: FEATURED }); } catch { /* invalid source codes are not fetched */ } }
  for (const entry of (raw.servers || []).slice(0, 100)) if (object(entry)) { if (entry.hash_id) add(entry.hash_id, entry.name); for (const code of (Array.isArray(entry.hash_ids) ? entry.hash_ids : []).slice(0, 20)) add(code, entry.name); }
  for (const code of (raw.pinnedServers || []).slice(0, 100)) add(code);
  return { servers: entries, sourceUrl: FEATURED, fetchedAt: new Date(now).toISOString(), notice: "Featured FiveM servers may be freeroam, racing or PvP. Review whether each community belongs on BrowseRP." };
}
