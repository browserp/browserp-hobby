-- Return the reviewed community website with other public listing details.
-- Private import evidence and archived listings remain excluded.
create or replace function public.public_server_import_details(p_server_ids uuid[])
returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('serverId',s.id,'imported',i.server_id is not null,'claimable',s.owner_id is null,'joinCode',i.join_code,'logoUrl',i.logo_url,'bannerUrl',i.banner_url,'websiteUrl',s.website_url,'keywords',coalesce(to_jsonb(i.keywords),'[]'::jsonb),'lastCheckedAt',i.last_checked_at,'statusUnavailable',i.last_error_at is not null and (i.last_checked_at is null or i.last_error_at>=i.last_checked_at))),'[]'::jsonb)
 from public.servers s left join public.server_import_sources i on i.server_id=s.id
 where s.id=any(p_server_ids[1:100]) and s.status='published' and s.age_rating<>'adult';
$$;
