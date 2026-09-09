-- Canonical member badges are derived from current authoritative facts.
-- Public payloads contain display data only; private evidence and award reasons
-- remain in their source tables and the existing member-data export.
begin;

insert into public.badges(key,name,description,icon_key,color,system_managed,enabled) values
 ('browserp_staff','BrowseRP Staff','An active member of the BrowseRP staff team.','browserp-rp-mark','#d72990',true,true),
 ('first_100','First 100','One of the first 100 BrowseRP members.','milestone-100','#f2b84b',true,true),
 ('first_500','First 500','One of the first 500 BrowseRP members.','milestone-500','#9b72e8',true,true),
 ('discord_verified_email','Verified Member','Discord confirmed the connected account email is verified. This is not an identity check.','discord-check','#5865f2',true,true)
on conflict(key) do update set
 name=excluded.name,description=excluded.description,icon_key=excluded.icon_key,
 color=excluded.color,system_managed=true,enabled=true;

update public.badges set
 name='Verified Server Owner',
 description='BrowseRP confirmed control of a published server listing. This is not a safety or quality guarantee.',
 icon_key='shield-check',system_managed=true,enabled=true
where key='verified_owner';

update public.badges set name='Community Helper',system_managed=false,enabled=true
where key='community_helper';

-- Recognition is public display data, but the stored award row includes private
-- actor and reason fields. Replace legacy direct client reads with the bounded
-- projection below; preserve service access and the guarded account-copy path.
revoke all on table public.user_badges from public,anon,authenticated;
revoke all (user_id,badge_id,awarded_by,reason,awarded_at,expires_at)
 on table public.user_badges from public,anon,authenticated;

-- The ledger makes cohort eligibility stable if accounts are later removed.
-- Existing accounts use the provider-created timestamp. A tied timestamp is
-- accepted only when the whole tied group falls on the same cohort side; a tie
-- crossing 100 or 500 is left unconfirmed rather than guessed.
create table private.member_signup_order (
 user_id uuid primary key references auth.users(id) on delete cascade,
 signup_ordinal bigint not null unique check(signup_ordinal>0),
 ordering_unambiguous boolean not null default true,
 cohort_confirmed boolean not null default false
   check(not cohort_confirmed or ordering_unambiguous),
 recorded_at timestamptz not null default timezone('utc',now())
);
create table private.member_signup_counter (
 singleton boolean primary key default true check(singleton),
 last_ordinal bigint not null check(last_ordinal>=0),
 chronology_confirmed boolean not null default false,
 confirmed_at timestamptz,
 evidence_reference text,
 check((chronology_confirmed and confirmed_at is not null and nullif(btrim(evidence_reference),'') is not null)
   or (not chronology_confirmed and confirmed_at is null and evidence_reference is null))
);
alter table private.member_signup_order enable row level security;
alter table private.member_signup_counter enable row level security;
revoke all on table private.member_signup_order,private.member_signup_counter
 from public,anon,authenticated,service_role;

-- Close the migration cutover gap: no signup or delayed profile insert can
-- commit between the historical snapshot and trigger installation.
lock table auth.users,public.profiles in share row exclusive mode;

with ordered as (
 select u.id,
   row_number() over(order by u.created_at,u.id)::bigint as ordinal,
   count(*) over(partition by u.created_at)::bigint as tied,
   count(*) over(order by u.created_at range between unbounded preceding and current row)::bigint as through_time
 from auth.users u
 where not coalesce(u.is_anonymous,false) and u.created_at is not null
), classified as (
 select id,ordinal,
   not (
     (through_time-tied<100 and through_time>100)
     or (through_time-tied<500 and through_time>500)
   ) as confirmed
 from ordered
)
insert into private.member_signup_order(user_id,signup_ordinal,ordering_unambiguous,cohort_confirmed)
select id,ordinal,confirmed,false from classified order by ordinal;

-- The historical order remains deliberately unconfirmed. An earlier scheduled
-- retention function could hard-delete accounts, so surviving Auth rows cannot
-- prove a lifetime First 100/500 cohort. A later reviewed evidence migration may
-- rebuild exact ordinals, mark only proven rows, and set this confirmation flag.
insert into private.member_signup_counter(singleton,last_ordinal,chronology_confirmed)
values(true,coalesce((select max(signup_ordinal) from private.member_signup_order),0),false);

