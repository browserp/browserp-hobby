(() => {
  "use strict";

  const grid = document.querySelector("#staff-public-grid");
  const count = document.querySelector("#staff-public-count");
  const empty = document.querySelector("#staff-public-empty");
  const error = document.querySelector("#staff-public-error");
  const retry = document.querySelector("#staff-public-retry");
  if (!grid || !count || !empty || !error || !retry) return;

  let requestSerial = 0;

  function initials(value) {
    return String(value || "BrowseRP staff").trim().split(/\s+/).slice(0, 2).map((part) => part[0] || "").join("").toUpperCase() || "BR";
  }

  function safeAvatar(value) {
    if (typeof value !== "string" || value.length > 800) return "";
    try {
      const url = new URL(value);
      const discord = url.protocol === "https:" && url.hostname === "cdn.discordapp.com" && url.pathname.startsWith("/avatars/");
      const google = url.protocol === "https:" && url.hostname === "lh3.googleusercontent.com";
      const storage = url.protocol === "https:" && url.hostname === "kywabzfgjoqiznnxygbq.supabase.co" && url.pathname.startsWith("/storage/v1/object/public/profile-media/");
      return url.username || url.password || url.port || !(discord || google || storage) ? "" : url.href;
    } catch {
      return "";
    }
  }

  function joinDate(value) {
    if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) return null;
    const date = new Date(value);
    return {
      iso: date.toISOString(),
      label: new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(date)
    };
  }

  function element(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = String(text);
    return node;
  }

  function card(member) {
    const article = element("article", "staff-public-card");
    const head = element("div", "staff-public-card-head");
    const avatar = element("div", "staff-public-avatar");
    const fallback = element("span", "staff-public-avatar-fallback", initials(member.displayName));
    fallback.setAttribute("aria-hidden", "true");
    avatar.append(fallback);

    const avatarUrl = safeAvatar(member.avatarUrl);
    if (avatarUrl) {
      const image = new Image();
      image.alt = "";
      image.loading = "lazy";
      image.decoding = "async";
      image.width = 82;
      image.height = 82;
      image.src = avatarUrl;
      image.addEventListener("error", () => { image.hidden = true; }, { once: true });
      avatar.append(image);
    }

    const copy = element("div", "staff-public-card-copy");
    copy.append(element("h3", "", member.displayName), element("span", "staff-public-role", member.roleName));
    head.append(avatar, copy);

    const joined = element("div", "staff-public-joined");
    joined.append(element("strong", "", "Joined staff"));
    const formatted = joinDate(member.joinedAt);
    if (formatted) {
      const time = element("time", "", formatted.label);
      time.dateTime = formatted.iso;
      joined.append(time);
    } else {
      joined.append(element("span", "", "Date unavailable"));
    }
    article.append(head, joined);
    return article;
  }

  function validMember(value) {
    return value && typeof value === "object"
      && typeof value.displayName === "string" && value.displayName.trim().length >= 2 && value.displayName.length <= 48
      && typeof value.roleName === "string" && value.roleName.trim().length >= 2 && value.roleName.length <= 80
      && (value.joinedAt === null || typeof value.joinedAt === "string")
      && (value.avatarUrl === null || typeof value.avatarUrl === "string");
  }

  function setState(state, staff = []) {
    grid.hidden = state !== "ready";
    empty.hidden = state !== "empty";
    error.hidden = state !== "error";
    grid.setAttribute("aria-busy", String(state === "loading"));
    if (state === "loading") {
      count.textContent = "Loading active staff…";
      return;
    }
    if (state === "error") {
      count.textContent = "Roster temporarily unavailable";
      return;
    }
    if (state === "empty") {
      count.textContent = "No active staff listed";
      return;
    }
    count.textContent = `${staff.length} active staff ${staff.length === 1 ? "member" : "members"}`;
  }

  async function load() {
    const serial = ++requestSerial;
    retry.disabled = true;
    setState("loading");
    try {
      const response = await fetch("/api/resources?view=staff", {
        method: "GET",
        credentials: "same-origin",
        headers: { Accept: "application/json" }
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Staff roster unavailable");
      if (serial !== requestSerial) return;
      const staff = Array.isArray(payload.staff) ? payload.staff.filter(validMember) : [];
      grid.replaceChildren(...staff.map(card));
      setState(staff.length ? "ready" : "empty", staff);
    } catch {
      if (serial !== requestSerial) return;
      grid.replaceChildren();
      setState("error");
    } finally {
      if (serial === requestSerial) retry.disabled = false;
    }
  }

  retry.addEventListener("click", load);
  load();
})();
