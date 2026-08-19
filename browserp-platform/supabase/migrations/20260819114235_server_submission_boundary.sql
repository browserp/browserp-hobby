-- Applied to production Supabase project kywabzfgjoqiznnxygbq on 2026-08-19.
create or replace function public.create_server_submission_server(
  p_user_id uuid,
  p_name text,
  p_platform_id text,
  p_region text,
  p_language text,
  p_framework text,
  p_description text,
  p_community_url text,
  p_moderation_confidence text,
  p_moderation_score integer,
  p_moderation_reasons jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if p_user_id is null or not exists(select 1 from public.profiles where id = p_user_id) then
    raise exception 'Unknown member' using errcode = '42501';
  end if;
  if not exists(select 1 from public.platforms where id = p_platform_id and enabled) then
    raise exception 'Unsupported platform';
  end if;
  if char_length(trim(coalesce(p_name, ''))) not between 2 and 80
     or char_length(trim(coalesce(p_region, ''))) not between 2 and 60
     or char_length(trim(coalesce(p_language, ''))) not between 2 and 60
     or char_length(trim(coalesce(p_description, ''))) not between 40 and 1500 then
    raise exception 'Invalid listing content';
  end if;
  if nullif(trim(coalesce(p_framework, '')), '') is not null and char_length(trim(p_framework)) > 80 then
    raise exception 'Invalid framework';
  end if;
  if nullif(trim(coalesce(p_community_url, '')), '') is not null and (
    char_length(trim(p_community_url)) > 300 or trim(p_community_url) !~* '^https://'
  ) then
    raise exception 'Invalid community URL';
  end if;
  if p_moderation_confidence not in ('safe', 'likely_safe', 'review_recommended', 'high_risk')
     or p_moderation_score not between 0 and 84
     or jsonb_typeof(coalesce(p_moderation_reasons, '[]'::jsonb)) <> 'array' then
    raise exception 'Submission blocked';
  end if;
  if (select count(*) from public.server_submissions where submitted_by = p_user_id and status in ('pending_review', 'changes_requested')) >= 5 then
    raise exception 'Too many open submissions';
  end if;

  insert into public.server_submissions(
    submitted_by, platform_id, name, region, language, framework, description,
    community_url, moderation_confidence, moderation_score, moderation_reasons
  ) values (
    p_user_id, p_platform_id, left(trim(p_name), 80), left(trim(p_region), 60),
    left(trim(p_language), 60), nullif(left(trim(p_framework), 80), ''),
    left(trim(p_description), 1500), nullif(left(trim(p_community_url), 300), ''),
    p_moderation_confidence, p_moderation_score, coalesce(p_moderation_reasons, '[]'::jsonb)
  ) returning id into v_id;

  insert into public.moderation_queue(target_type, target_id, confidence, score, reasons)
  values('server_submission', v_id::text, p_moderation_confidence, p_moderation_score, coalesce(p_moderation_reasons, '[]'::jsonb));

  return jsonb_build_object('id', v_id, 'status', 'pending_review', 'moderation', p_moderation_confidence);
end;
$$;

revoke execute on function public.create_server_submission_server(uuid, text, text, text, text, text, text, text, text, integer, jsonb)
  from public, anon, authenticated;
grant execute on function public.create_server_submission_server(uuid, text, text, text, text, text, text, text, text, integer, jsonb)
  to service_role;
comment on function public.create_server_submission_server(uuid, text, text, text, text, text, text, text, text, integer, jsonb)
  is 'Server-only listing boundary. The Vercel API supplies a user identity verified through Supabase Auth and trusted moderation output.';
