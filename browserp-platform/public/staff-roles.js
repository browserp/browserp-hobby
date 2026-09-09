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

  const roleAction = action => ["assign", "change_role"].includes(action);
  const date = value => { const parsed = new Date(value); return value && Number.isFinite(parsed.getTime()) ? parsed.toLocaleString() : "Date unavailable"; };
  const actionsFor = member => !member ? [["assign", "Assign role"]] : [
    ["change_role", "Change role"],
    [member.status === "active" ? "suspend" : "reactivate", member.status === "active" ? "Suspend staff access" : "Reactivate staff access"],
    ["revoke", "Remove staff access"]
  ];

  async function init({ api, permissions }) {
    const root = document.querySelector("#overview-roles");
    if (!root) return;
    root.replaceChildren();
    root.append(node("h2", "Roles & staff"), node("p", "View staff responsibilities, manage roles below your own, or request a change for review.", "prose-v3"));
    if (!permissions?.readStaff && !permissions?.manageStaff && !permissions?.manageRoles) {
      root.append(node("p", "Your current role cannot view the staff catalogue.", "staff-state-v3"));
      return;
    }
    const status = node("p", "Loading roles…", "staff-form-status-v3"); status.setAttribute("role", "status");
    const content = node("div", undefined, "overview-role-content"); root.append(content, status);
    if (permissions.isOwner === true && window.BrowseRPStaffDiscordSync) {
      const sync = node("section", undefined, "overview-role-panel"); root.append(sync);
      void window.BrowseRPStaffDiscordSync.init({ api, root: sync, isOwner: true });
    }
    let control = {}, staff = { members: [], roles: [] }, requests = [], editingRole = null;
    const pending = new WeakSet();
    const message = (text, error = false) => { status.textContent = text; status.classList.toggle("is-error", error); };
    async function refresh() {
      const results = await Promise.all([api("/api/admin/roles"), api("/api/admin/staff"), api("/api/admin/staff?view=requests")]);
      control = results[0].control || {}; staff = results[1].staff || { members: [], roles: [] }; requests = Array.isArray(results[2].requests) ? results[2].requests : [];
      render();
    }
    async function save(form, path, body, success) {
      if (pending.has(form)) return;
      pending.add(form);
      const controls = [...form.querySelectorAll("button,input,textarea,select")].map(item => [item, item.disabled]);
      controls.forEach(([item]) => { item.disabled = true; }); form.setAttribute("aria-busy", "true");
      try { await api(path, { method: "POST", body: JSON.stringify(body) }); editingRole = null; await refresh(); message(success); }
      catch (error) { message(error.message || "The change could not be saved. Try again.", true); }
      finally { pending.delete(form); controls.forEach(([item, disabled]) => { item.disabled = disabled; }); form.removeAttribute("aria-busy"); }
    }
    function render() {
      content.replaceChildren();
      const grid = node("div", undefined, "overview-role-grid");
      if (control.canEditRoles === true) {
        const rolePanel = node("details", undefined, "overview-role-panel staff-role-editor-v3");
        rolePanel.append(node("summary", editingRole ? `Edit ${editingRole.name}` : "Create a custom role")); rolePanel.open = Boolean(editingRole);
        const roleForm = node("form", undefined, "staff-form-v3");
        const name = field("Role name", "name", { min: 2, max: 60 });
        const description = field("Description", "description", { type: "textarea", min: 5, max: 300 });
        const reason = field("Reason for this change", "reason", { type: "textarea", min: 5, max: 500 });
        name.input.value = editingRole?.name || ""; description.input.value = editingRole?.description || "";
        const choices = node("fieldset", undefined, "overview-role-permissions"); choices.append(node("legend", "What this role can do"));
        for (const permission of control.permissions || []) {
          const label = node("label", undefined, "overview-role-permission"); const checkbox = node("input");
          checkbox.type = "checkbox"; checkbox.name = "permissions"; checkbox.value = permission.key;
          checkbox.checked = editingRole ? (editingRole.permissions || []).includes(permission.key) : permission.key === "website.overview.read";
          label.append(checkbox, node("span", permission.description)); choices.append(label);
        }
        const actions = node("div", undefined, "hero-actions-v3"); actions.append(button(editingRole ? "Save role changes" : "Create role"));
        if (editingRole) { const cancel = button("Cancel editing", "button", false); cancel.addEventListener("click", () => { editingRole = null; render(); }); actions.append(cancel); }
        roleForm.append(name.wrap, description.wrap, choices, reason.wrap, actions);
        roleForm.addEventListener("submit", event => {
          event.preventDefault(); const data = new FormData(roleForm);
          void save(roleForm, "/api/admin/roles", { key: editingRole?.key || null, name: data.get("name"), description: data.get("description"), permissions: data.getAll("permissions"), expectedVersion: editingRole?.version || 0, reason: data.get("reason") }, "Role saved. It is now available within the staff hierarchy.");
        });
        rolePanel.append(roleForm); grid.append(rolePanel);
      }

      if (control.canAssign === true) {
        const assignment = node("details", undefined, "overview-role-panel staff-role-direct-v3"); assignment.append(node("summary", "Assign or change a lower staff role"));
        const assignableRoles = (staff.roles || control.roles || []).filter(item => item.assignable === true);
        if (!assignableRoles.length) assignment.append(node("p", "There are no roles you can assign directly. You can request a staff change below when that option is available.", "staff-state-v3 staff-role-action-note-v3"));
        else {
          assignment.append(node("p", "Choose a person and role below your own, then explain the change. Every saved change is recorded in the staff audit log.", "staff-state-v3 staff-role-action-note-v3"));
          const form = node("form", undefined, "staff-form-v3");
          const member = field("Person", "member", { type: "select" });
          const manageable = (staff.members || []).filter(item => item.manageable === true && item.roleKey !== "owner");
          member.input.append(option("new", "Add a staff member"), ...manageable.map(item => option(item.discordUserId, `${item.displayName || "Pending sign-in"} · ${item.discordUserId}`)));
          const discord = field("Discord user ID", "discordUserId", { min: 17, max: 20 }); discord.input.pattern = "[0-9]{17,20}"; discord.input.inputMode = "numeric";
          const role = field("Role", "roleKey", { type: "select" }); role.input.append(...assignableRoles.map(item => option(item.key, item.name)));
          const action = field("Action", "action", { type: "select" }); const reasonField = field("Reason for this change", "reason", { type: "textarea", min: 5, max: 500 });
          const updateRole = () => { const needed = roleAction(action.input.value); role.input.disabled = !needed; role.input.required = needed; };
          const updateMember = () => {
            const current = manageable.find(item => item.discordUserId === member.input.value);
            discord.input.readOnly = Boolean(current); discord.input.value = current?.discordUserId || "";
            action.input.replaceChildren(...actionsFor(current).map(([value, label]) => option(value, label)));
            if (current?.roleKey && assignableRoles.some(item => item.key === current.roleKey)) role.input.value = current.roleKey;
            updateRole();
          };
          member.input.addEventListener("change", updateMember); action.input.addEventListener("change", updateRole); updateMember();
          form.append(member.wrap, discord.wrap, action.wrap, role.wrap, reasonField.wrap, button("Save direct staff change"));
          form.addEventListener("submit", event => {
            event.preventDefault(); const current = manageable.find(item => item.discordUserId === member.input.value);
            void save(form, "/api/admin/staff", { discordUserId: discord.input.value.trim(), action: action.input.value, roleKey: roleAction(action.input.value) ? role.input.value : null, expectedVersion: current?.version || 0, reason: reasonField.input.value }, "Staff access changed and recorded.");
          });
          assignment.append(form);
        }
        grid.append(assignment);
      }
      if (grid.childElementCount) content.append(grid);
      if (control.canAssign !== true && control.canEditRoles !== true) content.append(node("p", control.canRequest === true ? "Your role can view the catalogue and submit reviewed changes, but cannot apply staff changes directly." : "Your role has read-only access to the staff catalogue.", "staff-state-v3 staff-role-action-note-v3"));

      if (control.canRequest === true) {
        const panel = node("details", undefined, "overview-role-panel staff-role-request-panel-v3"); panel.append(node("summary", "Request a staff change"));
        panel.append(node("p", "A suitable higher-authority staff member must review this request. Submitting it does not change anyone’s access.", "staff-role-action-note-v3"));
        const form = node("form", undefined, "staff-form-v3 staff-role-request-form-v3"), requestKey = crypto.randomUUID();
        const person = field("Person", "person", { type: "select" }); const requestableMembers = (staff.members || []).filter(item => item.roleKey !== "owner");
        person.input.append(option("new", "Someone not listed"), ...requestableMembers.map(item => option(item.discordUserId, `${item.displayName || "Pending sign-in"} · ${item.discordUserId}`)));
        const discord = field("Discord user ID", "discordUserId", { min: 17, max: 20 }); discord.input.pattern = "[0-9]{17,20}"; discord.input.inputMode = "numeric";
        const availableRoles = (control.roles || staff.roles || []).filter(item => item.key !== "owner");
        const role = field("Requested role", "roleKey", { type: "select" }); role.input.append(...availableRoles.map(item => option(item.key, item.name)));
        const action = field("Requested action", "action", { type: "select" }); const reasonField = field("Reason for this request", "reason", { type: "textarea", min: 5, max: 500 });
        const updateRole = () => { const needed = roleAction(action.input.value); role.input.disabled = !needed; role.input.required = needed; };
        const changePerson = () => {
          const current = requestableMembers.find(item => item.discordUserId === person.input.value);
          discord.input.value = current?.discordUserId || ""; discord.input.readOnly = Boolean(current);
          action.input.replaceChildren(...actionsFor(current).map(([value, label]) => option(value, label)));
          if (current?.roleKey && availableRoles.some(item => item.key === current.roleKey)) role.input.value = current.roleKey;
          updateRole();
        };
        person.input.addEventListener("change", changePerson); action.input.addEventListener("change", updateRole); changePerson();
        form.append(person.wrap, discord.wrap, action.wrap, role.wrap, reasonField.wrap, button("Submit for review"));
        form.addEventListener("submit", event => {
          event.preventDefault(); const current = requestableMembers.find(item => item.discordUserId === person.input.value);
          void save(form, "/api/admin/staff", { requestAction: "create", requestKey, discordUserId: discord.input.value.trim(), action: action.input.value, roleKey: roleAction(action.input.value) ? role.input.value : null, expectedVersion: current?.version || 0, reason: reasonField.input.value }, "Staff change requested for review.");
        });
        panel.append(form); content.append(panel);
      }

      if (control.canRequest === true || control.canReviewRequests === true || requests.length) {
        const panel = node("section", undefined, "overview-role-panel staff-role-request-list-v3"); panel.append(node("h3", "Recent staff change requests"), node("p", "Your latest requests and changes within your review authority, up to 50.", "staff-role-action-note-v3"));
        if (!requests.length) panel.append(node("p", "No matching staff change requests.", "staff-state-v3"));
        for (const request of requests) {
          const card = node("article", undefined, "overview-role-card staff-role-request-v3"); const roleName = (control.roles || []).find(item => item.key === request.roleKey)?.name || "Staff access";
          card.append(node("h4", `${roleName} · ${String(request.status || "pending").replaceAll("_", " ")}`), node("p", `${String(request.action || "change").replaceAll("_", " ")} · Discord ${request.discordUserId} · ${date(request.createdAt)}`, "staff-role-request-meta-v3"), node("p", request.reason || "No request reason recorded."));
          if (request.decisionReason) card.append(node("p", `Decision: ${request.decisionReason}`, "staff-role-request-meta-v3"));
          if (request.status === "pending" && request.canReview === true) {
            const form = node("form", undefined, "staff-form-v3 staff-role-request-decision-v3"), reasonField = field("Decision reason", "reason", { type: "textarea", min: 5, max: 500 });
            const actions = node("div", undefined, "hero-actions-v3 staff-role-request-actions-v3"); const approve = button("Approve change"); approve.value = "approve"; const deny = button("Decline request", "submit", false); deny.value = "deny"; actions.append(approve, deny); form.append(reasonField.wrap, actions);
            form.addEventListener("submit", event => { event.preventDefault(); void save(form, "/api/admin/staff", { requestAction: "decide", id: request.id, expectedVersion: request.version, approved: event.submitter?.value === "approve", reason: reasonField.input.value }, "Staff change request reviewed."); }); card.append(form);
          } else if (request.status === "pending") card.append(node("p", request.requestedByMe === true ? "Awaiting review by another authorised staff member." : "This request is outside your current review authority.", "staff-state-v3"));
          panel.append(card);
        }
        content.append(panel);
      }

      const list = node("div", undefined, "overview-role-list staff-role-catalogue-v3");
      for (const role of control.roles || []) {
        const card = node("article", undefined, "overview-role-card");
        card.append(node("h3", role.name), node("p", role.description), node("span", `${role.memberCount || 0} assigned · ${role.custom ? "Custom role" : "Built-in role"}`, "staff-state-v3"));
        const powers = node("details", undefined, "staff-role-capabilities-v3"); powers.append(node("summary", "Role capabilities")); const items = node("ul");
        for (const key of role.permissions || []) { const permission = (control.permissions || []).find(item => item.key === key); items.append(node("li", permission?.description || key.replaceAll(".", " "))); }
        if (!items.childElementCount) items.append(node("li", "No capabilities assigned.")); powers.append(items); card.append(powers);
        if (control.canEditRoles === true && role.editable === true) { const edit = button("Edit role", "button", false); edit.addEventListener("click", () => { editingRole = role; render(); content.querySelector('input[name="name"]')?.focus(); }); card.append(edit); }
        list.append(card);
      }
      if (!list.childElementCount) list.append(node("p", "No staff roles were returned.", "staff-state-v3"));
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
