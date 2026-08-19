-- Close authorization gaps without rewriting any production-applied migration.
begin;

-- Staff sessions must belong to a Discord-only account. Checking auth.identities
-- as well as the JWT prevents a linked Google/email identity from inheriting a
-- Discord owner's database permissions. Owners must also remain allowlisted.
create or replace function public.has_staff_permission(p_permission text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.staff_memberships sm
    join public.staff_role_permissions srp on srp.role_key = sm.role_key
    where sm.user_id = (select auth.uid())
      and sm.status = 'active'
      and srp.permission_key = p_permission
      and coalesce((select auth.jwt()) -> 'app_metadata' ->> 'provider', '') = 'discord'
      and coalesce(
        (select auth.jwt()) -> 'app_metadata' -> 'providers',
        '[]'::jsonb
      ) = '["discord"]'::jsonb
      and coalesce((select auth.jwt()) -> 'amr', '[]'::jsonb)
        @> '[{"method":"oauth"}]'::jsonb
      and exists (
        select 1
        from auth.identities i
        where i.user_id = sm.user_id
          and i.provider = 'discord'
      )
      and 1 = (
        select count(*)
        from auth.identities i
        where i.user_id = sm.user_id
      )
      and not exists (
        select 1
        from auth.identities i
        where i.user_id = sm.user_id
          and i.provider is distinct from 'discord'
      )
      and (
        sm.role_key <> 'owner'
        or exists (
          select 1
          from auth.identities i
          join private.discord_owner_allowlist a
            on a.discord_user_id = coalesce(
              i.provider_id,
              i.identity_data ->> 'provider_id',
              i.identity_data ->> 'sub'
            )
           and a.enabled
          where i.user_id = sm.user_id
            and i.provider = 'discord'
        )
      )
  );
$$;

revoke execute on function public.has_staff_permission(text) from public;
grant execute on function public.has_staff_permission(text) to anon, authenticated;

