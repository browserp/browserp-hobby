(() => {
  "use strict";
  const node = (tag, text, className = "") => {
    const element = document.createElement(tag);
    element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  };
  function field(label, name, { type = "text", min = 0, max = 100, optional = false } = {}) {
    const wrap = node("label", undefined, "field-v3");
    const input = node(type === "textarea" ? "textarea" : type === "select" ? "select" : "input");
    if (input.tagName === "INPUT") input.type = type;
    input.name = name; input.required = !optional;
    if (type !== "select") { input.minLength = min; input.maxLength = max; }
    wrap.append(node("span", label), input);
    return { wrap, input };
  }
  const option = (value, label) => { const item = node("option", label); item.value = value; return item; };
  function button(text, type = "submit", primary = true) {
    const item = node("button", text, `button-v3 ${primary ? "button-primary-v3" : "button-secondary-v3"}`);
    item.type = type; return item;
  }

  async function init({ api, permissions }) {
    const root = document.querySelector("#overview-roles");
    if (!root) return;
    root.replaceChildren();
    root.append(node("h2", "Roles & staff"), node("p", "Create custom roles, choose their permissions, and assign people by Discord user ID.", "prose-v3"));
    if (!permissions?.manageRoles) {
      root.append(node("p", "The owner manages roles and staff assignments.", "staff-state-v3"));
      return;
    }
    const status = node("p", "Loading roles…", "staff-form-status-v3"); status.setAttribute("role", "status");
    const content = node("div", undefined, "overview-role-content"); root.append(content, status);
    let control, staff, editingRole = null;
    const message = (text, error = false) => { status.textContent = text; status.classList.toggle("is-error", error); };
    async function refresh() {
      const results = await Promise.all([api("/api/admin/roles"), api("/api/admin/staff")]);
      control = results[0].control; staff = results[1].staff;
      render();
    }
    async function save(form, path, body, success) {
      const buttons = [...form.querySelectorAll("button")];
      buttons.forEach((item) => { item.disabled = true; }); form.setAttribute("aria-busy", "true");
      try { await api(path, { method: "POST", body: JSON.stringify(body) }); editingRole = null; await refresh(); message(success); }
      catch (error) { message(error.message || "The change could not be saved. Try again.", true); }
      finally { buttons.forEach((item) => { item.disabled = false; }); form.removeAttribute("aria-busy"); }
    }
    function render() {
      content.replaceChildren();
      const grid = node("div", undefined, "overview-role-grid");
      const rolePanel = node("details", undefined, "overview-role-panel");
      rolePanel.append(node("summary", editingRole ? `Edit ${editingRole.name}` : "Create a custom role"));
      rolePanel.open = Boolean(editingRole);
      const roleForm = node("form", undefined, "staff-form-v3");
      const name = field("Role name", "name", { min: 2, max: 60 });
      const description = field("Description", "description", { type: "textarea", min: 5, max: 300 });
      const reason = field("Reason for this change", "reason", { type: "textarea", min: 5, max: 500 });
      name.input.value = editingRole?.name || ""; description.input.value = editingRole?.description || "";
      const choices = node("fieldset", undefined, "overview-role-permissions");
      choices.append(node("legend", "What this role can do"));
      for (const permission of control.permissions || []) {
        const label = node("label", undefined, "overview-role-permission");
        const checkbox = node("input"); checkbox.type = "checkbox"; checkbox.name = "permissions"; checkbox.value = permission.key;
        checkbox.checked = editingRole ? editingRole.permissions.includes(permission.key) : permission.key === "website.overview.read";
        label.append(checkbox, node("span", permission.description)); choices.append(label);
      }
      const actions = node("div", undefined, "hero-actions-v3");
      actions.append(button(editingRole ? "Save role changes" : "Create role"));
      if (editingRole) { const cancel = button("Cancel editing", "button", false); cancel.addEventListener("click", () => { editingRole = null; render(); }); actions.append(cancel); }
      roleForm.append(name.wrap, description.wrap, choices, reason.wrap, actions);
      roleForm.addEventListener("submit", (event) => {
        event.preventDefault();
        const data = new FormData(roleForm);
        save(roleForm, "/api/admin/roles", { key: editingRole?.key || null, name: data.get("name"), description: data.get("description"), permissions: data.getAll("permissions"), expectedVersion: editingRole?.version || 0, reason: data.get("reason") }, "Role saved. It is now available for staff assignments.");
      });
      rolePanel.append(roleForm);

      const assignment = node("details", undefined, "overview-role-panel"); assignment.append(node("summary", "Assign or change a staff role"));
      const form = node("form", undefined, "staff-form-v3");
      const member = field("Person", "member", { type: "select" });
      member.input.append(option("new", "Add a staff member"), ...(staff.members || []).filter((item) => item.roleKey !== "owner").map((item) => option(item.discordUserId, `${item.displayName || "Pending sign-in"} · ${item.discordUserId}`)));
      const discord = field("Discord user ID", "discordUserId", { min: 17, max: 20 }); discord.input.pattern = "[0-9]{17,20}"; discord.input.inputMode = "numeric";
      const role = field("Role", "roleKey", { type: "select" }); role.input.append(...(staff.roles || []).filter((item) => item.key !== "owner").map((item) => option(item.key, item.name)));
      const action = field("Action", "action", { type: "select" });
      const reasonField = field("Reason for this change", "reason", { type: "textarea", min: 5, max: 500 });
      const updateMember = () => {
        const current = (staff.members || []).find((item) => item.discordUserId === member.input.value);
        discord.input.readOnly = Boolean(current); discord.input.value = current?.discordUserId || "";
        if (current?.roleKey) role.input.value = current.roleKey;
        action.input.replaceChildren(...(current ? [["change_role", "Change role"], ["suspend", "Suspend staff access"], ["reactivate", "Reactivate staff access"], ["revoke", "Revoke staff access"]] : [["assign", "Assign role"]]).map(([value, label]) => option(value, label)));
        role.input.disabled = false;
      };
      member.input.addEventListener("change", updateMember);
      action.input.addEventListener("change", () => { role.input.disabled = !["assign", "change_role"].includes(action.input.value); });
      updateMember();
      form.append(member.wrap, discord.wrap, role.wrap, action.wrap, reasonField.wrap, button("Save staff assignment"));
      form.addEventListener("submit", (event) => {
        event.preventDefault();
        const current = (staff.members || []).find((item) => item.discordUserId === member.input.value);
        save(form, "/api/admin/staff", { discordUserId: discord.input.value.trim(), action: action.input.value, roleKey: role.input.value, expectedVersion: current?.version || 0, reason: reasonField.input.value }, "Staff assignment saved.");
      });
      assignment.append(form); grid.append(rolePanel, assignment); content.append(grid);

      const list = node("div", undefined, "overview-role-list");
      for (const role of control.roles || []) {
        const card = node("article", undefined, "overview-role-card");
        card.append(node("h3", role.name), node("p", role.description), node("span", `${role.memberCount || 0} assigned · ${role.custom ? "Custom role" : "Built-in role"}`, "staff-state-v3"));
        if (role.custom) { const edit = button("Edit role", "button", false); edit.addEventListener("click", () => { editingRole = role; render(); content.querySelector("input[name=name]")?.focus(); }); card.append(edit); }
        list.append(card);
      }
      content.append(list);
    }
    try { await refresh(); message(""); }
    catch (error) {
      message(error.message || "Roles could not be loaded.", true);
      const retry = button("Try again", "button", false); retry.addEventListener("click", () => init({ api, permissions })); content.append(retry);
    }
  }
  window.BrowseRPStaffRoles = { init };
})();
