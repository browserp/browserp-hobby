-- Keep imported access uncertainty intact when staff edit unrelated server details.
-- Existing permission, MFA, optimistic version, audit and field guards are preserved.
-- Owner submission access remains governed by its separate unchanged validator.
begin;

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
revoke all on function public.staff_moderation_mutate(text,uuid,text,jsonb,bigint,text,text) from public,anon,service_role;
grant execute on function public.staff_moderation_mutate(text,uuid,text,jsonb,bigint,text,text) to authenticated;

commit;
