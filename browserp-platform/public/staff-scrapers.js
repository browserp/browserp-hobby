(() => {
  "use strict";
  const games = Object.freeze([
    { id: "fivem", name: "FiveM" },
    { id: "redm", name: "RedM" },
    { id: "minecraft", name: "Minecraft" },
    { id: "roblox", name: "Roblox" }
  ]);
  const research = {
    fivem: {
      summary: "Discover communities in the official list, then review their information before publishing. Live counts come from each server’s FiveM observation.",
      sources: [["FiveM server list", "https://servers.fivem.net/", "Find a server and copy its Cfx join code."], ["FiveM Server Bazaar", "https://forum.cfx.re/c/server-development/server-bazaar/38", "Community posts, rules and recruitment information."]],
      steps: ["Import a small selection of RP communities using their join codes.", "Confirm names, Discord invites, websites, artwork and game-specific tags. Flag conflicting details for review.", "Refresh known listings with a checked time. Keep missing or stale player counts unavailable, and confirm zero only when the source reports zero."]
    },
    redm: {
      summary: "RedM is the next proposed pilot: use its official directory, verify that every listing is RedM, and review western roleplay details separately.",
      sources: [["RedM server list", "https://servers.redm.net/", "Discover RedM communities and their join codes."], ["RedM Server Bazaar", "https://forum.cfx.re/c/redm-server-development/redm-server-bazaar/69", "Find community-written introductions and joining requirements."]],
      steps: ["Start with 3–5 reviewed RedM communities after the plan is agreed.", "Confirm the RedM game identifier and supported source access before importing. Check VORP, RSG and other framework claims against evidence.", "Use the existing review process for links, artwork and live counts, with RedM-specific tags and access requirements."]
    },
    minecraft: {
      summary: "Use reviewed community addresses for a small Java and Bedrock pilot. A network-wide player total must stay separate from an individual roleplay world.",
      sources: [["Official Minecraft Server List", "https://findmcserver.com/", "Browse communities and follow their own websites for RP information."], ["Minecraft server guide", "https://www.minecraft.net/en-us/servers.jsp", "Official guidance on finding Java and Bedrock servers."]],
      steps: ["Choose 3–5 public or owner-submitted communities and confirm Java or Bedrock, address, version and RP style.", "Check player counts and server status only at reviewed addresses. Confirm whether each total belongs to a network or a specific world.", "Use a server-control challenge for claims. Request an owner integration later if a roleplay world needs its own accurate count."]
    },
    roblox: {
      summary: "Roblox needs two kinds of listing: the experience itself and an independent RP community within it. Their owners, join instructions and player counts are different.",
      sources: [["Roblox discovery", "https://www.roblox.com/charts", "Find experiences, then verify their official creator and community pages."], ["Emergency Response: Liberty County", "https://erlc.gg/", "A potential first pilot for independent RP communities."], ["ER:LC owner integration", "https://apidocs.erlc.gg/", "Official API for consenting private-server owners; feasibility must be agreed first."], ["Roblox server-list changes", "https://devforum.roblox.com/t/test-updates-to-server-list-page/3966648", "Why a complete public-instance scraper is not a dependable source."]],
      steps: ["Begin with a few reviewed RP experiences and label any player total as experience-wide.", "Add independent communities through owner submissions. Never copy the experience’s total into a community’s count.", "Assess an owner-approved ER:LC integration for exact community counts and control proof. Other Roblox games need their own documented integration or manual submission."]
    }
  };
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
  function sourceReferences(game) {
    const info = research[game.id];
    const section = make("section", undefined, "staff-scraper-references");
    section.dataset.platform = game.id;
    const heading = make("h2", "Sources and approach"); heading.id = `scraper-sources-${game.id}`;
    section.setAttribute("aria-labelledby", heading.id);
    section.append(heading, make("p", info.summary, "staff-scraper-intro"));
    const sources = make("div", undefined, "staff-scraper-source-grid");
    for (const [title, url, description] of info.sources) {
      const link = make("a", undefined, "staff-scraper-source");
      link.href = url; link.target = "_blank"; link.rel = "noopener noreferrer";
      link.append(make("strong", `${title} ↗`), make("span", description)); sources.append(link);
    }
    const plan = make("details", undefined, "staff-scraper-plan");
    plan.append(make("summary", game.id === "fivem" ? "Review and refresh plan" : "Proposed pilot — awaiting agreement"));
    const steps = make("ol"); for (const step of info.steps) steps.append(make("li", step)); plan.append(steps);
    section.append(sources, plan, make("p", "Researched 4 September 2026. These links are discovery references; future imports depend on supported access and source permissions.", "staff-scraper-note"));
    return section;
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
        copy.append(make("span", selected.name, "staff-scraper-platform"), make("h2", "Plan the next scraper"), make("p", `Review the sources and proposed ${selected.name} pilot below. Import tools are not active yet.`));
        panel.append(artwork(selected, "staff-scraper-artwork"), copy);
        root.append(panel);
      }
      if (selected) root.append(sourceReferences(selected));
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
