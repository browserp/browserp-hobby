-- A bounded, permission-scoped moderation workspace over existing live records.
begin;

insert into public.permissions(key,description) values
  ('accounts.manage','Edit member display names, bios and profile visibility.'),
  ('servers.manage','Edit server listing metadata and publication state.')
on conflict(key) do update set description=excluded.description;
insert into public.staff_role_permissions(role_key,permission_key)
select r,p from unnest(array['owner','administrator']) r cross join unnest(array['accounts.manage','servers.manage']) p
on conflict(role_key,permission_key) do nothing;

alter table public.profiles add column if not exists moderation_version bigint not null default 1;
alter table public.servers add column if not exists moderation_version bigint not null default 1;
alter table public.reports
  add column if not exists moderation_version bigint not null default 1,
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references public.profiles(id) on delete set null,
  add column if not exists deleted_reason text,
  add column if not exists deleted_from_status text;
-- Account retention must not cascade into destruction of report history.
alter table public.reports alter column reporter_id drop not null;
alter table public.reports drop constraint if exists reports_reporter_id_fkey;
alter table public.reports add constraint reports_reporter_id_fkey foreign key(reporter_id) references public.profiles(id) on delete set null;

create or replace function private.bump_moderation_version()
returns trigger language plpgsql set search_path='' as $$
begin
  new.moderation_version:=old.moderation_version+1;
  return new;
end;
$$;
revoke all on function private.bump_moderation_version() from public,anon,authenticated,service_role;
create trigger profiles_moderation_version before update on public.profiles for each row execute function private.bump_moderation_version();
create trigger servers_moderation_version before update on public.servers for each row execute function private.bump_moderation_version();
create trigger reports_moderation_version before update on public.reports for each row execute function private.bump_moderation_version();
create index reports_workspace_order_idx on public.reports(created_at desc,(id::text) desc);
create index servers_workspace_order_idx on public.servers(created_at desc,(id::text) desc);
create index account_activity_workspace_order_idx on public.account_activity(created_at desc,(id::text) desc);
create index audit_workspace_order_idx on public.staff_audit_events(created_at desc,(id::text) desc);
create index security_workspace_order_idx on public.security_events(created_at desc,(id::text) desc);

create or replace function private.moderation_normalize(p_value text)
returns text language sql immutable set search_path='' as $$
  select btrim(regexp_replace(lower(translate(coalesce(p_value,''),'-_','  ')), '[[:space:]]+', ' ', 'g'));
$$;
revoke all on function private.moderation_normalize(text) from public,anon,authenticated,service_role;

create or replace function private.moderation_capabilities()
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object(
    'readMembers',public.has_staff_permission('accounts.read') or public.has_staff_permission('accounts.manage'),
    'editMembers',public.has_staff_permission('accounts.manage'),
    'readServers',public.has_staff_permission('servers.review') or public.has_staff_permission('servers.manage'),
    'editServers',public.has_staff_permission('servers.manage'),
    'readReports',public.has_staff_permission('reports.read'),
    'manageReports',public.has_staff_permission('reports.resolve'),
    'readQueue',public.has_staff_permission('moderation.read'),
    'manageQueue',public.has_staff_permission('moderation.resolve'),
    'readListings',public.has_staff_permission('servers.review'),
    'manageListings',public.has_staff_permission('servers.review'),
    'readActivity',public.has_staff_permission('accounts.read'),
    'readAudit',public.has_staff_permission('audit.read'),
    'readSecurity',public.has_staff_permission('security.read'),
    'manageBans',public.has_staff_permission('bans.manage'),
    'reviewAppeals',public.has_staff_permission('appeals.review') and public.has_staff_permission('bans.manage'),
    'reviewProfiles',public.has_staff_permission('profiles.review'),
    'manageStaff',public.has_staff_permission('staff.manage') and exists(select 1 from public.staff_memberships where user_id=(select auth.uid()) and role_key='owner' and status='active'),
    'manageRoles',public.has_staff_permission('staff.manage') and public.has_staff_permission('staff.permissions.manage') and exists(select 1 from public.staff_memberships where user_id=(select auth.uid()) and role_key='owner' and status='active')
  );
$$;
revoke all on function private.moderation_capabilities() from public,anon,authenticated,service_role;

