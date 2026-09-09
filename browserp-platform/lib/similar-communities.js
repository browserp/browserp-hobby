import { rpc } from "./supabase.js";

const ENABLED_GAMES = new Set(["fivem", "redm", "minecraft", "roblox"]);
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const EMPTY_VALUES = /^(?:all|any|global|international|unknown|not confirmed|not specified)$/i;

function text(value) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ").toLocaleLowerCase("en-GB") : "";
}

function meaningful(value) {
  const result = text(value);
  return result && !EMPTY_VALUES.test(result) ? result : "";
}

function tags(value) {
  return new Set((Array.isArray(value) ? value : []).map(meaningful).filter(Boolean));
}

function publicCandidate(candidate) {
  const platform = text(candidate?.platform_id);
  return candidate && typeof candidate === "object"
    && SLUG.test(String(candidate.slug || ""))
    && meaningful(candidate.name)
    && ENABLED_GAMES.has(platform)
    && candidate.enabled !== false
    && (candidate.status === undefined || candidate.status === "published")
    && meaningful(candidate.age_rating) !== "adult";
}

export function selectSimilarCommunities(current, candidates, limit = 3) {
  if (!publicCandidate(current) || !Array.isArray(candidates)) return [];
  const currentLanguage = meaningful(current.language);
  if (!currentLanguage) return [];
  const currentPlatform = text(current.platform_id);
  const currentRegion = meaningful(current.region);
  const currentAccess = meaningful(current.access_type);
  const currentTags = tags(current.tags);
  const seen = new Set([String(current.slug)]);
  const rows = [];

  for (const candidate of candidates) {
    if (!publicCandidate(candidate) || seen.has(String(candidate.slug))
      || candidate.id && current.id && candidate.id === current.id
      || meaningful(candidate.language) !== currentLanguage) continue;

    const candidateTags = tags(candidate.tags);
    const overlap = [...candidateTags].filter(tag => currentTags.has(tag)).length;
    const sameGame = text(candidate.platform_id) === currentPlatform;
    const sameRegion = Boolean(currentRegion && meaningful(candidate.region) === currentRegion);
    const sameAccess = Boolean(currentAccess && meaningful(candidate.access_type) === currentAccess);
    const secondary = Number(sameRegion) + Number(sameAccess) + Number(overlap > 0);
    if (secondary < (sameGame ? 1 : 2)) continue;
    seen.add(String(candidate.slug));
    rows.push({ candidate, sameGame, sameRegion, sameAccess, overlap });
  }

  const count = Number.isSafeInteger(limit) ? Math.min(Math.max(limit, 0), 3) : 3;
  return rows.sort((a, b) => Number(b.sameGame) - Number(a.sameGame)
    || Number(b.sameRegion) - Number(a.sameRegion)
    || Number(b.sameAccess) - Number(a.sameAccess)
    || b.overlap - a.overlap
    || String(a.candidate.name).localeCompare(String(b.candidate.name), "en-GB")
    || String(a.candidate.slug).localeCompare(String(b.candidate.slug), "en-GB"))
    .slice(0, count).map(row => row.candidate);
}

export async function readSimilarCommunities(slug, { rpcImpl = rpc } = {}) {
  if (!SLUG.test(String(slug || ""))) throw Object.assign(new Error("Choose a valid server listing."), { status: 400 });
  const currentRows = await rpcImpl("search_server_directory", {
    p_slug: slug, p_query: "", p_platform: "all", p_region: "all", p_online: false,
    p_verified: false, p_beginner: false, p_sort: "recommended", p_limit: 1
  });
  const current = Array.isArray(currentRows) ? currentRows.find(server => server?.slug === slug) : null;
  if (!current || !ENABLED_GAMES.has(text(current.platform_id))) return [];
  const candidates = await rpcImpl("search_server_directory", {
    p_slug: null, p_query: "", p_platform: "all", p_region: "all", p_online: false,
    p_verified: false, p_beginner: false, p_sort: "recommended", p_limit: 60
  });
  if (!Array.isArray(candidates)) throw new Error("Invalid public directory response");
  return selectSimilarCommunities(current, candidates, 3);
}
