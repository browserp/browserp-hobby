-- Permission-scoped staff queues and audited single-item workflow actions.
begin;

alter table public.servers
  add column if not exists source_submission_id uuid references public.server_submissions(id) on delete set null;

create unique index if not exists servers_source_submission_uidx
  on public.servers (source_submission_id)
  where source_submission_id is not null;

create or replace function public.staff_dashboard_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
  v_role_key text;
  v_role_name text;
  v_permissions jsonb;
  v_can_listings boolean;
  v_can_reports boolean;
  v_can_moderation boolean;
  v_can_security boolean;
  v_can_audit boolean;
  v_can_enforce boolean;
begin
  select sm.role_key, sr.name
    into v_role_key, v_role_name
  from public.staff_memberships sm
  join public.staff_roles sr on sr.key = sm.role_key
  where sm.user_id = v_user and sm.status = 'active';

  if v_role_key is null then
    raise exception 'Staff permission required' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(srp.permission_key order by srp.permission_key), '[]'::jsonb)
    into v_permissions
  from public.staff_role_permissions srp
  where srp.role_key = v_role_key;

  v_can_listings := public.has_staff_permission('servers.review');
  v_can_reports := public.has_staff_permission('reports.read');
  v_can_moderation := public.has_staff_permission('moderation.read');
  v_can_security := public.has_staff_permission('security.read');
  v_can_audit := public.has_staff_permission('audit.read');
  v_can_enforce := public.has_staff_permission('users.enforce');

  return jsonb_build_object(
    'role', jsonb_build_object('key', v_role_key, 'name', v_role_name),
    'permissions', v_permissions,
    'pendingSubmissions', case when v_can_listings then (select count(*) from public.server_submissions where status = 'pending_review') else 0 end,
    'openModeration', case when v_can_moderation then (select count(*) from public.moderation_queue where status in ('open', 'claimed')) else 0 end,
    'openReports', case when v_can_reports then (select count(*) from public.reports where status in ('open', 'triaged')) else 0 end,
    'activeBans', case when v_can_enforce then (select count(*) from public.bans where revoked_at is null and (ends_at is null or ends_at > timezone('utc', now()))) else 0 end,
    'securityAlerts', case when v_can_security then (select count(*) from public.security_events where resolved_at is null and severity in ('high', 'critical')) else 0 end,
    'listingQueue', case when v_can_listings then (
      select coalesce(jsonb_agg(to_jsonb(q) order by q.created_at desc), '[]'::jsonb)
      from (
        select id, name, platform_id, region, status, moderation_confidence, moderation_score, created_at
        from public.server_submissions
        where status in ('pending_review', 'changes_requested')
        order by created_at desc
        limit 20
      ) q
    ) else '[]'::jsonb end,
    'reportQueue', case when v_can_reports then (
      select coalesce(jsonb_agg(to_jsonb(q) order by q.created_at desc), '[]'::jsonb)
      from (
        select id, target_type, target_id, category, status, created_at
        from public.reports
        where status in ('open', 'triaged')
        order by created_at desc
        limit 20
      ) q
    ) else '[]'::jsonb end,
    'moderationQueue', case when v_can_moderation then (
      select coalesce(jsonb_agg(to_jsonb(q) order by q.created_at desc), '[]'::jsonb)
      from (
        select id, target_type, target_id, confidence, score, status, created_at
        from public.moderation_queue
        where status in ('open', 'claimed')
        order by created_at desc
        limit 20
      ) q
    ) else '[]'::jsonb end,
    'securityEvents', case when v_can_security then (
      select coalesce(jsonb_agg(to_jsonb(q) order by q.created_at desc), '[]'::jsonb)
      from (
        select id, event_type, severity, created_at
        from public.security_events
        where resolved_at is null
        order by
          case severity when 'critical' then 1 when 'high' then 2 when 'medium' then 3 when 'low' then 4 else 5 end,
          created_at desc
        limit 20
      ) q
    ) else '[]'::jsonb end,
    'recentAudit', case when v_can_audit then (
      select coalesce(jsonb_agg(to_jsonb(q) order by q.created_at desc), '[]'::jsonb)
      from (
        select id, action, target_type, target_id, reason, created_at
        from public.staff_audit_events
        order by created_at desc
        limit 20
      ) q
    ) else '[]'::jsonb end
  );
end;
$$;

revoke all on function public.staff_dashboard_overview() from public, anon;
grant execute on function public.staff_dashboard_overview() to authenticated;

