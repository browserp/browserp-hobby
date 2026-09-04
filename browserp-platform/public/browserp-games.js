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
  const AVAILABLE_GAME_IDS = new Set(["fivem", "redm", "roblox", "minecraft"]);
  const ARTWORK_GAME_IDS = new Set([...AVAILABLE_GAME_IDS, "forza"]);
  const AVAILABLE_GAMES = GAMES.filter((game) => AVAILABLE_GAME_IDS.has(game.id));
  const UPCOMING_GAMES = GAMES.filter((game) => !AVAILABLE_GAME_IDS.has(game.id));

  const $ = (selector) => document.querySelector(selector);
  const node = (tag, className, text) => { const item = document.createElement(tag); if (className) item.className = className; if (text !== undefined) item.textContent = text; return item; };
  const icon = (id, className = "game-mark-v4") => { const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg"); svg.classList.add(className); svg.setAttribute("aria-hidden", "true"); const use = document.createElementNS("http://www.w3.org/2000/svg", "use"); use.setAttribute("href", `/assets/game-marks-v4.svg#mark-${id}`); svg.append(use); return svg; };

  function gameMark(id, className) {
    if (!ARTWORK_GAME_IDS.has(id)) return icon(id, className);
    const image = node("img", `game-artwork-v5 ${className}`);
    image.src = `/assets/games/${id}-roleplay.webp`;
    image.alt = "";
    image.width = 160;
    image.height = 160;
    return image;
  }

  function gameCard(game, comingSoon = false) {
    const link = node(comingSoon ? "article" : "a", `game-hub-card-v4${comingSoon ? " game-coming-soon-card-v5" : ""}`);
    if (!comingSoon) link.href = `/games/${game.id}`;
    window.BrowseRPPlatforms.theme(link, game.id);
    const mark = node("span", "game-hub-mark-v4"); mark.append(gameMark(game.id, "game-card-artwork-v5"));
    const copy = node("span", "game-hub-copy-v4"); copy.append(node("strong", "", game.name), node("small", "", game.line));
    link.append(mark, copy, node("b", comingSoon ? "coming-soon-label-v5" : "", comingSoon ? "Coming soon" : "Explore servers"));
    return link;
  }

  function serverCard(server) {
    const link = node("a", "server-card"); link.href = `/server/${encodeURIComponent(server.slug || "")}`;
    window.BrowseRPPlatforms.theme(link, window.BrowseRPPlatforms.idFor(server));
    const media = node("div", "server-card-media");
    const imageUrl = String(server.logo_url || server.banner_url || "");
    if (/^https?:\/\/|^\//i.test(imageUrl)) { const image = new Image(); image.src = imageUrl; image.alt = ""; image.loading = "lazy"; image.className = "server-card-media-image"; media.append(image); }
    else media.append(node("span", "server-initials", String(server.name || "RP").split(/\s+/).slice(0,2).map((part) => part[0]).join("").toUpperCase()));
    const top = node("div", "server-card-top"); top.append(media, node("span", `status${server.online ? " online" : ""}`, server.online ? "Online now" : "Status unavailable"));
    link.append(top, node("h3", "", server.name || "Roleplay server"), window.BrowseRPPlatforms.metadata(server), node("p", "server-description", server.description || "Open the listing to learn more."));
    const bottom = node("div", "server-card-bottom"); bottom.append(node("strong", "", server.online ? `${Number(server.players || 0).toLocaleString()} players` : "Player count unavailable"), node("span", "server-card-action", "View listing")); link.append(bottom);
    return link;
  }

  function render() {
    const requested = location.pathname.split("/").filter(Boolean)[1] || new URLSearchParams(location.search).get("game") || "";
    const game = GAMES.find((item) => item.id === requested);
    const nav = $("#game-page-nav-v4");
    nav.append(...AVAILABLE_GAMES.map((item) => { const link = node("a", "game-nav-chip-v4", item.name); link.href = `/games/${item.id}`; link.dataset.game = item.id; window.BrowseRPPlatforms.theme(link, item.id); link.prepend(gameMark(item.id, "game-nav-mark-v4")); if (game?.id === item.id) { link.classList.add("is-selected"); link.setAttribute("aria-current", "page"); } return link; }));
    $("#game-upcoming-grid-v5").append(...UPCOMING_GAMES.map((item) => gameCard(item, true)));
    if (!game) {
      nav.hidden = true;
      const allGamesLogo = node("img", "game-page-all-logo-v5");
      allGamesLogo.src = "/assets/games/all-games-logo.png";
      allGamesLogo.alt = "";
      allGamesLogo.width = 140;
      allGamesLogo.height = 140;
      $("#game-page-mark-v4").append(allGamesLogo);
      $("#game-hub-grid-v4").append(...AVAILABLE_GAMES.map((item) => gameCard(item)));
      return;
    }
    window.BrowseRPPlatforms.theme(document.querySelector(".game-page-hero-v4"), game.id);
    document.title = `${game.name} roleplay servers — BrowseRP`;
    document.querySelector('meta[name="description"]').content = `Discover reviewed ${game.name} roleplay servers, communities and groups on BrowseRP.`;
    $("#game-page-mark-v4").append(gameMark(game.id, "game-page-symbol-v4"));
    $("#game-page-eyebrow-v4").textContent = `${game.name} roleplay`;
    $("#game-page-title-v4").textContent = `Find your ${game.name} roleplay community.`;
    $("#game-page-lead-v4").textContent = game.description;
    $("#game-hub-grid-v4").hidden = true;
    if (!AVAILABLE_GAME_IDS.has(game.id)) {
      document.title = `${game.name} — Coming soon | BrowseRP`;
      document.querySelector('meta[name="description"]').content = `${game.name} discovery is coming soon to BrowseRP.`;
      $("#game-page-eyebrow-v4").textContent = "Coming soon";
      $("#game-page-title-v4").textContent = `${game.name} is coming soon.`;
      $("#game-page-lead-v4").textContent = "We’re starting with FiveM, RedM, Roblox and Minecraft. More games will join the directory in future.";
      const browse = node("a", "button-v3 button-primary-v3", "Explore available games"); browse.href = "/games";
      $("#game-page-actions-v4").replaceChildren(browse);
      return;
    }
    const results = $("#game-results-v4"); results.hidden = false;
    $("#game-results-title-v4").textContent = `${game.name} servers`;
    $("#game-results-lead-v4").textContent = `Reviewed ${game.line.toLowerCase()} listings appear below.`;
    $("#game-directory-link-v4").href = `/servers?platform=${encodeURIComponent(game.id)}`;
    window.BrowseRPSearch.mount({ root: $("#game-discovery-controls"), list: $("#game-server-list-v4"), empty: $("#game-server-empty-v4"), count: $("#game-result-count"), fixedGame: game.id, render: (list, servers) => list.replaceChildren(...servers.map(serverCard)) });
  }

  render();
})();
