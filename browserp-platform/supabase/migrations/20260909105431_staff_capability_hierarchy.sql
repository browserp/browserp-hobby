-- Approved hierarchy. Preserve membership keys and historical audit references.
begin;
insert into public.staff_roles(key,name,description,rank,protected,is_custom,version) values
 ('custom_full_access','Management','Leads staff and all operational panel work below the owner.',900,true,false,1),
 ('head_administrator','Head Admin','Leads administration and all operational panel work below Management.',850,true,false,1),
 ('community_moderator','Community Moderator','Reviews community comments and reports; escalates enforcement.',200,false,false,1)
on conflict(key) do update set name=excluded.name,description=excluded.description,rank=excluded.rank,
 protected=excluded.protected,is_custom=false,version=public.staff_roles.version+1;
update public.staff_roles set name=case key when 'administrator' then 'Admin' when 'senior_moderator' then 'Senior Moderator' else name end,
 version=version+1 where key in ('administrator','senior_moderator');

insert into public.permissions(key,description) values
 ('staff.read','View the staff hierarchy and role capabilities.'),
 ('staff.requests.create','Request a reviewed staff appointment or role change.'),
 ('staff.requests.review','Review requested staff changes within your appointment authority.')
on conflict(key) do update set description=excluded.description;

delete from public.staff_role_permissions where role_key in
 ('owner','custom_full_access','head_administrator','administrator','senior_moderator','moderator','community_moderator','support');
insert into public.staff_role_permissions(role_key,permission_key)
select r.key,p.key from public.staff_roles r cross join public.permissions p
where r.key in ('owner','custom_full_access','head_administrator')
 or (r.key='administrator' and p.key not in ('staff.permissions.manage','security.network.approve','security.reveal'))
 or (r.key='senior_moderator' and p.key=any(array['website.overview.read','staff.read','staff.manage','staff.requests.create','staff.requests.review',
   'reports.read','reports.resolve','moderation.read','moderation.resolve','profiles.review','accounts.read','bans.manage',
   'servers.review','servers.enforce','users.enforce','appeals.review','developers.verify','advertising.review','audit.read','announcements.manage']))
 or (r.key='moderator' and p.key=any(array['website.overview.read','staff.read','staff.manage','staff.requests.create','staff.requests.review',
   'reports.read','reports.resolve','moderation.read','moderation.resolve','profiles.review','accounts.read','bans.manage','servers.review','announcements.manage']))
 or (r.key='community_moderator' and p.key=any(array['website.overview.read','staff.read','staff.requests.create','reports.read','reports.resolve','moderation.read','moderation.resolve']))
 or (r.key='support' and p.key=any(array['website.overview.read','staff.read','staff.requests.create','reports.read']));
-- Existing custom ranks retain their deliberate grants; give them safe catalogue
-- access without guessing authority from a display name or legacy alias.
insert into public.staff_role_permissions(role_key,permission_key)
select r.key,'staff.read' from public.staff_roles r on conflict do nothing;

create function private.is_active_staff_member(p_user uuid)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.staff_memberships m
   join public.staff_roles r on r.key=m.role_key
   join auth.users u on u.id=m.user_id and u.deleted_at is null and not coalesce(u.is_anonymous,false)
   join auth.identities i on i.user_id=m.user_id and i.provider='discord'
   join private.discord_owner_allowlist a on a.discord_user_id=coalesce(i.provider_id,i.identity_data->>'provider_id',i.identity_data->>'sub')
     and a.enabled and a.role_key=m.role_key
   where m.user_id=p_user and m.status='active' and 1=(select count(*) from auth.identities x where x.user_id=p_user)
   and not exists(select 1 from public.security_bans b where b.user_id=p_user and b.target_type='account' and b.revoked_at is null
     and b.starts_at<=clock_timestamp() and (b.ends_at is null or b.ends_at>clock_timestamp())));
$$;
revoke all on function private.is_active_staff_member(uuid) from public,anon,authenticated,service_role;

create function private.staff_permission_within_rank(p_permission text,p_rank integer)
returns boolean language sql immutable set search_path='' as $$
 select coalesce(p_rank,0)>=case
   when p_permission in ('staff.permissions.manage','security.network.approve') then 850
   when p_permission in ('staff.manage','staff.requests.review','bans.manage','users.enforce') then 300
   else 1 end;
$$;
revoke all on function private.staff_permission_within_rank(text,integer) from public,anon,authenticated,service_role;

-- Rank comes from all stored staff memberships/mappings, never profile labels,
-- recognition badges, custom names or a permission override. The current schema
-- permits one membership per account; MAX also protects inconsistent mappings.
create function private.staff_target_rank(p_user uuid,p_discord text default null)
returns integer language sql stable security definer set search_path='' as $$
 select coalesce(max(r.rank),0)::integer from public.staff_roles r where r.key in (
   select m.role_key from public.staff_memberships m where m.user_id=p_user or exists(
     select 1 from auth.identities i where i.user_id=m.user_id and i.provider='discord'
       and coalesce(i.provider_id,i.identity_data->>'provider_id',i.identity_data->>'sub')=p_discord)
   union select a.role_key from private.discord_owner_allowlist a where a.discord_user_id=p_discord
     or exists(select 1 from auth.identities i where i.user_id=p_user and i.provider='discord'
       and coalesce(i.provider_id,i.identity_data->>'provider_id',i.identity_data->>'sub')=a.discord_user_id));
$$;
revoke all on function private.staff_target_rank(uuid,text) from public,anon,authenticated,service_role;

create function private.require_staff_authority(p_permission text)
returns integer language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); authority integer;
begin
 perform private.require_member_write_session(actor);
 if not private.is_active_staff_member(actor) or not public.has_staff_permission(p_permission) then
   raise exception 'Your current staff role does not permit this action.' using errcode='42501';
 end if;
 select r.rank into authority from public.staff_memberships m join public.staff_roles r on r.key=m.role_key where m.user_id=actor and m.status='active';
 if not private.staff_permission_within_rank(p_permission,authority) then
   raise exception 'This action requires a higher staff rank.' using errcode='42501';
 end if;
 return authority;
end;
$$;
revoke all on function private.require_staff_authority(text) from public,anon,authenticated,service_role;

create function private.staff_can_delegate_role(p_role text,p_user uuid default null)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.staff_roles where key=p_role) and not exists(
   select 1 from public.permissions p where coalesce(
     (select o.allowed from public.staff_permission_overrides o where o.user_id=p_user and o.permission_key=p.key),
     exists(select 1 from public.staff_role_permissions rp where rp.role_key=p_role and rp.permission_key=p.key))
   and (not public.has_staff_permission(p.key)
     or not private.staff_permission_within_rank(p.key,(select rank from public.staff_roles where key=p_role))));
$$;
revoke all on function private.staff_can_delegate_role(text,uuid) from public,anon,authenticated,service_role;

create function private.require_staff_dominance(p_permission text,p_user uuid,p_discord text default null,p_proposed_role text default null)
returns integer language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); authority integer; proposed integer;
begin
 perform pg_advisory_xact_lock(hashtextextended('browserp.staff.authority',0));
 perform 1 from public.staff_memberships where user_id in (actor,p_user) order by user_id for update;
 perform 1 from private.discord_owner_allowlist where discord_user_id=p_discord for update;
 authority:=private.require_staff_authority(p_permission);
 if p_user=actor or exists(select 1 from auth.identities i where i.user_id=actor and i.provider='discord'
   and coalesce(i.provider_id,i.identity_data->>'provider_id',i.identity_data->>'sub')=p_discord) then
   raise exception 'You cannot change your own authority or restrict yourself.' using errcode='42501';
 end if;
 if private.staff_target_rank(p_user,p_discord)>=authority then
   raise exception 'You can only manage accounts below your own staff rank.' using errcode='42501';
 end if;
 if p_proposed_role is not null then
   select rank into proposed from public.staff_roles where key=p_proposed_role for share;
   if proposed is null or proposed>=authority or (authority<800 and proposed>200) then
     raise exception 'You can only appoint roles within your lower-rank responsibilities.' using errcode='42501';
   end if;
   -- A lower custom title cannot smuggle governance powers past its rank.
   if exists(select 1 from public.staff_role_permissions rp where rp.role_key=p_proposed_role
       and not private.staff_permission_within_rank(rp.permission_key,proposed)) then
     raise exception 'This role has permissions above its rank; management must repair it.' using errcode='42501';
   end if;
   if not private.staff_can_delegate_role(p_proposed_role,p_user) then
     raise exception 'You cannot delegate permissions unavailable to your own account, including retained overrides.' using errcode='42501';
   end if;
 end if;
 return authority;
