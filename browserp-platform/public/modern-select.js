(() => {
  "use strict";

  if (document.body?.hasAttribute("data-staff-page") || document.body?.classList.contains("staff-v3") || /^\/staff(?:panel)?(?:\/|$)/.test(location.pathname)) return;
  // Keep the platform picker on touch devices and browsers without the top layer.
  if (typeof HTMLElement.prototype.showPopover !== "function" || typeof window.matchMedia !== "function") return;
  const desktop = window.matchMedia("(min-width: 768px) and (hover: hover) and (pointer: fine)");
  const records = new Map();
  let active = null;
  let sequence = 0;
  let scheduled = false;
  const pending = new Set();
  const make = (tag, className) => { const element = document.createElement(tag); element.className = className; return element; };
  const eligible = (select) => desktop.matches && !select.multiple && select.size <= 1 && !select.hidden && !select.hasAttribute("data-native-select");
  const disabled = (option) => option.disabled || (option.parentElement?.tagName === "OPTGROUP" && option.parentElement.disabled);
  const options = (record) => Array.from(record.select.options).map((option, index) => ({ option, index })).filter(({ option }) => !option.hidden && !option.parentElement?.hidden);
  const selectable = (record) => options(record).filter(({ option }) => !disabled(option));
  const isOpen = (record) => record.button.getAttribute("aria-expanded") === "true";

  function nameFor(select) {
    if (select.getAttribute("aria-label")) return select.getAttribute("aria-label");
    const labelledBy = select.getAttribute("aria-labelledby");
    if (labelledBy) return labelledBy.split(/\s+/).map(id => document.getElementById(id)?.textContent || "").join(" ").trim();
    return Array.from(select.labels || []).map(label => {
      const copy = label.cloneNode(true);
      copy.querySelectorAll("select,button,input,textarea,.modern-select-error").forEach(control => control.remove());
      return copy.textContent.trim();
    }).filter(Boolean).join(" ") || select.title || "Choose an option";
  }

  function position(record) {
    if (!isOpen(record)) return;
    const rect = record.button.getBoundingClientRect();
    if (!rect.width || !rect.height) { close(record); return; }
    const viewport = window.visualViewport;
    const leftEdge = viewport?.offsetLeft || 0;
    const topEdge = viewport?.offsetTop || 0;
    const width = viewport?.width || document.documentElement.clientWidth || window.innerWidth;
    const height = viewport?.height || window.innerHeight;
    const gutter = 12;
    const popupWidth = Math.min(Math.max(rect.width, 220), width - gutter * 2);
    const below = topEdge + height - rect.bottom - gutter;
    const above = rect.top - topEdge - gutter;
    const opensAbove = below < 200 && above > below;
    const room = Math.max(40, (opensAbove ? above : below) - 6);
    record.popup.style.width = `${popupWidth}px`;
    record.popup.style.maxHeight = `${Math.min(320, room)}px`;
    record.popup.style.left = `${Math.max(leftEdge + gutter, Math.min(rect.left, leftEdge + width - popupWidth - gutter))}px`;
    const popupHeight = Math.min(record.popup.scrollHeight, Math.min(320, room));
    record.popup.style.top = `${Math.max(topEdge + gutter, opensAbove ? rect.top - popupHeight - 6 : rect.bottom + 6)}px`;
  }

  function highlight(record, index) {
    record.index = index;
    record.popup.querySelectorAll("[role=option]").forEach(item => item.classList.toggle("is-active", Number(item.dataset.index) === index));
    const item = record.popup.querySelector(`[data-index="${index}"]`);
    if (isOpen(record) && item) {
      record.button.setAttribute("aria-activedescendant", item.id);
      item.scrollIntoView?.({ block: "nearest" });
    } else record.button.removeAttribute("aria-activedescendant");
  }

  function close(record, restoreFocus = false) {
    if (!record) return;
    record.button.setAttribute("aria-expanded", "false");
    record.button.removeAttribute("aria-activedescendant");
    try { record.popup.hidePopover(); } catch { /* Already closed by native light dismiss. */ }
    if (active === record) active = null;
    if (restoreFocus && record.button.isConnected && !record.button.disabled) record.button.focus();
  }

  function rebuild(record) {
    const children = [];
    let group = null;
    for (const { option, index } of options(record)) {
      const parent = option.parentElement?.tagName === "OPTGROUP" ? option.parentElement : null;
      if (parent && parent !== group) {
        const heading = make("div", "modern-select-group"); heading.textContent = parent.label;
        heading.setAttribute("role", "presentation"); children.push(heading);
      }
      group = parent;
      const item = make("div", "modern-select-option");
      item.id = `${record.popup.id}-option-${index}`;
      item.dataset.index = String(index);
      item.setAttribute("role", "option");
      item.setAttribute("aria-selected", String(index === record.select.selectedIndex));
      item.setAttribute("aria-disabled", String(disabled(option)));
      item.textContent = option.label || option.textContent;
      children.push(item);
    }
    if (!children.length) { const empty = make("div", "modern-select-empty"); empty.textContent = "No options available"; children.push(empty); }
    record.popup.replaceChildren(...children);
    const available = selectable(record);
    if (!available.some(item => item.index === record.index)) record.index = available.find(item => item.index === record.select.selectedIndex)?.index ?? available[0]?.index ?? -1;
    highlight(record, record.index);
  }

  function sync(record) {
    const { select, button } = record;
    if (!select.isConnected || !eligible(select)) { destroy(record); return; }
    record.value.textContent = select.options[select.selectedIndex]?.label || "Choose an option";
    button.disabled = select.matches(":disabled");
    button.setAttribute("aria-label", nameFor(select));
    button.setAttribute("aria-required", String(select.required));
    const description = [select.getAttribute("aria-describedby"), !record.error.hidden ? record.error.id : ""].filter(Boolean).join(" ");
    if (description) button.setAttribute("aria-describedby", description); else button.removeAttribute("aria-describedby");
    if (select.getAttribute("aria-invalid") === "true" || (!record.error.hidden && !select.validity.valid)) button.setAttribute("aria-invalid", "true");
    else { button.removeAttribute("aria-invalid"); record.error.hidden = true; }
    if (button.disabled) close(record);
    if (isOpen(record)) { rebuild(record); position(record); }
  }

  function open(record) {
    sync(record);
    if (!records.has(record.select) || record.button.disabled) return false;
    if (active && active !== record) close(active);
    record.index = selectable(record).find(item => item.index === record.select.selectedIndex)?.index ?? selectable(record)[0]?.index ?? -1;
    rebuild(record);
    try { record.popup.showPopover(); } catch { return false; }
    record.button.setAttribute("aria-expanded", "true");
    active = record;
    position(record);
    highlight(record, record.index);
    return true;
  }

  function choose(record, index) {
    const option = record.select.options[index];
    if (!option || disabled(option) || record.select.matches(":disabled")) return;
    const changed = record.select.selectedIndex !== index;
    record.select.selectedIndex = index;
    close(record, true);
    record.error.hidden = true;
    sync(record);
    if (changed) {
      record.select.dispatchEvent(new Event("input", { bubbles: true }));
      record.select.dispatchEvent(new Event("change", { bubbles: true }));
      if (records.has(record.select)) sync(record);
    }
  }

  function move(record, direction) {
    const available = selectable(record);
    if (!available.length) return;
    const current = available.findIndex(item => item.index === record.index);
    const next = Math.max(0, Math.min(available.length - 1, current + direction));
    highlight(record, available[next].index);
  }

  function keyboard(record, event) {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      if (!isOpen(record) && !open(record)) return;
      const available = selectable(record);
      if (event.key === "Home") highlight(record, available[0]?.index ?? -1);
      else if (event.key === "End") highlight(record, available.at(-1)?.index ?? -1);
      else move(record, event.key === "ArrowDown" ? 1 : -1);
    } else if (event.key === "Enter" || (event.key === " " && !record.typed)) {
      event.preventDefault();
      if (isOpen(record)) choose(record, record.index); else open(record);
    } else if (event.key === "Escape" && isOpen(record)) {
      event.preventDefault(); close(record, true);
    } else if (event.key === "Tab") close(record);
    else if (event.key.length === 1) {
      event.preventDefault();
      clearTimeout(record.typingTimer);
      record.typed += event.key.toLocaleLowerCase();
      record.typingTimer = setTimeout(() => { record.typed = ""; }, 700);
      const needle = Array.from(record.typed).every(letter => letter === record.typed[0]) ? record.typed[0] : record.typed;
      const available = selectable(record);
      const start = available.findIndex(item => item.index === (isOpen(record) ? record.index : record.select.selectedIndex));
      const order = [...available.slice(start + 1), ...available.slice(0, start + 1)];
      const match = order.find(({ option }) => (option.label || option.textContent).trim().toLocaleLowerCase().startsWith(needle));
      if (match) { if (isOpen(record)) highlight(record, match.index); else choose(record, match.index); }
    }
  }

  function destroy(record) {
    close(record);
    clearTimeout(record.typingTimer);
    record.abort.abort();
    record.select.classList.remove("modern-select-native");
    if (record.tabIndex === null) record.select.removeAttribute("tabindex"); else record.select.setAttribute("tabindex", record.tabIndex);
    if (record.ariaHidden === null) record.select.removeAttribute("aria-hidden"); else record.select.setAttribute("aria-hidden", record.ariaHidden);
    record.button.remove(); record.popup.remove(); record.error.remove();
    record.wrapper.remove();
    records.delete(record.select);
  }

  function enhance(select) {
    if (records.has(select) || !eligible(select)) return;
    const id = `modern-select-${++sequence}`;
    const wrapper = make("span", "modern-select");
    const button = make("button", "modern-select-trigger"); button.type = "button";
    button.id = `${id}-trigger`; button.setAttribute("role", "combobox"); button.setAttribute("aria-haspopup", "listbox"); button.setAttribute("aria-expanded", "false"); button.setAttribute("aria-controls", `${id}-list`);
    const value = make("span", "modern-select-value"); button.append(value);
    const popup = make("div", "modern-select-popup"); popup.id = `${id}-list`; popup.setAttribute("popover", "auto"); popup.setAttribute("role", "listbox"); popup.setAttribute("aria-labelledby", button.id);
    const error = make("span", "modern-select-error"); error.id = `${id}-error`; error.hidden = true; error.setAttribute("role", "alert");
    const record = { select, wrapper, button, value, popup, error, index: -1, typed: "", typingTimer: null, tabIndex: select.getAttribute("tabindex"), ariaHidden: select.getAttribute("aria-hidden"), abort: new AbortController() };
    records.set(select, record);
    // Leave the native control under its original label: existing form/search code
    // intentionally reads select.parentElement and must keep working unchanged.
    select.after(wrapper); wrapper.append(button, error); document.body.append(popup);
    select.classList.add("modern-select-native"); select.setAttribute("tabindex", "-1"); select.setAttribute("aria-hidden", "true");
    const on = (element, event, handler) => element.addEventListener(event, handler, { signal: record.abort.signal });
    on(button, "click", () => { if (isOpen(record)) close(record); else open(record); });
    on(button, "keydown", event => keyboard(record, event));
    on(button, "focus", () => sync(record));
    on(button, "blur", () => close(record));
    on(popup, "pointerdown", event => { if (event.target.closest("[role=option]")) event.preventDefault(); });
    on(popup, "click", event => { const item = event.target.closest("[role=option]"); if (item) choose(record, Number(item.dataset.index)); });
    on(popup, "toggle", event => { if (event.newState === "closed" && isOpen(record)) close(record); });
    on(select, "change", () => sync(record));
    on(select, "input", () => sync(record));
    on(select, "focus", () => button.focus());
    on(select, "invalid", event => {
      event.preventDefault(); error.textContent = select.validationMessage; error.hidden = false;
      sync(record); button.focus();
    });
    sync(record);
  }

  function flush() {
    scheduled = false;
    for (const select of pending) { if (records.has(select)) sync(records.get(select)); else if (select.isConnected) enhance(select); }
    pending.clear();
    for (const record of records.values()) if (!record.select.isConnected) destroy(record);
  }
  function schedule(select) { pending.add(select); if (!scheduled) { scheduled = true; queueMicrotask(flush); } }
  function scan(root) { if (root instanceof HTMLSelectElement) schedule(root); root.querySelectorAll?.("select").forEach(schedule); }
  const observer = new MutationObserver(mutations => {
    for (const mutation of mutations) {
      const target = mutation.target.nodeType === 1 ? mutation.target : mutation.target.parentElement;
      const select = target?.closest?.("select");
      if (select) schedule(select);
      else if (mutation.type === "attributes" && target?.tagName === "FIELDSET") scan(target);
      mutation.addedNodes.forEach(scan);
    }
    // Clean up popovers when an entire form or filter section is rerendered.
    if (!scheduled) { scheduled = true; queueMicrotask(flush); }
  });
  observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["disabled", "selected", "label", "value", "hidden", "required", "multiple", "size", "aria-label", "aria-labelledby", "aria-describedby", "aria-invalid"] });
  desktop.addEventListener("change", () => { if (!desktop.matches) Array.from(records.values()).forEach(destroy); else scan(document); });
  document.addEventListener("pointerdown", event => { if (active && !active.button.contains(event.target) && !active.popup.contains(event.target)) close(active); });
  document.addEventListener("reset", event => queueMicrotask(() => { for (const record of records.values()) if (record.select.form === event.target) { record.error.hidden = true; sync(record); } }));
  document.addEventListener("scroll", event => { if (active && !active.popup.contains(event.target)) position(active); }, true);
  window.addEventListener("resize", () => { if (active) position(active); });
  window.visualViewport?.addEventListener("resize", () => { if (active) position(active); });
  scan(document);
})();
