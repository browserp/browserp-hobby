import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { JSDOM } from "jsdom";

const read = file => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const source = read("public/navigation.js");
const publicPages = ["index", "404", "servers", "game", "server", "list-server", "about", "blog", "blog-post", "advertise", "legal", "privacy", "terms", "appeal", "coins", "dashboard", "profile"];
const routes = { index: "/", 404: "/missing-page", game: "/games", server: "/server/community", "blog-post": "/blog/community-guide" };
const primaryRoutes = ["/servers", "/games", "/blog", "/about"];

function harness({ page = "index", pathname = routes[page] || `/${page}`, html = read(`public/${page}.html`), compact = false, reduced = false, overflow = "" } = {}) {
  const dom = new JSDOM(html, { url: `https://browserp.test${pathname}`, runScripts: "outside-only" });
  const w = dom.window;
  const timers = new Map();
  const frames = new Map();
  const queries = new Map();
  let serial = 0;
  let now = 0;
  let showCalls = 0;
  let closeCalls = 0;
  w.document.body.style.overflow = overflow;
  w.setTimeout = (callback, delay = 0) => { const id = ++serial; timers.set(id, { callback, at: now + delay }); return id; };
  w.clearTimeout = id => timers.delete(id);
  w.requestAnimationFrame = callback => { const id = ++serial; frames.set(id, callback); return id; };
  w.cancelAnimationFrame = id => frames.delete(id);
  w.matchMedia = query => {
    if (!queries.has(query)) {
      const target = new w.EventTarget();
      target.media = query;
      target.matches = query.includes("prefers-reduced-motion") ? reduced : compact;
      queries.set(query, target);
    }
    return queries.get(query);
  };
  // jsdom has no top layer. Stub dialog lifecycle and focus return here;
  // browser verification covers native focus containment and background inertness.
  w.HTMLDialogElement.prototype.showModal = function () {
    if (this.open) return;
    showCalls++;
    this.returnFocus = w.document.activeElement;
    this.setAttribute("open", "");
    this.querySelector("[autofocus]")?.focus();
  };
  w.HTMLDialogElement.prototype.close = function (value = "") {
    if (!this.open) return;
    closeCalls++;
    this.returnValue = value;
    this.removeAttribute("open");
    this.returnFocus?.focus();
    this.dispatchEvent(new w.Event("close"));
  };
  w.eval(source);
  const $ = selector => w.document.querySelector(selector);
  const frame = () => {
    const pending = [...frames];
    frames.clear();
    pending.forEach(([, callback]) => callback(now));
  };
  const tick = ms => {
    const end = now + ms;
    for (;;) {
      const pending = [...timers].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!pending) break;
      const [id, timer] = pending;
      now = timer.at;
      timers.delete(id);
      timer.callback();
    }
    now = end;
  };
  const media = (query, matches) => {
    const target = queries.get(query);
    assert.ok(target, `registered media query: ${query}`);
    target.matches = matches;
    target.dispatchEvent(new w.Event("change"));
  };
  const pointer = (target, type) => target.dispatchEvent(new w.MouseEvent(type, { bubbles: true, cancelable: true }));
  return { dom, w, $, frame, tick, media, pointer, timers, frames, get showCalls() { return showCalls; }, get closeCalls() { return closeCalls; } };
}

function open(h) {
  const toggle = h.$(".navigation-toggle-v6");
  toggle.focus();
  toggle.click();
  h.frame();
  return h.$("#public-navigation");
}

function assertClosed(h, overflow = "") {
  assert.equal(h.$("#public-navigation").open, false);
  assert.equal(h.$(".navigation-toggle-v6").getAttribute("aria-expanded"), "false");
  assert.equal(h.w.document.body.style.overflow, overflow);
  assert.equal(h.w.document.body.classList.contains("navigation-open-v6"), false);
}

