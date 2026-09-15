(() => {
  "use strict";
  // Presentation only: opening this panel never changes filters, URLs or requests.
  function mount({ root, searchRow, primary, access, refinements, toggle, selects, getFilters, change }) {
    root.classList.add("directory-discovery");
    const row = document.createElement("div");
    row.className = "directory-control-row";
    row.id = "games";
    row.setAttribute("role", "group");
    row.setAttribute("aria-label", "Choose a game");
    toggle.textContent = "Filters";
    toggle.setAttribute("aria-controls", "directory-filter-panel");
    const buttons = [];
    for (const [id, name] of Object.entries(window.BrowseRPDiscovery.games)) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "directory-game-choice";
      button.dataset.directoryGame = id;
      button.setAttribute("aria-pressed", "false");
      window.BrowseRPPlatforms.theme(button, id);
      const image = document.createElement("img");
      image.src = `/assets/games/${id}-selected-v2.webp`;
      image.alt = "";
      image.width = 48; image.height = 30;
      const label = document.createElement("span"); label.textContent = name;
      button.append(image, label);
      button.addEventListener("click", () => {
        const selected = getFilters().platform === id;
        change("platform", selected ? "all" : id);
      });
      row.append(button); buttons.push(button);
    }
    const panel = document.createElement("div");
    panel.id = "directory-filter-panel";
    panel.className = "directory-filter-panel";
    panel.setAttribute("role", "region");
    panel.setAttribute("aria-label", "Server filters");
    panel.append(primary, refinements, access);
    // Keep the existing model control available to sync, without a duplicate game picker.
    selects.platform.hidden = true;
    selects.platform.parentElement.hidden = true;
    const hint = document.createElement("p");
    hint.className = "directory-game-hint";
    hint.textContent = "Choose a game to see its modes and features.";
    panel.append(hint);
    searchRow.after(row, panel);
    // Move the existing controls, including their listeners, rather than
    // introducing a second sort or a separate filter state.
    const resultBar = document.querySelector(".result-bar-v3");
    if (resultBar) {
      const sort = primary.querySelector("#sort-filter")?.parentElement;
      if (sort) { sort.classList.add("directory-sort"); resultBar.append(sort); }
      const chips = root.querySelector(".smart-filter-chips");
      if (chips) resultBar.append(chips);
    }
    function setOpen(open) {
      panel.hidden = !open;
      panel.inert = !open;
      toggle.setAttribute("aria-expanded", String(open));
    }
    function sync(filters) {
      const applied = Object.keys(window.BrowseRPDiscovery.labels).filter(key => filters[key] !== window.BrowseRPDiscovery.defaults[key]).length;
      toggle.textContent = applied ? `Filters (${applied})` : "Filters";
      for (const button of buttons) {
        const selected = button.dataset.directoryGame === filters.platform;
        button.setAttribute("aria-pressed", String(selected));
        button.title = selected ? `Clear ${window.BrowseRPDiscovery.games[filters.platform]} game filter` : "";
      }
      for (const key of ["mode", "feature"]) selects[key].parentElement.hidden = filters.platform === "all" && filters[key] === "all";
      hint.hidden = filters.platform !== "all";
    }
    const initial = getFilters();
    setOpen(Object.keys(window.BrowseRPDiscovery.labels).some(key => initial[key] !== window.BrowseRPDiscovery.defaults[key]) || initial.sort !== "recommended");
    return { sync, toggle: () => setOpen(panel.hidden) };
  }
  window.BrowseRPDirectoryControls = Object.freeze({ mount });
})();
