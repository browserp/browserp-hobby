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

  const BADGE_LIMIT = 4;
  const BADGES = Object.freeze({
    browserp_staff: Object.freeze({ label: "BrowseRP Staff", description: "An active member of the BrowseRP staff team.", priority: 10 }),
    verified_owner: Object.freeze({ label: "Verified Server Owner", description: "BrowseRP confirmed control of a published server listing. This is not a safety or quality guarantee.", priority: 20 }),
    discord_verified_email: Object.freeze({ label: "Verified Member", description: "Discord confirmed the connected account email is verified. This is not an identity check.", priority: 30 }),
    first_100: Object.freeze({ label: "First 100", description: "One of the first 100 BrowseRP members.", priority: 40 }),
    first_500: Object.freeze({ label: "First 500", description: "One of the first 500 BrowseRP members.", priority: 40 }),
    community_helper: Object.freeze({ label: "Community Helper", description: "Recognises constructive community participation.", priority: 50 }),
    new_joiner: Object.freeze({ label: "New Joiner", description: "Displayed for the first five days after joining.", priority: 60 })
  });

  function canonicalBadges(badges) {
    const values = new Map();
    for (const badge of (Array.isArray(badges) ? badges.slice(0, 24) : [])) {
      if (!badge || typeof badge !== "object" || typeof badge.kind !== "string" || !Object.hasOwn(BADGES, badge.kind) || values.has(badge.kind)) continue;
      values.set(badge.kind, BADGES[badge.kind]);
    }
    if (values.has("first_100")) values.delete("first_500");
    return [...values].sort(([kindA, badgeA], [kindB, badgeB]) => badgeA.priority - badgeB.priority || kindA.localeCompare(kindB));
  }

  function staffRank(value) {
    if (typeof value !== "string") return "";
    const label = value.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
    return label && label.length <= 48 ? label : "";
  }

  function badgeItem(kind, definition) {
    const item = make("span", "comment-badge-v3", definition.label);
    item.dataset.kind = kind;
    item.dataset.badgeLabel = definition.label;
    item.title = definition.description;
    item.setAttribute("aria-label", kind === "browserp_staff" ? definition.label : `${definition.label}. ${definition.description}`);
    if (kind === "browserp_staff") {
      const mark = make("img", "comment-staff-mark-v7");
      mark.src = "/browserp-mark-v3.png"; mark.alt = ""; mark.width = 18; mark.height = 18; mark.setAttribute("aria-hidden", "true");
      item.prepend(mark);
    }
    return item;
  }

  function badgeList(badges, roleValue) {
    const values = canonicalBadges(badges);
    if (!values.length) return null;
    const root = make("span", "comment-badges-v3");
    const tokens = [];
    for (const [kind, badge] of values) {
      tokens.push(badgeItem(kind, badge));
      if (kind === "browserp_staff") {
        const role = staffRank(roleValue);
        if (role) {
          const rank = make("span", "comment-staff-rank-v7", role);
          rank.dataset.kind = "staff_rank"; rank.dataset.badgeLabel = role;
          rank.title = `BrowseRP staff rank: ${role}`;
          rank.setAttribute("aria-label", `BrowseRP staff rank: ${role}`);
          tokens.push(rank);
        }
      }
    }
    root.append(...tokens.slice(0, BADGE_LIMIT));
    const hidden = tokens.slice(BADGE_LIMIT);
    if (hidden.length) {
      const labels = hidden.map(item => item.dataset.badgeLabel);
      const overflow = make("span", "comment-badge-v3 comment-badge-overflow-v7", `+${hidden.length}`);
      overflow.dataset.kind = "overflow"; overflow.tabIndex = 0;
      overflow.title = labels.join(", ");
      overflow.setAttribute("aria-label", `${hidden.length} more badge${hidden.length === 1 ? "" : "s"}: ${labels.join(", ")}`);
      root.append(overflow);
    }
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
    const badges = badgeList(comment.badges, comment.staffRole);
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
