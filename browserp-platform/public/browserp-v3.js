(() => {
  "use strict";

  const state = { session: null, ads: new Map() };
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  function node(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = String(text);
    return element;
  }

  function preferredTheme() {
    let saved = "";
    try { saved = localStorage.getItem("browserp-theme") || ""; } catch { /* Use the operating-system preference when storage is unavailable. */ }
    return ["light", "dark"].includes(saved) ? saved : (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
  }

  function saveTheme(theme) {
    try { localStorage.setItem("browserp-theme", theme); } catch { /* Theme still applies for this page view. */ }
  }

  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    $$('[data-theme-label]').forEach((label) => { label.textContent = theme === "light" ? "Use dark mode" : "Use light mode"; });
  }

  function initials(value) {
    return String(value || "BrowseRP member").trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
  }

  async function api(path, options = {}) {
    const method = String(options.method || "GET").toUpperCase();
    const changing = !["GET", "HEAD"].includes(method);
    const response = await fetch(path, {
      ...options,
      method,
      credentials: "same-origin",
      headers: {
        Accept: "application/json",
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...(changing && state.session?.csrfToken ? { "X-BrowseRP-CSRF": state.session.csrfToken } : {}),
        ...(options.headers || {})
      }
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(payload.error || "Something went wrong. Please try again."), { status: response.status });
    return payload;
  }

  function toast(message, tone = "") {
    const target = $("#site-toast");
    if (!target) return;
    target.textContent = message;
    target.classList.toggle("error", tone === "error");
    target.classList.add("show");
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => target.classList.remove("show"), 3600);
  }

  function menu() {
    const button = $("[data-menu-v3]");
    const links = $("[data-nav-links-v3]");
    const actions = $("[data-nav-actions-v3]");
    if (!button || !links || !actions) return;
    const mobile = matchMedia("(max-width: 760px)");
    function set(open) {
      const active = mobile.matches && open;
      document.body.classList.toggle("menu-open", active);
      button.setAttribute("aria-expanded", String(active));
      button.setAttribute("aria-label", active ? "Close menu" : "Open menu");
      links.inert = mobile.matches && !active;
      actions.inert = mobile.matches && !active;
      links.setAttribute("aria-hidden", String(mobile.matches && !active));
      actions.setAttribute("aria-hidden", String(mobile.matches && !active));
    }
    button.addEventListener("click", () => set(button.getAttribute("aria-expanded") !== "true"));
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && button.getAttribute("aria-expanded") === "true") { set(false); button.focus(); }
    });
    mobile.addEventListener?.("change", () => set(false));
    $$('a', links).forEach((link) => link.addEventListener("click", () => set(false)));
    set(false);
  }

  async function session() {
    try { state.session = await api("/api/auth/session"); }
    catch { state.session = { authenticated: false, csrfToken: "" }; }
    $$('[data-account-v3], [data-account-link]').forEach((link) => {
      if (!state.session.authenticated) { link.textContent = "Sign in"; link.href = "/dashboard"; return; }
      const profile = state.session.user?.profile || {};
      const name = profile.display_name || profile.username || "BrowseRP member";
      const avatarApproved = profile.avatar_review_status === "approved" && /^https:\/\//i.test(profile.avatar_url || "");
      const wrap = node("div", "account-menu-v3");
      const button = node("button", "account-trigger-v3"); button.type = "button"; button.setAttribute("aria-haspopup", "menu"); button.setAttribute("aria-expanded", "false"); button.setAttribute("aria-label", `Open account menu for ${name}`);
      const avatar = avatarApproved ? new Image() : node("span", "account-initials-v3", initials(name));
      if (avatarApproved) { avatar.className = "account-avatar-v3"; avatar.src = profile.avatar_url; avatar.alt = ""; avatar.referrerPolicy = "no-referrer"; }
      button.append(avatar, node("span", "account-name-v3", name), node("span", "account-chevron-v3", "⌄"));
      const menu = node("div", "account-popover-v3"); menu.hidden = true; menu.setAttribute("role", "menu");
      const dashboard = node("a", "", "Dashboard"); dashboard.href = "/dashboard"; dashboard.setAttribute("role", "menuitem");
      const settings = node("a", "", "Profile & settings"); settings.href = "/dashboard#account"; settings.setAttribute("role", "menuitem");
      const theme = node("button", "", ""); theme.type = "button"; theme.dataset.themeLabel = ""; theme.setAttribute("role", "menuitem");
      const logout = node("button", "account-danger-v3", "Sign out"); logout.type = "button"; logout.setAttribute("role", "menuitem");
      function setOpen(open) { menu.hidden = !open; button.setAttribute("aria-expanded", String(open)); wrap.classList.toggle("open", open); }
      button.addEventListener("click", () => setOpen(menu.hidden));
      theme.addEventListener("click", () => { const next = document.documentElement.dataset.theme === "light" ? "dark" : "light"; saveTheme(next); applyTheme(next); setOpen(false); });
      logout.addEventListener("click", async () => { try { await api("/api/auth/logout", { method: "POST", body: JSON.stringify({}) }); location.assign("/"); } catch (error) { toast(error.message, "error"); } });
      document.addEventListener("click", (event) => { if (!wrap.contains(event.target)) setOpen(false); });
      wrap.addEventListener("keydown", (event) => { if (event.key === "Escape") { setOpen(false); button.focus(); } });
      menu.append(dashboard, settings, theme, logout); wrap.append(button, menu); link.replaceWith(wrap); applyTheme(document.documentElement.dataset.theme || preferredTheme());
    });
    return state.session;
  }

  function safeDestination(value) {
    try {
      const url = new URL(String(value || ""), location.origin);
      if (url.origin === location.origin) return `${url.pathname}${url.search}`;
      if (url.protocol === "https:") return url.toString();
    } catch { /* Invalid advert destinations never become links. */ }
    return "";
  }

  const ADVERT_ARTWORK = Object.freeze([
    "/assets/adverts/serious-roleplay.jpg",
    "/assets/adverts/custom-cars.jpg",
    "/assets/adverts/community-stories.jpg"
  ]);
  const HOUSE_ADVERTS = Object.freeze([
    { name: "BrowseRP discovery", headline: "Find the roleplay that fits you", body: "Explore communities across games, worlds and simulators.", ctaLabel: "Browse communities", destinationUrl: "/servers", imageUrl: ADVERT_ARTWORK[0] },
    { name: "BrowseRP advertising", headline: "Put your community in front of roleplayers", body: "Personalised picture placements are reviewed before they go live.", ctaLabel: "Advertise here", destinationUrl: "/advertise", imageUrl: ADVERT_ARTWORK[1] },
    { name: "BrowseRP stories", headline: "Every game has a roleplay community", body: "From city life to westerns, block worlds, survival and driving groups.", ctaLabel: "Explore the directory", destinationUrl: "/servers", imageUrl: ADVERT_ARTWORK[2] }
  ]);

  function safeAdvertImage(value, fallbackIndex = 0) {
    try {
      const url = new URL(String(value || ""), location.origin);
      const localAsset = url.origin === location.origin
        && /^\/assets\/adverts\/[a-z0-9][a-z0-9_\/-]*\.(?:avif|webp|png|jpe?g)$/i.test(url.pathname);
      const reviewedStorage = url.origin === "https://kywabzfgjoqiznnxygbq.supabase.co"
        && /^\/storage\/v1\/object\/public\/advertisements\/[a-z0-9][a-z0-9_.\/-]*\.(?:avif|webp|png|jpe?g)$/i.test(url.pathname)
        && !url.pathname.includes("..");
      if (localAsset) return url.pathname;
      if (reviewedStorage) return url.toString();
    } catch { /* Invalid advert artwork falls back to a first-party image. */ }
    return ADVERT_ARTWORK[fallbackIndex % ADVERT_ARTWORK.length];
  }

  async function adverts() {
    const placements = [...new Set($$("[data-ad-placement]").map((element) => element.dataset.adPlacement))];
    $$('[data-ad-placement="side"]').forEach((root) => {
      state.ads.set("side", [...HOUSE_ADVERTS]);
      renderAdvertPlacement(root);
    });
    await Promise.all(placements.map(async (placement) => {
      try {
        const payload = await api(`/api/public/adverts?placement=${encodeURIComponent(placement)}`);
        const adverts = Array.isArray(payload.adverts) ? payload.adverts : [];
        state.ads.set(placement, placement === "side" && !adverts.length ? [...HOUSE_ADVERTS] : adverts);
      } catch { state.ads.set(placement, placement === "side" ? [...HOUSE_ADVERTS] : []); }
    }));
    $$('[data-ad-placement]').forEach(renderAdvertPlacement);
  }

  function renderAdvertPlacement(root) {
    root._browserpAdvertCleanup?.();
    const list = state.ads.get(root.dataset.adPlacement) || [];
    if (!list.length) { root.hidden = true; return; }
    root.hidden = false;
    let index = 0;
    const visual = root.classList.contains("side-ad-v3");
    let copy = $("[data-ad-copy]", root);
    let image;
    let dots;
    if (visual) {
      root.setAttribute("role", "region");
      root.setAttribute("aria-roledescription", "carousel");
      root.setAttribute("aria-label", "Advertisements");
      root.tabIndex = 0;
      const label = node("span", "ad-label-v3", "Advertisement");
      const stage = node("div", "side-ad-stage-v3");
      image = new Image();
      image.className = "side-ad-image-v3";
      image.alt = "";
      image.loading = "eager";
      const shade = node("div", "side-ad-shade-v3");
      copy = node("div", "side-ad-copy-v3");
      copy.dataset.adCopy = "";
      stage.append(image, shade, copy);
      if (list.length > 1) {
        const previous = node("button", "ad-arrow-v3 ad-arrow-previous-v3", "‹");
        previous.type = "button"; previous.dataset.adDirection = "previous"; previous.setAttribute("aria-label", "Previous advert");
        const next = node("button", "ad-arrow-v3 ad-arrow-next-v3", "›");
        next.type = "button"; next.dataset.adDirection = "next"; next.setAttribute("aria-label", "Next advert");
        stage.append(previous, next);
        dots = node("div", "ad-dots-v3");
        list.forEach((advert, position) => {
          const dot = node("button", "ad-dot-v3");
          dot.type = "button";
          dot.setAttribute("aria-label", `Show advert ${position + 1}: ${advert.headline || advert.name || "BrowseRP advert"}`);
          dot.addEventListener("click", () => { index = position; draw(); restart(); });
          dots.append(dot);
        });
      }
      root.replaceChildren(label, stage, ...(dots ? [dots] : []));
    }
    function draw() {
      const advert = list[index];
      if (!copy) return;
      if (image) {
        image.classList.add("is-changing");
        image.src = safeAdvertImage(advert.imageUrl, index);
        image.addEventListener("load", () => image.classList.remove("is-changing"), { once: true });
      }
      const strong = node("strong", "", advert.headline || advert.name || "BrowseRP advert");
      const body = node("span", "", advert.body || "");
      copy.replaceChildren(strong, body);
      const destination = safeDestination(advert.destinationUrl);
      if (destination) {
        const link = node("a", "", advert.ctaLabel || "Learn more");
        link.href = destination;
        if (destination.startsWith("https://")) link.rel = "noopener noreferrer";
        copy.append(link);
      }
      $$('button', dots || document.createElement("div")).forEach((dot, position) => {
        dot.setAttribute("aria-current", position === index ? "true" : "false");
      });
    }
    let timer;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    function stop() { window.clearInterval(timer); }
    root._browserpAdvertCleanup = stop;
    function restart() {
      stop();
      if (visual && list.length > 1 && !reducedMotion.matches) {
        timer = window.setInterval(() => { index = (index + 1) % list.length; draw(); }, 7000);
      }
    }
    $$('[data-ad-direction]', root).forEach((button) => button.addEventListener("click", () => {
      index = (index + (button.dataset.adDirection === "next" ? 1 : -1) + list.length) % list.length;
      draw(); restart();
    }));
    if (visual) {
      root.addEventListener("mouseenter", stop);
      root.addEventListener("mouseleave", restart);
      root.addEventListener("focusin", stop);
      root.addEventListener("focusout", restart);
      root.addEventListener("keydown", (event) => {
        if (!['ArrowLeft','ArrowRight'].includes(event.key)) return;
        event.preventDefault();
        index = (index + (event.key === 'ArrowRight' ? 1 : -1) + list.length) % list.length;
        draw(); restart();
      });
    }
    draw();
    restart();
  }

  function readableDate(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat("en-GB", { dateStyle: "long" }).format(date);
  }

  function footer() {
    const root = $(".footer-v3");
    if (!root || $(".footer-grid-v3", root)) return;
    const grid = node("div", "shell-v3 footer-grid-v3");
    const brand = node("div", "footer-brand-v3");
    const lockup = node("span", "logo-lockup-v3"); const mark = new Image(); mark.src = "/browserp-mark-v3.png"; mark.alt = "RP";
    lockup.append(node("span", "logo-word-v3", "Browse"), mark); brand.append(lockup, node("p", "", "A clearer way to discover roleplay communities across games and simulators."));
    grid.append(brand);
    const groups = [
      ["Discover", [["Browse servers","/servers"],["UK servers","/servers?region=United%20Kingdom"],["US servers","/servers?region=United%20States"],["Guides & blog","/blog"]]],
      ["Server owners", [["List my server","/list-server"],["My listings","/dashboard"],["Advertise","/advertise"],["BrowseRP Coins","/coins"]]],
      ["BrowseRP", [["Our vision","/about"],["Community standards","/legal#standards"],["Safety","/legal#safety"],["Ban appeal","/appeal"]]],
      ["Legal & help", [["Privacy policy","/legal#privacy"],["Cookie policy","/legal#cookies"],["Refund policy","/legal#refunds"],["Help & contact","/legal#contact"]]]
    ];
    for (const [heading, links] of groups) { const column=node("div","footer-column-v3");column.append(node("strong","",heading));for(const [label,href] of links){const link=node("a","",label);link.href=href;column.append(link);}grid.append(column); }
    const bottom=node("div","shell-v3 footer-bottom-v3");bottom.append(node("span","",`© ${new Date().getFullYear()} BrowseRP · Operated in the United Kingdom`),node("span","","Payments disabled while the coin system completes financial testing."));
    root.replaceChildren(grid,bottom);
  }

  async function blogIndex() {
    const root = $("#blog-list");
    if (!root) return;
    try {
      const { posts = [] } = await api("/api/public/blogs");
      root.replaceChildren(...posts.map((post) => {
        const card = node("article", "blog-card-v3");
        const time = node("time", "", readableDate(post.publishedAt));
        const title = node("h2", "");
        const link = node("a", "", post.title);
        link.href = `/blog/${encodeURIComponent(post.slug)}`;
        title.append(link);
        card.append(time, title, node("p", "", post.excerpt));
        const more = node("a", "button-v3 button-quiet-v3", "Read article");
        more.href = link.href;
        card.append(more);
        return card;
      }));
      $("#blog-empty").hidden = posts.length > 0;
      root.hidden = posts.length === 0;
    } catch (error) { toast(error.message, "error"); }
  }

  function renderPlainArticle(root, body) {
    const fragment = document.createDocumentFragment();
    String(body || "").split(/\n{2,}/).forEach((block) => {
      const text = block.trim();
      if (!text) return;
      if (/^##?\s+/.test(text)) fragment.append(node(text.startsWith("## ") ? "h2" : "h1", "", text.replace(/^##?\s+/, "")));
      else fragment.append(node("p", "", text.replace(/\n/g, " ")));
    });
    root.replaceChildren(fragment);
  }

  async function blogPost() {
    const root = $("#blog-article");
    if (!root) return;
    const slug = location.pathname.split("/").filter(Boolean).at(-1) || new URLSearchParams(location.search).get("slug");
    try {
      const { post } = await api(`/api/public/blogs?slug=${encodeURIComponent(slug)}`);
      $("#blog-title").textContent = post.title;
      $("#blog-date").textContent = readableDate(post.publishedAt);
      document.title = post.seoTitle || `${post.title} — BrowseRP`;
      const description = document.querySelector('meta[name="description"]');
      if (description && post.seoDescription) description.content = post.seoDescription;
      renderPlainArticle(root, post.body);
    } catch (error) {
      $("#blog-title").textContent = "Article not found";
      root.replaceChildren(node("p", "", "This article is unavailable or has been archived."));
    }
  }

  async function serverDetail() {
    const root = $("#server-detail-v3");
    if (!root) return;
    const slug = location.pathname.split("/").filter(Boolean).at(-1) || new URLSearchParams(location.search).get("slug") || "";
    try {
      const payload = await api(`/api/servers?slug=${encodeURIComponent(slug)}`);
      const server = payload.servers?.[0];
      if (!server) throw Object.assign(new Error("Server not found"), { status: 404 });
      const engagement = payload.engagement || {};
      const platform = server.platform_name || server.platform_id || "Roleplay";
      $("#server-name-v3").textContent = server.name;
      $("#server-description-v3").textContent = server.description;
      $("#server-platform-v3").textContent = `${platform} roleplay listing`;
      $("#server-meta-v3").textContent = [platform, server.region, server.language, server.framework, engagement.accessType].filter(Boolean).join(" · ");
      $("#server-votes-v3").textContent = `${Number(engagement.voteCount || 0).toLocaleString()} votes`;
      $("#server-status-v3").textContent = server.online ? `${server.players || 0} / ${server.capacity || "?"} online` : "Status unavailable";
      $("#server-initials-v3").textContent = String(server.name || "RP").split(/\s+/).slice(0,2).map((part) => part[0]).join("").toUpperCase();
      const tags = $("#server-tags-v3");
      tags.replaceChildren(...(Array.isArray(server.tags) ? server.tags : []).map((tag) => node("span", "tag-v3", tag)));
      const join = $("#server-join-v3");
      const destination = safeDestination(server.community_url);
      join.hidden = !destination;
      if (destination) { join.href = destination; join.rel = "noopener noreferrer"; }
      const connect = $("#server-connect-v3");
      connect.hidden = !engagement.cfxJoinUrl;
      if (engagement.cfxJoinUrl) { connect.href = engagement.cfxJoinUrl; connect.rel = "noopener noreferrer"; connect.textContent = "Connect via Cfx"; }
      $("#vote-server-v3").dataset.serverId = server.id;
      $("#comment-form-v3").dataset.serverId = server.id;
      $("#report-form-v3").dataset.serverId = server.id;
      const comments = $("#comments-v3");
      comments.replaceChildren(...(engagement.comments || []).map((comment) => {
        const item = node("article", "comment-v3");
        item.append(node("strong", "", comment.author || "BrowseRP member"), node("time", "", readableDate(comment.createdAt)), node("p", "", comment.body));
        return item;
      }));
      $("#comments-empty-v3").hidden = (engagement.comments || []).length > 0;
      document.title = `${server.name} — ${platform} roleplay | BrowseRP`;
    } catch {
      const empty = node("section", "empty-v3 server-missing-v3");
      empty.append(
        node("span", "eyebrow-v3", "Server listing"),
        node("h1", "", "This server is not available."),
        node("p", "", "It may still be under review, have been removed, or the address may be incorrect.")
      );
      const actions = node("div", "hero-actions-v3");
      const browse = node("a", "button-v3 button-primary-v3", "Browse servers"); browse.href = "/servers";
      const home = node("a", "button-v3 button-secondary-v3", "Return home"); home.href = "/";
      actions.append(browse, home); empty.append(actions); root.replaceChildren(empty);
    }
  }

  function interactionForms() {
    $("#vote-server-v3")?.addEventListener("click", async (event) => {
      if (!state.session?.authenticated) { location.assign("/dashboard"); return; }
      try {
        const { result } = await api("/api/servers", { method: "POST", body: JSON.stringify({ action: "vote", serverId: event.currentTarget.dataset.serverId }) });
        $("#server-votes-v3").textContent = `${Number(result.voteCount || 0).toLocaleString()} votes`;
        event.currentTarget.textContent = "Voted";
      } catch (error) { toast(error.message, "error"); }
    });
    $("#comment-form-v3")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!state.session?.authenticated) { location.assign("/dashboard"); return; }
      const form = event.currentTarget;
      try {
        await api("/api/servers", { method: "POST", body: JSON.stringify({ action: "comment", serverId: form.dataset.serverId, body: new FormData(form).get("comment") }) });
        form.reset(); toast("Comment sent for moderation.");
      } catch (error) { toast(error.message, "error"); }
    });
    $("#report-form-v3")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!state.session?.authenticated) { location.assign("/dashboard"); return; }
      const form = event.currentTarget; const data = new FormData(form);
      try {
        await api("/api/servers", { method: "POST", body: JSON.stringify({ action: "report", serverId: form.dataset.serverId, category: data.get("category"), body: data.get("details") }) });
        form.reset(); toast("Report received. Staff can now review it.");
      } catch (error) { toast(error.message, "error"); }
    });
  }

  function appeal() {
    $("#appeal-form-v3")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = event.currentTarget; const data = new FormData(form); const submit = $("button[type=submit]", form);
      submit.disabled = true;
      try {
        const { appeal } = await api("/api/public/appeals", { method: "POST", body: JSON.stringify(Object.fromEntries(data)) });
        form.reset(); $("#appeal-status-v3").textContent = `Appeal received. Reference: ${appeal.reference}`;
      } catch (error) { $("#appeal-status-v3").textContent = error.message; }
      finally { submit.disabled = false; }
    });
  }

  async function init() {
    applyTheme(preferredTheme());
    menu();
    footer();
    $$('[data-year-v3]').forEach((element) => { element.textContent = String(new Date().getFullYear()); });
    await session();
    adverts();
    blogIndex();
    blogPost();
    await serverDetail();
    interactionForms();
    appeal();
  }
  init();
})();
