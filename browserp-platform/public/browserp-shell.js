(() => {
  "use strict";

  const header = document.querySelector("[data-site-header]");
  const button = document.querySelector("[data-menu-button]");
  const menu = document.querySelector("[data-site-menu]");
  const mobile = window.matchMedia("(max-width: 760px)");
  let closeTimer;

  const nav = menu?.querySelector(".nav-links");
  if (nav) {
    const links = [
      ["Browse", "/servers"],
      ["All Games", "/servers"],
      ["FiveM", "/servers?platform=fivem"],
      ["Roblox", "/servers?platform=roblox"],
      ["Minecraft", "/servers?platform=minecraft"],
      ["Guides", "/guides"]
    ];
    nav.replaceChildren(...links.map(([label, href]) => {
      const link = document.createElement("a");
      link.href = href;
      link.textContent = label;
      if (location.pathname === href || (label === "Browse" && location.pathname === "/servers")) link.setAttribute("aria-current", "page");
      return link;
    }));
  }

  function setMenu(open, immediate = false) {
    if (!button || !menu) return;
    clearTimeout(closeTimer);

    if (!mobile.matches) {
      menu.hidden = false;
      menu.inert = false;
      menu.dataset.open = "true";
      menu.setAttribute("aria-hidden", "false");
      button.setAttribute("aria-expanded", "false");
      button.setAttribute("aria-label", "Open menu");
      document.body.classList.remove("menu-open");
      return;
    }

    button.setAttribute("aria-expanded", String(open));
    button.setAttribute("aria-label", open ? "Close menu" : "Open menu");
    menu.setAttribute("aria-hidden", String(!open));
    menu.inert = !open;
    document.body.classList.toggle("menu-open", open);

    if (open) {
      menu.hidden = false;
      requestAnimationFrame(() => { menu.dataset.open = "true"; });
      return;
    }

    menu.dataset.open = "false";
    if (immediate || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      menu.hidden = true;
      return;
    }
    closeTimer = window.setTimeout(() => { menu.hidden = true; }, 210);
  }

  button?.addEventListener("click", () => {
    setMenu(button.getAttribute("aria-expanded") !== "true");
  });
  menu?.querySelectorAll("a").forEach((link) => link.addEventListener("click", () => setMenu(false)));
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && button?.getAttribute("aria-expanded") === "true") {
      setMenu(false);
      button.focus();
    }
  });
  mobile.addEventListener?.("change", () => setMenu(false, true));
  setMenu(false, true);

  function updateHeader() {
    header?.classList.toggle("is-scrolled", window.scrollY > 8);
  }
  updateHeader();
  window.addEventListener("scroll", updateHeader, { passive: true });

  document.querySelectorAll("[data-current-year]").forEach((element) => {
    element.textContent = String(new Date().getFullYear());
  });

  function managedText(element, value) {
    if (!element || typeof value !== "string" || !value.trim()) return;
    const text = value.trim();
    if (element.dataset.contentAccent === "tail") {
      const words = text.split(/\s+/);
      const tailLength = Math.min(2, words.length);
      const lead = words.slice(0, -tailLength).join(" ");
      const accent = document.createElement("span");
      accent.textContent = words.slice(-tailLength).join(" ");
      element.replaceChildren(lead ? document.createTextNode(`${lead} `) : "", accent);
      return;
    }
    element.textContent = text;
  }

  async function updatePublishedContent() {
    try {
      const response = await fetch("/api/public/content", { headers: { Accept: "application/json" } });
      if (!response.ok) return;
      const payload = await response.json();
      const content = payload?.content && typeof payload.content === "object" ? payload.content : {};
      document.querySelectorAll("[data-content-key]").forEach((element) => {
        managedText(element, content[element.dataset.contentKey]);
      });

      if (content["announcement.enabled"] === true && typeof content["announcement.message"] === "string" && content["announcement.message"].trim()) {
        const announcement = document.createElement("div");
        announcement.className = "site-announcement";
        announcement.setAttribute("role", "status");
        announcement.textContent = content["announcement.message"].trim();
        header?.before(announcement);
      }
    } catch { /* Static defaults remain visible if managed content is unavailable. */ }
  }
  updatePublishedContent();

  async function updateAccountLinks() {
    try {
      const response = await fetch("/api/auth/session", { headers: { Accept: "application/json" } });
      const session = response.ok ? await response.json() : { authenticated: false };
      document.querySelectorAll("[data-account-link]").forEach((link) => {
        link.textContent = session.authenticated ? "My account" : "Sign in";
      });
    } catch {
      document.querySelectorAll("[data-account-link]").forEach((link) => { link.textContent = "Sign in"; });
    }
  }
  updateAccountLinks();
})();
