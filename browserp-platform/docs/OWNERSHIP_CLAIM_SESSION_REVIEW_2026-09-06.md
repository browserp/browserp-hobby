# Ownership claim session correction

Integrated in the 2.17 release candidate. Prepared from commit 406d5688f6eb81d7e43790d5e027e95f07024ec4 in `/tmp/browserp-claim-session-fix/browserp-platform`. No production data, hosted account, browser session, schema or deployment was changed.

## Concrete correction

The original claim panel retained submitted private evidence after a `browserp:session-ended` event and after a refresh returned 401. The correction clears history, evidence links, CSRF, detached form values and pending attempts on session end or navigation. It aborts pending requests, ignores obsolete controller responses and older refresh responses (including 401), and requires a fresh page/session on BFCache restoration. The public detail controller now keeps and disposes the claim controller and passes the signed-in account identity.

Every authenticated `/api/server-claims` GET or POST now requires `X-BrowseRP-Account` to exactly match the current authenticated account. Anonymous public options accept an empty or omitted header; an old nonempty account is rejected. The response context returns the same account ID (or null for anonymous options). The browser checks that response before rendering any private data. Existing CSRF, current-member RPC authority, Discord proof, staff approval and rate limits remain in use.

A request action POST requires a UUIDv4 `Idempotency-Key`, forwarded as the existing database `p_request_id`. An uncertain submission preserves the exact original body and key and locks edits while allowing a safe retry or status refresh. A definite validation rejection preserves an editable draft; an already uncertain operation remains preserved on a later timeout/rate-limit reply. A confirmed pending claim clears the uncertain draft. No database migration is required: the current member claim function already binds replays to actor, key and original evidence.

## Validation

- 54/54 focused UI and real API-route tests passed: `/tmp/browserp-claims-focused-tests.log`.
- 16/16 disposable PostgreSQL member-security tests passed: `/tmp/browserp-claims-replay-db-tests.log`. The added test proves same-key replay returns the original claim, changed server/message/evidence is rejected, another actor receives a different claim, and a revoked session cannot replay.
- 8/8 public server-detail integration tests passed: `/tmp/browserp-claims-hook-tests.log`.
- Syntax/deployment checks passed: 179 JavaScript files; 11 API functions + 1 Node middleware: `/tmp/browserp-claims-syntax-tests.log`.
- `git diff --check` passed.
- Independent security review found no blocker; its retry-editability edge was fixed and tested.

These are controlled jsdom, HTTP route fixtures and local PostgreSQL checks. jsdom confirms the actual BFCache event handlers request `location.reload`; this does not claim a native BFCache or physical-device test. No real Discord authorization or claim submission was performed. Root retains the coordinated release/browser gate.

## Integration

Patch: `/tmp/browserp-claim-session.patch`
SHA-256: `a23565d9aa71e3338fbfc101a896d7d7d1dd664989adac0d37ebd01380eeba85`

Apply from the repository root, not the `browserp-platform` subdirectory, because the patch paths include `browserp-platform/`:

```
git apply --check /tmp/browserp-claim-session.patch
git apply /tmp/browserp-claim-session.patch
```

Eight files: `lib/claim-workflow.js`, `public/server-claims.js`, `public/browserp-v3.js`, new `test/claim-session-boundaries.test.mjs`, and updates to the four existing tests `fivem-claims-ui`, `member-connections`, `member-security-db`, `workflow-boundaries`. The public controller hunks are around the session-ended handler and server-detail claim mount; they do not overlap the advertising agent's hook after `await session()`.

Deploy API and UI together. A pre-release tab using the old contract will fail closed with a reload instruction; reloading fetches the new assets. No database or paid infrastructure step is needed.
