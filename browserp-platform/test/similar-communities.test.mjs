import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import handler from "../api/servers.js";
import { readSimilarCommunities, selectSimilarCommunities } from "../lib/similar-communities.js";

const current = { id: "current", slug: "current-rp", name: "Current RP", platform_id: "fivem", platform_name: "FiveM", language: "English", region: "United Kingdom", access_type: "allowlisted", tags: ["police", "economy"], status: "published", age_rating: "teen" };
const server = (slug, values = {}) => ({ id: slug, slug, name: slug.split("-").map(word => word[0].toUpperCase() + word.slice(1)).join(" "), platform_id: "fivem", platform_name: "FiveM", language: "English", region: "United Kingdom", access_type: "allowlisted", tags: ["police"], status: "published", age_rating: "teen", description: `${slug} is a synthetic roleplay community fixture.`, ...values });
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

test("similar communities exclude self, unsafe and weak matches while preferring the same game", () => {
  const candidates = [
    current,
    server("same-id", { id: current.id }),
    server("adult", { age_rating: "adult" }),
    server("draft", { status: "draft" }),
    server("disabled", { enabled: false }),
    server("unsupported", { platform_id: "gta6" }),
    server("wrong-language", { language: "French" }),
    server("weak", { region: "United States", access_type: "public", tags: ["drifting"] }),
    server("same-game-region", { access_type: "public", tags: ["drifting"] }),
    server("same-game-access", { region: "United States", tags: ["drifting"] }),
    server("cross-game-strong", { platform_id: "redm", platform_name: "RedM", tags: ["police"] }),
    server("cross-game-weak", { platform_id: "minecraft", platform_name: "Minecraft", region: "United States", access_type: "public", tags: ["police"] })
  ];
  assert.deepEqual(selectSimilarCommunities(current, candidates).map(item => item.slug), ["same-game-region", "same-game-access", "cross-game-strong"]);
  assert.equal(selectSimilarCommunities({ ...current, language: "Unknown" }, candidates).length, 0);
});

test("the reader uses only two bounded public directory calls and caps output at three", async () => {
  const calls = [];
  const candidates = [server("one"), server("two"), server("three"), server("four")];
  const result = await readSimilarCommunities(current.slug, { rpcImpl: async (name, args) => {
    calls.push({ name, args });
    return args.p_slug ? [current] : candidates;
  } });
  assert.equal(result.length, 3);
  assert.deepEqual(calls.map(call => [call.name, call.args.p_slug, call.args.p_limit]), [
    ["search_server_directory", current.slug, 1], ["search_server_directory", null, 60]
  ]);
  assert.ok(calls.every(call => call.args.p_platform === "all" && call.args.p_query === "" && call.args.p_online === false));
  await assert.rejects(readSimilarCommunities("../private", { rpcImpl: async () => { throw new Error("must not run"); } }), error => error.status === 400);
});

test("the public API keeps directory limits and never forwards a visitor cookie", async t => {
  const previous = { ...process.env }, originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key]; Object.assign(process.env, previous); });
  Object.assign(process.env, { NODE_ENV: "test", VERCEL: "0", APP_URL: "http://localhost:8080", SUPABASE_URL: "https://fixture.supabase.co", SUPABASE_PUBLISHABLE_KEY: "sb_publishable_fixture", SUPABASE_SECRET_KEY: "sb_secret_fixture", PRIVACY_HASH_SECRET: "fixture-secret" });
  const calls = [];
  globalThis.fetch = async (url, options = {}) => {
    const path = new URL(url).pathname, body = options.body ? JSON.parse(options.body) : {};
    calls.push({ path, body, options });
    if (!path.endsWith("/rpc/search_server_directory")) throw new Error(`Unexpected request ${path}`);
    return json(body.p_slug ? [current] : [server("one"), server("two"), server("three"), server("four")]);
  };
  let payload; const headers = new Map();
  const response = { setHeader: (name, value) => headers.set(name, value), end: value => { payload = JSON.parse(value); } };
  await handler({ method: "GET", url: `/api/servers?similar=${current.slug}`, headers: { cookie: "brp_access=private-cookie" }, socket: { remoteAddress: "127.0.0.1" } }, response);
  assert.equal(response.statusCode, 200);
  assert.deepEqual(payload.servers.map(item => item.slug), ["four", "one", "three"]);
  assert.deepEqual(calls.map(call => call.body.p_limit), [1, 60]);
  assert.ok(calls.every(call => call.options.headers.Authorization === undefined && !JSON.stringify(call.options.headers).includes("private-cookie")));
  assert.match(headers.get("Cache-Control"), /s-maxage=60/);
});

function page() {
  return readFileSync(new URL("../public/server.html", import.meta.url), "utf8");
}
function script(name) {
  return readFileSync(new URL(`../public/${name}`, import.meta.url), "utf8");
}
const settle = async () => { for (let index = 0; index < 8; index += 1) await new Promise(resolve => setImmediate(resolve)); };

test("the listing UI has useful empty and recoverable error states without showing the current listing", async t => {
  const dom = new JSDOM(page(), { url: "https://www.browserp.com/server/current-rp", runScripts: "outside-only", pretendToBeVisual: true });
  const { window } = dom; t.after(() => window.close());
  window.document.querySelector("#server-detail-v3").dataset.platform = "fivem";
  let fail = false; const requests = [];
  window.fetch = async (url, options) => {
    requests.push({ url: String(url), options });
    if (fail) return json({}, 503);
    return json({ servers: [current] });
  };
  window.eval(script("browserp-platforms.js"));
  window.eval(script("similar-communities.js"));
  await settle();
  const section = window.document.querySelector("#similar-communities-v1"), state = section.querySelector("[data-similar-state]");
  assert.equal(section.hidden, false); assert.equal(section.dataset.state, "empty"); assert.match(state.textContent, /No close matches yet/);
  assert.equal(section.querySelector("[data-similar-list]").children.length, 0);
  assert.equal(section.querySelector("[data-similar-browse]").getAttribute("href"), "/servers?platform=fivem");
  assert.equal(requests[0].options.credentials, "same-origin"); assert.equal(requests[0].url, "/api/servers?similar=current-rp");
  fail = true; section.querySelector("[data-similar-retry]").click(); await settle();
  assert.equal(section.dataset.state, "error"); assert.match(state.textContent, /temporarily unavailable/); assert.equal(section.querySelector("[data-similar-retry]").hidden, false);
});
