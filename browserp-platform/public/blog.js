(() => {
  "use strict";
  const page = document.body.dataset.blogPage;
  if (!page) return;
  const $ = (selector) => document.querySelector(selector);
  const make = (tag, text, className = "") => { const element = document.createElement(tag); if (text !== undefined) element.textContent = String(text); element.className = className; return element; };
  const readableDate = (value) => {
    const parsed = new Date(value);
    return value && !Number.isNaN(parsed.getTime()) ? new Intl.DateTimeFormat("en-GB", { dateStyle: "long" }).format(parsed) : "";
  };
  async function request(path) {
    const response = await fetch(path, { headers: { Accept: "application/json" }, credentials: "same-origin" });
    const payload = await response.json();
    if (!response.ok) throw Object.assign(new Error(payload.error || "Articles could not be loaded."), { status: response.status });
    return payload;
  }
  function postCard(post, featured) {
    const card = make("article", undefined, `journal-card-v6${featured ? " journal-card-featured-v6" : ""}`);
    const meta = make("div", undefined, "journal-card-meta-v6");
    meta.append(make("span", featured ? "Latest story" : "BrowseRP journal"));
    const time = make("time", readableDate(post.publishedAt)); if (post.publishedAt) time.dateTime = post.publishedAt; meta.append(time);
    const title = make("h3"); const link = make("a", post.title); link.href = `/blog/${encodeURIComponent(post.slug)}`; title.append(link);
    const more = make("a", "Read article", "journal-read-v6"); more.href = link.href; more.setAttribute("aria-label", `Read ${post.title}`); more.append(make("span", "↗"));
    card.append(meta, title, make("p", post.excerpt), more); return card;
  }
  async function loadIndex() {
    const root = $("#journal-posts-v6"); const status = $("#journal-status-v6");
    const retry = $("#journal-retry-v6"); const empty = $("#journal-empty-v6"); const more = $("#journal-more-v6");
    root.setAttribute("aria-busy", "true"); status.textContent = "Loading the latest articles…"; status.dataset.error = "false"; retry.hidden = true; empty.hidden = true;
    try {
      const { posts = [] } = await request("/api/public/blogs");
      let shown = 0;
      root.replaceChildren();
      const appendPage = () => {
        const next = posts.slice(shown, shown + 12);
        next.forEach((post, index) => root.append(postCard(post, shown === 0 && index === 0)));
        shown += next.length; more.hidden = shown >= posts.length;
        status.textContent = posts.length ? `${shown} of ${posts.length} articles shown.` : "";
      };
      appendPage(); more.onclick = appendPage;
      empty.hidden = posts.length !== 0;
      $("#journal-count-v6").textContent = posts.length ? `${posts.length} article${posts.length === 1 ? "" : "s"}` : "";
    } catch { status.textContent = "We couldn’t load the articles. Please try again."; status.dataset.error = "true"; retry.hidden = false; more.hidden = true; }
    finally { root.setAttribute("aria-busy", "false"); }
  }
  async function loadArticle() {
    const root = $("#journal-article-v6"); const status = $("#journal-status-v6"); const retry = $("#journal-retry-v6");
    const parts = location.pathname.split("/").filter(Boolean);
    root.setAttribute("aria-busy", "true"); retry.hidden = true; status.textContent = "Loading article…"; status.dataset.error = "false";
    try {
      const slug = parts.length > 1 ? decodeURIComponent(parts.at(-1)) : new URLSearchParams(location.search).get("slug");
      const { post } = await request(`/api/public/blogs?slug=${encodeURIComponent(slug || "")}`);
      if (!post) throw Object.assign(new Error("Article not found."), { status: 404 });
      $("#journal-title-v6").textContent = post.title;
      $("#journal-excerpt-v6").textContent = post.excerpt || "";
      $("#journal-date-v6").textContent = readableDate(post.publishedAt); $("#journal-date-v6").dateTime = post.publishedAt || "";
      $("#journal-reading-v6").textContent = `${Math.max(1, Math.ceil(String(post.body || "").trim().split(/\s+/).length / 220))} min read`;
      document.title = post.seoTitle || `${post.title} — BrowseRP`;
      const description = $('meta[name="description"]'); if (description) description.content = post.seoDescription || post.excerpt || "BrowseRP news and roleplay guides.";
      let canonical = $('link[rel="canonical"]'); if (!canonical) { canonical = make("link"); canonical.rel = "canonical"; document.head.append(canonical); }
      canonical.href = `https://www.browserp.com/blog/${encodeURIComponent(post.slug)}`;
      window.BrowseRPContent.renderArticle(root, post.body); status.textContent = "";
    } catch (error) {
      const unavailable = error.status === 404;
      document.title = unavailable ? "Story unavailable — BrowseRP" : "Blog unavailable — BrowseRP";
      $("#journal-title-v6").textContent = unavailable ? "This story is unavailable." : "We couldn’t load this story.";
      status.textContent = unavailable ? "The article may have been archived, or its address has changed. Explore the journal for the latest posts." : "Please try again in a moment.";
      retry.hidden = unavailable; status.dataset.error = "true";
    } finally { root.setAttribute("aria-busy", "false"); }
  }
  $("#journal-retry-v6")?.addEventListener("click", page === "index" ? loadIndex : loadArticle);
  if (page === "index") loadIndex(); else loadArticle();
})();
