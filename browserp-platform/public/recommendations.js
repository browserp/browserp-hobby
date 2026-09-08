(() => {
  "use strict";
  const KEY = "browserp-recommendations-v1";
  const TTL = 30 * 24 * 60 * 60 * 1000;
  const games = new Set(["fivem", "redm", "minecraft", "roblox"]);
  function region(value) {
    const text = typeof value === "string" ? value.trim().slice(0, 60) : "";
    if (/^(uk|gb|gbr|united kingdom|great britain)$/i.test(text)) return "United Kingdom";
    if (/^(us|usa|united states(?: of america)?)$/i.test(text)) return "United States";
    return /^[\p{L} .'-]{2,60}$/u.test(text) && !/^(all|unknown|global|international|not specified)$/i.test(text) ? text : "";
  }
  function create(storage, now = Date.now) {
    function read() {
      try {
        const data = JSON.parse(storage.getItem(KEY) || "null");
        if (data?.enabled !== true) return { enabled: false, views: [] };
        const views = (Array.isArray(data.views) ? data.views : []).filter(v => v && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(v.slug) && v.slug.length <= 160 && games.has(v.game) && region(v.region) && Number.isFinite(v.at) && v.at <= now() && v.at > now() - TTL).slice(0, 80).map(v => ({ slug: v.slug, game: v.game, region: region(v.region), at: v.at }));
        return { enabled: true, views };
      } catch { return { enabled: false, views: [] }; }
    }
    function save(data) { try { storage.setItem(KEY, JSON.stringify(data)); return true; } catch { return false; } }
    function enable(value) {
      if (value) return save({ enabled: true, views: read().views });
      try { storage.removeItem(KEY); return true; } catch { return false; }
    }
    function record(server) {
      const data = read(), slug = server?.slug, game = server?.platform_id, area = region(server?.region);
      if (!data.enabled || !games.has(game) || !area || typeof slug !== "string" || slug.length > 160 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) return false;
      if (data.views.some(v => v.slug === slug && now() - v.at < 30 * 60 * 1000)) return false;
      data.views.unshift({ slug, game, region: area, at: now() }); data.views = data.views.slice(0, 80);
      return save(data);
    }
    function preferred(game) {
      const views = read().views.filter(v => !game || v.game === game);
      if (views.length < 3) return "";
      const scores = new Map();
      views.forEach(v => scores.set(v.region, (scores.get(v.region) || 0) + Math.pow(0.5, (now() - v.at) / (7 * 86400000))));
      return [...scores].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] || "";
    }
    function rank(servers, filters = {}) {
      if ((filters.sort && filters.sort !== "recommended") || filters.query || (filters.region && filters.region !== "all")) return [...servers];
      const area = preferred(filters.platform === "all" ? undefined : filters.platform);
      return area ? servers.map((server, index) => ({ server, index })).sort((a, b) => Number(region(b.server.region) === area) - Number(region(a.server.region) === area) || a.index - b.index).map(row => row.server) : [...servers];
    }
    return { read, enable, record, preferred, rank, clear: () => read().enabled ? save({ enabled: true, views: [] }) : enable(false), prune: () => { const data = read(); if (data.enabled) save(data); } };
  }
  globalThis.BrowseRPRecommendationModel = { create, region, key: KEY };
  const CHOICE_KEY = "browserp-cookie-choice-v1";
  const ACCOUNT_KEY = "browserp-consent-account-v1";
  const DECISION_KEY = "browserp-consent-decision-v1";
  // A short-lived confirmation gates *all* optional reads and writes. Cached
  // acceptance is never sufficient while account identity or the API is unknown.
  function createConsent({ storage, model, request, now = Date.now, changed = () => {} }) {
    let generation = 0, csrf = "", verifiedUntil = 0, rejectionPending = false;
    let state = { phase: "loading", accountId: null, choice: null, version: 0, enabled: false, localSaveFailed: false };
    const localChoice = () => storage.getItem(CHOICE_KEY);
    const enabled = () => {
      try { return !rejectionPending && state.enabled && now() < verifiedUntil && localChoice() !== "rejected" && storage.getItem(ACCOUNT_KEY) === (state.accountId || "guest"); }
      catch { return false; }
    };
    const notify = () => changed();
    function pause(phase = "loading") { generation++; verifiedUntil = 0; state = { ...state, phase, enabled: false }; notify(); }
    function fail() { verifiedUntil = 0; state = { ...state, phase: "error", enabled: false }; notify(); }
    function clear() { if (!model.enable(false)) throw Error("Local history could not be cleared"); }
    function validate(value, accountId) {
      if (value?.accountId !== accountId || value.schemaVersion !== 1 || ![null, "accepted", "rejected"].includes(value.choice)
        || !Number.isSafeInteger(value.version) || value.version < 0 || (value.choice === null) !== (value.version === 0)) throw Error("Invalid preference response");
      return value;
    }
    async function remote(choice, version, accountId) {
      return validate(await request("/api/me/preferences", {
        method: "POST", headers: { "X-BrowseRP-Account": accountId, "X-BrowseRP-CSRF": csrf },
        body: JSON.stringify({ schemaVersion: 1, choice, expectedVersion: version })
      }), accountId);
    }
    function ready(choice, version, allow) {
      if (allow) { if (!model.enable(true)) throw Error("Local preference could not be saved"); }
      else clear();
      state = { ...state, phase: "ready", choice, version, enabled: allow, localSaveFailed: false };
      verifiedUntil = now() + 30000; notify();
    }
    async function sync() {
      pause(); const ticket = generation;
      try {
        const session = await request("/api/auth/session");
        if (ticket !== generation) return;
        if (typeof session?.authenticated !== "boolean") throw Error("Account unavailable");
        const accountId = session.authenticated ? session.user?.id : null;
        if (session.authenticated && (typeof accountId !== "string" || !/^[0-9a-f-]{36}$/i.test(accountId))) throw Error("Account unavailable");
        const binding = accountId || "guest", previous = storage.getItem(ACCOUNT_KEY);
        if (previous !== binding) {
          // Never carry another account's (or a guest's) history into an account.
          // Rejection survives account changes; acceptance must be checked anew.
          if (previous !== null || accountId) {
            clear();
            if (localChoice() === "accepted") storage.removeItem(CHOICE_KEY);
          }
          storage.setItem(ACCOUNT_KEY, binding);
        }
        state = { ...state, accountId, choice: null, version: 0 };
        csrf = session.csrfToken || "";
        if (!accountId) {
          if (rejectionPending) storage.setItem(CHOICE_KEY, "rejected");
          const choice = localChoice();
          ready(choice, 0, choice !== "rejected" && (choice === "accepted" || model.read().enabled));
          return;
        }
        let value = validate(await request("/api/me/preferences", { headers: { "X-BrowseRP-Account": accountId } }), accountId);
        if (ticket !== generation) return;
        if ((rejectionPending || localChoice() === "rejected") && value.choice !== "rejected") {
          clear(); value = await remote("rejected", value.version, accountId);
          if (ticket !== generation) return;
        }
        if (value.choice === "rejected") storage.setItem(CHOICE_KEY, "rejected");
        ready(value.choice, value.version, value.choice === "accepted" && !rejectionPending && localChoice() !== "rejected");
      } catch { if (ticket === generation) fail(); }
    }
    function choose(allow) {
      const confirmedGuest = state.phase === "ready" && state.accountId === null && now() < verifiedUntil;
      // Local rejection takes effect even if removing storage or contacting the
      // server fails. Keep the tombstone so a future remote read cannot opt in.
      if (!allow) {
        rejectionPending = true;
        pause("saving");
        state.localSaveFailed = false;
        for (const attempt of [() => storage.setItem(CHOICE_KEY, "rejected"), () => storage.setItem(DECISION_KEY, `${now()}:${Math.random()}`), clear]) {
          try { attempt(); } catch { state.localSaveFailed = true; }
        }
      } else if (state.phase !== "ready" || now() >= verifiedUntil) {
        fail(); return false;
      }
      if (state.accountId === null) {
        if (!allow && !confirmedGuest) {
          // Identity may still be unknown; recheck before treating it as guest.
          void sync(); return !state.localSaveFailed;
        }
        try { storage.setItem(CHOICE_KEY, allow ? "accepted" : "rejected"); if (allow) rejectionPending = false; ready(allow ? "accepted" : "rejected", 0, allow); return true; }
        catch { state.localSaveFailed = true; fail(); return false; }
      }
      const accountId = state.accountId, version = state.version;
      if (allow) pause("saving");
      const ticket = generation;
      let decision;
      try { decision = storage.getItem(DECISION_KEY); } catch { fail(); return false; }
      void (async () => {
        try {
          const value = await remote(allow ? "accepted" : "rejected", version, accountId);
          if (ticket !== generation) return;
          if (storage.getItem(ACCOUNT_KEY) !== accountId || (allow && storage.getItem(DECISION_KEY) !== decision)) throw Error("Choice or account changed");
          if (value.choice !== (allow ? "accepted" : "rejected")) throw Error("Preference was not saved");
          if (state.localSaveFailed) throw Error("Local preference was not saved");
          storage.setItem(CHOICE_KEY, allow ? "accepted" : "rejected");
          if (allow) rejectionPending = false;
          ready(value.choice, value.version, allow);
        } catch { if (ticket === generation) fail(); }
      })();
      notify(); return !state.localSaveFailed;
    }
    return { sync, pause, choose, enabled, getState: () => ({ ...state, enabled: enabled() }) };
  }
  globalThis.BrowseRPConsentModel = { create: createConsent, choiceKey: CHOICE_KEY, accountKey: ACCOUNT_KEY, decisionKey: DECISION_KEY };
  if (typeof document === "undefined" || location.pathname.startsWith("/staffpanel")) return;
  let storage;
  try { storage = localStorage; } catch { storage = { getItem: () => null, setItem: () => { throw Error("Storage unavailable"); }, removeItem: () => {} }; }
  const localModel = create(storage);
  async function preferenceRequest(path, options = {}) {
    const abort = new AbortController(), timeout = setTimeout(() => abort.abort(), 10000);
    try {
      const response = await fetch(path, { ...options, credentials: "same-origin", cache: "no-store", signal: abort.signal,
        headers: { Accept: "application/json", ...(options.body ? { "Content-Type": "application/json" } : {}), ...options.headers } });
      if (!response.ok) throw Error("Preference unavailable");
      return await response.json();
    } finally { clearTimeout(timeout); }
  }
  const consent = createConsent({ storage, model: localModel, request: preferenceRequest, changed });
  const collectionAllowed = () => !document.hidden && consent.enabled();
  const model = { ...localModel,
    read: () => collectionAllowed() ? localModel.read() : { enabled: false, views: [] },
    record: server => collectionAllowed() && localModel.record(server),
    preferred: game => collectionAllowed() ? localModel.preferred(game) : "",
    rank: (servers, filters) => collectionAllowed() ? localModel.rank(servers, filters) : [...servers],
    enable: value => consent.choose(Boolean(value)),
    getConsentState: () => ({ ...consent.getState(), enabled: collectionAllowed() })
  };
  let choiceSaveFailed = false;
  function hasCookieChoice() {
    try { if (["accepted", "rejected"].includes(storage.getItem(CHOICE_KEY))) return true; } catch {}
    // Earlier explicit recommendation opt-ins already establish a choice.
    return model.read().enabled;
  }
  function chooseRecommendations(enabled) {
    const okay = consent.choose(enabled); choiceSaveFailed = !okay; return okay;
  }
  window.BrowseRPRecommendations = model;
  const el = (tag, className, text) => { const item = document.createElement(tag); item.className = className; if (text) item.textContent = text; return item; };
  let section, results, message, request = 0, controller;
  const routeGame = /^\/games\/(fivem|redm|roblox|minecraft)$/.exec(location.pathname)?.[1];
  function changed() { window.dispatchEvent(new Event("browserp:recommendations-changed")); }
  function consentStatus() {
    const state = consent.getState();
    if (state.localSaveFailed) return "Recommendations are off. Your browser could not save this choice or clear its history. Clear BrowseRP site data in browser settings.";
    if (state.phase === "error") return "Recommendations are off because your preference could not be checked or saved. Reopen this page to try again; other devices may still have their previous choice.";
    if (state.phase === "loading") return "Recommendations are off while we check your account and preference.";
    if (state.phase === "saving") return "Recommendations are off while your account preference is saved.";
    if (state.accountId && state.choice === null) return "Recommendations are off. Choose whether to save this preference to your account.";
    return state.enabled ? state.accountId ? "Recommendations are on. Your account saves this choice; history stays on this browser." : "Recommendations are on for this browser."
      : state.accountId ? "Recommendations are off and their local history has been cleared. Your account saves this choice." : "Recommendations are off for this browser and their history has been cleared.";
  }
  function controls(root) {
    if (root.dataset.recommendationMounted) return;
    root.dataset.recommendationMounted = "true";
    const heading = el("h3", "", "Your discovery preferences");
    const copy = el("p", "", "Use the servers you view on BrowseRP to suggest communities in regions you enjoy. Your signed-in account saves this optional choice. Viewing history stays on this browser for up to 30 days; it is never uploaded.");
    const label = el("label", "recommendation-toggle");
    const input = document.createElement("input"); input.type = "checkbox"; input.checked = model.read().enabled;
    label.append(input, el("span", "", "Personalise with my BrowseRP history"));
    const clear = el("button", "button-v3 button-secondary-v3", "Clear recommendation history"); clear.type = "button";
    const status = el("p", "recommendation-status"); status.setAttribute("role", "status");
    input.addEventListener("change", () => { chooseRecommendations(input.checked); input.checked = model.read().enabled; changed(); });
    clear.addEventListener("click", () => { status.textContent = model.clear() ? "Recommendation history cleared." : "Your browser could not clear this history."; changed(); });
    root.classList.add("recommendation-settings"); root.replaceChildren(heading, copy, label, clear, status);
    window.addEventListener("browserp:recommendations-changed", () => { input.checked = model.read().enabled; clear.disabled = !model.read().views.length; status.textContent = consentStatus(); });
    status.textContent = consentStatus();
    clear.disabled = !model.read().views.length;
  }
  model.mountSettings = root => root?.querySelectorAll("[data-recommendation-settings]").forEach(controls);
  let preferenceDialog, preferenceStatus, preferenceTrigger;
  function preferenceState() {
    if (preferenceStatus) preferenceStatus.textContent = consentStatus();
  }
  function openCookiePreferences(trigger) {
    if (!preferenceDialog) {
      preferenceDialog = el("dialog", "cookie-preferences-v3");
      preferenceDialog.setAttribute("aria-labelledby", "cookie-preferences-title");
      preferenceDialog.setAttribute("aria-describedby", "cookie-preferences-intro");
      const heading = el("h2", "", "Cookie preferences"); heading.id = "cookie-preferences-title";
      const intro = el("p", "", "Essential cookies keep sign-in and security working and stay on. BrowseRP does not use advertising or optional analytics cookies."); intro.id = "cookie-preferences-intro";
      const detail = el("p", "", "You can choose whether recommendations remember the BrowseRP servers you view, using local storage on this browser for up to 30 days. Rejecting turns recommendations off and clears their history.");
      const scope = el("p", "", "Guests choose for this browser. Signed-in accounts save the choice across devices, but viewing history is never uploaded. A rejection on this browser keeps recommendations off until you explicitly accept here. Other devices check for changes when active; an offline device cannot receive a change immediately. Theme, Recently viewed and Compare have separate controls.");
      preferenceStatus = el("p", "cookie-preferences-status-v3"); preferenceStatus.setAttribute("role", "status");
      const choices = el("div", "cookie-preferences-choices-v3");
      for (const [label, enabled] of [["Accept recommendations", true], ["Reject recommendations", false]]) {
        const button = el("button", "button-v3 button-secondary-v3", label); button.type = "button";
        button.addEventListener("click", () => {
          chooseRecommendations(enabled); changed();
        });
        choices.append(button);
      }
      const links = el("p", "cookie-preferences-links-v3");
      for (const [label, href] of [["Cookie policy", "/legal#cookies"], ["Privacy policy", "/privacy"]]) {
        const link = el("a", "", label); link.href = href; links.append(link);
      }
      const close = el("button", "button-v3 button-quiet-v3", "Close preferences"); close.type = "button"; close.autofocus = true;
      close.addEventListener("click", () => preferenceDialog.close());
      preferenceDialog.addEventListener("keydown", event => {
        if (event.key !== "Tab") return;
        const items = preferenceDialog.querySelectorAll('button:not([disabled]), a[href]');
        const first = items[0], last = items[items.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
      });
      preferenceDialog.addEventListener("click", event => {
        if (event.target !== preferenceDialog) return;
        const box = preferenceDialog.getBoundingClientRect();
        if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) preferenceDialog.close();
      });
      preferenceDialog.addEventListener("close", () => {
        if (preferenceTrigger?.isConnected && !preferenceTrigger.closest("[hidden]")) preferenceTrigger.focus();
        else document.querySelector("[data-cookie-preferences]")?.focus({ preventScroll: true });
      });
      preferenceDialog.append(heading, intro, detail, scope, preferenceStatus, choices, links, close);
      document.body.append(preferenceDialog);
    }
    preferenceTrigger = trigger;
    preferenceState();
    if (!preferenceDialog.open) preferenceDialog.showModal();
  }
  model.mountCookiePreferences = root => {
    const policy = root?.querySelector('a[href="/legal#cookies"]');
    if (!policy || root.querySelector("[data-cookie-preferences]")) return;
    const button = el("button", "cookie-preferences-trigger-v3", "Cookie preferences"); button.type = "button";
    button.dataset.cookiePreferences = ""; button.setAttribute("aria-haspopup", "dialog");
    button.addEventListener("click", () => openCookiePreferences(button));
    policy.after(button);
  };
  window.addEventListener("browserp:recommendations-changed", preferenceState);
  function appearanceChoice() {
    if (!document.querySelector("link[data-first-visit-appearance]")) {
      const styles = el("link", ""); styles.rel = "stylesheet";
      styles.href = "/first-visit-appearance.css?v=20260908"; styles.dataset.firstVisitAppearance = "";
      document.head.append(styles);
    }
    const group = el("div", "first-visit-appearance");
    group.setAttribute("role", "group"); group.setAttribute("aria-labelledby", "first-visit-appearance-title");
    group.setAttribute("aria-describedby", "first-visit-appearance-hint");
    const title = el("h3", "first-visit-appearance-title", "Appearance"); title.id = "first-visit-appearance-title";
    const hint = el("p", "first-visit-appearance-hint", "Your theme is separate from recommendation preferences."); hint.id = "first-visit-appearance-hint";
    const choices = el("div", "first-visit-appearance-choices");
    function update(theme) {
      for (const button of choices.children) button.setAttribute("aria-pressed", String(button.dataset.appearanceChoice === theme));
    }
    for (const theme of ["dark", "light"]) {
      const button = el("button", "first-visit-appearance-choice", theme === "dark" ? "Dark" : "Light");
      button.type = "button"; button.dataset.appearanceChoice = theme;
      button.addEventListener("click", () => {
        if (window.BrowseRPTheme?.set) {
          update(window.BrowseRPTheme.set(theme));
          return;
        }
        // Keep appearance usable if the public page controller has not loaded.
        document.documentElement.dataset.theme = theme;
        document.documentElement.style.colorScheme = theme;
        const colour = document.querySelector('meta[name="theme-color"]');
        if (colour) colour.content = theme === "light" ? "#f8f5f8" : "#050507";
        try { storage.setItem("browserp-theme", theme); } catch { /* The visible choice still applies for this page. */ }
        window.dispatchEvent(new CustomEvent("browserp:theme-changed", { detail: { theme } }));
      });
      choices.append(button);
    }
    let theme = document.documentElement.dataset.theme;
    if (theme !== "light" && theme !== "dark") {
      try { theme = storage.getItem("browserp-theme"); } catch { /* Dark is the default. */ }
    }
    update(theme === "light" ? "light" : "dark");
    window.addEventListener("browserp:theme-changed", event => {
      if (event.detail?.theme === "light" || event.detail?.theme === "dark") update(event.detail.theme);
    });
    group.append(title, choices, hint);
    return group;
  }
  function cookiePrompt() {
    if (hasCookieChoice() || document.querySelector("[data-cookie-prompt]")) return;
    const prompt = el("section", "cookie-prompt-v3"); prompt.dataset.cookiePrompt = "";
    prompt.setAttribute("role", "region"); prompt.setAttribute("aria-labelledby", "cookie-prompt-title");
    const copy = el("div", "cookie-prompt-copy-v3");
    const title = el("h2", "", "Cookie preferences"); title.id = "cookie-prompt-title";
    const description = el("p", "", "Essential cookies keep sign-in and security working. Optional recommendations remember BrowseRP server views on this browser for up to 30 days and stay off unless you accept. No advertising or optional analytics cookies.");
    const links = el("p", "cookie-preferences-links-v3");
    for (const [label, href] of [["Cookie policy", "/legal#cookies"], ["Privacy policy", "/privacy"]]) {
      const link = el("a", "", label); link.href = href; links.append(link);
    }
    const status = el("p", "cookie-prompt-status-v3"); status.setAttribute("role", "status"); status.hidden = true;
    copy.append(title, description, links, status, appearanceChoice());
    const actions = el("div", "cookie-prompt-actions-v3");
    for (const [label, enabled] of [["Accept recommendations", true], ["Reject recommendations", false]]) {
      const button = el("button", "button-v3 button-secondary-v3", label); button.type = "button";
      button.addEventListener("click", () => {
        const okay = chooseRecommendations(enabled); changed();
        if (!okay) {
          status.hidden = false;
          status.textContent = `Your browser could not remember this choice. Recommendations are currently ${model.read().enabled ? "on" : "off"}. You can keep browsing; this notice may return.`;
          reserveSpace();
        }
      });
      actions.append(button);
    }
    const manage = el("button", "button-v3 button-quiet-v3", "Manage preferences"); manage.type = "button";
    manage.setAttribute("aria-haspopup", "dialog"); manage.addEventListener("click", () => openCookiePreferences(manage));
    actions.append(manage); prompt.append(copy, actions);
    const spacer = el("div", "cookie-prompt-spacer-v3"); spacer.setAttribute("aria-hidden", "true");
    document.body.append(spacer, prompt);
    function reserveSpace() {
      const height = prompt.hidden ? 0 : Math.ceil(prompt.getBoundingClientRect().height) + 32;
      spacer.style.height = `${height}px`;
      document.documentElement.style.setProperty("--cookie-prompt-space", `${height}px`);
    }
    function update() {
      const dismiss = !choiceSaveFailed && hasCookieChoice();
      if (dismiss && prompt.contains(document.activeElement)) document.querySelector("[data-cookie-preferences]")?.focus({ preventScroll: true });
      prompt.hidden = dismiss; spacer.hidden = dismiss; reserveSpace();
    }
    window.addEventListener("browserp:recommendations-changed", update);
    if (typeof ResizeObserver === "function") new ResizeObserver(reserveSpace).observe(prompt);
    else window.addEventListener("resize", reserveSpace);
    reserveSpace();
  }
  async function refresh() {
    if (!section) return;
    const id = ++request; controller?.abort(); results.replaceChildren(); results.hidden = true;
    const enabled = model.read().enabled;
    const area = model.preferred(routeGame);
    section.querySelector("[data-enable-recommendations]").hidden = enabled;
    section.querySelector("[data-reset-recommendations]").hidden = !enabled;
    message.textContent = !enabled ? consent.getState().phase !== "ready" ? consentStatus() : "Discover more communities in the regions you enjoy. Turn on optional recommendations; viewing history stays on this browser." : !area ? "As you explore a few server pages, communities from your favourite regions will appear here." : `More ${area} communities, based on the servers you viewed on BrowseRP.`;
    if (!enabled || !area) return;
    controller = new AbortController();
    const currentController = controller;
    const timeout = setTimeout(() => currentController.abort(), 10000);
    try {
      const params = new URLSearchParams({ region: area, sort: "recommended", limit: "3", ...(routeGame ? { platform: routeGame } : {}) });
      const response = await fetch(`/api/servers?${params}`, { credentials: "same-origin", signal: controller.signal });
      if (!response.ok) throw Error("Unavailable");
      const data = await response.json();
      if (id !== request || !model.read().enabled) return;
      const servers = (Array.isArray(data.servers) ? data.servers : []).filter(server => region(server.region) === area && (!routeGame || server.platform_id === routeGame)).slice(0, 3);
      window.BrowseRPDirectory?.render(results, servers); results.hidden = !servers.length;
      results.querySelectorAll(".reveal-v3").forEach(card => card.classList.add("is-revealed"));
      if (!servers.length) message.textContent = `No published ${area} communities are available right now. Your usual directory is unchanged.`;
    } catch { if (id === request) message.textContent = "Recommendations are taking a moment. You can still browse the full directory below."; }
    finally { clearTimeout(timeout); }
  }
  function init() {
    void consent.sync();
    model.mountCookiePreferences(document.querySelector(".footer-v3"));
    cookiePrompt();
    document.querySelectorAll("[data-recommendation-settings]").forEach(controls);
    const page = document.body.dataset.page;
    const anchor = page === "home" ? document.querySelector("#featured-server-list")?.closest("section") : document.querySelector("#discovery-controls, #game-discovery-controls");
    if (!anchor || (location.pathname.startsWith("/games/") && !routeGame)) return;
    section = el("section", "recommendations-v7"); section.setAttribute("aria-label", "Personalised discovery");
    const inner = el("div", page === "home" ? "shell-v3" : "");
    const head = el("div", "recommendation-heading"); const copy = el("div", "");
    copy.append(el("span", "eyebrow-v3", "Your discovery"), el("h2", "", "For you"));
    message = el("p", "recommendation-message"); copy.append(message);
    const actions = el("div", "recommendation-actions");
    const enable = el("button", "button-v3 button-secondary-v3", "Enable recommendations"); enable.type = "button"; enable.dataset.enableRecommendations = "";
    enable.addEventListener("click", () => { const okay = chooseRecommendations(true); changed(); if (!okay) message.textContent = "Your browser could not save this preference. Check your discovery preferences before continuing."; });
    const reset = el("button", "button-v3 button-quiet-v3", "Turn off & clear"); reset.type = "button"; reset.dataset.resetRecommendations = "";
    reset.addEventListener("click", () => { const okay = chooseRecommendations(false); changed(); if (!okay) message.textContent = "Your browser could not clear this preference. Please clear BrowseRP site data in browser settings."; });
    actions.append(enable, reset); head.append(copy, actions);
    results = el("div", "recommendation-results"); results.hidden = true; inner.append(head, results); section.append(inner); anchor.before(section);
    refresh();
  }
  window.addEventListener("browserp:recommendations-changed", refresh);
  window.addEventListener("storage", event => {
    if ([KEY, CHOICE_KEY, ACCOUNT_KEY, DECISION_KEY, null].includes(event.key)) { consent.pause(); void consent.sync(); }
  });
  window.addEventListener("browserp:session-ended", () => { consent.pause(); localModel.enable(false); });
  window.addEventListener("pagehide", () => consent.pause());
  window.addEventListener("focus", () => { if (!document.hidden) void consent.sync(); });
  window.addEventListener("pageshow", event => { if (event.persisted && !document.hidden) void consent.sync(); });
  document.addEventListener("visibilitychange", () => { if (document.hidden) consent.pause(); else void consent.sync(); });
  setInterval(() => { if (!document.hidden && consent.getState().phase !== "saving") void consent.sync(); }, 30000);
  document.addEventListener("DOMContentLoaded", init, { once: true });
})();
