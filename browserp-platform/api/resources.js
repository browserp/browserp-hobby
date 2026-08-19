import { endpoint } from "../lib/api.js";
import { developmentCatalogAllowed } from "../lib/config.js";
import { publicJson } from "../lib/http.js";
import { rest } from "../lib/supabase.js";

const fallback = [
  { id: "demo-resource-1", title: "Server launch checklist", summary: "A structured pre-launch review for roleplay communities.", type: "guide", platform_name: "All platforms", version: "1.0", tags: ["Operations", "Safety"] },
  { id: "demo-resource-2", title: "Accessible rules template", summary: "A plain-language community rules structure with escalation guidance.", type: "template", platform_name: "All platforms", version: "1.0", tags: ["Moderation", "Accessibility"] }
];

export default endpoint("GET", async (_req, res) => {
  try {
    const resources = await rest("resource_directory?select=*&order=featured.desc,created_at.desc&limit=50");
    return publicJson(res, { resources: Array.isArray(resources) ? resources : [] }, 60);
  } catch (error) {
    if (!developmentCatalogAllowed()) throw error;
    return publicJson(res, { resources: fallback }, 60);
  }
});
