-- A successful retry can return the same source timestamp after a transient
-- error. Recover that still-current observation without inventing a new time or
-- adding a duplicate snapshot. Older observations must not clear newer errors.
-- The 55-second source lease exceeds bounded in-flight refresh work and leaves
-- five seconds for ordinary completion before the next one-minute cron tick.
begin;

create or replace function public.service_refresh_cfx_snapshot(p_platform text,p_join_code text,p_online boolean,p_players integer,p_capacity integer,p_observed_at timestamptz)
returns jsonb language plpgsql security definer set search_path='' as $$
declare sid uuid; last_seen timestamptz;
begin
 if p_platform is null or p_platform not in ('fivem','redm') then raise exception 'Invalid Cfx platform'; end if;
 if p_online is null or p_players is null or p_capacity is null or p_players not between 0 and 100000 or p_capacity not between 0 and 100000 or p_players>p_capacity or p_observed_at is null or not isfinite(p_observed_at) or p_observed_at not between now()-interval '5 minutes' and now()+interval '1 minute' then raise exception 'A current verified player observation is required'; end if;
 select i.server_id,i.last_checked_at into sid,last_seen from public.server_import_sources i join public.servers s on s.id=i.server_id where i.join_code=p_join_code and i.platform=p_platform and s.platform_id=p_platform and s.status='published' and s.age_rating<>'adult' for update of i;
 if sid is null then raise exception 'Unknown published Cfx import'; end if;
 if last_seen is not null and p_observed_at<last_seen then return jsonb_build_object('serverId',sid,'checkedAt',last_seen,'unchanged',true); end if;
 if p_observed_at=last_seen then
  update public.server_import_sources set last_error_at=null,next_refresh_at=greatest(next_refresh_at,now()+interval '55 seconds') where server_id=sid;
  return jsonb_build_object('serverId',sid,'checkedAt',last_seen,'unchanged',true);
 end if;
 insert into public.server_status_snapshots(server_id,online,players,capacity,provider_status,checked_at) values(sid,p_online,p_players,p_capacity,'cfx',p_observed_at);
 update public.server_import_sources set last_checked_at=p_observed_at,next_refresh_at=greatest(next_refresh_at,now()+interval '55 seconds'),last_error_at=null where server_id=sid;
 delete from public.server_status_snapshots where server_id=sid and provider_status='cfx' and checked_at<now()-interval '30 days';
 return jsonb_build_object('serverId',sid,'checkedAt',p_observed_at,'online',p_online,'players',p_players,'capacity',p_capacity);
end;
$$;

create or replace function public.service_refresh_minecraft_snapshot(p_join_code text,p_online boolean,p_players integer,p_capacity integer,p_observed_at timestamptz)
returns jsonb language plpgsql security definer set search_path='' as $$
declare sid uuid; last_seen timestamptz;
begin
 if p_online is null or p_players is null or p_capacity is null or p_players not between 0 and 100000 or p_capacity not between 0 and 100000 or p_players>p_capacity or p_observed_at is null or not isfinite(p_observed_at) or p_observed_at not between now()-interval '10 minutes' and now()+interval '1 minute' then raise exception 'A current verified player observation is required'; end if;
 select i.server_id,i.last_checked_at into sid,last_seen from public.minecraft_import_sources i join public.servers s on s.id=i.server_id where i.join_code=p_join_code and s.status='published' and s.age_rating<>'adult' for update of i;
 if sid is null then raise exception 'Unknown published Minecraft import'; end if;
 if last_seen is not null and p_observed_at<last_seen then return jsonb_build_object('serverId',sid,'checkedAt',last_seen,'unchanged',true); end if;
 if p_observed_at=last_seen then
  -- Preserve Minecraft's existing ingestion window while allowing recovery only
  -- inside the five-minute public freshness window shared by imported sources.
  if p_observed_at>=now()-interval '5 minutes' then
   update public.minecraft_import_sources set last_error_at=null,next_refresh_at=greatest(next_refresh_at,now()+interval '55 seconds') where server_id=sid;
  end if;
  return jsonb_build_object('serverId',sid,'checkedAt',last_seen,'unchanged',true);
 end if;
 insert into public.server_status_snapshots(server_id,online,players,capacity,provider_status,checked_at) values(sid,p_online,p_players,p_capacity,'minecraft',p_observed_at);
 update public.minecraft_import_sources set last_checked_at=p_observed_at,next_refresh_at=greatest(next_refresh_at,now()+interval '55 seconds'),last_error_at=null where server_id=sid;
 delete from public.server_status_snapshots where server_id=sid and provider_status='minecraft' and checked_at<now()-interval '30 days';
 return jsonb_build_object('serverId',sid,'checkedAt',p_observed_at,'online',p_online,'players',p_players,'capacity',p_capacity);
