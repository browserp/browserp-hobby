-- Staged outside the active migration path. Re-create with the Supabase CLI
-- only after v1.3.0 is deployed with SUPABASE_SECRET_KEY configured.
begin;

revoke execute on function public.consume_rate_limit(text,text,integer,integer)
  from public, anon, authenticated;
grant execute on function public.consume_rate_limit(text,text,integer,integer)
  to service_role;

revoke execute on function public.record_tool_run(text)
  from public, anon, authenticated;
grant execute on function public.record_tool_run(text)
  to service_role;

revoke execute on function public.fulfill_stripe_checkout(text,text,text,uuid,text,integer,integer,text,jsonb)
  from public, anon, authenticated;
grant execute on function public.fulfill_stripe_checkout(text,text,text,uuid,text,integer,integer,text,jsonb)
  to service_role;

revoke execute on function public.create_server_submission(text,text,text,text,text,text,text,text,integer,jsonb)
  from public, anon, authenticated, service_role;

comment on function public.create_server_submission(text,text,text,text,text,text,text,text,integer,jsonb)
  is 'Legacy authenticated submission boundary retained without executable grants for rollback compatibility.';

comment on function public.consume_rate_limit(text,text,integer,integer)
  is 'Server-only privacy-preserving rate-limit mutation.';
comment on function public.record_tool_run(text)
  is 'Server-only optional deterministic tool telemetry.';
comment on function public.fulfill_stripe_checkout(text,text,text,uuid,text,integer,integer,text,jsonb)
  is 'Server-only idempotent Stripe fulfillment boundary; additionally protected by a hashed fulfillment secret.';

commit;
