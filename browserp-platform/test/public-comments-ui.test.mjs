import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";

const source = readFileSync(new URL("../public/public-comments.js", import.meta.url), "utf8");

function harness() {
  const dom = new JSDOM("<!doctype html><body></body>", { url: "https://browserp.test", runScripts: "outside-only" });
  dom.window.eval(source);
  return dom;
}

test("published comments show the approved avatar, author, precise time and wrapped body as text", () => {
  const dom = harness();
  try {
    const item = dom.window.BrowseRPPublicComments.render({
      author: "Alex Rivers",
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      avatarUrl: "https://cdn.discordapp.com/avatars/member/reviewed.png",
      createdAt: "2026-09-08T10:45:00.000Z",
      editedAt: "2026-09-08T11:05:00.000Z",
      badges: [{ kind: "staff", label: "Moderator" }, { kind: "server_owner", label: "Server owner" }],
      parent: { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", author: "Morgan Reed", body: "The original helpful detail", createdAt: "2026-09-08T09:30:00.000Z", unavailable: false },
      body: "Useful server detail <img src=x onerror=alert(1)>"
    });
    const image = item.querySelector("img.comment-avatar-v3");
    assert.equal(image.src, "https://cdn.discordapp.com/avatars/member/reviewed.png");
    assert.equal(image.alt, "");
    assert.equal(image.referrerPolicy, "no-referrer");
    assert.equal(item.querySelector("strong").textContent, "Alex Rivers");
    assert.equal(item.querySelector("time").dateTime, "2026-09-08T10:45:00.000Z");
    assert.match(item.querySelector("time").textContent, /8 Sept 2026/);
    assert.deepEqual([...item.querySelectorAll(".comment-badge-v3")].map(badge => [badge.dataset.kind, badge.textContent]), [["staff", "Moderator"], ["server_owner", "Server owner"]]);
    assert.match(item.querySelector(".comment-edited-v3").textContent, /Edited/);
    assert.equal(item.querySelector(".comment-edited-v3 time").dateTime, "2026-09-08T11:05:00.000Z");
    assert.equal(item.querySelector(".comment-parent-v3 strong").textContent, "Morgan Reed");
    assert.equal(item.querySelector(".comment-parent-v3 p").textContent, "The original helpful detail");
    assert.equal(item.querySelector(".comment-body-v3").textContent, "Useful server detail <img src=x onerror=alert(1)>");
    assert.equal(item.querySelector(".comment-body-v3 img"), null);
    assert.equal(item.querySelector("[data-comment-reply-v3]").dataset.commentReplyV3, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
  } finally { dom.window.close(); }
});

test("missing, invalid and failed avatars use initials without inventing badges", () => {
  const dom = harness();
  try {
    const missing = dom.window.BrowseRPPublicComments.render({ author: "Morgan Reed", createdAt: "not-a-date", body: "Hello" });
    assert.equal(missing.querySelector(".comment-initials-v3").textContent, "MR");
    assert.equal(missing.querySelector("time"), null);
    assert.equal(missing.querySelector("[class*=badge]"), null);

    const unedited = dom.window.BrowseRPPublicComments.render({ author: "Member", createdAt: "2026-09-08T10:45:00.000Z", editedAt: null, body: "Hello" });
    assert.equal(unedited.querySelector(".comment-edited-v3"), null, "a null editedAt never becomes a 1970 edit label");

    const invalid = dom.window.BrowseRPPublicComments.render({ author: "Member", avatarUrl: "javascript:alert(1)", body: "Hello" });
    assert.equal(invalid.querySelector("img"), null);
    assert.equal(invalid.querySelector(".comment-initials-v3").textContent, "M");

    const failed = dom.window.BrowseRPPublicComments.render({ author: "Taylor Lane", avatarUrl: "https://example.com/avatar.png", body: "Hello" });
    const image = failed.querySelector("img");
    image.dispatchEvent(new dom.window.Event("error"));
    assert.equal(failed.querySelector("img"), null);
    assert.equal(failed.querySelector(".comment-initials-v3").textContent, "TL");

    const unavailable = dom.window.BrowseRPPublicComments.render({ author: "Member", body: "Reply", parent: { id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", unavailable: true }, badges: [{ kind: "verified", label: "Verified" }] });
    assert.equal(unavailable.querySelector(".comment-parent-unavailable-v3").textContent, "Earlier comment unavailable");
    assert.equal(unavailable.querySelector(".comment-badge-v3"), null, "unknown badges are never inferred or displayed");
  } finally { dom.window.close(); }
});