function sessionHydration(h, { session = {}, response } = {}) {
  const app = read("public/browserp-v3.js");
  const helpersEnd = app.indexOf("  const reveal =");
  const start = app.indexOf("  async function session()");
  const end = app.indexOf("  function safeDestination(", start);
  assert.ok(helpersEnd > 0 && start > helpersEnd && end > start, "the actual session controller can be isolated from unrelated page features");
  h.w.fetch = response || (async () => ({ ok: true, json: async () => session }));
  // Execute the production request/helper/session functions, excluding unrelated
  // advertising, content, and server-detail initializers.
  h.w.eval(`${app.slice(0, helpersEnd)}${app.slice(start, end)}\nwindow.__navigationTestSession = session;\n})();`);
  return h.w.__navigationTestSession();
}

const member = {
  authenticated: true,
  staffAccess: false,
  user: { profile: { display_name: "Alex Rivers", avatar_review_status: "approved", avatar_url: "https://cdn.discordapp.com/avatar.png" } }
};

test("ending a member session removes private header identity and returns account focus to sign in", async () => {
  const h = harness();
  try {
    await sessionHydration(h, { session: member });
    const button = h.$(".account-trigger-v3"); button.focus(); button.click(); h.frame();
    h.w.dispatchEvent(new h.w.CustomEvent("browserp:session-ended", { detail: { reason: "connection-removed" } }));
    assert.equal(h.$(".account-menu-v3"), null);
    assert.equal(h.w.document.body.textContent.includes("Alex Rivers"), false);
    assert.equal(h.w.document.activeElement.textContent, "Sign in");
    assert.equal(h.w.document.activeElement.getAttribute("href"), "/dashboard");
  } finally { h.dom.window.close(); }
});

test("a delayed earlier session response cannot restore header identity after disconnection", async () => {
  const h = harness();
  try {
    let resolve;
    const pending = sessionHydration(h, { response: () => new Promise(done => { resolve = done; }) });
    h.w.dispatchEvent(new h.w.CustomEvent("browserp:session-ended"));
    resolve({ ok: true, json: async () => member }); await pending;
    assert.equal(h.$(".account-menu-v3"), null);
    assert.equal(h.w.document.body.textContent.includes("Alex Rivers"), false);
    assert.equal(h.$("[data-account-v3]").textContent, "Sign in");
  } finally { h.dom.window.close(); }
});

test("all public pages expose the same complete header and dialog navigation", async t => {
  for (const page of publicPages) await t.test(page, () => {
    const h = harness({ page });
    try {
      assert.equal(h.w.document.querySelectorAll(".public-header-v6").length, 1);
      assert.equal(h.w.document.querySelectorAll("#public-navigation").length, 1);
      assert.deepEqual([...h.$(".public-nav-links-v6").children].map(item => item.getAttribute("href")), primaryRoutes);
      assert.deepEqual([...h.$(".navigation-links-v6").children].map(item => item.getAttribute("href")), primaryRoutes);
      assert.deepEqual([...h.$(".navigation-game-grid-v6").children].map(item => item.getAttribute("href")).sort(), ["/games/fivem", "/games/minecraft", "/games/redm", "/games/roblox"]);
      assert.equal(h.w.document.querySelectorAll("[data-account-v3]").length, 2, "both account slots are available to session hydration");
      assert.equal(h.$(".public-nav-actions-v6 a[href='/list-server']").textContent, "List a server");
      assert.ok(h.$(".navigation-footer-v6 a[href='/list-server']"));
      assert.equal(h.$(".navigation-extra-v6 a[href='/legal#contact']").textContent, "Help & contact");
      assert.equal(h.$(".navigation-brand-v6").getAttribute("href"), "/");
      assert.equal(h.$("[data-menu-v3], [data-menu-button], [data-site-menu]"), null, "old menu controls no longer own the header");
      assertClosed(h);
    } finally { h.dom.window.close(); }
  });
});

test("public HTML loads shared navigation before account hydration", () => {
  for (const page of publicPages) {
    const html = read(`public/${page}.html`);
    const scripts = [...html.matchAll(/<script[^>]*\bsrc="([^"]+)"/g)].map(match => match[1].split("?")[0]);
    assert.ok(scripts.includes("/navigation.js"), `${page} loads navigation`);
    assert.ok(scripts.indexOf("/navigation.js") < scripts.indexOf("/browserp-v3.js"), `${page} creates account slots before hydration`);
  }
});

