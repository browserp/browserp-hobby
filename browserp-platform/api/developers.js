import { endpoint } from "../lib/api.js";
import { developmentCatalogAllowed } from "../lib/config.js";
import { publicJson } from "../lib/http.js";
import { rest } from "../lib/supabase.js";

const fallback = Object.freeze([]);

export default endpoint("GET", async (_req, res) => {
  try {
    const developers = await rest("developer_directory?select=*&order=verified.desc,created_at.desc&limit=50");
    return publicJson(res, { developers: Array.isArray(developers) ? developers : [] }, 60);
  } catch (error) {
    if (!developmentCatalogAllowed()) throw error;
    return publicJson(res, { developers: fallback }, 60);
  }
});
