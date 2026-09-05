(() => {
  "use strict";
  const RANGE_LABELS = { "30d": "30 days", "90d": "90 days", "180d": "180 days", "1y": "1 year", max: "Max" };
  const SVG_NS = "http://www.w3.org/2000/svg";
  const number = new Intl.NumberFormat("en-GB");
  const compactNumber = new Intl.NumberFormat("en-GB", { notation: "compact", maximumFractionDigits: 1 });
  const day = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  const shortDay = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
  const timestamp = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "medium", timeZone: "UTC" });
  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];
  const make = (tag, text, className) => { const element = document.createElement(tag); if (text !== undefined) element.textContent = String(text); if (className) element.className = className; return element; };
  const svg = (tag, attributes = {}, text) => { const element = document.createElementNS(SVG_NS, tag); for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, String(value)); if (text !== undefined) element.textContent = String(text); return element; };
  const count = (value) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
  const date = (value) => typeof value === "string" && Number.isFinite(new Date(value).getTime());
  const rangeDate = (point) => { const start = day.format(new Date(point.date)); return point.endDate && point.endDate.slice(0, 10) !== point.date.slice(0, 10) ? `${start} – ${day.format(new Date(point.endDate))}` : start; };
  const pointDescription = (point) => `${rangeDate(point)}: ${number.format(point.totalUsers)} registered users; ${number.format(point.newUsers)} new users.`;
  let active = null;

  function validateWebsite(payload, expectedRange) {
    const website = payload?.overview?.website;
    const users = website?.users;
    if (!website || !date(website.generatedAt) || !users || users.range !== expectedRange || !count(users.total) || !count(users.newUsers) || !Array.isArray(users.series)) throw new Error("Website totals are unavailable. Please try refreshing.");
    if (users.series.some((point, index) => !date(point.date) || (point.endDate && !date(point.endDate)) || !count(point.totalUsers) || !count(point.newUsers) || (index > 0 && new Date(point.date) <= new Date(users.series[index - 1].date)))) throw new Error("Signup history could not be verified. Please try refreshing.");
    return website;
  }

  async function init({ api, onLoad, onAuthFailure } = {}) {
    if (typeof api !== "function") throw new TypeError("Overview requires the authorised staff API client.");
    if (!$("#website-overview")) return null;
    active?.destroy();
    const authenticators = window.BrowseRPStaffAuthenticators?.init({ api });
    const state = { range: "30d", website: null, busy: false, destroyed: false, request: 0, selectedDate: null, interval: null, observer: null, lastWidth: 0 };
    const cleanup = [];
    const listen = (element, event, callback) => { if (!element) return; element.addEventListener(event, callback); cleanup.push(() => element.removeEventListener(event, callback)); };
    const status = (text, mode = "loading") => { const element = $("#overview-live-status"); if (element) { element.textContent = text; element.dataset.state = mode; } };
    const busy = (value) => { state.busy = value; $("#overview-refresh").disabled = value; $("#overview-chart-figure").setAttribute("aria-busy", String(value)); $("#staff-metrics-v3").setAttribute("aria-busy", String(value)); };
    const empty = (message) => { $("#overview-chart").replaceChildren(make("p", message, "overview-chart-empty")); $("#overview-user-data").replaceChildren(); };
    const selectRange = (range) => {
      if (!RANGE_LABELS[range] || range === state.range) return;
      state.range = range; state.selectedDate = null;
      $("#overview-range-label").textContent = RANGE_LABELS[range];
      $$("[data-overview-range]").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.overviewRange === range)));
      $("#overview-range").open = false;
      $("#overview-range summary").focus();
      $("#overview-users-new").textContent = `Loading ${RANGE_LABELS[range].toLowerCase()} of signup history…`;
      empty("Loading this time frame…");
      void refresh();
    };

    function drawChart(users) {
      const root = $("#overview-chart");
      const points = users.series;
      if (!points.length) { empty("No registered accounts in this time frame."); return; }
      const hadFocus = root.contains(document.activeElement);
      const width = Math.max(270, Math.round(root.getBoundingClientRect().width || 800));
      state.lastWidth = width;
      const height = width < 520 ? 265 : 300;
      const pad = { left: width < 420 ? 42 : 58, right: 16, top: 25, bottom: 35 };
      const plotWidth = width - pad.left - pad.right;
      const plotHeight = height - pad.top - pad.bottom;
      const largest = Math.max(1, ...points.map((point) => point.totalUsers));
      const step = Math.max(1, Math.pow(10, Math.floor(Math.log10(largest))) / 2);
      const maximum = Math.ceil(largest / step) * step;
      const coordinates = points.map((point, index) => ({ x: pad.left + (points.length === 1 ? .5 : index / (points.length - 1)) * plotWidth, y: pad.top + (1 - point.totalUsers / maximum) * plotHeight }));
      const surface = make("div", undefined, "overview-chart-surface");
      surface.tabIndex = 0;
      surface.setAttribute("role", "slider");
      surface.setAttribute("aria-label", "Registered users by signup date");
      surface.setAttribute("aria-describedby", "overview-chart-caption");
      surface.setAttribute("aria-valuemin", "0");
      surface.setAttribute("aria-valuemax", String(points.length - 1));
      surface.setAttribute("aria-orientation", "horizontal");
      const graph = svg("svg", { viewBox: `0 0 ${width} ${height}`, "aria-hidden": "true", focusable: "false" });
      const defs = svg("defs");
      const gradient = svg("linearGradient", { id: "overview-chart-gradient", x1: "0", y1: "0", x2: "0", y2: "1" });
      gradient.append(svg("stop", { offset: "0%", "stop-color": "#ec4fa6", "stop-opacity": ".3" }), svg("stop", { offset: "100%", "stop-color": "#9b6cff", "stop-opacity": ".015" }));
      defs.append(gradient); graph.append(defs);
      for (let index = 0; index <= 4; index += 1) {
        const y = pad.top + plotHeight * index / 4;
        const value = maximum * (1 - index / 4);
        graph.append(svg("line", { x1: pad.left, y1: y, x2: width - pad.right, y2: y, class: "overview-chart-grid" }));
        if (Number.isInteger(value)) graph.append(svg("text", { x: pad.left - 9, y: y + 4, "text-anchor": "end", class: "overview-chart-axis" }, value >= 10000 ? compactNumber.format(value) : number.format(value)));
      }
      const tickCount = Math.min(points.length, width < 520 ? 3 : 5);
      const tickIndexes = [...new Set(Array.from({ length: tickCount }, (_, index) => tickCount === 1 ? 0 : Math.round(index * (points.length - 1) / (tickCount - 1))))];
      for (const index of tickIndexes) {
        const label = new Date(points[0].date).getUTCFullYear() !== new Date(points.at(-1).date).getUTCFullYear() ? new Intl.DateTimeFormat("en-GB", { month: "short", year: "2-digit", timeZone: "UTC" }).format(new Date(points[index].date)) : shortDay.format(new Date(points[index].date));
        graph.append(svg("text", { x: coordinates[index].x, y: height - 7, "text-anchor": index === 0 ? "start" : index === points.length - 1 ? "end" : "middle", class: "overview-chart-axis" }, label));
      }
      const line = coordinates.map((point, index) => `${index ? "L" : "M"}${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(" ");
      if (points.length > 1) graph.append(svg("path", { d: `${line} L${coordinates.at(-1).x},${pad.top + plotHeight} L${coordinates[0].x},${pad.top + plotHeight} Z`, class: "overview-chart-area" }));
      graph.append(svg("path", { d: line, class: "overview-chart-line" }));
      const guide = svg("line", { y1: pad.top, y2: pad.top + plotHeight, class: "overview-chart-guide" });
      const marker = svg("circle", { r: "5", class: "overview-chart-marker" });
      graph.append(guide, marker);
      const tooltip = make("div", undefined, "overview-chart-tooltip"); tooltip.hidden = true; tooltip.setAttribute("aria-hidden", "true");
      const tooltipDate = make("strong"); const tooltipTotal = make("span"); const tooltipNew = make("span"); tooltip.append(tooltipDate, tooltipTotal, tooltipNew);
      surface.append(graph, tooltip); root.replaceChildren(surface);
      let index = Math.max(0, points.findIndex((point) => point.date === state.selectedDate));
      if (!state.selectedDate) index = points.length - 1;
      const select = (nextIndex, showTooltip = true) => {
        index = Math.max(0, Math.min(points.length - 1, nextIndex));
        const point = points[index]; const position = coordinates[index];
        state.selectedDate = point.date;
        marker.setAttribute("cx", String(position.x)); marker.setAttribute("cy", String(position.y)); guide.setAttribute("x1", String(position.x)); guide.setAttribute("x2", String(position.x));
        surface.setAttribute("aria-valuenow", String(index)); surface.setAttribute("aria-valuetext", pointDescription(point));
        tooltipDate.textContent = rangeDate(point); tooltipTotal.textContent = `${number.format(point.totalUsers)} registered users`; tooltipNew.textContent = `${number.format(point.newUsers)} new ${point.endDate && point.endDate.slice(0, 10) !== point.date.slice(0, 10) ? "during this period" : "on this date"}`;
        const half = Math.min(125, width / 2 - 4);
        tooltip.style.left = `${Math.max(half, Math.min(width - half, position.x))}px`;
        tooltip.hidden = !showTooltip;
      };
      const pointer = (event) => {
        const rect = graph.getBoundingClientRect();
        if (!rect.width) return;
        const x = (event.clientX - rect.left) * width / rect.width;
        const nextIndex = points.length === 1 ? 0 : Math.round((x - pad.left) / plotWidth * (points.length - 1));
        select(nextIndex);
      };
      surface.addEventListener("pointermove", (event) => { if (event.pointerType === "mouse" || event.pointerType === "pen") pointer(event); });
      surface.addEventListener("pointerdown", pointer);
      surface.addEventListener("pointerleave", () => { if (document.activeElement !== surface) tooltip.hidden = true; });
      surface.addEventListener("focus", () => select(index));
      surface.addEventListener("blur", () => { tooltip.hidden = true; });
      surface.addEventListener("keydown", (event) => {
        const next = { ArrowLeft: index - 1, ArrowDown: index - 1, ArrowRight: index + 1, ArrowUp: index + 1, Home: 0, End: points.length - 1, PageUp: index + 7, PageDown: index - 7 }[event.key];
        if (next === undefined) return;
        event.preventDefault(); select(next);
      });
      select(index, hadFocus);
      if (hadFocus) surface.focus({ preventScroll: true });
    }

    function render(payload, website) {
      $$("[data-overview-metric]").forEach((element) => { const value = website.metrics?.[element.dataset.overviewMetric]; element.textContent = count(value) ? number.format(value) : "Unavailable"; });
      $$("[data-overview-queue]").forEach((element) => {
        const key = element.dataset.overviewQueue;
        const value = payload.overview?.metrics?.[key] ?? payload.overview?.[key];
        element.textContent = count(value) ? `${number.format(value)} ${key === "openReports" ? "open" : "pending"}` : "";
      });
      $("#overview-users-total").textContent = number.format(website.users.total);
      const period = state.range === "max" ? "since the first signup" : `in the selected ${RANGE_LABELS[state.range].toLowerCase()}`;
      $("#overview-users-new").textContent = `${number.format(website.users.newUsers)} current accounts joined ${period}`;
      drawChart(website.users);
      const rows = website.users.series.map((point) => { const row = make("tr"); const label = make("th", rangeDate(point)); label.scope = "row"; row.append(label, make("td", number.format(point.newUsers)), make("td", number.format(point.totalUsers))); return row; });
      if (!rows.length) { const row = make("tr"); const cell = make("td", "No signup records in this time frame."); cell.colSpan = 3; row.append(cell); rows.push(row); }
      $("#overview-user-data").replaceChildren(...rows);
      $("#overview-chart-caption").textContent = `${website.users.granularity === "day" ? "Daily" : website.users.granularity === "week" ? "Weekly" : `${website.users.bucketDays || "Multiple"}-day`} counts in UTC. Hover or tap for an exact date and count. Focus the chart and use the arrow keys to explore. Deleted accounts are excluded.`;
      status(`Updated ${timestamp.format(new Date(website.generatedAt))} UTC · Refreshes every 30 seconds`, "live");
    }

    async function refresh() {
      if (state.destroyed) return null;
      const request = ++state.request;
      const requestedRange = state.range;
      busy(true);
      try {
        const payload = await api(`/api/admin/overview?range=${encodeURIComponent(requestedRange)}`);
        if (state.destroyed || request !== state.request) return null;
        const website = validateWebsite(payload, requestedRange);
        state.website = website;
        render(payload, website);
        if (onLoad) await onLoad(website);
        return website;
      } catch (error) {
        if (state.destroyed || request !== state.request) return null;
        if (error.status === 401 || error.status === 403) {
          controller.destroy();
          empty("Your staff session has ended. Sign in again to view current data.");
          $$("[data-overview-metric]").forEach((element) => { element.textContent = "—"; });
          $$("[data-overview-queue]").forEach((element) => { element.textContent = ""; });
          $("#overview-users-total").textContent = "—";
          $("#overview-users-new").textContent = "Staff access is required.";
          status("Staff access needs to be verified again.", "error");
          if (onAuthFailure) onAuthFailure(error);
          else throw error;
          return null;
        }
        const lastUpdate = state.website ? ` Last successful update: ${timestamp.format(new Date(state.website.generatedAt))} UTC.` : "";
        status(`Could not refresh website data.${lastUpdate} Retry with Refresh now.`, "error");
        if (!state.website || state.website.users.range !== state.range) {
          empty("User history is unavailable for this time frame. Please try Refresh now.");
          $("#overview-users-new").textContent = "Signup history is temporarily unavailable.";
        }
        return null;
      } finally { if (!state.destroyed && request === state.request) busy(false); }
    }

    const controller = { refresh, get website() { return state.website; }, destroy() { state.destroyed = true; state.request += 1; clearInterval(state.interval); state.observer?.disconnect(); authenticators?.destroy(); cleanup.forEach((remove) => remove()); if (active === controller) active = null; } };
    active = controller;
    $$("[data-overview-range]").forEach((button) => listen(button, "click", () => selectRange(button.dataset.overviewRange)));
    listen($("#overview-refresh"), "click", () => { void refresh(); });
    listen($("#overview-range"), "keydown", (event) => { if (event.key === "Escape") { $("#overview-range").open = false; $("#overview-range summary").focus(); } });
    listen(document, "visibilitychange", () => { if (!document.hidden && !state.busy) void refresh(); });
    listen(window, "pagehide", () => controller.destroy());
    if (typeof ResizeObserver !== "undefined") {
      state.observer = new ResizeObserver(() => { const width = $("#overview-chart").getBoundingClientRect().width; if (state.website?.users.range === state.range && Math.abs(width - state.lastWidth) > 8) drawChart(state.website.users); });
      state.observer.observe($("#overview-chart"));
    }
    await refresh();
    if (!state.destroyed) state.interval = setInterval(() => { if (!document.hidden && !state.busy) void refresh(); }, 30000);
    return controller;
  }

  window.BrowseRPStaffOverview = Object.freeze({ init });
})();
