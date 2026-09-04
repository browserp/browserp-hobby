(() => {
  "use strict";
  const names = { fivem: "FiveM", redm: "RedM", minecraft: "Minecraft", roblox: "Roblox" };
  const number = new Intl.NumberFormat("en-GB");
  const date = new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "medium", timeZone: "UTC" });
  const validCount = value => Number.isSafeInteger(value) && value >= 0;
  const count = value => validCount(value) ? number.format(value) : "—";
  const validDate = value => typeof value === "string" && Number.isFinite(Date.parse(value));
  const time = value => validDate(value) ? `${date.format(new Date(value))} UTC` : "Not recorded";
  function make(tag, text, className = "") {
    const element = document.createElement(tag); element.className = className;
    if (text !== undefined) element.textContent = String(text);
    return element;
  }
  function describeHealth(health) {
    if (!validDate(health?.checkedAt) || !health?.sources || !health?.scheduler) return { tone: "warning", label: "Health information is unavailable" };
    const scheduler = health.scheduler;
    if (scheduler.enabled === false) return { tone: "warning", label: "Automatic checks are paused" };
    if (scheduler.enabled !== true) return { tone: "warning", label: "No active schedule is recorded" };
    if (scheduler.lastDeliveryTimedOut || scheduler.lastDeliveryStatus >= 400) return { tone: "error", label: "The latest scheduled request failed" };
    const age = value => validDate(value) ? Date.parse(health.checkedAt) - Date.parse(value) : Infinity;
    const latest = health.lastRun;
    if (age(scheduler.lastDispatchedAt) > 180_000) return { tone: "warning", label: "Automatic checks are delayed" };
    if (latest && !latest.finishedAt) {
      return age(latest.startedAt) > 120_000
        ? { tone: "warning", label: "A check run has not completed" }
        : { tone: "neutral", label: "Automatic checks are running" };
    }
    const run = health.lastCompletedRun;
    if (!run) return { tone: "neutral", label: "Waiting for a completed check run" };
    if (!["checked", "requested", "refreshed", "unchanged", "unavailable", "failed", "deferred"].every(key => validCount(run[key]))) return { tone: "warning", label: "Check-run details are incomplete" };
    if (age(run.finishedAt) > 180_000) return { tone: "warning", label: "No recent completed check run" };
    if (run.failed > 0 || run.deferred > 0) return { tone: "warning", label: "The latest check run needs attention" };
    if (health.sources.stale > 0) return { tone: "warning", label: "Some source observations are unavailable" };
    if (!validCount(health.sources.total) || !validCount(health.sources.fresh) || !validCount(health.sources.stale)) return { tone: "warning", label: "Source freshness is unavailable" };
    if (health.sources.total === 0) return { tone: "neutral", label: "No published sources are being checked" };
    if (scheduler.intervalSeconds !== 60) return { tone: "neutral", label: "Check schedule timing needs review" };
    return { tone: "healthy", label: "Automatic checks are healthy" };
  }
  function metric(label, value, help, className = "") {
    const item = make("div", undefined, `refresh-health-metric ${className}`);
    item.append(make("dt", label), make("dd", value), make("p", help)); return item;
  }
  function renderData(root, health) {
    const sources = health.sources || {}, run = health.lastCompletedRun;
    const metrics = make("dl", undefined, "refresh-health-metrics");
    metrics.append(
      metric("Last successful run", time(health.lastSuccessfulRunAt), "Completed without worker failures or deferred work. Source responses may still be unavailable.", "refresh-health-time"),
      metric("Sources checked", run ? `${count(run.checked)} / ${count(run.requested)}` : "—", "Processed in the latest completed run, including unsuccessful source responses."),
      metric("Updated observations", run ? count(run.refreshed) : "—", run ? `${count(run.unchanged)} observations were unchanged. Both count as successful source checks.` : "No completed run is recorded."),
      metric("Worker failures", run ? count(run.failed) : "—", "Processing failures in the latest completed run. Missing source responses are shown separately below."),
      metric("Current observations", `${count(sources.fresh)} / ${count(sources.total)}`, "Published imported listings with usable observations from the last five minutes."),
      metric("Stale / unavailable", count(sources.stale), `${count(sources.unavailable)} have no usable source response; ${count(sources.neverChecked)} have no recorded observation.`)
    );
    const games = make("div", undefined, "refresh-health-games"); games.setAttribute("aria-label", "Freshness by game");
    for (const platform of Array.isArray(health.platforms) ? health.platforms : []) {
      if (!names[platform.platform]) continue;
      const card = make("div", undefined, "refresh-health-game"); card.dataset.platform = platform.platform;
      card.append(make("strong", names[platform.platform]), make("span", `${count(platform.fresh)} / ${count(platform.total)} current`), make("small", `${count(platform.stale)} stale or unavailable`));
      games.append(card);
    }
    const details = make("details", undefined, "refresh-health-details");
    details.append(make("summary", "Check history and source details"));
    const explanation = make("p", "An unchanged source timestamp can be a successful check. A delayed or unavailable observation does not prove a server is offline. The scheduler does not record a per-source error reason.");
    const schedule = health.scheduler || {};
    const delivery = Number.isInteger(schedule.lastDeliveryStatus) ? `HTTP ${schedule.lastDeliveryStatus}` : "Awaiting a response, or the retained response is no longer available";
    const facts = make("dl", undefined, "refresh-health-facts");
    for (const [label, value] of [
      ["Schedule", schedule.enabled === false ? "Paused" : schedule.intervalSeconds === 60 ? "Every minute" : "Timing not available"],
      ["Last scheduled request", time(schedule.lastDispatchedAt)],
      ["Latest request result", schedule.lastDeliveryTimedOut ? "Request timed out" : delivery],
      ["Oldest stored observation", time(sources.oldestObservationAt)],
      ["Latest completed run", time(run?.finishedAt)],
      ["Unavailable source responses", run ? count(run.unavailable) : "—"],
      ["Skipped / deferred sources", run ? `${count(run.skipped)} / ${count(run.deferred)}` : "—"]
    ]) { const row = make("div"); row.append(make("dt", label), make("dd", value)); facts.append(row); }
    const scroll = make("div", undefined, "refresh-health-history"); scroll.tabIndex = 0; scroll.setAttribute("role", "region"); scroll.setAttribute("aria-label", "Recent refresh runs; scroll horizontally on small screens");
    const table = make("table"); table.append(make("caption", "Recent automatic check runs · UTC"));
    const head = make("thead"), header = make("tr");
    for (const label of ["Started", "State", "Checked", "Updated", "Unchanged", "Unavailable", "Failed", "Deferred"]) { const th = make("th", label); th.scope = "col"; header.append(th); }
    head.append(header); const body = make("tbody");
    for (const item of (Array.isArray(health.recentRuns) ? health.recentRuns : []).slice(0, 10)) {
      const row = make("tr");
      for (const value of [time(item.startedAt), item.finishedAt ? "Completed" : "Not completed", count(item.checked), count(item.refreshed), count(item.unchanged), count(item.unavailable), count(item.failed), count(item.deferred)]) row.append(make("td", value));
      body.append(row);
    }
    table.append(head, body); scroll.append(table); details.append(explanation, facts, scroll);
    root.replaceChildren(metrics, games, details);
  }
  async function init({ api, root = document.querySelector("[data-refresh-health]"), intervalMs = 60_000 } = {}) {
    if (!root || typeof api !== "function") return null;
    if (root.dataset.refreshHealthMounted) return null;
    root.dataset.refreshHealthMounted = "true"; root.classList.add("refresh-health");
    const heading = make("div", undefined, "refresh-health-heading"), copy = make("div");
    const title = make("h2", "Live listing checks"); title.id = `${root.id || "staff"}-refresh-health-title`;
    root.setAttribute("aria-labelledby", title.id);
    copy.append(make("span", "Refresh health", "eyebrow-v3"), title, make("p", "Automatic status checks for all published imported listings."));
    const button = make("button", "Update status", "button-v3 button-secondary-v3"); button.type = "button";
    heading.append(copy, button);
    const state = make("p", "Loading refresh health…", "refresh-health-state"); state.setAttribute("role", "status");
    const stamp = make("p", "", "refresh-health-stamp");
    const content = make("div");
    root.replaceChildren(heading, state, stamp, content);
    let pending = false, stopped = false, lastHealth = null;
    async function refresh() {
      if (pending || stopped) return;
      pending = true; button.disabled = true; root.setAttribute("aria-busy", "true");
      try {
        const data = await api("/api/admin/refresh-health");
        if (stopped) return;
        const health = data?.health;
        if (!validDate(health?.checkedAt) || !health.sources || !health.scheduler) throw new Error("Refresh health is unavailable.");
        lastHealth = health;
        const status = describeHealth(health); state.textContent = status.label; state.dataset.tone = status.tone;
        stamp.textContent = `Status read ${time(health.checkedAt)}. Updates every minute while this page is visible.`;
        const previousDetails = content.querySelector("details"), previousScroll = content.querySelector(".refresh-health-history");
        const wasOpen = previousDetails?.open, scrollLeft = previousScroll?.scrollLeft || 0;
        const focusTarget = document.activeElement === previousDetails?.querySelector("summary") ? "summary" : document.activeElement === previousScroll ? ".refresh-health-history" : null;
        renderData(content, health); if (wasOpen) content.querySelector("details").open = true;
        content.querySelector(".refresh-health-history").scrollLeft = scrollLeft;
        if (focusTarget) content.querySelector(focusTarget).focus({ preventScroll: true });
      } catch (error) {
        if (stopped) return;
        state.dataset.tone = "error";
        state.textContent = error?.status === 403 ? "Your role cannot view refresh health." : error?.status === 401 ? "Sign in again to view refresh health." : "Refresh health could not be updated. Try again.";
        stamp.textContent = lastHealth ? `Showing the last status read at ${time(lastHealth.checkedAt)}. These figures may have changed.` : "No current health information is available.";
        if (error?.status === 401 || error?.status === 403) { content.replaceChildren(); lastHealth = null; stamp.textContent = "Health information is hidden until your access is restored."; }
      } finally { pending = false; if (!stopped) { button.disabled = false; root.setAttribute("aria-busy", "false"); } }
    }
    const visibleRefresh = () => { if (document.visibilityState !== "hidden") void refresh(); };
    button.addEventListener("click", refresh);
    const timer = window.setInterval(visibleRefresh, Math.max(intervalMs, 1000));
    document.addEventListener("visibilitychange", visibleRefresh);
    const pageHide = event => { if (!event.persisted) destroy(); };
    function destroy() { stopped = true; window.clearInterval(timer); document.removeEventListener("visibilitychange", visibleRefresh); button.removeEventListener("click", refresh); window.removeEventListener("pagehide", pageHide); window.removeEventListener("pageshow", visibleRefresh); }
    window.addEventListener("pagehide", pageHide); window.addEventListener("pageshow", visibleRefresh);
    await refresh();
    return { refresh, destroy };
  }
  window.BrowseRPStaffRefreshHealth = { init, describeHealth };
})();
