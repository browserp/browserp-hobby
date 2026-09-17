(() => {
  "use strict";
  // Appearance only: no session, account, consent or private-data requests.
  const read = () => window.BrowseRPTheme?.get() || "default";
  const apply = (theme, persist = false) => window.BrowseRPTheme?.apply(theme, { persist }) || "default";
  const make = (tag, text, className) => {
    const node = document.createElement(tag);
    if (text) node.textContent = text;
    if (className) node.className = className;
    return node;
  };
  function mountToolSearch(sidebar) {
    const search = make("div", undefined, "staff-tool-search");
    const label = make("label", "Find a staff tool", "staff-tool-search-label");
    const input = make("input");
    input.type = "search";
    input.id = "staff-tool-search-input";
    input.placeholder = "Search staff tools";
    input.autocomplete = "off";
    input.maxLength = 80;
    input.tabIndex = 0; // Included in the existing mobile menu focus loop.
    label.htmlFor = input.id;
    const results = make("div", undefined, "staff-tool-search-results");
    results.id = "staff-tool-search-results";
    results.setAttribute("role", "group");
    results.setAttribute("aria-label", "Matching staff tools");
    results.hidden = true;
    input.setAttribute("aria-controls", results.id);
    const status = make("p", "", "staff-tool-search-status");
    status.setAttribute("role", "status");
    const render = () => {
      const query = input.value.trim().toLocaleLowerCase("en-GB");
      results.replaceChildren();
      results.hidden = !query;
      status.textContent = "";
      if (!query) return;
      const seen = new Set();
      const links = [...sidebar.querySelectorAll(".staff-nav-v3 a[href], .staff-local-nav a[href], #moderation-tabs a[href]")]
        .filter(link => !link.closest("[hidden]") && !link.closest("[inert]"))
        .filter(link => {
          const url = new URL(link.href, location.href);
          return url.origin === location.origin && url.pathname.startsWith("/staffpanel/")
            && link.textContent.toLocaleLowerCase("en-GB").includes(query)
            && !seen.has(url.href) && seen.add(url.href);
        }).slice(0, 8);
      for (const link of links) {
        const result = make("a", link.textContent.trim(), "staff-tool-search-result");
        result.href = link.getAttribute("href");
        results.append(result);
      }
      status.textContent = links.length ? `${links.length} matching ${links.length === 1 ? "tool" : "tools"}` : "No matching staff tools";
    };
    input.addEventListener("input", render);
    input.addEventListener("focus", render);
    input.addEventListener("keydown", event => {
      if (event.key !== "Escape" || !input.value) return;
      event.preventDefault(); event.stopPropagation(); input.value = ""; render();
    });
    search.append(label, input, results, status);
    sidebar.querySelector(".staff-workspace-label")?.after(search);
  }
  function mount() {
    const sidebar = document.querySelector(".staff-sidebar-v3");
    const nav = sidebar?.querySelector(".staff-nav-v3");
    if (!nav || sidebar.dataset.staffAppearance) return;
    sidebar.dataset.staffAppearance = "ready";
    const mark = make("span", "Staff panel", "staff-workspace-label");
    sidebar.querySelector(".logo-v3")?.after(mark);
    mountToolSearch(sidebar);
    const tools = make("nav", undefined, "staff-local-nav"); tools.setAttribute("aria-label", "Staff panel tools");
    const groups = [
      ["Your work", [["Availability", "overview-duty"], ["Your sign-in security", "overview-authenticators"]]],
      ["Website tools", [["Blog posts", "overview-publishing"], ["Adverts & enquiries", "overview-adverts"], ["Listing checks", "overview-refresh-health"], ["Registrations", "overview-users"], ["Boost a server", "overview-featured-boost"]]]
    ];
    for (const [label, links] of groups) {
      tools.append(make("span", label, "staff-nav-group-v3"));
      for (const [text, hash] of links) {
        const link = make("a", text); link.href = `/staffpanel/overview#${hash}`; link.dataset.overviewTool = hash;
        if (hash === "overview-featured-boost") link.hidden = true;
        tools.append(link);
      }
    }
    sidebar.append(tools);
    const appearance = make("div", undefined, "staff-appearance");
    appearance.append(make("span", "Appearance", "staff-appearance-label"));
    const options = make("div", undefined, "staff-theme-options ds-tabs"); options.setAttribute("role", "group"); options.setAttribute("aria-label", "Colour theme");
    for (const { value: theme, label } of window.BrowseRPTheme?.choices || []) {
      const button = make("button", label);
      button.type = "button"; button.dataset.staffTheme = theme;
      button.setAttribute("aria-pressed", String(document.documentElement.dataset.theme === theme));
      button.addEventListener("click", () => apply(theme, true)); options.append(button);
    }
    window.BrowseRPTheme?.syncControls(options);
    appearance.append(options, make("small", "Saved on this device")); sidebar.append(appearance);
  }
  window.BrowseRPStaffAppearance = Object.freeze({ get: read, apply, mount });
  apply(read());
})();
