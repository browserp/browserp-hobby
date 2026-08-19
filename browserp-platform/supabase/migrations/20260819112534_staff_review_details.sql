-- Applied to production Supabase project kywabzfgjoqiznnxygbq on 2026-08-19.
-- This is the stored migration body. A later migration switches this function
-- from SECURITY DEFINER to SECURITY INVOKER.
create or replace function public.staff_review_item(p_kind text, p_item_id text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_kind text := lower(trim(coalesce(p_kind, ''));
  v_id uuid;
  v_numeric_id bigint;
  v_item jsonb;
begin
  if v_user is null then raise exception 'Authentication required' using errcode = '42501'; end if;
  if char_length(coalesce(p_item_id, '')) > 80 then raise exception 'Invalid item identifier'; end if;

  case v_kind
    when 'listing' then
      if not public.has_staff_permission('servers.review') then raise exception 'Listing review permission required' using errcode = '42501'; end if;
      begin v_id := p_item_id::uuid; exception when invalid_text_representation then raise exception 'Invalid item identifier'; end;
      select jsonb_build_object(
        'kind', 'listing', 'id', s.id, 'name', s.name, 'platform', s.platform_id,
        'region', s.region, 'language', s.language, 'framework', s.framework,
        'description', s.description, 'communityUrl', s.community_url,
        'status', s.status, 'moderationConfidence', s.moderation_confidence,
        'moderationScore', s.moderation_score, 'moderationReasons', s.moderation_reasons,
        'createdAt', s.created_at, 'updatedAt', s.updated_at
      ) into v_item from public.server_submissions s where s.id = v_id;

    when 'report' then
      if not public.has_staff_permission('reports.read') then raise exception 'Report read permission required' using errcode = '42501'; end if;
      begin v_id := p_item_id::uuid; exception when invalid_text_representation then raise exception 'Invalid item identifier'; end;
      select jsonb_build_object(
        'kind', 'report', 'id', r.id, 'targetType', r.target_type, 'targetId', r.target_id,
        'category', r.category, 'details', r.details, 'status', r.status,
        'createdAt', r.created_at, 'updatedAt', r.updated_at
      ) into v_item from public.reports r where r.id = v_id;

    when 'moderation' then
      if not public.has_staff_permission('moderation.read') then raise exception 'Moderation read permission required' using errcode = '42501'; end if;
      begin v_id := p_item_id::uuid; exception when invalid_text_representation then raise exception 'Invalid item identifier'; end;
      select jsonb_build_object(
        'kind', 'moderation', 'id', m.id, 'targetType', m.target_type, 'targetId', m.target_id,
        'confidence', m.confidence, 'score', m.score, 'reasons', m.reasons,
        'status', m.status, 'createdAt', m.created_at
      ) into v_item from public.moderation_queue m where m.id = v_id;

    when 'security' then
      if not public.has_staff_permission('security.read') then raise exception 'Security read permission required' using errcode = '42501'; end if;
      begin v_numeric_id := p_item_id::bigint; exception when invalid_text_representation or numeric_value_out_of_range then raise exception 'Invalid item identifier'; end;
      select jsonb_build_object(
        'kind', 'security', 'id', e.id, 'eventType', e.event_type, 'severity', e.severity,
        'details', e.details, 'createdAt', e.created_at, 'resolvedAt', e.resolved_at
      ) into v_item from public.security_events e where e.id = v_numeric_id;

    else
      raise exception 'Invalid queue type';
  end case;

  if v_item is null then raise exception 'Queue item not found'; end if;
  return v_item;
end;
$$;

revoke execute on function public.staff_review_item(text, text) from public, anon;
grant execute on function public.staff_review_item(text, text) to authenticated, service_role;
comment on function public.staff_review_item(text, text)
  is 'Returns permission-scoped staff review details without network hashes, OAuth data, or private secrets.';
