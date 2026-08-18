import { endpoint } from "../lib/api.js";
import { publicJson } from "../lib/http.js";
import { rest } from "../lib/supabase.js";

const fallback = [
  { id: "demo-developer-1", display_name: "Northlight Studio", headline: "Accessible UI and community tooling", verified: true, specialties: ["Web UI", "Discord", "FiveM"] },
  { id: "demo-developer-2", display_name: "Waypoint Systems", headline: "Configuration and server operations", verified: false, specialties: ["Infrastructure", "RedM", "Documentation"] }
];

export default endpoint("GET", async (_req, res) => {
  try {
    const developers = await rest("developer_directory?select=*&order=verified.desc,created_at.desc&limit=50");
    return publicJson(res, { developers }, 60);
  } catch (error) {
    if (error.code !== "BACKEND_NOT_CONFIGURED" && error.status !== 404) console.warn("Developer fallback:", error.message);
    return publicJson(res, { developers: fallback }, 60);
  }
});
