-- Review and apply separately from code deployment. No role IDs or credentials
-- are migration literals. Both the configuration and cron job start disabled.
begin;
create table private.discord_role_sync_control (
 singleton boolean primary key default true check(singleton), enabled boolean not null default false,
 revoke_only boolean not null default false, guild_id text, bot_user_id text,
 protected_role_ids text[] not null default '{}', version bigint not null default 0,
 run_id uuid, run_version bigint, leased_until timestamptz not null default '-infinity', not_before timestamptz not null default '-infinity'
);
insert into private.discord_role_sync_control(singleton) values(true);
-- Retired IDs remain managed for cleanup. Never cascade from auth.users or mappings.
create table private.discord_role_sync_roles (
 discord_role_id text primary key check(discord_role_id ~ '^[0-9]{17,20}$'),
 site_role_key text references public.staff_roles(key), active boolean not null default false
);
create unique index discord_role_sync_one_active_mapping on private.discord_role_sync_roles(site_role_key) where active;
create table private.discord_role_sync_members (
 discord_user_id text primary key check(discord_user_id ~ '^[0-9]{17,20}$'),
 next_check_at timestamptz not null default '-infinity', last_checked_at timestamptz,
 last_result text, attempts integer not null default 0
);
create table private.discord_role_sync_audit (
 id bigint generated always as identity primary key, created_at timestamptz not null default now(),
 actor_id uuid, run_id uuid, discord_user_id text, event text not null, details jsonb not null default '{}'
);
alter table private.discord_role_sync_control enable row level security;
alter table private.discord_role_sync_roles enable row level security;
alter table private.discord_role_sync_members enable row level security;
alter table private.discord_role_sync_audit enable row level security;
revoke all on private.discord_role_sync_control,private.discord_role_sync_roles,private.discord_role_sync_members,private.discord_role_sync_audit from public,anon,authenticated,service_role;

