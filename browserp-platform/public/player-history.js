(() => {
  "use strict";
  const root = document.getElementById("player-history");
  if (!root) return;
  const select = root.querySelector("select"), status = root.querySelector("[data-history-status]"), chart = root.querySelector("[data-history-chart]"), retry = root.querySelector("[data-history-retry]"), details = root.querySelector("details"), table = root.querySelector("[data-history-table]"), scope = root.querySelector("[data-history-scope]");
  const slug = location.pathname.startsWith("/server/") ? location.pathname.split("/").filter(Boolean).at(-1) : new URLSearchParams(location.search).get("slug");
  if (!slug || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 100) return;
  const ranges = { "1h": "1 hour", "8h": "8 hours", "12h": "12 hours", "24h": "24 hours" };
  const date = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "medium" });
  const clock = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const day = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short" });
  let controller = null, generation = 0, current = null, closed = false, inspection = null, observer = null, resizeFrame = null, lastWidth = 0;
  const make = (tag, text) => { const element = document.createElement(tag); if (text !== undefined) element.textContent = text; return element; };
  const svgNode = (tag, attrs = {}) => { const element = document.createElementNS("http://www.w3.org/2000/svg", tag); for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, value); return element; };
  const count = value => Number.isInteger(value) && value >= 0 && value <= 100000;

  function cancelResize() {
    if (resizeFrame !== null) cancelAnimationFrame(resizeFrame);
    resizeFrame = null;
  }

  function inspect(data, svg, geometry, previous) {
    const { width, height, left, right, plotWidth, baseline, plotHeight, top, start, end } = geometry;
    const surface = make("div"), help = make("p", "Hover or drag across the graph to see player counts and times.");
    const keyboardHelp = make("span", " Use arrow keys to move between recorded counts; Home and End jump to the first and last. Escape hides the readout.");
    keyboardHelp.className = "player-history-keyboard-help"; help.append(keyboardHelp);
    surface.className = "player-history-inspector";
    surface.tabIndex = 0;
    surface.setAttribute("role", "slider");
    surface.setAttribute("aria-label", "Recorded player count");
    surface.setAttribute("aria-orientation", "horizontal");
    surface.setAttribute("aria-valuemin", "1");
    surface.setAttribute("aria-valuemax", String(data.points.length));
    help.id = "player-history-inspect-help";
    surface.setAttribute("aria-describedby", help.id);
    const tooltip = make("div"), value = make("strong"), time = make("time");
    tooltip.className = "player-history-tooltip";
    tooltip.setAttribute("aria-hidden", "true");
    tooltip.hidden = true;
    tooltip.append(value, time);
    const marker = svgNode("g", { class: "player-history-selection", visibility: "hidden", "aria-hidden": "true" });
    const guide = svgNode("line", { y1: baseline - plotHeight, y2: baseline, class: "player-history-guide" });
    const ring = svgNode("circle", { r: 5, class: "player-history-selected-point" });
    marker.append(guide, ring); svg.append(marker);
    surface.append(svg, tooltip); chart.append(surface, help);
    const times = data.points.map(point => Date.parse(point.at));
    const savedIndex = times.indexOf(previous?.at);
    let index = savedIndex < 0 ? 0 : savedIndex, visible = false, gesture = null, suppressClickUntil = 0;
    const listeners = [];
    const on = (type, handler, options) => { surface.addEventListener(type, handler, options); listeners.push([type, handler, options]); };
    const describe = point => `${point.players.toLocaleString()} players, recorded ${date.format(new Date(point.at))}, local time`;
    function show(next) {
      index = Math.max(0, Math.min(data.points.length - 1, next));
      const point = data.points[index], x = left + (times[index] - start) / (end - start) * plotWidth;
      guide.setAttribute("x1", x); guide.setAttribute("x2", x);
      ring.setAttribute("cx", x); ring.setAttribute("cy", baseline - point.players / top * plotHeight);
      marker.setAttribute("visibility", "visible");
      value.textContent = `${point.players.toLocaleString()} players`;
      time.textContent = `· ${clock.format(new Date(point.at))}${new Date(start).toDateString() !== new Date(end).toDateString() ? ` · ${day.format(new Date(point.at))}` : ""}`;
      time.title = date.format(new Date(point.at));
      time.dateTime = point.at; time.hidden = false;
      tooltip.hidden = false; visible = true;
      surface.setAttribute("aria-valuenow", String(index + 1));
      surface.setAttribute("aria-valuetext", describe(point));
    }
    function hide() { marker.setAttribute("visibility", "hidden"); tooltip.hidden = true; visible = false; }
    function locate(clientX, clientY) {
      const rect = svg.getBoundingClientRect();
      const scale = Math.min(rect.width / width, rect.height / height);
      if (!scale) return;
      // SVG's default meet scaling may letterbox: measure both axes rather
      // than assuming its CSS width is the viewBox width after a resize.
      const x = (clientX - rect.left - (rect.width - width * scale) / 2) / scale;
      const y = (clientY - rect.top - (rect.height - height * scale) / 2) / scale;
      if (x < left || x > width - right || y < 0 || y > height) { hide(); return; }
      const at = start + (x - left) / plotWidth * (end - start);
      let nearest = 0;
      for (let n = 1; n < times.length; n++) if (Math.abs(times[n] - at) < Math.abs(times[nearest] - at)) nearest = n;
      // Inspect only a nearby displayed reading, within 2.5 minutes or 12px.
      // Distance between displayed samples does not establish source coverage.
      const tolerance = Math.min(150000, 12 / (plotWidth * scale) * (end - start));
      if (Math.abs(times[nearest] - at) > tolerance) {
        marker.setAttribute("visibility", "hidden"); value.textContent = "No recorded count here";
        time.hidden = true; tooltip.hidden = false; visible = false;
        surface.setAttribute("aria-valuetext", "No recorded count at this position");
        return;
      }
      show(nearest);
    }
    function release() {
      if (gesture && surface.hasPointerCapture?.(gesture.id)) surface.releasePointerCapture(gesture.id);
      gesture = null;
    }
    on("pointerdown", event => {
      if (event.isPrimary === false || event.button !== 0) return;
      gesture = { id: event.pointerId, x: event.clientX, y: event.clientY, horizontal: false, vertical: false };
      if (event.pointerType === "mouse") locate(event.clientX, event.clientY);
    });
    on("pointermove", event => {
      if (!gesture) { if (event.pointerType === "mouse" || event.pointerType === "pen") locate(event.clientX, event.clientY); return; }
      if (event.pointerId !== gesture.id || gesture.vertical) return;
      const dx = Math.abs(event.clientX - gesture.x), dy = Math.abs(event.clientY - gesture.y);
      if (!gesture.horizontal) {
        if (dy > 6 && dy > dx) { gesture.vertical = true; hide(); return; }
        if (dx <= 6 || dx <= dy) return;
        gesture.horizontal = true;
        surface.setPointerCapture?.(event.pointerId);
      }
      if (event.cancelable) event.preventDefault();
      locate(event.clientX, event.clientY);
    });
    on("pointerup", event => {
      if (!gesture || event.pointerId !== gesture.id) return;
      if (!gesture.vertical) locate(event.clientX, event.clientY);
      if (gesture.horizontal) suppressClickUntil = Date.now() + 500;
      release();
    });
    on("pointercancel", () => { release(); hide(); });
    on("lostpointercapture", event => {
      // Transferring implicit capture from the SVG child bubbles its loss here.
      if (event.target === surface && event.pointerId === gesture?.id) gesture = null;
    });
    on("pointerleave", () => {
      if (gesture && !surface.hasPointerCapture?.(gesture.id)) release();
      if (!gesture && document.activeElement !== surface) hide();
    });
    on("click", event => { if (Date.now() < suppressClickUntil) { event.preventDefault(); event.stopPropagation(); } }, true);
    on("focus", () => show(index));
    on("blur", () => { if (!gesture) hide(); });
    on("keydown", event => {
      const next = { ArrowLeft: index - 1, ArrowDown: index - 1, ArrowRight: index + 1, ArrowUp: index + 1, Home: 0, End: data.points.length - 1 };
      if (event.key === "Escape") { hide(); event.preventDefault(); return; }
      if (!Object.hasOwn(next, event.key)) return;
      event.preventDefault(); show(next[event.key]);
    });
    surface.setAttribute("aria-valuenow", String(index + 1));
    surface.setAttribute("aria-valuetext", describe(data.points[index]));
    if (previous?.visible) show(index);
    if (previous?.focused) surface.focus({ preventScroll: true });
    return {
      state: () => ({ at: times[index], visible, focused: document.activeElement === surface }),
      destroy: () => { release(); for (const [type, handler, options] of listeners) surface.removeEventListener(type, handler, options); hide(); }
    };
  }

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
    const previous = current === data ? inspection?.state() : null;
    observer?.disconnect();
    inspection?.destroy(); inspection = null;
    current = data;
    chart.replaceChildren(); table.replaceChildren(); details.open = false;
    details.hidden = !data.points.length;
    select.disabled = !data.supported;
    scope.hidden = !data.supported;
    scope.textContent = data.scope === "network" ? "Minecraft counts cover the advertised server or network, including lobbies and other worlds." : "Counts reported by the server.";
    if (!data.supported) { status.textContent = "Player history is not available for this community."; return; }
    if (!data.points.length) { status.textContent = `No counts recorded in the last ${ranges[data.range]}. Try another range.`; return; }
    const start = Date.parse(data.startAt), end = Date.parse(data.endAt);
    const maximum = Math.max(1, ...data.points.map(point => point.players));
    const top = Math.max(5, Math.ceil(maximum / 5) * 5);
    const width = Math.max(280, Math.min(chart.clientWidth || 760, 760)), height = 240, left = 58, right = 20, plotWidth = width - left - right, baseline = 200, plotHeight = 174;
    const svg = svgNode("svg", { viewBox: `0 0 ${width} ${height}`, role: "img", "aria-label": `Player counts for the last ${ranges[data.range]}. Dots show recorded counts; blank periods were not measured.` });
    for (const value of [0, Math.round(top / 2), top]) {
      const y = baseline - value / top * plotHeight;
      svg.append(svgNode("line", { x1: left, x2: width - right, y1: y, y2: y, class: "player-history-grid" }));
      const label = svgNode("text", { x: left - 10, y: y + 4, "text-anchor": "end", class: "player-history-axis" }); label.textContent = value.toLocaleString(); svg.append(label);
    }
    const ticks = width < 450 ? 2 : 4;
    for (let tick = 0; tick <= ticks; tick++) {
      const at = new Date(start + (end - start) * tick / ticks);
      const label = svgNode("text", { x: left + plotWidth * tick / ticks, y: 226, "text-anchor": tick === 0 ? "start" : tick === ticks ? "end" : "middle", class: "player-history-axis" });
      label.textContent = clock.format(at);
      svg.append(label);
    }
    for (const point of data.points) {
      const dot = svgNode("circle", { cx: left + (Date.parse(point.at) - start) / (end - start) * plotWidth, cy: baseline - point.players / top * plotHeight, r: 2.8, class: "player-history-point" });
      const title = svgNode("title"); title.textContent = `${date.format(new Date(point.at))}: ${point.players.toLocaleString()} players`; dot.append(title); svg.append(dot);
    }
    inspection = inspect(data, svg, { width, height, left, right, plotWidth, baseline, plotHeight, top, start, end }, previous);
    const notes = [`Updated ${clock.format(new Date(data.lastAt))}${new Date(start).toDateString() !== new Date(end).toDateString() ? ` · ${day.format(new Date(data.lastAt))}` : ""}.`];
    if (data.sampled) notes.push("Some recorded counts are shown.");
    if (data.truncated) notes.push("Older counts aren’t available here.");
    status.textContent = notes.join(" ");
    lastWidth = chart.clientWidth;
    observer?.observe(chart);
  }

  async function load() {
    if (closed) return;
    cancelResize();
    observer?.disconnect();
    controller?.abort();
    controller = new AbortController();
    const active = controller, turn = ++generation, range = select.value;
    const timeout = setTimeout(() => active.abort(), 20_000);
    root.hidden = false; root.setAttribute("aria-busy", "true"); retry.hidden = true;
    status.textContent = `Loading the last ${ranges[range]}…`;
    inspection?.destroy(); inspection = null;
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
      status.textContent = "Player history is unavailable. Try again.";
      retry.hidden = false;
    } finally {
      clearTimeout(timeout);
      if (turn === generation) root.setAttribute("aria-busy", "false");
    }
  }

  details.addEventListener("toggle", () => {
    if (!details.open || !current || table.childElementCount) return;
    const notes = [`${current.observations.toLocaleString()} recorded player counts. Blank periods were not recorded.`];
    if (current.sampled) notes.push("This list shows selected counts, including the busiest and quietest times.");
    if (current.truncated) notes.push("Older counts aren’t available in this range.");
    table.append(make("p", notes.join(" ")));
    const element = make("table"), caption = make("caption", current.sampled ? "Selected player counts" : "Recorded player counts"), head = make("thead"), headers = make("tr"), body = make("tbody");
    for (const label of ["Time", "Players"]) { const th = make("th", label); th.scope = "col"; headers.append(th); }
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
    observer = new ResizeObserver(() => {
      const width = chart.clientWidth;
      if (closed || !inspection || !width || width === lastWidth) return;
      lastWidth = width;
      if (!current || resizeFrame !== null) return;
      const turn = generation;
      resizeFrame = requestAnimationFrame(() => {
        resizeFrame = null;
        if (!closed && turn === generation && current) render(current);
      });
    });
  }
  window.addEventListener("pagehide", () => { closed = true; generation++; cancelResize(); controller?.abort(); inspection?.destroy(); inspection = null; observer?.disconnect(); });
  window.addEventListener("pageshow", event => { if (event.persisted) { closed = false; load(); } });
  load();
})();
