(() => {
  "use strict";
  if (document.body.dataset.page !== "home") return;
  const key = "browserp-newcomer-guide-v1";
  try { if (localStorage.getItem(key) === "done") return; } catch { /* The guide still works without storage. */ }
  const target = document.querySelector(".home-game-discovery");
  if (!target || typeof HTMLDialogElement === "undefined") return;
  const make = (tag, className, value) => {
    const item = document.createElement(tag);
    item.className = className;
    if (value) item.textContent = value;
    return item;
  };
  const invite = make("aside", "newcomer-guide-v10");
  invite.hidden = true;
  invite.setAttribute("aria-label", "Welcome to BrowseRP");
  const row = make("div");
  const copy = make("p"); copy.append(make("strong", "", "New here? "), "Find your first community in three quick steps.");
  const start = make("button", "", "Show me around"); start.type = "button";
  const dismiss = make("button", "", "No thanks"); dismiss.type = "button";
  row.append(copy, start, dismiss); invite.append(row); target.append(invite);
  const dialog = make("dialog", "newcomer-dialog-v10");
  dialog.setAttribute("aria-labelledby", "newcomer-title-v10");
  const stepLabel = make("span", "newcomer-step-v10");
  const title = make("h2"); title.id = "newcomer-title-v10";
  const body = make("p");
  const actions = make("div", "newcomer-actions-v10");
  const skip = make("button", "", "Skip guide"); skip.type = "button";
  const next = make("button", "button-v3 button-primary-v3", "Next"); next.type = "button";
  actions.append(skip, next); dialog.append(stepLabel, title, body, actions); document.body.append(dialog);
  const steps = [
    ["Pick a game", "Choose FiveM, RedM, Roblox or Minecraft. The game artwork and the links below both take you to those communities."],
    ["Narrow the list", "Search a name or play style, then use filters for region, language, access and the details that matter to you."],
    ["Find your place", "Open a listing for its rules, activity and how to join. You can also save or compare communities as you browse."]
  ];
  let index = 0, completed = false;
  const remember = () => { completed = true; observer.disconnect(); try { localStorage.setItem(key, "done"); } catch { /* Keep the current visit usable. */ } };
  const end = () => { dialog.close(); invite.hidden = true; remember(); };
  const paint = () => {
    stepLabel.textContent = `Step ${index + 1} of ${steps.length}`;
    title.textContent = steps[index][0]; body.textContent = steps[index][1];
    next.textContent = index === steps.length - 1 ? "Explore servers" : "Next";
  };
  start.addEventListener("click", () => { index = 0; paint(); dialog.showModal(); });
  dismiss.addEventListener("click", () => { invite.hidden = true; remember(); });
  skip.addEventListener("click", end);
  next.addEventListener("click", () => {
    if (index < steps.length - 1) { index++; paint(); next.focus(); }
    else { remember(); location.assign("/servers"); }
  });
  dialog.addEventListener("cancel", () => { invite.hidden = true; remember(); });
  dialog.addEventListener("click", event => { if (event.target === dialog) end(); });
  // The consent card has its own first-visit controls. Show this invitation
  // only after that card has closed, with no timer or automatic modal.
  const reveal = () => {
    if (completed) return;
    const shouldHide = Boolean(document.querySelector("[data-cookie-prompt]:not([hidden])"));
    if (invite.hidden !== shouldHide) invite.hidden = shouldHide;
  };
  const observer = new MutationObserver(reveal);
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["hidden"] });
  window.addEventListener("pageshow", reveal, { once: true });
  reveal();
})();