create or replace function private.award_member_signup_badges(p_user_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare ordinal bigint; confirmed boolean;
begin
 select signup_ordinal,cohort_confirmed into ordinal,confirmed
 from private.member_signup_order where user_id=p_user_id;
 if not found or not confirmed or ordinal>500
    or not exists(select 1 from private.member_signup_counter where singleton and chronology_confirmed)
    or not exists(select 1 from public.profiles where id=p_user_id) then
   return;
 end if;
 insert into public.user_badges(user_id,badge_id,reason)
 select p_user_id,b.id,'Automatic signup cohort'
 from public.badges b
 where b.key='first_500' or (ordinal<=100 and b.key='first_100')
 on conflict(user_id,badge_id) do nothing;
end;
$$;
revoke all on function private.award_member_signup_badges(uuid)
 from public,anon,authenticated,service_role;

create or replace function private.record_member_signup_order()
returns trigger language plpgsql security definer set search_path='' as $$
declare next_ordinal bigint; history_confirmed boolean;
begin
 if coalesce(new.is_anonymous,false) or new.created_at is null
    or exists(select 1 from private.member_signup_order where user_id=new.id) then
   return new;
 end if;
 select last_ordinal+1,chronology_confirmed into next_ordinal,history_confirmed
 from private.member_signup_counter where singleton for update;
 insert into private.member_signup_order(user_id,signup_ordinal,ordering_unambiguous,cohort_confirmed)
 values(new.id,next_ordinal,true,history_confirmed) on conflict(user_id) do nothing;
 if found then
   update private.member_signup_counter set last_ordinal=next_ordinal where singleton;
   perform private.award_member_signup_badges(new.id);
 end if;
 return new;
end;
$$;
revoke all on function private.record_member_signup_order()
 from public,anon,authenticated,service_role;
-- The auth and profile paths both attempt the idempotent award, so provisioning
-- remains correct whichever eligible record becomes available last.
create trigger on_auth_member_signup_order
after insert or update of is_anonymous on auth.users
for each row execute function private.record_member_signup_order();

create or replace function private.handle_member_signup_badges()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 perform private.award_member_signup_badges(new.id);
 return new;
end;
$$;
revoke all on function private.handle_member_signup_badges()
 from public,anon,authenticated,service_role;
create trigger on_profile_member_signup_badges
after insert on public.profiles
for each row execute function private.handle_member_signup_badges();

create or replace function private.member_badge_projection(p_user_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb; role_label text;
begin
 if p_user_id is null or not exists(
   select 1 from auth.users u where u.id=p_user_id
     and u.deleted_at is null and not coalesce(u.is_anonymous,false)
 ) then
   return jsonb_build_object('badges','[]'::jsonb,'staffRole',null);
 end if;

 if private.is_active_staff_member(p_user_id) then
   select left(r.name,60) into role_label
   from public.staff_memberships m join public.staff_roles r on r.key=m.role_key
   where m.user_id=p_user_id and m.status='active';
 end if;

 with eligible(key,priority) as (
   select 'browserp_staff'::text,10 where role_label is not null
   union all
   select 'verified_owner',20 where exists(
     select 1 from public.server_claim_requests c
     join public.servers s on s.id=c.server_id
     where c.claimant_id=p_user_id and c.status='approved'
       and c.verification_status='verified' and c.verified_at is not null
       and c.community_url is not distinct from s.community_url
       and s.owner_id=p_user_id and s.status='published' and s.age_rating<>'adult'
   )
   union all
   select 'discord_verified_email',30 where exists(
     select 1 from auth.identities i
     where i.user_id=p_user_id and i.provider='discord'
       and nullif(btrim(i.identity_data->>'email'),'') is not null
       and lower(coalesce(i.identity_data->>'email_verified','false'))='true'
   )
   union all
   select case when o.signup_ordinal<=100 then 'first_100' else 'first_500' end,40
   from private.member_signup_order o
   where o.user_id=p_user_id and o.cohort_confirmed and o.signup_ordinal<=500
     and exists(select 1 from private.member_signup_counter where singleton and chronology_confirmed)
   union all
   select b.key,case when b.key='community_helper' then 50 else 60 end
   from public.user_badges ub join public.badges b on b.id=ub.badge_id
   where ub.user_id=p_user_id and b.enabled
     and (ub.expires_at is null or ub.expires_at>timezone('utc',now()))
     and (not b.system_managed or b.key='new_joiner')
 ), chosen as (
   select distinct on(e.key) e.key,e.priority from eligible e order by e.key,e.priority
 ), visible as (
   select c.priority,b.key,b.name,b.description,b.icon_key
   from chosen c join public.badges b on b.key=c.key and b.enabled
   order by c.priority,b.key limit 12
 )
 select jsonb_build_object(
   'badges',coalesce(jsonb_agg(jsonb_build_object(
     'kind',v.key,'label',left(v.name,60),'description',left(v.description,240),'iconKey',left(v.icon_key,50)
   ) order by v.priority,v.key),'[]'::jsonb),
   'staffRole',role_label
 ) into result
 from visible v;
 return coalesce(result,jsonb_build_object('badges','[]'::jsonb,'staffRole',role_label));
end;
$$;
revoke all on function private.member_badge_projection(uuid)
 from public,anon,authenticated,service_role;

create or replace function public.member_badges(p_user_id uuid)
returns jsonb language sql stable security definer set search_path='' as $$
 select case when exists(
   select 1 from public.profiles p
   where p.id=p_user_id and (
     p.profile_visibility='public'
     or (p.id=(select auth.uid()) and (select private.member_access_allowed()))
   )
 ) then private.member_badge_projection(p_user_id) end;
$$;
revoke all on function public.member_badges(uuid) from public,anon,authenticated,service_role;
grant execute on function public.member_badges(uuid) to anon,authenticated;

-- Comments receive the same current projection. The visible staff rank remains
-- a separate label so the official RP mark never becomes a permission claim.
create or replace function public.public_server_engagement(p_slug text)
returns jsonb
language sql
stable
security definer
set search_path=''
as $$
 select jsonb_build_object(
   'serverId',s.id,'slug',s.slug,'accessType',s.access_type,
   'cfxJoinUrl',case when s.cfx_join_url ~* '^https://cfx\.re/join/[a-z0-9]{3,32}/?$' then s.cfx_join_url else null end,
   'animatedMediaEnabled',s.animated_media_enabled,
   'voteCount',(select count(*) from public.server_votes v where v.server_id=s.id),
   'comments',coalesce((select jsonb_agg(jsonb_build_object(
     'id',c.id,'body',c.body,'createdAt',c.created_at,'author',p.display_name,
     'avatarUrl',case when p.avatar_review_status='approved' then p.approved_avatar_url else null end,
     'editedAt',c.edited_at,'badges',bp.value->'badges','staffRole',bp.value->'staffRole',
     'parent',case
       when c.parent_comment_id is null then null
       when parent.id is null or parent_author.id is null then jsonb_build_object('id',c.parent_comment_id,'unavailable',true)
       else jsonb_build_object('id',parent.id,'author',parent_author.display_name,'body',parent.body,'createdAt',parent.created_at,'unavailable',false)
     end
   ) order by c.created_at desc)
   from public.server_comments c
   join public.profiles p on p.id=c.author_id
   cross join lateral (select private.member_badge_projection(c.author_id) value) bp
   left join public.server_comments parent on parent.id=c.parent_comment_id and parent.server_id=s.id and parent.status='published'
   left join public.profiles parent_author on parent_author.id=parent.author_id
   where c.server_id=s.id and c.status='published'),'[]'::jsonb)
 )
 from public.servers s where s.slug=lower(btrim(p_slug)) and s.status='published' and s.age_rating<>'adult' limit 1;
$$;
revoke all on function public.public_server_engagement(text) from public,anon,authenticated,service_role;
grant execute on function public.public_server_engagement(text) to anon,authenticated,service_role;

notify pgrst,'reload schema';
commit;
