import { endpoint } from "../lib/api.js";
import { developmentCatalogAllowed } from "../lib/config.js";
import { publicJson } from "../lib/http.js";
import { publicStaffRoster } from "../lib/public-staff.js";
import { rest } from "../lib/supabase.js";

const fallback = Object.freeze([]);

function requestedView(req) {
  try {
    return new URL(req.url || "/api/resources", "https://browserp.invalid").searchParams.get("view") || "resources";
  } catch {
    return "resources";
  }
}

export default endpoint("GET", async (req, res) => {
  const view = requestedView(req);
  if (view === "staff") {
    try {
      return publicJson(res, { staff: await publicStaffRoster() }, 15);
    } catch (error) {
      if (!developmentCatalogAllowed()) throw error;
      return publicJson(res, { staff: fallback }, 30);
    }
  }
  if (view !== "resources") {
    throw Object.assign(new Error("Choose a valid public directory view."), { status: 400 });
  }
  try {
    const resources = await rest("resource_directory?select=*&order=published_at.desc&limit=50");
    return publicJson(res, { resources: Array.isArray(resources) ? resources : [] }, 60);
  } catch (error) {
    if (!developmentCatalogAllowed()) throw error;
    return publicJson(res, { resources: fallback }, 60);
  }
});
