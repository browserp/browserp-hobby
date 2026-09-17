-- George accepted the retained registration order on 17 September 2026 for
-- normal First 100 / First 500 awards, including unknown/public signups.
-- This policy decision does not recover missing lifetime signup/deletion history.
begin;

-- Read the current accounts and ledger at apply time. Hold signup and delayed
-- profile writes until the evidence gate and existing-account awards commit.
lock table auth.users,public.profiles in share row exclusive mode;
lock table private.member_signup_counter,private.member_signup_order
 in share row exclusive mode;

do $$
begin
 if not exists(select 1 from private.member_signup_counter where singleton) then
   raise exception 'Signup counter is missing; retained order cannot be accepted';
 end if;
 if exists(
   select 1 from private.member_signup_counter c
   where c.singleton and c.last_ordinal < coalesce(
     (select max(o.signup_ordinal) from private.member_signup_order o),0)
 ) then
   raise exception 'Signup counter is behind the retained order';
 end if;
 if exists(
   select 1 from auth.users u
   where u.deleted_at is null and not coalesce(u.is_anonymous,false)
     and u.created_at is not null
     and not exists(select 1 from private.member_signup_order o where o.user_id=u.id)
 ) then
   raise exception 'A registered member is missing from the retained signup order';
 end if;
end;
$$;

-- Activation must not create stored awards for deleted or anonymous accounts,
-- including when their profile is provisioned later. Public projection already
-- enforces the same account eligibility independently of the stored award rows.
create or replace function private.award_member_signup_badges(p_user_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare ordinal bigint; confirmed boolean;
begin
 select signup_ordinal,cohort_confirmed into ordinal,confirmed
 from private.member_signup_order where user_id=p_user_id;
 if not found or not confirmed or ordinal>500
    or not exists(select 1 from private.member_signup_counter where singleton and chronology_confirmed)
    or not exists(
      select 1 from public.profiles p join auth.users u on u.id=p.id
      where p.id=p_user_id and u.deleted_at is null and not coalesce(u.is_anonymous,false)
    ) then
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

-- The existing chronology_confirmed field is the activation gate. Its private
-- evidence explicitly records acceptance of the retained order, not a claim of
-- recovered history. Preserve any earlier confirmation if this is replayed.
update private.member_signup_counter set
 chronology_confirmed=true,
 confirmed_at=timezone('utc',now()),
 evidence_reference='George-authorized acceptance of retained signup order, 2026-09-17; normal First 100 / First 500 eligibility for all qualifying registered members, including public signups. Missing historical signup/deletion records were not recovered; complete lifetime chronology is not asserted.'
where singleton and not chronology_confirmed;

-- Preserve ordinals, gaps left by deletions, the counter, and ambiguous-boundary
-- safeguards. Existing triggers keep allocating subsequent ordinals under the
-- normal 100/500 thresholds, including accounts created after the earlier read.
update private.member_signup_order set cohort_confirmed=true
where ordering_unambiguous and not cohort_confirmed;

select private.award_member_signup_badges(o.user_id)
from private.member_signup_order o join auth.users u on u.id=o.user_id
where o.cohort_confirmed and o.signup_ordinal<=500
  and u.deleted_at is null and not coalesce(u.is_anonymous,false);

commit;
