# Production reliability check — 8 September 2026

Read-only check at approximately **10:16–10:18 UTC**, using Vercel runtime-log aggregates and aggregate Supabase scheduler/source state. Production deployment: `dpl_7u3yyHar2mzSgTdrCiobTMbsEmAM`; project: `prj_WtW7OzITrfXRE7qkI1ZUZAWNTcKx`. Source comparison used main-worktree base `f479a7e130d80974b1d7bdb3166e4fae41fd21d4`. No crawler, manual source refresh, private-member query, mutation or test batch was run.

## Available log coverage

Vercel queries requested the preceding 24 hours. Deployment-scoped and production-project grouping returned no 5xx paths, no 4xx paths and no error/fatal groups. The status grouping returned 151 HTTP-200 entries and noted an additional unspecified status category. Runtime-error clusters for `/api/servers` and `/api/internal/server-status` were empty. These are the connector's available results, not a complete request-volume or zero-failure guarantee.

## Scheduler and source observations

At **10:16:27 UTC**, all 1,440 recorded application refresh runs in the preceding day had completed. None was unfinished for more than two minutes; no run had deferred checks. The enabled once-per-minute scheduler last dispatched at 10:16:00, received HTTP 200 and did not time out. A separate **10:18:01 UTC** cron aggregate showed 1,440 successful dispatches in the preceding day.

Six application runs each recorded one failed source-processing check, in the 20:00, 21:00 and 23:00 UTC hours on 7 September and the 03:00, 04:00 and 05:00 UTC hours on 8 September. The latest was **05:12 UTC**. In the last-hour snapshot, failed and deferred counters were zero, and the longest completed run was 4,658 ms. One run had just started at the snapshot boundary; it was not an overdue run.

The 10:16 source snapshot showed:

| Platform | Registered published sources | Fresh observations | Marked unavailable |
| --- | ---: | ---: | ---: |
| FiveM | 40 | 29 | 5 |
| RedM | 20 | 12 | 8 |
| Minecraft | 3 | 2 | 1 |

Freshness and unavailability are different classifications; remaining sources can have stale observations without a current unavailable marker. The unavailable Minecraft source's last successful observation was **02:03:01 UTC**. No private addresses or source identifiers were retrieved for this check.

The latest completed run in the 10:18 snapshot started at **10:17:00 UTC**: 63 requested, 38 refreshed, 23 unchanged, 2 unavailable, zero failed, zero deferred; duration 3,353 ms. Across the last hour, 485 unavailable source outcomes were recorded over repeated checks; this is not 485 distinct communities.

## Interpretation and limits

`lib/fivem-workflow.js` and `lib/minecraft-workflow.js` classify upstream status-fetch failures as unavailable, preserving the distinction from rejected observation saves. `lib/status-refresh-workflow.js` counts thrown processing failures separately. Completed partial refreshes can legitimately return HTTP 200. Upstream unavailability does not by itself establish an application defect or a zero-player server.

No current application failure or stalled scheduler was established. The six earlier processing failures cannot be assigned a reproducible root cause from these summaries: the worker catch increments a counter without retaining a safe error classification. Distinguishing a source outage, timeout, upstream rate limit and observation-save failure would need bounded platform/error-code diagnostics or a later focused incident, not speculative scraper changes. Raw credentials, IPs, private text and upstream response bodies should remain excluded.

This record is a dated operational observation. It does not establish physical-device performance, complete traffic coverage, current member journeys or the success of a later release.
