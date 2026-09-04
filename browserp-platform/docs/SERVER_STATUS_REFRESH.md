# Scheduled server status refresh

Published FiveM, RedM and Minecraft sources refresh independently of visitor traffic. Supabase Cron dispatches a POST every minute to the fixed production `/api/internal/server-status` route. The route uses the same reviewed-source adapters as the staff scraper and public detail pages.

The `scheduled_server_status_refresh` migration installs the schedule paused. It creates the random credential inside PostgreSQL, stores it in Vault, and stores only its SHA-256 digest in the private credential table. No credential belongs in an environment file, migration literal, browser script or deployment output. After the production route is deployed and its unauthenticated boundary is checked, activate the named job through an authorized database administration connection:

```sql
select cron.alter_job(jobid, active := true)
from cron.job where jobname = 'browserp-server-status-refresh';
```

The route accepts an empty JSON object and an authenticated scheduler credential. It obtains source identities only through service-only database functions. Public and member roles cannot claim a run, read the credential or inspect queued request headers. A 55-second database lease prevents overlapping or repeated runs. Existing per-source leases still apply.

Each run reads up to 100 due Cfx sources and 100 due Minecraft sources, ordered by the database due queue, with six concurrent source checks. Minecraft is checked first to avoid starvation by the larger Cfx group. New work stops after 40 seconds. A shared 45-second cancellation signal bounds source I/O, followed by a separate eight-second completion window within the route's 60-second limit. Cancellation does not turn an otherwise healthy source into an unavailable observation. Deferred work remains eligible for a later run.

Source timestamps retain the five-minute freshness requirement. A verified zero remains zero; missing, failed or stale observations remain unavailable. The scheduler never extends freshness or invents player counts. Minecraft network-wide counts retain their network scope label.

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

The migration's database tests exercise PostgreSQL permissions, credential verification, leases and summaries. Vault encryption, cron execution and HTTP transport require a deployed live check; the test doubles do not certify those hosted services.
