(() => {
  "use strict";
  const VIEWS = ["summary", "members", "servers", "reports", "queue", "content", "profiles", "activity", "staff", "bans", "appeals", "security", "logs"];
  const FIELDS = ["q", "status", "platform", "region", "language", "mode", "feature", "access", "online", "verified", "beginner", "from", "to", "severity", "targetType", "userId"];
  const COMMON = ["q", "from", "to"];
  const ALLOWED = { summary: [], staff: [], members: [...COMMON, "status"], servers: [...COMMON, "status", "platform", "region", "language", "mode", "feature", "access", "online", "verified", "beginner"], reports: [...COMMON, "status", "targetType", "userId"], queue: [...COMMON, "status", "platform"], content: [...COMMON, "status"], profiles: [...COMMON, "status"], activity: [...COMMON, "userId", "status"], bans: [...COMMON, "status", "targetType", "userId"], appeals: [...COMMON, "status"], security: [...COMMON, "status", "severity", "userId"], logs: [...COMMON, "userId"] };
  const KIND = { queue: "listings", content: "queue", logs: "audit" };
  function normalize(view, input = {}) {
    const output = {};
    for (const key of ALLOWED[view] || []) {
      const value = String(input[key] ?? "").trim().slice(0, key === "q" ? 200 : 120);
      if (!value || (value === "all" && key !== "status")) continue;
      if (["online", "verified", "beginner"].includes(key)) { if (value === "true") output[key] = "true"; }
      else if (["from", "to"].includes(key)) { if (/^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(new Date(`${value}T00:00:00Z`).getTime())) output[key] = value; }
      else output[key] = value;
    }
    return output;
  }
  function parse(hash) {
    const raw = String(hash || "").replace(/^#/, ""); const index = raw.indexOf("?");
    const candidate = index < 0 ? raw : raw.slice(0, index); const view = VIEWS.includes(candidate) ? candidate : "summary";
    return { view, filters: normalize(view, Object.fromEntries(new URLSearchParams(index < 0 ? "" : raw.slice(index + 1)))) };
  }
  function serialize(view, filters = {}) { const query = new URLSearchParams(normalize(view, filters)).toString(); return `#${VIEWS.includes(view) ? view : "summary"}${query ? `?${query}` : ""}`; }
  function query(view, filters = {}, cursor) {
    const values = normalize(view, filters); const parameters = new URLSearchParams({ view: KIND[view] || view, limit: "25" });
    for (const [key, value] of Object.entries(values)) parameters.set(key, key === "from" ? `${value}T00:00:00.000Z` : key === "to" ? `${value}T23:59:59.999Z` : value);
    if (cursor) parameters.set("cursor", JSON.stringify(cursor));
    return `/api/admin/moderation?${parameters}`;
  }
  function change(view, filters, field, value) {
    const next = { ...filters, [field]: value };
    if (field === "platform" && next.platform !== filters.platform) for (const name of ["region", "mode", "feature", "access", "language", "online", "verified", "beginner"]) delete next[name];
    if (field === "region" && next.region !== filters.region) for (const name of ["mode", "feature", "access", "language", "online", "verified", "beginner"]) delete next[name];
    return normalize(view, next);
  }
  window.BrowseRPModerationFilters = Object.freeze({ VIEWS, FIELDS, parse, serialize, query, normalize, change });
})();
