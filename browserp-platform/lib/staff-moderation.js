const recordKinds = new Set(["members", "servers", "reports", "activity", "audit", "security", "bans", "appeals", "profiles", "listings", "queue"]);
const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
const plainObject = (value) => value && typeof value === "object" && !Array.isArray(value);

export function moderationQuery(params) {
  const kind = params.get("view") || "summary";
  if (kind !== "summary" && !recordKinds.has(kind)) fail("Choose a valid moderation section.");
  const filters = {};
  for (const key of ["q", "status", "platform", "region", "mode", "feature", "access", "language", "severity", "userId", "targetId", "targetType"]) {
    const value = params.get(key);
    if (value === null || value === "") continue;
    if (value.length > (key === "q" ? 200 : 128) || /[\u0000-\u001f\u007f]/.test(value)) fail("The search or filter is too long.");
    filters[key] = value.trim();
  }
  for (const key of ["online", "verified", "beginner"]) {
    const value = params.get(key);
    if (value === null || value === "") continue;
    if (!["true", "false"].includes(value)) fail("Choose a valid search filter.");
    filters[key] = value === "true";
  }
  for (const key of ["from", "to"]) {
    const value = params.get(key);
    if (!value) continue;
    if (value.length > 40 || !/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(value) || !Number.isFinite(Date.parse(value))) fail("Choose valid history dates.");
    filters[key] = new Date(key === "to" && /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T23:59:59.999Z` : value).toISOString();
  }
  if (filters.from && filters.to && filters.from > filters.to) fail("The end date must follow the start date.");
  const limit = params.has("limit") ? Number(params.get("limit")) : 25;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) fail("Choose between 1 and 100 records per page.");
  let cursor = null;
  const raw = params.get("cursor");
  if (raw) {
    if (raw.length > 300) fail("This page link is invalid. Start the search again.");
    try { cursor = JSON.parse(raw); } catch { fail("This page link is invalid. Start the search again."); }
    if (!plainObject(cursor) || Object.keys(cursor).some((key) => !["createdAt", "id"].includes(key)) || typeof cursor.createdAt !== "string" || !Number.isFinite(Date.parse(cursor.createdAt)) || !/^(?:[0-9]{1,20}|[0-9a-f-]{36})$/i.test(String(cursor.id || ""))) fail("This page link is invalid. Start the search again.");
  }
  return { kind, filters, cursor, limit };
}

export function moderationMutation(body) {
  if (!plainObject(body)) fail("Provide a valid moderation change.");
  const kind = String(body.kind || "").trim().toLowerCase();
  const action = String(body.action || "").trim().toLowerCase();
  if (!["member", "server", "report"].includes(kind) || !(kind === "report" ? ["delete", "restore"] : ["edit"]).includes(action)) fail("Choose a valid moderation action.");
  const id = String(body.id || "").trim().toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id)) fail("Choose a valid record.");
  const expectedVersion = Number(body.expectedVersion);
  if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1) fail("Reload this record before saving.", 409);
  const reason = String(body.reason || "").trim().replace(/\s+/g, " ");
  if (reason.length < 5 || reason.length > 500 || /[\u0000-\u001f\u007f<>]/.test(reason)) fail("Add a plain-text reason of 5–500 characters.");
  const data = body.data ?? {};
  if (!plainObject(data) || Object.keys(data).length > 30 || JSON.stringify(data).length > 30000) fail("The moderation change is too large.");
  return { kind, action, id, expectedVersion, reason, data };
}
