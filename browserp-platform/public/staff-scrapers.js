(() => {
  "use strict";
  const games = Object.freeze([
    { id: "fivem", name: "FiveM" },
    { id: "redm", name: "RedM" },
    { id: "minecraft", name: "Minecraft" },
    { id: "roblox", name: "Roblox" }
  ]);
  const make = (tag, text, className = "") => {
    const element = document.createElement(tag);
    if (text !== undefined) element.textContent = text;
    element.className = className;
    return element;
  };
  function artwork(game, className) {
    const image = make("img", undefined, className);
    image.src = `/assets/games/${game.id}-roleplay.webp`;
    image.alt = "";
    image.width = 512;
    image.height = 512;
    return image;
  }
  function init({ api } = {}) {
    const nav = document.querySelector(".staff-nav-v3");
    if (!nav || nav.querySelector(".staff-scrapers-menu")) return;
    const isPage = document.body.dataset.staffPage === "scrapers";
    const menu = make("details", undefined, "staff-scrapers-menu");
    menu.open = isPage;
    const summary = make("summary");
    summary.append(make("span", "Scrapers"));
    const links = make("div", undefined, "staff-scrapers-links");
    let focusSection = false;
    for (const game of games) {
      const link = make("a", undefined, "staff-scrapers-link");
      link.href = `/staffpanel/scrapers#${game.id}`;
      link.dataset.platform = game.id;
      link.append(artwork(game, "staff-scrapers-thumb"), make("span", game.name));
      link.addEventListener("click", () => {
        if (!isPage) return;
        focusSection = true;
        document.body.classList.remove("staff-menu-open");
        const button = document.querySelector("#staff-menu-v3");
        button?.setAttribute("aria-expanded", "false");
        button?.setAttribute("aria-label", "Open staff navigation");
        if (location.hash === `#${game.id}`) focusHeading();
      });
      links.append(link);
    }
    menu.append(summary, links);
    nav.querySelector('a[href="/staffpanel/moderation"]')?.after(menu);
    if (!isPage) return;
    const root = document.querySelector("#scrapers-content");
    function focusHeading() {
      if (!focusSection) return;
      document.querySelector("#scrapers-title")?.focus();
      focusSection = false;
    }
    let scraper = null; let generation = 0;
    async function render() {
      const revision = ++generation; scraper?.destroy(); scraper = null;
      const selected = games.find((game) => location.hash === `#${game.id}`);
      const title = document.querySelector("#scrapers-title");
      title.textContent = selected ? `${selected.name} scraper` : "Scrapers";
      document.title = `${title.textContent} — BrowseRP Staff`;
      for (const link of links.children) {
        if (selected?.id === link.dataset.platform) link.setAttribute("aria-current", "page");
        else link.removeAttribute("aria-current");
      }
      root.replaceChildren();
      let mount = null;
      if (selected?.id === "fivem") {
        mount = make("section"); root.append(mount);
      } else if (selected) {
        const panel = make("section", undefined, "staff-scraper-preview");
        panel.dataset.platform = selected.id;
        const copy = make("div", undefined, "staff-scraper-copy");
        copy.append(make("span", selected.name, "staff-scraper-platform"), make("h2", "Coming soon"), make("p", `Scraper tools for ${selected.name} will be added here later.`));
        panel.append(artwork(selected, "staff-scraper-artwork"), copy);
        root.append(panel);
      }
      const grid = make("nav", undefined, "staff-scraper-grid");
      grid.setAttribute("aria-label", "Scraper games");
      for (const game of games) {
        const link = make("a", undefined, "staff-scraper-card");
        link.href = `#${game.id}`;
        link.dataset.platform = game.id;
        if (selected?.id === game.id) link.setAttribute("aria-current", "page");
        const copy = make("span");
        copy.append(make("strong", game.name), make("small", game.id === "fivem" ? "Import servers" : "Coming soon"));
        link.append(artwork(game, "staff-scrapers-thumb"), copy);
        link.addEventListener("click", () => { focusSection = true; if (location.hash === link.hash) focusHeading(); });
        grid.append(link);
      }
      root.append(grid);
      focusHeading();
      if (mount) {
        try {
          const controller = await window.BrowseRPStaffFiveM.init({ api, root: mount, imageUrl: (url) => `/api/public/server-image?url=${encodeURIComponent(url)}` });
          if (revision !== generation) controller?.destroy(); else scraper = controller;
        } catch (error) { if (revision === generation) mount.append(make("p", error.message || "The importer could not load. Please refresh.")); }
      }
    }
    window.addEventListener("hashchange", render);
    void render();
    window.addEventListener("pagehide", () => { generation += 1; scraper?.destroy(); });
  }
  window.BrowseRPStaffScrapers = Object.freeze({ init });
})();
