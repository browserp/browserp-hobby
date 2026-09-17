(() => {
  "use strict";

  const AVAILABILITY = Object.freeze({ available: "Available", busy: "Busy", away: "Away" });
  const shortTimestamp = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  let active = null;

  const make = (tag, text, className = "") => {
    const element = document.createElement(tag);
    if (text !== undefined) element.textContent = String(text);
    if (className) element.className = className;
    return element;
  };
  const requestKey = () => typeof globalThis.crypto?.randomUUID === "function"
    ? globalThis.crypto.randomUUID()
    : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, character => {
      const random = Math.random() * 16 | 0;
      return (character === "x" ? random : random & 3 | 8).toString(16);
    });
  const label = value => AVAILABILITY[value] || "Away";
  const validDate = value => typeof value === "string" && Number.isFinite(new Date(value).getTime());

  async function init({ api, root = document.querySelector("#overview-duty"), onAuthFailure } = {}) {
    if (typeof api !== "function" || !root) return null;
    active?.destroy();
    const state = { accountId: "", self: null, roster: [], nextAfterUserId: null, busy: false, destroyed: false, request: 0, notice: "" };
    const cleanup = [];
    const listen = (element, event, callback) => { element?.addEventListener(event, callback); cleanup.push(() => element?.removeEventListener(event, callback)); };
    const live = (text, mode = "live") => {
      const target = root.querySelector("[data-duty-live]");
      if (!target) return;
      target.textContent = text;
      target.dataset.state = mode;
    };
    const call = (path, options = {}) => api(path, {
      ...options,
      headers: { ...(options.headers || {}), "X-BrowseRP-Account": state.accountId }
    });
    const setBusy = value => {
      state.busy = value;
      root.setAttribute("aria-busy", String(value));
      root.querySelectorAll("button").forEach(button => { button.disabled = value; });
    };
    const availabilityControls = () => {
      const section = make("section", undefined, "staff-duty-card staff-duty-state-card");
      section.append(make("span", "Your availability", "eyebrow-v3"), make("h3", label(state.self?.duty?.availability)));
      const choices = make("div", undefined, "staff-duty-choices");
      choices.setAttribute("aria-label", "Set your availability");
      for (const [value, text] of Object.entries(AVAILABILITY)) {
        const button = make("button", text, "staff-duty-choice");
        button.type = "button";
        button.setAttribute("aria-pressed", String(state.self?.duty?.availability === value));
        listen(button, "click", () => { void updateAvailability(value); });
        choices.append(button);
      }
      section.append(choices, make("p", "Choose the status teammates should see. Staff tools and permissions do not depend on this setting.", "staff-duty-help"));
      return section;
    };
    const teamAvailability = () => {
      const section = make("section", undefined, "staff-duty-block staff-duty-team");
      section.append(make("span", "Staff presence", "eyebrow-v3"), make("h3", "Team availability"));
      const roster = make("ul", undefined, "staff-duty-people");
      for (const person of state.roster) {
        const item = make("li");
        const identity = make("div");
        identity.append(make("strong", person.displayName || "Staff member"), make("small", validDate(person.updatedAt) ? `Updated ${shortTimestamp.format(new Date(person.updatedAt))}` : "No availability update"));
        item.append(identity, make("span", label(person.availability), `staff-duty-availability staff-duty-availability-${Object.hasOwn(AVAILABILITY, person.availability) ? person.availability : "away"}`));
        roster.append(item);
      }
      if (!roster.childElementCount) roster.append(make("li", "No staff availability is currently available.", "staff-duty-empty"));
      section.append(roster);
      if (state.nextAfterUserId) {
        const more = make("button", "Load more teammates", "button-v3 button-quiet-v3"); more.type = "button";
        listen(more, "click", () => { void loadMore(); }); section.append(more);
      }
      return section;
    };
    const render = () => {
      if (state.destroyed) return;
      const content = root.querySelector("[data-duty-content]");
      if (!content || !state.self) return;
      const toolbar = make("div", undefined, "staff-duty-toolbar");
      const refresh = make("button", "Refresh availability", "button-v3 button-quiet-v3"); refresh.type = "button";
      listen(refresh, "click", () => { void refreshState(); });
      toolbar.append(refresh);
      content.replaceChildren(availabilityControls(), toolbar, teamAvailability());
      if (state.notice) content.prepend(make("p", state.notice, "staff-duty-notice"));
      setBusy(state.busy);
    };
    const handleFailure = error => {
      if ([401, 403].includes(error?.status)) onAuthFailure?.(error);
      state.notice = error?.message || "Availability could not be updated.";
      live(state.notice, "error");
      render();
    };
    const refreshState = async () => {
      if (state.destroyed || state.busy) return;
      const request = ++state.request;
      setBusy(true); live("Refreshing availability…");
      try {
        const [self, availability] = await Promise.all([
          call("/api/admin/duty?view=self"),
          call("/api/admin/duty?view=availability&limit=25")
        ]);
        if (state.destroyed || request !== state.request || !self?.duty || !Array.isArray(availability?.availability)) throw new Error("Availability information could not be verified.");
        state.self = self;
        state.roster = availability.availability;
        state.nextAfterUserId = typeof availability.nextAfterUserId === "string" ? availability.nextAfterUserId : null;
        state.notice = "";
        render(); live("Availability is current.");
      } catch (error) { if (!state.destroyed && request === state.request) handleFailure(error); }
      finally { if (!state.destroyed && request === state.request) setBusy(false); }
    };
    const loadMore = async () => {
      if (state.destroyed || state.busy || !state.nextAfterUserId) return;
      const after = state.nextAfterUserId;
      setBusy(true); live("Loading more teammates…");
      try {
        const payload = await call(`/api/admin/duty?view=availability&limit=25&afterUserId=${encodeURIComponent(after)}`);
        if (!Array.isArray(payload?.availability)) throw new Error("Team availability could not be verified.");
        state.roster = [...state.roster, ...payload.availability.filter(person => !state.roster.some(current => current.userId === person.userId))];
        state.nextAfterUserId = typeof payload.nextAfterUserId === "string" ? payload.nextAfterUserId : null;
        render(); live("Availability is current.");
      } catch (error) { handleFailure(error); }
      finally { if (!state.destroyed) setBusy(false); }
    };
    const updateAvailability = async availability => {
      if (state.destroyed || state.busy || !Object.hasOwn(AVAILABILITY, availability)) return;
      setBusy(true); live("Updating availability…");
      try {
        await call("/api/admin/duty", { method: "POST", body: JSON.stringify({ action: "set_availability", availability, requestKey: requestKey() }) });
        state.busy = false;
        await refreshState();
      } catch (error) { handleFailure(error); }
      finally { if (!state.destroyed) setBusy(false); }
    };
    const controller = {
      refresh: refreshState,
      destroy() { state.destroyed = true; state.request += 1; cleanup.forEach(remove => remove()); if (active === controller) active = null; }
    };
    active = controller;
    try {
      const session = await api("/api/auth/session");
      if (session?.authenticated !== true || session.staff !== true || typeof session.user?.id !== "string") throw Object.assign(new Error("Staff availability needs an active staff session."), { status: 401 });
      state.accountId = session.user.id;
      await refreshState();
    } catch (error) { handleFailure(error); }
    return controller;
  }

  window.BrowseRPStaffDuty = Object.freeze({ init });
})();
