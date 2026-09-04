# Scheduled server status refresh

Published FiveM, RedM and Minecraft sources refresh independently of visitor traffic. Supabase Cron dispatches a POST every minute to the fixed production `/api/internal/server-status` route. The route uses the same reviewed-source adapters as the staff scraper and public detail pages.

The `scheduled_server_status_refresh` migration installs the schedule paused. It creates the random credential inside PostgreSQL, stores it in Vault, and stores only its SHA-256 digest in the private credential table. No credential belongs in an environment file, migration literal, browser script or deployment output. After the production route is deployed and its unauthenticated boundary is checked, activate the named job through an authorized database administration connection:

```sql
select cron.alter_job(jobid, active := true)
from cron.job where jobname = 'browserp-server-status-refresh';
```

The route accepts an empty JSON object and an authenticated scheduler credential. It obtains source identities only through service-only database functions. Anonymous and member Data API clients cannot claim or dispatch a refresh, read the Vault credential, or inspect queued request headers. A 55-second database lease prevents overlapping or repeated runs. Per-source claims, saves and failures also use 55-second cooldowns so ordinary short checks finish before the next one-minute tick; longer existing leases are preserved.

Hosted extension objects remain owned by `supabase_admin`: `service_role` retains its hosted Vault read grant, and pg_net retains SQL-level PUBLIC queue grants. The migration's postgres-run revocations do not remove those separate grantor's privileges. The verified HTTP boundary is that only `public` and `graphql_public` are exposed: requests for `net` or `vault` return 406/PGRST106, and no exposed function or view directly references those objects. Keep `net` and `vault` excluded from Data API exposure and never expose queue headers through a public wrapper.

Each run reads up to 100 due Cfx sources and 100 due Minecraft sources, ordered by the database due queue, with six concurrent source checks. Minecraft is checked first to avoid starvation by the larger Cfx group. New work stops after 40 seconds. A shared 45-second cancellation signal bounds source I/O, followed by a separate eight-second completion window within the route's 60-second limit. Cancellation does not turn an otherwise healthy source into an unavailable observation. Deferred work remains eligible for a later run.

Source timestamps retain the five-minute public freshness requirement. A verified zero remains zero; missing, failed or stale observations remain unavailable. The scheduler never extends freshness or invents player counts. Minecraft network-wide counts retain their network scope label. A successful retry with the same still-current timestamp clears an earlier failure without adding a duplicate snapshot or changing its timestamp; older observations cannot clear newer errors.

Cfx can return HTTP 200 and `fallback=false` with a source timestamp older than five minutes. Its published server implementation uses a normal three-minute listing heartbeat, while sampled API responses advertised cache lifetimes of 10 or 60 seconds. These are reporting cadence observations, not a guarantee that every source will always supply a live count. Keep upstream source age distinct from the scheduler's own completion time. [Official Cfx server implementation](https://github.com/citizenfx/fivem/blob/master/code/components/citizen-server-impl/src/GameServer.cpp#L1077)

## Read-only health checks

Run these queries using an authorized database administration connection. Do not select Vault secrets or HTTP request headers.

```sql
select started_at, finished_at, summary
from private.server_status_refresh_runs
order by started_at desc
limit 10;

select c.last_dispatched_at, c.last_request_id,
       r.status_code, r.timed_out, r.error_msg
from private.server_status_refresh_control c
left join net._http_response r on r.id = c.last_request_id;

select jobname, schedule, active
from cron.job
where jobname = 'browserp-server-status-refresh';
```

Run summaries retain seven days of bounded counters plus database-derived total, fresh and stale source counts. Freshness and upstream availability are different from successful scheduler dispatch: investigate unavailable upstream observations separately from missed or unfinished runs. To verify independence from visitors, observe more than five minutes of scheduled runs without opening detail pages or manually refreshing the scraper.

Disposable database tests validate application permissions, credential verification, leases and summaries using owner-created extension stand-ins. They do not reproduce hosted extension ownership or certify hosted ACL removal. Vault encryption, cron/HTTP transport, and Data API schema exclusions require live checks.
