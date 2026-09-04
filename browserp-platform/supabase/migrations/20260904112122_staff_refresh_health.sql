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
   'recentRuns',coalesce((select jsonb_agg(item order by started_at desc) from (select item,started_at from runs order by started_at desc limit 10) recent),'[]'::jsonb)
 ) into result;
 return result;
end;
$$;
revoke all on function public.staff_refresh_health() from public,anon,authenticated,service_role;
grant execute on function public.staff_refresh_health() to authenticated;
