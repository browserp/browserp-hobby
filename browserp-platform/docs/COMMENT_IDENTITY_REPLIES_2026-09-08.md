# Comment identity and replies — 8 September 2026

This migration extends the existing public comment projection and adds a member reply RPC. It does not add a member comment-edit action, auto-publish replies or derive authority from names, provider metadata or Discord cosmetic roles. The migration has not been applied to a hosted database by this task.

## API contract

The existing `GET /api/servers?slug=...` response keeps its `engagement` object and all existing fields. Each published comment retains `id`, `body`, `createdAt`, `author` and `avatarUrl`, with these additions:

```json
{
  "editedAt": null,
  "badges": [
    { "kind": "staff", "label": "Moderator" },
    { "kind": "server_owner", "label": "Server owner" }
  ],
  "parent": {
    "id": "00000000-0000-4000-8000-000000000001",
    "author": "Parent author",
    "body": "A published parent comment.",
    "createdAt": "2026-09-08T10:00:00Z",
    "unavailable": false
  }
}
```

The example shows both possible badges; ordinary comments have `[]`. The staff label is the current active membership's `staff_roles.name`. Listing ownership is checked independently against `servers.owner_id`; a person can have both badges. Staff changes and ownership transfers affect subsequent database projections, subject to the route's existing cache lifetime. Badge text must be rendered as text, like comment content.

`editedAt` is null until the body actually changes after this migration. Moderation status, timestamps, parent assignment and other metadata changes preserve it. Historical `updated_at` values cannot distinguish body edits from moderation decisions and are not used to invent edit dates.

`parent` is null for a normal comment. A published parent on the same server supplies exactly the fields above. An existing parent that is hidden, rejected or pending review supplies only `{ "id": "...", "unavailable": true }`; no author, body or other private parent content is returned. The parent reference becomes null if that parent is deleted. Replies remain a flat list with their parent context; the projection does not recursively expand ancestor chains.

For a reply, retain the existing `POST /api/servers` comment action and add an optional `parentCommentId` UUID:

```json
{
  "action": "comment",
  "serverId": "00000000-0000-4000-8000-000000000002",
  "parentCommentId": "00000000-0000-4000-8000-000000000001",
  "body": "A useful reply to that comment."
}
```

The route owner should strictly validate `parentCommentId` when supplied, reject it on non-comment actions, preserve existing session/origin/CSRF/content/rate controls, and invoke:

```js
rpc("member_server_comment_reply", {
  p_server_id: serverId,
  p_parent_comment_id: parentCommentId,
  p_body: sanitizedText
}, session.accessToken)
```

The RPC returns `{ "id": "new-comment-uuid", "status": "pending_review", "parentCommentId": "parent-uuid" }`; retain the existing route response `{ "result": ... }` and HTTP 201. A missing, unpublished or foreign parent returns a generic HTTP 404 error. Body validation still requires 3–1,000 characters. Without `parentCommentId`, retain the unchanged four-argument `member_server_interaction` RPC for normal comments, votes and reports. No overload is introduced.

## Database and activation

Apply `20260908100413_comment_identity_and_replies.sql` only after the existing core/operations tables, current member guard, session-expiry guard and four-argument interaction function are present. The migration adds `server_comments.parent_comment_id` and `edited_at`, a same-server foreign key, and an edit-tracking trigger. It uses PostgreSQL's column-specific `ON DELETE SET NULL (parent_comment_id)` so deleting a parent preserves the child's required server ID.

The reply RPC checks the current unrestricted member, locks the eligible listing and published parent, then calls the existing interaction function once. That function alone consumes the account rate limit and creates the pending comment and moderation entry. Parent assignment is atomic with those writes. The new RPC is executable only by `authenticated`; raw comment access remains governed by the existing grants/RLS. Public projection grants remain unchanged.

Before release, verify the target schema/version and applied migration history, read back the new foreign key/trigger/RPC grants, and complete the coordinated API/frontend integration and preview checks. No hosted account, comment, moderation action or deployment was changed by this task.

The existing structured account-export collector explicitly projects comment fields and will not automatically include `parent_comment_id` or `edited_at`. Their inclusion needs coordination with the current privacy export work; this bounded migration does not replace that collector.

## Local verification

Bundled Node **24.19.0**, one worker and disposable PGlite: **11 tests passed, with no failures or skips**. The dedicated fixture executes the actual new migration and the existing member/session/rate functions without changing any shared test fixture.

```sh
node --test --test-concurrency=1 test/comment-identity-replies-db.test.mjs
```

The tests compare the complete original engagement fields before and after the migration; reject badge spoofing; follow current suspension, revocation, demotion, role names and ownership; verify exactly one pending comment, review entry and rate count; deny hidden/foreign parents, unavailable listings, invalid bodies and restricted sessions/accounts without writes; redact hidden parent content; preserve replies on parent deletion; and distinguish real body edits from moderation and forged timestamps. The original four-argument comment/vote/unvote/report behavior and shared rate cap remain intact. These isolated tests do not establish hosted concurrency or completed API/frontend integration.