test("opening and closing preserves scroll state and returns focus to the menu trigger", () => {
  const h = harness({ overflow: "clip" });
  try {
    const dialog = open(h);
    const toggle = h.$(".navigation-toggle-v6");
    assert.equal(dialog.open, true);
    assert.equal(dialog.dataset.open, "true");
    assert.equal(toggle.getAttribute("aria-expanded"), "true");
    assert.equal(toggle.getAttribute("aria-haspopup"), "dialog");
    assert.equal(toggle.getAttribute("aria-controls"), dialog.id);
    assert.equal(h.$(`#${dialog.getAttribute("aria-labelledby")}`).textContent, "Where to next?");
    assert.equal(h.w.document.activeElement, h.$(".navigation-close-v6"));
    assert.equal(h.w.document.body.style.overflow, "hidden");
    h.$(".navigation-close-v6").click();
    assert.equal(dialog.dataset.open, "false");
    h.tick(219);
    assert.equal(dialog.open, true, "the dialog remains modal during its closing transition");
    h.tick(1);
    assertClosed(h, "clip");
    assert.equal(h.w.document.activeElement, toggle);
    assert.equal(h.showCalls, 1);
    assert.equal(h.closeCalls, 1);
  } finally { h.dom.window.close(); }
});

test("the close control keeps the opener's exact box before scroll locking moves the header", () => {
  const h = harness({ overflow: "auto" });
  try {
    const toggle = h.$(".navigation-toggle-v6");
    toggle.getBoundingClientRect = () => ({ left: h.w.document.body.style.overflow === "hidden" ? 1224 : 1216, top: 18, width: 94.625, height: 44 });
    open(h);
    const close = h.$(".navigation-close-v6");
    assert.equal(close.style.left, "1216px", "the original position is captured before the scrollbar disappears");
    assert.equal(close.style.top, "18px");
    assert.equal(close.style.width, "94.625px");
    assert.equal(close.style.height, "44px");
    assert.equal(close.textContent, "Close");
    assert.equal(h.w.document.activeElement, close);
    close.click();
    h.tick(220);
    assertClosed(h, "auto");
    assert.equal(h.w.document.activeElement, toggle);
  } finally { h.dom.window.close(); }
});

test("an open menu follows viewport changes without losing its modal state or focus", () => {
  const h = harness();
  try {
    let box = { left: 274.375, top: 12, width: 94.625, height: 44 };
    h.$(".navigation-toggle-v6").getBoundingClientRect = () => box;
    const dialog = open(h);
    const input = h.$(".navigation-search-v6 input");
    input.focus();
    input.value = "RedM community";
    box = { left: 304.375, top: 14, width: 94.625, height: 44 };
    h.w.dispatchEvent(new h.w.Event("resize"));
    const close = h.$(".navigation-close-v6");
    assert.equal(close.style.left, "304.375px");
    assert.equal(close.style.top, "14px");
    assert.equal(dialog.open, true);
    assert.equal(input.value, "RedM community");
    assert.equal(h.w.document.activeElement, input);
    dialog.dispatchEvent(new h.w.Event("cancel", { cancelable: true }));
    h.tick(220);
    box = { left: 0, top: 0, width: 0, height: 0 };
    h.w.dispatchEvent(new h.w.Event("resize"));
    assert.equal(close.style.left, "304.375px", "a closed menu does not read or update layout");
    assertClosed(h);
  } finally { h.dom.window.close(); }
});

test("the anchored menu stays around its control on wide centred headers and fills a phone screen", () => {
  const h = harness();
  try {
    h.w.innerWidth = 2560;
    let box = { left: 1785.375, top: 18, width: 94.625, height: 44 };
    h.$(".navigation-toggle-v6").getBoundingClientRect = () => box;
    const dialog = open(h);
    assert.equal(dialog.style.right, "656px");
    h.w.innerWidth = 390;
    box = { left: 274.375, top: 12, width: 94.625, height: 44 };
    h.w.dispatchEvent(new h.w.Event("resize"));
    assert.equal(dialog.style.right, "0px");
    assert.equal(h.$(".navigation-close-v6").style.left, "274.375px");
  } finally { h.dom.window.close(); }
});

