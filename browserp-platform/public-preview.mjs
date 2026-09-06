import { createServer } from "node:http";
import { pathToFileURL } from "node:url";
import { createBrowseRPServer } from "./dev-server.mjs";
import { createPublicPageHandler, handlesPublicPage } from "./lib/public-pages.js";

const ORIGIN = "https://www.browserp.com";
const PUBLIC_READS = new Set([
  "/api/servers", "/api/platforms", "/api/categories", "/api/public/overview",
  "/api/public/content", "/api/public/adverts", "/api/public/blogs",
  "/api/public/announcements", "/api/public/server-image"
]);

export function createPublicPreviewHandler({ fetchPublic = fetch, localHandler = createBrowseRPServer().listeners("request")[0] } = {}) {
  async function published(path) {
    const url = new URL(path, ORIGIN);
    if (url.origin !== ORIGIN || !PUBLIC_READS.has(url.pathname)) throw new Error("Not a public preview endpoint");
    // Never inherit browser headers, cookies, credentials, request bodies or redirects.
    const response = await fetchPublic(url.href, {
      method: "GET", headers: { Accept: "application/json" }, credentials: "omit",
      redirect: "error", signal: AbortSignal.timeout(15_000)
    });
    if (!response.ok) throw Object.assign(new Error("Published public data is unavailable. Try again shortly."), { status: response.status >= 400 && response.status <= 599 ? response.status : 502 });
    return response;
  }
  async function json(path) { return (await published(path)).json(); }
  const publicPage = createPublicPageHandler({ data: {
    async directory(filters) {
      const params = globalThis.BrowseRPDiscovery.params(filters);
      params.set("discover", "true");
      if (params.has("q")) { params.set("query", params.get("q")); params.delete("q"); }
      return json(`/api/servers?${params}`);
    },
    async server(slug) {
      const data = await json(`/api/servers?${new URLSearchParams({ slug })}`);
      if (!Array.isArray(data.servers)) throw new Error("Invalid published listing response");
      const server = data.servers.find(item => item.slug === slug);
      if (!server) return null;
      const connect = data.engagement?.cfxJoinUrl || "";
      return { server: { ...server, access_type: data.engagement?.accessType || server.access_type }, connect: /^https:\/\/cfx\.re\/join\/[a-z0-9]{6,12}\/?$/i.test(connect) ? connect : "" };
    },
    async posts(slug) {
      let data;
      try { data = await json(`/api/public/blogs${slug ? `?${new URLSearchParams({ slug })}` : ""}`); }
      catch (error) { if (slug && error.status === 404) return null; throw error; }
      if (slug) { if (!data.post || data.post.slug !== slug) throw new Error("Invalid published article response"); return data.post; }
      if (!Array.isArray(data.posts)) throw new Error("Invalid published journal response");
      return data.posts;
    }
  } });
  return async (req, res) => {
    // This server binds only to loopback HTTP. Keep the production CSP protections,
    // except the HTTPS upgrade which would break local assets in WebKit.
    const setHeader = res.setHeader.bind(res);
    res.setHeader = (name, value) => setHeader(name, String(name).toLowerCase() === "content-security-policy" && typeof value === "string" ? value.replace(/;?\s*upgrade-insecure-requests\b/g, "") : value);
    res.setHeader("X-Robots-Tag", "noindex, nofollow");
    const url = new URL(req.url || "/", "http://127.0.0.1");
    if (PUBLIC_READS.has(url.pathname)) {
      res.setHeader("Cache-Control", "no-store");
      res.setHeader("X-Content-Type-Options", "nosniff");
      if (req.method !== "GET") {
        res.writeHead(405, { Allow: "GET", "Content-Type": "application/json" });
        return res.end(JSON.stringify({ error: "Public preview data is read-only." }));
      }
      try {
        const response = await published(url.pathname + url.search);
        const body = Buffer.from(await response.arrayBuffer());
        res.writeHead(response.status, { "Content-Type": response.headers.get("Content-Type") || "application/octet-stream" });
        return res.end(body);
      } catch (error) {
        res.writeHead(error.status || 502, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ error: "Published public data is unavailable. Try again shortly." }));
      }
    }
    if (handlesPublicPage(url.pathname)) return publicPage(req, res);
    return localHandler(req, res);
  };
}

export function createPublicPreviewServer(options) { return createServer(createPublicPreviewHandler(options)); }

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (process.env.NODE_ENV === "production" || process.env.VERCEL) throw new Error("Public preview is for local development only.");
  const port = Number(process.env.PORT || 8082);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Choose a valid local PORT.");
  createPublicPreviewServer().listen(port, "127.0.0.1", () => {
    console.log(`BrowseRP public preview: http://127.0.0.1:${port}`);
    console.log("Local code with anonymous published data from https://www.browserp.com; private routes are local only.");
  });
}
