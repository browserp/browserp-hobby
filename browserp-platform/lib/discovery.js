import "../public/discovery-model.js";
import { rpc } from "./supabase.js";
import { developmentCatalogAllowed } from "./config.js";
import { servers as fallbackServers } from "./catalog.js";
import { sortServers } from "./ranking.js";
const model = globalThis.BrowseRPDiscovery;

export function localDiscovery(items, input) {
  const filters = model.normalize(input);
  const matches = sortServers(items.filter(server => model.matches(server, filters)), filters.sort);
  return { servers: matches.slice(filters.offset, filters.offset + filters.limit), total: matches.length, facets: model.facets(items, filters) };
}

export async function discoverServers(input) {
  const filters = model.normalize(input);
  let result;
  try { result = await rpc("search_public_directory", { p_filters: filters }); }
  catch (error) {
    if (!developmentCatalogAllowed()) throw error;
    result = localDiscovery(fallbackServers, filters);
  }
  return {
    servers: result.servers || [],
    total: Number(result.total || 0),
    facets: result.facets || {},
    nextOffset: filters.offset + filters.limit < Number(result.total || 0) ? filters.offset + filters.limit : null
  };
}
