-- Public joining choices share a single canonical approval/application filter.
-- This changes query normalization only; raw listing metadata is preserved.
begin;

create or replace function private.discovery_game_value(p_platform text,p_kind text,p_value text)
returns text language sql immutable parallel safe set search_path='' as $$
 select coalesce(
  private.discovery_taxonomy()#>>array[p_platform,p_kind,private.discovery_normal(p_value)],
  case when p_kind='access' then case private.discovery_normal(p_value)
   when 'allowlisted' then 'whitelisted'
   when 'whitelist' then 'whitelisted'
   when 'allowlist' then 'whitelisted'
   when 'application' then 'whitelisted'
   when 'application required' then 'whitelisted'
   when 'approval required' then 'whitelisted'
   when 'open' then 'public'
   when 'open access' then 'public'
   when 'open to everyone' then 'public'
   when 'not confirmed' then 'unknown'
  end end,
  private.discovery_normal(p_value));
$$;

revoke execute on function private.discovery_game_value(text,text,text) from public,anon,authenticated,service_role;

commit;
