import { rest, rpc } from "./supabase.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ROLE_KEY = /^[a-z0-9_]{2,40}$/;
const CONTROL = /[\u0000-\u001f\u007f]/;
const PROFILE_MEDIA_ORIGIN = "https://kywabzfgjoqiznnxygbq.supabase.co";

function boundedText(value, minimum, maximum) {
  const text = typeof value === "string" ? value.trim() : "";
  return text.length >= minimum && text.length <= maximum && !CONTROL.test(text) ? text : "";
}

function isoTimestamp(value) {
  if (typeof value !== "string" || value.length > 64 || !Number.isFinite(Date.parse(value))) return null;
  return new Date(value).toISOString();
}

export function safePublicStaffAvatar(value) {
  if (typeof value !== "string" || value.length > 800) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
    if (url.hostname === "cdn.discordapp.com" && /^\/avatars\/[0-9]{17,20}\/[A-Za-z0-9_-]+\.(?:png|jpe?g|webp|gif)$/i.test(url.pathname)) return url.href;
    if (url.hostname === "lh3.googleusercontent.com" && url.pathname.startsWith("/")) return url.href;
    if (url.origin === PROFILE_MEDIA_ORIGIN && /^\/storage\/v1\/object\/public\/profile-media\/[0-9a-f-]{36}\/[A-Za-z0-9._-]+\.png$/i.test(url.pathname)) return url.href;
  } catch {
    // Invalid or unreviewed avatar locations never become public roster media.
  }
  return null;
}

export function publicStaffView(memberships, roles, profiles, presence = []) {
  if (!Array.isArray(memberships) || !Array.isArray(roles) || !Array.isArray(profiles) || !Array.isArray(presence)) {
    throw Object.assign(new Error("The staff roster could not be loaded."), { status: 503 });
  }

  const roleByKey = new Map(roles.flatMap((role) => {
    const key = ROLE_KEY.test(String(role?.key || "")) ? String(role.key) : "";
    const name = boundedText(role?.name, 2, 80);
    const rank = Number(role?.rank);
    return key && name && Number.isSafeInteger(rank) && rank >= 1 && rank <= 1000 ? [[key, { name, rank }]] : [];
  }));
  const profileById = new Map(profiles.flatMap((profile) => {
    const id = UUID.test(String(profile?.id || "")) ? String(profile.id).toLowerCase() : "";
    return id ? [[id, profile]] : [];
  }));
  const onlineById = new Map(presence.flatMap((entry) => {
    const id = UUID.test(String(entry?.userId || "")) ? String(entry.userId).toLowerCase() : "";
    return id && typeof entry?.online === "boolean" ? [[id, entry.online]] : [];
  }));

  return memberships
    .filter((membership) => membership?.status === "active")
    .flatMap((membership) => {
      const userId = UUID.test(String(membership?.user_id || "")) ? String(membership.user_id).toLowerCase() : "";
      const roleKey = ROLE_KEY.test(String(membership?.role_key || "")) ? String(membership.role_key) : "";
      const role = roleByKey.get(roleKey);
      const profile = profileById.get(userId);
      const joinedAt = isoTimestamp(membership?.granted_at);
      const displayName = boundedText(profile?.display_name, 2, 48);
      if (!userId || !role || !profile || !displayName) return [];
      const avatarUrl = profile.avatar_review_status === "approved"
        ? safePublicStaffAvatar(profile.approved_avatar_url)
        : null;
      return [{ displayName, roleName: role.name, joinedAt, avatarUrl, online: onlineById.get(userId) === true, _rank: role.rank }];
    })
    .sort((left, right) => right._rank - left._rank
      || String(left.joinedAt || "").localeCompare(String(right.joinedAt || ""))
      || left.displayName.localeCompare(right.displayName, "en-GB", { sensitivity: "base" }))
    .map(({ _rank, ...staff }) => staff);
}

function inFilter(values) {
  return `in.(${values.join(",")})`;
}

export async function publicStaffRoster() {
  const memberships = await rest(
    "staff_memberships?select=user_id,role_key,status,granted_at&status=eq.active&order=granted_at.asc&limit=100",
    { useSecret: true }
  );
  if (!Array.isArray(memberships)) throw Object.assign(new Error("The staff roster could not be loaded."), { status: 503 });
  if (!memberships.length) return [];

  const userIds = [...new Set(memberships.map((row) => String(row?.user_id || "").toLowerCase()).filter((id) => UUID.test(id)))];
  const roleKeys = [...new Set(memberships.map((row) => String(row?.role_key || "")).filter((key) => ROLE_KEY.test(key)))];
  if (!userIds.length || !roleKeys.length) return [];

  const [roles, profiles, presence] = await Promise.all([
    rest(`staff_roles?select=key,name,rank&key=${inFilter(roleKeys)}&limit=100`, { useSecret: true }),
    rest(`profiles?select=id,display_name,avatar_review_status,approved_avatar_url&id=${inFilter(userIds)}&limit=100`, { useSecret: true }),
    rpc("service_public_staff_presence", {}, undefined, { useSecret: true }).catch(() => [])
  ]);
  return publicStaffView(memberships, roles, profiles, presence);
}
