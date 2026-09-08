(() => {
  "use strict";

  const make = (tag, className, text) => {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = String(text);
    return element;
  };

  function safeAvatar(value) {
    if (typeof value !== "string" || value.length > 1000 || !/^https:\/\//i.test(value) || /[\s\\\u0000-\u001f\u007f]/.test(value)) return "";
    try {
      const url = new URL(value);
      return url.protocol === "https:" && !url.username && !url.password ? url.href : "";
    } catch { return ""; }
  }

  function initials(value) {
    return String(value || "BrowseRP member").trim().split(/\s+/).slice(0, 2).map(part => part[0]).join("").toUpperCase();
  }

  function fallbackAvatar(name) {
    const fallback = make("span", "comment-initials-v3", initials(name));
    fallback.setAttribute("aria-hidden", "true");
    return fallback;
  }

  function avatar(value, name) {
    const source = safeAvatar(value);
    if (!source) return fallbackAvatar(name);
    const image = make("img", "comment-avatar-v3");
    image.alt = "";
    image.referrerPolicy = "no-referrer";
    image.decoding = "async";
    image.addEventListener("error", () => image.replaceWith(fallbackAvatar(name)), { once: true });
    image.src = source;
    return image;
  }

  function timestamp(value) {
    if (typeof value !== "string" || !value.trim()) return null;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    const time = make("time", "", new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(date));
    time.dateTime = date.toISOString();
    return time;
  }

  function badgeList(badges) {
    const allowed = new Set(["staff", "server_owner"]);
    const values = Array.isArray(badges) ? badges.filter(badge => allowed.has(badge?.kind) && typeof badge.label === "string" && badge.label.trim()).slice(0, 2) : [];
    if (!values.length) return null;
    const root = make("span", "comment-badges-v3");
    values.forEach(badge => {
      const item = make("span", "comment-badge-v3", badge.label.trim());
      item.dataset.kind = badge.kind;
      root.append(item);
    });
    return root;
  }

  function parentQuote(parent) {
    if (!parent) return null;
    const quote = make("blockquote", "comment-parent-v3");
    if (parent.unavailable === true) {
      quote.append(make("span", "comment-parent-unavailable-v3", "Earlier comment unavailable"));
      return quote;
    }
    const author = String(parent.author || "BrowseRP member").trim() || "BrowseRP member";
    const heading = make("div", "comment-parent-heading-v3");
    heading.append(make("strong", "", author));
    const time = timestamp(parent.createdAt);
    if (time) heading.append(time);
    quote.append(heading, make("p", "", parent.body || ""));
    return quote;
  }

  function validCommentId(value) {
    return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
  }

  function render(comment = {}) {
    const name = String(comment.author || "BrowseRP member").trim() || "BrowseRP member";
    const item = make("article", "comment-v3");
    const heading = make("header", "comment-heading-v3");
    const identity = make("div", "comment-identity-v3");
    const authorLine = make("div", "comment-author-line-v3");
    authorLine.append(make("strong", "", name));
    const badges = badgeList(comment.badges);
    if (badges) authorLine.append(badges);
    identity.append(authorLine);
    const time = timestamp(comment.createdAt);
    if (time) {
      const dates = make("div", "comment-dates-v3");
      dates.append(time);
      const edited = timestamp(comment.editedAt);
      if (edited) {
        const label = make("span", "comment-edited-v3", "Edited ");
        edited.setAttribute("aria-label", `Edited ${edited.textContent}`);
        label.append(edited);
        dates.append(document.createTextNode(" · "), label);
      }
      identity.append(dates);
    }
    heading.append(avatar(comment.avatarUrl, name), identity);
    item.append(heading);
    const parent = parentQuote(comment.parent);
    if (parent) item.append(parent);
    item.append(make("p", "comment-body-v3", comment.body || ""));
    if (validCommentId(comment.id)) {
      const actions = make("div", "comment-actions-v3");
      const reply = make("button", "comment-reply-v3", "Reply");
      reply.type = "button";
      reply.dataset.commentReplyV3 = comment.id;
      reply.dataset.commentAuthorV3 = name;
      reply.setAttribute("aria-label", `Reply to ${name}`);
      actions.append(reply);
      item.append(actions);
    }
    return item;
  }

  window.BrowseRPPublicComments = Object.freeze({ render });
})();