-- Authentication triggers may provision a new allowlisted owner, but must never
-- reactivate or alter a membership that was suspended, revoked, or reassigned.
create or replace function private.grant_discord_owner(p_user_id uuid, p_discord_user_id text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_user_id is null or p_discord_user_id is null then return; end if;
  if not exists (
    select 1
    from private.discord_owner_allowlist
    where discord_user_id = p_discord_user_id
      and enabled
  ) then return; end if;
  if not exists (select 1 from public.profiles where id = p_user_id) then return; end if;

  insert into public.staff_memberships (user_id, role_key, status, reason)
  values (p_user_id, 'owner', 'active', 'Discord owner allowlist')
  on conflict (user_id) do nothing;
end;
$$;

revoke all on function private.grant_discord_owner(uuid, text) from public, anon, authenticated;

-- Any non-Discord identity link or identity unlink immediately contains an
-- existing staff membership. This also covers a still-valid session created by
-- an identity that was subsequently unlinked. Discord identity updates may
-- provision a new owner, but the DO NOTHING conflict rule above prevents them
-- from undoing containment.
create or replace function private.handle_discord_identity()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid;
  v_provider text;
  v_reason text;
  v_rows integer := 0;
begin
  if tg_op = 'DELETE' then
    v_user_id := old.user_id;
    v_provider := old.provider;
    v_reason := 'identity_deleted';
  else
    v_user_id := new.user_id;
    v_provider := new.provider;

    if new.provider = 'discord' then
      perform private.grant_discord_owner(
        new.user_id,
        coalesce(new.provider_id, new.identity_data ->> 'provider_id', new.identity_data ->> 'sub')
      );
    end if;

    if new.provider is distinct from 'discord' then
      v_reason := 'non_discord_identity_linked';
    elsif 1 <> (
      select count(*)
      from auth.identities i
      where i.user_id = new.user_id
    ) then
      v_reason := 'multiple_identities_present';
    elsif exists (
      select 1
      from auth.identities i
      where i.user_id = new.user_id
        and i.provider is distinct from 'discord'
    ) then
      v_reason := 'linked_non_discord_identity_present';
    end if;
  end if;

  if v_reason is not null then
    update public.staff_memberships
    set status = 'suspended',
        updated_at = timezone('utc', now())
    where user_id = v_user_id
      and status = 'active';
    get diagnostics v_rows = row_count;

    if v_rows > 0 then
      insert into public.security_events (severity, event_type, actor_id, details)
      values (
        'high',
        'staff.identity_boundary_suspended',
        v_user_id,
        jsonb_build_object('reason', v_reason, 'provider', v_provider)
      );
    end if;
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

revoke all on function private.handle_discord_identity() from public, anon, authenticated;

drop trigger if exists on_auth_discord_identity_created on auth.identities;
drop trigger if exists on_auth_staff_identity_changed on auth.identities;
create trigger on_auth_staff_identity_changed
after insert or delete or update of identity_data, provider_id on auth.identities
for each row execute procedure private.handle_discord_identity();

-- The original comparison allowed NULL through SQL three-valued logic. Replace
-- the body, validate every nullable payment field, serialize concurrent replays,
-- and make the RPC service-role-only before any member profile can be credited.
create or replace function public.fulfill_stripe_checkout(
  p_fulfillment_secret text,
  p_stripe_event_id text,
  p_stripe_session_id text,
  p_user_id uuid,
  p_product_key text,
  p_quantity integer,
  p_amount_total integer,
  p_currency text,
  p_metadata jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hash text;
  v_product public.promotion_products%rowtype;
  v_existing public.promotion_orders%rowtype;
  v_order_id uuid;
begin
  if p_stripe_event_id is null
     or char_length(p_stripe_event_id) > 255
     or p_stripe_event_id !~ '^evt_[A-Za-z0-9_]+$' then
    raise exception 'Invalid Stripe event identifier';
  end if;
  if p_stripe_session_id is null
     or char_length(p_stripe_session_id) > 255
     or p_stripe_session_id !~ '^cs_(test|live)_[A-Za-z0-9_]+$' then
    raise exception 'Invalid Stripe session identifier';
  end if;
  if p_quantity is null or p_quantity not between 1 and 10 then
    raise exception 'Invalid quantity';
  end if;
  if p_amount_total is null or p_amount_total < 0 then
    raise exception 'Invalid payment amount';
  end if;
  if p_currency is null or p_currency !~ '^[A-Za-z]{3}$' then
    raise exception 'Invalid payment currency';
  end if;
  if p_metadata is not null and jsonb_typeof(p_metadata) <> 'object' then
    raise exception 'Invalid payment metadata';
  end if;

  select secret_hash
    into v_hash
    from private.secrets
    where key = 'stripe_fulfillment';
  if v_hash is null
     or nullif(btrim(p_fulfillment_secret), '') is null
     or extensions.crypt(p_fulfillment_secret, v_hash) is distinct from v_hash then
    raise exception 'Invalid fulfillment secret' using errcode = '42501';
  end if;

  -- Lock both unique Stripe identifiers in deterministic order. This makes a
  -- same-event/different-session race fail as a controlled conflict instead of
  -- surfacing a transient unique-constraint error.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(least(p_stripe_event_id, p_stripe_session_id), 0)
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(greatest(p_stripe_event_id, p_stripe_session_id), 0)
  );

  select *
    into v_existing
    from public.promotion_orders
    where stripe_session_id = p_stripe_session_id;
  if found then
    if v_existing.user_id is distinct from p_user_id
       or v_existing.product_key is distinct from p_product_key
       or v_existing.quantity is distinct from p_quantity
       or v_existing.amount_total is distinct from p_amount_total
       or v_existing.currency is distinct from lower(p_currency) then
      raise exception 'Conflicting Stripe session replay';
    end if;
    return jsonb_build_object('orderId', v_existing.id, 'idempotent', true);
  end if;

  select *
    into v_existing
    from public.promotion_orders
    where stripe_event_id = p_stripe_event_id;
  if found then
    if v_existing.stripe_session_id is distinct from p_stripe_session_id
       or v_existing.user_id is distinct from p_user_id
       or v_existing.product_key is distinct from p_product_key
       or v_existing.quantity is distinct from p_quantity
       or v_existing.amount_total is distinct from p_amount_total
       or v_existing.currency is distinct from lower(p_currency) then
      raise exception 'Conflicting Stripe event replay';
    end if;
    return jsonb_build_object('orderId', v_existing.id, 'idempotent', true);
  end if;

  select *
    into v_product
    from public.promotion_products
    where key = p_product_key
      and active
    for share;
  if not found then raise exception 'Unknown promotion product'; end if;
  if lower(p_currency) is distinct from v_product.currency
     or p_amount_total is distinct from v_product.unit_amount * p_quantity then
    raise exception 'Payment amount does not match catalog';
  end if;
  if not exists (select 1 from public.profiles where id = p_user_id) then
    raise exception 'Unknown member';
  end if;

  insert into public.promotion_orders (
    user_id, product_key, quantity, amount_total, currency,
    stripe_event_id, stripe_session_id, metadata
  )
  values (
    p_user_id, p_product_key, p_quantity, p_amount_total, lower(p_currency),
    p_stripe_event_id, p_stripe_session_id, coalesce(p_metadata, '{}'::jsonb)
  )
  returning id into v_order_id;

  insert into public.promotion_credit_ledger (user_id, delta, reason, source_type, source_id)
  values (
    p_user_id,
    v_product.credit_amount * p_quantity,
    'Fixed promotion credit purchase',
    'purchase',
    v_order_id::text
  );
  insert into public.notifications (user_id, kind, title, body, action_url)
  values (
    p_user_id,
    'purchase',
    'Promotion credits added',
    format('%s credits were added to your account.', v_product.credit_amount * p_quantity),
    '/dashboard'
  );
  return jsonb_build_object(
    'orderId', v_order_id,
    'credits', v_product.credit_amount * p_quantity,
    'idempotent', false
  );
end;
$$;

revoke execute on function public.fulfill_stripe_checkout(text,text,text,uuid,text,integer,integer,text,jsonb)
  from public, anon, authenticated;
grant execute on function public.fulfill_stripe_checkout(text,text,text,uuid,text,integer,integer,text,jsonb)
  to service_role;

comment on function public.fulfill_stripe_checkout(text,text,text,uuid,text,integer,integer,text,jsonb)
  is 'Service-role-only idempotent Stripe fulfillment boundary; also protected by a hashed fulfillment secret.';

commit;
