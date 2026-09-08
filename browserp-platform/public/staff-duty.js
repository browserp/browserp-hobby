(() => {
  "use strict";

  const AVAILABILITY = Object.freeze({
    available: "Available",
    away: "Away",
    off_duty: "Off duty"
  });
  const PERIODS = Object.freeze({ 7: "7 days", 30: "30 days", 90: "90 days" });
  const timestamp = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" });
  const shortTimestamp = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  let active = null;

  const make = (tag, text, className = "") => {
    const element = document.createElement(tag);
    if (text !== undefined) element.textContent = String(text);
    if (className) element.className = className;
    return element;
  };
  const validDate = value => typeof value === "string" && Number.isFinite(new Date(value).getTime());
  const formatDate = value => validDate(value) ? timestamp.format(new Date(value)) : "Not recorded";
  const inputDate = value => {
    if (!validDate(value)) return "";
    const date = new Date(value);
    const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
    return local.toISOString().slice(0, 16);
  };
  const formatDuration = value => {
    const seconds = Number.isSafeInteger(value) && value >= 0 ? value : 0;
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    if (hours) return minutes ? `${hours}h ${minutes}m` : `${hours}h`;
    return minutes ? `${minutes}m` : "0m";
  };
  const requestKey = () => {
    if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, character => {
      const random = Math.random() * 16 | 0;
      return (character === "x" ? random : random & 3 | 8).toString(16);
    });
  };
  const sessionState = session => session?.needsReview ? "Needs review" : session?.endedAt ? "Confirmed" : "Open";
  const uniqueBy = (items, field) => [...new Map(items.filter(Boolean).map(item => [item[field], item])).values()];

  async function init({ api, root, onAuthFailure } = {}) {
    if (typeof api !== "function") throw new TypeError("Duty requires the authorised staff API client.");
    if (!(root instanceof Element)) return null;
    active?.destroy();
    const state = {
      accountId: "",
      days: 30,
      from: "",
      to: "",
      self: null,
      team: null,
      availability: null,
      destroyed: false,
      generation: 0,
      busy: false,
      retry: null,
      notice: ""
    };

    const setLive = (message, mode = "") => {
      const target = root.querySelector("[data-duty-live]");
      if (!target) return;
      target.textContent = message;
      target.dataset.state = mode;
    };
    const setBusy = value => {
      state.busy = value;
      root.setAttribute("aria-busy", String(value));
      root.querySelectorAll("button,input,select,textarea").forEach(control => { control.disabled = value; });
    };
    const failAuth = error => {
      controller.destroy();
      root.setAttribute("aria-busy", "false");
      root.querySelector("[data-duty-content]")?.replaceChildren(make("p", "Your staff session has ended. Sign in again to view duty information.", "staff-duty-empty"));
      setLive("Staff access needs to be verified again.", "error");
      onAuthFailure?.(error);
    };
    const call = (path, options = {}) => api(path, {
      ...options,
      headers: { ...(options.headers || {}), "X-BrowseRP-Account": state.accountId }
    });
    const query = (view, extra = {}) => {
      const parameters = new URLSearchParams({ view, limit: "100" });
      if (view !== "availability") {
        parameters.set("from", state.from);
        parameters.set("to", state.to);
      }
      for (const [key, value] of Object.entries(extra)) if (value !== null && value !== undefined && value !== "") parameters.set(key, String(value));
      return `/api/admin/duty?${parameters}`;
    };

    function validateRead(payload, view) {
      if (!payload || payload.view !== view || !validDate(payload.asOf)) throw new Error("Duty information could not be verified. Refresh and try again.");
      if (view === "availability") {
        if (!Array.isArray(payload.availability)) throw new Error("Team availability could not be verified.");
      } else if (!payload.duty || !Array.isArray(payload.sessions) || !payload.totals) {
        throw new Error("Work sessions could not be verified.");
      }
      return payload;
    }

    function actionButton(text, className, listener) {
      const button = make("button", text, className);
      button.type = "button";
      button.addEventListener("click", listener);
      return button;
    }

    function notice() {
      if (!state.notice && !state.retry) return null;
      const box = make("div", undefined, "staff-duty-notice");
      box.setAttribute("role", "status");
      box.append(make("p", state.notice || "The result could not be confirmed."));
      if (state.retry) box.append(actionButton(`Retry ${state.retry.label}`, "button-v3 button-secondary-v3", () => void postSerialized(state.retry.body, state.retry.label)));
      return box;
    }

    function availabilityControls() {
      const section = make("section", undefined, "staff-duty-card staff-duty-state-card");
      section.append(make("span", "Your availability", "eyebrow-v3"), make("h3", AVAILABILITY[state.self.duty.availability] || "Off duty"));
      const choices = make("div", undefined, "staff-duty-choices");
      choices.setAttribute("role", "group");
      choices.setAttribute("aria-label", "Set your availability");
      for (const [value, label] of Object.entries(AVAILABILITY)) {
        const button = actionButton(label, "staff-duty-choice", () => void mutate({ action: "set_availability", availability: value }, `set ${label.toLowerCase()}`));
        button.setAttribute("aria-pressed", String(state.self.duty.availability === value));
        choices.append(button);
      }
      section.append(choices, make("p", "Availability is separate from clocking in or out.", "staff-duty-help"));
      return section;
    }

    function clockCard() {
      const open = state.self.duty.openSession;
      const section = make("section", undefined, "staff-duty-card staff-duty-clock");
      section.append(make("span", "Your work session", "eyebrow-v3"), make("h3", open ? (open.needsReview ? "Review required" : "On duty") : "Clocked out"));
      section.append(make("p", open ? `Started ${formatDate(open.startedAt)}.` : "Start a session when you begin BrowseRP staff work."));
      if (open?.needsReview) section.append(make("p", "This session is over 12 hours old. It earns no confirmed time until the actual end is reviewed.", "staff-duty-warning"));
      const label = open ? "Clock out" : "Clock in";
      section.append(actionButton(label, "button-v3 button-primary-v3", () => void mutate(open
        ? { action: "clock_out", sessionId: open.id, version: open.version }
        : { action: "clock_in" }, label.toLowerCase())));
      return section;
    }

    function summaryCards() {
      const grid = make("div", undefined, "staff-duty-totals");
      const values = [
        ["Confirmed time", formatDuration(state.self.totals.confirmedSeconds), `In the last ${PERIODS[state.days].toLowerCase()}`],
        ["Needs review", Number(state.self.totals.pendingReviewCount || 0).toLocaleString("en-GB"), "Not included in confirmed time"],
        ["Open sessions", Number(state.self.totals.openSessionCount || 0).toLocaleString("en-GB"), "Shown separately from confirmed time"]
      ];
      for (const [label, value, detail] of values) {
        const card = make("article", undefined, "staff-duty-total");
        card.append(make("span", label), make("strong", value), make("small", detail));
        grid.append(card);
      }
      return grid;
    }

    function labelledInput(label, name, type, value = "") {
      const field = make("label", undefined, "staff-duty-field");
      field.append(make("span", label));
      const input = document.createElement(type === "textarea" ? "textarea" : "input");
      input.name = name;
      if (type !== "textarea") input.type = type;
      if (value) input.value = value;
      field.append(input);
      return field;
    }

    function confirmationForm(session) {
      const details = make("details", undefined, "staff-duty-correction");
      details.append(make("summary", "Confirm the actual end time"));
      const form = make("form");
      const ended = labelledInput("Actual end time", "endedAt", "datetime-local", inputDate(session.endedAt));
      const reason = labelledInput("What happened?", "reason", "textarea");
      const endedInput = ended.querySelector("input"); endedInput.required = true;
      const reasonInput = reason.querySelector("textarea"); reasonInput.required = true; reasonInput.minLength = 10; reasonInput.maxLength = 500;
      const confirmation = make("label", undefined, "staff-duty-confirm");
      const checkbox = document.createElement("input"); checkbox.type = "checkbox"; checkbox.name = "confirmed"; checkbox.required = true;
      confirmation.append(checkbox, make("span", "I confirm this is the time the work actually ended."));
      const submit = make("button", "Confirm session", "button-v3 button-secondary-v3"); submit.type = "submit";
      form.append(ended, reason, confirmation, submit);
      form.addEventListener("submit", event => {
        event.preventDefault();
        const data = new FormData(form);
        const end = new Date(String(data.get("endedAt") || ""));
        if (!Number.isFinite(end.getTime())) return;
        void mutate({
          action: "confirm_session",
          sessionId: session.id,
          version: session.version,
          endedAt: end.toISOString(),
          reason: String(data.get("reason") || ""),
          confirmed: true
        }, "confirm session");
      });
      details.append(form);
      return details;
    }

    function correctionForm(session) {
      const details = make("details", undefined, "staff-duty-correction");
      details.append(make("summary", "Correct this session"));
      const form = make("form");
      const started = labelledInput("Actual start time", "startedAt", "datetime-local", inputDate(session.startedAt));
      const ended = labelledInput("Actual end time", "endedAt", "datetime-local", inputDate(session.endedAt));
      const reason = labelledInput("Correction reason", "reason", "textarea");
      for (const input of [started.querySelector("input"), ended.querySelector("input")]) input.required = true;
      const reasonInput = reason.querySelector("textarea"); reasonInput.required = true; reasonInput.minLength = 10; reasonInput.maxLength = 500;
      const confirmation = make("label", undefined, "staff-duty-confirm");
      const checkbox = document.createElement("input"); checkbox.type = "checkbox"; checkbox.name = "confirmed"; checkbox.required = true;
      confirmation.append(checkbox, make("span", "I confirm this is the staff member’s actual work interval."));
      const submit = make("button", "Apply correction", "button-v3 button-secondary-v3"); submit.type = "submit";
      form.append(started, ended, reason, confirmation, submit);
      form.addEventListener("submit", event => {
        event.preventDefault();
        const data = new FormData(form);
        const start = new Date(String(data.get("startedAt") || ""));
        const end = new Date(String(data.get("endedAt") || ""));
        if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime())) return;
        void mutate({
          action: "correct_session",
          sessionId: session.id,
          version: session.version,
          startedAt: start.toISOString(),
          endedAt: end.toISOString(),
          reason: String(data.get("reason") || ""),
          confirmed: true
        }, "apply correction");
      });
      details.append(form);
      return details;
    }

    function sessionCard(session, { manageable = false } = {}) {
      const card = make("article", undefined, "staff-duty-session");
      const heading = make("div", undefined, "staff-duty-session-heading");
      const title = make("div");
      title.append(make("strong", session.displayName || "Your session"), make("span", sessionState(session), `staff-duty-pill staff-duty-pill-${session.needsReview ? "review" : session.endedAt ? "confirmed" : "open"}`));
      heading.append(title, make("strong", formatDuration(session.confirmedSeconds), "staff-duty-duration"));
      const times = make("dl", undefined, "staff-duty-times");
      for (const [label, value] of [["Started", formatDate(session.startedAt)], ["Ended", session.endedAt ? formatDate(session.endedAt) : "Still open"]]) {
        times.append(make("dt", label), make("dd", value));
      }
      card.append(heading, times);
      if (session.needsReview) card.append(make("p", "This session contributes 0m until its actual interval is confirmed.", "staff-duty-warning"));
      if (session.needsReview && session.userId === state.accountId) card.append(confirmationForm(session));
      if (manageable) card.append(correctionForm(session));
      return card;
    }

    function historySection() {
      const section = make("section", undefined, "staff-duty-block");
      const heading = make("div", undefined, "staff-duty-block-heading");
      heading.append(make("div", undefined));
      heading.firstElementChild.append(make("span", "Your records", "eyebrow-v3"), make("h3", "Recent work sessions"));
      section.append(heading);
      const list = make("div", undefined, "staff-duty-session-list");
      if (state.self.sessions.length) list.append(...state.self.sessions.map(item => sessionCard(item)));
      else list.append(make("p", "No work sessions were recorded in this time frame.", "staff-duty-empty"));
      section.append(list);
      if (state.self.next) section.append(actionButton("Load older sessions", "button-v3 button-quiet-v3", () => void loadMoreSelf()));
      return section;
    }

    function availabilitySection() {
      const section = make("section", undefined, "staff-duty-block");
      section.append(make("span", "Team status", "eyebrow-v3"), make("h3", "Availability"));
      const list = make("ul", undefined, "staff-duty-people");
      for (const person of state.availability.availability) {
        const item = make("li");
        const identity = make("div");
        identity.append(make("strong", person.displayName || "Staff member"), make("small", person.updatedAt ? `Updated ${shortTimestamp.format(new Date(person.updatedAt))}` : "No availability update"));
        item.append(identity, make("span", AVAILABILITY[person.availability] || "Off duty", `staff-duty-availability staff-duty-availability-${AVAILABILITY[person.availability] ? person.availability : "off_duty"}`));
        list.append(item);
      }
      if (!list.childElementCount) list.append(make("li", "No staff availability is currently available.", "staff-duty-empty"));
      section.append(list);
      if (state.availability.nextAfterUserId) section.append(actionButton("Load more staff", "button-v3 button-quiet-v3", () => void loadMoreAvailability()));
      return section;
    }

    function teamSection() {
      if (!state.team || state.self.canManageTeam !== true) return null;
      const section = make("section", undefined, "staff-duty-block staff-duty-team");
      section.append(make("span", "Management view", "eyebrow-v3"), make("h3", "Team work sessions"), make("p", "Confirmed totals exclude open sessions and records that still need review.", "staff-duty-help"));
      const totals = make("div", undefined, "staff-duty-team-totals");
      for (const person of state.team.teamTotals || []) {
        const card = make("article");
        card.append(make("strong", person.displayName || "Staff member"), make("span", formatDuration(person.confirmedSeconds)), make("small", `${Number(person.pendingReviewCount || 0).toLocaleString("en-GB")} need review`));
        totals.append(card);
      }
      section.append(totals);
      if (state.team.nextAfterUserId) section.append(actionButton("Load more team totals", "button-v3 button-quiet-v3", () => void loadMoreTeamTotals()));
      const list = make("div", undefined, "staff-duty-session-list");
      if (state.team.sessions.length) list.append(...state.team.sessions.map(item => sessionCard(item, { manageable: true })));
      else list.append(make("p", "No team sessions were recorded in this time frame.", "staff-duty-empty"));
      section.append(list);
      if (state.team.next) section.append(actionButton("Load older team sessions", "button-v3 button-quiet-v3", () => void loadMoreTeamSessions()));
      return section;
    }

    function toolbar() {
      const bar = make("div", undefined, "staff-duty-toolbar");
      const label = make("label", undefined, "staff-duty-period");
      label.append(make("span", "Time frame"));
      const select = document.createElement("select");
      for (const [value, text] of Object.entries(PERIODS)) {
        const option = make("option", text); option.value = value; option.selected = Number(value) === state.days; select.append(option);
      }
      select.addEventListener("change", () => { state.days = Number(select.value); void refresh(); });
      label.append(select);
      bar.append(label, actionButton("Refresh duty data", "button-v3 button-quiet-v3", () => void refresh()));
      return bar;
    }

    function render() {
      const content = root.querySelector("[data-duty-content]");
      if (!content || !state.self || !state.availability) return;
      const primary = make("div", undefined, "staff-duty-primary");
      primary.append(availabilityControls(), clockCard());
      const parts = [notice(), toolbar(), primary, summaryCards(), historySection(), availabilitySection(), teamSection()].filter(Boolean);
      content.replaceChildren(...parts);
      setBusy(state.busy);
    }

    async function postSerialized(body, label) {
      if (state.busy || state.destroyed) return;
      state.retry = null;
      state.notice = `${label.charAt(0).toUpperCase() + label.slice(1)}…`;
      render();
      setBusy(true);
      try {
        await call("/api/admin/duty", { method: "POST", body });
        state.notice = `${label.charAt(0).toUpperCase() + label.slice(1)} saved.`;
        await refresh({ keepNotice: true });
      } catch (error) {
        if (error?.status === 401 || error?.status === 403) { failAuth(error); return; }
        if (error?.status === 409) {
          state.notice = `${error.message} Duty data was refreshed.`;
          await refresh({ keepNotice: true });
          return;
        }
        state.notice = error?.message || "The duty update could not be confirmed.";
        if (!error?.status || error.status >= 500 || error.status === 429) state.retry = { body, label };
        render();
        setLive("Duty update needs attention.", "error");
      } finally {
        if (!state.destroyed) { state.busy = false; setBusy(false); }
      }
    }

    async function mutate(values, label) {
      const body = JSON.stringify({ ...values, requestKey: requestKey() });
      await postSerialized(body, label);
    }

    async function refresh({ keepNotice = false } = {}) {
      if (state.destroyed) return null;
      const generation = ++state.generation;
      if (!keepNotice) { state.notice = ""; state.retry = null; }
      state.busy = true;
      setBusy(true);
      setLive("Refreshing duty information…");
      const now = new Date();
      state.to = now.toISOString();
      state.from = new Date(now.getTime() - state.days * 86_400_000).toISOString();
      try {
        const [self, availability] = await Promise.all([
          call(query("self")),
          call(query("availability"))
        ]);
        if (state.destroyed || generation !== state.generation) return null;
        state.self = validateRead(self, "self");
        state.availability = validateRead(availability, "availability");
        state.team = state.self.canManageTeam === true ? validateRead(await call(query("team")), "team") : null;
        if (state.destroyed || generation !== state.generation) return null;
        render();
        setLive(`Updated ${shortTimestamp.format(new Date(state.self.asOf))}`, "live");
        return state.self;
      } catch (error) {
        if (state.destroyed || generation !== state.generation) return null;
        if (error?.status === 401 || error?.status === 403) { failAuth(error); return null; }
        state.notice = error?.message || "Duty information is temporarily unavailable.";
        const content = root.querySelector("[data-duty-content]");
        if (!state.self && content) {
          const box = make("div", undefined, "staff-duty-empty");
          box.append(make("p", state.notice), actionButton("Try again", "button-v3 button-secondary-v3", () => void refresh()));
          content.replaceChildren(box);
        } else render();
        setLive("Duty information is unavailable.", "error");
        return null;
      } finally {
        if (!state.destroyed && generation === state.generation) { state.busy = false; setBusy(false); }
      }
    }

    async function page(view, extra) {
      if (state.busy || state.destroyed) return null;
      state.busy = true; setBusy(true);
      try { return validateRead(await call(query(view, extra)), view); }
      catch (error) {
        if (error?.status === 401 || error?.status === 403) failAuth(error);
        else { state.notice = error?.message || "More duty records could not be loaded."; render(); setLive("More records are unavailable.", "error"); }
        return null;
      } finally { if (!state.destroyed) { state.busy = false; setBusy(false); } }
    }
    async function loadMoreSelf() {
      const next = state.self?.next;
      if (!next) return;
      const payload = await page("self", { before: next.before, beforeId: next.beforeId });
      if (!payload) return;
      state.self.sessions = uniqueBy([...state.self.sessions, ...payload.sessions], "id");
      state.self.next = payload.next; render();
    }
    async function loadMoreAvailability() {
      const afterUserId = state.availability?.nextAfterUserId;
      if (!afterUserId) return;
      const payload = await page("availability", { afterUserId });
      if (!payload) return;
      state.availability.availability = uniqueBy([...state.availability.availability, ...payload.availability], "userId");
      state.availability.nextAfterUserId = payload.nextAfterUserId; render();
    }
    async function loadMoreTeamSessions() {
      const next = state.team?.next;
      if (!next) return;
      const payload = await page("team", { before: next.before, beforeId: next.beforeId });
      if (!payload) return;
      state.team.sessions = uniqueBy([...state.team.sessions, ...payload.sessions], "id");
      state.team.next = payload.next; render();
    }
    async function loadMoreTeamTotals() {
      const afterUserId = state.team?.nextAfterUserId;
      if (!afterUserId) return;
      const payload = await page("team", { afterUserId });
      if (!payload) return;
      state.team.teamTotals = uniqueBy([...(state.team.teamTotals || []), ...(payload.teamTotals || [])], "userId");
      state.team.nextAfterUserId = payload.nextAfterUserId; render();
    }

    const controller = {
      refresh,
      destroy() {
        state.destroyed = true;
        state.generation += 1;
        if (active === controller) active = null;
      }
    };
    active = controller;

    try {
      const session = await api("/api/auth/session");
      if (session?.authenticated !== true || session?.staff !== true || typeof session.user?.id !== "string" || !session.user.id) {
        throw Object.assign(new Error("Your staff access must be checked again."), { status: 403 });
      }
      state.accountId = session.user.id;
      await refresh();
    } catch (error) {
      if (error?.status === 401 || error?.status === 403) failAuth(error);
      else {
        root.querySelector("[data-duty-content]")?.replaceChildren(make("p", error?.message || "Duty information is temporarily unavailable.", "staff-duty-empty"));
        root.setAttribute("aria-busy", "false");
        setLive("Duty information is unavailable.", "error");
      }
    }
    return controller;
  }

  window.BrowseRPStaffDuty = Object.freeze({ init });
})();
