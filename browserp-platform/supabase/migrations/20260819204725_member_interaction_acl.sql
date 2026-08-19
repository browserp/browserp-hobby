-- Keep member interaction writes behind an authenticated Supabase session.
-- Supabase's default function privileges grant EXECUTE directly to API roles,
-- so revoking PUBLIC alone is not sufficient.

revoke execute on function public.member_server_interaction(uuid,text,text,text)
  from public, anon, service_role;
grant execute on function public.member_server_interaction(uuid,text,text,text)
  to authenticated;

