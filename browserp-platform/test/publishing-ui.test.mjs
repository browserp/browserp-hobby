import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

class Element {
  constructor(tag = "div") { this.tagName = tag.toUpperCase(); this.children = []; this.attributes = {}; this.dataset = {}; this.listeners = {}; this.textContent = ""; this.value = ""; this.hidden = false; this.classList = { add() {}, contains() { return false; } }; }
  append(...items) { for (const item of items) { if (item.tagName === "FRAGMENT") this.append(...item.children); else this.children.push(item); } }
  replaceChildren(...items) { this.children = []; this.append(...items); }
  setAttribute(name, value) { this.attributes[name] = value; }
  addEventListener(name, listener) { this.listeners[name] = listener; }
  querySelectorAll(selector) { const tags = selector.split(",").map((tag) => tag.toUpperCase()); return this.children.flatMap((child) => [...(tags.includes(child.tagName) ? [child] : []), ...child.querySelectorAll(selector)]); }
  focus() {}
  reset() { this.querySelectorAll("input,textarea,select").forEach((control) => { control.value = ""; }); }
  reportValidity() { return true; }
}
const source = (name) => readFileSync(new URL(`../public/${name}`, import.meta.url), "utf8");
function contentRuntime() {
  const window = { addEventListener() {} };
  const document = { createElement: (tag) => new Element(tag), createDocumentFragment: () => new Element("fragment") };
  vm.runInNewContext(source("publishing-content.js"), { window, document });
  return { window, document, content: window.BrowseRPContent };
}

test("article preview and public renderer keep supplied HTML inert and preserve a single page h1", () => {
  const { content } = contentRuntime(); const root = new Element();
  content.renderArticle(root, "# First chapter\n\nParagraph <img src=x onerror=alert(1)> stays text.\n\n- Join a community\n- Read its rules\n\n### Next steps");
  assert.deepEqual(root.children.map((element) => element.tagName), ["H2", "P", "UL", "H3"]);
  assert.match(root.children[1].textContent, /<img src=x onerror=alert\(1\)>/);
  assert.equal(root.querySelectorAll("img,script,iframe,h1").length, 0);
  assert.deepEqual(root.children[2].children.map((element) => element.textContent), ["Join a community", "Read its rules"]);
});

test("blog upload only imports bounded plain text or Markdown without publishing or executing content", async () => {
  const { content } = contentRuntime();
  const file = (overrides = {}) => ({ name: "article.md", type: "text/markdown", size: 32, text: async () => "\uFEFF# Guide\r\n\r\nA new community.", ...overrides });
  assert.equal(await content.importArticle(file()), "# Guide\n\nA new community.");
  await assert.rejects(content.importArticle(file({ name: "article.html" })), /Markdown/);
  await assert.rejects(content.importArticle(file({ type: "text/html" })), /Markdown/);
  await assert.rejects(content.importArticle(file({ size: 65537 })), /64 KB/);
  await assert.rejects(content.importArticle(file({ text: async () => "a".repeat(20001) })), /20,000/);
  await assert.rejects(content.importArticle(file({ text: async () => "<script>alert(1)</script>" })), /without HTML/);
  await assert.rejects(content.importArticle(file({ text: async () => "unsafe\u0000content" })), /without HTML/);
  assert.equal(content.slugify("  A Beginner’s Guide: Café RP! "), "a-beginner-s-guide-cafe-rp");
});

test("publishing requests only the capabilities granted to the current staff member", async () => {
  for (const [permissions, expected] of [[{}, []], [{ manageBlogs: true }, ["/api/admin/blogs"]], [{ manageAnnouncements: true }, ["/api/admin/announcements"]]]) {
    const { window, document } = contentRuntime(); const root = new Element(); const requests = [];
    document.querySelector = (selector) => selector === "#overview-publishing" ? root : null;
    vm.runInNewContext(source("staff-publishing.js"), { window, document, Intl, Date });
    await window.BrowseRPStaffPublishing.init({ permissions, api: async (path) => { requests.push(path); return { posts: [], announcements: [] }; } });
    assert.deepEqual(requests, expected);
    await window.BrowseRPStaffPublishing.init({ permissions, api: async (path) => requests.push(path) });
    assert.deepEqual(requests, expected, "Repeated overview refresh must not duplicate editors or requests");
  }
});

test("public announcements hide scheduled and expired items, remain plain text and respect dismissal on refresh", async () => {
  const requests = []; let mounted; let interval;
  const now = Date.now();
  const announcements = [
    { id: "live", title: "Welcome <script>", body: "<img onerror=alert(1)>", level: "success", startsAt: new Date(now - 1000).toISOString(), publishedAt: "today" },
    { id: "future", title: "Later", startsAt: new Date(now + 3600000).toISOString() },
    { id: "expired", title: "Ended", endsAt: new Date(now - 1000).toISOString() }
  ];
  const document = { body: new Element("body"), createElement: (tag) => new Element(tag), querySelector: () => ({ after(element) { mounted = element; } }), addEventListener() {} };
  const window = { setInterval(callback) { interval = callback; } };
  const fetch = async (path) => { requests.push(path); return { ok: true, json: async () => ({ announcements }) }; };
  vm.runInNewContext(source("site-announcements.js"), { window, document, fetch, Date, Set });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(requests, ["/api/public/announcements"]);
  assert.equal(mounted.children.length, 1);
  assert.equal(mounted.children[0].children[0].children[0].textContent, "Welcome <script>");
  assert.equal(mounted.querySelectorAll("img,script").length, 0);
  mounted.children[0].children[1].listeners.click();
  assert.equal(mounted.hidden, true);
  await interval();
  assert.equal(mounted.hidden, true);
});

test("public blog distinguishes an empty publication list from an unavailable service", async () => {
  for (const available of [true, false]) {
    const nodes = new Map();
    const document = { body: { dataset: { blogPage: "index" } }, querySelector(selector) { if (!nodes.has(selector)) nodes.set(selector, new Element()); return nodes.get(selector); }, createElement: (tag) => new Element(tag) };
    const fetch = async () => ({ ok: available, status: available ? 200 : 503, json: async () => available ? { posts: [] } : { error: "Unavailable" } });
    vm.runInNewContext(source("blog.js"), { document, fetch, window: {}, Date, Intl });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(nodes.get("#journal-empty-v6").hidden, !available);
    assert.equal(nodes.get("#journal-retry-v6").hidden, available);
    assert.equal(nodes.get("#journal-posts-v6").attributes["aria-busy"], "false");
  }
});
