# Staff duty and work sessions

Implemented locally in `lib/staff-duty.js` and migration `20260908100259_explicit_staff_duty_sessions.sql`. Migration application, router mounting, UI integration and live verification are separate release steps.

## Router integration

```js
import { staffDuty } from "../lib/staff-duty.js";

"admin/duty": endpoint(["GET", "POST"], async (req, res) =>
  ok(res, await staffDuty(req, res))),
```

Use the normal private JSON response (`ok`), never `publicJson`. All requests must carry `X-BrowseRP-Account` with the current session's account ID. POST also requires the existing same-origin and CSRF protections. Every database operation independently requires `staff_authenticator_access()`: current authorized single-Discord staff identity, current unrestricted Auth session and verified TOTP. No service credential handles these records.

## Read contract

`GET /api/admin/duty?view=self|team|availability`

- `view=self` is the default and returns only the caller's work sessions. No management permission is needed.
- `view=team` requires existing `staff.manage` permission, including its deny overrides. There is no additional owner-role condition. Optional `userId=<UUID>` restricts the result to one staff member.
- `view=availability` returns explicit statuses for active staff to any authorized staff member. It includes no work-session details or hours. It does not change the public staff roster or its browser `online` boolean.
- `from` and `to` accept ISO timestamps with a time zone. Defaults cover the preceding 30 days; ranges must be positive and at most 93 days. The interval is `[from,to)`.
- `limit` is 1–100, default 25. Sessions use the returned `next.before` and `next.beforeId` together. Preserve the timestamp exactly; PostgreSQL may return microseconds. Keep `from` and `to` unchanged for subsequent pages.
- Availability and per-person team totals have their own UUID cursor: use returned `nextAfterUserId` as `afterUserId`. Sessions and team-total pages are independent; `afterUserId` never filters the overall totals.

Self/team responses:

```text
{
  view, from, to, asOf, canManageTeam,
  duty: {availability, updatedAt, openSession: Session|null},
  sessions: Session[], next: {before,beforeId}|null,
  totals: {confirmedSeconds,pendingReviewCount,openSessionCount},
  teamTotals: [{userId,displayName,confirmedSeconds,pendingReviewCount}]|null,
  nextAfterUserId: UUID|null
}
Session = {
  id,userId,displayName,startedAt,endedAt,status,version,
  needsReview,confirmedSeconds
}
```

Availability response: `{view,availability:[{userId,displayName,availability,updatedAt}],nextAfterUserId,canManageTeam,asOf}`. Explicit availability values are `available`, `away`, `off_duty`; absent choices default to `off_duty`. Display `updatedAt` when recency matters. Browser activity does not refresh this timestamp or imply availability.

Session `confirmedSeconds` covers that complete confirmed interval. Aggregate totals clip confirmed intervals to the requested range and are independent of pagination. Open sessions and sessions needing review contribute **zero** confirmed time. They must be shown separately from completed hours; do not derive credited hours from `now - startedAt`.

## Mutation contract

Every POST requires a fresh UUID `requestKey` for a new user intent. Retry an uncertain request with the **same key and exactly the same body**; it returns its original result without another write or audit. Reusing the key with different values returns 409. Refresh the read view after success because a replay is a historical result. Authorization is rechecked before any replay.

| action | Additional fields | Effect |
| --- | --- | --- |
| `set_availability` | `availability` | Sets the caller's explicit status; never starts or stops a work session. |
| `clock_in` | None | Creates one open session and sets Available. If a session is already open, returns it without changing its start time or current availability. |
| `clock_out` | `sessionId`, `version` | Closes that exact caller-owned session and sets Off duty. A repeated close cannot close a newer session. |
| `confirm_session` | `sessionId`, `version`, `endedAt`, `reason`, `confirmed:true` | Caller confirms the actual end of their own stale/unreviewed session. Start time remains fixed. |
| `correct_session` | `sessionId`, `version`, `startedAt`, `endedAt`, `reason`, `confirmed:true` | Staff management corrects either person's actual interval, including resolving a stale open session. |

Mutation response: `{duty,session:Session|null,canManageTeam,changed}`. `duty` always belongs to the caller, even when management corrects another person's `session`. Mutations accept no target account override from the client. Normal version conflicts return 409 with a refresh instruction.

Open sessions become `needsReview:true` after 12 hours. Clocking out such a session records the observed close time with status `needs_review`, without crediting it. The user must confirm the actual end; self confirmation of more than 24 hours requires management correction. Management can explicitly confirm legitimate longer intervals without an arbitrary duration cap. Stale flags never guess an end time, auto-close or award endless hours.

All corrections and stale-session confirmations require a plain-text reason of 10–500 characters and explicit confirmation. End-before-start, future/nonfinite timestamps and overlaps with another session are rejected. Zero-length corrections are allowed to void a mistakenly started session with a recorded reason. Only management can correct otherwise confirmed sessions.

## Storage and safeguards

`private.staff_duty_state`, `private.staff_work_sessions` and `private.staff_duty_requests` have RLS enabled and no direct grants to anonymous, authenticated or service roles. Guarded RPCs provide the only application access. Records are account-scoped with profile deletion cascades; any final account-erasure executor must account for these new personal-data tables and separately handle retained audit evidence.

Each mutation serializes the actor's request key and the affected member's sessions within its database transaction. A partial unique index also enforces one open session per person. Start/end timestamps are chosen after acquiring the affected-member lock. Version checks prevent stale corrections. The state change, idempotency result and `staff_audit_events` before/after record commit together; audit failure rolls the change back. Work records remain separate from security activity logs and page visits.

The focused tests exercise real disposable PostgreSQL guards/RLS, duplicate requests, unique-open enforcement, date/overlap/correction rules, range totals, cursors, deny overrides and audit rollback. The HTTP tests check account binding, origin/CSRF, MFA, input bounds, token forwarding and database-denial propagation. The disposable test engine serializes connections; these tests do not establish multi-host load or live browser verification.
