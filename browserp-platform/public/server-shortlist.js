(() => {
  "use strict";
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
  let session = null, generation = 0, controller = new AbortController();
  let saved = new Set(), loaded = false, loadFailed = false, noticeTimer;
  const busy = new Set(), uncertain = new Set();
  const make = (tag, className, text) => { const item = document.createElement(tag); item.className = className; if (text) item.textContent = text; return item; };
  function notice(text) {
    let root = document.querySelector("[data-shortlist-status]");
    if (!root) { root = make("p", "shortlist-status-v9"); root.dataset.shortlistStatus = ""; root.setAttribute("role", "status"); document.body.append(root); }
    root.textContent = text;
    clearTimeout(noticeTimer); noticeTimer = setTimeout(() => { root.textContent = ""; }, 6500);
  }
  async function request(path, options = {}) {
    const response = await fetch(path, { credentials: "same-origin", cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(12000)]), ...options,
      headers: { Accept: "application/json", ...(options.body ? { "Content-Type": "application/json" } : {}), ...(options.headers || {}) } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(data.error || "Saved servers are unavailable. Please try again later."), { status: response.status });
    return data;
  }
  function paint(root) {
    const id = root.dataset.serverId, slug = root.dataset.serverSlug, name = root.dataset.serverName;
    const save = root.querySelector("[data-shortlist-save]");
    save.textContent = busy.has(id) ? "Saving…" : uncertain.has(id) ? "Check saved servers" : saved.has(id) ? "Saved" : "Save";
    save.setAttribute("aria-pressed", String(saved.has(id)));
    save.setAttribute("aria-label", `${saved.has(id) ? "Unsave" : "Save"} ${name}`);
    save.disabled = !UUID.test(id) || !session || busy.has(id) || uncertain.has(id) || Boolean(session.authenticated && (!loaded || loadFailed));
    save.title = !UUID.test(id) ? "Saving is unavailable for this listing" : loadFailed ? "Refresh to check your saved servers" : "Save to your account";
    save.setAttribute("aria-busy", String(busy.has(id)));
    const comparison = window.BrowseRPCompare;
    const compare = root.querySelector("[data-shortlist-compare]");
    const selected = Boolean(comparison?.has(slug));
    compare.textContent = selected ? "Added to compare" : "Compare";
    compare.setAttribute("aria-pressed", String(selected));
    compare.setAttribute("aria-label", `${selected ? "Remove" : "Add"} ${name} ${selected ? "from" : "to"} comparison`);
    compare.disabled = !comparison;
    const count = comparison?.selected().length || 0;
    const open = root.querySelector("[data-shortlist-open]");
    open.hidden = !count; open.textContent = `Compare (${count}/3)`; open.href = comparison?.href() || "/compare";
  }
  const repaint = () => document.querySelectorAll(".server-shortlist-actions").forEach(paint);
  function endSession() {
    generation++; controller.abort(); controller = new AbortController();
    session = { authenticated: false }; saved.clear(); loaded = false; loadFailed = false; busy.clear(); uncertain.clear();
    clearTimeout(noticeTimer);
    const status = document.querySelector("[data-shortlist-status]"); if (status) status.textContent = "";
    repaint();
  }
  async function setSession(value) {
    endSession(); session = value || { authenticated: false };
    const current = generation;
    if (!session.authenticated || !session.user?.id) { repaint(); return; }
    repaint();
    try {
      const data = await request("/api/me/favorites");
      if (current !== generation) return;
      if (!Array.isArray(data.serverIds)) throw Error("Saved servers could not be checked. Refresh before saving.");
      saved = new Set(data.serverIds.filter(id => typeof id === "string" && UUID.test(id)));
      loaded = true;
    } catch (error) {
      if (current !== generation) return;
      if ([401, 403].includes(error.status)) { endSession(); return; }
      loadFailed = true;
    }
    if (current === generation) repaint();
  }
  async function toggleSaved(root) {
    const id = root.dataset.serverId;
    if (!UUID.test(id) || !session || busy.has(id) || uncertain.has(id)) return;
    if (!session.authenticated) {
      const target = `/server/${encodeURIComponent(root.dataset.serverSlug)}`;
      location.assign(`/dashboard?returnTo=${encodeURIComponent(target)}`); return;
    }
    if (!loaded || loadFailed) return;
    const accountId = session.user?.id, current = generation;
    let sent = false;
    busy.add(id); repaint();
    try {
      const fresh = await request("/api/auth/session");
      if (current !== generation) return;
      if (!fresh.authenticated || fresh.user?.id !== accountId || !fresh.csrfToken) {
        endSession(); notice("Your sign-in changed. Refresh before changing saved servers."); return;
      }
      sent = true;
      const { result } = await request("/api/me/favorites", { method: "POST", headers: { "X-BrowseRP-CSRF": fresh.csrfToken }, body: JSON.stringify({ serverId: id, accountId }) });
      if (current !== generation) return;
      if (typeof result?.favorited !== "boolean") throw Error("Save status could not be confirmed.");
      if (result.favorited) saved.add(id); else saved.delete(id);
      notice(result.favorited ? "Server saved. Find it in Favourite servers in your account menu." : "Server removed from your favourites.");
    } catch (error) {
      if (current !== generation) return;
      if ([401, 403, 409].includes(error.status)) { endSession(); notice("Your sign-in changed. Refresh before changing saved servers."); return; }
      if (sent && (!error.status || error.status >= 500)) {
        uncertain.add(id); notice("We couldn’t confirm that save. Check Favourite servers or refresh before trying again.");
      } else notice(error.message);
    } finally { if (current === generation) { busy.delete(id); repaint(); } }
  }
  function actions(server) {
    const slug = String(server.slug || ""), name = String(server.name || "Server").slice(0, 160);
    if (!SLUG.test(slug) || slug.length > 160) return null;
    const root = make("div", "server-shortlist-actions");
    root.dataset.serverId = String(server.id || ""); root.dataset.serverSlug = slug; root.dataset.serverName = name;
    root.setAttribute("role", "group"); root.setAttribute("aria-label", `Shortlist ${name}`);
    const save = make("button", "shortlist-button-v9", "Save"); save.type = "button"; save.dataset.shortlistSave = "";
    const compare = make("button", "shortlist-button-v9", "Compare"); compare.type = "button"; compare.dataset.shortlistCompare = "";
    const open = make("a", "shortlist-open-v9"); open.dataset.shortlistOpen = "";
    root.append(save, compare, open);
    save.addEventListener("click", () => toggleSaved(root));
    compare.addEventListener("click", () => {
      const result = window.BrowseRPCompare?.toggle({ slug, name });
      if (!result?.ok) notice(result?.reason === "full" ? "Compare up to three servers. Open your comparison to remove one first." : "This browser could not update your comparison.");
      else notice(`${name} ${window.BrowseRPCompare.has(slug) ? "added to" : "removed from"} comparison.`);
      repaint();
    });
    paint(root); return root;
  }
  function wrap(card, server) {
    const controls = actions(server); if (!controls) return card;
    const wrapper = make("article", "server-shortlist-card"); wrapper.append(card, controls); return wrapper;
  }
  function mountDetail(root, server) {
    root.querySelector(".server-shortlist-actions")?.remove();
    const controls = actions(server), target = root.querySelector(".detail-actions-v3");
    if (controls && target) { controls.classList.add("shortlist-detail-v9"); target.after(controls); }
  }
  window.BrowseRPShortlist = { wrap, setSession, mountDetail };
  window.addEventListener("browserp:compare-changed", repaint);
  window.addEventListener("browserp:session-ended", endSession);
  window.addEventListener("pagehide", endSession);
  window.addEventListener("pageshow", event => { if (event.persisted) { endSession(); location.reload(); } });
  function enhance() {
    document.querySelectorAll("a.server-card:not(.server-card-skeleton)").forEach(card => {
      if (card.parentElement.classList.contains("server-shortlist-card")) return;
      const slug = /^\/server\/([a-z0-9-]+)$/.exec(card.getAttribute("href") || "")?.[1];
      if (!slug) return;
      const marker = document.createComment("shortlist"); card.before(marker);
      marker.replaceWith(wrap(card, { id: card.dataset.serverId, slug, name: card.querySelector("h3")?.textContent }));
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", enhance, { once: true }); else enhance();
})();