end;
$$;
revoke all on function private.require_staff_dominance(text,uuid,text,text) from public,anon,authenticated,service_role;

create table private.staff_access_requests (
 id uuid primary key default gen_random_uuid(), requested_by uuid not null references auth.users(id) on delete cascade,
 request_key uuid not null, discord_user_id text not null check(discord_user_id ~ '^[0-9]{17,20}$'),
 action text not null check(action in ('assign','change_role','suspend','reactivate','revoke')),
 role_key text references public.staff_roles(key), expected_access_version bigint not null check(expected_access_version>=0),
 reason text not null check(char_length(reason) between 5 and 500),
 status text not null default 'pending' check(status in ('pending','approved','denied')),
 version bigint not null default 1, reviewed_by uuid references public.profiles(id) on delete set null,
 decision_reason text, created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp(),
 unique(requested_by,request_key)
);
alter table private.staff_access_requests enable row level security;
revoke all on private.staff_access_requests from public,anon,authenticated,service_role;
create index staff_access_requests_queue on private.staff_access_requests(status,created_at desc);

create function private.staff_access_request_item(r private.staff_access_requests)
returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('id',r.id,'discordUserId',r.discord_user_id,'action',r.action,'roleKey',r.role_key,
   'reason',r.reason,'status',r.status,'version',r.version,'expectedAccessVersion',r.expected_access_version,
   'decisionReason',r.decision_reason,'createdAt',r.created_at,'updatedAt',r.updated_at);
$$;
revoke all on function private.staff_access_request_item(private.staff_access_requests) from public,anon,authenticated,service_role;

create function public.staff_access_request_control()
returns jsonb language plpgsql security definer set search_path='' as $$
declare authority integer:=private.require_staff_authority('staff.read');
begin
 return coalesce((select jsonb_agg(item order by created_at desc) from (
   select private.staff_access_request_item(r)||jsonb_build_object('requestedByMe',r.requested_by=auth.uid(),
     'canReview',r.requested_by<>auth.uid() and public.has_staff_permission('staff.requests.review')
       and private.staff_target_rank(null,r.discord_user_id)<authority and coalesce(sr.rank,0)<authority
       and (authority>=800 or coalesce(sr.rank,0)<=200)) item,r.created_at
   from private.staff_access_requests r left join public.staff_roles sr on sr.key=r.role_key
   where r.requested_by=auth.uid() or (public.has_staff_permission('staff.requests.review')
     and private.staff_target_rank(null,r.discord_user_id)<authority and coalesce(sr.rank,0)<authority
     and (authority>=800 or coalesce(sr.rank,0)<=200))
   order by r.created_at desc,r.id desc limit 50) rows),'[]'::jsonb);
end;
$$;

