(() => {
  "use strict";
  const M = window.BrowseRPDiscovery;
  if (!M || ((document.body.dataset.page || "").startsWith("staff") || document.body.hasAttribute("data-staff-page") || location.pathname.startsWith("/staffpanel"))) return;
  const node = (tag, className, text) => { const item = document.createElement(tag); if (className) item.className = className; if (text !== undefined) item.textContent = text; return item; };
  const option = (value, text) => Object.assign(document.createElement("option"), { value, textContent: text });
  const read = fixedGame => M.normalize({ ...Object.fromEntries(new URLSearchParams(location.search)), ...(fixedGame ? { platform: fixedGame } : {}) });
  function close(input, list) { list.hidden = true; list.inert = true; input.setAttribute("aria-expanded", "false"); input.removeAttribute("aria-activedescendant"); }
  function suggestions(input, getFilters, getFacets, choose) {
    const list = node("div", "search-suggestions-v3");
    list.id = `${input.id}-suggestions`; list.hidden = true; list.inert = true; list.setAttribute("role", "listbox");
    input.parentElement.append(list); input.setAttribute("role", "combobox"); input.setAttribute("aria-autocomplete", "list"); input.setAttribute("aria-controls", list.id); input.setAttribute("aria-expanded", "false"); input.autocomplete = "off";
    let active = -1;
    function render() {
      const filters = getFilters(); const facets = getFacets(); const term = M.normal(input.value);
      const choices = [];
      for (const [key, label] of Object.entries(M.labels)) {
        if (["online", "verified", "beginner"].includes(key)) continue;
        const options = M.options(key, facets, filters).filter(item => key === "platform" || item.count > 0);
        for (const item of options) {
          if (filters[key] !== "all" && key === "platform") continue;
          const text = M.display(key, item.value, filters.platform);
          if (term && !M.normal(text).includes(term)) continue;
          choices.push({ key, value: item.value, label: M.label(key, filters.platform), text, count: item.count });
        }
      }
      choices.sort((a, b) => b.count - a.count || a.text.localeCompare(b.text));
      active = -1; input.removeAttribute("aria-activedescendant");
      list.replaceChildren(...choices.slice(0, 8).map((choice, index) => {
        const button = node("button", "search-suggestion-v3"); button.type = "button"; button.id = `${list.id}-${index}`; button.tabIndex = -1;
        button.setAttribute("role", "option"); button.setAttribute("aria-selected", "false");
        button.append(node("span", "search-suggestion-kind-v3", choice.label), node("strong", "", choice.text));
        if (choice.key === "platform") window.BrowseRPPlatforms.theme(button, choice.value);
        button.addEventListener("pointerdown", event => event.preventDefault());
        button.addEventListener("click", () => { choose(choice); close(input, list); input.focus(); });
        return button;
      }));
      if (!list.children.length) return close(input, list);
      list.hidden = false; list.inert = false; list.classList.add("search-suggestions-open"); input.setAttribute("aria-expanded", "true");
    }
    input.addEventListener("focus", render);
    input.addEventListener("input", render);
    input.addEventListener("blur", () => close(input, list));
    input.addEventListener("keydown", event => {
      if (event.key === "Escape" || event.key === "Tab") { close(input, list); return; }
      if (list.hidden) return;
      if (["ArrowDown", "ArrowUp"].includes(event.key)) {
        event.preventDefault(); active = active < 0 ? (event.key === "ArrowDown" ? 0 : list.children.length - 1) : (active + (event.key === "ArrowDown" ? 1 : -1) + list.children.length) % list.children.length;
        [...list.children].forEach((item, index) => item.setAttribute("aria-selected", String(index === active)));
        input.setAttribute("aria-activedescendant", list.children[active].id);
      } else if (event.key === "Enter" && active >= 0) { event.preventDefault(); list.children[active].click(); }
    });
    return { render, close: () => close(input, list) };
  }
  function selectOptions(select, key, facets, filters) {
    const current = filters[key];
    const names = { platform: "All games", region: "All regions", mode: M.taxonomy[filters.platform]?.modeAny || "Any framework or game mode", feature: "Any feature", access: "Any joining option", language: "Any language" };
    const choices = M.options(key, facets, filters);
    select.replaceChildren(option("all", names[key]), ...choices.map(item => option(item.value, M.display(key, item.value, filters.platform))));
    select.value = current;
    // Popularity orders options; public controls never display usage counts.
    // Keep known zero-result refinements visible but unavailable, and let users clear selected ones.
    for (const item of select.options) if (key !== "platform" && item.value !== "all" && item.value !== current) item.disabled = !choices.find(row => row.value === item.value)?.count;
    const title = select.parentElement.querySelector("span"); if (title) title.textContent = M.label(key, filters.platform);
    if (key === "platform") window.BrowseRPPlatforms.theme(select, current);
  }
  function resetChildren(filters, key) {
    if (key === "platform") for (const name of ["region", "mode", "feature", "access", "language"]) filters[name] = "all";
    if (key === "region") for (const name of ["mode", "feature", "access", "language"]) filters[name] = "all";
    if (["platform", "region"].includes(key)) for (const name of ["online", "verified", "beginner"]) filters[name] = false;
  }
  function mount({ root, list, empty, count, render, fixedGame }) {
    let filters = read(fixedGame), facets = {}, nextOffset = null, requestId = 0, controller, timer = null, shown = [], retryAppend = false;
    let loading = false, refreshAt = 0, lastLoadedAt = 0;
    root.classList.add("smart-discovery");
    const searchRow = node("div", "smart-search-row");
    const searchLabel = node("label", "field-v3 field-search-v3"); searchLabel.append(node("span", "", "Search servers"));
    const search = Object.assign(node("input"), { type: "search", id: "directory-search", maxLength: 120, placeholder: "Search by name or play style" }); searchLabel.append(search);
    const toggle = node("button", "button-v3 button-secondary-v3 smart-filter-toggle", "More filters"); toggle.type = "button"; toggle.setAttribute("aria-expanded", "false"); toggle.setAttribute("aria-controls", "smart-refinements");
    searchRow.append(searchLabel, toggle); root.append(searchRow);
    const primary = node("div", "smart-primary-filters"); const refinements = node("div", "smart-refinements"); refinements.id = "smart-refinements";
    const selects = {};
    for (const key of ["platform", "region", "mode", "feature", "language"]) {
      const label = node("label", "field-v3"); label.append(node("span", "", M.labels[key]));
      const select = node("select"); select.id = `${key}-filter`; label.append(select); selects[key] = select;
      if (fixedGame && key === "platform") label.hidden = true;
      (key === "platform" || key === "region" ? primary : refinements).append(label);
      select.addEventListener("change", () => change(key, select.value));
    }
    const sortLabel = node("label", "field-v3"); sortLabel.append(node("span", "", "Sort by"));
    const sort = node("select"); sort.id = "sort-filter";
    sort.append(...[["recommended", "Recommended"], ["players", "Most players"], ["newest", "Recently added"], ["trending", "Trending"], ["uptime", "Best uptime"]].map(([value, text]) => option(value, text))); sortLabel.append(sort); primary.append(sortLabel);
    sort.addEventListener("change", () => change("sort", sort.value));
    const access = node("fieldset", "smart-access-filters"); access.id = "access-filter";
    access.append(node("legend", "", M.labels.access));
    const accessHint = node("p", "smart-access-help", "Public: no general application. Whitelisted: application and approval required.");
    accessHint.id = "access-filter-help"; access.setAttribute("aria-describedby", accessHint.id);
    const accessChoices = node("div", "smart-access-choices"); const accessInputs = {};
    for (const [value, title] of [["all", "All"], ["public", "Public"], ["whitelisted", "Whitelisted"], ["unknown", "Not confirmed"]]) {
      const label = node("label", "smart-access-choice");
      const input = Object.assign(node("input"), { type: "radio", name: "directory-access", id: `access-${value}`, value });
      input.addEventListener("change", () => { if (input.checked) change("access", value); });
      label.append(input, node("span", "", title)); accessInputs[value] = input; accessChoices.append(label);
    }
    access.append(accessChoices, accessHint);
    const checks = node("div", "check-grid-v3 smart-checks"); const toggles = {};
    for (const key of ["online", "verified", "beginner"]) {
      const label = node("label", "check-v3"); const input = Object.assign(node("input"), { type: "checkbox", id: `${key}-filter` });
      const text = node("span", "", M.labels[key]); label.append(input, text); checks.append(label); toggles[key] = { input, text };
      input.addEventListener("change", () => change(key, input.checked));
    }
    const clear = node("button", "button-v3 button-quiet-v3", "Clear filters"); clear.type = "button"; clear.id = "clear-filters"; checks.append(clear);
    clear.addEventListener("click", () => { filters = M.normalize({ platform: fixedGame || "all" }); update(); });
    refinements.append(checks); root.append(primary, access, refinements);
    toggle.addEventListener("click", () => { const open = toggle.getAttribute("aria-expanded") !== "true"; toggle.setAttribute("aria-expanded", String(open)); root.classList.toggle("show-refinements", open); toggle.textContent = open ? "Fewer filters" : "More filters"; });
    const chips = node("div", "smart-filter-chips"); chips.setAttribute("aria-label", "Selected filters"); root.append(chips);
    const feedback = node("p", "smart-filter-feedback"); feedback.setAttribute("role", "status"); root.append(feedback);
    const refreshNotice = node("p", "smart-filter-feedback smart-refresh-feedback"); refreshNotice.setAttribute("role", "status"); root.append(refreshNotice);
    const more = node("button", "button-v3 button-secondary-v3 smart-load-more", "Show more servers"); more.type = "button"; more.hidden = true; list.after(more);
    const retry = node("button", "button-v3 button-secondary-v3", "Try again"); retry.type = "button"; retry.hidden = true; empty.append(retry); retry.addEventListener("click", () => load(retryAppend));
    const clearEmpty = node("button", "button-v3 button-secondary-v3", "Clear filters"); clearEmpty.type = "button"; empty.append(clearEmpty); clearEmpty.addEventListener("click", () => clear.click());
    more.addEventListener("click", () => { if (nextOffset !== null) { filters.offset = nextOffset; load(true); } });
    const suggest = suggestions(search, () => filters, () => facets, choice => { filters.query = ""; change(choice.key, choice.value); });
    function sync() {
      const focusedChip = chips.contains(document.activeElement) ? document.activeElement.getAttribute("aria-label") : null;
      search.value = filters.query; sort.value = filters.sort;
      for (const [key, select] of Object.entries(selects)) selectOptions(select, key, facets, filters);
      const accessOptions = M.options("access", facets, filters);
      for (const [value, input] of Object.entries(accessInputs)) {
        input.checked = value === filters.access;
        input.disabled = Array.isArray(facets.access) && value !== "all" && !input.checked && !accessOptions.find(item => item.value === value)?.count;
      }
      for (const [key, control] of Object.entries(toggles)) { control.input.checked = filters[key]; control.text.textContent = M.labels[key]; }
      chips.replaceChildren();
      for (const key of ["query", ...Object.keys(M.labels)]) {
        if ((fixedGame && key === "platform") || filters[key] === M.defaults[key]) continue;
        const text = key === "query" ? `Search: ${filters.query}` : typeof filters[key] === "boolean" ? M.labels[key] : `${M.label(key, filters.platform)}: ${M.display(key, filters[key], filters.platform)}`;
        const chip = node("button", "smart-filter-chip", `${text} ×`); chip.type = "button"; chip.setAttribute("aria-label", `Remove ${text}`);
        chip.addEventListener("click", () => change(key, M.defaults[key])); chips.append(chip);
      }
      document.querySelectorAll(".game-strip-v3 [data-game]").forEach(link => { const selected = link.dataset.game === filters.platform; link.classList.toggle("is-selected", selected); if (selected) link.setAttribute("aria-current", "page"); else link.removeAttribute("aria-current"); });
      const directoryLink = document.querySelector("#game-directory-link-v4"); if (directoryLink) directoryLink.href = `/servers?${M.params({ ...filters, offset: 0 })}`;
      if (focusedChip) [...chips.querySelectorAll("button")].find(item => item.getAttribute("aria-label") === focusedChip)?.focus({ preventScroll: true });
    }
    function url() {
      const params = M.params({ ...filters, offset: 0 }); const next = `${location.pathname}${params.size ? `?${params}` : ""}`;
      if (next !== `${location.pathname}${location.search}`) history.pushState(null, "", next);
    }
    function invalidate() { requestId++; controller?.abort(); clearTimeout(timer); timer = null; loading = false; }
    function update(delay = 0) {
      invalidate(); filters.offset = 0; more.disabled = true; list.setAttribute("aria-busy", "true"); sync(); url(); suggest.close();
      timer = setTimeout(() => { timer = null; load(false); }, delay);
    }
    function change(key, value) {
      filters[key] = value;
      resetChildren(filters, key);
      feedback.textContent = ["platform", "region"].includes(key) ? `Choices updated for ${value === "all" ? (key === "platform" ? "all games" : "all regions") : M.display(key, value)}.` : "";
      update();
    }
    search.addEventListener("input", () => { filters.query = search.value.slice(0, 120); update(220); suggest.render(); });
    search.addEventListener("keydown", event => { if (event.key === "Enter" && !event.defaultPrevented) { event.preventDefault(); update(); } });
    document.querySelectorAll(".game-strip-v3 [data-game]").forEach(link => link.addEventListener("click", event => { if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return; event.preventDefault(); change("platform", link.dataset.game); }));
    window.addEventListener("popstate", () => { invalidate(); filters = read(fixedGame); sync(); load(false); });
    function draw() {
      const active = document.activeElement;
      const href = list.contains(active) ? active.closest("a[href]")?.getAttribute("href") : null;
      render(list, shown);
      if (href) [...list.querySelectorAll("a[href]")].find(item => item.getAttribute("href") === href)?.focus({ preventScroll: true });
    }
    function expireCounts(renderChanges = true) {
      let changed = false;
      shown = shown.map(server => {
        const observed = Date.parse(server.checked_at || "") || lastLoadedAt;
        if (!server.imported || !server.online || !observed || Date.now() - observed <= 300_000) return server;
        changed = true; return { ...server, online: false, players: null, capacity: null };
      });
      if (changed && renderChanges) { draw(); refreshNotice.textContent = "Some live counts have expired. Checking for an update…"; }
    }
    async function load(append, { background = false } = {}) {
      if (!background) retryAppend = append;
      const id = ++requestId; controller?.abort(); controller = new AbortController(); const snapshot = { ...filters };
      const requestController = controller; let timedOut = false;
      const timeout = window.setTimeout(() => { timedOut = true; requestController.abort(); }, 15_000);
      loading = true; refreshAt = Date.now() + 60_000;
      list.setAttribute("aria-busy", "true"); if (!background) count.textContent = "Updating servers…"; more.disabled = true; retry.hidden = true;
      try {
        // Refresh all previously loaded cards, in API-bounded pages, without losing pagination.
        const desired = background ? Math.max(snapshot.limit, shown.length) : snapshot.limit;
        let offset = background ? 0 : snapshot.offset, received = [], payload;
        do {
          const params = M.params({ ...snapshot, offset, limit: background ? Math.min(100, desired - received.length) : snapshot.limit });
          params.set("discover", "true"); if (params.has("q")) { params.set("query", params.get("q")); params.delete("q"); }
          const response = await fetch(`/api/servers?${params}`, { headers: { Accept: "application/json" }, credentials: "same-origin", signal: requestController.signal });
          if (!response.ok) {
            const retryAfter = response.headers?.get("Retry-After");
            if (retryAfter) { const delay = /^\d+$/.test(retryAfter) ? Number(retryAfter) * 1000 : Date.parse(retryAfter) - Date.now(); if (Number.isFinite(delay)) refreshAt = Math.max(refreshAt, Date.now() + delay); }
            throw new Error("Directory unavailable");
          }
          payload = await response.json(); if (id !== requestId) return;
          received.push(...payload.servers);
          if (!background || payload.nextOffset == null || payload.nextOffset <= offset || !payload.servers.length) break;
          offset = payload.nextOffset;
        } while (received.length < desired);
        facets = payload.facets || {}; nextOffset = payload.nextOffset ?? null;
        shown = append ? [...shown, ...received] : received;
        shown = [...new Map(shown.map(server => [server.slug, server])).values()];
        lastLoadedAt = Date.now(); refreshNotice.textContent = "";
        expireCounts(false);
        draw(); list.hidden = !shown.length; empty.hidden = Boolean(shown.length);
        count.textContent = `${payload.total} ${payload.total === 1 ? "server" : "servers"}${shown.length < payload.total ? ` · Showing ${shown.length}` : ""}`;
        empty.querySelector("h3").textContent = "No servers match your search.";
        empty.querySelector("p").textContent = "Remove a selected filter or try another game or region.";
        more.hidden = nextOffset === null; more.disabled = false; clearEmpty.hidden = false; sync();
      } catch (error) {
        if (id !== requestId || (error.name === "AbortError" && !timedOut)) return;
        if (background && shown.length) {
          expireCounts();
          refreshNotice.textContent = `Live refresh is unavailable. Results last loaded at ${new Date(lastLoadedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}. We’ll retry automatically.`;
          more.disabled = false; return;
        }
        list.hidden = true; empty.hidden = false; more.hidden = true; retry.hidden = false; clearEmpty.hidden = true;
        count.textContent = "Servers unavailable"; empty.querySelector("h3").textContent = "We couldn’t load the directory."; empty.querySelector("p").textContent = "Your filters are saved. Try again in a moment.";
      } finally { window.clearTimeout(timeout); if (id === requestId) { loading = false; list.setAttribute("aria-busy", "false"); } }
    }
    function refreshIfDue() {
      if (document.visibilityState !== "visible" || !root.isConnected) return;
      expireCounts();
      if (loading || timer !== null || Date.now() < refreshAt) return;
      load(false, { background: true });
    }
    window.setInterval(refreshIfDue, 60_000);
    document.addEventListener("visibilitychange", refreshIfDue);
    // Browsers suspend this interval in their back/forward cache; retain it on restoration.
    window.addEventListener("pagehide", () => { controller?.abort(); });
    sync(); load(false);
    return { getFilters: () => ({ ...filters }) };
  }
  function home() {
    const form = document.querySelector("#home-search-form"); const input = document.querySelector("#home-search"); if (!form || !input) return;
    let filters = M.normalize(), facets = {}, id = 0, controller;
    const row = node("div", "smart-home-filters"); form.after(row);
    const selects = {};
    for (const key of ["platform", "region"]) {
      const label = node("label", "field-v3"); label.append(node("span", "", M.labels[key])); const select = node("select"); label.append(select); row.append(label); selects[key] = select;
      select.addEventListener("change", () => { filters[key] = select.value; resetChildren(filters, key); refresh(); });
    }
    function sync() { for (const [key, select] of Object.entries(selects)) selectOptions(select, key, facets, filters); }
    async function refresh() {
      sync(); const current = ++id; controller?.abort(); controller = new AbortController();
      try { const params = M.params(filters); params.set("discover", "true"); params.set("limit", "1"); const response = await fetch(`/api/servers?${params}`, { signal: controller.signal }); if (!response.ok) return; const data = await response.json(); if (current !== id) return; facets = data.facets || {}; sync(); } catch { /* Search remains usable during an outage. */ }
    }
    suggestions(input, () => filters, () => facets, choice => { filters[choice.key] = choice.value; resetChildren(filters, choice.key); input.value = ""; filters.query = ""; if (!["platform", "region"].includes(choice.key)) { const params = M.params(filters); location.assign(`/servers?${params}`); } else refresh(); });
    form.addEventListener("submit", event => { event.preventDefault(); filters.query = input.value.trim().slice(0, 120); const params = M.params(filters); location.assign(`/servers${params.size ? `?${params}` : ""}`); });
    refresh();
  }
  window.BrowseRPSearch = { mount, home };
})();