end;
$$;

create or replace function public.service_claim_cfx_refresh(p_platform text,p_join_code text)
returns boolean language plpgsql security definer set search_path='' as $$
declare claimed uuid;
begin
 if p_platform is null or p_platform not in ('fivem','redm') then raise exception 'Invalid Cfx platform'; end if;
 update public.server_import_sources i set next_refresh_at=now()+interval '55 seconds' from public.servers s where s.id=i.server_id and s.status='published' and s.age_rating<>'adult' and i.join_code=p_join_code and i.platform=p_platform and s.platform_id=p_platform and i.next_refresh_at<=now() returning i.server_id into claimed;
 return claimed is not null;
end;
$$;

create or replace function public.service_claim_minecraft_refresh(p_join_code text)
returns boolean language plpgsql security definer set search_path='' as $$
declare claimed uuid;
begin
 update public.minecraft_import_sources i set next_refresh_at=now()+interval '55 seconds' from public.servers s where s.id=i.server_id and s.status='published' and s.age_rating<>'adult' and i.join_code=p_join_code and i.next_refresh_at<=now() returning i.server_id into claimed;
 return claimed is not null;
end;
$$;

create or replace function public.service_mark_cfx_unavailable(p_platform text,p_join_code text)
returns boolean language plpgsql security definer set search_path='' as $$
declare sid uuid;
begin
 if p_platform is null or p_platform not in ('fivem','redm') then raise exception 'Invalid Cfx platform'; end if;
 update public.server_import_sources i set last_error_at=now(),next_refresh_at=greatest(next_refresh_at,now()+interval '55 seconds') from public.servers s where s.id=i.server_id and s.status='published' and i.join_code=p_join_code and i.platform=p_platform and s.platform_id=p_platform returning i.server_id into sid;
 return sid is not null;
end;
$$;

create or replace function public.service_mark_minecraft_unavailable(p_join_code text)
returns boolean language plpgsql security definer set search_path='' as $$
declare sid uuid;
begin
 update public.minecraft_import_sources i set last_error_at=now(),next_refresh_at=greatest(next_refresh_at,now()+interval '55 seconds') from public.servers s where s.id=i.server_id and s.status='published' and i.join_code=p_join_code returning i.server_id into sid;
 return sid is not null;
end;
$$;

revoke all on function public.service_refresh_cfx_snapshot(text,text,boolean,integer,integer,timestamptz),public.service_refresh_minecraft_snapshot(text,boolean,integer,integer,timestamptz),public.service_claim_cfx_refresh(text,text),public.service_claim_minecraft_refresh(text),public.service_mark_cfx_unavailable(text,text),public.service_mark_minecraft_unavailable(text) from public,anon,authenticated;
grant execute on function public.service_refresh_cfx_snapshot(text,text,boolean,integer,integer,timestamptz),public.service_refresh_minecraft_snapshot(text,boolean,integer,integer,timestamptz),public.service_claim_cfx_refresh(text,text),public.service_claim_minecraft_refresh(text),public.service_mark_cfx_unavailable(text,text),public.service_mark_minecraft_unavailable(text) to service_role;
commit;
