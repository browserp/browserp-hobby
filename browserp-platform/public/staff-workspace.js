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
  function mount() {
    const sidebar = document.querySelector(".staff-sidebar-v3");
    const nav = sidebar?.querySelector(".staff-nav-v3");
    if (!nav || sidebar.dataset.staffAppearance) return;
    sidebar.dataset.staffAppearance = "ready";
    const mark = make("span", "Staff workspace", "staff-workspace-label");
    sidebar.querySelector(".logo-v3")?.after(mark);
    const tools = make("nav", undefined, "staff-local-nav"); tools.setAttribute("aria-label", "Website tools");
    const groups = [
      ["Your work", [["Duty & availability", "overview-duty"], ["Your sign-in security", "overview-authenticators"]]],
      ["Website tools", [["Blog posts", "overview-publishing"], ["Announcements", "overview-announcements"], ["Adverts & enquiries", "overview-adverts"], ["Listing checks", "overview-refresh-health"], ["Registrations", "overview-users"]]]
    ];
    for (const [label, links] of groups) {
      tools.append(make("span", label, "staff-nav-group-v3"));
      for (const [text, hash] of links) {
        const link = make("a", text); link.href = `/staffpanel/overview#${hash}`; tools.append(link);
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