create or replace function public.staff_moderation_summary()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare c jsonb:=private.moderation_capabilities();
begin
  if (select auth.uid()) is null or not exists(select 1 from jsonb_each_text(c) where value='true') then
    raise exception 'Moderation permission required' using errcode='42501';
  end if;
  return jsonb_build_object('generatedAt',statement_timestamp(),'capabilities',c,
    'permissions',jsonb_build_object('keys',(select coalesce(jsonb_agg(key order by key),'[]'::jsonb) from public.permissions where public.has_staff_permission(key)),
      'isOwner',exists(select 1 from public.staff_memberships where user_id=(select auth.uid()) and role_key='owner' and status='active')),
    'counts',jsonb_build_object(
      'reports',case when (c->>'readReports')::boolean then (select count(*) from public.reports where deleted_at is null and status in ('open','triaged')) end,
      'members',case when (c->>'readMembers')::boolean then (select count(*) from public.profiles p join auth.users u on u.id=p.id where u.deleted_at is null and not coalesce(u.is_anonymous,false)) end,
      'servers',case when (c->>'readServers')::boolean then (select count(*) from public.servers) end,
      'queue',case when (c->>'readQueue')::boolean then (select count(*) from public.moderation_queue where status in ('open','claimed')) end,
      'activity',case when (c->>'readActivity')::boolean then (select count(*) from public.account_activity) end,
      'audit',case when (c->>'readAudit')::boolean then (select count(*) from public.staff_audit_events) end,
      'security',case when (c->>'readSecurity')::boolean then (select count(*) from public.security_events where resolved_at is null) end,
      'bans',case when (c->>'manageBans')::boolean then (select count(*) from public.security_bans where revoked_at is null and starts_at<=statement_timestamp() and (permanent or ends_at>statement_timestamp())) end,
      'appeals',case when (c->>'reviewAppeals')::boolean then (select count(*) from public.security_ban_appeals where status in ('submitted','under_review')) end,
      'profiles',case when (c->>'reviewProfiles')::boolean then (select count(*) from public.profiles where bio_review_status='pending_review') end,
      'listings',case when public.has_staff_permission('servers.review') then (select count(*) from public.server_submissions where status in ('pending_review','changes_requested')) end,
      'staff',case when (c->>'manageStaff')::boolean then (select count(*) from public.staff_memberships where status='active') end
    ));
end;
$$;

create or replace function public.staff_moderation_records(
  p_kind text,p_filters jsonb default '{}'::jsonb,p_cursor jsonb default null,p_limit integer default 25
)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  k text:=lower(btrim(coalesce(p_kind,''))); f jsonb:=coalesce(p_filters,'{}'::jsonb);
  c jsonb:=private.moderation_capabilities(); allowed boolean; need text;
  q text; words text[]; st text; cursor_date timestamptz; cursor_id text;
  date_from timestamptz; date_to timestamptz; result jsonb;
