begin;

-- Read-only readiness only. No table grants, deletion executor, request-state
-- mutation, retention policy, storage operation or automatic fulfilment.
create function private.require_account_erasure_review(p_request_id uuid,p_expected_version bigint)
returns private.account_data_requests language plpgsql stable security definer set search_path='' as $$
declare r private.account_data_requests; actor uuid := (select auth.uid());
begin
  if actor is null or private.can_fulfill_data_requests() is distinct from true
    or not exists(select 1 from public.staff_memberships where user_id=actor and role_key='owner' and status='active') then
    raise exception 'An active owner account with privacy permission and an authenticator is required.' using errcode='42501';
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
revoke all on function private.require_account_erasure_review(uuid,bigint) from public,anon,authenticated,service_role;

create function public.staff_account_erasure_preflight_access(p_request_id uuid,p_expected_version bigint)
returns boolean language plpgsql stable security definer set search_path='' as $$
begin
  perform private.require_account_erasure_review(p_request_id,p_expected_version);
  return true;
end;
$$;
revoke all on function public.staff_account_erasure_preflight_access(uuid,bigint) from public,anon,authenticated,service_role;
grant execute on function public.staff_account_erasure_preflight_access(uuid,bigint) to authenticated;

create function public.staff_account_erasure_preflight(p_request_id uuid,p_expected_version bigint)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  r private.account_data_requests := private.require_account_erasure_review(p_request_id,p_expected_version);
  queue jsonb := '[]'; dependencies jsonb := '[]'; supplemental jsonb := '[]'; missing jsonb := '[]';
  item jsonb; seed record; edge record; i integer := 0; n integer; edge_count integer := 0;
  relation_oid oid; relation_name text; predicate text; join_condition text; depth integer;
  graph_complete boolean := true; counts_complete boolean := true; guards jsonb;
  owned_servers integer; shared_adverts integer; active_staff boolean; owned_storage integer;
