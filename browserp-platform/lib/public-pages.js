import { readFile } from "node:fs/promises";
import "../public/publishing-content.js";
import { rpc } from "./supabase.js";
import { developmentCatalogAllowed } from "./config.js";
import { discoverServers } from "./discovery.js";
import { enrichImportedServers } from "./fivem-workflow.js";
import { enrichMinecraftServers } from "./minecraft-workflow.js";
import { enrichRobloxApplications, publicRobloxDetails } from "./roblox-listings.js";
import { documentSecurityHeaders } from "./document-policy.js";

const ORIGIN = "https://www.browserp.com";
const model = globalThis.BrowseRPDiscovery;
const games = {
  fivem: ["FiveM", "City, emergency and economy roleplay", "Discover city communities built around characters, careers, public services and player-run economies."],
  redm: ["RedM", "Frontier and western roleplay", "Find frontier communities shaped by period stories, settlements, law, trade and life beyond the city."],
  roblox: ["Roblox", "Community-led roleplay worlds", "Discover reviewed Roblox roleplay communities, from everyday life to emergency services and fantasy. Owners apply to list their community; each listing explains how players join."],
  minecraft: ["Minecraft", "Storytelling and survival worlds", "Browse communities where building, survival, factions and long-running characters create shared stories."]
};
const upcoming = { forza: "Forza", gmod: "Garry's Mod", arma: "ARMA", vrchat: "VRChat", dayz: "DayZ", "project-zomboid": "Project Zomboid", ets2: "Euro Truck Simulator 2", "assetto-corsa": "Assetto Corsa", beamng: "BeamNG.drive", gta6: "GTA VI Roleplay", "6m": "6M" };
const gameArtwork = id => `/assets/games/${id === "6m" ? "gta6" : id}-official.${id === "roblox" ? "webp" : "jpg"}`;
const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const validSlug = value => typeof value === "string" && value.length <= 160 && slugPattern.test(value);
const text = (value, limit = 20000) => typeof value === "string" ? value.slice(0, limit) : "";
export const escapeHTML = value => String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
export const scriptJSON = value => JSON.stringify(value).replace(/[<>&\u2028\u2029]/g, char => `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`);
function safeURL(value, image = false) {
  try {
    const url = new URL(value, ORIGIN);
    if (url.protocol !== "https:" || url.username || url.password) return "";
    if (image && !(url.origin === ORIGIN || (url.hostname === "kywabzfgjoqiznnxygbq.supabase.co" && url.pathname.startsWith("/storage/v1/object/public/server-media/")) || url.hostname === "cdn.discordapp.com")) return "";
    return image && url.origin === ORIGIN ? url.pathname + url.search : url.href;
  } catch { return ""; }
}
// Copy only fields already published for visitors. Never serialize an RPC object wholesale.
export function publicServer(row) {
  if (!row || !validSlug(row.slug) || !Object.hasOwn(games, row.platform_id)) return null;
  const server = {};
  for (const key of ["name", "slug", "description", "region", "language", "framework", "access_type", "platform_id", "minecraft_address", "minecraft_edition", "count_scope", "checked_at"]) server[key] = text(row[key]);
  server.platform_name = games[row.platform_id][0];
  server.tags = Array.isArray(row.tags) ? row.tags.filter(item => typeof item === "string").slice(0, 30).map(item => item.slice(0, 80)) : [];
  for (const key of ["logo_url", "banner_url", "community_url", "website_url"]) server[key] = row[key] ? safeURL(row[key], key.endsWith("logo_url") || key === "banner_url") : "";
  server.verified = row.verified === true;
  server.applicationOnly = row.platform_id === "roblox";
  server.roblox = server.applicationOnly ? publicRobloxDetails(row.roblox) : null;
  // Initial documents deliberately avoid a live count which could go stale without JavaScript.
  server.online = false; server.players = null; server.capacity = null;
  return server;
}
function postView(row, body = false) {
  if (!row || !validSlug(row.slug)) return null;
  return { title: text(row.title, 160), slug: row.slug, excerpt: text(row.excerpt, 500), seoTitle: text(row.seoTitle, 200), seoDescription: text(row.seoDescription, 500), publishedAt: /^\d{4}-\d\d-\d\dT/.test(row.publishedAt || "") && Number.isFinite(Date.parse(row.publishedAt)) ? row.publishedAt : "", ...(body ? { body: text(row.body) } : {}) };
}
const templateCache = new Map();
async function template(name) {
  if (!templateCache.has(name)) templateCache.set(name, await readFile(new URL(`../public/${name}.html`, import.meta.url), "utf8"));
  return templateCache.get(name);
}
// The templates are trusted files, and only their named element interiors are replaced.
// Matching nested closing tags avoids swallowing neighbouring controls in compact HTML.
export function slot(html, id, content, attributes = {}) {
  const opening = new RegExp(`<([a-z][a-z0-9]*)\\b[^>]*\\bid="${id}"[^>]*>`, "i").exec(html);
  if (!opening) throw new Error(`Missing public page slot: ${id}`);
  const start = opening.index + opening[0].length;
  const tags = new RegExp(`<\\/?${opening[1]}\\b[^>]*>`, "gi"); tags.lastIndex = start;
  let depth = 1, closing;
  while ((closing = tags.exec(html))) { depth += closing[0].startsWith("</") ? -1 : 1; if (!depth) break; }
  if (!closing) throw new Error("Unclosed public page slot");
  let tag = opening[0];
  for (const [key, value] of Object.entries(attributes)) {
    tag = tag.replace(new RegExp(`\\s${key}(?:="[^"]*")?(?=[\\s>])`, "g"), "");
    if (value !== false) tag = tag.slice(0, -1) + ` ${key}="${escapeHTML(value)}">`;
  }
  return html.slice(0, opening.index) + tag + content + html.slice(closing.index);
}
function attribute(html, id, attrs) {
  const opening = new RegExp(`<([a-z][a-z0-9]*)\\b[^>]*\\bid="${id}"[^>]*>`, "i").exec(html);
  if (!opening) throw new Error(`Missing public page element: ${id}`);
  let tag = opening[0];
  for (const [key, value] of Object.entries(attrs)) {
    tag = tag.replace(new RegExp(`\\s${key}(?:="[^"]*")?(?=[\\s>])`, "g"), "");
    if (value !== false) tag = tag.slice(0, -1) + ` ${key}="${escapeHTML(value)}">`;
  }
  return html.slice(0, opening.index) + tag + html.slice(opening.index + opening[0].length);
}
function head(html, { title, description, path, noindex = false, type = "website", structured }) {
  html = html.replace(/<title>[^]*?<\/title>/i, `<title>${escapeHTML(title)}</title>`)
    .replace(/<meta\b[^>]*(?:name="(?:description|robots|twitter:title|twitter:description)"|property="(?:og:title|og:description|og:url|og:type)")[^>]*>/gi, "")
    .replace(/<link\b[^>]*rel="canonical"[^>]*>/gi, "");
  const tags = `<meta name="description" content="${escapeHTML(description)}"><meta name="robots" content="${noindex ? "noindex,follow" : "index,follow"}">${path ? `<link rel="canonical" href="${escapeHTML(ORIGIN + path)}"><meta property="og:url" content="${escapeHTML(ORIGIN + path)}">` : ""}<meta property="og:type" content="${type}"><meta property="og:title" content="${escapeHTML(title)}"><meta property="og:description" content="${escapeHTML(description)}"><meta name="twitter:title" content="${escapeHTML(title)}"><meta name="twitter:description" content="${escapeHTML(description)}">`;
  return html.replace("</head>", `${tags}${structured ? `<script type="application/ld+json">${scriptJSON(structured)}</script>` : ""}</head>`);
}
function badge(server) { return `<span class="platform-badge-v5" data-platform="${server.platform_id}"><svg aria-hidden="true"><use href="/assets/game-marks-v4.svg#mark-${server.platform_id}"></use></svg><span>${server.platform_name}</span></span>`; }
function entries(server) {
  return [["Game", server.platform_name], ["Region", server.region], ["Language", server.language], [server.platform_id === "roblox" ? "Roblox experience" : "Server setup", server.framework], ["Access", ({ public: "Open to everyone", allowlisted: "Approval required", application: "Application required", whitelisted: "Whitelisted", unknown: "Not confirmed" })[server.access_type] || server.access_type || "Not confirmed"]];
}
function metadata(server) { return `<div class="server-meta platform-meta-v5">${entries(server).filter(([, value]) => value).map(([label, value], i) => i ? `<span class="metadata-value-v5" aria-label="${escapeHTML(`${label}: ${value}`)}">${escapeHTML(value)}</span>` : badge(server)).join("")}${server.verified ? '<span class="metadata-value-v5">Owner verified</span>' : ""}</div>`; }
function facts(server) { return `<dl class="server-info-grid-v5" data-platform="${server.platform_id}">${[...entries(server), ["Player status", server.applicationOnly ? "Live player count not provided" : "Check live status on this page"]].map(([label, value], i) => `<div class="server-info-card-v5${i >= 4 ? " server-info-wide-v5" : ""}"><dt>${label}</dt><dd>${i ? escapeHTML(value || "Not specified") : badge(server)}</dd></div>`).join("")}</dl>`; }
function initials(server) { return escapeHTML(server.name.split(/\s+/).slice(0, 2).map(part => part[0]).join("").toUpperCase() || "RP"); }
function card(server) {
  const image = server.logo_url || server.banner_url;
  return `<a class="server-card" href="/server/${server.slug}" data-platform="${server.platform_id}"><div class="server-card-top"><div class="server-card-media">${image ? `<img class="server-card-media-image" src="${escapeHTML(image)}" alt="" loading="lazy" width="96" height="96">` : `<span class="server-initials">${initials(server)}</span>`}</div><span class="status">${server.applicationOnly ? "Community listing" : "Reviewed listing"}</span></div><h3>${escapeHTML(server.name)}</h3>${metadata(server)}<p class="server-description">${escapeHTML(server.description)}</p><div class="server-tags">${server.tags.slice(0, 3).map(tag => `<span>${escapeHTML(tag)}</span>`).join("")}</div><div class="server-card-bottom"><strong>${server.applicationOnly ? "Live player count not provided" : "Check live status"}</strong><span class="server-card-action">View listing</span></div></a>`;
}
function gameCard(id) { const [name, line] = games[id]; return `<a class="game-hub-card-v4 game-official-card-v6" data-platform="${id}" href="/games/${id}"><span class="game-hub-mark-v4"><img src="${gameArtwork(id)}" alt="" width="460" height="215" class="game-artwork-v5 game-card-artwork-v5 game-official-artwork-v6"></span><span class="game-hub-copy-v4"><strong>${name}</strong><small>${line}</small></span><b>Explore servers</b></a>`; }
function navGames(current) { return Object.entries(games).map(([id, [name]]) => `<a class="game-nav-chip-v4${id === current ? " is-selected" : ""}" data-platform="${id}" data-game="${id}" href="/games/${id}"${id === current ? ' aria-current="page"' : ""}><img class="game-artwork-v5 game-nav-mark-v4 game-official-artwork-v6" src="${gameArtwork(id)}" alt="" width="160" height="80">${name}</a>`).join(""); }
function pagination(path, filters, total) {
  const link = (offset, label) => { const query = model.params({ ...filters, offset }); return `<a class="button-v3 button-secondary-v3" href="${escapeHTML(path + (query.size ? `?${query}` : ""))}">${label}</a>`; };
  return `<nav data-public-pagination aria-label="Directory pages">${filters.offset ? link(Math.max(0, filters.offset - filters.limit), "Previous servers") : ""}${filters.offset + filters.limit < total ? link(filters.offset + filters.limit, "Next servers") : ""}</nav>`;
}
export function articleBody(body) { return globalThis.BrowseRPContent.articleHTML(body); }
function date(value) { return value ? new Intl.DateTimeFormat("en-GB", { dateStyle: "long", timeZone: "UTC" }).format(new Date(value)) : ""; }
function postCard(post, featured) { return `<article class="journal-card-v6${featured ? " journal-card-featured-v6" : ""}"><div class="journal-card-meta-v6"><span>${featured ? "Latest story" : "BrowseRP journal"}</span><time datetime="${escapeHTML(post.publishedAt)}">${escapeHTML(date(post.publishedAt))}</time></div><h3><a href="/blog/${post.slug}">${escapeHTML(post.title)}</a></h3><p>${escapeHTML(post.excerpt)}</p><a href="/blog/${post.slug}" class="journal-read-v6" aria-label="Read ${escapeHTML(post.title)}">Read article<span>↗</span></a></article>`; }
const notFound = () => Object.assign(new Error("Public page not found"), { status: 404, code: "PUBLIC_PAGE_NOT_FOUND" });

