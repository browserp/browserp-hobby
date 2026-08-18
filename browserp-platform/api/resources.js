import { endpoint, ok } from "../lib/api.js";
import { rest } from "../lib/supabase.js";

const fallback = [
  { id: "demo-resource-1", title: "Community launch checklist", slug: "community-launch-checklist", summary: "A practical, safety-first checklist for opening a roleplay community.", resource_type: "guide", platform_name: "All platforms", downloads: 0 },
  { id: "demo-resource-2", title: "Accessible rules template", slug: "accessible-rules-template", summary: "A clear starting structure for community expectations and appeals.", resource_type: "template", platform_name: "All platforms", downloads: 0 }
];

export default endpoint("GET", async (_req, res) => {
  try {
    const resources = await rest("resource_directory?select=*&order=published_at.desc&limit=50");
    return ok(res, { resources });
  } catch (error) {
    if (error.code !== "BACKEND_NOT_CONFIGURED" && error.status !== 404) console.warn("Resource fallback:", error.message);
    return ok(res, { resources: fallback });
  }
});
