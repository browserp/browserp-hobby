import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";

const source = readFileSync(new URL("../public/public-comments.js", import.meta.url), "utf8");
const css = readFileSync(new URL("../public/member-badges.css", import.meta.url), "utf8");
const serverPage = readFileSync(new URL("../public/server.html", import.meta.url), "utf8");

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
      badges: [{ kind: "browserp_staff", label: "BrowseRP Staff", description: "BrowseRP Staff", iconKey: "browserp-rp-mark" }, { kind: "verified_owner", label: "Verified Server Owner", description: "Reviewed control", iconKey: "shield-check" }],
      staffRole: "Moderator",
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
    assert.deepEqual([...item.querySelector(".comment-badges-v3").children].map(badge => [badge.dataset.kind, badge.textContent]), [["browserp_staff", "BrowseRP Staff"], ["staff_rank", "Moderator"], ["verified_owner", "Verified Server Owner"]]);
    const staff = item.querySelector('[data-kind="browserp_staff"]');
    assert.equal(staff.getAttribute("aria-label"), "BrowseRP Staff"); assert.equal(staff.title, "An active member of the BrowseRP staff team.");
    assert.equal(staff.querySelector("img").getAttribute("src"), "/browserp-mark-v3.png"); assert.equal(staff.querySelector("img").alt, ""); assert.equal(staff.querySelector("img").getAttribute("aria-hidden"), "true");
    assert.equal(item.querySelector('[data-kind="staff_rank"]').getAttribute("aria-label"), "BrowseRP staff rank: Moderator");
    assert.match(item.querySelector('[data-kind="verified_owner"]').title, /not a safety or quality guarantee/);
    assert.match(item.querySelector(".comment-edited-v3").textContent, /Edited/);
    assert.equal(item.querySelector(".comment-edited-v3 time").dateTime, "2026-09-08T11:05:00.000Z");
    assert.equal(item.querySelector(".comment-parent-v3 strong").textContent, "Morgan Reed");
    assert.equal(item.querySelector(".comment-parent-v3 p").textContent, "The original helpful detail");
    assert.equal(item.querySelector(".comment-body-v3").textContent, "Useful server detail <img src=x onerror=alert(1)>");
    assert.equal(item.querySelector(".comment-body-v3 img"), null);
    assert.equal(item.querySelector("[data-comment-reply-v3]").dataset.commentReplyV3, "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
  } finally { dom.window.close(); }
});

test("canonical badges have fixed wording, priority, deduplication and accessible overflow", () => {
  const dom = harness();
  try {
    const item = dom.window.BrowseRPPublicComments.render({
      author: "Badge fixture",
      staffRole: 'Head Admin <img src=x onerror="alert(1)">',
      badges: [
        { kind: "new_joiner", label: "Forged owner label" },
        { kind: "first_500", label: "First 500" },
        { kind: "community_helper", label: "<img src=x>" },
        { kind: "first_100", label: "First 100" },
        { kind: "discord_verified_email", label: "Identity verified" },
        { kind: "verified_owner", label: "Guaranteed safe" },
        { kind: "browserp_staff", label: "Site owner" },
        { kind: "verified_owner", label: "Duplicate" }
      ],
      body: "Badges stay server-derived and display-only."
    });
    const badges = item.querySelector(".comment-badges-v3");
    assert.deepEqual([...badges.children].map(badge => [badge.dataset.kind, badge.textContent]), [
      ["browserp_staff", "BrowseRP Staff"],
      ["staff_rank", 'Head Admin <img src=x onerror="alert(1)">'],
      ["verified_owner", "Verified Server Owner"],
      ["discord_verified_email", "Verified Member"],
      ["overflow", "+3"]
    ]);
    assert.equal(badges.querySelectorAll("img").length, 1);
    assert.equal(badges.querySelector('[data-kind="staff_rank"] img'), null);
    assert.equal(badges.querySelector('[data-kind="first_500"]'), null, "First 100 supersedes First 500 before the cap");
    assert.equal(badges.querySelector('[data-kind="overflow"]').tabIndex, 0);
    assert.equal(badges.querySelector('[data-kind="overflow"]').getAttribute("aria-label"), "3 more badges: First 100, Community Helper, New Joiner");
    assert.equal(badges.querySelector('[data-kind="overflow"]').title, "First 100, Community Helper, New Joiner");
    assert.doesNotMatch(badges.textContent, /Forged|Guaranteed|Identity verified|Duplicate/);
  } finally { dom.window.close(); }
});

test("rank never creates staff identity and unknown badges are ignored", () => {
  const dom = harness();
  try {
    const first = dom.window.BrowseRPPublicComments.render({ staffRole: "Owner", badges: [{ kind: "first_500" }, { kind: "first_100" }, { kind: "unknown" }], body: "Hello" });
    assert.deepEqual([...first.querySelectorAll("[data-kind]")].map(item => [item.dataset.kind, item.textContent]), [["first_100", "First 100"]]);
    assert.equal(first.querySelector('[data-kind="staff_rank"]'), null);
    const invalid = dom.window.BrowseRPPublicComments.render({ staffRole: "Moderator", badges: [{ kind: "staff" }, { kind: "server_owner" }, null, "browserp_staff"], body: "Hello" });
    assert.equal(invalid.querySelector(".comment-badges-v3"), null);
  } finally { dom.window.close(); }
});

test("server comments load the scoped badge stylesheet with explicit dark and light theme treatment", () => {
  assert.match(serverPage, /<link rel="stylesheet" href="\/member-badges\.css\?v=1"><script src="\/public-comments\.js\?v=2\.23\.0" defer><\/script>/);
  for (const kind of ["browserp_staff", "verified_owner", "discord_verified_email", "first_100", "first_500", "community_helper", "new_joiner"]) assert.match(css, new RegExp(`data-kind=["']${kind}["']`));
  assert.match(css, /:root\[data-theme="light"\] \.comment-badges-v3/);
  assert.doesNotMatch(source, /innerHTML|insertAdjacentHTML|\.src\s*=\s*badge|badge\.label/);
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
