(() => {
  "use strict";

  const header = document.querySelector("[data-site-header]");
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
