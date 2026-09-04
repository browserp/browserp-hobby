(() => {
  "use strict";

  // Public pages share one menu; staff navigation has its own controller.
  if (document.body.hasAttribute("data-staff-page") || location.pathname.startsWith("/staffpanel")) return;
  const header = document.querySelector(".header-v3, [data-site-header]");
  const nav = header?.querySelector("nav");
  if (!nav || header.dataset.publicNavigation) return;
  header.dataset.publicNavigation = "true";
  header.className = "header-v3 public-header-v6";
  nav.className = "shell-v3 public-nav-v6";
  nav.setAttribute("aria-label", "Main navigation");

  const make = (tag, className, text) => {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text) element.textContent = text;
    return element;
  };
  const paths = {
    search: "m21 21-4.4-4.4M19 11a8 8 0 1 1-16 0 8 8 0 0 1 16 0",
    games: "M8 7h8a4 4 0 0 1 4 3l1 6a3 3 0 0 1-5 2l-2-2h-4l-2 2a3 3 0 0 1-5-2l1-6a4 4 0 0 1 4-3ZM7 10v4m-2-2h4m6-1h.01M18 13h.01",
    blog: "M5 3h10l4 4v14H5V3Zm9 0v5h5M8 12h8m-8 4h6",
    about: "M12 11v6m0-10h.01M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0",
    arrow: "M5 12h14m-5-5 5 5-5 5",
    close: "m6 6 12 12M6 18 18 6",
    menu: "M4 7h16M4 12h12M4 17h16"
  };
  function icon(name) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "1.7");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    svg.setAttribute("aria-hidden", "true");
    const path = document.createElementNS(svg.namespaceURI, "path");
    path.setAttribute("d", paths[name]);
    svg.append(path);
    return svg;
  }
  function link(label, href, className) {
    const anchor = make("a", className, label);
    anchor.href = href;
    const pathname = location.pathname.replace(/\/$/, "") || "/";
    if (pathname === href || (href !== "/" && pathname.startsWith(`${href}/`)) || (href === "/servers" && pathname.startsWith("/server/"))) anchor.setAttribute("aria-current", "page");
    return anchor;
  }
  function brand() {
    const anchor = link("", "/", "navigation-brand-v6");
    anchor.setAttribute("aria-label", "BrowseRP home");
    const image = make("img");
    image.src = "/assets/browserp-logo-v5.png";
    image.alt = "BrowseRP";
    image.width = 190;
    image.height = 54;
    anchor.append(image);
    return anchor;
  }
  function accountLink() {
    const anchor = link("Sign in", "/dashboard", "button-v3 button-secondary-v3");
    anchor.dataset.accountV3 = "";
    return anchor;
  }

  const items = [
    ["Discover", "/servers", "Find your next community", "search"],
    ["Games", "/games", "Explore every world", "games"],
    ["Blog", "/blog", "Stories, tips & guides", "blog"],
    ["About", "/about", "Get to know BrowseRP", "about"]
  ];
  const inlineLinks = make("div", "public-nav-links-v6");
  inlineLinks.append(...items.map(([label, href]) => link(label, href)));
  const inlineActions = make("div", "public-nav-actions-v6");
  inlineActions.append(accountLink(), link("List a server", "/list-server", "button-v3 button-primary-v3"));
  const toggle = make("button", "navigation-toggle-v6");
  toggle.type = "button";
  toggle.setAttribute("aria-label", "Open menu");
  toggle.setAttribute("aria-expanded", "false");
  toggle.setAttribute("aria-controls", "public-navigation");
  toggle.setAttribute("aria-haspopup", "dialog");
  toggle.append(icon("menu"), make("span", "", "Menu"));
  nav.replaceChildren(brand(), inlineLinks, inlineActions, toggle);

  const dialog = make("dialog", "navigation-dialog-v6");
  dialog.id = "public-navigation";
  dialog.setAttribute("aria-labelledby", "navigation-title-v6");
  const panel = make("div", "navigation-panel-v6");
  const top = make("div", "navigation-top-v6");
  const close = make("button", "navigation-close-v6");
  close.type = "button";
  close.setAttribute("aria-label", "Close menu");
  close.autofocus = true;
  close.append(icon("close"), make("span", "", "Close"));
  top.append(brand(), close);
  const scroll = make("div", "navigation-scroll-v6");
  const intro = make("div", "navigation-intro-v6 navigation-enter-v6");
  const title = make("h2", "", "Where to next?");
  title.id = "navigation-title-v6";
  intro.append(make("span", "navigation-eyebrow-v6", "Explore BrowseRP"), title);

  const search = make("form", "navigation-search-v6 navigation-enter-v6");
  search.action = "/servers";
  search.method = "get";
  search.setAttribute("role", "search");
  search.setAttribute("aria-label", "Find a community");
  const input = make("input");
  input.type = "search";
  input.name = "q";
  input.maxLength = 120;
  input.placeholder = "Search servers, games or play styles";
  input.setAttribute("aria-label", "Search servers, games or play styles");
  const submit = make("button");
  submit.type = "submit";
  submit.setAttribute("aria-label", "Search");
  submit.append(icon("search"));
  search.append(input, submit);

  const links = make("nav", "navigation-links-v6 navigation-enter-v6");
  links.setAttribute("aria-label", "Explore");
  items.forEach(([label, href, description, symbol]) => {
    const anchor = link("", href, "navigation-link-v6");
    const copy = make("span", "navigation-link-copy-v6");
    copy.append(make("strong", "", label), make("small", "", description));
    const mark = make("span", "navigation-link-icon-v6");
    mark.append(icon(symbol));
    anchor.append(mark, copy, icon("arrow"));
    links.append(anchor);
  });

  const games = make("section", "navigation-games-v6 navigation-enter-v6");
  games.setAttribute("aria-labelledby", "navigation-games-title-v6");
  const gamesHeading = make("div", "navigation-section-heading-v6");
  const gamesTitle = make("h3", "", "Jump into a game");
  gamesTitle.id = "navigation-games-title-v6";
  gamesHeading.append(gamesTitle, link("View all", "/games"));
  const gameLinks = make("div", "navigation-game-grid-v6");
  [["FiveM", "fivem", "#ffa45e"], ["RedM", "redm", "#ff7a82"], ["Minecraft", "minecraft", "#80d697"], ["Roblox", "roblox", "#b89aff"]].forEach(([label, id, colour]) => {
    const anchor = link(label, `/games/${id}`, "navigation-game-v6");
    anchor.style.setProperty("--game-colour", colour);
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 48 48");
    svg.setAttribute("aria-hidden", "true");
    const use = document.createElementNS(svg.namespaceURI, "use");
    use.setAttribute("href", `/assets/game-marks-v4.svg#mark-${id}`);
    svg.append(use);
    anchor.prepend(svg);
    gameLinks.append(anchor);
  });
  games.append(gamesHeading, gameLinks);

  const account = make("div", "navigation-account-v6 navigation-enter-v6");
  account.append(accountLink());
  const foot = make("div", "navigation-footer-v6 navigation-enter-v6");
  const cta = link("List a server", "/list-server", "button-v3 button-primary-v3");
  cta.append(icon("arrow"));
  const extra = make("nav", "navigation-extra-v6");
  extra.setAttribute("aria-label", "More from BrowseRP");
  extra.append(link("Advertise", "/advertise"), link("Help & contact", "/legal#contact"), link("Policies", "/legal"));
  foot.append(cta, extra);
  scroll.append(intro, search, links, games, account, foot);
  panel.append(top, scroll);
  dialog.append(panel);
  document.body.append(dialog);

  const compact = matchMedia("(max-width: 1080px)");
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
  let closeTimer;
  let openingFrame;
  let previousOverflow;
  function alignCloseButton() {
    // Read before scroll locking: removing a scrollbar can move the header.
    const box = toggle.getBoundingClientRect();
    if (!(box.width > 0 && box.height > 0)) return;
    for (const [property, value] of Object.entries({ left: box.left, top: box.top, width: box.width, height: box.height })) {
      close.style.setProperty(property, `${value}px`);
    }
    // Keep the anchored control inside the panel on wide, centred layouts.
    dialog.style.right = `${window.innerWidth <= 520 ? 0 : Math.max(12, window.innerWidth - box.left - box.width - 24)}px`;
  }
  function finishClose() {
    clearTimeout(closeTimer);
    cancelAnimationFrame(openingFrame);
    if (!dialog.open) return;
    dialog.close();
    document.body.style.overflow = previousOverflow;
    document.body.classList.remove("navigation-open-v6");
    toggle.setAttribute("aria-expanded", "false");
    toggle.focus({ preventScroll: true });
  }
  function closeMenu(immediate = false) {
    if (!dialog.open) return;
    document.dispatchEvent(new Event("navigation:close"));
    cancelAnimationFrame(openingFrame);
    dialog.dataset.open = "false";
    dialog.inert = true;
    toggle.setAttribute("aria-expanded", "false");
    clearTimeout(closeTimer);
    if (immediate || reducedMotion.matches) finishClose();
    else closeTimer = setTimeout(finishClose, 220);
  }
  function openMenu() {
    clearTimeout(closeTimer);
    dialog.inert = false;
    if (dialog.open) {
      dialog.dataset.open = "true";
      toggle.setAttribute("aria-expanded", "true");
      close.focus({ preventScroll: true });
      return;
    }
    alignCloseButton();
    previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.body.classList.add("navigation-open-v6");
    dialog.showModal();
    scroll.scrollTop = 0;
    toggle.setAttribute("aria-expanded", "true");
    close.focus({ preventScroll: true });
    openingFrame = requestAnimationFrame(() => { dialog.dataset.open = "true"; });
  }
  toggle.addEventListener("click", openMenu);
  close.addEventListener("click", () => closeMenu());
  dialog.addEventListener("cancel", (event) => { event.preventDefault(); closeMenu(); });
  dialog.addEventListener("keydown", (event) => {
    // Search inputs can consume native Escape to clear their text before the
    // dialog receives a cancel event. Keep the menu's dismissal consistent.
    if (event.key === "Escape" && !event.defaultPrevented) {
      event.preventDefault();
      closeMenu();
      return;
    }
    if (event.key !== "Tab" || dialog.inert) return;
    const controls = [...dialog.querySelectorAll('a[href],button,input,[tabindex="0"]')]
      .filter((element) => !element.disabled && element.tabIndex >= 0 && !element.closest("[inert],[hidden]") && element.getClientRects().length);
    if (!controls.length) return;
    // Some browser keyboard preferences skip links and buttons. Explicitly
    // advance within this modal so those preferences cannot strand focus.
    const index = controls.indexOf(document.activeElement);
    const next = index < 0 ? (event.shiftKey ? controls.length - 1 : 0) : (index + (event.shiftKey ? -1 : 1) + controls.length) % controls.length;
    event.preventDefault();
    controls[next].focus();
  });
  // A native modal contains keyboard focus and makes the background inert.
  let backdropPointer = false;
  dialog.addEventListener("pointerdown", (event) => { backdropPointer = event.target === dialog; });
  dialog.addEventListener("click", (event) => { if (event.target === dialog && backdropPointer) closeMenu(); });
  dialog.addEventListener("click", (event) => { if (event.target.closest("a")) closeMenu(true); });
  search.addEventListener("submit", () => closeMenu(true));
  dialog.addEventListener("close", () => {
    if (dialog.open) return;
    document.body.style.overflow = previousOverflow ?? "";
    document.body.classList.remove("navigation-open-v6");
    toggle.setAttribute("aria-expanded", "false");
  });
  compact.addEventListener("change", () => closeMenu(true));
  window.addEventListener("resize", () => { if (dialog.open) alignCloseButton(); });
})();