const source = {
  roster: discoverServers,
  async directory(filters) { const result = await discoverServers(filters); return { ...result, servers: (await enrichRobloxApplications(await enrichMinecraftServers(await enrichImportedServers(result.servers, { refresh: false }), { refresh: false }))).map(publicServer).filter(Boolean) }; },
  async server(slug) {
    let rows;
    try { rows = await rpc("search_server_directory", { p_slug: slug, p_limit: 1 }); }
    catch (error) { if (!developmentCatalogAllowed()) throw error; rows = []; }
    if (!Array.isArray(rows)) throw new Error("Invalid public listing response");
    const row = rows.find(item => item.slug === slug && Object.hasOwn(games, item.platform_id));
    if (!row) return null;
    const [enriched, engagement] = await Promise.all([enrichRobloxApplications(await enrichMinecraftServers(await enrichImportedServers([row], { refresh: false }), { refresh: false })), rpc("public_server_engagement", { p_slug: slug })]);
    const server = publicServer({ ...enriched[0], access_type: engagement?.accessType || row.access_type });
    return { server, connect: /^https:\/\/cfx\.re\/join\/[a-z0-9]{6,12}\/?$/i.test(engagement?.cfxJoinUrl || "") ? engagement.cfxJoinUrl : "" };
  },
  async posts(slug) {
    try {
      const data = await rpc(slug ? "public_blog_post" : "public_blog_index", slug ? { p_slug: slug } : {});
      if (!slug && !Array.isArray(data)) throw new Error("Invalid public article index response");
      if (slug && data !== null && (!data || typeof data !== "object" || Array.isArray(data))) throw new Error("Invalid public article response");
      return slug ? postView(data, true) : data.map(row => postView(row)).filter(Boolean);
    } catch (error) { if (!developmentCatalogAllowed()) throw error; return slug ? null : []; }
  }
};
export function publicPagePath(url) {
  if (url.pathname === "/api/router") { const path = url.searchParams.get("_path"); return typeof path === "string" && path.startsWith("/") ? path : ""; }
  return url.pathname;
}
export function handlesPublicPage(path) { return ["/servers", "/games", "/game", "/server", "/blog", "/blog-post", "/sitemap.xml"].includes(path) || /^\/(?:games|server|blog)\/[^/]+$/.test(path); }

