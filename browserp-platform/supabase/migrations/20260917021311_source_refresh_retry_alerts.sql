begin;

-- A failed fetch is not an offline observation. Keep only private retry state;
-- no source addresses, raw errors, counts or server status are copied here.
create table private.source_refresh_failures (
  server_id uuid primary key references public.servers(id) on delete cascade,
  attempts integer not null check (attempts > 0),
  first_failed_at timestamptz not null,
  last_failed_at timestamptz not null,
  next_retry_at timestamptz not null
);
alter table private.source_refresh_failures enable row level security;
revoke all on private.source_refresh_failures from public, anon, authenticated, service_role;

create function private.track_source_refresh_failure()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.last_error_at is null then
    delete from private.source_refresh_failures where server_id = new.server_id;
  elsif new.last_error_at is distinct from old.last_error_at then
    insert into private.source_refresh_failures(server_id, attempts, first_failed_at, last_failed_at, next_retry_at)
      values(new.server_id, 1, new.last_error_at, new.last_error_at, new.last_error_at + interval '5 minutes')
      on conflict(server_id) do update set
        attempts = least(private.source_refresh_failures.attempts + 1, 1000000),
        last_failed_at = excluded.last_failed_at,
        next_retry_at = excluded.next_retry_at;
    -- The existing scheduler and per-source lease enforce this delay, including
    -- manual refreshes. Healthy sources retain their existing one-minute cadence.
    new.next_refresh_at := greatest(new.next_refresh_at, new.last_error_at + interval '5 minutes');
  end if;
  return new;
end;
$$;
revoke all on function private.track_source_refresh_failure() from public, anon, authenticated, service_role;
create trigger cfx_source_refresh_failure before update of last_error_at, last_checked_at
  on public.server_import_sources for each row execute function private.track_source_refresh_failure();
create trigger minecraft_source_refresh_failure before update of last_error_at, last_checked_at
  on public.minecraft_import_sources for each row execute function private.track_source_refresh_failure();

create function private.source_refresh_alert_summary()
returns jsonb language sql stable security definer set search_path = '' as $$
  with sources as (
    select i.server_id, i.platform, i.last_checked_at, i.last_error_at
    from public.server_import_sources i
    union all
    select i.server_id, 'minecraft', i.last_checked_at, i.last_error_at
    from public.minecraft_import_sources i
  ), failures as (
    select s.id, s.name, s.slug, i.platform, i.last_checked_at,
      f.attempts, f.first_failed_at, f.last_failed_at, f.next_retry_at,
      f.attempts >= 3 and f.first_failed_at <= now() - interval '10 minutes' as needs_attention
    from private.source_refresh_failures f join sources i on i.server_id = f.server_id
      join public.servers s on s.id = f.server_id and s.platform_id = i.platform
    where s.status = 'published' and s.age_rating <> 'adult'
      and i.last_error_at is not null
      and (i.last_checked_at is null or i.last_error_at >= i.last_checked_at)
  )
  select jsonb_build_object('retryAfterSeconds',300,'alertAfterAttempts',3,'alertAfterSeconds',600,
    'pending',(select count(*) from failures where not needs_attention),
    'needsAttention',(select count(*) from failures where needs_attention),
    'alerts',coalesce((select jsonb_agg(jsonb_build_object('serverId',id,'name',name,'slug',slug,
      'platform',platform,'attempts',attempts,'firstFailedAt',first_failed_at,
      'lastFailedAt',last_failed_at,'nextRetryAt',next_retry_at,'lastCheckedAt',last_checked_at)
      order by first_failed_at,id)
      from (select * from failures where needs_attention order by first_failed_at,id limit 50) bounded),'[]'::jsonb));
$$;
revoke all on function private.source_refresh_alert_summary() from public, anon, authenticated, service_role;

