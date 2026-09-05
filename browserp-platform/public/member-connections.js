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
    const returnTo = location.pathname === "/dashboard" ? "/dashboard" : "/profile";
    const signInLinks = (providers) => {
      const actions = make("div", undefined, "member-connection-actions");
      for (const provider of providers.filter(value => Object.hasOwn(names, value))) {
        const link = make("a", `Sign in with ${names[provider]}`, "button button-secondary");
        link.href = `/api/auth/${provider}?returnTo=${encodeURIComponent(returnTo)}`; actions.append(link);
      }
      return actions;
    };
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
      const usableProviders = connections.providers.filter(item => item.connected && item.enabled).map(item => item.provider);
      const endSession = (reason, providers) => window.dispatchEvent(new CustomEvent("browserp:session-ended", {
        detail: { reason, remainingProviders: [...new Set(providers.filter(provider => Object.hasOwn(names, provider)))] }
      }));
      const setBusy = (value) => { busy = value; grid.querySelectorAll("button").forEach(button => { button.disabled = value; }); };
      const actionFailed = (error, signIns = usableProviders, disconnectedSession = false) => {
        status.textContent = error.message || "The account change could not be completed. Refresh your connections before trying again.";
        if ([401, 428].includes(error.status)) {
          grid.replaceChildren(signInLinks(signIns));
          if (error.status === 401 && disconnectedSession) endSession("connection-unconfirmed", signIns);
        }
      };
      if (connections.canManage && connections.reauthenticationRequired) root.append(signInLinks(usableProviders));
      for (const provider of ["discord", "google"]) {
        const item = connections.providers.find(value => value.provider === provider);
        if (!item) continue;
        const card = make("article", undefined, "member-connection");
        const title = make("div", undefined, "member-connection-title");
        const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg"); icon.setAttribute("aria-hidden", "true"); icon.setAttribute("focusable", "false");
        const use = document.createElementNS("http://www.w3.org/2000/svg", "use"); use.setAttribute("href", `/assets/provider-icons-v4.svg#provider-${provider}`); icon.append(use);
        title.append(icon, make("strong", names[provider])); card.append(title);
        if (item.connected) {
          card.append(make("span", "Connected", "member-connected-badge"));
          if (connections.canManage && item.canDisconnect && item.identityId) {
            const disconnect = make("button", `Disconnect ${names[provider]}`, "button button-secondary"); disconnect.type = "button";
            disconnect.addEventListener("click", () => {
              if (busy) return;
              disconnect.hidden = true;
              const confirmation = make("div", undefined, "member-connection-confirmation");
              confirmation.setAttribute("role", "group"); confirmation.setAttribute("aria-label", `Disconnect ${names[provider]}?`);
              const remaining = usableProviders.filter(value => value !== provider);
              confirmation.append(make("p", `Disconnect ${names[provider]}? You’ll be signed out on all devices. Use ${remaining.map(value => names[value]).join(" or ")} to sign back in. Your profile and listings stay with BrowseRP.`));
              const keep = make("button", "Keep connected", "button button-secondary"); keep.type = "button";
              const confirm = make("button", `Disconnect ${names[provider]}`, "button button-secondary"); confirm.type = "button";
              keep.addEventListener("click", () => { if (busy) return; confirmation.remove(); disconnect.hidden = false; disconnect.focus(); });
              confirm.addEventListener("click", async () => {
                if (busy) return; setBusy(true); status.textContent = `Disconnecting ${names[provider]}…`;
                try {
                  const result = await api("/api/me/connections", { method: "POST", body: JSON.stringify({ action: "disconnect", accountId: connections.accountId, provider, identityId: item.identityId }) });
                  if (result.disconnected !== true || !Array.isArray(result.signInProviders)) throw new Error("The change could not be confirmed. Refresh your connections before trying again.");
                  grid.replaceChildren(signInLinks(result.signInProviders));
                  status.textContent = result.sessionsEnded === true ? `${names[provider]} disconnected. You’ve been signed out on all devices. Sign in below to continue.` : `${names[provider]} disconnected. You’re signed out here, but we couldn’t confirm sign-out on your other devices. Sign in again to review your account.`;
                  status.tabIndex = -1; status.focus();
                  endSession(result.sessionsEnded === true ? "connection-removed" : "connection-removed-local", result.signInProviders);
                } catch (error) { actionFailed(error, remaining, true); }
                finally { setBusy(false); }
              });
              confirmation.append(keep, confirm); card.append(confirmation); keep.focus();
            });
            card.append(disconnect);
          }
        }
        else if (!connections.canManage || !item.canConnect || !item.enabled) card.append(make("p", "Connection unavailable", "member-connection-unavailable"));
        else {
          const connect = make("button", `Connect ${names[provider]}`, "button button-secondary"); connect.type = "button";
          connect.addEventListener("click", async () => {
            if (busy) return;
            setBusy(true);
            status.textContent = `Opening ${names[provider]} to approve the connection…`;
            try {
              const response = await api("/api/me/connections", { method: "POST", body: JSON.stringify({ provider, accountId: connections.accountId, returnTo }) });
              const destination = safeAuthorizationUrl(response.authorizationUrl, provider);
              if (!destination) throw new Error("The provider returned an invalid connection page. Please try again later.");
              location.assign(destination);
            } catch (error) { actionFailed(error); }
            finally { setBusy(false); }
          });
          card.append(connect);
        }
        grid.append(card);
      }
      if (connections.canManage) root.append(make("p", "You’ll approve each connection with the provider. Your listings and profile remain attached to this BrowseRP account.", "member-connections-help"));
    } catch (error) {
      status.textContent = error.message || "Account connections could not be loaded.";
      if ([401, 428].includes(error.status)) {
        try {
          const configured = await api("/api/auth/providers");
          const providers = Object.keys(names).filter(provider => configured.providers?.[provider] === true);
          if (providers.length) {
            root.append(make("p", "Use an account already connected to your BrowseRP profile.", "member-connections-help"), signInLinks(providers));
            return;
          }
        } catch { /* Keep the retry when provider availability is unknown. */ }
      }
      const retry = make("button", "Retry connections", "button button-secondary"); retry.type = "button"; retry.addEventListener("click", () => init({ api, root })); root.append(retry);
    } finally { root.removeAttribute("aria-busy"); }
  }
  window.BrowseRPMemberConnections = Object.freeze({ init, safeAuthorizationUrl });
})();