export function createPublicPageHandler({ data = source, readTemplate = template } = {}) {
  return async function publicPage(req, res) {
    const url = new URL(req.url || "/", ORIGIN), path = publicPagePath(url);
    Object.entries(documentSecurityHeaders()).forEach(([key, value]) => res.setHeader(key, value));
    res.setHeader("Content-Type", "text/html; charset=utf-8"); res.setHeader("X-Content-Type-Options", "nosniff");
    const send = (status, body) => { res.statusCode = status; res.end(req.method === "HEAD" ? undefined : body); };
    if (!["GET", "HEAD"].includes(req.method)) { res.setHeader("Allow", "GET, HEAD"); return send(405, "Method not allowed"); }
    try {
      if (["/game", "/server", "/blog-post"].includes(path)) {
        const id = url.searchParams.get(path === "/game" ? "game" : "slug");
        if (id && !validSlug(id)) throw notFound();
        const target = path === "/game" ? `/games${id ? `/${id}` : ""}` : id ? `${path === "/server" ? "/server" : "/blog"}/${id}` : null;
        if (!target) throw notFound(); res.setHeader("Location", target); return send(308, "");
      }
      if (path === "/sitemap.xml") {
        const paths = ["/", "/servers", "/games", ...Object.keys(games).map(id => `/games/${id}`), "/about", "/blog", "/advertise", "/legal", "/privacy", "/terms"];
        const posts = await data.posts();
        let expectedTotal = null, seen = new Set();
        for (let offset = 0; offset < 10000; offset += 100) {
          // Read published data only; stable newest order and duplicate/total guards prevent a partial successful sitemap.
          const result = await (data.roster || data.directory)(model.normalize({ sort: "newest", limit: 100, offset }));
          if (!Number.isSafeInteger(result.total) || result.total < 0 || result.total > 10000 || (expectedTotal !== null && expectedTotal !== result.total)) throw new Error("Published catalogue changed during sitemap capture");
          expectedTotal = result.total;
          for (const row of result.servers) { const server = publicServer(row); if (!server || seen.has(server.slug)) throw new Error("Invalid sitemap page"); seen.add(server.slug); }
          if (offset + 100 >= expectedTotal) break;
          if (!result.servers.length) throw new Error("Incomplete sitemap page");
        }
        if (seen.size !== expectedTotal) throw new Error("Incomplete sitemap catalogue");
        paths.push(...[...seen].map(slug => `/server/${slug}`), ...posts.map(post => `/blog/${post.slug}`));
        res.setHeader("Content-Type", "application/xml; charset=utf-8");
        return send(200, `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${[...new Set(paths)].map(item => `<url><loc>${escapeHTML(ORIGIN + item)}</loc></url>`).join("")}</urlset>`);
      }
      if (path === "/servers" || path === "/games" || path.startsWith("/games/")) {
        const id = path.split("/")[2], isDirectory = path === "/servers", game = id && games[id], coming = id && upcoming[id];
        if (id && !game && !coming) throw notFound();
        let html = await readTemplate(isDirectory ? "servers" : "game");
        let title = isDirectory ? "Discover roleplay servers — BrowseRP" : "Roleplay games — BrowseRP", description = isDirectory ? "Find roleplay communities in FiveM, RedM, Roblox and Minecraft. Compare region, language, joining requirements and play style." : "Find your next community in FiveM, RedM, Roblox or Minecraft. More worlds are on the way.";
        let canonicalPath = path, noindex = Boolean(coming);
        if (!isDirectory) {
          html = slot(html, "game-page-nav-v4", navGames(id), { hidden: !id ? "" : false });
          html = slot(html, "game-hub-grid-v4", Object.keys(games).map(gameCard).join(""), { hidden: id ? "" : false });
          html = slot(html, "game-page-mark-v4", id ? `<img class="game-artwork-v5 game-page-symbol-v4 game-official-artwork-v6" src="${gameArtwork(id)}" alt="" width="460" height="215">` : '<img class="game-page-all-logo-v5" src="/assets/games/all-games-logo.png" alt="" width="140" height="140">');
          if (id) {
            title = game ? `${game[0]} roleplay servers — BrowseRP` : `${coming} — Coming soon — BrowseRP`;
            description = game ? game[2] : `${coming} discovery is coming soon to BrowseRP.`;
            if (id === "gta6" || id === "6m") description = "A future home for GTA VI roleplay discovery. Listings are not open. No PC roleplay platform or 6M launch date is confirmed; BrowseRP is not affiliated with Rockstar Games.";
            html = slot(html, "game-page-eyebrow-v4", game ? `${game[0]} roleplay` : "Coming soon");
            html = slot(html, "game-page-title-v4", game ? `Find your ${game[0]} roleplay community.` : `${escapeHTML(coming)} is coming soon.`);
            html = slot(html, "game-page-lead-v4", escapeHTML(description));
            html = html.replace('class="game-page-hero-v4"', `class="game-page-hero-v4" data-platform="${id}"`);
          }
          if (id === "roblox") html = slot(html, "game-page-actions-v4", '<a class="button-v3 button-primary-v3" href="/servers?platform=roblox">Browse Roblox communities</a><a class="button-v3 button-secondary-v3" href="/list-server?platform=roblox">Apply to list your community</a>');
          if (coming) {
            html = slot(html, "game-page-actions-v4", '<a class="button-v3 button-primary-v3" href="/games">Explore available games</a>' + (id === "gta6" || id === "6m" ? '<a class="button-v3 button-secondary-v3" href="https://www.rockstargames.com/VI" target="_blank" rel="noopener noreferrer">Official GTA VI news</a>' : ''));
            html = attribute(html, "game-upcoming-v5", { hidden: "" });
            html = attribute(html, "game-future-v6", { hidden: "" });
          }
        }
        if (isDirectory || game) {
          const filters = model.normalize({ ...Object.fromEntries(url.searchParams), ...(game ? { platform: id } : {}), limit: 24 });
          const result = await data.directory(filters);
          if (!Array.isArray(result?.servers) || !Number.isSafeInteger(result.total) || result.total < 0) throw new Error("Invalid public directory response");
          const servers = result.servers.map(publicServer).filter(Boolean);
          const count = `${result.total} ${result.total === 1 ? "server" : "servers"}`;
          html = slot(html, isDirectory ? "server-list" : "game-server-list-v4", servers.map(card).join(""), { "aria-busy": "false", "data-public-rendered": "true" });
          html = slot(html, isDirectory ? "result-count" : "game-result-count", count);
          html = attribute(html, isDirectory ? "directory-empty" : "game-server-empty-v4", { hidden: servers.length ? "" : false });
          const listID = isDirectory ? "server-list" : "game-server-list-v4";
          html = slot(html, listID, servers.map(card).join("") + pagination(path, filters, result.total), { "aria-busy": "false", "data-public-rendered": "true" });
          if (game) { html = attribute(html, "game-results-v4", { hidden: false }); html = slot(html, "game-results-title-v4", id === "roblox" ? "Roblox communities" : `${game[0]} servers`); html = slot(html, "game-results-lead-v4", `Reviewed ${game[1].toLowerCase()} listings appear below.`); html = attribute(html, "game-directory-link-v4", { href: `/servers?platform=${id}` }); }
          const clean = model.params(filters); clean.delete("platform"); clean.delete("offset");
          noindex = noindex || clean.size > 0 || (isDirectory && filters.platform !== "all");
          canonicalPath = !noindex && filters.offset ? `${path}?offset=${filters.offset}` : path;
          if (isDirectory && filters.platform !== "all" && clean.size === 0 && !filters.offset) canonicalPath = `/games/${filters.platform}`;
          if (filters.offset && !noindex) { title = `${title.replace(" — BrowseRP", "")} — Page ${Math.floor(filters.offset / 24) + 1} — BrowseRP`; }
        }
        return send(200, head(html, { title, description, path: canonicalPath, noindex }));
      }
      if (path.startsWith("/server/")) {
        const slug = path.slice(8); if (!validSlug(slug)) throw notFound();
        const result = await data.server(slug); const server = publicServer(result?.server); if (!server || server.slug !== slug) throw notFound();
        let html = await readTemplate("server");
        html = attribute(html, "server-detail-v3", { "data-platform": server.platform_id, "data-public-rendered": "true" });
        for (const [id, value] of [["server-name-v3", escapeHTML(server.name)], ["server-description-v3", escapeHTML(server.description)], ["server-platform-v3", `${server.platform_name} roleplay listing`], ["server-meta-v3", metadata(server)], ["server-info-v5", facts(server)], ["server-initials-v3", server.logo_url ? `<img class="server-import-logo-v3" src="${escapeHTML(server.logo_url)}" alt="" width="96" height="96">` : initials(server)], ["server-status-v3", server.applicationOnly ? "Live player count not provided" : "Check live status on this page"], ["server-tags-v3", server.tags.map(tag => `<span class="tag-v3">${escapeHTML(tag)}</span>`).join("")]]) html = slot(html, id, value);
        for (const [id, href] of [["server-join-v3", server.community_url], ["server-website-v3", server.website_url], ["server-connect-v3", result.connect]]) if (href && safeURL(href)) html = attribute(html, id, { href, hidden: false, rel: "noopener noreferrer" });
        if (result.connect) html = slot(html, "server-connect-v3", "Connect via Cfx");
        const joining = server.roblox ? `<section class="server-community-joining" id="server-roblox-joining"><h2>How to join</h2><p>${escapeHTML(server.roblox.joiningInstructions)}</p><a class="button-v3 button-secondary-v3" href="${escapeHTML(server.roblox.experienceUrl)}" target="_blank" rel="noopener noreferrer">View Roblox experience</a></section>` : server.minecraft_address ? `<div class="server-minecraft-address" id="server-minecraft-address"><strong>Minecraft ${server.minecraft_edition === "bedrock" ? "Bedrock" : "Java"} address</strong><code>${escapeHTML(server.minecraft_address)}</code></div>` : "";
        if (server.banner_url) html = html.replace('class="detail-banner-v3">', `class="detail-banner-v3 has-server-artwork-v3"><img class="server-import-banner-v3" src="${escapeHTML(server.banner_url)}" alt="">`);
        if (joining) html = slot(html, "server-joining-v7", joining);
        return send(200, head(html, { title: `${server.name} — ${server.platform_name} roleplay — BrowseRP`, description: `${server.name}: ${server.description}`.slice(0, 180), path, structured: { "@context": "https://schema.org", "@type": "WebPage", name: server.name, url: ORIGIN + path, description: server.description.slice(0, 500), isPartOf: { "@type": "WebSite", name: "BrowseRP", url: ORIGIN } } }));
      }
      if (path === "/blog" || path.startsWith("/blog/")) {
        const slug = path.slice(6); if (slug && !validSlug(slug)) throw notFound();
        if (!slug) {
          const posts = (await data.posts()).map(row => postView(row)).filter(Boolean);
          let html = await readTemplate("blog");
          html = slot(html, "journal-posts-v6", posts.map((post, index) => postCard(post, index === 0)).join(""), { "aria-busy": "false" });
          html = slot(html, "journal-status-v6", ""); html = slot(html, "journal-count-v6", `${posts.length} article${posts.length === 1 ? "" : "s"}`); html = attribute(html, "journal-empty-v6", { hidden: posts.length ? "" : false });
          return send(200, head(html, { title: "Roleplay guides and community news — BrowseRP", description: "BrowseRP news, community stories and practical guides to finding your next roleplay server.", path }));
        }
        const post = postView(await data.posts(slug), true); if (!post || post.slug !== slug) throw notFound();
        let html = await readTemplate("blog-post");
        for (const [id, value] of [["journal-title-v6", escapeHTML(post.title)], ["journal-excerpt-v6", escapeHTML(post.excerpt)], ["journal-date-v6", escapeHTML(date(post.publishedAt))], ["journal-reading-v6", `${Math.max(1, Math.ceil(post.body.trim().split(/\s+/).length / 220))} min read`], ["journal-status-v6", ""], ["journal-article-v6", articleBody(post.body)]]) html = slot(html, id, value);
        html = attribute(html, "journal-date-v6", { datetime: post.publishedAt }); html = attribute(html, "journal-article-v6", { "aria-busy": "false", "data-public-rendered": "true" });
        return send(200, head(html, { title: post.seoTitle || `${post.title} — BrowseRP`, description: post.seoDescription || post.excerpt, path, type: "article", structured: { "@context": "https://schema.org", "@type": "Article", headline: post.title, description: post.excerpt, url: ORIGIN + path, ...(post.publishedAt ? { datePublished: post.publishedAt } : {}), publisher: { "@type": "Organization", name: "BrowseRP", url: ORIGIN, logo: { "@type": "ImageObject", url: ORIGIN + "/browserp-mark-v3.png" } } } }));
      }
      throw notFound();
    } catch (error) {
      const missing = error.code === "PUBLIC_PAGE_NOT_FOUND";
      res.setHeader("X-Robots-Tag", "noindex, nofollow");
      if (!missing) res.setHeader("Retry-After", "60");
      let html = await readTemplate("404");
      if (!missing) html = html.replace('class="eyebrow-v3">Page not found', 'class="eyebrow-v3">Please try again').replace(/<h1>[^]*?<\/h1>/, "<h1>We couldn’t load this page.</h1>").replace(/<p>[^]*?<\/p>/, "<p>Please try again in a moment. Your account and saved choices are unchanged.</p>");
      return send(missing ? 404 : 503, head(html, { title: missing ? "Page not found — BrowseRP" : "Temporarily unavailable — BrowseRP", description: missing ? "This page is not available. Explore BrowseRP to find your next roleplay community." : "BrowseRP is temporarily unable to load this page. Please try again shortly.", path: null, noindex: true }));
    }
  };
}
export default createPublicPageHandler();
