create or replace function public.service_refresh_fivem_source(
  p_join_code text,
  p_online boolean,
  p_players integer,
  p_capacity integer,
  p_observed_at timestamp with time zone,
  p_logo_url text default null,
  p_banner_url text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  result jsonb;
  sid uuid;
  stored_logo text;
  stored_banner text;
begin
  if p_logo_url is not null and p_logo_url !~ '^https://kywabzfgjoqiznnxygbq[.]supabase[.]co/storage/v1/object/public/server-media/[a-z0-9]{6,12}/[a-f0-9]{16,64}[.](png|jpg|jpeg|webp|gif)$' then
    raise exception 'Use approved stored server media';
  end if;
  if p_banner_url is not null and p_banner_url !~ '^https://kywabzfgjoqiznnxygbq[.]supabase[.]co/storage/v1/object/public/server-media/[a-z0-9]{6,12}/[a-f0-9]{16,64}[.](png|jpg|jpeg|webp|gif)$' then
    raise exception 'Use approved stored server media';
  end if;

  result := public.service_refresh_fivem_snapshot(
    p_join_code,
    p_online,
    p_players,
    p_capacity,
    p_observed_at
  );
  sid := nullif(result ->> 'serverId', '')::uuid;
  if sid is null then
    raise exception 'Unknown published FiveM import';
  end if;

  update public.server_import_sources
  set logo_url = coalesce(p_logo_url, logo_url),
      banner_url = coalesce(p_banner_url, banner_url)
  where server_id = sid
  returning logo_url, banner_url into stored_logo, stored_banner;

  if not found then
    raise exception 'Unknown published FiveM import';
  end if;

  return result || jsonb_build_object(
    'logoUrl', stored_logo,
    'bannerUrl', stored_banner
  );
end;
$$;

revoke all on function public.service_refresh_fivem_source(text, boolean, integer, integer, timestamp with time zone, text, text) from public, anon, authenticated;
grant execute on function public.service_refresh_fivem_source(text, boolean, integer, integer, timestamp with time zone, text, text) to service_role;
comment on function public.service_refresh_fivem_source(text, boolean, integer, integer, timestamp with time zone, text, text) is 'Refreshes a published FiveM observation and retains only validated, first-party stored artwork.';
