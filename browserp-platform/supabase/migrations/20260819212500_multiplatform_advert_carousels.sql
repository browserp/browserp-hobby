-- Expand BrowseRP beyond FiveM and give reviewed adverts a first-party image.
-- This migration is additive: the previous advert RPC remains available while
-- the v2.2 application moves to the image-aware overload.
begin;

insert into public.platforms (
  id, name, short_name, description, accent, adapter_key, sort_order, enabled
) values
  ('fivem', 'FiveM', '5M', 'GTA V roleplay communities.', '#d2519a', 'cfx', 10, true),
  ('redm', 'RedM', 'RM', 'Red Dead Redemption 2 roleplay communities.', '#b76a3a', 'cfx', 20, true),
  ('roblox', 'Roblox', 'RB', 'Roblox roleplay experiences and communities.', '#6bd5ed', 'manual', 30, true),
  ('minecraft', 'Minecraft', 'MC', 'Minecraft storytelling and roleplay worlds.', '#57d7a2', 'minecraft', 40, true),
  ('forza', 'Forza', 'FZ', 'Forza cruising, racing and automotive roleplay groups.', '#8d73ff', 'manual', 50, true),
  ('gmod', 'Garry''s Mod', 'GM', 'Garry''s Mod roleplay servers and communities.', '#5e9bea', 'manual', 60, true),
  ('ets2', 'Euro Truck Simulator 2', 'ETS2', 'Trucking, logistics and convoy roleplay communities.', '#f1bd6b', 'manual', 70, true),
  ('arma', 'ARMA', 'AR', 'ARMA life, military and serious roleplay communities.', '#86a977', 'steam', 80, true),
  ('vrchat', 'VRChat', 'VR', 'Social and world-based roleplay communities.', '#54b7ff', 'manual', 90, true),
  ('dayz', 'DayZ', 'DZ', 'Survival roleplay communities.', '#87937b', 'steam', 100, true),
  ('project-zomboid', 'Project Zomboid', 'PZ', 'Collaborative survival storytelling.', '#9d92a0', 'steam', 110, true),
  ('assetto-corsa', 'Assetto Corsa', 'AC', 'Track, street and automotive roleplay communities.', '#e37272', 'manual', 120, true),
  ('beamng', 'BeamNG.drive', 'BNG', 'Driving, emergency service and vehicle roleplay groups.', '#ee9f55', 'manual', 130, true),
  ('other', 'Other roleplay game', 'RP', 'Roleplay communities on another supported game or simulator.', '#929baa', 'manual', 900, true)
on conflict (id) do update set
  name=excluded.name,
  short_name=excluded.short_name,
  description=excluded.description,
  accent=excluded.accent,
  adapter_key=excluded.adapter_key,
  sort_order=excluded.sort_order,
  enabled=true;

alter table public.ad_campaigns
  add column if not exists image_url text;

alter table public.ad_campaigns
  drop constraint if exists ad_campaigns_image_url_check,
  add constraint ad_campaigns_image_url_check check (
    image_url is null or (
      image_url not like '%..%'
      and (
        image_url ~* '^/assets/adverts/[a-z0-9][a-z0-9_/-]*\.(avif|webp|png|jpe?g)$'
        or image_url ~* '^https://www\.browserp\.com/assets/adverts/[a-z0-9][a-z0-9_/-]*\.(avif|webp|png|jpe?g)$'
        or image_url ~* '^https://kywabzfgjoqiznnxygbq\.supabase\.co/storage/v1/object/public/advertisements/[a-z0-9][a-z0-9_./-]*\.(avif|webp|png|jpe?g)$'
      )
    )
  ) not valid;

alter table public.ad_campaigns validate constraint ad_campaigns_image_url_check;

create or replace function public.staff_advert_control()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when public.has_staff_permission('adverts.manage') then
    coalesce(jsonb_agg(jsonb_build_object(
      'id',a.id,'name',a.name,'placement',a.placement,'headline',a.headline,
      'body',a.body,'ctaLabel',a.cta_label,'destinationUrl',a.destination_url,
      'imageUrl',a.image_url,'status',a.status,'startsAt',a.starts_at,'endsAt',a.ends_at,
      'version',a.version,'updatedAt',a.updated_at
    ) order by a.updated_at desc),'[]'::jsonb)
  else (select null::jsonb where false) end
  from public.ad_campaigns a;
$$;

