-- Match the existing owner/import feature "police" to the displayed Police RP
-- choice. Preserve every other game, feature, ranking rule and stored tag.
begin;

do $migration$
declare
  taxonomy jsonb := private.discovery_taxonomy();
begin
  if taxonomy #>> '{fivem,feature,police rp}' is distinct from 'police rp'
    or (taxonomy #>> '{fivem,feature,police}' is not null
      and taxonomy #>> '{fivem,feature,police}' is distinct from 'police rp') then
    raise exception 'Police feature meaning changed; review before adding its alias';
  end if;
  taxonomy := jsonb_set(taxonomy, '{fivem,feature,police}', '"police rp"'::jsonb, true);
  -- Keep the current full taxonomy, adding only the exact reviewed alias.
  execute format(
    'create or replace function private.discovery_taxonomy() returns jsonb language sql immutable parallel safe set search_path = %L as %L',
    '', 'select ' || quote_literal(taxonomy::text) || '::jsonb;'
  );
end;
$migration$;

revoke execute on function private.discovery_taxonomy() from public,anon,authenticated,service_role;

commit;
