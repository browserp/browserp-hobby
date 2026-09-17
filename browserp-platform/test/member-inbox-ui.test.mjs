import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";

const source = readFileSync(new URL("../public/member-inbox.js", import.meta.url), "utf8");
const accountId = "00000000-0000-4000-8000-000000000001";
const threadId = "10000000-0000-4000-8000-000000000001";
const messageId = "20000000-0000-4000-8000-000000000001";
const tick = async () => { for (let i = 0; i < 7; i++) await new Promise(resolve => setImmediate(resolve)); };
const overview = () => ({ inbox: { contactPolicy: "members", unread: 1,
  conversations: [{ id: threadId, username: "bob_rp", displayName: "Bob", unread: 1, lastMessageAt: "2026-09-17T12:00:00Z" }],
  blockedMembers: [] } });
const thread = () => ({ thread: { id: threadId, username: "bob_rp", displayName: "Bob", blockedByMe: false, canReply: true,
  nextBeforeId: null, messages: [{ id: messageId, body: "<img src=x onerror=alert(1)> hello", fromMe: false,
    createdAt: "2026-09-17T12:00:00Z" }] } });

function harness(t, query, handler) {
  const dom = new JSDOM("<body></body>", { url: `https://browserp.test/dashboard${query}`, runScripts: "outside-only" });
  t.after(() => dom.window.close());
  dom.window.eval(source);
  const calls = [], notices = [];
  const api = async (path, options = {}) => {
    calls.push({ path, options, body: options.body ? JSON.parse(options.body) : null });
    if (handler) return handler(path, options);
    if (path === "/api/me/messages" && !options.method) return overview();
    if (path.startsWith("/api/me/messages?thread=")) return thread();
    if (options.method === "POST" && JSON.parse(options.body).action === "send") return { result: { conversationId: threadId, status: "pending_review" } };
    if (options.method === "POST") return { result: {} };
    throw new Error(`Unexpected request ${path}`);
  };
  const section = dom.window.BrowseRPMemberInbox.mount({
    api, accountId, toast: text => notices.push(text), isCurrent: () => true
  });
  dom.window.document.body.append(section);
  return { w: dom.window, section, calls, notices };
}

test("message deep links open only the requested thread, mark it read and render text safely", async t => {
  const h = harness(t, `?thread=${threadId}#inbox`);
  await tick();
  assert.equal(h.section.id, "inbox");
  assert.match(h.section.textContent, /Bob/);
  assert.equal(h.section.querySelector(".member-inbox-message img"), null);
  assert.match(h.section.querySelector(".member-inbox-message p").textContent, /<img src=x/);
  assert.deepEqual(h.calls.filter(call => call.options.method === "POST").map(call => call.body.action), ["read"]);
  assert.ok(h.calls.every(call => call.options.headers["X-BrowseRP-Account"] === accountId));
  assert.equal(h.w.location.search, `?thread=${threadId}`);
});

test("compose, contact policy, blocking and recipient report are real private actions", async t => {
  const h = harness(t, "?message=bob_rp#inbox");
  await tick();
  const recipient = h.section.querySelector('.member-inbox-compose input[name="username"]');
  assert.equal(recipient.value, "bob_rp");
  const compose = h.section.querySelector(".member-inbox-compose");
  compose.querySelector("textarea").value = "Hello Bob";
  compose.dispatchEvent(new h.w.Event("submit", { bubbles: true, cancelable: true }));
  await tick();
  assert.equal(h.calls.some(call => call.body?.action === "send" && call.body.username === "bob_rp"), true);
  const report = h.section.querySelector(".member-inbox-report-toggle");
  report.click();
  const form = h.section.querySelector(".member-inbox-report");
  form.querySelector("textarea").value = "This message should be checked by the staff team.";
  form.dispatchEvent(new h.w.Event("submit", { bubbles: true, cancelable: true }));
  await tick();
  assert.equal(h.calls.some(call => call.body?.action === "report" && call.body.messageId === messageId), true);
  h.section.querySelector(".member-inbox-thread-head button").click();
  await tick();
  assert.equal(h.calls.some(call => call.body?.action === "block" && call.body.blocked === true), true);
  h.section.querySelector(".member-inbox-policy select").value = "nobody";
  [...h.section.querySelectorAll(".member-inbox-settings button")][0].click();
  await tick();
  assert.equal(h.calls.some(call => call.body?.action === "policy" && call.body.policy === "nobody"), true);
  assert.ok(h.notices.some(note => note.includes("submitted for review")));
  assert.ok(h.notices.includes("Report sent to staff."));
});

test("stale account rendering cannot install a private inbox or follow a thread", async t => {
  const h = harness(t, `?thread=${threadId}#inbox`, async () => new Promise(resolve => {
    setImmediate(() => resolve(overview()));
  }));
  h.section.remove();
  await tick();
  assert.equal(h.section.querySelectorAll(".member-inbox-conversation").length, 0);
  assert.equal(h.calls.some(call => call.path.includes("?thread=")), false);
});

test("saving Nobody immediately removes the open reply form and reopening restores it", async t => {
  let contactPolicy = "members";
  const h = harness(t, `?thread=${threadId}#inbox`, async (path, options) => {
    if (path === "/api/me/messages" && !options.method) return { inbox: { ...overview().inbox, contactPolicy } };
    if (path.startsWith("/api/me/messages?thread=")) return { thread: { ...thread().thread, canReply: contactPolicy === "members" } };
    if (options.method === "POST") {
      const body = JSON.parse(options.body);
      if (body.action === "policy") contactPolicy = body.policy;
      return { result: {} };
    }
    throw new Error(`Unexpected request ${path}`);
  });
  await tick();
  assert.ok(h.section.querySelector(".member-inbox-reply"));
  const choice = h.section.querySelector(".member-inbox-policy select");
  const save = h.section.querySelector(".member-inbox-settings button");
  choice.value = "nobody"; save.click(); await tick();
  assert.equal(h.section.querySelector(".member-inbox-reply"), null);
  assert.match(h.section.textContent, /Replies are unavailable/);
  choice.value = "members"; save.click(); await tick();
  assert.ok(h.section.querySelector(".member-inbox-reply"));
});
