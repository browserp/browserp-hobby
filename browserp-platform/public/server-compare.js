(() => {
  "use strict";
  const KEY = "browserp-compare-v1";
  const LIMIT = 3;
  const validSlug = value => typeof value === "string" && value.length <= 160 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
  const plain = (value, limit = 160) => typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, limit) : "";
  function clean(entries) {
    const result = [];
    for (const item of Array.isArray(entries) ? entries.slice(0, 100) : []) {
      if (!item || !validSlug(item.slug) || result.some(row => row.slug === item.slug)) continue;
      result.push({ slug: item.slug, name: plain(item.name) });
      if (result.length === LIMIT) break;
    }
    return result;
  }
  function create(storage, notify = () => {}) {
    let memory = [];
    let persistent = true;
    function selected() {
      if (persistent) {
        try { const raw = storage?.getItem(KEY); memory = raw && raw.length <= 4096 ? clean(JSON.parse(raw)) : []; }
        catch { persistent = false; }
      }
      return memory.map(item => ({ ...item }));
    }
    function save(next) {
      memory = clean(next);
      try { if (!storage) throw new Error("Browser storage unavailable"); storage.setItem(KEY, JSON.stringify(memory)); persistent = true; }
      catch { persistent = false; }
      const result = { ok: true, selected: memory.map(item => ({ ...item })), persisted: persistent };
      if (!persistent) result.reason = "storage";
      notify({ selected: result.selected, count: result.selected.length });
      return result;
    }
    const has = slug => selected().some(item => item.slug === slug);
    function toggle(item) {
      if (!validSlug(item?.slug)) return { ok: false, reason: "invalid", selected: selected() };
      const current = selected();
      if (current.some(row => row.slug === item.slug)) return save(current.filter(row => row.slug !== item.slug));
      if (current.length === LIMIT) return { ok: false, reason: "full", selected: current };
      return save([...current, { slug: item.slug, name: plain(item.name) }]);
    }
    return Object.freeze({ selected, has, toggle, remove: slug => save(selected().filter(item => item.slug !== slug)), clear: () => save([]), replace: entries => save(clean(entries)), href: () => { const slugs = selected().map(item => item.slug); return slugs.length ? `/compare?servers=${slugs.join(",")}` : "/compare"; } });
  }
  const games = { fivem: "FiveM", redm: "RedM", roblox: "Roblox", minecraft: "Minecraft" };
  const field = value => plain(value, 300) || "Not provided";
  function facts(server, now = Date.now()) {
    const checkedAt = plain(server.checked_at || server.checkedAt);
    const timestamp = Date.parse(checkedAt);
    const hasTime = Number.isFinite(timestamp) && timestamp <= now;
    const fresh = hasTime && now - timestamp <= 5 * 60_000;
    const applicationOnly = server.applicationOnly === true || server.platform_id === "roblox";
    const players = Number.isInteger(server.players) && server.players >= 0 ? server.players : null;
    const rawCapacity = server.max_players ?? server.capacity;
    const capacity = Number.isInteger(rawCapacity) && rawCapacity > 0 ? rawCapacity : null;
    const usableCount = players !== null && (capacity === null || players <= capacity);
    const network = server.count_scope === "network";
    const state = applicationOnly ? "Not provided for this listing type" : !fresh ? "Not recently verified" : server.online === true ? "Reported online" : server.online === false ? "Reported offline" : "Not confirmed";
    const count = applicationOnly ? "Not provided for this listing type" : fresh && server.online === true && usableCount ? `${players.toLocaleString()}${capacity ? ` / ${capacity.toLocaleString()}` : " players"}${network ? " across the network" : ""}` : "Not available";
    const access = ({ public: "Open to everyone", whitelisted: "Whitelisted", allowlisted: "Approval required", application: "Application required", unknown: "Not confirmed" })[server.access_type] || "Not confirmed";
    return { game: games[server.platform_id] || field(server.platform_name), region: field(server.region), language: field(server.language), access, framework: field(server.framework), state, count, checked: hasTime ? new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(timestamp)) + (fresh ? "" : " · older observation") : "No observation time provided", checkedAt: hasTime ? new Date(timestamp).toISOString() : "", tags: [...new Set((Array.isArray(server.tags) ? server.tags : []).filter(tag => typeof tag === "string").map(tag => plain(tag, 80)).filter(Boolean))].slice(0, 30) };
  }
  globalThis.BrowseRPCompareModel = Object.freeze({ create, clean, validSlug, facts, key: KEY });
  if (typeof document === "undefined" || document.body?.hasAttribute("data-staff-page") || location.pathname.startsWith("/staffpanel")) return;
  let storage;
  try { storage = window.localStorage; } catch { storage = null; }
  const model = create(storage, detail => window.dispatchEvent(new CustomEvent("browserp:compare-changed", { detail })));
  window.BrowseRPCompare = model;
  window.addEventListener("storage", event => { if (event.key === KEY || event.key === null) window.dispatchEvent(new CustomEvent("browserp:compare-changed", { detail: { selected: model.selected(), count: model.selected().length } })); });

  const root = document.querySelector("[data-server-compare-page]");
  if (!root) return;
  const $ = selector => root.querySelector(selector);
  const make = (tag, className, text) => { const element = document.createElement(tag); if (className) element.className = className; if (text !== undefined) element.textContent = text; return element; };
  const query = new URLSearchParams(location.search);
  if (query.has("servers")) {
    const raw = query.get("servers") || "";
    const shared = raw.length <= 500 ? clean(raw.split(",").map(slug => ({ slug }))) : [];
    if (shared.length) model.replace(shared);
  }
  const results = $("#compare-results");
  const empty = $("#compare-empty");
  const notice = $("#compare-status");
  const cache = new Map();
  let generation = 0;
  let controller;
  let refreshTimer;
  function safeImage(value) {
    try { const url = new URL(value, location.origin); return url.protocol === "https:" && !url.username && !url.password && (url.origin === location.origin || url.hostname === "cdn.discordapp.com" || (url.hostname === "kywabzfgjoqiznnxygbq.supabase.co" && url.pathname.startsWith("/storage/v1/object/public/server-media/"))) ? url.href : ""; }
    catch { return ""; }
  }
  function table(selected) {
    const table = make("table", "compare-table");
    const caption = make("caption", "compare-caption", "Your selected roleplay communities"); table.append(caption);
    const head = make("thead"); const heading = make("tr");
    const corner = make("th", "compare-row-heading", "At a glance"); corner.scope = "col"; heading.append(corner);
    for (const item of selected) {
      const record = cache.get(item.slug);
      const cell = make("th", "compare-server-heading"); cell.scope = "col";
      const name = record?.server ? plain(record.server.name) || item.slug : item.name || item.slug;
      const media = make("span", "compare-server-media");
      const imageUrl = record?.server ? safeImage(record.server.logo_url || record.server.banner_url || "") : "";
      const initials = () => make("span", "", name.split(/\s+/).slice(0, 2).map(part => part[0]).join("").toUpperCase());
      if (imageUrl) { const image = make("img", ""); image.src = imageUrl; image.alt = ""; image.width = 64; image.height = 64; image.referrerPolicy = "no-referrer"; image.addEventListener("error", () => image.replaceWith(initials()), { once: true }); media.append(image); }
      else media.append(initials());
      cell.append(media);
      const title = make(record?.server ? "a" : "strong", "compare-server-name", name); if (record?.server) title.href = `/server/${item.slug}`; cell.append(title);
      if (record?.error) cell.append(make("p", "compare-server-error", record.error));
      const remove = make("button", "compare-remove", "Remove"); remove.type = "button"; remove.setAttribute("aria-label", `Remove ${name} from comparison`);
      remove.addEventListener("click", () => { model.remove(item.slug); requestAnimationFrame(() => ($(".compare-remove") || $("#compare-browse")).focus()); }); cell.append(remove);
      heading.append(cell);
    }
    head.append(heading); table.append(head);
    const body = make("tbody");
    for (const [key, label] of [["game", "Game"], ["region", "Region"], ["language", "Language"], ["access", "How to join"], ["framework", "Framework / mode"], ["tags", "Listed features"], ["state", "Server status"], ["count", "Player count"], ["checked", "Last observed"]]) {
      const row = make("tr"); const labelCell = make("th", "compare-row-heading", label); labelCell.scope = "row"; row.append(labelCell);
      for (const item of selected) {
        const cell = make("td"); const record = cache.get(item.slug);
        if (["state", "count", "checked"].includes(key)) { cell.dataset.compareField = key; cell.dataset.compareSlug = item.slug; }
        if (!record) cell.textContent = "Loading…";
        else if (!record.server) cell.textContent = "Unavailable";
        else {
          const values = facts(record.server);
          if (key === "tags") { const tags = make("ul", "compare-tags"); for (const tag of values.tags) tags.append(make("li", "", tag)); cell.append(tags); if (!values.tags.length) cell.textContent = "No features provided"; }
          else if (key === "checked" && values.checkedAt) { const time = make("time", "", values.checked); time.dateTime = values.checkedAt; cell.append(time); }
          else cell.textContent = values[key];
        }
        row.append(cell);
      }
      body.append(row);
    }
    table.append(body); results.replaceChildren(table);
  }
  function updateFreshness() {
    results.querySelectorAll("[data-compare-field]").forEach(cell => {
      const record = cache.get(cell.dataset.compareSlug);
      if (!record?.server) return;
      const values = facts(record.server), key = cell.dataset.compareField;
      if (key === "checked" && values.checkedAt) { const time = make("time", "", values.checked); time.dateTime = values.checkedAt; cell.replaceChildren(time); }
      else cell.textContent = values[key];
    });
  }
  async function refresh(force = false) {
    const current = ++generation; controller?.abort(); clearInterval(refreshTimer);
    controller = new AbortController();
    const requestController = controller;
    const selected = model.selected();
    for (const slug of cache.keys()) if (!selected.some(item => item.slug === slug)) cache.delete(slug);
    if (force) cache.clear();
    $("#compare-count").textContent = `${selected.length} of 3 selected`;
    $("#compare-clear").disabled = selected.length === 0;
    $("#compare-share").disabled = selected.length === 0;
    $("#compare-refresh").disabled = selected.length === 0;
    empty.hidden = selected.length > 0; $("#compare-table-wrap").hidden = selected.length === 0;
    results.setAttribute("aria-busy", String(selected.length > 0));
    history.replaceState(history.state, "", model.href());
    if (!selected.length) { results.replaceChildren(); notice.textContent = "Choose up to three servers from the directory to start comparing."; results.setAttribute("aria-busy", "false"); return; }
    table(selected); notice.textContent = "Loading the latest published listing details…";
    const timer = setTimeout(() => requestController.abort(), 10_000);
    await Promise.all(selected.map(async item => {
      if (cache.get(item.slug)?.server && !force) return;
      try {
        // Keep same-origin deployment/security cookies on protected previews.
        // Only the public listing fields below are retained or displayed.
        const response = await fetch(`/api/servers?slug=${encodeURIComponent(item.slug)}`, { headers: { Accept: "application/json" }, credentials: "same-origin", signal: requestController.signal });
        if (response.status === 404) { if (current === generation) cache.set(item.slug, { error: "This listing is no longer available." }); return; }
        if (!response.ok) throw new Error("Unavailable");
        const payload = await response.json();
        const server = Array.isArray(payload.servers) ? payload.servers.find(row => row?.slug === item.slug && Object.hasOwn(games, row.platform_id)) : null;
        if (current !== generation) return;
        if (!server) cache.set(item.slug, { error: "This listing is no longer available." });
        else cache.set(item.slug, { server: { name: plain(server.name), platform_id: server.platform_id, platform_name: plain(server.platform_name), region: plain(server.region), language: plain(server.language), access_type: plain(payload.engagement?.accessType || server.access_type), framework: plain(server.framework), tags: facts(server).tags, online: server.online, players: server.players, capacity: server.max_players ?? server.capacity, checked_at: plain(server.checked_at || server.checkedAt), count_scope: plain(server.count_scope), applicationOnly: server.applicationOnly === true, logo_url: safeImage(server.logo_url || ""), banner_url: safeImage(server.banner_url || "") } });
      } catch { if (current === generation) cache.set(item.slug, { error: "Details could not be loaded. Try Refresh." }); }
    }));
    clearTimeout(timer);
    if (current !== generation) return;
    table(selected); results.setAttribute("aria-busy", "false");
    const unavailable = selected.filter(item => !cache.get(item.slug)?.server).length;
    notice.textContent = unavailable ? `${unavailable} ${unavailable === 1 ? "listing is" : "listings are"} unavailable. You can remove ${unavailable === 1 ? "it" : "them"} or try Refresh.` : "Compare the published details below. Missing information means it has not been provided.";
    // Age displayed observations out even if the comparison is left open.
    refreshTimer = setInterval(() => { if (current === generation) updateFreshness(); }, 60_000);
  }
  $("#compare-clear").addEventListener("click", () => model.clear());
  $("#compare-refresh").addEventListener("click", () => refresh(true));
  $("#compare-share").addEventListener("click", async () => {
    const url = new URL(model.href(), location.origin).href;
    try { await navigator.clipboard.writeText(url); notice.textContent = "Comparison link copied. It contains only the selected public server addresses."; }
    catch { const field = $("#compare-share-url"); field.hidden = false; field.value = url; field.focus(); field.select(); notice.textContent = "Copy the comparison link from the field below."; }
  });
  window.addEventListener("browserp:compare-changed", () => { $("#compare-share-url").hidden = true; refresh(); });
  window.addEventListener("pagehide", () => { controller?.abort(); clearInterval(refreshTimer); });
  window.addEventListener("pageshow", event => { if (event.persisted) refresh(); });
  refresh();
})();
