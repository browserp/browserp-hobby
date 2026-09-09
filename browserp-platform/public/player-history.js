(() => {
  "use strict";
  const root = document.getElementById("player-history");
  if (!root) return;
  const select = root.querySelector("select"), status = root.querySelector("[data-history-status]"), chart = root.querySelector("[data-history-chart]"), retry = root.querySelector("[data-history-retry]"), details = root.querySelector("details"), table = root.querySelector("[data-history-table]"), scope = root.querySelector("[data-history-scope]");
  const slug = location.pathname.startsWith("/server/") ? location.pathname.split("/").filter(Boolean).at(-1) : new URLSearchParams(location.search).get("slug");
  if (!slug || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 100) return;
  const ranges = { "1h": "1 hour", "8h": "8 hours", "12h": "12 hours", "24h": "24 hours" };
  const date = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "medium" });
  let controller = null, generation = 0, current = null, closed = false;
  const make = (tag, text) => { const element = document.createElement(tag); if (text !== undefined) element.textContent = text; return element; };
  const svgNode = (tag, attrs = {}) => { const element = document.createElementNS("http://www.w3.org/2000/svg", tag); for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, value); return element; };
  const count = value => Number.isInteger(value) && value >= 0 && value <= 100000;

  function validate(data, range) {
    const start = Date.parse(data?.startAt), end = Date.parse(data?.endAt);
    if (!data || data.slug !== slug || data.range !== range || !Number.isFinite(start) || !Number.isFinite(end) || end - start !== ({ "1h": 1, "8h": 8, "12h": 12, "24h": 24 }[range]) * 3600000 || !["server", "network"].includes(data.scope) || typeof data.supported !== "boolean" || !Array.isArray(data.points) || data.points.length > 480 || !Number.isInteger(data.observations) || data.observations < data.points.length || data.observations > 3000 || ["partial", "truncated", "sampled"].some(key => typeof data[key] !== "boolean")) throw new Error("Invalid history response");
    let previous = start - 1;
    for (const point of data.points) {
      const at = Date.parse(point?.at);
      if (!Number.isFinite(at) || at < start || at > end || at <= previous || !count(point.players) || !count(point.capacity) || point.players > point.capacity) throw new Error("Invalid observation");
      previous = at;
    }
    if (data.points.length && (data.firstAt !== data.points[0].at || data.lastAt !== data.points.at(-1).at)) throw new Error("Invalid coverage");
    return data;
  }

  function render(data) {
    current = data;
    chart.replaceChildren(); table.replaceChildren(); details.open = false;
    details.hidden = !data.points.length;
    select.disabled = !data.supported;
    scope.hidden = !data.supported;
    scope.textContent = data.scope === "network" ? "Minecraft counts cover the advertised server or network, including lobbies and other worlds." : "Counts are observations reported by the server.";
    if (!data.supported) { status.textContent = "Player history is not provided for this community."; return; }
    if (!data.points.length) { status.textContent = `No player observations are available for the last ${ranges[data.range]}. Try another time range.`; return; }
    const start = Date.parse(data.startAt), end = Date.parse(data.endAt);
    const maximum = Math.max(1, ...data.points.map(point => point.players));
    const top = Math.max(5, Math.ceil(maximum / 5) * 5);
    const width = Math.max(280, Math.min(chart.clientWidth || 760, 760)), height = 240, left = 58, right = 20, plotWidth = width - left - right, baseline = 200, plotHeight = 174;
    const svg = svgNode("svg", { viewBox: `0 0 ${width} ${height}`, role: "img", "aria-label": `Player observations for the last ${ranges[data.range]}. Dots show recorded counts; empty periods have no displayed observation.` });
    for (const value of [0, Math.round(top / 2), top]) {
      const y = baseline - value / top * plotHeight;
      svg.append(svgNode("line", { x1: left, x2: width - right, y1: y, y2: y, class: "player-history-grid" }));
      const label = svgNode("text", { x: left - 10, y: y + 4, "text-anchor": "end", class: "player-history-axis" }); label.textContent = value.toLocaleString(); svg.append(label);
    }
    const ticks = width < 450 ? 2 : 4;
    for (let tick = 0; tick <= ticks; tick++) {
      const at = new Date(start + (end - start) * tick / ticks);
      const label = svgNode("text", { x: left + plotWidth * tick / ticks, y: 226, "text-anchor": tick === 0 ? "start" : tick === ticks ? "end" : "middle", class: "player-history-axis" });
      label.textContent = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" }).format(at);
      svg.append(label);
    }
    for (const point of data.points) {
      const dot = svgNode("circle", { cx: left + (Date.parse(point.at) - start) / (end - start) * plotWidth, cy: baseline - point.players / top * plotHeight, r: 2.8, class: "player-history-point" });
      const title = svgNode("title"); title.textContent = `${date.format(new Date(point.at))}: ${point.players.toLocaleString()} players`; dot.append(title); svg.append(dot);
    }
    chart.append(svg);
    const notes = [`${data.observations.toLocaleString()} recorded observations.`, "Dots show measured counts; no values are filled between them."];
    if (data.sampled) notes.push("A selection is shown, retaining the busiest and quietest readings in each time interval.");
    if (data.truncated) notes.push("Only the most recent available part of this range is shown because the observation limit was reached.");
    else if (data.partial) notes.push("Coverage is incomplete: some periods have no recorded count.");
    notes.push(`Last observation: ${date.format(new Date(data.lastAt))}. Times are local to your device.`);
    status.textContent = notes.join(" ");
  }

  async function load() {
    if (closed) return;
    controller?.abort();
    controller = new AbortController();
    const active = controller, turn = ++generation, range = select.value;
    const timeout = setTimeout(() => active.abort(), 20_000);
    root.hidden = false; root.setAttribute("aria-busy", "true"); retry.hidden = true;
    status.textContent = `Loading ${ranges[range]} of player observations…`;
    current = null; chart.replaceChildren(); table.replaceChildren(); details.open = false; details.hidden = true; scope.hidden = true;
    try {
      const response = await fetch(`/api/servers?${new URLSearchParams({ slug, history: range })}`, { signal: active.signal, credentials: "same-origin", headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error("History unavailable");
      const text = await response.text();
      if (text.length > 64_000) throw new Error("History too large");
      const data = validate(JSON.parse(text), range);
      if (turn === generation && !closed) render(data);
    } catch {
      if (turn !== generation || closed) return;
      status.textContent = "Player history is temporarily unavailable. Try again in a moment.";
      retry.hidden = false;
    } finally {
      clearTimeout(timeout);
      if (turn === generation) root.setAttribute("aria-busy", "false");
    }
  }

  details.addEventListener("toggle", () => {
    if (!details.open || !current || table.childElementCount) return;
    const element = make("table"), caption = make("caption", current.sampled ? "Displayed observations (selected from the recorded history)" : "Recorded player observations"), head = make("thead"), headers = make("tr"), body = make("tbody");
    for (const label of ["Observed at (local time)", "Players"]) { const th = make("th", label); th.scope = "col"; headers.append(th); }
    head.append(headers);
    for (const point of [...current.points].reverse()) {
      const row = make("tr"), cell = make("td"), time = make("time", date.format(new Date(point.at))); time.dateTime = point.at; cell.append(time);
      row.append(cell, make("td", point.players.toLocaleString())); body.append(row);
    }
    element.append(caption, head, body); table.append(element);
  });
  select.addEventListener("change", load);
  retry.addEventListener("click", load);
  if (typeof ResizeObserver === "function") {
    let lastWidth = 0;
    const observer = new ResizeObserver(() => { const width = chart.clientWidth; if (width && width !== lastWidth) { lastWidth = width; if (current) render(current); } });
    observer.observe(chart);
  }
  window.addEventListener("pagehide", () => { closed = true; generation++; controller?.abort(); });
  window.addEventListener("pageshow", event => { if (event.persisted) { closed = false; load(); } });
  load();
})();