test("native Escape cancellation follows the animated close path", () => {
  const h = harness();
  try {
    const dialog = open(h);
    const event = new h.w.Event("cancel", { cancelable: true });
    dialog.dispatchEvent(event);
    assert.equal(event.defaultPrevented, true);
    assert.equal(dialog.dataset.open, "false");
    h.tick(220);
    assertClosed(h);
    assert.equal(h.w.document.activeElement, h.$(".navigation-toggle-v6"));
  } finally { h.dom.window.close(); }
});

test("Escape dismisses the menu from a filled search input without silently clearing the query", () => {
  const h = harness();
  try {
    const dialog = open(h);
    const input = h.$(".navigation-search-v6 input");
    input.value = "RedM roleplay";
    input.focus();
    const event = new h.w.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    input.dispatchEvent(event);
    assert.equal(event.defaultPrevented, true);
    assert.equal(dialog.dataset.open, "false");
    assert.equal(input.value, "RedM roleplay");
    h.tick(220);
    assertClosed(h);
    assert.equal(h.w.document.activeElement, h.$(".navigation-toggle-v6"));
  } finally { h.dom.window.close(); }
});

test("modal Tab traversal reaches buttons and links even when native keyboard preferences skip them", () => {
  const h = harness();
  try {
    const dialog = open(h);
    for (const element of dialog.querySelectorAll("a,button,input")) element.getClientRects = () => [{}];
    const search = h.$(".navigation-search-v6 input");
    const submit = h.$(".navigation-search-v6 button");
    function tab(shiftKey = false) {
      const event = new h.w.KeyboardEvent("keydown", { key: "Tab", shiftKey, bubbles: true, cancelable: true });
      h.w.document.activeElement.dispatchEvent(event);
      assert.equal(event.defaultPrevented, true, "the modal controls the complete traversal instead of relying on native skipping");
    }
    search.focus();
    tab();
    assert.equal(h.w.document.activeElement, submit);
    tab();
    assert.equal(h.w.document.activeElement, h.$(".navigation-links-v6 a[href='/servers']"));
    tab(true);
    assert.equal(h.w.document.activeElement, submit);
    const hidden = h.w.document.createElement("a");
    hidden.href = "/hidden";
    hidden.hidden = true;
    hidden.getClientRects = () => [{}];
    const excluded = hidden.cloneNode();
    excluded.hidden = false;
    excluded.tabIndex = -1;
    excluded.getClientRects = () => [{}];
    dialog.append(hidden, excluded);
    h.$(".navigation-extra-v6 a[href='/legal']").focus();
    tab();
    assert.equal(h.w.document.activeElement, h.$(".navigation-top-v6 .navigation-brand-v6"));
    tab(true);
    assert.equal(h.w.document.activeElement, h.$(".navigation-extra-v6 a[href='/legal']"));
  } finally { h.dom.window.close(); }
});

test("backdrop dismissal requires a pointer gesture that begins on the backdrop", () => {
  const h = harness();
  try {
    const dialog = open(h);
    const panel = h.$(".navigation-panel-v6");
    h.pointer(dialog, "click");
    h.tick(220);
    assert.equal(dialog.open, true, "an unpaired backdrop click does not dismiss the dialog");
    h.pointer(panel, "pointerdown");
    h.pointer(dialog, "click");
    h.tick(220);
    assert.equal(dialog.open, true, "dragging from inside the panel does not dismiss it");
    h.pointer(dialog, "pointerdown");
    h.pointer(panel, "click");
    h.tick(220);
    assert.equal(dialog.open, true, "a click inside the panel stays open");
    h.pointer(dialog, "pointerdown");
    h.pointer(dialog, "click");
    h.tick(220);
    assertClosed(h);
  } finally { h.dom.window.close(); }
});

