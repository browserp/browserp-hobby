-- Keep reviewed server observations fresh without depending on visitor traffic.
-- The schedule installs PAUSED so this can be applied before endpoint rollout.
-- Once /api/internal/server-status is deployed and ready, activate the named job
-- with cron.alter_job(jobid,active:=true). The token is generated inside
-- PostgreSQL and is never a migration literal or an application setting.
begin;

-- Hosted DDL permission hooks also run for CREATE EXTENSION IF NOT EXISTS.
-- Avoid that statement entirely for installed extensions and their existing ACLs.
do $status_refresh_extensions$
begin
 if not exists(select 1 from pg_catalog.pg_extension where extname='pgcrypto') then
  execute 'create extension pgcrypto with schema extensions';
 end if;
 if not exists(select 1 from pg_catalog.pg_extension where extname='supabase_vault') then
  execute 'create extension supabase_vault with schema vault';
 end if;
 if not exists(select 1 from pg_catalog.pg_extension where extname='pg_net') then
  execute 'create extension pg_net with schema extensions';
 end if;
 if not exists(select 1 from pg_catalog.pg_extension where extname='pg_cron') then
  execute 'create extension pg_cron with schema pg_catalog';
 end if;
end;
$status_refresh_extensions$;

create table private.server_status_refresh_control (
 singleton boolean primary key default true check(singleton),
 run_id uuid,
 leased_until timestamptz not null default '-infinity',
 last_dispatched_at timestamptz,
 last_request_id bigint
);
insert into private.server_status_refresh_control(singleton) values(true);
create table private.server_status_refresh_runs (
 id uuid primary key,
 started_at timestamptz not null default now(),
 finished_at timestamptz,
 summary jsonb check(summary is null or (jsonb_typeof(summary)='object' and octet_length(summary::text)<=4096))
);
create index server_status_refresh_runs_started_idx on private.server_status_refresh_runs(started_at desc);
alter table private.server_status_refresh_control enable row level security;
alter table private.server_status_refresh_runs enable row level security;
revoke all on private.server_status_refresh_control,private.server_status_refresh_runs from public,anon,authenticated,service_role;
-- A queued HTTP request temporarily contains its Authorization header.
revoke all on vault.secrets,vault.decrypted_secrets,net.http_request_queue from public,anon,authenticated,service_role;

do $status_refresh_secret$
declare v_token text;
begin
 select decrypted_secret into v_token from vault.decrypted_secrets where name='browserp_server_status_refresh';
 if v_token is null then
  v_token:=encode(extensions.gen_random_bytes(32),'hex');
  perform vault.create_secret(v_token,'browserp_server_status_refresh','Private credential for the BrowseRP scheduled server status refresh.');
 end if;
 if v_token !~ '^[a-f0-9]{64}$' then raise exception 'Invalid stored scheduler credential'; end if;
 -- This is a uniformly random 256-bit token, not a human password. A SHA-256
 -- digest preserves its entropy without making rejected HTTP requests costly.
 insert into private.secrets(key,secret_hash) values('server_status_refresh',encode(extensions.digest(v_token,'sha256'),'hex'))
 on conflict(key) do update set secret_hash=excluded.secret_hash,updated_at=now();
end;
$status_refresh_secret$;

create or replace function public.service_claim_status_refresh(p_token text)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_hash text; v_run_id uuid:=gen_random_uuid(); v_claimed uuid;
begin
 if p_token is null or p_token !~ '^[a-f0-9]{64}$' then
  raise exception 'Scheduler authorization required' using errcode='42501';
 end if;
 select secret_hash into v_hash from private.secrets where key='server_status_refresh';
 if v_hash is null or encode(extensions.digest(p_token,'sha256'),'hex') is distinct from v_hash then
  raise exception 'Scheduler authorization required' using errcode='42501';
 end if;
 -- Atomic row update gives at most one claimant, including concurrent requests.
 -- Do not release early on finish: this also bounds authenticated replay volume.
 update private.server_status_refresh_control set run_id=v_run_id,leased_until=clock_timestamp()+interval '55 seconds'
 where singleton and leased_until<=clock_timestamp() returning run_id into v_claimed;
 if v_claimed is null then return null; end if;
 insert into private.server_status_refresh_runs(id) values(v_claimed);
 delete from private.server_status_refresh_runs where started_at<now()-interval '7 days';
 return v_claimed;