create or replace function public.staff_mutate_advert(
  p_id uuid,p_action text,p_name text,p_placement text,p_headline text,p_body text,
  p_cta_label text,p_destination_url text,p_image_url text,p_starts_at timestamptz,
  p_ends_at timestamptz,p_expected_version bigint,p_reason text,p_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid:=(select auth.uid()); v_id uuid; v_action text:=lower(btrim(coalesce(p_action,'')));
  v_reason text:=btrim(coalesce(p_reason,'')); v_image text:=nullif(btrim(coalesce(p_image_url,'')),'');
  v_before jsonb; v_after jsonb;
begin
  if not public.has_staff_permission('adverts.manage') then raise exception 'Advert-management permission required' using errcode='42501'; end if;
  if v_action not in ('save','activate','pause','archive') or char_length(v_reason) not between 5 and 500 then raise exception 'Invalid advert action'; end if;
  if v_action in ('save','activate') then
    if char_length(btrim(coalesce(p_name,''))) not between 3 and 100
       or p_placement not in ('top','side','directory','server_detail')
       or char_length(btrim(coalesce(p_headline,''))) not between 3 and 100
       or char_length(btrim(coalesce(p_body,''))) not between 10 and 300
       or char_length(btrim(coalesce(p_cta_label,''))) not between 2 and 40
       or not ((left(coalesce(p_destination_url,''),1)='/' and left(coalesce(p_destination_url,''),2)<>'//') or coalesce(p_destination_url,'') ~* '^https://')
       or (p_ends_at is not null and p_starts_at is not null and p_ends_at<=p_starts_at)
       or (p_placement<>'top' and v_image is null)
       or (v_image is not null and (
         v_image like '%..%'
         or not (
           v_image ~* '^/assets/adverts/[a-z0-9][a-z0-9_/-]*\.(avif|webp|png|jpe?g)$'
           or v_image ~* '^https://www\.browserp\.com/assets/adverts/[a-z0-9][a-z0-9_/-]*\.(avif|webp|png|jpe?g)$'
           or v_image ~* '^https://kywabzfgjoqiznnxygbq\.supabase\.co/storage/v1/object/public/advertisements/[a-z0-9][a-z0-9_./-]*\.(avif|webp|png|jpe?g)$'
         )
       )) then
      raise exception 'Invalid advert content';
    end if;
  end if;
  if p_id is null then
    if v_action not in ('save','activate') or coalesce(p_expected_version,0)<>0 then raise exception 'Invalid new advert'; end if;
    insert into public.ad_campaigns(owner_id,name,placement,headline,body,cta_label,destination_url,
      image_url,credit_budget,status,starts_at,ends_at,created_by)
    values(v_actor,btrim(p_name),p_placement,btrim(p_headline),btrim(p_body),btrim(p_cta_label),
      btrim(p_destination_url),v_image,1,case when v_action='activate' then 'active' else 'draft' end,
      p_starts_at,p_ends_at,v_actor) returning id into v_id;
  else
    select to_jsonb(a) into v_before from public.ad_campaigns a where a.id=p_id for update;
    if v_before is null then raise exception 'Advert not found'; end if;
    if coalesce((v_before->>'version')::bigint,0)<>p_expected_version then raise exception 'Advert changed; reload first' using errcode='40001'; end if;
    update public.ad_campaigns set
      name=case when v_action in ('save','activate') then btrim(p_name) else name end,
      placement=case when v_action in ('save','activate') then p_placement else placement end,
      headline=case when v_action in ('save','activate') then btrim(p_headline) else headline end,
      body=case when v_action in ('save','activate') then btrim(p_body) else body end,
      cta_label=case when v_action in ('save','activate') then btrim(p_cta_label) else cta_label end,
      destination_url=case when v_action in ('save','activate') then btrim(p_destination_url) else destination_url end,
      image_url=case when v_action in ('save','activate') then v_image else image_url end,
      starts_at=case when v_action in ('save','activate') then p_starts_at else starts_at end,
      ends_at=case when v_action in ('save','activate') then p_ends_at else ends_at end,
      status=case v_action when 'activate' then 'active' when 'pause' then 'paused' when 'archive' then 'completed' else 'draft' end,
      version=version+1,updated_at=timezone('utc',now()) where id=p_id returning id into v_id;
  end if;
  select to_jsonb(a) into v_after from public.ad_campaigns a where a.id=v_id;
  insert into public.staff_audit_events(actor_id,action,target_type,target_id,reason,request_id,before_state,after_state)
  values(v_actor,'advert.'||v_action,'advert',v_id::text,v_reason,nullif(p_request_id,''),v_before,v_after);
  return v_after;
end;
$$;

revoke execute on function public.staff_mutate_advert(
  uuid,text,text,text,text,text,text,text,text,timestamptz,timestamptz,bigint,text,text
) from public, anon, service_role;
grant execute on function public.staff_mutate_advert(
  uuid,text,text,text,text,text,text,text,text,timestamptz,timestamptz,bigint,text,text
) to authenticated;

create or replace function public.public_advertisements(p_placement text)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',a.id,'placement',a.placement,'headline',a.headline,'body',a.body,
    'ctaLabel',a.cta_label,'destinationUrl',a.destination_url,'imageUrl',a.image_url,'name',a.name
  ) order by a.starts_at nulls first,a.created_at desc),'[]'::jsonb)
  from public.ad_campaigns a
  where a.status='active'
    and a.placement=p_placement
    and (a.starts_at is null or a.starts_at<=timezone('utc',now()))
    and (a.ends_at is null or a.ends_at>timezone('utc',now()));
$$;

update public.ad_campaigns
set headline='Find the roleplay that fits you',
    body='Browse communities across FiveM, RedM, Roblox, Minecraft, racing and simulation games.',
    cta_label='Browse communities',destination_url='/servers',
    image_url='/assets/adverts/serious-roleplay.jpg',updated_at=timezone('utc',now()),version=version+1
where name='BrowseRP side house advert';

insert into public.ad_campaigns(
  owner_id,name,placement,headline,body,cta_label,destination_url,image_url,
  credit_budget,status,created_by
)
select sm.user_id,'BrowseRP side custom vehicles','side','Built something roleplayers should see?',
  'Put your community, recruitment drive or roleplay service in this space.',
  'Advertise here','/advertise','/assets/adverts/custom-cars.jpg',1,'active',sm.user_id
from public.staff_memberships sm
where sm.role_key='owner' and sm.status='active'
  and not exists(select 1 from public.ad_campaigns where name='BrowseRP side custom vehicles');

insert into public.ad_campaigns(
  owner_id,name,placement,headline,body,cta_label,destination_url,image_url,
  credit_budget,status,created_by
)
select sm.user_id,'BrowseRP side community stories','side','Every game has a roleplay community',
  'Discover city life, westerns, block worlds, driving clubs and serious simulation groups.',
  'Explore the directory','/servers','/assets/adverts/community-stories.jpg',1,'active',sm.user_id
from public.staff_memberships sm
where sm.role_key='owner' and sm.status='active'
  and not exists(select 1 from public.ad_campaigns where name='BrowseRP side community stories');

commit;