test("following a menu link closes immediately while preserving native link navigation", () => {
  const h = harness();
  try {
    open(h);
    const link = h.$(".navigation-links-v6 a[href='/games']");
    const event = new h.w.MouseEvent("click", { bubbles: true, cancelable: true });
    // Stop jsdom navigation after the production listener has handled the event.
    let productionPrevented;
    h.w.document.addEventListener("click", current => { productionPrevented = current.defaultPrevented; current.preventDefault(); }, { once: true });
    link.querySelector("strong").dispatchEvent(event);
    assert.equal(productionPrevented, false);
    assertClosed(h);
    assert.equal(h.closeCalls, 1);
  } finally { h.dom.window.close(); }
});

test("menu search retains GET semantics and the full query while closing immediately", () => {
  const h = harness();
  try {
    open(h);
    const form = h.$(".navigation-search-v6");
    const input = form.querySelector("input");
    input.value = "San Andreas & community";
    assert.equal(form.method, "get");
    assert.equal(new URL(form.action).pathname, "/servers");
    assert.equal(form.getAttribute("role"), "search");
    assert.ok(input.getAttribute("aria-label"));
    assert.equal(new h.w.FormData(form).get("q"), input.value);
    const event = new h.w.Event("submit", { bubbles: true, cancelable: true });
    form.dispatchEvent(event);
    assert.equal(event.defaultPrevented, false);
    assertClosed(h);
  } finally { h.dom.window.close(); }
});

test("reduced motion closes immediately and cancels a queued opening animation", () => {
  const h = harness({ reduced: true });
  try {
    h.$(".navigation-toggle-v6").click();
    h.$(".navigation-close-v6").click();
    assertClosed(h);
    h.frame();
    h.tick(1000);
    assertClosed(h);
    assert.notEqual(h.$("#public-navigation").dataset.open, "true");
  } finally { h.dom.window.close(); }
});

test("rapid close then reopen cancels stale timers and restores the visible modal", () => {
  const h = harness();
  try {
    const dialog = open(h);
    h.$(".navigation-close-v6").click();
    h.tick(100);
    h.$(".navigation-toggle-v6").click();
    h.frame();
    assert.equal(dialog.open, true);
    assert.equal(dialog.dataset.open, "true");
    assert.equal(h.$(".navigation-toggle-v6").getAttribute("aria-expanded"), "true");
    h.tick(1000);
    assert.equal(dialog.open, true, "the previous close timer cannot close a reopened menu");
    h.$(".navigation-close-v6").click();
    h.tick(220);
    assertClosed(h);
  } finally { h.dom.window.close(); }
});

test("closing before the opening frame cannot leave a stale visible state", () => {
  const h = harness();
  try {
    h.$(".navigation-toggle-v6").click();
    h.$(".navigation-close-v6").click();
    h.frame();
    h.tick(220);
    assertClosed(h);
    assert.notEqual(h.$("#public-navigation").dataset.open, "true");
    open(h);
    assert.equal(h.$("#public-navigation").dataset.open, "true");
  } finally { h.dom.window.close(); }
});

test("breakpoint changes close open menus immediately in both directions", () => {
  const h = harness({ overflow: "auto" });
  try {
    open(h);
    h.media("(max-width: 1080px)", true);
    assertClosed(h, "auto");
    open(h);
    h.media("(max-width: 1080px)", false);
    assertClosed(h, "auto");
    h.frame();
    h.tick(1000);
    assertClosed(h, "auto");
  } finally { h.dom.window.close(); }
});

test("an external native close restores overflow and trigger state", () => {
  const h = harness({ overflow: "clip" });
  try {
    const dialog = open(h);
    dialog.close();
    assertClosed(h, "clip");
    assert.equal(h.w.document.activeElement, h.$(".navigation-toggle-v6"));
  } finally { h.dom.window.close(); }
});

test("header and sidebar share active states for nested game and blog routes", () => {
  for (const [pathname, expected] of [["/games/fivem", "/games"], ["/games/fivem/", "/games"], ["/blog/community-guide", "/blog"], ["/blog/community-guide/", "/blog"], ["/servers", "/servers"], ["/blogging", null], ["/", null]]) {
    const h = harness({ pathname });
    try {
      for (const selector of [".public-nav-links-v6", ".navigation-links-v6"]) {
        const active = h.$(selector).querySelectorAll('[aria-current="page"]');
        assert.equal(active.length, expected ? 1 : 0, `${pathname} in ${selector}`);
        if (expected) assert.equal(active[0].getAttribute("href"), expected);
      }
      if (pathname.startsWith("/games/fivem")) assert.equal(h.$(".navigation-game-grid-v6 a[href='/games/fivem']").getAttribute("aria-current"), "page");
    } finally { h.dom.window.close(); }
  }
});