create or replace function public.staff_resolve_queue_item(
  p_kind text,
  p_item_id text,
  p_action text,
  p_reason text,
  p_request_id text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_id uuid;
  v_numeric_id bigint;
  v_kind text := lower(trim(coalesce(p_kind, '')));
  v_action text := lower(trim(coalesce(p_action, '')));
  v_reason text := trim(coalesce(p_reason, ''));
  v_before jsonb;
  v_after jsonb;
  v_slug_base text;
  v_slug text;
begin
  if v_actor is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;
  if char_length(v_reason) not between 5 and 1000 then
    raise exception 'A reason between 5 and 1000 characters is required';
  end if;
  if char_length(coalesce(p_request_id, '')) > 160 then
    raise exception 'Invalid request identifier';
  end if;

  case v_kind
    when 'listing' then
      begin
        v_id := p_item_id::uuid;
      exception when invalid_text_representation then
        raise exception 'Invalid item identifier';
      end;
      if not public.has_staff_permission('servers.review') then
        raise exception 'Listing review permission required' using errcode = '42501';
      end if;
      if v_action not in ('approved', 'changes_requested', 'rejected') then
        raise exception 'Invalid listing action';
      end if;

      select to_jsonb(s) into v_before
      from public.server_submissions s
      where s.id = v_id
      for update;
      if v_before is null then raise exception 'Listing submission not found'; end if;
      if v_before ->> 'status' not in ('pending_review', 'changes_requested') then
        raise exception 'Listing submission is already closed';
      end if;

      update public.server_submissions
      set status = v_action,
          reviewed_by = v_actor,
          reviewed_at = timezone('utc', now()),
          review_note = v_reason,
          updated_at = timezone('utc', now())
      where id = v_id;

      if v_action = 'approved' and not exists (select 1 from public.servers where source_submission_id = v_id) then
        v_slug_base := left(trim(both '-' from regexp_replace(lower(v_before ->> 'name'), '[^a-z0-9]+', '-', 'g')), 84);
        if char_length(v_slug_base) < 3 then v_slug_base := 'server'; end if;
        v_slug := v_slug_base || '-' || left(replace(v_id::text, '-', ''), 8);
        insert into public.servers (
          source_submission_id, owner_id, platform_id, name, slug, description, region,
          language, framework, community_url, age_rating, status, published_at
        ) values (
          v_id,
          (v_before ->> 'submitted_by')::uuid,
          v_before ->> 'platform_id',
          v_before ->> 'name',
          v_slug,
          v_before ->> 'description',
          v_before ->> 'region',
          v_before ->> 'language',
          nullif(v_before ->> 'framework', ''),
          nullif(v_before ->> 'community_url', ''),
          'general',
          'published',
          timezone('utc', now())
        );
      end if;

      update public.moderation_queue
      set status = case when v_action = 'changes_requested' then 'claimed' else 'resolved' end,
          assigned_to = v_actor,
          resolved_by = case when v_action = 'changes_requested' then null else v_actor end,
          resolution = v_reason,
          resolved_at = case when v_action = 'changes_requested' then null else timezone('utc', now()) end
      where target_type = 'server_submission' and target_id = v_id::text;

      select to_jsonb(s) into v_after from public.server_submissions s where s.id = v_id;

    when 'report' then
      begin
        v_id := p_item_id::uuid;
      exception when invalid_text_representation then
        raise exception 'Invalid item identifier';
      end;
      if not public.has_staff_permission('reports.resolve') then
        raise exception 'Report resolution permission required' using errcode = '42501';
      end if;
      if v_action not in ('triaged', 'resolved', 'dismissed') then raise exception 'Invalid report action'; end if;
      select to_jsonb(r) into v_before from public.reports r where r.id = v_id for update;
      if v_before is null then raise exception 'Report not found'; end if;
      if v_before ->> 'status' not in ('open', 'triaged') then raise exception 'Report is already closed'; end if;
      update public.reports
      set status = v_action,
          assigned_to = v_actor,
          resolution_note = v_reason,
          updated_at = timezone('utc', now())
      where id = v_id;
      select to_jsonb(r) into v_after from public.reports r where r.id = v_id;

    when 'moderation' then
      begin
        v_id := p_item_id::uuid;
      exception when invalid_text_representation then
        raise exception 'Invalid item identifier';
      end;
      if not public.has_staff_permission('moderation.resolve') then
        raise exception 'Moderation resolution permission required' using errcode = '42501';
      end if;
      if v_action not in ('claimed', 'resolved', 'dismissed') then raise exception 'Invalid moderation action'; end if;
      select to_jsonb(m) into v_before from public.moderation_queue m where m.id = v_id for update;
      if v_before is null then raise exception 'Moderation item not found'; end if;
      if v_before ->> 'status' not in ('open', 'claimed') then raise exception 'Moderation item is already closed'; end if;
      update public.moderation_queue
      set status = v_action,
          assigned_to = v_actor,
          resolved_by = case when v_action in ('resolved', 'dismissed') then v_actor else null end,
          resolution = v_reason,
          resolved_at = case when v_action in ('resolved', 'dismissed') then timezone('utc', now()) else null end
      where id = v_id;
      select to_jsonb(m) into v_after from public.moderation_queue m where m.id = v_id;

    when 'security' then
      begin
        v_numeric_id := p_item_id::bigint;
      exception when invalid_text_representation or numeric_value_out_of_range then
        raise exception 'Invalid item identifier';
      end;
      if not public.has_staff_permission('security.read') or not public.has_staff_permission('settings.manage') then
        raise exception 'Security resolution permission required' using errcode = '42501';
      end if;
      if v_action <> 'resolved' then raise exception 'Invalid security action'; end if;
      select to_jsonb(s) into v_before from public.security_events s where s.id = v_numeric_id for update;
      if v_before is null then raise exception 'Security event not found'; end if;
      if v_before ->> 'resolved_at' is not null then raise exception 'Security event is already resolved'; end if;
      update public.security_events
      set resolved_at = timezone('utc', now()), resolved_by = v_actor
      where id = v_numeric_id;
      select to_jsonb(s) into v_after from public.security_events s where s.id = v_numeric_id;

    else
      raise exception 'Invalid queue type';
  end case;

  insert into public.staff_audit_events (
    actor_id, action, target_type, target_id, reason, request_id, before_state, after_state
  ) values (
    v_actor,
    v_kind || '.' || v_action,
    v_kind,
    p_item_id,
    v_reason,
    nullif(p_request_id, ''),
    v_before,
    v_after
  );

  return jsonb_build_object('kind', v_kind, 'id', p_item_id, 'status', v_action);
end;
$$;

revoke all on function public.staff_resolve_queue_item(text, text, text, text, text) from public, anon;
grant execute on function public.staff_resolve_queue_item(text, text, text, text, text) to authenticated;

commit;
