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
    return "dark";
  }

  function applyTheme(theme) {
    document.documentElement.dataset.theme = "dark";
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

  const reveal = (() => {
    let observer = null;
    const prefersReduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
    const prefersDirectScroll = () => matchMedia("(hover: none), (pointer: coarse)").matches;
    const pending = new Set();

    function createObserver() {
      if (observer || prefersReduced()) return;
      // A results section can be many viewports tall after its cards load.
      // Reveal when it enters the viewport; a percentage may never be reached.
      observer = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          const node = entry.target;
          node.classList.add("is-revealed");
          observer.unobserve(node);
        });
      }, { threshold: 0, rootMargin: "0px 0px 35% 0px" });
      pending.forEach((node) => observer.observe(node));
      pending.clear();
    }

    function register(node, _delay = 0, allowScrollReveal = true) {
      if (!(node instanceof Element)) return;
      if (!node.classList.contains("reveal-v3")) node.classList.add("reveal-v3");
      if (!allowScrollReveal) {
        node.classList.add("is-revealed");
        if (observer) observer.unobserve(node);
        return;
      }
      if (prefersReduced() || prefersDirectScroll() || typeof IntersectionObserver !== "function") {
        node.classList.add("is-revealed");
        return;
      }
      if (!observer) {
        pending.add(node);
        createObserver();
      } else {
        observer.observe(node);
      }
    }

    function scan(root = document) {
      const selectors = [
        ".hero-v3",
        ".section-v3",
        ".side-ad-v3",
        ".footer-v3"
      ];
      let index = 0;
      selectors.forEach((selector) => {
        $$(selector, root).forEach((item) => {
          if (item.classList.contains("reveal-v3")) return;
          item.classList.add("reveal-v3", "reveal-on-scroll");
          const containsLiveResults = item.matches(".section-v3") && item.querySelector(".server-list-v3, #game-server-list-v4");
          register(item, Math.min(index++, 6) * 12, !containsLiveResults && !prefersDirectScroll());
        });
      });
    }

    return {
      register,
      scan
    };
  })();

  window.__browserpReveal = reveal;

  async function session() {
    try { state.session = await api("/api/auth/session"); }
    catch { state.session = { authenticated: false, csrfToken: "" }; }
    $$('[data-account-v3], [data-account-link]').forEach((link, index) => {
      if (!state.session.authenticated) { link.textContent = "Sign in"; link.href = "/dashboard"; return; }
      const profile = state.session.user?.profile || {};
      const name = profile.display_name || profile.username || "BrowseRP member";
      const avatarApproved = profile.avatar_review_status === "approved" && /^https:\/\//i.test(profile.avatar_url || "");
      const wrap = node("div", "account-menu-v3");
      const button = node("button", "account-trigger-v3"); button.type = "button"; button.setAttribute("aria-expanded", "false"); button.setAttribute("aria-label", `Open account menu for ${name}`);
      const avatar = avatarApproved ? new Image() : node("span", "account-initials-v3", initials(name));
      if (avatarApproved) {
        avatar.className = "account-avatar-v3";
        avatar.alt = "";
        avatar.referrerPolicy = "no-referrer";
        avatar.addEventListener("error", () => avatar.replaceWith(node("span", "account-initials-v3", initials(name))), { once: true });
        avatar.src = profile.avatar_url;
      }
      button.append(avatar, node("span", "account-name-v3", name), node("span", "account-chevron-v3", "⌄"));
      const menu = node("nav", "account-popover-v3"); menu.hidden = true; menu.inert = true; menu.id = `account-navigation-${index}`; menu.setAttribute("aria-label", "Your account"); button.setAttribute("aria-controls", menu.id);
      const menuItems = [
        ["Profile", "/profile"], ["My servers", "/dashboard#listings"], ["Favourite servers", "/dashboard#saved"],
        ["Recently viewed", "/dashboard#recent"], ["Reviews", "/dashboard#submissions"], ["Settings", "/dashboard#account"]
      ].map(([label, href]) => { const item=node("a","",label);item.href=href;return item; });
      if (state.session.staffAccess === true) {
        const staff = node("a", "account-staff-v3", "Staff Panel"); staff.href = "/staffpanel"; menuItems.push(staff);
      }
      const logout = node("button", "account-danger-v3", "Sign out"); logout.type = "button";
      let menuCloseTimer;
      let menuOpeningFrame;
      function setOpen(open) {
        clearTimeout(menuCloseTimer);
        cancelAnimationFrame(menuOpeningFrame);
        button.setAttribute("aria-expanded", String(open));
        wrap.classList.toggle("open", open);
        menu.dataset.open = "false";
        menu.inert = !open;
        if (open) {
          menu.hidden = false;
          menuOpeningFrame = requestAnimationFrame(() => { menu.dataset.open = "true"; });
          return;
        }
        if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
          menu.hidden = true;
          return;
        }
        menuCloseTimer = window.setTimeout(() => { menu.hidden = true; }, 190);
      }
      button.addEventListener("click", () => setOpen(button.getAttribute("aria-expanded") !== "true"));
      logout.addEventListener("click", async () => { try { await api("/api/auth/logout", { method: "POST", body: JSON.stringify({}) }); location.assign("/"); } catch (error) { toast(error.message, "error"); } });
      document.addEventListener("click", (event) => { if (!wrap.contains(event.target)) setOpen(false); });
      wrap.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && button.getAttribute("aria-expanded") === "true") {
          event.preventDefault(); event.stopPropagation(); setOpen(false); button.focus();
        }
      });
      wrap.addEventListener("focusout", (event) => { if (!wrap.contains(event.relatedTarget)) setOpen(false); });
      document.addEventListener("navigation:close", () => setOpen(false));
      menu.append(...menuItems, logout); wrap.append(button, menu); link.replaceWith(wrap); applyTheme(preferredTheme());
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

  function safeWebsiteUrl(value) {
    if (typeof value !== "string" || value.length > 1000 || !/^https:\/\//i.test(value) || /[\s\\\u0000-\u001f\u007f]/.test(value)) return "";
    try {
      const url = new URL(value);
      return url.protocol === "https:" && !url.username && !url.password ? url.href : "";
    } catch { return ""; }
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
    let markArtworkUnavailable;
    let imageSource = "";
    const failedImages = new Set();
    const listeners = [];
    const listen = (type, handler) => {
      root.addEventListener(type, handler);
      listeners.push(() => root.removeEventListener(type, handler));
    };
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
      const imageNotice = node("p", "side-ad-image-notice-v3", "Artwork unavailable.");
      imageNotice.hidden = true;
      const finishImage = (unavailable) => {
        image.classList.remove("is-changing");
        root.classList.toggle("artwork-unavailable", unavailable);
        imageNotice.hidden = !unavailable;
      };
      // Keep the advert readable when a browser blocks its artwork. Do not
      // retry blocked addresses or override a content blocker's image styles.
      markArtworkUnavailable = () => { failedImages.add(imageSource); finishImage(true); };
      image.onerror = () => {
        if (image.getAttribute("src") === imageSource) markArtworkUnavailable();
      };
      image.onload = () => {
        if (image.getAttribute("src") !== imageSource) return;
        if (!image.naturalWidth || getComputedStyle(image).display === "none") markArtworkUnavailable();
        else finishImage(false);
      };
      const shade = node("div", "side-ad-shade-v3");
      copy = node("div", "side-ad-copy-v3");
      copy.dataset.adCopy = "";
      stage.append(image, shade, copy, imageNotice);
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
        imageSource = safeAdvertImage(advert.imageUrl, index);
        if (failedImages.has(imageSource)) markArtworkUnavailable();
        else {
          image.classList.add("is-changing");
          image.src = imageSource;
          if (image.complete) {
            if (image.naturalWidth) image.onload();
            else image.onerror();
          }
        }
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
    root._browserpAdvertCleanup = () => {
      stop();
      listeners.forEach((remove) => remove());
      if (image) { image.onload = null; image.onerror = null; }
    };
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
      listen("mouseenter", stop);
      listen("mouseleave", restart);
      listen("focusin", stop);
      listen("focusout", restart);
      listen("keydown", (event) => {
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
    const lockup = node("span", "logo-lockup-v3"); const mark = new Image(); mark.src = "/assets/browserp-logo-v5.png"; mark.alt = "BrowseRP"; mark.className = "logo-full-v5";
    lockup.append(mark); brand.append(lockup, node("p", "", "A clearer way to discover roleplay communities across games and simulators."));
    grid.append(brand);
    const groups = [
      ["Discover", [["Browse servers","/servers"],["UK servers","/servers?region=United%20Kingdom"],["US servers","/servers?region=United%20States"],["Blog","/blog"]]],
      ["Server owners", [["List my server","/list-server"],["My listings","/dashboard"],["Advertise","/advertise"],["BrowseRP Coins","/coins"]]],
      ["BrowseRP", [["Our vision","/about"],["Community standards","/legal#standards"],["Safety","/legal#safety"],["Ban appeal","/appeal"]]],
      ["Legal & help", [["Privacy policy","/privacy"],["Terms of service","/terms"],["Cookie policy","/legal#cookies"],["Help & contact","/legal#contact"]]]
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

  function serverImageSource(value) {
    if (typeof value !== "string" || !value || value.length > 1_600 || /[\s\\]/.test(value)) return "";
    try {
      const url = new URL(value, location.origin);
      if (url.username || url.password || url.port || url.hash) return "";
      const stored = url.origin === "https://kywabzfgjoqiznnxygbq.supabase.co" && /^\/storage\/v1\/object\/public\/server-media\/[a-z0-9][a-z0-9_.\/-]*\.(?:png|jpe?g|webp|gif)$/i.test(url.pathname) && !url.pathname.includes("..") && !url.search;
      if (stored) return url.href;
      if (url.origin === location.origin && url.pathname === "/api/public/server-image" && [...url.searchParams.keys()].length === 1 && url.searchParams.has("url")) {
        const nested = url.searchParams.get("url");
        if (!/^https:\/\//i.test(nested || "")) return "";
        return serverImageSource(nested);
      }
      if (url.protocol !== "https:") return "";
      const cfx = url.hostname === "frontend.cfx-services.net" && /^\/api\/servers\/icon\/[a-z0-9]{6,12}\/-?\d{1,10}\.png$/.test(url.pathname) && !url.search;
      const cdn = ["cdn.discordapp.com", "media.discordapp.net", "i.imgur.com", "i.postimg.cc", "res.cloudinary.com"].includes(url.hostname) && (/\.(?:png|jpe?g|webp|gif)$/i.test(url.pathname) || url.hostname === "res.cloudinary.com" && /\/image\/upload\//.test(url.pathname));
      return cfx || cdn ? `/api/public/server-image?url=${encodeURIComponent(url.href)}` : "";
    } catch { return ""; }
  }

  function renderServerArtwork(server) {
    const banner = $(".detail-banner-v3", $("#server-detail-v3"));
    const logo = $("#server-initials-v3");
    const logoUrl = serverImageSource(server.logo_url);
    const bannerUrl = serverImageSource(server.banner_url);
    if (bannerUrl) {
      const image = node("img", "server-import-banner-v3");
      image.alt = ""; image.decoding = "async"; image.referrerPolicy = "no-referrer";
      image.addEventListener("error", () => { image.remove(); banner.classList.remove("has-server-artwork-v3"); }, { once: true });
      image.src = bannerUrl; banner.prepend(image); banner.classList.add("has-server-artwork-v3");
    }
    if (logoUrl) {
      const image = node("img", "server-import-logo-v3");
      image.alt = ""; image.decoding = "async"; image.referrerPolicy = "no-referrer";
      image.addEventListener("error", () => logo.replaceChildren(document.createTextNode(initials(server.name))), { once: true });
      image.src = logoUrl; logo.replaceChildren(image);
    }
  }

  function serverPlayerStatus(server) {
    const checked = typeof server.checked_at === "string" && Number.isFinite(Date.parse(server.checked_at)) ? new Date(server.checked_at) : null;
    const age = checked ? Date.now() - checked.getTime() : null;
    const stale = server.imported === true && (age === null || age > 5 * 60_000 || age < -60_000);
    const count = Number.isInteger(server.players) && server.players >= 0 ? server.players : null;
    const rawCapacity = server.max_players ?? server.capacity;
    const capacity = Number.isInteger(rawCapacity) && rawCapacity > 0 ? rawCapacity : null;
    const available = !stale && server.online === true && count !== null && (capacity === null || count <= capacity);
    return { text: available ? `${count.toLocaleString()} / ${capacity === null ? "?" : capacity.toLocaleString()} ${server.count_scope === "network" ? "online across the network" : "online"}` : "Player count unavailable", checked, stale };
  }

  function updateServerPlayers(server, { failed = false } = {}) {
    const status = serverPlayerStatus(server);
    const text = failed ? "Player count unavailable" : status.text;
    $("#server-status-v3").textContent = text;
    const fact = $("#server-info-v5 .server-info-card-v5:last-child dd");
    if (fact) fact.textContent = text;
    const checked = $("#server-checked-v3");
    if (!checked) return;
    checked.hidden = server.imported !== true;
    if (checked.hidden) return;
    checked.replaceChildren();
    if (status.checked) {
      const time = node("time", "", new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "medium" }).format(status.checked));
      time.dateTime = status.checked.toISOString();
      checked.append(document.createTextNode(failed ? "Last checked " : "Checked "), time);
      if (failed || status.stale) checked.append(document.createTextNode(` · Waiting for a fresh ${server.platform_name || server.platform_id || "server"} update`));
    } else checked.textContent = `Waiting for a fresh ${server.platform_name || server.platform_id || "server"} update`;
  }

  function refreshServerPlayers(server, slug) {
    if (server.imported !== true) return;
    let current = server, pending = false, closed = false;
    async function refresh() {
      if (pending || closed || document.visibilityState !== "visible") return;
      pending = true;
      updateServerPlayers(current);
      try {
        const payload = await api(`/api/servers?slug=${encodeURIComponent(slug)}`, { cache: "no-store" });
        const latest = payload.servers?.[0];
        if (!latest || latest.id !== server.id) throw new Error("Server status unavailable");
        current = latest;
        if (!closed) updateServerPlayers(current);
      } catch { if (!closed) updateServerPlayers(current, { failed: true }); }
      finally { pending = false; }
    }
    let timer = window.setInterval(refresh, 60_000);
    const visible = () => { if (document.visibilityState === "visible") refresh(); };
    document.addEventListener("visibilitychange", visible);
    window.addEventListener("pagehide", () => { closed = true; window.clearInterval(timer); document.removeEventListener("visibilitychange", visible); });
    window.addEventListener("pageshow", (event) => {
      if (!event.persisted || !closed) return;
      closed = false; timer = window.setInterval(refresh, 60_000); document.addEventListener("visibilitychange", visible); refresh();
    });
  }

  async function serverDetail() {
    const root = $("#server-detail-v3");
    if (!root) return;
    const slug = location.pathname.split("/").filter(Boolean).at(-1) || new URLSearchParams(location.search).get("slug") || "";
    try {
      const payload = await api(`/api/servers?slug=${encodeURIComponent(slug)}`);
      const server = payload.servers?.[0];
      if (!server) throw Object.assign(new Error("Server not found"), { status: 404 });
      try {
        const recent = JSON.parse(localStorage.getItem("browserp-recent-servers") || "[]");
        const next = [{ slug: server.slug, name: server.name, platform: server.platform_name || server.platform_short || "Roleplay" }, ...recent.filter((item) => item?.slug !== server.slug)].slice(0, 8);
        localStorage.setItem("browserp-recent-servers", JSON.stringify(next));
      } catch { /* Recently viewed is a device-local convenience only. */ }
      const engagement = payload.engagement || {};
      const platform = server.platform_name || server.platform_id || "Roleplay";
      $("#server-name-v3").textContent = server.name;
      $("#server-description-v3").textContent = server.description;
      $("#server-platform-v3").textContent = `${platform} roleplay listing`;
      window.BrowseRPPlatforms.theme(root, window.BrowseRPPlatforms.idFor(server));
      $("#server-meta-v3").replaceChildren(window.BrowseRPPlatforms.metadata(server, engagement));
      $("#server-info-v5").replaceChildren(window.BrowseRPPlatforms.facts(server, engagement));
      $("#server-votes-v3").textContent = `${Number(engagement.voteCount || 0).toLocaleString()} votes`;
      $("#server-initials-v3").textContent = String(server.name || "RP").split(/\s+/).slice(0,2).map((part) => part[0]).join("").toUpperCase();
      renderServerArtwork(server);
      updateServerPlayers(server);
      const tags = $("#server-tags-v3");
      tags.replaceChildren(...(Array.isArray(server.tags) ? server.tags : []).map((tag) => node("span", "tag-v3", tag)));
      const join = $("#server-join-v3");
      const destination = server.community_url ? safeDestination(server.community_url) : "";
      join.hidden = !destination;
      if (destination) { join.href = destination; join.rel = "noopener noreferrer"; }
      const connect = $("#server-connect-v3");
      const connectUrl = engagement.cfxJoinUrl || server.cfx_join_url;
      const validConnect = typeof connectUrl === "string" && /^https:\/\/cfx\.re\/join\/[a-z0-9]{6,12}\/?$/i.test(connectUrl);
      connect.hidden = !validConnect;
      if (validConnect) { connect.href = connectUrl; connect.rel = "noopener noreferrer"; connect.textContent = "Connect via Cfx"; }
      let addressBox = $("#server-minecraft-address");
      if (server.minecraft_address && /^[a-z0-9.-]+:[0-9]{4,5}$/.test(server.minecraft_address)) {
        if (!addressBox) { addressBox=node("div","server-minecraft-address");addressBox.id="server-minecraft-address";connect.parentElement.after(addressBox); }
        const label=node("strong","",`Minecraft ${server.minecraft_edition === "bedrock" ? "Bedrock" : "Java"} address`),address=node("code","",server.minecraft_address),copy=node("button","button-v3 button-secondary-v3","Copy address");copy.type="button";
        copy.addEventListener("click",async()=>{try{await navigator.clipboard.writeText(server.minecraft_address);copy.textContent="Address copied";}catch{copy.textContent="Select the address to copy";}});
        addressBox.replaceChildren(label,address,copy,node("p","muted-v3","Add this address in Minecraft Multiplayer. The player count covers the advertised server or network, including its lobby and other worlds."));
      } else addressBox?.remove();
      const website = $("#server-website-v3");
      const websiteUrl = safeWebsiteUrl(server.website_url);
      if (website) {
        website.hidden = !websiteUrl;
        if (websiteUrl) { website.href = websiteUrl; website.rel = "noopener noreferrer"; }
        else website.removeAttribute("href");
      }
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
      document.title = `${server.name} — ${platform} roleplay — BrowseRP`;
      const claimRoot = $("#server-claim-panel");
      if (claimRoot && window.BrowseRPServerClaims?.init) {
        try { await window.BrowseRPServerClaims.init({ server, root: claimRoot }); }
        catch { claimRoot.replaceChildren(node("p", "", "Claim requests are unavailable right now. Refresh the page to try again.")); claimRoot.hidden = false; }
      }
      refreshServerPlayers(server, slug);
    } catch {
      document.title = "Server unavailable — BrowseRP";
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
      const button = event.currentTarget;
      if (button.disabled) return;
      button.disabled = true;
      button.setAttribute("aria-busy", "true");
      try {
        const { result } = await api("/api/servers", { method: "POST", body: JSON.stringify({ action: "vote", serverId: button.dataset.serverId }) });
        $("#server-votes-v3").textContent = `${Number(result.voteCount || 0).toLocaleString()} votes`;
        button.textContent = "Voted";
        button.setAttribute("aria-pressed", "true");
      } catch (error) {
        button.disabled = false;
        toast(error.message, "error");
      } finally { button.removeAttribute("aria-busy"); }
    });
    $("#comment-form-v3")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!state.session?.authenticated) { location.assign("/dashboard"); return; }
      const form = event.currentTarget;
      const submit = $("button[type=submit]", form);
      if (submit?.disabled) return;
      if (submit) submit.disabled = true;
      form.setAttribute("aria-busy", "true");
      try {
        await api("/api/servers", { method: "POST", body: JSON.stringify({ action: "comment", serverId: form.dataset.serverId, body: new FormData(form).get("comment") }) });
        form.reset(); toast("Comment sent for moderation.");
      } catch (error) { toast(error.message, "error"); }
      finally { if (submit) submit.disabled = false; form.removeAttribute("aria-busy"); }
    });
    $("#report-form-v3")?.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (!state.session?.authenticated) { location.assign("/dashboard"); return; }
      const form = event.currentTarget; const data = new FormData(form);
      const submit = $("button[type=submit]", form);
      if (submit?.disabled) return;
      if (submit) submit.disabled = true;
      form.setAttribute("aria-busy", "true");
      try {
        await api("/api/servers", { method: "POST", body: JSON.stringify({ action: "report", serverId: form.dataset.serverId, category: data.get("category"), body: data.get("details") }) });
        form.reset(); toast("Report received. Staff can now review it.");
      } catch (error) { toast(error.message, "error"); }
      finally { if (submit) submit.disabled = false; form.removeAttribute("aria-busy"); }
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

  function touchPolish() {
    const coarse = matchMedia("(hover: none), (pointer: coarse)");
    const reduced = matchMedia("(prefers-reduced-motion: reduce)");
    const selector = ".button-primary-v3, .button-primary, .small-button-primary";
    document.addEventListener("pointerdown", (event) => {
      if (!coarse.matches || reduced.matches || event.pointerType === "mouse") return;
      const control = event.target.closest(selector);
      if (!control || control.matches(":disabled, [aria-disabled='true']")) return;
      control.classList.remove("touch-sweep-v3");
      requestAnimationFrame(() => requestAnimationFrame(() => control.classList.add("touch-sweep-v3")));
    }, { passive: true });
    document.addEventListener("animationend", (event) => {
      if (event.animationName === "touch-sweep-v3") event.target.classList.remove("touch-sweep-v3");
    });
  }

  async function init() {
    applyTheme(preferredTheme());
    touchPolish();
    footer();
    $$('[data-year-v3]').forEach((element) => { element.textContent = String(new Date().getFullYear()); });
    reveal.scan();
    await session();
    adverts();
    if (!document.body.hasAttribute("data-blog-page")) {
      blogIndex();
      blogPost();
    }
    const announcementStyles = document.createElement("link");
    announcementStyles.rel = "stylesheet";
    announcementStyles.href = "/site-announcements.css?v=1";
    document.head.append(announcementStyles);
    import("/site-announcements.js?v=1").catch(() => {});
    interactionForms();
    await serverDetail();
    appeal();
  }
  init();
})();
