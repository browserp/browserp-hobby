-- Private Discord owner allowlist and automatic staff-role provisioning.
begin;

create table if not exists private.discord_owner_allowlist (
  discord_user_id text primary key check (discord_user_id ~ '^[0-9]{17,20}$'),
  enabled boolean not null default true,
  note text not null default 'BrowseRP owner',
  created_at timestamptz not null default timezone('utc', now())
);

revoke all on table private.discord_owner_allowlist from public, anon, authenticated;

-- Owner IDs are provisioned separately through secured operations so personal
-- identifiers never need to be committed to the public source repository.

create or replace function private.grant_discord_owner(p_user_id uuid, p_discord_user_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_user_id is null or p_discord_user_id is null then return; end if;
  if not exists (
    select 1 from private.discord_owner_allowlist
    where discord_user_id = p_discord_user_id and enabled
  ) then return; end if;
  if not exists (select 1 from public.profiles where id = p_user_id) then return; end if;

  insert into public.staff_memberships (user_id, role_key, status, reason)
  values (p_user_id, 'owner', 'active', 'Discord owner allowlist')
  on conflict (user_id) do update set
    role_key = 'owner',
    status = 'active',
    reason = 'Discord owner allowlist',
    updated_at = timezone('utc', now());
end;
$$;

revoke all on function private.grant_discord_owner(uuid, text) from public, anon, authenticated;

-- Preserve conservative profile provisioning while granting an allowlisted owner.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_display text;
  v_username text;
  v_badge_id uuid;
  v_discord_user_id text;
begin
  v_display := left(regexp_replace(coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', 'New member'), '[<>\x00-\x1F\x7F]', '', 'g'), 48);
  if char_length(trim(v_display)) < 2 then v_display := 'New member'; end if;
  v_username := 'member_' || left(replace(new.id::text, '-', ''), 12);

  insert into public.profiles (id, username, display_name, avatar_url)
  values (new.id, v_username, trim(v_display), nullif(new.raw_user_meta_data ->> 'avatar_url', ''));
  insert into public.account_trust (user_id) values (new.id);

  select id into v_badge_id from public.badges where key = 'new_joiner';
  if v_badge_id is not null then
    insert into public.user_badges (user_id, badge_id, reason, expires_at)
    values (new.id, v_badge_id, 'New account', timezone('utc', now()) + interval '5 days');
  end if;

  if new.raw_app_meta_data ->> 'provider' = 'discord' then
    v_discord_user_id := coalesce(new.raw_user_meta_data ->> 'provider_id', new.raw_user_meta_data ->> 'sub');
    perform private.grant_discord_owner(new.id, v_discord_user_id);
  end if;
  return new;
end;
$$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;

-- Identity metadata is the authoritative fallback when user metadata differs.
create or replace function private.handle_discord_identity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.provider = 'discord' then
    perform private.grant_discord_owner(
      new.user_id,
      coalesce(new.provider_id, new.identity_data ->> 'provider_id', new.identity_data ->> 'sub')
    );
  end if;
  return new;
end;
$$;

revoke all on function private.handle_discord_identity() from public, anon, authenticated;

drop trigger if exists on_auth_discord_identity_created on auth.identities;
create trigger on_auth_discord_identity_created
after insert or update of identity_data, provider_id on auth.identities
for each row execute procedure private.handle_discord_identity();

-- Backfill safely if an allowlisted Discord identity already exists.
select private.grant_discord_owner(
  i.user_id,
  coalesce(i.provider_id, i.identity_data ->> 'provider_id', i.identity_data ->> 'sub')
)
from auth.identities i
where i.provider = 'discord';

commit;