create function public.staff_request_access(p_discord_user_id text,p_action text,p_role_key text,p_reason text,p_expected_version bigint,p_request_key uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r private.staff_access_requests; current_version bigint; proposed text:=nullif(btrim(p_role_key),'');
begin
 perform pg_advisory_xact_lock(hashtextextended('browserp.staff.authority',0));
 perform private.require_staff_authority('staff.requests.create');
 if p_discord_user_id is null or p_discord_user_id !~ '^[0-9]{17,20}$' or p_action is null
   or p_action not in ('assign','change_role','suspend','reactivate','revoke') or p_request_key is null
   or char_length(btrim(coalesce(p_reason,''))) not between 5 and 500 or p_expected_version is null or p_expected_version<0
   or (p_action in ('assign','change_role') and (proposed is null or proposed='owner' or not exists(select 1 from public.staff_roles where key=proposed)))
   or exists(select 1 from private.discord_owner_allowlist where discord_user_id=p_discord_user_id and role_key='owner') then
   raise exception 'Choose a valid non-owner staff change and reason.' using errcode='22023';
 end if;
 select * into r from private.staff_access_requests where requested_by=auth.uid() and request_key=p_request_key;
 if found then
   if r.discord_user_id is distinct from p_discord_user_id or r.action is distinct from p_action or r.role_key is distinct from proposed
     or r.reason is distinct from btrim(p_reason) or r.expected_access_version is distinct from p_expected_version then
     raise exception 'This request key was already used.' using errcode='PT409';
   end if;
   return private.staff_access_request_item(r);
 end if;
 select version into current_version from private.discord_owner_allowlist where discord_user_id=p_discord_user_id for update;
 if coalesce(current_version,0)<>p_expected_version or (p_action='assign')<>(current_version is null) then
   raise exception 'Staff access changed. Reload before requesting a change.' using errcode='PT409';
 end if;
 perform private.require_staff_authority('staff.requests.create');
 perform private.enforce_member_rate_limit('staff-role-request',10,3600);
 perform private.require_staff_authority('staff.requests.create');
 insert into private.staff_access_requests(requested_by,request_key,discord_user_id,action,role_key,reason,expected_access_version)
 values(auth.uid(),p_request_key,p_discord_user_id,p_action,proposed,btrim(p_reason),p_expected_version) returning * into r;
 insert into public.staff_audit_events(actor_id,action,target_type,target_id,reason,request_id,after_state)
 values(auth.uid(),'staff.access.requested','staff_access_request',r.id::text,r.reason,p_request_key::text,private.staff_access_request_item(r));
 perform private.require_staff_authority('staff.requests.create');
 return private.staff_access_request_item(r);
end;
$$;

create function public.staff_decide_access_request(p_id uuid,p_expected_version bigint,p_approve boolean,p_reason text,p_request_id text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r private.staff_access_requests; target uuid; result jsonb;
begin
 perform pg_advisory_xact_lock(hashtextextended('browserp.staff.authority',0));
 perform private.require_staff_authority('staff.requests.review');
 select * into r from private.staff_access_requests where id=p_id for update;
 if not found or r.status<>'pending' or p_expected_version is null or r.version<>p_expected_version then
   raise exception 'This request changed or was already reviewed.' using errcode='PT409';
 end if;
 if r.requested_by=auth.uid() then raise exception 'Another authorised staff member must review your request.' using errcode='42501'; end if;
 if p_approve is null or char_length(btrim(coalesce(p_reason,''))) not between 5 and 500
   or p_request_id is null or p_request_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
   raise exception 'A decision, reason and request ID are required.' using errcode='22023'; end if;
 select user_id into target from auth.identities where provider='discord' and coalesce(provider_id,identity_data->>'provider_id',identity_data->>'sub')=r.discord_user_id limit 1;
 perform private.require_staff_dominance('staff.manage',target,r.discord_user_id,r.role_key);
 if p_approve then
   result:=public.staff_mutate_access(r.discord_user_id,r.action,r.role_key,btrim(p_reason),r.expected_access_version,p_request_id);
 end if;
 perform private.require_staff_authority('staff.requests.review');
 update private.staff_access_requests set status=case when p_approve then 'approved' else 'denied' end,version=version+1,
   decision_reason=btrim(p_reason),reviewed_by=auth.uid(),updated_at=clock_timestamp() where id=r.id returning * into r;
 insert into public.staff_audit_events(actor_id,action,target_type,target_id,reason,request_id,after_state)
 values(auth.uid(),'staff.access.request_decided','staff_access_request',r.id::text,btrim(p_reason),p_request_id,private.staff_access_request_item(r));
 perform private.require_staff_authority('staff.requests.review');
 return private.staff_access_request_item(r);
end;
$$;

-- New private request records participate in the existing owner-bound copy.
alter function private.member_export_records(uuid) rename to member_export_records_before_staff_requests;
revoke all on function private.member_export_records_before_staff_requests(uuid) from public,anon,authenticated,service_role;
create function private.member_export_records(p_subject uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb; data jsonb; n bigint; bytes bigint; total_rows bigint;
begin
 if p_subject is distinct from private.require_active_member() then raise exception 'Only your own account can be copied.' using errcode='42501'; end if;
 result:=private.member_export_records_before_staff_requests(p_subject);
 select coalesce(sum(value::bigint),0) into total_rows from jsonb_each_text(result->'counts');
 select count(*),coalesce(sum(octet_length(item::text)),0) into n,bytes from (
   select private.staff_access_request_item(r) item from private.staff_access_requests r where r.requested_by=p_subject order by r.id limit 2001) bounded;
 if n>2000 or total_rows+n>10000 or octet_length((result->'collections')::text)+bytes>2000000 then
   raise exception 'This account needs a larger export. Your request remains open for staff follow-up.' using errcode='PT413';
 end if;
 select coalesce(jsonb_agg(item),'[]'::jsonb) into data from (
   select private.staff_access_request_item(r) item from private.staff_access_requests r where r.requested_by=p_subject order by r.id limit 2001) bounded;
 result:=jsonb_set(result,'{collections}',(result->'collections')||jsonb_build_object('staffAccessRequests',data));
 result:=jsonb_set(result,'{counts}',(result->'counts')||jsonb_build_object('staffAccessRequests',n));
 if octet_length((result->'collections')::text)>2000000 or octet_length(result::text)>2097152 then
   raise exception 'This account needs a larger export. Your request remains open for staff follow-up.' using errcode='PT413';
 end if;
 return result;
end;
$$;
revoke all on function private.member_export_records(uuid) from public,anon,authenticated,service_role;

-- Permission edits bind to the same version as staff assignments. An older
-- unversioned caller cannot overwrite a changed role or override.
revoke all on function public.staff_mutate_permission(text,text,boolean,text,text) from public,anon,authenticated,service_role;
create function public.staff_mutate_permission(p_discord_user_id text,p_permission_key text,p_allowed boolean,p_reason text,p_request_id text,p_expected_version bigint)
returns jsonb language plpgsql security definer set search_path='' as $$
declare target uuid; authority integer; access_version bigint; before_row jsonb; after_row jsonb;
begin
 perform pg_advisory_xact_lock(hashtextextended('browserp.staff.authority',0));
 perform private.require_staff_authority('staff.permissions.manage');
 select user_id into target from auth.identities where provider='discord'
   and coalesce(provider_id,identity_data->>'provider_id',identity_data->>'sub')=p_discord_user_id limit 1;
 if target is null or char_length(btrim(coalesce(p_reason,''))) not between 5 and 500
   or p_request_id is null or p_request_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
   raise exception 'Choose a staff account and a reason.' using errcode='22023';
 end if;
 authority:=private.require_staff_dominance('staff.permissions.manage',target,p_discord_user_id);
 select version into access_version from private.discord_owner_allowlist where discord_user_id=p_discord_user_id for update;
 if p_expected_version is null or access_version is distinct from p_expected_version then raise exception 'Staff access changed. Reload before saving permissions.' using errcode='PT409'; end if;
 if not exists(select 1 from public.permissions where key=p_permission_key)
   or (coalesce(p_allowed,exists(select 1 from public.staff_memberships m join public.staff_role_permissions rp on rp.role_key=m.role_key
       where m.user_id=target and rp.permission_key=p_permission_key)) and (not public.has_staff_permission(p_permission_key)
     or not private.staff_permission_within_rank(p_permission_key,private.staff_target_rank(target,p_discord_user_id)))) then
   raise exception 'This permission is outside the current role hierarchy.' using errcode='42501';
 end if;
 select to_jsonb(o) into before_row from public.staff_permission_overrides o where user_id=target and permission_key=p_permission_key;
 if p_allowed is null then delete from public.staff_permission_overrides where user_id=target and permission_key=p_permission_key;
 else
   insert into public.staff_permission_overrides(user_id,permission_key,allowed,reason,changed_by)
   values(target,p_permission_key,p_allowed,btrim(p_reason),auth.uid()) on conflict(user_id,permission_key) do update
   set allowed=excluded.allowed,reason=excluded.reason,changed_by=excluded.changed_by,updated_at=clock_timestamp();
 end if;
 perform private.require_staff_authority('staff.permissions.manage');
 update private.discord_owner_allowlist set version=version+1,updated_at=clock_timestamp() where discord_user_id=p_discord_user_id returning version into access_version;
 select to_jsonb(o) into after_row from public.staff_permission_overrides o where user_id=target and permission_key=p_permission_key;
 insert into public.staff_audit_events(actor_id,action,target_type,target_id,reason,request_id,before_state,after_state)
 values(auth.uid(),'staff.permission.changed','staff_permission',target::text||':'||p_permission_key,btrim(p_reason),p_request_id,before_row,after_row);
 perform private.require_staff_authority('staff.permissions.manage');
 return jsonb_build_object('userId',target,'permission',p_permission_key,'allowed',p_allowed,'version',access_version);
end;
$$;

create or replace function public.staff_permission_control()
returns jsonb language plpgsql security definer set search_path='' as $$
declare authority integer:=private.require_staff_authority('staff.permissions.manage');
begin
 return jsonb_build_object('permissions',(select coalesce(jsonb_agg(jsonb_build_object('key',key,'description',description,
   'delegatable',public.has_staff_permission(key),'minimumRank',case when key in ('staff.permissions.manage','security.network.approve') then 850
     when key in ('staff.manage','staff.requests.review','bans.manage','users.enforce') then 300 else 1 end) order by key),'[]'::jsonb) from public.permissions),
   'defaults',(select coalesce(jsonb_agg(jsonb_build_object('roleKey',role_key,'permissionKey',permission_key)),'[]'::jsonb) from public.staff_role_permissions),
   'overrides',(select coalesce(jsonb_agg(jsonb_build_object('userId',o.user_id,'permissionKey',o.permission_key,'allowed',o.allowed,
      'reason',o.reason,'updatedAt',o.updated_at)),'[]'::jsonb) from public.staff_permission_overrides o
     where o.user_id<>auth.uid() and private.staff_target_rank(o.user_id)<authority));
end;
$$;

create function private.staff_restriction_limit(p_rank integer)
returns integer language sql immutable set search_path='' as $$
 select case when p_rank>=900 then null when p_rank>=850 then 43200 when p_rank>=800 then 10080 when p_rank>=500 then 4320 when p_rank>=300 then 2880 else 0 end;
$$;
revoke all on function private.staff_restriction_limit(integer) from public,anon,authenticated,service_role;

alter table public.security_bans add column restriction_episode_started_at timestamptz,
 add column restriction_authority_rank integer;
create index security_bans_episode_lookup on public.security_bans(target_type,target_hash,ends_at);

create function private.apply_staff_restriction(p_user uuid,p_target_type text,p_target_hash text,p_scope text,p_reason_code text,p_reason text,p_minutes integer,p_request_id text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare authority integer; max_minutes integer; id uuid:=gen_random_uuid(); reference text; expires timestamptz; begins timestamptz;
 episode_start timestamptz; previous_authority integer; retired public.security_bans;
begin
 authority:=private.require_staff_dominance('bans.manage',p_user);
 max_minutes:=private.staff_restriction_limit(authority);
 if p_user is null or p_target_hash is null or p_target_type is null or p_target_type not in ('account','device','network_prefix')
   or p_scope is null or p_scope not in ('platform','account','listing','community')
   or char_length(btrim(coalesce(p_reason,''))) not between 10 and 1000 or char_length(btrim(coalesce(p_reason_code,''))) not between 3 and 80
   or p_request_id is null or p_request_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
   raise exception 'Choose an account, restriction and detailed reason.' using errcode='22023';
 end if;
 if (authority<800 and p_target_type<>'account') or (max_minutes is not null and (p_minutes is null or p_minutes>max_minutes))
   or (p_minutes is not null and p_minutes<5) then
   raise exception 'Choose a timed account restriction within your rank limit.' using errcode='42501';
 end if;
 -- Check current authority immediately before mutation after any awaited locks.
 perform private.require_staff_authority('bans.manage');
 begins:=clock_timestamp(); expires:=case when p_minutes is null then null else begins+make_interval(mins=>p_minutes) end;
 -- An overlapping/quickly replaced restriction keeps its original episode.
 -- Early revocation cannot reset the clock. After five clear minutes beyond
 -- the previous scheduled end, a genuinely separate restriction can begin.
 select min(coalesce(b.restriction_episode_started_at,b.starts_at)),max(coalesce(b.restriction_authority_rank,private.staff_target_rank(b.actor_id)))
 into episode_start,previous_authority
 from public.security_bans b where b.target_type=p_target_type and b.target_hash=p_target_hash
   and coalesce(b.ends_at,b.revoked_at,'infinity'::timestamptz)>=begins-interval '5 minutes';
 -- Higher authority may approve a new window; a same/lower tier cannot reset it.
 episode_start:=case when authority>coalesce(previous_authority,0) then begins else coalesce(episode_start,begins) end;
 if max_minutes is not null and expires>episode_start+make_interval(mins=>max_minutes) then
   raise exception 'This would extend an existing restriction beyond your rank limit. Ask a higher-ranked staff member to review it.' using errcode='42501';
 end if;
 -- Expiry is already enforced by access checks. Retire only expired metadata
 -- here so the existing active-target uniqueness rule permits a later action.
 for retired in update public.security_bans b set revoked_at=begins,revoke_reason='Scheduled restriction expired.'
   where b.target_type=p_target_type and b.target_hash=p_target_hash and b.revoked_at is null
     and b.ends_at is not null and b.ends_at<=begins returning b.* loop
   insert into public.staff_audit_events(actor_id,action,target_type,target_id,reason,request_id,after_state)
   values(auth.uid(),'security.ban.expired','security_ban',retired.id::text,'Scheduled restriction expired.',p_request_id,
     jsonb_build_object('endsAt',retired.ends_at,'retiredAt',begins));
 end loop;
 reference:='BRP-'||upper(left(replace(id::text,'-',''),10));
 insert into public.security_bans(id,user_id,target_type,target_hash,public_reference,scope,reason_code,reason,permanent,actor_id,starts_at,ends_at,restriction_episode_started_at,restriction_authority_rank)
 values(id,p_user,p_target_type,p_target_hash,reference,p_scope,btrim(p_reason_code),btrim(p_reason),p_minutes is null,auth.uid(),begins,expires,episode_start,authority);
 delete from auth.sessions where user_id=p_user;
 insert into public.staff_audit_events(actor_id,action,target_type,target_id,reason,request_id,after_state)
 values(auth.uid(),'security.ban.applied','security_ban',id::text,btrim(p_reason),p_request_id,
   jsonb_build_object('reference',reference,'targetType',p_target_type,'scope',p_scope,'startsAt',begins,'endsAt',expires,'minutes',p_minutes,'episodeStartedAt',episode_start));
 perform private.require_staff_authority('bans.manage');
 return jsonb_build_object('id',id,'reference',reference,'targetType',p_target_type,'startsAt',begins,'endsAt',expires);
end;
$$;
revoke all on function private.apply_staff_restriction(uuid,text,text,text,text,text,integer,text) from public,anon,authenticated,service_role;

create function public.staff_restrict_account(p_user_id uuid,p_minutes integer,p_reason_code text,p_reason text,p_request_id text)
returns jsonb language plpgsql security definer set search_path='' as $$
begin
 return private.apply_staff_restriction(p_user_id,'account',encode(sha256(convert_to(p_user_id::text,'UTF8')),'hex'),
   'account',p_reason_code,p_reason,p_minutes,p_request_id);
end;
$$;

create function public.staff_apply_security_ban(p_activity_id bigint,p_target_type text,p_scope text,p_reason_code text,p_reason text,p_permanent boolean,p_request_id text,p_minutes integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare activity public.account_activity; evidence private.network_evidence; target_hash text;
begin
 perform pg_advisory_xact_lock(hashtextextended('browserp.staff.authority',0));
 perform private.require_staff_authority('bans.manage');
 select * into activity from public.account_activity where id=p_activity_id for share;
 if not found then raise exception 'Account activity not found.' using errcode='PT404'; end if;
 if p_permanent is null or p_permanent<>(p_minutes is null) then raise exception 'Choose an explicit restriction duration.' using errcode='22023'; end if;
 select * into evidence from private.network_evidence where activity_id=p_activity_id for share;
 target_hash:=case p_target_type when 'account' then encode(sha256(convert_to(activity.user_id::text,'UTF8')),'hex')
   when 'device' then evidence.device_hash when 'network_prefix' then evidence.network_hash end;
 return private.apply_staff_restriction(activity.user_id,p_target_type,target_hash,p_scope,p_reason_code,p_reason,p_minutes,p_request_id);
end;
$$;
-- The old seven-argument path still obeys hierarchy and duration limits.
create or replace function public.staff_apply_security_ban(p_activity_id bigint,p_target_type text,p_scope text,p_reason_code text,p_reason text,p_permanent boolean,p_request_id text)
returns jsonb language sql security definer set search_path='' as $$
 select public.staff_apply_security_ban(p_activity_id,p_target_type,p_scope,p_reason_code,p_reason,p_permanent,p_request_id,null);
$$;

create or replace function public.staff_role_control()
returns jsonb language plpgsql security definer set search_path='' as $$
declare authority integer:=private.require_staff_authority('staff.read');
begin
 return jsonb_build_object('actorRank',authority,
   'canAssign',public.has_staff_permission('staff.manage'),'canEditRoles',public.has_staff_permission('staff.permissions.manage'),
   'canRequest',public.has_staff_permission('staff.requests.create'),'canReviewRequests',public.has_staff_permission('staff.requests.review'),
   'roles',coalesce((select jsonb_agg(jsonb_build_object('key',r.key,'name',r.name,'description',r.description,
     'rank',r.rank,'custom',r.is_custom,'version',r.version,
     'assignable',public.has_staff_permission('staff.manage') and r.rank<authority and (authority>=800 or r.rank<=200) and private.staff_can_delegate_role(r.key),
     'editable',public.has_staff_permission('staff.permissions.manage') and r.rank<authority,
     'memberCount',(select count(*) from private.discord_owner_allowlist a where a.role_key=r.key and a.enabled),
     'permissions',coalesce((select jsonb_agg(permission_key order by permission_key) from public.staff_role_permissions where role_key=r.key),'[]'::jsonb)
   ) order by r.rank desc) from public.staff_roles r),'[]'::jsonb),
   'effectivePermissions',(select coalesce(jsonb_agg(key order by key),'[]'::jsonb) from public.permissions where public.has_staff_permission(key)),
   'permissions',(select coalesce(jsonb_agg(jsonb_build_object('key',p.key,'description',p.description) order by p.key),'[]'::jsonb)
     from public.permissions p where public.has_staff_permission(p.key)));
end;
$$;

create or replace function public.staff_list_access()
returns jsonb language plpgsql security definer set search_path='' as $$
declare authority integer:=private.require_staff_authority('staff.read');
begin
 return jsonb_build_object('members',coalesce((select jsonb_agg(private.staff_access_snapshot(a.discord_user_id)||jsonb_build_object(
    'userId',i.user_id,'rank',private.staff_target_rank(i.user_id,a.discord_user_id),
    'manageable',public.has_staff_permission('staff.manage') and private.staff_target_rank(i.user_id,a.discord_user_id)<authority and i.user_id is distinct from auth.uid())
    order by r.rank desc,a.discord_user_id)
   from private.discord_owner_allowlist a join public.staff_roles r on r.key=a.role_key
   left join lateral(select x.user_id from auth.identities x where x.provider='discord'
     and coalesce(x.provider_id,x.identity_data->>'provider_id',x.identity_data->>'sub')=a.discord_user_id order by x.created_at limit 1) i on true
   where public.has_staff_permission('staff.manage') or i.user_id=auth.uid()),'[]'::jsonb),
   'roles',(public.staff_role_control())->'roles');
end;
$$;

create or replace function public.has_staff_permission(p_permission text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.staff_memberships sm
    join auth.identities i on i.user_id=sm.user_id and i.provider='discord'
    join private.discord_owner_allowlist a
      on a.discord_user_id=coalesce(i.provider_id,i.identity_data->>'provider_id',i.identity_data->>'sub')
     and a.enabled and a.role_key=sm.role_key
    where sm.user_id=(select auth.uid())
      and sm.status='active'
      and private.staff_permission_within_rank(p_permission,(select rank from public.staff_roles where key=sm.role_key))
      and (select private.member_access_allowed())
      and coalesce((select auth.jwt())->'app_metadata'->>'provider','')='discord'
      and coalesce((select auth.jwt())->'amr','[]'::jsonb) @> '[{"method":"oauth"}]'::jsonb
      and (
        not coalesce((select s.staff_mfa_required from private.platform_security_settings s where s.singleton), false)
        or (
          coalesce((select auth.jwt())->>'aal','aal1')='aal2'
          and coalesce((select auth.jwt())->'amr','[]'::jsonb) @> '[{"method":"totp"}]'::jsonb
        )
      )
      and 1=(select count(*) from auth.identities x where x.user_id=sm.user_id)
      and coalesce(
        (select o.allowed from public.staff_permission_overrides o
         where o.user_id=sm.user_id and o.permission_key=p_permission),
        exists (select 1 from public.staff_role_permissions rp
                where rp.role_key=sm.role_key and rp.permission_key=p_permission)
      )
  );
$$;

create or replace function public.staff_mutate_access(
  p_discord_user_id text,
  p_action text,
  p_role_key text,
  p_reason text,
  p_expected_version bigint,
  p_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_action text := lower(btrim(coalesce(p_action, '')));
  v_discord_user_id text := btrim(coalesce(p_discord_user_id, ''));
  v_role_key text := lower(btrim(coalesce(p_role_key, '')));
  v_reason text := btrim(coalesce(p_reason, ''));
  v_existing private.discord_owner_allowlist%rowtype;
  v_target_user uuid;
  v_before jsonb;
  v_after jsonb;
  v_prior_result jsonb; v_input jsonb; v_prior_input jsonb;
begin
  perform private.require_staff_authority('staff.manage');

  if v_discord_user_id !~ '^[0-9]{17,20}$' then
    raise exception 'Invalid Discord user ID';
  end if;
  if v_action not in ('assign', 'change_role', 'suspend', 'reactivate', 'revoke') then
    raise exception 'Invalid staff access action';
  end if;
  if char_length(v_reason) < 5 or char_length(v_reason) > 500 then
    raise exception 'A reason between 5 and 500 characters is required';
  end if;
  if p_expected_version is null or p_expected_version < 0 then
    raise exception 'A valid expected version is required' using errcode = '40001';
  end if;
  if p_request_id is null
     or p_request_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    raise exception 'A request ID is required';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('browserp.staff.authority',0));
  perform private.require_staff_authority('staff.manage');
  v_input:=jsonb_build_object('discord',v_discord_user_id,'action',v_action,'role',v_role_key,'reason',v_reason,'version',p_expected_version);
  -- A provider retry with the same trusted request ID must observe the first
  -- result, including when both calls arrive concurrently.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(v_actor::text || ':' || p_request_id, 0)
  );

  select sae.after_state,sae.metadata->'input'
    into v_prior_result,v_prior_input
  from public.staff_audit_events sae
  where sae.actor_id = v_actor
    and sae.request_id = p_request_id
  order by sae.id desc
  limit 1;
  if found then
    if v_prior_input is distinct from v_input then raise exception 'This request ID was already used for a different change.' using errcode='PT409'; end if;
    return v_prior_result;
  end if;

  select *
    into v_existing
  from private.discord_owner_allowlist a
  where a.discord_user_id = v_discord_user_id
  for update;

  if found and v_existing.role_key = 'owner' then
    raise exception 'The protected owner cannot be changed here' using errcode = '42501';
  end if;
  if v_action in ('assign', 'change_role')
     and (v_role_key = 'owner' or not exists (select 1 from public.staff_roles where key = v_role_key)) then
    raise exception 'Choose an assignable staff role';
  end if;

  if v_action = 'assign' then
    if found or p_expected_version <> 0 then
      raise exception 'Staff access changed; reload before trying again' using errcode = '40001';
    end if;
  else
    if not found then
      raise exception 'Staff access entry was not found';
    end if;
    if v_existing.version <> p_expected_version then
      raise exception 'Staff access changed; reload before trying again' using errcode = '40001';
    end if;
  end if;

  v_before := private.staff_access_snapshot(v_discord_user_id);

  select i.user_id
    into v_target_user
  from auth.identities i
  where i.provider = 'discord'
    and coalesce(
      i.provider_id,
      i.identity_data ->> 'provider_id',
      i.identity_data ->> 'sub'
    ) = v_discord_user_id
  order by i.created_at
  limit 1;

  perform private.require_staff_dominance('staff.manage',v_target_user,v_discord_user_id,case when v_action in ('assign','change_role') then v_role_key when v_action='reactivate' then v_existing.role_key else null end);

  if v_target_user is not null
     and 1 <> (select count(*) from auth.identities i where i.user_id = v_target_user) then
    raise exception 'Target account must remain Discord-only' using errcode = '42501';
  end if;

  if v_action = 'assign' then
    insert into private.discord_owner_allowlist (
      discord_user_id, enabled, note, role_key, updated_at, version
    ) values (
      v_discord_user_id, true, 'Managed through staff hierarchy', v_role_key,
      timezone('utc', now()), 1
    );

    if v_target_user is not null then
      insert into public.staff_memberships as sm (
        user_id, role_key, status, granted_by, reason
      ) values (
        v_target_user, v_role_key, 'active', v_actor, v_reason
      )
      on conflict (user_id) do update set
        role_key = excluded.role_key,
        status = 'active',
        granted_by = excluded.granted_by,
        reason = excluded.reason,
        updated_at = timezone('utc', now());
    end if;
  elsif v_action = 'change_role' then
    update private.discord_owner_allowlist
    set role_key = v_role_key,
        updated_at = timezone('utc', now()),
        version = version + 1
    where discord_user_id = v_discord_user_id;

    if v_target_user is not null then
      update public.staff_memberships
      set role_key = v_role_key,
          granted_by = v_actor,
          reason = v_reason,
          updated_at = timezone('utc', now())
      where user_id = v_target_user;
    end if;
  elsif v_action = 'suspend' then
    if v_target_user is null or not exists (
      select 1 from public.staff_memberships where user_id = v_target_user
    ) then
      raise exception 'Pending access cannot be suspended; revoke it instead';
    end if;

    update public.staff_memberships
    set status = 'suspended',
        reason = v_reason,
        updated_at = timezone('utc', now())
    where user_id = v_target_user;
    update private.discord_owner_allowlist
    set updated_at = timezone('utc', now()), version = version + 1
    where discord_user_id = v_discord_user_id;
  elsif v_action = 'reactivate' then
    update private.discord_owner_allowlist
    set enabled = true,
        updated_at = timezone('utc', now()),
        version = version + 1
    where discord_user_id = v_discord_user_id;

    if v_target_user is not null then
      insert into public.staff_memberships as sm (
        user_id, role_key, status, granted_by, reason
      ) values (
        v_target_user, v_existing.role_key, 'active', v_actor, v_reason
      )
      on conflict (user_id) do update set
        role_key = excluded.role_key,
        status = 'active',
        granted_by = excluded.granted_by,
        reason = excluded.reason,
        updated_at = timezone('utc', now());
    end if;
  elsif v_action = 'revoke' then
    update private.discord_owner_allowlist
    set enabled = false,
        updated_at = timezone('utc', now()),
        version = version + 1
    where discord_user_id = v_discord_user_id;
    if v_target_user is not null then
      update public.staff_memberships
      set status = 'revoked',
          reason = v_reason,
          updated_at = timezone('utc', now())
      where user_id = v_target_user;
    end if;
  end if;

  v_after := private.staff_access_snapshot(v_discord_user_id);

  insert into public.staff_audit_events (
    actor_id,
    action,
    target_type,
    target_id,
    reason,
    request_id,
    before_state,
    after_state,
    metadata
  ) values (
    v_actor,
    'staff.access.' || v_action,
    'staff_access',
    v_discord_user_id,
    v_reason,
    p_request_id,
    v_before,
    v_after,
    jsonb_build_object('requestedRole', nullif(v_role_key, ''),'input',v_input)
  );

  perform private.require_staff_authority('staff.manage');
  return v_after;
end;
$$;

create or replace function public.staff_mutate_role(
  p_key text, p_name text, p_description text, p_permissions text[],
  p_expected_version bigint, p_reason text, p_request_id text
)
returns jsonb language plpgsql security definer set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_key text := lower(btrim(coalesce(p_key,'')));
  v_name text := btrim(coalesce(p_name,''));
  v_description text := btrim(coalesce(p_description,''));
  v_reason text := btrim(coalesce(p_reason,''));
  v_existing public.staff_roles%rowtype;
  v_rank integer; v_authority integer;
  v_before jsonb;
  v_after jsonb;
  v_prior jsonb;
begin
  perform pg_advisory_xact_lock(hashtextextended('browserp.staff.authority',0));
  v_authority:=private.require_staff_authority('staff.permissions.manage');
  if char_length(v_name) not between 2 and 60 or char_length(v_description) not between 5 and 300
     or char_length(v_reason) not between 5 and 500 then
    raise exception 'Check the role name, description and reason' using errcode='22023';
  end if;
  if p_expected_version is null or p_expected_version<0 then
    raise exception 'Reload roles before saving' using errcode='40001';
  end if;
  if p_request_id is null or p_request_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
    raise exception 'A request ID is required' using errcode='22023';
  end if;
  if p_permissions is null or cardinality(p_permissions)>80 or exists(
    select 1 from unnest(p_permissions) x where x is null or not public.has_staff_permission(x)
      or not exists(select 1 from public.permissions where key=x)
  ) then
    raise exception 'Choose valid assignable permissions' using errcode='22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('browserp.staff.roles',0));
  select after_state into v_prior from public.staff_audit_events
    where actor_id=v_actor and request_id=p_request_id and action='staff.role.save' order by id desc limit 1;
  if found then return v_prior; end if;
  if v_key='' then
    v_key := 'custom_' || left(trim(both '_' from regexp_replace(lower(v_name),'[^a-z0-9]+','_','g')),33);
    if v_key='custom_' then raise exception 'Include a letter or number in the role name' using errcode='22023'; end if;
    if p_expected_version<>0 or exists(select 1 from public.staff_roles where key=v_key or lower(name)=lower(v_name)) then
      raise exception 'A role with this name already exists' using errcode='23505';
    end if;
    select candidate into v_rank from generate_series(1,799) candidate
      where not exists(select 1 from public.staff_roles where rank=candidate) order by candidate desc limit 1;
    if v_rank is null then raise exception 'The custom role limit has been reached' using errcode='22023'; end if;
    insert into public.staff_roles(key,name,description,rank,protected,is_custom,version)
      values(v_key,v_name,v_description,v_rank,false,true,1);
  else
    select * into v_existing from public.staff_roles where key=v_key for update;
    if not found or v_key='owner' or v_existing.rank>=v_authority then
      raise exception 'You can only edit roles below your own staff rank' using errcode='42501';
    end if;
    if v_existing.version<>p_expected_version then raise exception 'This role changed; reload before saving' using errcode='40001'; end if;
    v_rank:=v_existing.rank;
    v_before := to_jsonb(v_existing) || jsonb_build_object('permissions',coalesce((select jsonb_agg(permission_key order by permission_key) from public.staff_role_permissions where role_key=v_key),'[]'::jsonb));
    update public.staff_roles set name=v_name,description=v_description,version=version+1 where key=v_key;
  end if;
  if exists(select 1 from unnest(p_permissions) p where not private.staff_permission_within_rank(p,v_rank)) then
    raise exception 'Those governance powers require a higher role rank.' using errcode='42501';
  end if;
  perform private.require_staff_authority('staff.permissions.manage');
  delete from public.staff_role_permissions where role_key=v_key;
  insert into public.staff_role_permissions(role_key,permission_key) select v_key,x from unnest(p_permissions) x group by x;
  select jsonb_build_object('key',r.key,'name',r.name,'description',r.description,'custom',r.is_custom,'version',r.version,
    'permissions',coalesce((select jsonb_agg(permission_key order by permission_key) from public.staff_role_permissions where role_key=v_key),'[]'::jsonb))
    into v_after from public.staff_roles r where r.key=v_key;
  insert into public.staff_audit_events(actor_id,action,target_type,target_id,reason,request_id,before_state,after_state,metadata)
    values(v_actor,'staff.role.save','staff_role',v_key,v_reason,p_request_id,v_before,v_after,'{}'::jsonb);
  perform private.require_staff_authority('staff.permissions.manage');
  return v_after;
end;
$$;

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
    'readStaff',public.has_staff_permission('staff.read'),
    'requestStaff',public.has_staff_permission('staff.requests.create'),
    'manageStaff',public.has_staff_permission('staff.manage'),
    'manageRoles',public.has_staff_permission('staff.permissions.manage'),
    'reviewErasure',public.has_staff_permission('privacy.requests.fulfill'),
    'restrictionMaxMinutes',private.staff_restriction_limit(private.staff_target_rank(auth.uid()))
  );
$$;

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
      'readStaff',public.has_staff_permission('staff.read'),
      'manageStaff',public.has_staff_permission('staff.manage'),
      'manageRoles',public.has_staff_permission('staff.permissions.manage'),
      'manageBlogs', public.has_staff_permission('blogs.manage'),
      'manageAdverts', public.has_staff_permission('adverts.manage'),
      'manageAnnouncements', public.has_staff_permission('announcements.manage')
    )
  );
end;
$$;

create or replace function public.staff_security_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_required boolean;
begin
  if not public.has_staff_permission('reports.read') then
    raise exception 'Staff permission required' using errcode='42501';
  end if;
  select staff_mfa_required into v_required
  from private.platform_security_settings where singleton;
  return jsonb_build_object(
    'staffMfaRequired',coalesce(v_required,false),
    'sessionAal',coalesce((select auth.jwt())->>'aal','aal1'),
    'totpVerified',coalesce((select auth.jwt())->'amr','[]'::jsonb) @> '[{"method":"totp"}]'::jsonb,
    'canApproveNetwork',public.has_staff_permission('security.network.approve'),
    'canRequireMfa',public.has_staff_permission('settings.manage'),
    'isOwner',exists(select 1 from public.staff_memberships sm
      where sm.user_id=(select auth.uid()) and sm.role_key='owner' and sm.status='active')
  );
end;
$$;

create or replace function public.staff_activate_mfa_requirement(p_reason text,p_request_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_reason text := btrim(coalesce(p_reason,''));
begin
  perform pg_advisory_xact_lock(hashtextextended('browserp.staff.authority',0));
  perform private.require_staff_authority('settings.manage');
  if coalesce(auth.jwt()->>'aal','aal1')<>'aal2' or not coalesce(auth.jwt()->'amr','[]'::jsonb) @> '[{"method":"totp"}]'::jsonb then raise exception 'An authenticator-verified staff session is required.' using errcode='42501'; end if;
  if char_length(v_reason) not between 5 and 500 then raise exception 'A reason is required'; end if;
  update private.platform_security_settings
  set staff_mfa_required=true,changed_by=v_actor,changed_at=timezone('utc',now())
  where singleton;
  insert into public.staff_audit_events(actor_id,action,target_type,target_id,reason,request_id,before_state,after_state)
  values(v_actor,'staff.mfa.required','security_setting','staff_mfa_required',v_reason,nullif(p_request_id,''),
    jsonb_build_object('required',false),jsonb_build_object('required',true));
  return jsonb_build_object('staffMfaRequired',true);
end;
$$;

create or replace function public.staff_decide_network_reveal(p_request_id uuid,p_approved boolean,p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_actor uuid := (select auth.uid()); v_request public.network_reveal_requests%rowtype; v_reason text:=btrim(coalesce(p_reason,''));
begin
  perform pg_advisory_xact_lock(hashtextextended('browserp.staff.authority',0));
  perform private.require_staff_authority('security.network.approve');
  if char_length(v_reason) not between 10 and 500 then raise exception 'A detailed decision reason is required'; end if;
  select * into v_request from public.network_reveal_requests where id=p_request_id for update;
  if v_request.id is null or v_request.status<>'pending' then raise exception 'Reveal request is no longer pending' using errcode='40001'; end if;
  perform private.require_staff_authority('security.network.approve');
  if v_request.requested_by=v_actor then raise exception 'Another authorised staff member must review your request.' using errcode='42501'; end if;
  update public.network_reveal_requests set
    status=case when p_approved then 'approved' else 'denied' end,
    decided_by=v_actor,decision_reason=v_reason,decided_at=timezone('utc',now()),
    expires_at=case when p_approved then timezone('utc',now())+interval '10 minutes' else null end
  where id=p_request_id;
  insert into public.staff_audit_events(actor_id,action,target_type,target_id,reason,after_state)
  values(v_actor,case when p_approved then 'network.reveal.approved' else 'network.reveal.denied' end,
    'network_reveal_request',p_request_id::text,v_reason,jsonb_build_object('approved',p_approved));
  return jsonb_build_object('requestId',p_request_id,'status',case when p_approved then 'approved' else 'denied' end);
end;
$$;

create or replace function public.staff_network_reveal_control()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare v_actor uuid := (select auth.uid()); v_owner boolean;
begin
  if not public.has_staff_permission('security.network.request')
     and not public.has_staff_permission('security.network.approve') then return '[]'::jsonb; end if;
  select public.has_staff_permission('security.network.approve') into v_owner;
  return coalesce((select jsonb_agg(jsonb_build_object(
    'requestId',r.id,'activityId',r.activity_id,'requestedBy',r.requested_by,
    'requesterName',coalesce(p.display_name,'Staff member'),'maskedNetwork',a.masked_network,
    'reason',r.reason,'status',case when r.status='approved' and r.expires_at<=timezone('utc',now()) then 'expired' else r.status end,
    'decisionReason',r.decision_reason,'expiresAt',r.expires_at,'createdAt',r.created_at,
    'requestedByMe',r.requested_by=v_actor
  ) order by r.created_at desc)
  from public.network_reveal_requests r
  join public.account_activity a on a.id=r.activity_id
  left join public.profiles p on p.id=r.requested_by
  where (v_owner or r.requested_by=v_actor)
    and r.created_at>timezone('utc',now())-interval '90 days'),'[]'::jsonb);
end;
$$;

create or replace function public.staff_network_reveal_evidence(p_activity_id bigint,p_request_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_actor uuid:=(select auth.uid()); v_ciphertext text; v_owner_direct boolean;
begin
  perform pg_advisory_xact_lock(hashtextextended('browserp.staff.authority',0));
  select public.has_staff_permission('security.network.approve') into v_owner_direct;
  perform private.require_staff_authority(case when v_owner_direct then 'security.network.approve' else 'security.network.request' end);
  if not v_owner_direct and not public.has_staff_permission('security.network.request') then
    raise exception 'Approved network-evidence request required' using errcode='42501';
  end if;
  if not v_owner_direct then
    -- Wait on this caller's exact request before checking wall-clock expiry.
    -- now() alone would remain frozen if a concurrent transaction held the row.
    perform 1 from public.network_reveal_requests r
    where r.id=p_request_id and r.activity_id=p_activity_id and r.requested_by=v_actor
    for update;
    update public.network_reveal_requests r set status='used',used_at=clock_timestamp()
    where r.id=p_request_id and r.activity_id=p_activity_id and r.requested_by=v_actor
      and r.status='approved' and r.expires_at>clock_timestamp() and r.used_at is null;
    if not found then
      raise exception 'Approved network-evidence request required' using errcode='42501';
    end if;
  end if;
  perform private.require_staff_authority(case when v_owner_direct then 'security.network.approve' else 'security.network.request' end);
  select network_ciphertext into v_ciphertext from private.network_evidence where activity_id=p_activity_id;
  if v_ciphertext is null then raise exception 'Protected network evidence is unavailable'; end if;
  insert into public.staff_audit_events(actor_id,action,target_type,target_id,reason,after_state)
  values(v_actor,'network.reveal.viewed','account_activity',p_activity_id::text,'Approved protected evidence view',jsonb_build_object('requestId',p_request_id));
  return jsonb_build_object('ciphertext',v_ciphertext);
end;
$$;

create or replace function private.require_account_erasure_review(p_request_id uuid,p_expected_version bigint)
returns private.account_data_requests language plpgsql stable security definer set search_path='' as $$
declare r private.account_data_requests; actor uuid := (select auth.uid());
begin
  if actor is null or private.can_fulfill_data_requests() is distinct from true
 then
    raise exception 'An active staff account with privacy permission and an authenticator is required.' using errcode='42501';
  end if;
  if p_request_id is null or p_expected_version is null or p_expected_version<1 then
    raise exception 'Choose a current deletion request.' using errcode='22023';
  end if;
  select * into r from private.account_data_requests where id=p_request_id and kind='delete';
  if not found then raise exception 'Deletion request not found.' using errcode='PT404'; end if;
  if r.version<>p_expected_version or r.status not in ('submitted','reviewing','information_needed','ready') then
    raise exception 'The deletion request changed or closed. Refresh before reviewing it.' using errcode='PT409';
  end if;
  return r;
end;
$$;

create or replace function public.staff_revoke_account_sessions(p_user_id uuid,p_reason text,p_request_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_reason text := btrim(coalesce(p_reason,''));
  v_count integer;
begin
  if not public.has_staff_permission('accounts.sessions.revoke') then
    raise exception 'Session-revocation permission required' using errcode='42501';
  end if;
  if p_user_id is null or char_length(v_reason) not between 10 and 500 then
    raise exception 'A target and a detailed reason are required';
  end if;
  if exists (select 1 from public.staff_memberships where user_id=p_user_id and role_key='owner' and status='active')
     and p_user_id<>v_actor then
    raise exception 'Only the protected owner can revoke the owner session' using errcode='42501';
  end if;
  perform private.require_staff_dominance('accounts.sessions.revoke',p_user_id);
  delete from auth.sessions where user_id=p_user_id;
  get diagnostics v_count=row_count;
  insert into public.account_activity(user_id,event_type,provider,metadata)
  values(p_user_id,'auth.session_revoked','staff',jsonb_build_object('sessions',v_count));
  insert into public.staff_audit_events(actor_id,action,target_type,target_id,reason,request_id,after_state)
  values(v_actor,'account.sessions.revoked','account',p_user_id::text,v_reason,nullif(p_request_id,''),jsonb_build_object('sessions',v_count));
  perform private.require_staff_authority('accounts.sessions.revoke');
  return jsonb_build_object('userId',p_user_id,'revokedSessions',v_count);
end;
$$;

create or replace function public.staff_revoke_security_ban(p_ban_id uuid,p_reason text,p_request_id text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_actor uuid := (select auth.uid()); v_reason text:=btrim(coalesce(p_reason,'')); v_reference text; v_ban public.security_bans; v_authority integer;
begin
  if not public.has_staff_permission('bans.manage') then raise exception 'Ban-management permission required' using errcode='42501'; end if;
  if char_length(v_reason) not between 10 and 500 then raise exception 'A detailed revocation reason is required'; end if;
  perform pg_advisory_xact_lock(hashtextextended('browserp.staff.authority',0));
  select * into v_ban from public.security_bans where id=p_ban_id for update;
  if not found then raise exception 'Restriction not found.' using errcode='PT404'; end if;
  v_authority:=private.require_staff_dominance('bans.manage',v_ban.user_id);
  if v_ban.actor_id<>v_actor and private.staff_target_rank(v_ban.actor_id)>=v_authority then
    raise exception 'A higher-ranked staff member must review this restriction.' using errcode='42501';
  end if;
  update public.security_bans set revoked_at=timezone('utc',now()),revoked_by=v_actor,revoke_reason=v_reason
  where id=p_ban_id and revoked_at is null returning public_reference into v_reference;
  if v_reference is null then raise exception 'Ban is no longer active' using errcode='40001'; end if;
  insert into public.staff_audit_events(actor_id,action,target_type,target_id,reason,request_id,after_state)
  values(v_actor,'security.ban.revoked','security_ban',p_ban_id::text,v_reason,nullif(p_request_id,''),jsonb_build_object('reference',v_reference));
  perform private.require_staff_authority('bans.manage');
  return jsonb_build_object('id',p_ban_id,'reference',v_reference,'status','revoked');
end;
$$;

create or replace function public.staff_decide_security_appeal(
  p_appeal_id uuid,p_approved boolean,p_reason text,p_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_actor uuid:=(select auth.uid()); v_appeal public.security_ban_appeals%rowtype; v_reason text:=btrim(coalesce(p_reason,'')); v_ban public.security_bans; v_authority integer;
begin
  if not public.has_staff_permission('appeals.review') or not public.has_staff_permission('bans.manage') then raise exception 'Appeal-review permission required' using errcode='42501'; end if;
  if char_length(v_reason) not between 10 and 1000 then raise exception 'A detailed decision reason is required'; end if;
  perform pg_advisory_xact_lock(hashtextextended('browserp.staff.authority',0));
  select * into v_appeal from public.security_ban_appeals where id=p_appeal_id for update;
  if v_appeal.id is null or v_appeal.status not in ('submitted','under_review') then raise exception 'Appeal is no longer open' using errcode='40001'; end if;
  select * into v_ban from public.security_bans where id=v_appeal.ban_id for update;
  v_authority:=private.require_staff_dominance('appeals.review',v_ban.user_id);
  perform private.require_staff_authority('bans.manage');
  if v_ban.actor_id<>v_actor and private.staff_target_rank(v_ban.actor_id)>=v_authority then
    raise exception 'A higher-ranked staff member must review this restriction.' using errcode='42501';
  end if;
  update public.security_ban_appeals set status=case when p_approved then 'approved' else 'denied' end,
    reviewed_by=v_actor,decision_note=v_reason,updated_at=timezone('utc',now()) where id=p_appeal_id;
  if p_approved then update public.security_bans set revoked_at=timezone('utc',now()),revoked_by=v_actor,revoke_reason=v_reason where id=v_appeal.ban_id and revoked_at is null; end if;
  insert into public.staff_audit_events(actor_id,action,target_type,target_id,reason,request_id,after_state)
  values(v_actor,case when p_approved then 'security.appeal.approved' else 'security.appeal.denied' end,
    'security_ban_appeal',p_appeal_id::text,v_reason,nullif(p_request_id,''),jsonb_build_object('approved',p_approved));
  return jsonb_build_object('appealId',p_appeal_id,'status',case when p_approved then 'approved' else 'denied' end);
end;
$$;

create or replace function public.staff_ban_control()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.has_staff_permission('bans.manage') then raise exception 'Ban-management permission required' using errcode='42501'; end if;
  return jsonb_build_object(
    'bans',coalesce((select jsonb_agg(jsonb_build_object(
      'id',b.id,'userId',b.user_id,'targetType',b.target_type,'reference',b.public_reference,
      'scope',b.scope,'reasonCode',b.reason_code,'reason',b.reason,'permanent',b.permanent,
      'createdAt',b.created_at,'revokedAt',b.revoked_at,'startsAt',b.starts_at,'endsAt',b.ends_at
    ) order by b.created_at desc) from public.security_bans b where b.revoked_at is null and b.starts_at<=clock_timestamp() and (b.ends_at is null or b.ends_at>clock_timestamp())),'[]'::jsonb),
    'appeals',coalesce((select jsonb_agg(jsonb_build_object(
      'id',a.id,'banId',a.ban_id,'reference',b.public_reference,'statement',a.statement,
      'contactEmail',a.contact_email,'status',a.status,'createdAt',a.created_at
    ) order by a.created_at desc)
    from public.security_ban_appeals a join public.security_bans b on b.id=a.ban_id
    where a.status in ('submitted','under_review')),'[]'::jsonb)
  );
end;
$$;

create function public.staff_restriction_capabilities()
returns jsonb language plpgsql security definer set search_path='' as $$
declare authority integer:=private.require_staff_authority('bans.manage');
begin
 return jsonb_build_object('rank',authority,'maxMinutes',private.staff_restriction_limit(authority),
   'canIndefinite',authority>=900,'canDeviceNetwork',authority>=800);
end;
$$;

create or replace function public.staff_moderation_mutate(
  p_kind text,p_id uuid,p_action text,p_data jsonb,p_expected_version bigint,p_reason text,p_request_id text
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  actor uuid:=(select auth.uid()); k text:=lower(btrim(coalesce(p_kind,''))); action text:=lower(btrim(coalesce(p_action,'')));
  d jsonb:=coalesce(p_data,'{}'::jsonb); why text:=btrim(coalesce(p_reason,'')); old_data jsonb; saved jsonb; prior jsonb;
  current_version bigint; protected_owner boolean; target_status text; new_status text; permission text;
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
  permission:=case k when 'member' then 'accounts.manage' when 'server' then 'servers.manage' else 'reports.resolve' end;
  perform pg_advisory_xact_lock(hashtextextended('browserp.staff.authority',0));
  perform pg_advisory_xact_lock(hashtextextended(actor::text||':'||p_request_id,0));
  perform private.require_staff_authority(permission);
  select a.after_state into prior from public.staff_audit_events a where a.actor_id=actor and a.request_id=p_request_id
    and a.target_type=k and a.target_id=p_id::text and a.action='moderation.'||k||'.'||lower(btrim(p_action));
  if found then return prior; end if;
  if k='member' then
    perform private.require_staff_dominance('accounts.manage',p_id);
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
      or coalesce(d->>'access','') not in ('public','allowlisted','application','unknown')
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
  if k='member' then perform private.require_staff_dominance(permission,p_id);
  else perform private.require_staff_authority(permission); end if;
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
  perform private.require_staff_authority(permission);
  return saved;
end;
$$;

revoke all on function public.staff_role_control(),public.staff_list_access(),public.staff_access_request_control(),
 public.staff_request_access(text,text,text,text,bigint,uuid),public.staff_decide_access_request(uuid,bigint,boolean,text,text),
 public.staff_mutate_permission(text,text,boolean,text,text,bigint),public.staff_restrict_account(uuid,integer,text,text,text),
 public.staff_apply_security_ban(bigint,text,text,text,text,boolean,text,integer),public.staff_restriction_capabilities()
 from public,anon,authenticated,service_role;
grant execute on function public.staff_role_control(),public.staff_list_access(),public.staff_access_request_control(),
 public.staff_request_access(text,text,text,text,bigint,uuid),public.staff_decide_access_request(uuid,bigint,boolean,text,text),
 public.staff_mutate_permission(text,text,boolean,text,text,bigint),public.staff_restrict_account(uuid,integer,text,text,text),
 public.staff_apply_security_ban(bigint,text,text,text,text,boolean,text,integer),public.staff_restriction_capabilities()
 to authenticated;
notify pgrst,'reload schema';
commit;
