(() => {
  "use strict";

  const usernamePattern = /^[a-z0-9_]{3,30}$/;
  const make = (tag, className = "", text) => {
    const node = document.createElement(tag);
    node.className = className;
    if (text !== undefined) node.textContent = String(text);
    return node;
  };
  const action = (text, className = "small-button") => {
    const node = make("button", className, text);
    node.type = "button";
    return node;
  };
  const date = value => {
    const parsed = new Date(value || "");
    return Number.isFinite(parsed.getTime())
      ? new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(parsed)
      : "";
  };
  const content = value => typeof value === "string" ? value : "";

  function mount({ api, accountId, toast, isCurrent }) {
    const section = make("section", "portal-panel-v2 member-inbox");
    section.id = "inbox";
    const header = make("div", "portal-panel-head");
    const heading = make("div");
    heading.append(make("h2", "", "Messages"), make("p", "", "Message other BrowseRP members. Staff review messages that need a closer check before delivery."));
    const refreshButton = action("Refresh inbox");
    header.append(heading, refreshButton);
    const status = make("p", "member-inbox-status", "Loading your messages…");
    status.setAttribute("role", "status");

    const settings = make("div", "member-inbox-settings");
    const policyLabel = make("label", "member-inbox-policy");
    policyLabel.append(make("span", "", "Who can message me"));
    const policy = make("select");
    for (const [value, label] of [["members", "BrowseRP members"], ["nobody", "Nobody"]]) {
      const option = make("option", "", label);
      option.value = value;
      policy.append(option);
    }
    const savePolicy = action("Save contact setting");
    policyLabel.append(policy);
    settings.append(policyLabel, savePolicy,
      make("p", "member-inbox-help", "Closing your inbox stops new messages and replies, including your own."));

    const compose = make("form", "member-inbox-compose");
    const composeTitle = make("h3", "", "Start a conversation");
    const recipientLabel = make("label");
    recipientLabel.append(make("span", "", "Member username"));
    const recipient = make("input");
    recipient.name = "username"; recipient.required = true; recipient.maxLength = 30;
    recipient.autocomplete = "off"; recipient.placeholder = "username";
    recipientLabel.append(recipient);
    const composeLabel = make("label");
    composeLabel.append(make("span", "", "Message"));
    const composeText = make("textarea");
    composeText.name = "body"; composeText.required = true; composeText.maxLength = 1000;
    composeText.rows = 3; composeLabel.append(composeText);
    const composeSend = make("button", "button button-primary", "Send message");
    composeSend.type = "submit";
    compose.append(composeTitle, recipientLabel, composeLabel, composeSend);

    const layout = make("div", "member-inbox-layout");
    const conversationPane = make("div", "member-inbox-conversations");
    conversationPane.append(make("h3", "", "Conversations"));
    const conversationList = make("div", "member-inbox-conversation-list");
    const olderConversations = action("Older conversations");
    olderConversations.hidden = true;
    conversationPane.append(conversationList, olderConversations);
    const threadPane = make("div", "member-inbox-thread");
    const threadHeader = make("div", "member-inbox-thread-head");
    const threadContent = make("div", "member-inbox-thread-content");
    threadContent.append(make("p", "member-inbox-empty", "Choose a conversation, or start one above."));
    threadPane.append(threadHeader, threadContent);
    layout.append(conversationPane, threadPane);

    const blocked = make("details", "member-inbox-blocked");
    blocked.append(make("summary", "", "Blocked members"));
    const blockedList = make("div", "member-inbox-blocked-list");
    blocked.append(blockedList);
    section.append(header, status, settings, compose, layout, blocked);

    const request = (path, options = {}) => api(path, {
      ...options,
      headers: { ...(options.headers || {}), "X-BrowseRP-Account": accountId }
    });
    const post = body => request("/api/me/messages", { method: "POST", body: JSON.stringify(body) });
    const current = () => isCurrent() && section.isConnected;
    const setStatus = (message, error = false) => {
      if (!current()) return;
      status.textContent = message;
      status.dataset.error = String(error);
    };
    let inbox = null, activeId = "", messages = [], nextBeforeId = null;
    let conversationCursor = null;
    let overviewRequest = 0, threadRequest = 0, initialLink = true;

    function showConversations() {
      conversationList.replaceChildren();
      const rows = Array.isArray(inbox?.conversations) ? inbox.conversations : [];
      if (!rows.length) {
        conversationList.append(make("p", "member-inbox-empty", "No conversations yet."));
      }
      for (const row of rows) {
        const button = action("", "member-inbox-conversation");
        button.setAttribute("aria-label", `Open conversation with ${row.displayName || row.username}`);
        if (row.id === activeId) button.setAttribute("aria-current", "true");
        const name = make("strong", "", row.displayName || row.username);
        const handle = make("small", "", `@${row.username}`);
        const meta = make("span", "", date(row.lastMessageAt));
        button.append(name, handle, meta);
        if (Number(row.unread) > 0) button.append(make("b", "member-inbox-unread", `${row.unread} unread`));
        button.addEventListener("click", () => openThread(row.id));
        conversationList.append(button);
      }
      const unread = Number(inbox?.unread) || 0;
      olderConversations.hidden = !conversationCursor;
      setStatus(unread ? `${unread} unread message${unread === 1 ? "" : "s"}.` : "No unread messages.");
    }

    function showBlocked() {
      blockedList.replaceChildren();
      const rows = Array.isArray(inbox?.blockedMembers) ? inbox.blockedMembers : [];
      if (!rows.length) blockedList.append(make("p", "member-inbox-empty", "You have not blocked anyone."));
      for (const row of rows) {
        const item = make("div", "member-inbox-blocked-row");
        const unblock = action("Unblock");
        unblock.addEventListener("click", async () => {
          unblock.disabled = true;
          try {
            await post({ action: "block", username: row.username, blocked: false });
            toast(`Unblocked @${row.username}.`);
            await loadInbox();
            if (activeId) await openThread(activeId);
          } catch (error) { setStatus(error.message, true); unblock.disabled = false; }
        });
        item.append(make("span", "", `${row.displayName || row.username} (@${row.username})`), unblock);
        blockedList.append(item);
      }
    }

    async function loadInbox() {
      const requestId = ++overviewRequest;
      try {
        const payload = await request("/api/me/messages");
        if (!current() || requestId !== overviewRequest) return;
        inbox = payload.inbox || {};
        conversationCursor = inbox.nextBeforeId || null;
        policy.value = inbox.contactPolicy === "nobody" ? "nobody" : "members";
        composeSend.disabled = policy.value === "nobody";
        showConversations(); showBlocked();
        if (initialLink) {
          initialLink = false;
          const url = new URL(location.href);
          const linkedThread = url.searchParams.get("thread");
          const linkedMember = url.searchParams.get("message");
          if (linkedThread) await openThread(linkedThread);
          else if (usernamePattern.test(linkedMember || "")) {
            recipient.value = linkedMember;
            recipient.focus({ preventScroll: true });
          }
        }
      } catch (error) { setStatus(error.message, true); }
    }

    olderConversations.addEventListener("click", async () => {
      if (!conversationCursor) return;
      const requestId = ++overviewRequest;
      olderConversations.disabled = true;
      try {
        const payload = await request(`/api/me/messages?beforeConversation=${encodeURIComponent(conversationCursor)}`);
        if (!current() || requestId !== overviewRequest) return;
        const page = payload.inbox || {};
        const seen = new Set((inbox.conversations || []).map(row => row.id));
        inbox.conversations.push(...(Array.isArray(page.conversations) ? page.conversations : []).filter(row => !seen.has(row.id)));
        conversationCursor = page.nextBeforeId || null;
        showConversations();
      } catch (error) { setStatus(error.message, true); }
      finally { if (current()) olderConversations.disabled = false; }
    });

    function updateThreadLink(id) {
      const url = new URL(location.href);
      url.searchParams.delete("message");
      url.searchParams.set("thread", id);
      url.hash = "inbox";
      history.replaceState(null, "", url);
    }

    function showReportForm(item, message) {
      const form = make("form", "member-inbox-report");
      const label = make("label");
      label.append(make("span", "", "Why are you reporting this message?"));
      const category = make("select");
      for (const [value, title] of [["harassment", "Harassment"], ["spam", "Spam"], ["unsafe-content", "Unsafe content"], ["threat", "Threat"]]) {
        const option = make("option", "", title); option.value = value; category.append(option);
      }
      label.append(category);
      const detailsLabel = make("label");
      detailsLabel.append(make("span", "", "Details for staff (20–800 characters)"));
      const details = make("textarea");
      details.required = true; details.minLength = 20; details.maxLength = 800; details.rows = 3;
      detailsLabel.append(details);
      const submit = make("button", "small-button", "Send report");
      submit.type = "submit";
      const cancel = action("Cancel");
      cancel.addEventListener("click", () => form.remove());
      form.append(label, detailsLabel, submit, cancel);
      form.addEventListener("submit", async event => {
        event.preventDefault();
        submit.disabled = true;
        try {
          await post({ action: "report", messageId: message.id, category: category.value, details: details.value });
          form.remove(); toast("Report sent to staff.");
        } catch (error) { setStatus(error.message, true); submit.disabled = false; }
      });
      item.append(form);
      details.focus();
    }

    function renderThread(thread) {
      threadHeader.replaceChildren();
      threadContent.replaceChildren();
      const title = make("div");
      title.append(make("h3", "", thread.displayName || thread.username), make("p", "", `@${thread.username}`));
      const blockButton = action(thread.blockedByMe ? "Unblock" : "Block member");
      blockButton.addEventListener("click", async () => {
        blockButton.disabled = true;
        try {
          await post({ action: "block", username: thread.username, blocked: !thread.blockedByMe });
          toast(thread.blockedByMe ? "Member unblocked." : "Member blocked.");
          await loadInbox();
          await openThread(activeId);
        } catch (error) { setStatus(error.message, true); blockButton.disabled = false; }
      });
      threadHeader.append(title, blockButton);
      const older = action("Older messages");
      older.hidden = !nextBeforeId;
      older.addEventListener("click", async () => {
        const before = nextBeforeId;
        older.disabled = true;
        try {
          const payload = await request(`/api/me/messages?thread=${encodeURIComponent(activeId)}&before=${encodeURIComponent(before)}`);
          if (!current() || activeId !== thread.id) return;
          const page = payload.thread || {};
          messages = [...(Array.isArray(page.messages) ? page.messages : []), ...messages];
          nextBeforeId = page.nextBeforeId || null;
          renderThread(thread);
        } catch (error) { setStatus(error.message, true); older.disabled = false; }
      });
      threadContent.append(older);
      const list = make("ol", "member-inbox-messages");
      for (const message of messages) {
        const item = make("li", `member-inbox-message${message.fromMe ? " from-me" : ""}`);
        item.append(make("p", "", content(message.body)), make("time", "", date(message.createdAt)));
        if (message.fromMe && message.status === "pending_review") item.append(make("small", "member-inbox-review-state", "Pending review · Not delivered yet"));
        if (message.fromMe && message.status === "blocked") item.append(make("small", "member-inbox-review-state", `Not delivered · ${content(message.reviewReason) || "This message was blocked."}`));
        if (!message.fromMe) {
          const report = action("Report", "member-inbox-report-toggle");
          report.addEventListener("click", () => {
            if (item.querySelector(".member-inbox-report")) return;
            showReportForm(item, message);
          });
          item.append(report);
        }
        list.append(item);
      }
      threadContent.append(list);
      if (thread.blockedByMe) {
        threadContent.append(make("p", "member-inbox-help", "You blocked this member. Unblock them to reply."));
      } else if (!thread.canReply) {
        threadContent.append(make("p", "member-inbox-help", "Replies are unavailable for this conversation."));
      } else {
        const reply = make("form", "member-inbox-reply");
        const label = make("label");
        label.append(make("span", "", "Reply"));
        const text = make("textarea");
        text.required = true; text.maxLength = 1000; text.rows = 3;
        label.append(text);
        const send = make("button", "button button-primary", "Send reply");
        send.type = "submit";
        reply.append(label, send);
        reply.addEventListener("submit", async event => {
          event.preventDefault();
          send.disabled = true;
          try {
            const payload = await post({ action: "send", username: thread.username, body: text.value });
            toast(payload.result?.status === "delivered" ? "Message sent." : "Message submitted for review. The recipient cannot see it yet.");
            await loadInbox();
            await openThread(activeId);
          } catch (error) { setStatus(error.message, true); send.disabled = false; }
        });
        threadContent.append(reply);
      }
    }

    async function openThread(id) {
      const requestId = ++threadRequest;
      try {
        const payload = await request(`/api/me/messages?thread=${encodeURIComponent(id)}`);
        if (!current() || requestId !== threadRequest) return;
        const thread = payload.thread || {};
        activeId = thread.id;
        if (!activeId) throw new Error("Conversation unavailable.");
        messages = Array.isArray(thread.messages) ? thread.messages : [];
        nextBeforeId = thread.nextBeforeId || null;
        updateThreadLink(activeId);
        renderThread(thread);
        showConversations();
        await post({ action: "read", conversationId: activeId });
        if (current() && requestId === threadRequest) await loadInbox();
      } catch (error) { setStatus(error.message, true); }
    }

    refreshButton.addEventListener("click", () => loadInbox());
    savePolicy.addEventListener("click", async () => {
      savePolicy.disabled = true;
      try {
        await post({ action: "policy", policy: policy.value });
        toast("Contact setting saved.");
        await loadInbox();
        if (activeId) await openThread(activeId);
      } catch (error) { setStatus(error.message, true); savePolicy.disabled = false; }
      finally { if (current()) savePolicy.disabled = false; }
    });
    compose.addEventListener("submit", async event => {
      event.preventDefault();
      const name = recipient.value.trim().toLowerCase();
      if (!usernamePattern.test(name)) { setStatus("Enter a valid member username.", true); return; }
      composeSend.disabled = true;
      try {
        const payload = await post({ action: "send", username: name, body: composeText.value });
        if (!current()) return;
        composeText.value = "";
        toast(payload.result?.status === "delivered" ? "Message sent." : "Message submitted for review. The recipient cannot see it yet.");
        await loadInbox();
        await openThread(payload.result.conversationId);
      } catch (error) { setStatus(error.message, true); }
      finally { if (current()) composeSend.disabled = false; }
    });
    queueMicrotask(() => { if (current()) loadInbox(); });
    return section;
  }

  window.BrowseRPMemberInbox = { mount };
})();