begin
  need:=case k when 'reports' then 'readReports' when 'members' then 'readMembers' when 'servers' then 'readServers'
    when 'activity' then 'readActivity' when 'audit' then 'readAudit' when 'security' then 'readSecurity'
    when 'bans' then 'manageBans' when 'appeals' then 'reviewAppeals' when 'profiles' then 'reviewProfiles'
    when 'listings' then 'readServers' when 'queue' then 'readQueue' end;
  if need is null then raise exception 'Choose a moderation section' using errcode='22023'; end if;
  if (select auth.uid()) is null or not coalesce((c->>need)::boolean,false)
     or (k='listings' and not public.has_staff_permission('servers.review')) then
    raise exception 'Permission required for this moderation section' using errcode='42501';
  end if;
  if p_limit is null or p_limit not between 1 and 100 or jsonb_typeof(f)<>'object' or octet_length(f::text)>8192 then
    raise exception 'Invalid moderation filters or page size' using errcode='22023';
  end if;
  if exists(select 1 from jsonb_each(f) where key not in ('q','status','platform','region','mode','feature','access','language','online','verified','beginner','from','to','severity','userId','targetId','targetType')
    or (value<>'null'::jsonb and (jsonb_typeof(value) not in ('string','boolean') or char_length(value#>>'{}')>200))) then
    raise exception 'Invalid moderation filter' using errcode='22023';
  end if;
  if exists(select 1 from jsonb_each(f) where key in ('online','verified','beginner') and value<>'null'::jsonb and value#>>'{}' not in ('true','false','')) then
    raise exception 'Invalid boolean filter' using errcode='22023';
  end if;
  q:=private.moderation_normalize(f->>'q'); words:=regexp_split_to_array(q,' ');
  st:=lower(coalesce(nullif(f->>'status',''),case when k in ('reports','queue','bans','appeals','profiles','listings','security') then 'active' else 'all' end));
  begin
    if nullif(f->>'from','') is not null then date_from:=(f->>'from')::timestamptz; end if;
    if nullif(f->>'to','') is not null then date_to:=(f->>'to')::timestamptz;
      if f->>'to' ~ '^\d{4}-\d{2}-\d{2}$' then date_to:=date_to+interval '1 day'-interval '1 microsecond'; end if;
    end if;
    if p_cursor is not null then
      if jsonb_typeof(p_cursor)<>'object' or not(p_cursor ?& array['createdAt','id'])
        or (select count(*) from jsonb_object_keys(p_cursor))<>2 then raise exception 'Invalid cursor'; end if;
      cursor_date:=(p_cursor->>'createdAt')::timestamptz; cursor_id:=p_cursor->>'id';
      if cursor_date is null or nullif(cursor_id,'') is null or char_length(cursor_id)>80 then raise exception 'Invalid cursor'; end if;
    end if;
    if not coalesce(isfinite(date_from),true) or not coalesce(isfinite(date_to),true) or not coalesce(isfinite(cursor_date),true)
      or date_from>date_to then raise exception 'Invalid date interval'; end if;
  exception when others then raise exception 'Choose valid dates and pagination cursor' using errcode='22023'; end;

  with base as not materialized (
    select r.id::text id,r.created_at, jsonb_build_object('id',r.id,'kind','report','reporterId',r.reporter_id,
      'reporterName',coalesce(p.display_name,'Former member'),'targetType',r.target_type,'targetId',r.target_id,
      'category',r.category,'details',r.details,'status',r.status,'resolutionNote',r.resolution_note,
      'createdAt',r.created_at,'updatedAt',r.updated_at,'version',r.moderation_version,
      'deletedAt',r.deleted_at,'deletedReason',r.deleted_reason,'deletedFromStatus',r.deleted_from_status) data,
      concat_ws(' ',r.id,r.category,r.details,r.target_type,r.target_id,p.display_name,p.username) search,
      case when r.deleted_at is not null then 'deleted' else r.status end state,
      r.deleted_at is null and r.status in ('open','triaged') active
    from public.reports r left join public.profiles p on p.id=r.reporter_id where k='reports'
    union all
    select p.id::text,u.created_at,jsonb_build_object('id',p.id,'userId',p.id,'kind','member','username',p.username,
      'displayName',p.display_name,'bio',p.bio,'avatarUrl',p.avatar_url,'visibility',p.profile_visibility,
      'joinedAt',p.joined_at,'createdAt',u.created_at,'updatedAt',p.updated_at,'version',p.moderation_version,
      'bioStatus',p.bio_review_status,'lastSignInAt',u.last_sign_in_at,
      'provider',(select string_agg(distinct i.provider,', ' order by i.provider) from auth.identities i where i.user_id=p.id),
      'discordId',(select coalesce(i.provider_id,i.identity_data->>'provider_id',i.identity_data->>'sub') from auth.identities i where i.user_id=p.id and i.provider='discord' limit 1),
      'staffRole',sm.role_key,'staffStatus',sm.status,
      'activeBans',(select count(*) from public.security_bans b where b.user_id=p.id and b.revoked_at is null and b.starts_at<=statement_timestamp() and (b.permanent or b.ends_at>statement_timestamp()))) ,
      concat_ws(' ',p.id,p.username,p.display_name,sm.role_key,(select string_agg(coalesce(i.provider_id,i.identity_data->>'provider_id',i.identity_data->>'sub'),' ') from auth.identities i where i.user_id=p.id and i.provider='discord')),
      case when exists(select 1 from public.security_bans b where b.user_id=p.id and b.revoked_at is null and b.starts_at<=statement_timestamp() and (b.permanent or b.ends_at>statement_timestamp())) then 'banned'
        when sm.status='active' then 'staff' else 'active' end,true
    from public.profiles p join auth.users u on u.id=p.id left join public.staff_memberships sm on sm.user_id=p.id
    where k='members' and u.deleted_at is null and not coalesce(u.is_anonymous,false)
    union all
    select s.id::text,s.created_at,jsonb_build_object('id',s.id,'kind','server','name',s.name,'slug',s.slug,'description',s.description,
      'platform',s.platform_id,'platformName',pl.name,'region',s.region,'language',s.language,'framework',s.framework,'access',s.access_type,
      'communityUrl',s.community_url,'websiteUrl',s.website_url,'cfxJoinUrl',s.cfx_join_url,'status',s.status,
      'verified',s.verified,'beginnerFriendly',s.beginner_friendly,'ownerId',s.owner_id,'ownerName',p.display_name,
      'online',snap.online,'players',snap.players,'capacity',snap.capacity,'checkedAt',snap.checked_at,
      'tags',coalesce(tags.tags,'[]'::jsonb),'createdAt',s.created_at,'updatedAt',s.updated_at,'version',s.moderation_version),
      concat_ws(' ',s.id,s.name,s.slug,s.description,s.platform_id,pl.name,s.region,s.language,s.framework,s.access_type,tags.tags::text,p.display_name),s.status,s.status not in ('rejected','archived')
    from public.servers s join public.platforms pl on pl.id=s.platform_id left join public.profiles p on p.id=s.owner_id
    left join lateral(select jsonb_agg(tag order by tag) tags from public.server_tags where server_id=s.id) tags on true
    left join lateral(select online,players,capacity,checked_at from public.server_status_snapshots where server_id=s.id order by checked_at desc,id desc limit 1) snap on true
    where k='servers'
    union all
    select a.id::text,a.created_at,jsonb_build_object('id',a.id::text,'userId',a.user_id,'displayName',p.display_name,'eventType',a.event_type,
      'provider',a.provider,'maskedNetwork',a.masked_network,'browser',a.browser_family,'os',a.os_family,'device',a.device_family,'createdAt',a.created_at),
      concat_ws(' ',a.id,a.event_type,p.display_name,p.username,a.provider,a.browser_family,a.os_family,a.device_family),a.event_type,true
    from public.account_activity a left join public.profiles p on p.id=a.user_id where k='activity'
    union all
    select a.id::text,a.created_at,jsonb_build_object('id',a.id::text,'actorId',a.actor_id,'actorName',p.display_name,'action',a.action,
      'targetType',a.target_type,'targetId',a.target_id,'reason',a.reason,'requestId',a.request_id,'createdAt',a.created_at),
      concat_ws(' ',a.id,a.action,a.target_type,a.target_id,a.reason,p.display_name,p.username),a.action,true
    from public.staff_audit_events a left join public.profiles p on p.id=a.actor_id where k='audit'
    union all
    select e.id::text,e.created_at,jsonb_build_object('id',e.id::text,'actorId',e.actor_id,'displayName',p.display_name,
      'eventType',e.event_type,'severity',e.severity,'createdAt',e.created_at,'resolvedAt',e.resolved_at,
      'details',coalesce((select jsonb_object_agg(key,value) from jsonb_each(case when jsonb_typeof(e.details)='object' then e.details else '{}'::jsonb end)
        where key in ('submissionId','platformId','matchingRecentSubmissions','actionsInFiveMinutes','automaticContainment')
          and jsonb_typeof(value) in ('string','number','boolean') and char_length(value::text)<=160),'{}'::jsonb)),
      concat_ws(' ',e.id,e.event_type,e.severity,p.display_name,p.username),case when e.resolved_at is null then 'open' else 'resolved' end,e.resolved_at is null
    from public.security_events e left join public.profiles p on p.id=e.actor_id where k='security'
    union all
    select b.id::text,b.created_at,jsonb_build_object('id',b.id,'userId',b.user_id,'displayName',p.display_name,'targetType',b.target_type,
      'reference',b.public_reference,'scope',b.scope,'reasonCode',b.reason_code,'reason',b.reason,'permanent',b.permanent,
      'startsAt',b.starts_at,'endsAt',b.ends_at,'revokedAt',b.revoked_at,'revokeReason',b.revoke_reason,'createdAt',b.created_at),
      concat_ws(' ',b.id,b.public_reference,b.target_type,b.scope,b.reason_code,b.reason,p.display_name,p.username),
      case when b.revoked_at is not null then 'revoked' when b.starts_at>statement_timestamp() then 'scheduled' when not b.permanent and coalesce(b.ends_at<=statement_timestamp(),true) then 'expired' else 'active' end,
      coalesce(b.revoked_at is null and b.starts_at<=statement_timestamp() and (b.permanent or b.ends_at>statement_timestamp()),false)
    from public.security_bans b left join public.profiles p on p.id=b.user_id where k='bans'
    union all
    select a.id::text,a.created_at,jsonb_build_object('id',a.id,'banId',a.ban_id,'userId',a.appellant_id,'reference',b.public_reference,
      'statement',a.statement,'status',a.status,'contactEmail',a.contact_email,'decisionNote',a.decision_note,'createdAt',a.created_at,'updatedAt',a.updated_at),
      concat_ws(' ',a.id,b.public_reference,a.statement,a.status,a.decision_note),a.status,a.status in ('submitted','under_review')
    from public.security_ban_appeals a join public.security_bans b on b.id=a.ban_id where k='appeals'
    union all
    select p.id::text,p.joined_at,jsonb_build_object('id',p.id,'userId',p.id,'displayName',p.display_name,'avatarUrl',p.avatar_url,'bio',p.bio,
      'avatarStatus',p.avatar_review_status,'bioStatus',p.bio_review_status,'status',p.bio_review_status,'createdAt',p.joined_at,'updatedAt',p.updated_at,'version',p.moderation_version),
      concat_ws(' ',p.id,p.username,p.display_name,p.bio),p.bio_review_status,p.bio_review_status='pending_review'
    from public.profiles p where k='profiles'
    union all
    select s.id::text,s.created_at,jsonb_build_object('id',s.id,'kind','listing','name',s.name,'platform',s.platform_id,'region',s.region,'language',s.language,
      'framework',s.framework,'description',s.description,'communityUrl',s.community_url,'access',s.access_type,'cfxJoinUrl',s.cfx_join_url,
      'status',s.status,'moderationConfidence',s.moderation_confidence,'moderationScore',s.moderation_score,'createdAt',s.created_at,'updatedAt',s.updated_at),
      concat_ws(' ',s.id,s.name,s.platform_id,s.region,s.language,s.framework,s.description),s.status,s.status in ('pending_review','changes_requested')
    from public.server_submissions s where k='listings'
    union all
    select m.id::text,m.created_at,jsonb_build_object('id',m.id,'kind','moderation','targetType',m.target_type,'targetId',m.target_id,
      'confidence',m.confidence,'score',m.score,'status',m.status,'resolution',m.resolution,'createdAt',m.created_at,'resolvedAt',m.resolved_at),
      concat_ws(' ',m.id,m.target_type,m.target_id,m.confidence,m.resolution),m.status,m.status in ('open','claimed')
    from public.moderation_queue m where k='queue'
  ), scoped as not materialized (
    select * from base b where
      (date_from is null or b.created_at>=date_from) and (date_to is null or b.created_at<=date_to)
      and (q='' or not exists(select 1 from unnest(words) word where position(word in private.moderation_normalize(b.search))=0))
      and (nullif(f->>'userId','') is null or f->>'userId' in (b.data->>'userId',b.data->>'actorId',b.data->>'reporterId',b.data->>'ownerId'))
      and (nullif(f->>'targetId','') is null or b.data->>'targetId'=f->>'targetId')
      and (nullif(f->>'targetType','') is null or b.data->>'targetType'=f->>'targetType')
      and (nullif(f->>'severity','') is null or f->>'severity'='all' or b.data->>'severity'=f->>'severity')
      and (nullif(f->>'feature','') is null or f->>'feature'='all' or exists(select 1 from jsonb_array_elements_text(coalesce(b.data->'tags','[]'::jsonb)) tag where private.moderation_normalize(tag)=private.moderation_normalize(f->>'feature')))
      and (f->>'online' is distinct from 'true' or b.data->>'online'='true')
      and (f->>'verified' is distinct from 'true' or b.data->>'verified'='true')
      and (f->>'beginner' is distinct from 'true' or b.data->>'beginnerFriendly'='true')
  ), marked as not materialized (
    select b.*,
      (nullif(f->>'platform','') is null or f->>'platform'='all' or b.data->>'platform'=f->>'platform') m_platform,
      (nullif(f->>'region','') is null or f->>'region'='all' or lower(b.data->>'region')=lower(f->>'region')) m_region,
      (nullif(f->>'mode','') is null or f->>'mode'='all' or private.moderation_normalize(b.data->>'framework')=private.moderation_normalize(f->>'mode')) m_mode,
      (nullif(f->>'access','') is null or f->>'access'='all' or b.data->>'access'=f->>'access') m_access,
      (nullif(f->>'language','') is null or f->>'language'='all' or lower(b.data->>'language')=lower(f->>'language')) m_language
    from scoped b
  ), context as not materialized (
    select * from marked where m_platform and m_region and m_mode and m_access and m_language
  ), filtered as not materialized (
    select * from context b where st='all'
      or (st='active' and b.active)
      or (st='history' and not b.active and b.state<>'deleted')
      or (st not in ('all','active','history') and b.state=st)
  ), page as materialized (
    select * from filtered b where cursor_date is null or (b.created_at,b.id)<(cursor_date,cursor_id)
    order by b.created_at desc,b.id desc limit p_limit+1
  ), shown as materialized (
    select * from page order by created_at desc,id desc limit p_limit
  ), facet_counts as (
    select facet,value,count(*) n from marked b cross join lateral(values
      ('status',state,m_platform and m_region and m_mode and m_access and m_language),
      ('platform',data->>'platform',m_region and m_mode and m_access and m_language),
      ('region',data->>'region',m_platform and m_mode and m_access and m_language),
      ('mode',data->>'framework',m_platform and m_region and m_access and m_language),
      ('access',data->>'access',m_platform and m_region and m_mode and m_language),
      ('language',data->>'language',m_platform and m_region and m_mode and m_access)
    ) vals(facet,value,include) where k in ('members','servers','reports','bans','appeals','profiles','listings','queue')
      and include and nullif(value,'') is not null
      and (facet='status' or st='all' or (st='active' and b.active) or (st='history' and not b.active and b.state<>'deleted') or (st not in ('all','active','history') and b.state=st))
    group by facet,value
  ), facets as (
    select facet,jsonb_agg(jsonb_build_object('value',value,'label',value,'count',n) order by value) vals from facet_counts group by facet
  )
  select jsonb_build_object('kind',k,'items',coalesce((select jsonb_agg(data order by created_at desc,id desc) from shown),'[]'::jsonb),
    'total',(select count(*) from filtered),'generatedAt',statement_timestamp(),'permissions',c,
    'nextCursor',case when (select count(*) from page)>p_limit then (select jsonb_build_object('createdAt',created_at,'id',id) from shown order by created_at,id limit 1) end,
    'facets',coalesce((select jsonb_object_agg(facet,vals) from facets),'{}'::jsonb)) into result;
  return result;
end;
$$;

create or replace function public.staff_moderation_mutate(
  p_kind text,p_id uuid,p_action text,p_data jsonb,p_expected_version bigint,p_reason text,p_request_id text
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  actor uuid:=(select auth.uid()); k text:=lower(btrim(coalesce(p_kind,''))); action text:=lower(btrim(coalesce(p_action,'')));
  d jsonb:=coalesce(p_data,'{}'::jsonb); why text:=btrim(coalesce(p_reason,'')); old_data jsonb; saved jsonb; prior jsonb;
  current_version bigint; protected_owner boolean; target_status text; new_status text;
begin
  if actor is null or (k='member' and not public.has_staff_permission('accounts.manage'))
    or (k='server' and not public.has_staff_permission('servers.manage'))
    or (k='report' and not public.has_staff_permission('reports.resolve'))
    or k not in ('member','server','report') then raise exception 'Record management permission required' using errcode='42501'; end if;
  if p_id is null or p_expected_version is null or p_expected_version<1 or char_length(why) not between 5 and 500
    or jsonb_typeof(d)<>'object' or octet_length(d::text)>20000
    or p_request_id is null or p_request_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    raise exception 'Provide a valid record, version, reason and request ID' using errcode='22023';
  end if;
  if (k in ('member','server') and action<>'edit') or (k='report' and action not in ('delete','restore')) then
    raise exception 'Choose a valid record action' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended(actor::text||':'||p_request_id,0));
  select a.after_state into prior from public.staff_audit_events a where a.actor_id=actor and a.request_id=p_request_id
    and a.target_type=k and a.target_id=p_id::text and a.action='moderation.'||k||'.'||lower(btrim(p_action));
  if found then return prior; end if;
  if k='member' then
    if exists(select 1 from jsonb_object_keys(d) key where key not in ('displayName','bio','visibility'))
      or not(d ?& array['displayName','bio','visibility'])
      or exists(select 1 from jsonb_each(d) where jsonb_typeof(value)<>'string')
      or char_length(btrim(d->>'displayName')) not between 2 and 48 or char_length(btrim(d->>'bio'))>500
      or not private.profile_display_name_allowed(btrim(d->>'displayName'))
      or d->>'visibility' not in ('public','members','private')
      or (d->>'displayName') ~ '[<>[:cntrl:]]' or (d->>'bio') ~ '[<>]'
      or regexp_replace(d->>'bio',E'[\n\r\t]','','g') ~ '[[:cntrl:]]' then
      raise exception 'Use a display name of 2–48 characters, a bio up to 500 characters and valid visibility' using errcode='22023'; end if;
    select to_jsonb(p),p.moderation_version into old_data,current_version from public.profiles p where p.id=p_id for update;
    if exists(select 1 from public.staff_memberships where user_id=p_id and role_key='owner' and status='active')
      and not exists(select 1 from public.staff_memberships where user_id=actor and role_key='owner' and status='active') then
      raise exception 'Only the protected owner can edit their profile here' using errcode='42501'; end if;
  elsif k='server' then
    if exists(select 1 from jsonb_object_keys(d) key where key not in ('name','description','platform','region','language','framework','access','communityUrl','websiteUrl','cfxJoinUrl','status','verified','beginnerFriendly'))
      or not(d ?& array['name','description','platform','region','language','framework','access','status','verified','beginnerFriendly'])
      or exists(select 1 from jsonb_each(d) where (key in ('verified','beginnerFriendly') and jsonb_typeof(value)<>'boolean')
        or (key not in ('verified','beginnerFriendly') and jsonb_typeof(value) not in ('string','null')))
      or char_length(btrim(coalesce(d->>'name',''))) not between 3 and 80
      or char_length(btrim(coalesce(d->>'description',''))) not between 40 and 3000
      or char_length(btrim(coalesce(d->>'region',''))) not between 2 and 60
      or char_length(btrim(coalesce(d->>'language',''))) not between 2 and 60
      or char_length(coalesce(d->>'framework',''))>80
      or coalesce(d->>'access','') not in ('public','allowlisted','application')
      or coalesce(d->>'status','') not in ('draft','pending_review','published','suspended','rejected','archived')
      or not exists(select 1 from public.platforms where id=d->>'platform')
      or exists(select 1 from jsonb_each_text(d) where key not in ('verified','beginnerFriendly') and (value~'[<>]' or regexp_replace(value,E'[\n\r\t]','','g')~'[[:cntrl:]]'))
      or exists(select 1 from jsonb_each_text(d) where key in ('communityUrl','websiteUrl') and nullif(btrim(value),'') is not null
        and (char_length(value)>500 or value !~* '^https://[a-z0-9]([a-z0-9.-]*[a-z0-9])?\.[a-z]{2,}(:[0-9]{1,5})?([/?#][^[:space:]]*)?$'))
      or (nullif(btrim(d->>'cfxJoinUrl'),'') is not null and (char_length(d->>'cfxJoinUrl')>100 or d->>'cfxJoinUrl' !~* '^https://cfx\.re/join/[a-z0-9]{3,32}/?$')) then
      raise exception 'Check the server metadata, HTTPS links and publication state' using errcode='22023'; end if;
    select to_jsonb(s),s.moderation_version into old_data,current_version from public.servers s where s.id=p_id for update;
  else
    if d<>'{}'::jsonb then raise exception 'Report actions do not accept edited content' using errcode='22023'; end if;
    select to_jsonb(r),r.moderation_version into old_data,current_version from public.reports r where r.id=p_id for update;
  end if;
  if old_data is null then raise exception 'Record not found' using errcode='P0002'; end if;
  if current_version<>p_expected_version then raise exception 'This record changed. Reload before saving.' using errcode='40001'; end if;
  if k='member' then
    update public.profiles set display_name=btrim(d->>'displayName'),bio=btrim(d->>'bio'),profile_visibility=d->>'visibility',updated_at=statement_timestamp() where id=p_id;
    select jsonb_build_object('id',p.id,'kind',k,'version',p.moderation_version,'displayName',p.display_name,'bio',p.bio,'visibility',p.profile_visibility,'bioStatus',p.bio_review_status,'updatedAt',p.updated_at) into saved from public.profiles p where id=p_id;
  elsif k='server' then
    update public.servers set name=btrim(d->>'name'),description=btrim(d->>'description'),platform_id=d->>'platform',
      region=btrim(d->>'region'),language=btrim(d->>'language'),framework=nullif(btrim(d->>'framework'),''),access_type=d->>'access',
      community_url=nullif(btrim(d->>'communityUrl'),''),website_url=nullif(btrim(d->>'websiteUrl'),''),cfx_join_url=nullif(btrim(d->>'cfxJoinUrl'),''),
      status=d->>'status',verified=(d->>'verified')::boolean,beginner_friendly=(d->>'beginnerFriendly')::boolean,
      published_at=case when d->>'status'='published' then coalesce(published_at,statement_timestamp()) else published_at end,updated_at=statement_timestamp() where id=p_id;
    select jsonb_build_object('id',s.id,'kind',k,'version',s.moderation_version,'status',s.status,'updatedAt',s.updated_at,
      'name',s.name,'description',s.description,'platform',s.platform_id,'region',s.region,'language',s.language,'framework',s.framework,
      'access',s.access_type,'communityUrl',s.community_url,'websiteUrl',s.website_url,'cfxJoinUrl',s.cfx_join_url,
      'verified',s.verified,'beginnerFriendly',s.beginner_friendly) into saved from public.servers s where id=p_id;
  else
    if action='delete' then
      if old_data->>'deleted_at' is not null then raise exception 'Report is already deleted' using errcode='40001'; end if;
      update public.reports set deleted_at=statement_timestamp(),deleted_by=actor,deleted_reason=why,deleted_from_status=status,status='dismissed',updated_at=statement_timestamp() where id=p_id;
    else
      if old_data->>'deleted_at' is null then raise exception 'Report is not deleted' using errcode='40001'; end if;
      update public.reports set status=coalesce(deleted_from_status,'open'),deleted_at=null,deleted_by=null,deleted_reason=null,deleted_from_status=null,updated_at=statement_timestamp() where id=p_id;
    end if;
    select jsonb_build_object('id',r.id,'kind',k,'version',r.moderation_version,'status',r.status,'deletedAt',r.deleted_at,'updatedAt',r.updated_at) into saved from public.reports r where id=p_id;
  end if;
  insert into public.staff_audit_events(actor_id,action,target_type,target_id,reason,request_id,before_state,after_state)
  values(actor,'moderation.'||k||'.'||action,k,p_id::text,why,p_request_id,old_data,saved);
  return saved;
end;
$$;

revoke all on function public.staff_moderation_summary(),public.staff_moderation_records(text,jsonb,jsonb,integer),
  public.staff_moderation_mutate(text,uuid,text,jsonb,bigint,text,text) from public,anon,service_role;
grant execute on function public.staff_moderation_summary(),public.staff_moderation_records(text,jsonb,jsonb,integer),
  public.staff_moderation_mutate(text,uuid,text,jsonb,bigint,text,text) to authenticated;

-- Add the existing advert permission to website overview controls.
create or replace function public.staff_website_overview(p_range text default '30d')
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := statement_timestamp();
  v_today date := (v_now at time zone 'UTC')::date;
  v_range text := lower(btrim(coalesce(p_range, '30d')));
  v_start date;
  v_first date;
  v_bucket_days integer := 1;
  v_total bigint;
  v_baseline bigint;
  v_new bigint;
  v_series jsonb;
begin
  -- has_staff_permission enforces the Discord allowlist and configured MFA.
  if (select auth.uid()) is null or not public.has_staff_permission('website.overview.read') then
    raise exception 'Website overview permission required' using errcode = '42501';
  end if;
  if v_range not in ('30d', '90d', '180d', '1y', 'max') then
    raise exception 'Choose 30d, 90d, 180d, 1y or max' using errcode = '22023';
  end if;

  select count(*), min((u.created_at at time zone 'UTC')::date)
    into v_total, v_first
  from auth.users u
  where u.deleted_at is null and not coalesce(u.is_anonymous, false)
    and u.created_at <= v_now;

  v_start := case v_range
    when '30d' then v_today - 29
    when '90d' then v_today - 89
    when '180d' then v_today - 179
    when '1y' then (v_today - interval '1 year')::date + 1
    else coalesce(v_first, v_today)
  end;
  v_bucket_days := case v_range
    when '1y' then 7
    when 'max' then greatest(1, ceil((v_today - v_start + 1) / 366.0)::integer)
    else 1
  end;

  select count(*) into v_baseline
  from auth.users u
  where u.deleted_at is null and not coalesce(u.is_anonymous, false)
    and u.created_at < (v_start::timestamp at time zone 'UTC');

  -- Aggregate the source once. Zero-filled bounded buckets keep long histories
  -- responsive without dropping registrations or estimating any totals.
  with registrations as (
    select ((u.created_at at time zone 'UTC')::date - v_start) / v_bucket_days as bucket,
      count(*) as registrations
    from auth.users u
    where u.deleted_at is null and not coalesce(u.is_anonymous, false)
      and u.created_at >= (v_start::timestamp at time zone 'UTC')
      and u.created_at <= v_now
    group by 1
  ), buckets as (
    select i as bucket, v_start + i * v_bucket_days as start_date,
      least(v_today, v_start + (i + 1) * v_bucket_days - 1) as end_date,
      coalesce(r.registrations, 0) as new_users
    from generate_series(0, (v_today - v_start) / v_bucket_days) i
    left join registrations r on r.bucket = i
  ), totals as (
    select *, v_baseline + sum(new_users) over (order by bucket) as total_users
    from buckets
  )
  select coalesce(sum(new_users), 0), coalesce(jsonb_agg(jsonb_build_object(
    'date', start_date, 'endDate', end_date,
    'newUsers', new_users, 'totalUsers', total_users
  ) order by bucket), '[]'::jsonb)
  into v_new, v_series from totals;

  return jsonb_build_object(
    'generatedAt', v_now,
    'metrics', jsonb_build_object(
      'totalUsers', v_total,
      'publishedServers', (select count(*) from public.servers where status = 'published' and age_rating <> 'adult'),
      'publishedBlogs', (select count(*) from public.blog_posts where status = 'published' and published_at <= v_now),
      'activeStaff', (select count(distinct sm.user_id)
        from public.staff_memberships sm
        join auth.users u on u.id = sm.user_id and u.deleted_at is null and not coalesce(u.is_anonymous, false)
        join auth.identities i on i.user_id = sm.user_id and i.provider = 'discord'
        join private.discord_owner_allowlist a
          on a.discord_user_id = coalesce(i.provider_id, i.identity_data->>'provider_id', i.identity_data->>'sub')
          and a.enabled and a.role_key = sm.role_key
        where sm.status = 'active' and 1 = (select count(*) from auth.identities x where x.user_id = sm.user_id))
    ),
    'users', jsonb_build_object(
      'range', v_range, 'startDate', v_start, 'endDate', v_today,
      'granularity', case v_bucket_days when 1 then 'day' when 7 then 'week' else 'interval' end,
      'bucketDays', v_bucket_days, 'baseline', v_baseline, 'total', v_total,
      'newUsers', v_new, 'series', v_series,
      'definition', 'Currently registered accounts by registration date; excludes deleted and anonymous accounts. Not website visitors.'
    ),
    'permissions', jsonb_build_object(
      'manageRoles', public.has_staff_permission('staff.manage')
        and public.has_staff_permission('staff.permissions.manage')
        and exists(select 1 from public.staff_memberships where user_id = (select auth.uid()) and role_key = 'owner' and status = 'active'),
      'manageBlogs', public.has_staff_permission('blogs.manage'),
      'manageAdverts', public.has_staff_permission('adverts.manage'),
      'manageAnnouncements', public.has_staff_permission('announcements.manage')
    )
  );
end;
$$;

commit;