end;
$$;

create or replace function public.service_finish_status_refresh(p_run_id uuid,p_summary jsonb)
returns void language plpgsql security definer set search_path='' as $$
declare k text; v_freshness jsonb;
begin
 if p_summary is null or jsonb_typeof(p_summary)<>'object' or octet_length(p_summary::text)>2048 then raise exception 'Invalid refresh summary'; end if;
 if (select count(*) from jsonb_object_keys(p_summary))<>8 then raise exception 'Invalid refresh summary'; end if;
 for k in select unnest(array['requested','checked','unchanged','unavailable','skipped','failed','deferred','durationMs']) loop
  if not(p_summary?k) or jsonb_typeof(p_summary->k)<>'number' or (p_summary->>k)!~ '^[0-9]{1,6}$'
    or (p_summary->>k)::integer>(case when k='durationMs' then 120000 else 200 end)
  then raise exception 'Invalid refresh summary'; end if;
 end loop;
 if p_run_id is null or not exists(select 1 from private.server_status_refresh_runs where id=p_run_id) then
  raise exception 'Unknown refresh run' using errcode='22023';
 end if;
 -- Freshness is derived from actual source rows, not the worker's counters.
 with sources as (
  select i.last_checked_at,i.last_error_at from public.server_import_sources i join public.servers s on s.id=i.server_id
  where s.status='published' and s.age_rating<>'adult' and s.platform_id=i.platform
  union all
  select i.last_checked_at,i.last_error_at from public.minecraft_import_sources i join public.servers s on s.id=i.server_id
  where s.status='published' and s.age_rating<>'adult' and s.platform_id='minecraft'
 ), counts as (
  select count(*) total,count(*) filter(where last_checked_at>=now()-interval '5 minutes' and last_checked_at<=now()+interval '1 minute'
   and (last_error_at is null or last_error_at<=last_checked_at)) fresh,
   case when count(*) filter(where last_checked_at is null)>0 then null else min(last_checked_at) end oldest
  from sources
 ) select jsonb_build_object('totalSources',total,'freshSources',fresh,'staleSources',total-fresh,'oldestSourceCheckedAt',oldest)
 into v_freshness from counts;
 update private.server_status_refresh_runs set finished_at=clock_timestamp(),summary=p_summary||v_freshness
 where id=p_run_id and finished_at is null;
end;
$$;

create or replace function private.dispatch_server_status_refresh()
returns bigint language plpgsql security definer set search_path='' as $$
declare v_token text; v_request_id bigint;
begin
 -- Only the database scheduler may choose the fixed destination; there are no
 -- caller-supplied source addresses, URLs, request bodies or header overrides.
 select decrypted_secret into v_token from vault.decrypted_secrets where name='browserp_server_status_refresh';
 if v_token is null or v_token !~ '^[a-f0-9]{64}$' then raise exception 'Scheduler credential unavailable'; end if;
 select net.http_post(
  url:='https://www.browserp.com/api/internal/server-status',
  body:='{}'::jsonb,
  headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||v_token),
  timeout_milliseconds:=55000
 ) into v_request_id;
 update private.server_status_refresh_control set last_dispatched_at=clock_timestamp(),last_request_id=v_request_id where singleton;
 return v_request_id;
end;
$$;

revoke all on function public.service_claim_status_refresh(text),public.service_finish_status_refresh(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.service_claim_status_refresh(text),public.service_finish_status_refresh(uuid,jsonb) to service_role;
revoke all on function private.dispatch_server_status_refresh() from public,anon,authenticated,service_role;

-- Missing required extensions fail the migration instead of silently leaving
-- a traffic-dependent refresh system in place. The named job avoids duplicates.
-- Create and pause in the same transaction: no request can run before activation.
do $status_refresh_schedule$
declare v_job_id bigint;
begin
 select cron.schedule('browserp-server-status-refresh','* * * * *','select private.dispatch_server_status_refresh()') into v_job_id;
 perform cron.alter_job(v_job_id,active:=false);
end;
$status_refresh_schedule$;
commit;
