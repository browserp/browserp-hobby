(() => {
  "use strict";

  const GAMES = Object.freeze([
    { id: "fivem", name: "FiveM", line: "City, emergency and economy roleplay", description: "Discover city communities built around characters, careers, public services and player-run economies." },
    { id: "redm", name: "RedM", line: "Frontier and western roleplay", description: "Find frontier communities shaped by period stories, settlements, law, trade and life beyond the city." },
    { id: "roblox", name: "Roblox", line: "Player-built social worlds", description: "Explore original roleplay experiences ranging from everyday life to emergency services and fantasy worlds." },
    { id: "minecraft", name: "Minecraft", line: "Storytelling and survival worlds", description: "Browse communities where building, survival, factions and long-running characters create shared stories." },
    { id: "forza", name: "Forza", line: "Cruising and automotive groups", description: "Meet driving communities built around cruises, meets, clubs, photography and believable road culture." },
    { id: "gmod", name: "Garry's Mod", line: "Flexible sandbox roleplay", description: "Find established sandbox communities covering city life, serious stories and player-created game modes." },
    { id: "arma", name: "ARMA", line: "Structured simulation roleplay", description: "Explore organised simulation groups focused on teamwork, believable scenarios and persistent communities." },
    { id: "vrchat", name: "VRChat", line: "Immersive social roleplay", description: "Discover social worlds and groups built for live characters, performance, events and shared storytelling." },
    { id: "dayz", name: "DayZ", line: "Survival roleplay", description: "Find survival communities where scarcity, trust and player decisions shape persistent stories." },
    { id: "project-zomboid", name: "Project Zomboid", line: "Co-operative survival stories", description: "Browse groups combining long-form characters, settlements and difficult survival choices." },
    { id: "ets2", name: "Euro Truck Simulator 2", line: "Trucking and logistics roleplay", description: "Join virtual companies, convoys and logistics communities built around relaxed simulation." },
    { id: "assetto-corsa", name: "Assetto Corsa", line: "Track and street communities", description: "Discover automotive groups for organised drives, meets, race events and realistic car culture." },
    { id: "beamng", name: "BeamNG.drive", line: "Driving simulation roleplay", description: "Explore vehicle communities built around realistic driving, transport, emergency and open-world scenarios." }
  ]);
  const FIVEM_SHOWCASE = Object.freeze({ slug: "san-andreas-county-roleplay-showcase", showcase_url: "/server/san-andreas-county-roleplay-showcase", name: "San Andreas County Roleplay", platform_id: "fivem", platform_name: "FiveM", language: "English", region: "United States", framework: "vMenu", description: "A complete BrowseRP showcase for a public-safety focused county community.", logo_url: "/assets/san-andreas-county-rp-mark-v4.svg", showcase: true });

  const $ = (selector) => document.querySelector(selector);
  const node = (tag, className, text) => { const item = document.createElement(tag); if (className) item.className = className; if (text !== undefined) item.textContent = text; return item; };
  const icon = (id, className = "game-mark-v4") => { const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg"); svg.classList.add(className); svg.setAttribute("aria-hidden", "true"); const use = document.createElementNS("http://www.w3.org/2000/svg", "use"); use.setAttribute("href", `/assets/game-marks-v4.svg#mark-${id}`); svg.append(use); return svg; };

  function gameCard(game) {
    const link = node("a", "game-hub-card-v4"); link.href = `/games/${game.id}`; window.BrowseRPPlatforms.theme(link, game.id);
    const mark = node("span", "game-hub-mark-v4"); mark.append(icon(game.id));
    const copy = node("span", "game-hub-copy-v4"); copy.append(node("strong", "", game.name), node("small", "", game.line));
    link.append(mark, copy, node("b", "", "Explore"));
    return link;
  }

  function serverCard(server) {
    const link = node("a", "server-card"); link.href = server.showcase_url || `/server/${encodeURIComponent(server.slug || "")}`;
    window.BrowseRPPlatforms.theme(link, window.BrowseRPPlatforms.idFor(server));
    const media = node("div", "server-card-media");
    const imageUrl = String(server.logo_url || server.banner_url || "");
    if (/^https?:\/\/|^\//i.test(imageUrl)) { const image = new Image(); image.src = imageUrl; image.alt = ""; image.loading = "lazy"; image.className = "server-card-media-image"; media.append(image); }
    else media.append(node("span", "server-initials", String(server.name || "RP").split(/\s+/).slice(0,2).map((part) => part[0]).join("").toUpperCase()));
    const top = node("div", "server-card-top"); top.append(media, node("span", `status${server.online ? " online" : ""}${server.showcase ? " showcase" : ""}`, server.showcase ? "BrowseRP showcase" : server.online ? "Online now" : "Status unavailable"));
    link.append(top, node("h3", "", server.name || "Roleplay server"), window.BrowseRPPlatforms.metadata(server), node("p", "server-description", server.description || "Open the listing to learn more."));
    const bottom = node("div", "server-card-bottom"); bottom.append(node("strong", "", server.online ? `${Number(server.players || 0).toLocaleString()} players` : server.showcase ? "Complete demo listing" : "Player count unavailable"), node("span", "server-card-action", "View listing")); link.append(bottom);
    return link;
  }

  async function loadGameServers(game) {
    const list = $("#game-server-list-v4"); const empty = $("#game-server-empty-v4");
    try {
      const response = await fetch(`/api/servers?platform=${encodeURIComponent(game.id)}&sort=recommended&limit=8`, { headers: { Accept: "application/json" }, credentials: "same-origin" });
      if (!response.ok) throw new Error("Directory unavailable");
      const payload = await response.json(); const servers = [...(game.id === "fivem" ? [FIVEM_SHOWCASE] : []), ...(Array.isArray(payload.servers) ? payload.servers : [])];
      list.replaceChildren(...servers.map(serverCard)); list.hidden = servers.length === 0; empty.hidden = servers.length !== 0; list.setAttribute("aria-busy", "false");
    } catch { list.replaceChildren(); list.hidden = true; list.setAttribute("aria-busy", "false"); empty.hidden = false; }
  }

  function render() {
    const requested = location.pathname.split("/").filter(Boolean)[1] || new URLSearchParams(location.search).get("game") || "";
    const game = GAMES.find((item) => item.id === requested);
    const nav = $("#game-page-nav-v4");
    nav.append(...GAMES.map((item) => { const link = node("a", "game-nav-chip-v4", item.name); link.href = `/games/${item.id}`; link.dataset.game = item.id; window.BrowseRPPlatforms.theme(link, item.id); link.prepend(icon(item.id, "game-nav-mark-v4")); if (game?.id === item.id) { link.classList.add("is-selected"); link.setAttribute("aria-current", "page"); } return link; }));
    if (!game) {
      $("#game-page-mark-v4").append(icon("other", "game-page-symbol-v4"));
      $("#game-hub-grid-v4").append(...GAMES.map(gameCard));
      return;
    }
    window.BrowseRPPlatforms.theme(document.querySelector(".game-page-hero-v4"), game.id);
    document.title = `${game.name} roleplay servers — BrowseRP`;
    document.querySelector('meta[name="description"]').content = `Discover reviewed ${game.name} roleplay servers, communities and groups on BrowseRP.`;
    $("#game-page-mark-v4").append(icon(game.id, "game-page-symbol-v4"));
    $("#game-page-eyebrow-v4").textContent = `${game.name} roleplay`;
    $("#game-page-title-v4").textContent = `Find your ${game.name} roleplay community.`;
    $("#game-page-lead-v4").textContent = game.description;
    $("#game-hub-grid-v4").hidden = true;
    const results = $("#game-results-v4"); results.hidden = false;
    $("#game-results-title-v4").textContent = `${game.name} servers`;
    $("#game-results-lead-v4").textContent = `Reviewed ${game.line.toLowerCase()} listings appear below.`;
    $("#game-directory-link-v4").href = `/servers?platform=${encodeURIComponent(game.id)}`;
    loadGameServers(game);
  }

  render();
})();