-- Read-only operational health. Never return scheduler credentials, request
-- bodies, headers, raw errors, IPs or private source addresses to the client.
create or replace function public.staff_refresh_health()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare result jsonb;
begin
 if not (public.has_staff_permission('website.overview.read') or public.has_staff_permission('servers.review')) then
   raise exception 'Refresh-health permission required' using errcode='42501';
 end if;
 with sources as (
   select i.platform,i.last_checked_at,i.last_error_at
   from public.server_import_sources i join public.servers s on s.id=i.server_id
   where s.status='published' and s.age_rating<>'adult' and s.platform_id=i.platform
   union all
   select 'minecraft',i.last_checked_at,i.last_error_at
   from public.minecraft_import_sources i join public.servers s on s.id=i.server_id
   where s.status='published' and s.age_rating<>'adult' and s.platform_id='minecraft'
 ), classified as (
   select *,coalesce(last_checked_at>=now()-interval '5 minutes' and last_checked_at<=now()+interval '1 minute'
     and (last_error_at is null or last_error_at<last_checked_at),false) as fresh,
     last_checked_at is null or (last_error_at is not null and last_error_at>=last_checked_at) as unavailable
   from sources
 ), totals as (
   select count(*) total,count(*) filter(where fresh) fresh,count(*) filter(where not fresh) stale,
     count(*) filter(where unavailable) unavailable,min(last_checked_at) oldest,max(last_checked_at) newest,
     count(*) filter(where last_checked_at is null) never_checked
   from classified
 ), platforms as (
   select platform,count(*) total,count(*) filter(where fresh) fresh,count(*) filter(where not fresh) stale,
     count(*) filter(where unavailable) unavailable,min(last_checked_at) oldest
   from classified group by platform
 ), runs as (
   select started_at,finished_at,summary,
     jsonb_build_object('startedAt',started_at,'finishedAt',finished_at,
       'requested',summary->'requested',
       'checked',case when summary->>'requested' is not null and summary->>'skipped' is not null and summary->>'deferred' is not null then greatest(0,(summary->>'requested')::integer-(summary->>'skipped')::integer-(summary->>'deferred')::integer) end,
       'refreshed',summary->'checked','unchanged',summary->'unchanged','unavailable',summary->'unavailable',
       'failed',summary->'failed','skipped',summary->'skipped','deferred',summary->'deferred','durationMs',summary->'durationMs') item
   from private.server_status_refresh_runs
   where id in (
     (select id from private.server_status_refresh_runs order by started_at desc limit 10)
     union
     (select id from private.server_status_refresh_runs where finished_at is not null order by finished_at desc limit 1)
   )
 )
 select jsonb_build_object(
   'checkedAt',now(),'freshnessSeconds',300,
   'scheduler',(select jsonb_build_object(
     'enabled',(select active from cron.job where jobname='browserp-server-status-refresh'),
     'intervalSeconds',(select case when schedule='* * * * *' then 60 end from cron.job where jobname='browserp-server-status-refresh'),
     'lastDispatchedAt',c.last_dispatched_at,
     'lastDeliveryStatus',(select status_code from net._http_response where id=c.last_request_id),
     'lastDeliveryTimedOut',(select timed_out from net._http_response where id=c.last_request_id)
   ) from private.server_status_refresh_control c where c.singleton),
   'lastRun',(select item from runs order by started_at desc limit 1),
   'lastCompletedRun',(select item from runs where finished_at is not null order by finished_at desc limit 1),
   'lastSuccessfulRunAt',(select finished_at from private.server_status_refresh_runs
     where finished_at is not null and summary->>'failed'='0' and summary->>'deferred'='0' order by finished_at desc limit 1),
   'sources',(select jsonb_build_object('total',total,'fresh',fresh,'stale',stale,'unavailable',unavailable,
     'oldestObservationAt',oldest,'newestObservationAt',newest,'neverChecked',never_checked) from totals),
   'platforms',coalesce((select jsonb_agg(jsonb_build_object('platform',platform,'total',total,'fresh',fresh,'stale',stale,
     'unavailable',unavailable,'oldestObservationAt',oldest) order by platform) from platforms),'[]'::jsonb),
   'sourceRetries',private.source_refresh_alert_summary(),
   'recentRuns',coalesce((select jsonb_agg(item order by started_at desc) from (select item,started_at from runs order by started_at desc limit 10) recent),'[]'::jsonb)
 ) into result;
 return result;
end;
$$;
revoke all on function public.staff_refresh_health() from public,anon,authenticated,service_role;
grant execute on function public.staff_refresh_health() to authenticated;

commit;