create or replace function public.staff_configure_discord_role_sync(p_guild_id text,p_bot_user_id text,p_protected_role_ids text[],p_mappings jsonb,p_enabled boolean,p_revoke_only boolean,p_expected_version bigint,p_reason text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c private.discord_role_sync_control%rowtype; item record;
begin
 if not public.has_staff_permission('staff.manage') or not exists(select 1 from public.staff_memberships where user_id=(select auth.uid()) and role_key='owner' and status='active') then
  raise exception 'Owner permission required' using errcode='42501'; end if;
 select * into c from private.discord_role_sync_control where singleton for update;
 if c.version is distinct from p_expected_version then raise exception 'Configuration changed; reload before saving' using errcode='40001'; end if;
 if p_guild_id is null or p_guild_id !~ '^[0-9]{17,20}$' or p_bot_user_id is null or p_bot_user_id !~ '^[0-9]{17,20}$'
 or p_protected_role_ids is null or cardinality(p_protected_role_ids)<1 or cardinality(p_protected_role_ids)>20
 or exists(select 1 from unnest(p_protected_role_ids) r where r is null or r !~ '^[0-9]{17,20}$')
 or p_mappings is null or jsonb_typeof(p_mappings)<>'object' or octet_length(p_mappings::text)>2048
 or p_enabled is null or p_revoke_only is null or length(btrim(coalesce(p_reason,''))) not between 10 and 500 then raise exception 'Invalid reviewed configuration'; end if;
 if c.guild_id is not null and c.guild_id<>p_guild_id then raise exception 'Drain the existing guild and review a migration before changing guilds'; end if;
 if exists(select 1 from jsonb_each(p_mappings) where jsonb_typeof(value)<>'string') then raise exception 'Discord role IDs must be exact strings'; end if;
 -- Only confirmed site ranks; Ownership is always outside automated management.
 for item in select key,value from jsonb_each_text(p_mappings) loop
  if item.key not in ('administrator','senior_moderator','moderator','support') or item.value is null or item.value !~ '^[0-9]{17,20}$'
  or item.value=p_guild_id or item.value=any(p_protected_role_ids) then raise exception 'Invalid exact role mapping'; end if;
 end loop;
 if (select count(*) from jsonb_each_text(p_mappings))<>(select count(distinct value) from jsonb_each_text(p_mappings)) then raise exception 'Each site rank needs a distinct Discord role'; end if;
 if exists(select 1 from private.discord_role_sync_roles where discord_role_id=any(p_protected_role_ids)) then raise exception 'A managed role cannot become protected before cleanup and review'; end if;
 update private.discord_role_sync_roles set active=false;
 for item in select key,value from jsonb_each_text(p_mappings) loop
  insert into private.discord_role_sync_roles values(item.value,item.key,true)
  on conflict(discord_role_id) do update set site_role_key=excluded.site_role_key,active=true;
 end loop;
 update private.discord_role_sync_control set guild_id=p_guild_id,bot_user_id=p_bot_user_id,protected_role_ids=p_protected_role_ids,
 enabled=p_enabled,revoke_only=p_revoke_only,version=version+1 where singleton;
 update private.discord_role_sync_members set next_check_at='-infinity';
 insert into private.discord_role_sync_audit(actor_id,event,details) values((select auth.uid()),'configuration',jsonb_build_object('version',c.version+1,'guildId',p_guild_id,'botUserId',p_bot_user_id,'protectedRoleIds',p_protected_role_ids,'mappings',p_mappings,'enabled',p_enabled,'revokeOnly',p_revoke_only,'reason',btrim(p_reason)));
 return jsonb_build_object('version',c.version+1,'enabled',p_enabled);
end;
$$;

create or replace function public.staff_discord_role_sync_control()
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if not public.has_staff_permission('staff.manage') or not exists(select 1 from public.staff_memberships where user_id=(select auth.uid()) and role_key='owner' and status='active') then raise exception 'Owner permission required' using errcode='42501'; end if;
 return (select jsonb_build_object('enabled',enabled,'revokeOnly',revoke_only,'guildId',guild_id,'botUserId',bot_user_id,'protectedRoleIds',protected_role_ids,'version',version,
 'mappings',(select coalesce(jsonb_object_agg(site_role_key,discord_role_id),'{}') from private.discord_role_sync_roles where active),
 'managedRoleIds',(select coalesce(jsonb_agg(discord_role_id),'[]') from private.discord_role_sync_roles),
 'dueMembers',(select count(*) from private.discord_role_sync_members where next_check_at<=clock_timestamp()),'notBefore',not_before,
 'recentEvents',(select coalesce(jsonb_agg(e),'[]') from (select created_at,discord_user_id,event,details from private.discord_role_sync_audit order by id desc limit 30) e))
 from private.discord_role_sync_control where singleton);
end;
$$;
revoke all on function public.staff_discord_role_sync_control() from public,anon;
grant execute on function public.staff_discord_role_sync_control() to authenticated;

create or replace function public.service_claim_discord_role_sync(p_token text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c private.discord_role_sync_control%rowtype; token_hash text;
begin
 select secret_hash into token_hash from private.secrets where key='server_status_refresh';
 if p_token is null or p_token !~ '^[a-f0-9]{64}$' or token_hash is null or encode(extensions.digest(p_token,'sha256'),'hex') is distinct from token_hash then raise exception 'Scheduler authorization required' using errcode='42501'; end if;
 update private.discord_role_sync_control set run_id=gen_random_uuid(),run_version=version,leased_until=clock_timestamp()+interval '55 seconds'
 where singleton and enabled and leased_until<=clock_timestamp() and not_before<=clock_timestamp() returning * into c;
 if not found then return null; end if;
 -- Includes pending and disabled entries. A surviving ledger catches external
 -- unlink/deletion even after both the identity and allowlist have disappeared.
 insert into private.discord_role_sync_members(discord_user_id)
 select discord_user_id from private.discord_owner_allowlist on conflict do nothing;
 return jsonb_build_object('runId',c.run_id,'version',c.version,'guildId',c.guild_id,'botUserId',c.bot_user_id,'protectedRoleIds',c.protected_role_ids);
end;
$$;

create or replace function public.service_read_discord_role_sync(p_run_id uuid,p_discord_user_id text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c private.discord_role_sync_control%rowtype; desired text;
begin
 select * into c from private.discord_role_sync_control where singleton and enabled and run_id=p_run_id and version=run_version and leased_until>clock_timestamp() and not_before<=clock_timestamp();
 if not found then raise exception 'Expired or disabled sync lease' using errcode='42501'; end if;
 if p_discord_user_id is null then
  return (select coalesce(jsonb_agg(discord_user_id),'[]') from (select discord_user_id from private.discord_role_sync_members where next_check_at<=clock_timestamp() order by next_check_at,discord_user_id limit 20) x);
 end if;
 if not exists(select 1 from private.discord_role_sync_members where discord_user_id=p_discord_user_id) then raise exception 'Unknown sync member'; end if;
 if not c.revoke_only then
  select r.discord_role_id into desired from private.discord_owner_allowlist a
  join auth.identities i on i.provider='discord' and coalesce(i.provider_id,i.identity_data->>'provider_id',i.identity_data->>'sub')=a.discord_user_id
  join auth.users u on u.id=i.user_id and u.deleted_at is null and not coalesce(u.is_anonymous,false)
  join public.staff_memberships m on m.user_id=i.user_id and m.status='active' and m.role_key=a.role_key
  join private.discord_role_sync_roles r on r.site_role_key=m.role_key and r.active
  where a.discord_user_id=p_discord_user_id and a.enabled and m.role_key<>'owner'
  and (select count(*) from auth.identities own where own.user_id=i.user_id)=1;
 end if;
 return jsonb_build_object('desiredRoleId',desired,'managedRoleIds',(select coalesce(jsonb_agg(discord_role_id),'[]') from private.discord_role_sync_roles),'version',c.version);
end;
$$;

create or replace function public.service_record_discord_role_sync(p_run_id uuid,p_discord_user_id text,p_event text,p_role_id text default null,p_retry_seconds integer default 300)
returns void language plpgsql security definer set search_path='' as $$
begin
 -- Serialize with owner configuration (control first, then member ledger), so
 -- a stale completion cannot overwrite a concurrently queued reconciliation.
 perform 1 from private.discord_role_sync_control where singleton and run_id=p_run_id and version=run_version and leased_until>clock_timestamp() for update;
 if not found then raise exception 'Expired sync lease' using errcode='42501'; end if;
 if p_event not in ('added','removed','unchanged','absent','protected','retry','forbidden','configuration_error','rate_limited') or p_retry_seconds is null or p_retry_seconds<1 then raise exception 'Invalid sync outcome'; end if;
 if p_role_id is not null and not exists(select 1 from private.discord_role_sync_roles where discord_role_id=p_role_id) then raise exception 'Role is outside approved management'; end if;
 if not exists(select 1 from private.discord_role_sync_members where discord_user_id=p_discord_user_id) then raise exception 'Unknown sync member'; end if;
 insert into private.discord_role_sync_audit(run_id,discord_user_id,event,details)
 select p_run_id,p_discord_user_id,p_event,jsonb_build_object('roleId',p_role_id)
 where p_role_id is not null or exists(select 1 from private.discord_role_sync_members where discord_user_id=p_discord_user_id and last_result is distinct from p_event);
 update private.discord_role_sync_members set last_checked_at=clock_timestamp(),last_result=p_event,
 next_check_at=clock_timestamp()+make_interval(secs=>p_retry_seconds),attempts=case when p_event in ('retry','forbidden','configuration_error','rate_limited') then least(attempts+1,100000) else 0 end
 where discord_user_id=p_discord_user_id;
 if p_event='rate_limited' then update private.discord_role_sync_control set not_before=clock_timestamp()+make_interval(secs=>p_retry_seconds) where singleton; end if;
end;
$$;
revoke all on function public.staff_configure_discord_role_sync(text,text,text[],jsonb,boolean,boolean,bigint,text) from public,anon;
grant execute on function public.staff_configure_discord_role_sync(text,text,text[],jsonb,boolean,boolean,bigint,text) to authenticated;
revoke all on function public.service_claim_discord_role_sync(text),public.service_read_discord_role_sync(uuid,text),public.service_record_discord_role_sync(uuid,text,text,text,integer) from public,anon,authenticated;
grant execute on function public.service_claim_discord_role_sync(text),public.service_read_discord_role_sync(uuid,text),public.service_record_discord_role_sync(uuid,text,text,text,integer) to service_role;

create or replace function private.dispatch_discord_role_sync()
returns bigint language plpgsql security definer set search_path='' as $$
declare token text;
begin
 if not exists(select 1 from private.discord_role_sync_control where singleton and enabled and not_before<=clock_timestamp()) then return null; end if;
 select decrypted_secret into token from vault.decrypted_secrets where name='browserp_server_status_refresh';
 if token is null or token !~ '^[a-f0-9]{64}$' then raise exception 'Scheduler credential unavailable'; end if;
 return net.http_post(url:='https://www.browserp.com/api/internal/discord-role-sync',body:='{}'::jsonb,
 headers:=jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||token),timeout_milliseconds:=45000);
end;
$$;
revoke all on function private.dispatch_discord_role_sync() from public,anon,authenticated,service_role;
do $schedule$
declare job bigint;
begin
 select cron.schedule('browserp-discord-role-sync','*/5 * * * *','select private.dispatch_discord_role_sync()') into job;
 perform cron.alter_job(job,active:=false);
end;
$schedule$;
commit;
