import { endpoint } from "../lib/api.js";
import { developmentCatalogAllowed } from "../lib/config.js";
import { publicJson } from "../lib/http.js";
import { rest } from "../lib/supabase.js";

const fallback = Object.freeze([]);

export default endpoint("GET", async (_req, res) => {
  try {
    const resources = await rest("resource_directory?select=*&order=published_at.desc&limit=50");
    return publicJson(res, { resources: Array.isArray(resources) ? resources : [] }, 60);
  } catch (error) {
    if (!developmentCatalogAllowed()) throw error;
    return publicJson(res, { resources: fallback }, 60);
  }
});