test("initializing twice does not duplicate markup or menu listeners", () => {
  const h = harness();
  try {
    h.w.eval(source);
    assert.equal(h.w.document.querySelectorAll("#public-navigation").length, 1);
    open(h);
    assert.equal(h.showCalls, 1);
    h.$(".navigation-close-v6").click();
    h.tick(220);
    assert.equal(h.closeCalls, 1);
  } finally { h.dom.window.close(); }
});

test("staff pages and staff routes never receive the public navigation controller", () => {
  const staffPages = readdirSync(new URL("../public", import.meta.url)).filter(name => name.startsWith("staff") && name.endsWith(".html"));
  for (const filename of staffPages) {
    const html = read(`public/${filename}`);
    const h = harness({ html, pathname: `/${filename.replace(/\.html$/, "")}` });
    try {
      assert.equal(h.$("#public-navigation, .public-header-v6"), null, filename);
      assert.doesNotMatch(html, /<script[^>]+src="\/navigation\.js/, filename);
    } finally { h.dom.window.close(); }
  }
  for (const options of [
    { html: '<body data-staff-page="overview"><header class="header-v3"><nav>Staff navigation</nav></header></body>', pathname: "/" },
    { html: '<body><header class="header-v3"><nav>Staff navigation</nav></header></body>', pathname: "/staffpanel/overview" }
  ]) {
    const h = harness(options);
    try {
      assert.equal(h.$("#public-navigation, .public-header-v6"), null);
      assert.equal(h.$("header nav").textContent, "Staff navigation");
    } finally { h.dom.window.close(); }
  }
});

test("signed-out and failed sessions preserve both functional sign-in links", async () => {
  for (const failed of [false, true]) {
    const h = harness();
    try {
      await sessionHydration(h, failed ? { response: async () => { throw new Error("Session unavailable"); } } : { session: { authenticated: false } });
      const links = [...h.w.document.querySelectorAll("[data-account-v3]")];
      assert.equal(links.length, 2);
      assert.ok(links.every(link => link.textContent === "Sign in" && link.getAttribute("href") === "/dashboard"));
      assert.equal(h.$(".account-trigger-v3"), null);
      assert.equal(open(h).open, true);
    } finally { h.dom.window.close(); }
  }
});

test("slow authenticated hydration keeps the open menu usable and creates unique account controls", async () => {
  const h = harness();
  try {
    let resolve;
    const hydration = sessionHydration(h, { response: () => new Promise(done => { resolve = done; }) });
    const dialog = open(h);
    assert.equal(h.w.document.querySelectorAll("[data-account-v3]").length, 2);
    resolve({ ok: true, json: async () => member });
    await hydration;
    assert.equal(dialog.open, true);
    assert.equal(h.w.document.activeElement, h.$(".navigation-close-v6"));
    const buttons = [...h.w.document.querySelectorAll(".account-trigger-v3")];
    assert.equal(buttons.length, 2);
    const ids = buttons.map(button => button.getAttribute("aria-controls"));
    assert.equal(new Set(ids).size, 2);
    for (const [index, button] of buttons.entries()) {
      assert.equal(button.getAttribute("aria-expanded"), "false");
      assert.equal(button.getAttribute("aria-label"), "Open account menu for Alex Rivers");
      const menu = h.w.document.getElementById(ids[index]);
      assert.equal(menu.tagName, "NAV");
      assert.equal(menu.hidden, true);
      assert.equal(menu.inert, true);
      assert.equal(menu.getAttribute("aria-label"), "Your account");
      assert.equal(menu.querySelector('[role="menuitem"]'), null, "ordinary navigation retains ordinary link keyboard semantics");
      assert.equal(menu.querySelector('a[href="/profile"]').textContent, "Profile");
      assert.equal(menu.querySelector(".account-danger-v3").textContent, "Sign out");
    }
  } finally { h.dom.window.close(); }
});

test("broken approved avatars fall back to readable initials in both account controls", async () => {
  const h = harness();
  try {
    await sessionHydration(h, { session: member });
    const avatars = [...h.w.document.querySelectorAll(".account-avatar-v3")];
    assert.equal(avatars.length, 2);
    avatars.forEach(avatar => avatar.dispatchEvent(new h.w.Event("error")));
    assert.equal(h.w.document.querySelectorAll(".account-avatar-v3").length, 0);
    assert.deepEqual([...h.w.document.querySelectorAll(".account-initials-v3")].map(item => item.textContent), ["AR", "AR"]);
    assert.ok([...h.w.document.querySelectorAll(".account-name-v3")].every(item => item.textContent === "Alex Rivers"));
  } finally { h.dom.window.close(); }
});

test("Staff Panel links depend on the explicit authenticated staff access flag", async () => {
  for (const staffAccess of [false, true, "true"]) {
    const h = harness();
    try {
      await sessionHydration(h, { session: { ...member, staffAccess } });
      const links = [...h.w.document.querySelectorAll('.account-popover-v3 a[href="/staffpanel"]')];
      assert.equal(links.length, staffAccess === true ? 2 : 0);
      assert.ok(links.every(link => link.textContent === "Staff Panel"));
    } finally { h.dom.window.close(); }
  }
});

test("Escape closes the inner account disclosure without cancelling the outer navigation dialog", async () => {
  const h = harness();
  try {
    await sessionHydration(h, { session: member });
    const dialog = open(h);
    const trigger = h.$(".navigation-account-v6 .account-trigger-v3");
    const menu = h.w.document.getElementById(trigger.getAttribute("aria-controls"));
    trigger.focus();
    trigger.click();
    h.frame();
    assert.equal(menu.hidden, false);
    assert.equal(menu.inert, false);
    const profile = menu.querySelector("a");
    profile.focus();
    let escapedOuter = false;
    dialog.addEventListener("keydown", event => { if (event.key === "Escape") escapedOuter = true; });
    const event = new h.w.KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    profile.dispatchEvent(event);
    assert.equal(event.defaultPrevented, true);
    assert.equal(escapedOuter, false);
    assert.equal(menu.inert, true);
    assert.equal(trigger.getAttribute("aria-expanded"), "false");
    assert.equal(h.w.document.activeElement, trigger);
    h.tick(190);
    assert.equal(menu.hidden, true);
    assert.equal(dialog.open, true);
    assert.equal(dialog.dataset.open, "true");
  } finally { h.dom.window.close(); }
});

test("closing the outer dialog cancels queued account opening frames", async () => {
  const h = harness();
  try {
    await sessionHydration(h, { session: member });
    open(h);
    const trigger = h.$(".navigation-account-v6 .account-trigger-v3");
    const menu = h.w.document.getElementById(trigger.getAttribute("aria-controls"));
    trigger.click();
    h.$(".navigation-close-v6").click();
    h.frame();
    assert.equal(trigger.getAttribute("aria-expanded"), "false");
    assert.equal(menu.inert, true);
    assert.equal(menu.dataset.open, "false");
    h.tick(220);
    assert.equal(menu.hidden, true);
    assertClosed(h);
  } finally { h.dom.window.close(); }
});

test("account disclosure closes when keyboard focus leaves its navigation", async () => {
  const h = harness();
  try {
    await sessionHydration(h, { session: member });
    open(h);
    const trigger = h.$(".navigation-account-v6 .account-trigger-v3");
    const menu = h.w.document.getElementById(trigger.getAttribute("aria-controls"));
    trigger.focus();
    trigger.click();
    h.frame();
    menu.querySelector("a").focus();
    assert.equal(menu.inert, false, "moving within the disclosure leaves it open");
    h.$(".navigation-footer-v6 a").focus();
    assert.equal(menu.inert, true);
    h.tick(190);
    assert.equal(menu.hidden, true);
    assert.equal(h.$("#public-navigation").open, true);
  } finally { h.dom.window.close(); }
});
