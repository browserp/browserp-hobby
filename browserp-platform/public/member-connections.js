(() => {
  "use strict";
  const names = { discord: "Discord", google: "Google" };
  const make = (tag, text, className = "") => { const element = document.createElement(tag); element.className = className; if (text !== undefined) element.textContent = text; return element; };
  function safeAuthorizationUrl(value, provider) {
    if (typeof value !== "string" || value.length > 12000 || /[\s\\]/.test(value)) return null;
    try {
      const url = new URL(value);
      if (url.protocol !== "https:" || url.username || url.password || url.port || url.hash) return null;
      const allowed = provider === "google" ? url.hostname === "accounts.google.com" && ["/o/oauth2/auth", "/o/oauth2/v2/auth"].includes(url.pathname)
        : provider === "discord" && url.hostname === "discord.com" && ["/oauth2/authorize", "/api/oauth2/authorize"].includes(url.pathname);
      return allowed ? url.href : null;
    } catch { return null; }
  }
  async function init({ api, root }) {
    if (!root || typeof api !== "function") return;
    root.className = "member-connections";
    const heading = make("h3", "Connected accounts");
    const status = make("p", "Loading account connections…", "member-connections-status"); status.setAttribute("role", "status");
    const grid = make("div", undefined, "member-connections-grid");
    root.replaceChildren(heading, status, grid); root.setAttribute("aria-busy", "true");
    try {
      const { connections } = await api("/api/me/connections");
      if (!connections || !Array.isArray(connections.providers)) throw new Error("Account connections could not be loaded.");
      status.textContent = connections.message || "Connect another sign-in method to this BrowseRP profile.";
      const result = new URLSearchParams(location.search).get("connections");
      if (result) {
        const confirmed = connections.providers.filter(provider => provider.connected).length > 1;
        const feedback = make("p", result === "linked" ? (confirmed ? "Your account connection was completed. Your current connections are shown below." : "Connection status refreshed. Your verified connections are shown below.") : "The connection was not completed. Your existing sign-in still works; you can try connecting again.", "member-connections-result"); feedback.setAttribute("role", "status"); root.insertBefore(feedback, grid);
      }
      let busy = false;
      for (const provider of ["discord", "google"]) {
        const item = connections.providers.find(value => value.provider === provider);
        if (!item) continue;
        const card = make("article", undefined, "member-connection");
        const title = make("div", undefined, "member-connection-title");
        const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg"); icon.setAttribute("aria-hidden", "true"); icon.setAttribute("focusable", "false");
        const use = document.createElementNS("http://www.w3.org/2000/svg", "use"); use.setAttribute("href", `/assets/provider-icons-v4.svg#provider-${provider}`); icon.append(use);
        title.append(icon, make("strong", names[provider])); card.append(title);
        if (item.connected) card.append(make("span", "Connected", "member-connected-badge"));
        else if (!connections.canManage || !item.canConnect || !item.enabled) card.append(make("p", "Connection unavailable", "member-connection-unavailable"));
        else {
          const connect = make("button", `Connect ${names[provider]}`, "button button-secondary"); connect.type = "button";
          connect.addEventListener("click", async () => {
            if (busy) return;
            busy = true; grid.querySelectorAll("button").forEach(button => { button.disabled = true; });
            status.textContent = `Opening ${names[provider]} to approve the connection…`;
            try {
              const response = await api("/api/me/connections", { method: "POST", body: JSON.stringify({ provider, returnTo: location.pathname === "/dashboard" ? "/dashboard" : "/profile" }) });
              const destination = safeAuthorizationUrl(response.authorizationUrl, provider);
              if (!destination) throw new Error("The provider returned an invalid connection page. Please try again later.");
              location.assign(destination);
            } catch (error) { status.textContent = error.message || "The connection could not be started. Please try again."; }
            finally { busy = false; grid.querySelectorAll("button").forEach(button => { button.disabled = false; }); }
          });
          card.append(connect);
        }
        grid.append(card);
      }
      if (connections.canManage) root.append(make("p", "You’ll approve each connection with the provider. Your listings and profile remain attached to this BrowseRP account.", "member-connections-help"));
    } catch (error) {
      status.textContent = error.message || "Account connections could not be loaded.";
      const retry = make("button", "Retry connections", "button button-secondary"); retry.type = "button"; retry.addEventListener("click", () => init({ api, root })); root.append(retry);
    } finally { root.removeAttribute("aria-busy"); }
  }
  window.BrowseRPMemberConnections = Object.freeze({ init, safeAuthorizationUrl });
})();
