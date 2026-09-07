(() => {
  "use strict";
  const ranks = [["administrator", "Administrator"], ["senior_moderator", "Senior moderator"], ["moderator", "Moderator"], ["support", "Support"]];
  const node = (tag, text, className = "") => { const item = document.createElement(tag); item.className = className; if (text !== undefined) item.textContent = text; return item; };
  const button = (text, primary = false) => { const item = node("button", text, `button-v3 button-${primary ? "primary" : "secondary"}-v3`); item.type = "button"; return item; };
  function field(form, text, name, { optional = false, multiline = false } = {}) {
    const label = node("label", undefined, "field-v3"); const input = node(multiline ? "textarea" : "input");
    input.name = name; input.required = !optional;
    if (!multiline) { input.type = "text"; input.inputMode = "numeric"; input.pattern = "[0-9]{17,20}"; input.maxLength = 20; }
    label.append(node("span", text), input); form.append(label); return input;
  }
  async function init({ api, root, isOwner }) {
    if (!root || isOwner !== true) return;
    root.replaceChildren();
    const section = node("details"); section.append(node("summary", "Discord staff roles"));
    const content = node("div"); const status = node("p", "Loading Discord settings…", "staff-form-status-v3"); status.setAttribute("role", "status");
    section.append(content, status); root.append(section);
    let control, busy = false;
    const message = (text, error = false) => { if (!root.isConnected) return; status.textContent = text; status.classList.toggle("is-error", error); };
    async function refresh() {
      const data = await api("/api/admin/discord-role-sync");
      if (!root.isConnected) return;
      control = data.control; render(data.runtime || {}); message("");
    }
    function render(runtime) {
      content.replaceChildren();
      content.append(node("p", "Keep Discord staff labels aligned with active website staff. Only the four listed ranks can be mapped; Owner and cosmetic roles stay outside synchronization.", "prose-v3"));
      const state = control.enabled ? (control.revokeOnly ? "Removing managed roles" : "Configuration enabled") : "Configuration paused";
      content.append(node("p", `${state}. Application switch: ${runtime.applicationEnabled ? "on" : "off"}. Schedule: ${control.schedulerEnabled ? "on" : "off"}. Bot credential: ${runtime.botTokenConfigured ? "configured" : "not configured"}.`, "staff-state-v3"));
      if (runtime.environmentAllowed === false) content.append(node("p", "This deployment cannot run role synchronization.", "staff-state-v3"));
      content.append(node("p", `${control.trackedMembers ?? 0} tracked identities; ${control.dueMembers ?? 0} due for checking. Last check: ${control.lastCheckedAt ? new Date(control.lastCheckedAt).toLocaleString() : "not yet run"}.`, "staff-state-v3"));
      const form = node("form", undefined, "staff-form-v3");
      const guild = field(form, "Discord server ID", "guildId"); guild.value = control.guildId || ""; guild.readOnly = Boolean(control.guildId);
      const bot = field(form, "Bot user ID", "botUserId"); bot.value = control.botUserId || "";
      const protectedIds = field(form, "Protected role IDs — one per line", "protectedRoleIds", { multiline: true }); protectedIds.value = (control.protectedRoleIds || []).join("\n"); protectedIds.maxLength = 420;
      form.append(node("p", "Include Ownership and Security. Keep these roles above the bot; put approved mapped roles below it. Review their channel access separately.", "prose-v3"));
      const mappingInputs = new Map();
      for (const [key, label] of ranks) { const input = field(form, `${label} — Discord role ID (optional)`, key, { optional: true }); input.value = control.mappings?.[key] || ""; mappingInputs.set(key, input); }
      form.append(node("p", "Leave a rank blank until its exact destination is approved. Removing a mapping retains its old role ID for cleanup.", "prose-v3"));
      const modeLabel = node("label", undefined, "field-v3"), mode = node("select"); mode.name = "mode";
      for (const [value, text] of [["paused", "Pause changes"], ["enabled", "Synchronize approved ranks"], ["revoke", "Remove managed roles only"]]) { const option = node("option", text); option.value = value; mode.append(option); }
      mode.value = control.enabled ? (control.revokeOnly ? "revoke" : "enabled") : "paused"; modeLabel.append(node("span", "Mode"), mode); form.append(modeLabel);
      form.append(node("p", "Pausing does not remove existing Discord roles. For a planned shutdown, choose removal only, keep the application and schedule on, and verify removal before pausing. Changes are checked about every five minutes; outages can delay them.", "prose-v3"));
      const reason = field(form, "Reason for this change", "reason", { multiline: true }); reason.minLength = 10; reason.maxLength = 500;
      const actions = node("div", undefined, "hero-actions-v3"), check = button("Check bot and roles"), save = button("Save Discord settings", true), reload = button("Reload settings"); save.type = "submit";
      actions.append(check, save, reload); form.append(actions);
      const payload = action => ({ action, guildId: guild.value.trim(), botUserId: bot.value.trim(), protectedRoleIds: [...new Set(protectedIds.value.split(/[\s,]+/).filter(Boolean))], mappings: Object.fromEntries([...mappingInputs].filter(([, input]) => input.value.trim()).map(([key, input]) => [key, input.value.trim()])), enabled: mode.value !== "paused", revokeOnly: mode.value === "revoke", expectedVersion: control.version, reason: reason.value.trim() });
      async function send(action) {
        if (busy) return; busy = true;
        [...form.elements].forEach(item => { item.disabled = true; }); form.setAttribute("aria-busy", "true");
        try {
          const result = await api("/api/admin/discord-role-sync", { method: "POST", body: JSON.stringify(payload(action)) });
          if (!root.isConnected) return;
          if (action === "check") {
            const names = (result.readiness.roles || []).map(role => `${ranks.find(([key]) => key === role.siteRole)?.[1] || role.siteRole}: ${role.name} (${role.roleId})`).join("; ");
            message([result.readiness.message, names].filter(Boolean).join(" "), !result.readiness.ready);
          } else { await refresh(); message("Settings saved. Synchronization runs only when the application switch and schedule are also on."); }
        } catch (error) { message(error.message || "Discord settings could not be updated.", true); }
        finally { busy = false; [...form.elements].forEach(item => { item.disabled = false; }); form.removeAttribute("aria-busy"); }
      }
      check.addEventListener("click", () => send("check"));
      form.addEventListener("submit", event => { event.preventDefault(); if (form.reportValidity()) void send("save"); });
      reload.addEventListener("click", () => { if (!busy) void refresh().catch(error => message(error.message || "Settings could not be loaded.", true)); });
      form.addEventListener("input", () => { if (!busy) message("Unsaved changes. Enabling will check the bot and roles again before saving."); });
      content.append(form);
      const events = node("details"); events.append(node("summary", "Recent synchronization outcomes"));
      const list = node("ul");
      for (const event of control.recentEvents || []) list.append(node("li", `${new Date(event.created_at).toLocaleString()} — ${event.event}${event.discord_user_id ? ` — ${event.discord_user_id}` : ""}${event.details?.roleId ? ` — role ${event.details.roleId}` : ""}`));
      if (!list.children.length) list.append(node("li", "No recorded outcomes yet.")); events.append(list); content.append(events);
    }
    try { await refresh(); }
    catch (error) {
      if (!root.isConnected) return;
      content.replaceChildren(); message(error.message || "Discord settings are unavailable. Check that the reviewed database setup has been applied.", true);
      const retry = button("Try again"); retry.addEventListener("click", () => init({ api, root, isOwner })); content.append(retry);
    }
  }
  window.BrowseRPStaffDiscordSync = { init };
})();
