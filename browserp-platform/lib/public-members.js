import { getSession, rest, rpc } from "./supabase.js";
import { safePublicStaffAvatar } from "./public-staff.js";
import { readContentAsset } from "./content-moderation.js";
import { rasterType } from "./server-media.js";

const USERNAME = /^[a-z0-9_]{3,30}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const BANNERS = new Set(["aurora", "afterglow", "midnight", "daybreak"]);
const list = value => Array.isArray(value) ? value : [];
const inIds = ids => `in.(${ids.join(",")})`;
const profileFields = "id,username,display_name,profile_visibility,approved_bio,bio_review_status,approved_avatar_url,avatar_review_status,joined_at,banner_style";
const postedServerFields = "slug,name,description,region,language,framework,access_type,platform_id,status,age_rating,verified";
export function memberProfileVisible(visibility, viewerId, targetId) {
  return visibility === "public" || visibility === "basic" || visibility === "members" && UUID.test(viewerId || "")
    || visibility === "private" && viewerId === targetId && UUID.test(targetId || "");
}

export function publicMemberView(row, badges, servers) {
  if (!row || !USERNAME.test(row.username || "") || !UUID.test(row.id || "")) return null;
  const avatarUrl = row.avatar_review_status === "approved" ? safePublicStaffAvatar(row.approved_avatar_url) : null;
  if (row.profile_visibility === "basic") return {
    username: row.username,
    avatarUrl: avatarUrl ? `/api/public/basic-profile-avatar?username=${row.username}` : null,
    visibility: "basic"
  };
  return {
    id: row.id,
    username: row.username,
    displayName: String(row.display_name || row.username).slice(0, 48),
    bio: row.bio_review_status === "approved" ? String(row.approved_bio || "").slice(0, 500) : "",
    avatarUrl,
    joinedAt: Number.isFinite(Date.parse(row.joined_at || "")) ? row.joined_at : null,
    bannerStyle: BANNERS.has(row.banner_style) ? row.banner_style : "aurora",
    visibility: row.profile_visibility,
    badges: list(badges?.badges).filter(b => typeof b?.label === "string" && typeof b?.description === "string")
      .slice(0, 12).map(b => ({ label: b.label.slice(0, 60), description: b.description.slice(0, 240), kind: String(b.kind || "").slice(0, 50) })),
    staffRole: typeof badges?.staffRole === "string" ? badges.staffRole.slice(0, 60) : "",
    servers: list(servers).filter(s => s?.status === "published" && s?.age_rating !== "adult").slice(0, 24)
  };
}

async function activeMember(req, res) {
  const session = await getSession(req, res).catch(() => null);
  if (!session?.accessToken || !session?.user?.id) return null;
  const state = await rpc("member_connection_status_v2", {}, session.accessToken).catch(() => null);
  return state?.active === true && state.userId === session.user.id && state.sessionId ? session : null;
}

export async function publicMemberByUsername(username, req, res, { restClient = rest } = {}) {
  if (!USERNAME.test(username)) return null;
  const row = list(await restClient(`profiles?select=${profileFields}&username=eq.${username}&limit=1`, { useSecret: true }))[0];
  if (!row) return null;
  if (row.profile_visibility === "basic") return publicMemberView(row);
  if (row.profile_visibility !== "public") {
    const session = await activeMember(req, res);
    if (!memberProfileVisible(row.profile_visibility, session?.user?.id, row.id)) return null;
  }
  return publicMemberContents(row);
}

export async function publicMemberContents(row, { restClient = rest, rpcClient = rpc } = {}) {
  if (row.profile_visibility === "basic") return publicMemberView(row);
  const submissions = list(await restClient(`server_submissions?select=id&submitted_by=eq.${row.id}&limit=80`, { useSecret: true }));
  const ids = submissions.map(s => s.id).filter(id => UUID.test(id));
  const [badges, servers] = await Promise.all([
    rpcClient("service_member_badges", { p_user_id: row.id }, undefined, { useSecret: true }),
    ids.length ? restClient(`servers?select=${postedServerFields}&source_submission_id=${inIds(ids)}&status=eq.published&age_rating=neq.adult&limit=24`, { useSecret: true }) : []
  ]);
  return publicMemberView(row, badges, servers);
}

// The URL and response expose only a handle. Resolve the approved picture on the
// server so submission, storage, provider and account identifiers stay out of HTML.
export async function basicMemberAvatar(username, { restClient = rest, rpcClient = rpc, assetReader = readContentAsset, fetchImpl = fetch } = {}) {
  const missing = () => Object.assign(new Error("Picture not found"), { status: 404 });
  if (!USERNAME.test(username || "")) throw missing();
  const profilePath = `profiles?select=username,profile_visibility,avatar_review_status,approved_avatar_url&username=eq.${username}&limit=1`;
  const currentProfile = async () => list(await restClient(profilePath, { useSecret: true }))[0];
  const row = await currentProfile();
  if (row?.username !== username || row.profile_visibility !== "basic" || row.avatar_review_status !== "approved") throw missing();
  const safe = safePublicStaffAvatar(row.approved_avatar_url);
  if (!safe) throw missing();
  const stillApproved = async () => {
    const current = await currentProfile();
    if (current?.username !== username || current.profile_visibility !== "basic"
      || current.avatar_review_status !== "approved" || current.approved_avatar_url !== row.approved_avatar_url) throw missing();
  };
  const url = new URL(safe);
  if (url.origin === "https://www.browserp.com" && url.pathname === "/api/public/profile-avatar") {
    const submissionId = url.searchParams.get("id");
    const args = { p_id: submissionId, p_public: true };
    const access = await rpcClient("content_avatar_access", args);
    if (!access?.assetId) throw missing();
    const image = await assetReader(submissionId, access.assetId);
    const current = await rpcClient("content_avatar_access", args);
    if (current?.assetId !== access.assetId || current?.version !== access.version) throw missing();
    await stillApproved();
    return { bytes: image.bytes, mimeType: image.mimeType };
  }
  const response = await fetchImpl(url.href, { redirect: "error", signal: AbortSignal.timeout(5000), headers: { Accept: "image/png,image/jpeg,image/webp" } });
  if (!response.ok || !response.body || Number(response.headers.get("content-length")) > 1_048_576) {
    await response.body?.cancel(); throw missing();
  }
  const chunks = []; let size = 0;
  for await (const chunk of response.body) {
    size += chunk.byteLength;
    if (size > 1_048_576) throw missing();
    chunks.push(Buffer.from(chunk));
  }
  const bytes = Buffer.concat(chunks);
  const mimeType = rasterType(bytes)?.type;
  if (!mimeType || !["image/png", "image/jpeg", "image/webp"].includes(mimeType)) throw missing();
  await stillApproved();
  return { bytes, mimeType };
}

export async function publicCreatorForServer(slug) {
  if (typeof slug !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 160) return null;
  const profile = await rpc("public_server_creator", { p_slug: slug });
  if (!profile || !USERNAME.test(profile.username || "")) return null;
  return { username: profile.username, displayName: String(profile.displayName || profile.username).slice(0, 48),
    avatarUrl: safePublicStaffAvatar(profile.avatarUrl) };
}

export { USERNAME as publicUsernamePattern, BANNERS as publicBannerStyles };