begin
  -- Non-FK roots are deliberately enumerated. Each SQL predicate is a literal
  -- authored here; request values only enter via a bound UUID parameter.
  -- Missing optional tables are visible, never silently counted as zero.
  for seed in select * from (values
    ('auth.users','t0.id=$1','account',false),
    ('auth.sessions','t0.user_id=$1','auth_sessions',false),
    ('auth.identities','t0.user_id=$1','auth_identities',false),
    ('auth.mfa_factors','t0.user_id=$1','auth_mfa_factors',true),
    ('public.account_activity','t0.user_id=$1','security_activity',false),
    ('private.data_export_approvals','t0.user_id=$1 or t0.approved_by=$1','export_approvals',false),
    ('private.member_data_exports','t0.user_id=$1','export_copies',false),
    ('private.account_data_request_history','t0.actor_id=$1','request_history_actor',false),
    ('private.account_data_request_review_keys','t0.actor_id=$1','request_review_keys_actor',false),
    ('private.account_data_request_fulfillments','t0.actor_id=$1','request_fulfilment_actor',false),
    ('public.reports','t0.target_type=''profile'' and t0.target_id=$1::text','reports_about_account',false),
    ('public.moderation_queue','t0.target_type=''profile'' and t0.target_id=$1::text','moderation_about_account',false),
    ('public.staff_audit_events','t0.target_id=$1::text or t0.before_state->>''userId''=$1::text or t0.after_state->>''userId''=$1::text or t0.before_state->>''user_id''=$1::text or t0.after_state->>''user_id''=$1::text','audit_account_reference',false),
    ('private.advertising_enquiry_keys','t0.actor_id=$1','advertising_review_actor',true),
    ('private.staff_duty_state','t0.user_id=$1','staff_duty_state',true),
    ('private.staff_work_sessions','t0.user_id=$1','staff_work_sessions',true),
    ('private.staff_duty_requests','t0.actor_id=$1','staff_duty_requests',true),
    ('private.member_recommendation_preferences','t0.user_id=$1','member_optional_preference',true),
    ('private.discord_role_sync_audit','t0.actor_id=$1 or t0.discord_user_id in (select coalesce(i.provider_id,i.identity_data->>''provider_id'',i.identity_data->>''sub'') from auth.identities i where i.user_id=$1 and i.provider=''discord'')','deferred_discord_sync_evidence',true),
    ('private.discord_role_sync_members','t0.discord_user_id in (select coalesce(i.provider_id,i.identity_data->>''provider_id'',i.identity_data->>''sub'') from auth.identities i where i.user_id=$1 and i.provider=''discord'')','deferred_discord_sync_member',true),
    ('private.discord_owner_allowlist','t0.discord_user_id in (select coalesce(i.provider_id,i.identity_data->>''provider_id'',i.identity_data->>''sub'') from auth.identities i where i.user_id=$1 and i.provider=''discord'')','discord_allowlist',false),
    ('storage.objects','t0.owner_id=$1::text or split_part(t0.name,''/'',1)=$1::text or (t0.bucket_id=''advertisements'' and split_part(t0.name,''/'',1)=''staff'' and split_part(t0.name,''/'',2)=$1::text) or exists(select 1 from public.uploaded_assets a where a.owner_id=$1 and a.bucket=t0.bucket_id and a.object_path=t0.name)','stored_objects',false)
  ) seeds(relation,predicate,category,optional) loop
    relation_oid := to_regclass(seed.relation);
    if relation_oid is null then
      missing := missing || jsonb_build_array(jsonb_build_object('relation',seed.relation,'optional',seed.optional));
      if not seed.optional then graph_complete := false; end if;
      continue;
    end if;
    queue := queue || jsonb_build_array(jsonb_build_object('relation',seed.relation,'oid',relation_oid::text,
      'predicate',seed.predicate,'category',seed.category,'depth',0,'visited',jsonb_build_array(relation_oid::text),'via','[]'::jsonb));
  end loop;

  -- Inspect actual installed FK actions, including indirect dependencies such
  -- as immutable export files, report appeals, shared listing interactions and
  -- newly installed member preferences/duty tables. A dependency path is not a
  -- prediction that a cascade is authorised or that it would succeed.
  while i<jsonb_array_length(queue) loop
    if i>=250 then graph_complete := false; exit; end if;
    item := queue->i; i := i+1;
    relation_oid := (item->>'oid')::oid; relation_name := item->>'relation'; depth := (item->>'depth')::integer;
    predicate := item->>'predicate';
    execute format('select count(*)::integer from (select 1 from %s t%s where (%s) limit 1001) bounded',relation_oid::regclass,depth,predicate) into n using r.user_id;
    if n>1000 then counts_complete := false; end if;
    select coalesce(jsonb_agg(t.tgname order by t.tgname),'[]') into guards from pg_catalog.pg_trigger t
      where t.tgrelid=relation_oid and not t.tgisinternal and t.tgenabled<>'D';
    dependencies := dependencies || jsonb_build_array(jsonb_build_object('relation',relation_name,'category',item->>'category',
      'via',item->'via','count',least(n,1000),'countIsLowerBound',n>1000,'triggers',guards));
    for edge in
      select c.*,ns.nspname,cl.relname from pg_catalog.pg_constraint c
      join pg_catalog.pg_class cl on cl.oid=c.conrelid join pg_catalog.pg_namespace ns on ns.oid=cl.relnamespace
      where c.contype='f' and c.confrelid=relation_oid and ns.nspname in ('public','private','auth','storage')
      order by ns.nspname,cl.relname,c.conname
    loop
      edge_count := edge_count+1;
      if depth>=6 or item->'visited' @> jsonb_build_array(edge.conrelid::text) then graph_complete := false; continue; end if;
      if jsonb_array_length(queue)>=250 then graph_complete := false; continue; end if;
      select string_agg(format('t%s.%I=t%s.%I',depth+1,child.attname,depth,parent.attname),' and ' order by k.pos)
        into join_condition from unnest(edge.conkey,edge.confkey) with ordinality k(child_num,parent_num,pos)
        join pg_catalog.pg_attribute child on child.attrelid=edge.conrelid and child.attnum=k.child_num
        join pg_catalog.pg_attribute parent on parent.attrelid=edge.confrelid and parent.attnum=k.parent_num;
      queue := queue || jsonb_build_array(jsonb_build_object('relation',format('%I.%I',edge.nspname,edge.relname),'oid',edge.conrelid::text,
        'predicate',format('exists(select 1 from %s t%s where (%s) and %s)',relation_oid::regclass,depth,predicate,join_condition),
        'category',item->>'category','depth',depth+1,'visited',(item->'visited')||jsonb_build_array(edge.conrelid::text),
        'via',(item->'via')||jsonb_build_array(jsonb_build_object('constraint',edge.conname,'from',relation_name,
          'to',format('%I.%I',edge.nspname,edge.relname),'deleteAction',case edge.confdeltype when 'c' then 'cascade' when 'n' then 'set_null' when 'r' then 'restrict' when 'a' then 'no_action' when 'd' then 'set_default' end))));
    end loop;
  end loop;

  select count(*)::integer into owned_servers from(select 1 from public.servers where owner_id=r.user_id limit 1001)s;
  select count(*)::integer into shared_adverts from(select 1 from public.ad_campaigns ad join public.uploaded_assets a on a.id=ad.image_asset_id
    where a.owner_id=r.user_id and ad.owner_id<>r.user_id limit 1001)s;
  select exists(select 1 from public.staff_memberships where user_id=r.user_id and status='active') into active_staff;
  select coalesce(max((x->>'count')::integer),0) into owned_storage from jsonb_array_elements(dependencies)x where x->>'category'='stored_objects' and x->'via'='[]'::jsonb;
  supplemental := jsonb_build_object('ownedServers',least(owned_servers,1000),'ownedServersCountIsLowerBound',owned_servers>1000,
    'otherOwnersAdvertsUsingUploads',least(shared_adverts,1000),'sharedAdvertsCountIsLowerBound',shared_adverts>1000,
    'activeStaff',active_staff,'storedObjects',owned_storage);

  return jsonb_build_object('contractVersion',1,'mode','read-only','executionEnabled',false,'asOf',statement_timestamp(),
    'request',jsonb_build_object('id',r.id,'version',r.version,'status',r.status),'subjectId',r.user_id,
    'coverage',jsonb_build_object('dependencyGraphComplete',graph_complete,'boundedCountsComplete',counts_complete and owned_servers<=1000 and shared_adverts<=1000,
      'maxPaths',250,'maxDepth',6,'countLimit',1000,'dependencyPathsInspected',i,'foreignKeyEdgesInspected',edge_count,
      'fullErasureInventory',false,'missingRelations',missing),
    'dependencies',dependencies,'summary',supplemental,
    'policyDecisions',jsonb_build_array(
      jsonb_build_object('id','retained_evidence','decision','Define which mixed reports, appeals, account/network security evidence, staff duty corrections and audit snapshots to retain, minimise or remove, with purpose, access and duration.'),
      jsonb_build_object('id','financial_records','decision','Define retention and account-reference treatment for existing financial/entitlement evidence; inactive payments do not prove that no historical records exist.'),
      jsonb_build_object('id','shared_ownership','decision','Define transfer or withdrawal handling for owned listings, published resources, advertising and shared media, and who can accept ownership.'),
      jsonb_build_object('id','request_evidence','decision','Define minimal request and completion evidence and its retention; current immutable request/export records must not be bypassed.'),
      jsonb_build_object('id','backups','decision','Define retained backup expiry, access and restore-time reapplication of erasure, including external encrypted captures and provider backups.')),
    'technicalBlockers',jsonb_build_array(
      jsonb_build_object('id','executor_unimplemented','detail','No removal executor or durable media/Auth retry ledger is installed by this migration.'),
      jsonb_build_object('id','immutable_request_dependencies','detail','The deletion request itself references auth.users; request history, fulfilments and export approvals are immutable. A reviewed retention-aware schema transition is needed before Auth removal.'),
      jsonb_build_object('id','unstructured_and_external_inventory','detail','Exact references and FK paths do not exhaust personal data in free text, JSON snapshots, external logs, contact-email-only appeals, storage aliases, copies, caches or backups.'),
      jsonb_build_object('id','shared_reference_inventory','detail','Owned listing and advert references are indicators. Transfer, other members content, resource download assets and URL-based shared-media references need a separate review before deletion.'),
      jsonb_build_object('id','current_readiness','detail','Revalidate request version, authority, schema and data after decisions; this report does not freeze writes or authorise deletion.')),
    'warnings',jsonb_build_array('Counts belong to dependency paths and overlap; never sum them as distinct records.',
      'FK actions describe the schema, not the approved retention outcome. Triggers can reject or add side effects to deletion.',
      'A zero count is not proof that no personal data remains; fullErasureInventory is always false.',
      'No access is revoked, data removed, external role sync activated or request fulfilled by this report.'));
end;
$$;
revoke all on function public.staff_account_erasure_preflight(uuid,bigint) from public,anon,authenticated,service_role;
grant execute on function public.staff_account_erasure_preflight(uuid,bigint) to authenticated;

commit;
