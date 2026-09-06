(() => {
  "use strict";
  const form = document.querySelector("#server-finder"), M = window.BrowseRPDiscovery;
  if (!form || !M || form.dataset.finderReady === "true") return;
  form.dataset.finderReady = "true";
  const keys = ["platform", "region", "access", "feature"];
  const any = { platform: "Any game", region: "Any region", access: "Either is fine", feature: "Any feature" };
  const labels = { platform: "Game", region: "Region", access: "Joining", feature: "Feature" };
  const panels = [...form.querySelectorAll("[data-finder-question]")];
  const steps = document.querySelector("[data-finder-steps]");
  const summary = document.querySelector("[data-finder-summary]");
  const status = form.querySelector("[data-finder-status]"), retry = form.querySelector("[data-finder-retry]");
  const back = form.querySelector("[data-finder-back]"), next = form.querySelector("[data-finder-next]"), submit = form.querySelector("[data-finder-submit]");
  const counter = form.querySelector("[data-finder-step-count]");
  const platform = new URLSearchParams(location.search).get("platform");
  let filters = M.normalize({ platform: Object.hasOwn(M.games, platform || "") ? platform : "all" });
  let step = 0, request = 0, controller, timeout, closed = false;
  const make = (tag, className, text) => { const element = document.createElement(tag); if (className) element.className = className; if (text) element.textContent = text; return element; };

  function sync() {
    for (const input of form.querySelectorAll('input[type="radio"]')) input.checked = input.value === filters[input.name];
    summary.replaceChildren(...keys.map(key => {
      const row = make("div"); row.append(make("dt", "", labels[key]), make("dd", "", filters[key] === "all" ? any[key] : M.display(key, filters[key], filters.platform))); return row;
    }));
  }
  function showStep(index, focus = true) {
    step = Math.max(0, Math.min(panels.length - 1, index));
    panels.forEach((panel, position) => { panel.hidden = position !== step; panel.inert = position !== step; });
    steps.querySelectorAll("[data-finder-step]").forEach((button, position) => {
      if (position === step) button.setAttribute("aria-current", "step"); else button.removeAttribute("aria-current");
    });
    counter.textContent = `Question ${step + 1} of ${panels.length}`;
    back.hidden = step === 0; next.hidden = step === panels.length - 1; submit.hidden = step !== panels.length - 1;
    if (focus) panels[step].querySelector("legend").focus({ preventScroll: true });
  }
  function choices(key, rows = []) {
    const container = form.querySelector(`[data-finder-options="${key}"]`);
    const focused = container.contains(document.activeElement) ? document.activeElement.value : null;
    const unique = new Map();
    for (const row of rows) {
      if (!row || typeof row.value !== "string" || !Number.isFinite(Number(row.count)) || Number(row.count) <= 0) continue;
      const raw = row.value.trim();
      if (!raw || raw.length > 80 || /[\u0000-\u001f\u007f]/.test(raw)) continue;
      const value = key === "feature" ? M.canonical(key, raw, filters.platform) : raw;
      if (value !== "all") unique.set(value, M.display(key, value, filters.platform));
      if (unique.size >= 60) break;
    }
    // A vanished choice is reset, rather than silently sent as a stale filter.
    if (filters[key] !== "all" && !unique.has(filters[key])) filters[key] = "all";
    container.replaceChildren(...[["all", any[key]], ...unique].map(([value, title]) => {
      const choice = make("label", "finder-choice");
      const input = make("input"); input.type = "radio"; input.name = key; input.value = value; input.defaultChecked = value === "all";
      const copy = make("span", "finder-choice-copy"); copy.append(make("strong", "", title)); choice.append(input, copy); return choice;
    }));
    if (focused !== null) [...container.querySelectorAll("input")].find(input => input.value === focused)?.focus({ preventScroll: true });
    return unique.size;
  }
  function dependentChoices(facets, loading = false) {
    for (const key of ["region", "feature"]) {
      const count = choices(key, facets?.[key]);
      form.querySelector(`[data-finder-note="${key}"]`).textContent = loading ? "Loading current choices…" : !count && facets ? `No specific ${key === "region" ? "regions are" : "features are"} listed for these choices. Leave this open to browse.` : "";
    }
    sync();
  }
  async function refresh() {
    controller?.abort(); clearTimeout(timeout);
    const current = ++request; controller = new AbortController();
    const activeController = controller;
    timeout = window.setTimeout(() => activeController.abort(), 10000);
    status.textContent = "Updating choices from current listings…"; retry.hidden = true;
    const params = M.params({ ...filters, feature: "all", limit: 1 });
    params.set("discover", "true");
    try {
      const response = await fetch(`/api/servers?${params}`, { headers: { Accept: "application/json" }, credentials: "same-origin", signal: activeController.signal });
      if (!response.ok) throw new Error("Directory unavailable");
      const data = await response.json();
      if (closed || current !== request) return;
      if (!data.facets || !Array.isArray(data.facets.region) || !Array.isArray(data.facets.feature)) throw new Error("Choices unavailable");
      dependentChoices(data.facets); status.textContent = "";
    } catch {
      if (closed || current !== request) return;
      status.textContent = "Current choices couldn’t be loaded. You can still search with your selections, or try again.";
      retry.hidden = false;
      form.querySelectorAll("[data-finder-note]").forEach(note => { note.textContent = ""; });
    } finally { if (current === request) clearTimeout(timeout); }
  }
  form.addEventListener("change", event => {
    const input = event.target;
    if (!(input instanceof HTMLInputElement) || input.type !== "radio" || !keys.includes(input.name) || !input.checked) return;
    filters[input.name] = input.value;
    if (input.name === "platform") { filters.region = "all"; filters.access = "all"; filters.feature = "all"; dependentChoices(null, true); }
    if (["region", "access"].includes(input.name)) { if (input.name === "region") filters.access = "all"; filters.feature = "all"; choices("feature"); }
    sync();
    if (input.name !== "feature") refresh();
  });
  next.addEventListener("click", () => showStep(step + 1));
  back.addEventListener("click", () => showStep(step - 1));
  steps.querySelectorAll("[data-finder-step]").forEach(button => button.addEventListener("click", () => showStep(Number(button.dataset.finderStep))));
  form.addEventListener("submit", event => {
    if (step !== panels.length - 1) { event.preventDefault(); showStep(step + 1); }
    // On the final question, native GET submission preserves browser behavior
    // and sends only the four supported, checked directory filter controls.
  });
  form.addEventListener("reset", () => {
    filters = M.normalize(); dependentChoices(null, true); showStep(0); refresh();
  });
  retry.addEventListener("click", refresh);
  window.addEventListener("pagehide", () => { closed = true; ++request; controller?.abort(); clearTimeout(timeout); });
  window.addEventListener("pageshow", event => { if (event.persisted) { closed = false; sync(); refresh(); } });
  // Reuse existing publisher artwork, with no substitute marks or new assets.
  for (const input of form.querySelectorAll('input[name="platform"]')) {
    if (!Object.hasOwn(M.games, input.value)) continue;
    input.closest("label").dataset.platform = input.value;
    const artwork = make("span", `finder-game-art game-art-${input.value}-v3`); artwork.setAttribute("aria-hidden", "true"); input.after(artwork);
  }
  steps.hidden = false; counter.hidden = false; sync(); showStep(0, false); refresh();
})();
