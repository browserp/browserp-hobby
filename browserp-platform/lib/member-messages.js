import { ok } from "./api.js";
import { appUrl } from "./config.js";
import { contentWritePaused } from "./content-write-gate.js";
import { classifyContent } from "./content-classifier.js";
import { assertCsrf, assertSameOrigin, readBody } from "./http.js";
import { assessContent, sanitizePlainText } from "./moderation.js";
import { memberRateLimit, rateLimit } from "./rate-limit.js";
import { getSession, rpc } from "./supabase.js";

const USERNAME = /^[a-z0-9_]{3,30}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const fail = (message, status = 400) => Object.assign(new Error(message), { status });

function exact(body, names) {
  const keys = Object.keys(body);
  if (keys.length !== names.length || keys.some(key => !names.includes(key))) {
    throw fail("Check the message request.");
  }
}

function username(value) {
  const name = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!USERNAME.test(name)) throw fail("Choose a valid member.");
  return name;
}

function identifier(value, message = "Choose a valid conversation.") {
  if (typeof value !== "string" || !UUID.test(value)) throw fail(message);
  return value.toLowerCase();
}

function content(value, maximum, minimum = 1) {
  if (typeof value !== "string" || value.length > maximum
    || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) {
    throw fail("Check the message text.");
  }
  const text = sanitizePlainText(value, maximum);
  if (text.length < minimum) throw fail("Check the message text.");
  return text;
}

// No supplied user ID can select a sender or change the account being read.
// The database repeats the active-session, recipient and block checks.
export async function memberMessages(req, res) {
  res.setHeader("Cache-Control", "no-store");
  if (req.method === "POST") { assertSameOrigin(req); assertCsrf(req); }
  const session = await getSession(req, res, { required: true });
  if (req.headers?.["x-browserp-account"] !== session.user.id) {
    throw fail("Your account changed. Refresh before using messages.", 409);
  }
  const active = await rpc("member_connection_status_v2", {}, session.accessToken);
  if (active?.active !== true || active.userId !== session.user.id || !active.sessionId) {
    throw fail("Your sign-in expired. Sign in again to continue.", 401);
  }

  if (req.method === "GET") {
    await rateLimit(req, "member-inbox-read", 60, 300);
    const url = new URL(req.url || "/api/me/messages", appUrl(req));
    const thread = url.searchParams.get("thread");
    const before = url.searchParams.get("before");
    const beforeConversation = url.searchParams.get("beforeConversation");
    if (thread) {
      if (beforeConversation) throw fail("Choose one inbox page at a time.");
      const result = await rpc("member_message_thread", {
        p_conversation_id: identifier(thread),
        p_before_id: before ? identifier(before, "Choose a valid page.") : null
      }, session.accessToken);
      return ok(res, { thread: result });
    }
    if (before) throw fail("Choose a conversation first.");
    return ok(res, { inbox: await rpc("member_message_overview", {
      p_before_id: beforeConversation ? identifier(beforeConversation, "Choose a valid inbox page.") : null
    }, session.accessToken) });
  }

  const body = await readBody(req, 4 * 1024);
  if (typeof body.action !== "string") throw fail("Choose a message action.");
  if (body.action === "send") {
    exact(body, ["action", "username", "body"]);
    if (contentWritePaused(res)) return;
    const target = username(body.username);
    const text = content(body.body, 1000);
    await memberRateLimit(req, "member-message-send", 12, 300, session.user.id, 120);
    const result = await rpc("member_message_send", { p_username: target, p_body: text }, session.accessToken);
    const local = assessContent({ message: text });
    const signals = local.action === "accept" ? [] : [{ code: "message_content_rule", level: "review", reason: "The message needs a closer check." }];
    const assessment = await classifyContent({ kind: "message", text, signals });
    let checked = result;
    try {
      checked = await rpc("service_member_message_check", {
        p_id: result.messageId, p_sender: session.user.id, p_body: text, p_result: assessment
      }, undefined, { useSecret: true });
    } catch { /* Pending stays private until the content check can be recorded or staff reviews it. */ }
    return ok(res, { result: { ...result, status: checked.status } }, checked.status === "delivered" ? 201 : 202);
  }
  if (body.action === "read") {
    exact(body, ["action", "conversationId"]);
    await rateLimit(req, "member-message-read", 30, 300);
    const count = await rpc("member_message_mark_read", {
      p_conversation_id: identifier(body.conversationId)
    }, session.accessToken);
    return ok(res, { markedRead: count });
  }
  if (body.action === "policy") {
    exact(body, ["action", "policy"]);
    if (!["members", "nobody"].includes(body.policy)) throw fail("Choose who can message you.");
    await rateLimit(req, "member-message-policy", 10, 900);
    const result = await rpc("member_message_set_policy", { p_policy: body.policy }, session.accessToken);
    return ok(res, { result });
  }
  if (body.action === "block") {
    exact(body, ["action", "username", "blocked"]);
    if (typeof body.blocked !== "boolean") throw fail("Choose a block action.");
    await rateLimit(req, "member-message-block", 15, 900);
    const result = await rpc("member_message_set_block", {
      p_username: username(body.username), p_block: body.blocked
    }, session.accessToken);
    return ok(res, { result });
  }
  if (body.action === "report") {
    exact(body, ["action", "messageId", "category", "details"]);
    const messageId = identifier(body.messageId, "Choose a valid message.");
    if (!["harassment", "spam", "unsafe-content", "threat"].includes(body.category)) {
      throw fail("Choose a report reason.");
    }
    const details = content(body.details, 800, 20);
    await memberRateLimit(req, "member-message-report", 5, 900, session.user.id, 60);
    const result = await rpc("member_message_report", {
      p_message_id: messageId, p_category: body.category, p_details: details
    }, session.accessToken);
    return ok(res, { result }, 201);
  }
  throw fail("Choose a message action.");
}
