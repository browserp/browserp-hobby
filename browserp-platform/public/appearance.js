(() => {
  "use strict";
  if (window.BrowseRPTheme) return;

  // A versioned choice distinguishes the original Dark design from the old
  // two-theme setting, whose "dark" value now corresponds to Default.
  const key = "browserp-appearance-v2";
  const legacyKey = "browserp-theme";
  const choices = Object.freeze([
    Object.freeze({ value: "default", label: "Default" }),
    Object.freeze({ value: "dark", label: "Dark" }),
    Object.freeze({ value: "light", label: "Light" })
  ]);
  const valid = value => choices.some(choice => choice.value === value);
  const legacy = value => value === "light" ? "light" : "default";
  const read = () => {
    try {
      const value = localStorage.getItem(key);
      if (valid(value)) return value;
      return legacy(localStorage.getItem(legacyKey));
    } catch { return "default"; }
  };
  let selected = read();
  try { document.documentElement.dataset.brandMotion = localStorage.getItem("browserp-brand-motion") === "off" ? "off" : "on"; }
  catch { document.documentElement.dataset.brandMotion = "on"; }

  function ensureThemeMotion() {
    if (!(["dark", "light"].includes(selected)) || !document.body || document.querySelector("script[data-theme-motion]")) return;
    const script = document.createElement("script");
    script.src = "/primary-motion.js?v=20260916-themes1";
    script.dataset.themeMotion = "";
    document.head.append(script);
  }

  const groupSelector = ".navigation-theme-choices-v6,.first-visit-appearance-choices,.staff-theme-options";
  const buttonSelector = "[data-theme-choice-v6],[data-staff-theme],[data-appearance-choice]";
  function syncControls(root = document) {
    const groups = [...root.querySelectorAll(groupSelector)];
    if (root.matches?.(groupSelector)) groups.unshift(root);
    for (const group of groups) {
      group.style.setProperty("--appearance-index", String(choices.findIndex(choice => choice.value === selected)));
      group.dataset.activeTheme = selected;
    }
    root.querySelectorAll(buttonSelector).forEach(button => {
      const value = button.dataset.themeChoiceV6 || button.dataset.staffTheme || button.dataset.appearanceChoice;
      button.setAttribute("aria-pressed", String(value === selected));
    });
  }

  function sync() {
    document.documentElement.dataset.theme = selected;
    document.documentElement.style.colorScheme = selected === "light" ? "light" : "dark";
    const colour = document.querySelector('meta[name="theme-color"]');
    if (colour) colour.content = { default: "#101a28", dark: "#050507", light: "#fafafa" }[selected];
    syncControls();
  }

  function apply(theme, { persist = false } = {}) {
    selected = valid(theme) ? theme : "default";
    if (persist) {
      try { localStorage.setItem(key, selected); } catch { /* This visit still respects the choice. */ }
    }
    sync();
    ensureThemeMotion();
    window.dispatchEvent(new CustomEvent("browserp:theme-changed", { detail: { theme: selected } }));
    return selected;
  }

  window.BrowseRPTheme = Object.freeze({ choices, get: () => selected, syncControls, apply, set: theme => apply(theme, { persist: true }) });
  window.addEventListener("storage", event => {
    if (event.key === key) apply(valid(event.newValue) ? event.newValue : read());
    else if (event.key === legacyKey) {
      try { if (!valid(localStorage.getItem(key))) apply(legacy(event.newValue)); } catch { /* Keep the current visit's choice. */ }
    } else if (event.key === null) apply(read());
  });
  // Loaded before styles/page scripts so every route begins in the saved theme.
  sync();
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => { sync(); ensureThemeMotion(); }, { once: true });
  else ensureThemeMotion();
})();
