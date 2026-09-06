const pages = new Set(["overview", "moderation", "scrapers", "profiles", "accounts", "staff", "security", "content"]);

export function staffDocumentName(path) {
  let normalized;
  try { normalized = decodeURIComponent(path).replace(/\/$/, "").toLowerCase(); } catch { return null; }
  if (/^\/staffpanel(?:\.html)?$/.test(normalized)) return "staffpanel";
  const match = /^\/staffpanel[/-]([a-z]+)(?:\.html)?$/.exec(normalized);
  return match && pages.has(match[1]) ? `staffpanel-${match[1]}` : null;
}
