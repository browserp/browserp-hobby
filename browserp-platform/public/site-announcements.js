(() => {
  "use strict";
  if (document.body.classList.contains("staff-v3") || window.BrowseRPAnnouncements) return;
  const dismissed = new Set();
  let root; let loading = false;
  const make = (tag, text, className = "") => { const element = document.createElement(tag); if (text !== undefined) element.textContent = String(text); element.className = className; return element; };
  function render(announcements) {
    if (!root) {
      root = make("section", undefined, "site-announcements-v6"); root.setAttribute("aria-label", "Website announcements");
      const header = document.querySelector(".header-v3, .site-header");
      if (header) header.after(root); else document.querySelector("main")?.before(root);
    }
    const now = Date.now();
    const visible = announcements.filter((item) => !dismissed.has(`${item.id}:${item.publishedAt}`) && (!item.startsAt || new Date(item.startsAt).getTime() <= now) && (!item.endsAt || new Date(item.endsAt).getTime() > now)).slice(0, 5);
    root.hidden = visible.length === 0;
    root.replaceChildren(...visible.map((item) => {
      const banner = make("div", undefined, "site-announcement-v6 shell-v3"); banner.dataset.level = ["info", "success", "warning"].includes(item.level) ? item.level : "info";
      const copy = make("div"); copy.append(make("strong", item.title), make("p", item.body));
      const close = make("button", "×", "site-announcement-close-v6"); close.type = "button"; close.setAttribute("aria-label", `Dismiss announcement: ${item.title}`);
      close.addEventListener("click", () => { dismissed.add(`${item.id}:${item.publishedAt}`); render(announcements); });
      banner.append(copy, close); return banner;
    }));
  }
  async function refresh() {
    if (loading || document.hidden) return;
    loading = true;
    try {
      const response = await fetch("/api/public/announcements", { headers: { Accept: "application/json" }, credentials: "same-origin", cache: "no-store" });
      if (!response.ok) return;
      const { announcements = [] } = await response.json(); if (Array.isArray(announcements)) render(announcements);
    } catch { /* Announcements must not interrupt the rest of the website. */ }
    finally { loading = false; }
  }
  window.BrowseRPAnnouncements = Object.freeze({ refresh });
  document.addEventListener("visibilitychange", () => { if (!document.hidden) refresh(); });
  window.setInterval(refresh, 60000);
  refresh();
})();
