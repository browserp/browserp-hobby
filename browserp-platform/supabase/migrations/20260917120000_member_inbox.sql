begin;

-- Member conversations have no direct Data API grant. Every projection and
-- mutation below binds the caller to the current auth session in the database.
create table public.member_message_preferences (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  contact_policy text not null default 'members' check (contact_policy in ('members','nobody')),
  updated_at timestamptz not null default timezone('utc',now())
);
create table public.member_message_blocks (
  blocker_id uuid not null references public.profiles(id) on delete cascade,
  blocked_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default timezone('utc',now()),
  primary key (blocker_id,blocked_id),
  check (blocker_id <> blocked_id)
);
create table public.member_conversations (
  id uuid primary key default extensions.gen_random_uuid(),
  user_low uuid not null references public.profiles(id) on delete cascade,
  user_high uuid not null references public.profiles(id) on delete cascade,
  started_by uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default timezone('utc',now()),
  last_message_at timestamptz not null default timezone('utc',now()),
  unique (user_low,user_high),
  check (user_low < user_high),
  check (started_by in (user_low,user_high))
);
create table public.member_messages (
  id uuid primary key default extensions.gen_random_uuid(),
  conversation_id uuid not null references public.member_conversations(id) on delete cascade,
  sender_id uuid not null references public.profiles(id) on delete cascade,
  recipient_id uuid not null references public.profiles(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 1000),
  status text not null default 'pending_review' check (status in ('pending_review','delivered','blocked')),
  version bigint not null default 1 check (version between 1 and 9007199254740991),
  check_result jsonb,
  review_reason text,
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  delivered_at timestamptz,
  created_at timestamptz not null default timezone('utc',now()),
  read_at timestamptz,
  check (sender_id <> recipient_id)
);
create index member_conversations_low_idx on public.member_conversations(user_low,last_message_at desc);
create index member_conversations_high_idx on public.member_conversations(user_high,last_message_at desc);
create index member_conversations_started_idx on public.member_conversations(started_by,created_at desc);
create index member_messages_thread_idx on public.member_messages(conversation_id,created_at desc,id desc);
create index member_messages_sender_day_idx on public.member_messages(sender_id,created_at desc);
create index member_messages_review_idx on public.member_messages(created_at desc,id desc) where status='pending_review';
create index member_messages_unread_idx on public.member_messages(recipient_id,created_at desc) where read_at is null and status='delivered';
create index member_message_blocks_blocked_idx on public.member_message_blocks(blocked_id,blocker_id);

alter table public.member_message_preferences enable row level security;
alter table public.member_message_blocks enable row level security;
alter table public.member_conversations enable row level security;
alter table public.member_messages enable row level security;
revoke all on public.member_message_preferences,public.member_message_blocks,
  public.member_conversations,public.member_messages from public,anon,authenticated,service_role;

create or replace function private.member_message_user_lock(p_user uuid)
returns void language plpgsql security invoker set search_path='' as $$
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('member-message-user:'||p_user::text,0));
end;
$$;
revoke all on function private.member_message_user_lock(uuid) from public,anon,authenticated,service_role;

create or replace function public.member_message_overview(p_before_id uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid := private.require_active_member(); v_threads jsonb; v_blocks jsonb;
  before_at timestamptz; oldest_at timestamptz; oldest_id uuid; more boolean := false;
begin
  perform private.require_member_write_session(actor);
  if p_before_id is not null then
    select last_message_at into before_at from public.member_conversations
      where id=p_before_id and (user_low=actor or user_high=actor);
    if not found then raise exception 'Conversation page unavailable' using errcode='42501'; end if;
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',c.id,'username',p.username,'displayName',case when p.profile_visibility in ('public','members') then left(p.display_name,48) else p.username end,
    'lastMessageAt',c.last_message_at,'unread',(
      select count(*) from public.member_messages m
      where m.conversation_id=c.id and m.recipient_id=actor and m.status='delivered' and m.read_at is null),
    'blockedByMe',exists(select 1 from public.member_message_blocks b
      where b.blocker_id=actor and b.blocked_id=p.id)
  ) order by c.last_message_at desc,c.id desc),'[]'::jsonb) into v_threads
  from (select * from public.member_conversations
    where (user_low=actor or user_high=actor)
      and exists(select 1 from public.member_messages visible
        where visible.conversation_id=member_conversations.id
          and (visible.sender_id=actor or visible.status='delivered'))
      and (p_before_id is null or (last_message_at,id)<(before_at,p_before_id))
    order by last_message_at desc,id desc limit 50) c
  join public.profiles p on p.id=case when c.user_low=actor then c.user_high else c.user_low end;
  if jsonb_array_length(v_threads)>0 then
    oldest_id:=(v_threads->(jsonb_array_length(v_threads)-1)->>'id')::uuid;
    select last_message_at into oldest_at from public.member_conversations where id=oldest_id;
    select exists(select 1 from public.member_conversations
      where (user_low=actor or user_high=actor)
        and exists(select 1 from public.member_messages visible
          where visible.conversation_id=member_conversations.id
            and (visible.sender_id=actor or visible.status='delivered'))
        and (last_message_at,id)<(oldest_at,oldest_id)) into more;
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('username',p.username,'displayName',case when p.profile_visibility in ('public','members') then left(p.display_name,48) else p.username end)
      order by p.username),'[]'::jsonb) into v_blocks
    from public.member_message_blocks b join public.profiles p on p.id=b.blocked_id
    where b.blocker_id=actor;
  perform private.require_member_write_session(actor);
  return jsonb_build_object(
    'contactPolicy',coalesce((select contact_policy from public.member_message_preferences where user_id=actor),'members'),
    'unread', (select count(*) from public.member_messages where recipient_id=actor and status='delivered' and read_at is null),
    'conversations',v_threads,'nextBeforeId',case when more then oldest_id end,
    'blockedMembers',v_blocks);
end;
$$;

create or replace function public.member_message_thread(p_conversation_id uuid,p_before_id uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid := private.require_active_member(); partner public.profiles%rowtype;
  before_at timestamptz; oldest_at timestamptz; oldest_id uuid; page jsonb; more boolean := false;
begin
  perform private.require_member_write_session(actor);
  select p.* into partner from public.member_conversations c
    join public.profiles p on p.id=case when c.user_low=actor then c.user_high else c.user_low end
    where c.id=p_conversation_id and (c.user_low=actor or c.user_high=actor)
      and exists(select 1 from public.member_messages visible
        where visible.conversation_id=c.id and (visible.sender_id=actor or visible.status='delivered'));
  if not found then raise exception 'Conversation unavailable' using errcode='42501'; end if;
  if p_before_id is not null then
    select created_at into before_at from public.member_messages
      where id=p_before_id and conversation_id=p_conversation_id and (sender_id=actor or status='delivered');
    if not found then raise exception 'Conversation page unavailable' using errcode='22023'; end if;
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
    'id',m.id,'body',m.body,'fromMe',m.sender_id=actor,
    'createdAt',m.created_at,'status',case when m.sender_id=actor then m.status else 'delivered' end,
    'reviewReason',case when m.sender_id=actor and m.status='blocked' then m.review_reason end,
    'readAt',case when m.sender_id=actor then m.read_at end)
    order by m.created_at,m.id),'[]'::jsonb) into page
  from (select * from public.member_messages
    where conversation_id=p_conversation_id and (sender_id=actor or status='delivered')
      and (p_before_id is null or (created_at,id)<(before_at,p_before_id))
    order by created_at desc,id desc limit 50) m;
  if jsonb_array_length(page)>0 then
    oldest_id:=(page->0->>'id')::uuid;
    select created_at into oldest_at from public.member_messages where id=oldest_id;
    select exists(select 1 from public.member_messages where conversation_id=p_conversation_id
      and (sender_id=actor or status='delivered')
      and (created_at,id)<(oldest_at,oldest_id)) into more;
  end if;
  perform private.require_member_write_session(actor);
  return jsonb_build_object('id',p_conversation_id,'username',partner.username,
    'displayName',case when partner.profile_visibility in ('public','members') then left(partner.display_name,48) else partner.username end,
    'blockedByMe',exists(select 1 from public.member_message_blocks b
      where b.blocker_id=actor and b.blocked_id=partner.id),
    'canReply',partner.profile_visibility in ('public','members','basic')
      and coalesce((select contact_policy from public.member_message_preferences where user_id=actor),'members')='members'
      and coalesce((select contact_policy from public.member_message_preferences where user_id=partner.id),'members')='members'
      and not exists(select 1 from public.member_message_blocks b where
        (b.blocker_id=actor and b.blocked_id=partner.id)
        or (b.blocker_id=partner.id and b.blocked_id=actor)),
    'messages',page,'nextBeforeId',case when more then oldest_id end);
end;
$$;

create or replace function public.member_message_send(p_username text,p_body text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid := private.require_active_member(); recipient public.profiles%rowtype;
  note text := btrim(coalesce(p_body,'')); conversation uuid; message_id uuid; created timestamptz;
  low_user uuid; high_user uuid;
begin
  perform private.require_member_write_session(actor);
  perform private.enforce_member_rate_limit('message-send',12,300);
  if p_username !~ '^[a-z0-9_]{3,30}$' or char_length(note) not between 1 and 1000
      or replace(note,E'\n','') ~ '[[:cntrl:]]' then
    raise exception 'Check the recipient and message (1–1,000 characters)' using errcode='22023';
  end if;
  select * into recipient from public.profiles where username=p_username
    and profile_visibility in ('public','members','basic');
  if not found or recipient.id=actor then raise exception 'Member unavailable for messages' using errcode='42501'; end if;
  low_user:=least(actor,recipient.id); high_user:=greatest(actor,recipient.id);
  perform private.member_message_user_lock(low_user);
  perform private.member_message_user_lock(high_user);
  if coalesce((select contact_policy from public.member_message_preferences where user_id=actor),'members')<>'members'
    or coalesce((select contact_policy from public.member_message_preferences where user_id=recipient.id),'members')<>'members'
    or exists(select 1 from public.member_message_blocks b
      where (b.blocker_id=actor and b.blocked_id=recipient.id)
         or (b.blocker_id=recipient.id and b.blocked_id=actor))
    or not exists(select 1 from auth.users u where u.id=recipient.id and u.deleted_at is null and not coalesce(u.is_anonymous,false))
    or exists(select 1 from public.security_bans b where b.user_id=recipient.id and b.target_type='account'
      and b.revoked_at is null and b.starts_at<=clock_timestamp()
      and (b.ends_at is null or b.ends_at>clock_timestamp())) then
    raise exception 'Member unavailable for messages' using errcode='42501';
  end if;
  select id into conversation from public.member_conversations where user_low=low_user and user_high=high_user;
  if conversation is null then
    if (select count(*) from public.member_conversations
      where started_by=actor and created_at>clock_timestamp()-interval '1 day')>=8 then
      raise exception 'New conversation limit reached. Try again tomorrow.' using errcode='PT429';
    end if;
    insert into public.member_conversations(user_low,user_high,started_by)
      values(low_user,high_user,actor) returning id into conversation;
  end if;
  if (select count(*) from public.member_messages
    where sender_id=actor and created_at>clock_timestamp()-interval '1 day')>=50 then
    raise exception 'Daily message limit reached. Try again tomorrow.' using errcode='PT429';
  end if;
  perform private.require_member_write_session(actor);
  insert into public.member_messages(conversation_id,sender_id,recipient_id,body)
    values(conversation,actor,recipient.id,note) returning id,created_at into message_id,created;
  perform private.require_member_write_session(actor);
  return jsonb_build_object('conversationId',conversation,'messageId',message_id,'createdAt',created,'status','pending_review');
end;
$$;

create or replace function public.member_message_mark_read(p_conversation_id uuid)
returns integer language plpgsql security definer set search_path='' as $$
declare actor uuid := private.require_active_member(); changed integer;
begin
  perform private.require_member_write_session(actor);
  perform private.enforce_member_rate_limit('message-read',30,300);
  if not exists(select 1 from public.member_conversations c where c.id=p_conversation_id
    and (c.user_low=actor or c.user_high=actor)) then
    raise exception 'Conversation unavailable' using errcode='42501';
  end if;
  update public.member_messages set read_at=timezone('utc',now())
    where conversation_id=p_conversation_id and recipient_id=actor and status='delivered' and read_at is null;
  get diagnostics changed=row_count;
  update public.notifications set read_at=timezone('utc',now())
    where user_id=actor and kind='member_message' and read_at is null
      and action_url='/dashboard?thread='||p_conversation_id::text||'#inbox';
  perform private.require_member_write_session(actor);
  return changed;
end;
$$;

create or replace function public.member_message_set_policy(p_policy text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid := private.require_active_member();
begin
  perform private.require_member_write_session(actor);
  perform private.enforce_member_rate_limit('message-policy',10,900);
  if p_policy not in ('members','nobody') then raise exception 'Choose who can message you' using errcode='22023'; end if;
  perform private.member_message_user_lock(actor);
  insert into public.member_message_preferences(user_id,contact_policy)
    values(actor,p_policy) on conflict(user_id) do update
      set contact_policy=excluded.contact_policy,updated_at=timezone('utc',now());
  perform private.require_member_write_session(actor);
  return jsonb_build_object('contactPolicy',p_policy);
end;
$$;

create or replace function public.member_message_set_block(p_username text,p_block boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid := private.require_active_member(); target uuid;
begin
  perform private.require_member_write_session(actor);
  perform private.enforce_member_rate_limit('message-block',15,900);
  if p_username !~ '^[a-z0-9_]{3,30}$' or p_block is null then
    raise exception 'Choose a member and action' using errcode='22023'; end if;
  select p.id into target from public.profiles p where p.username=p_username
    and (profile_visibility in ('public','members','basic')
      or exists(select 1 from public.member_message_blocks b where b.blocker_id=actor and b.blocked_id=p.id)
      or exists(select 1 from public.member_conversations c
        where (c.user_low=actor and c.user_high=p.id) or (c.user_high=actor and c.user_low=p.id)));
  if target is null or target=actor then raise exception 'Member unavailable' using errcode='42501'; end if;
  perform private.member_message_user_lock(least(actor,target));
  perform private.member_message_user_lock(greatest(actor,target));
  if p_block then
    insert into public.member_message_blocks(blocker_id,blocked_id) values(actor,target) on conflict do nothing;
  else
    delete from public.member_message_blocks where blocker_id=actor and blocked_id=target;
  end if;
  perform private.require_member_write_session(actor);
  return jsonb_build_object('username',p_username,'blocked',p_block);
end;
$$;

-- Reporting is an explicit recipient action. Staff receive only the chosen
-- message excerpt in the existing private profile-report workflow.
create or replace function public.member_message_report(p_message_id uuid,p_category text,p_details text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid := private.require_active_member(); reported public.member_messages%rowtype;
  report_id uuid; detail text := btrim(coalesce(p_details,''));
begin
  perform private.require_member_write_session(actor);
  perform private.enforce_member_rate_limit('message-report',5,900);
  if p_category not in ('harassment','spam','unsafe-content','threat')
    or char_length(detail) not between 20 and 800 or replace(detail,E'\n','') ~ '[[:cntrl:]]' then
    raise exception 'Check the report details' using errcode='22023'; end if;
  select m.* into reported from public.member_messages m
    join public.member_conversations c on c.id=m.conversation_id
    where m.id=p_message_id and m.recipient_id=actor and m.status='delivered'
      and (c.user_low=actor or c.user_high=actor);
  if not found then raise exception 'Message unavailable to report' using errcode='42501'; end if;
  insert into public.reports(reporter_id,target_type,target_id,category,details)
    values(actor,'profile',reported.sender_id::text,p_category,
      'Private message report '||reported.id::text||E'\n'||
      detail||E'\nQuoted message: '||left(reported.body,1000))
    returning id into report_id;
  perform private.require_member_write_session(actor);
  return jsonb_build_object('id',report_id,'status','open');
end;
$$;

-- Delivery is the only operation that exposes a held message to its recipient.
-- The same user locks serialize delivery with contact-policy and block changes.
create or replace function private.member_message_deliver(p_id uuid,p_version bigint,p_reviewer uuid default null,p_reason text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare message public.member_messages%rowtype; recipient public.profiles%rowtype;
begin
  select * into message from public.member_messages where id=p_id for update;
  if message.id is null or message.status<>'pending_review' or message.version is distinct from p_version then
    raise exception 'This message changed. Reload it.' using errcode='PT409'; end if;
  perform private.member_message_user_lock(least(message.sender_id,message.recipient_id));
  perform private.member_message_user_lock(greatest(message.sender_id,message.recipient_id));
  select * into recipient from public.profiles where id=message.recipient_id;
  if recipient.id is null or recipient.profile_visibility not in ('public','members','basic')
    or coalesce((select contact_policy from public.member_message_preferences where user_id=message.sender_id),'members')<>'members'
    or coalesce((select contact_policy from public.member_message_preferences where user_id=message.recipient_id),'members')<>'members'
    or exists(select 1 from public.member_message_blocks b where
      (b.blocker_id=message.sender_id and b.blocked_id=message.recipient_id)
      or (b.blocker_id=message.recipient_id and b.blocked_id=message.sender_id))
    or exists(select 1 from (values(message.sender_id),(message.recipient_id)) users(id)
      where not exists(select 1 from auth.users u where u.id=users.id and u.deleted_at is null and not coalesce(u.is_anonymous,false))
        or exists(select 1 from public.security_bans b where b.user_id=users.id and b.target_type='account'
          and b.revoked_at is null and b.starts_at<=clock_timestamp()
          and (b.ends_at is null or b.ends_at>clock_timestamp()))) then
    raise exception 'Member unavailable for messages' using errcode='42501'; end if;
  update public.member_messages set status='delivered',version=version+1,
    reviewed_by=p_reviewer,review_reason=p_reason,reviewed_at=case when p_reviewer is not null then clock_timestamp() end,
    delivered_at=clock_timestamp() where id=p_id returning * into message;
  update public.member_conversations set last_message_at=message.delivered_at where id=message.conversation_id;
  insert into public.notifications(user_id,kind,title,body,action_url)
    values(message.recipient_id,'member_message','New message',
      'From '||(select username from public.profiles where id=message.sender_id),
      '/dashboard?thread='||message.conversation_id::text||'#inbox');
  return jsonb_build_object('id',message.id,'status',message.status,'version',message.version);
end;
$$;
revoke all on function private.member_message_deliver(uuid,bigint,uuid,text) from public,anon,authenticated,service_role;

-- Only the server service role records a classifier result. Direct authenticated
-- RPC calls can create a pending item, but cannot certify their own text.
create or replace function public.service_member_message_check(p_id uuid,p_sender uuid,p_body text,p_result jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare message public.member_messages%rowtype; decision text; checker text; code text;
begin
  if p_result is null or jsonb_typeof(p_result)<>'object' or octet_length(p_result::text)>4000 then
    raise exception 'Invalid content check' using errcode='22023'; end if;
  decision:=p_result->>'decision';checker:=p_result->>'checker';code:=p_result->'details'->>'code';
  if decision is null or decision not in ('approve','review','block') or checker is null or length(checker)>100 then
    raise exception 'Invalid content check' using errcode='22023'; end if;
  select * into message from public.member_messages where id=p_id for update;
  if message.id is null or message.sender_id is distinct from p_sender or message.body is distinct from p_body or message.status<>'pending_review'
    or message.check_result is not null then raise exception 'Message check changed' using errcode='PT409'; end if;
  update public.member_messages set check_result=p_result,version=version+1 where id=p_id returning * into message;
  if decision='approve' and checker='openai:omni-moderation-2024-09-26' and code='provider_low_risk' then
    return private.member_message_deliver(message.id,message.version);
  end if;
  return jsonb_build_object('id',message.id,'status','pending_review','version',message.version);
end;
$$;
revoke all on function public.service_member_message_check(uuid,uuid,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.service_member_message_check(uuid,uuid,text,jsonb) to service_role;

create or replace function public.staff_member_message_reviews(p_before_id uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid := private.require_active_member(); items jsonb; before_at timestamptz;
begin
  perform private.require_member_write_session(actor);
  if not public.has_staff_permission('moderation.resolve') then raise exception 'Message review permission required' using errcode='42501'; end if;
  if p_before_id is not null then
    select created_at into before_at from public.member_messages where id=p_before_id and status='pending_review';
    if not found then raise exception 'Review page changed. Reload it.' using errcode='PT409'; end if;
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',m.id,'kind','message','status',m.status,
    'version',m.version,'text',m.body,'createdAt',m.created_at,'sender',sender.username,
    'recipient',recipient.username,'checkCode',m.check_result->'details'->>'code')
    order by m.created_at desc,m.id desc),'[]'::jsonb) into items
  from (select * from public.member_messages where status='pending_review'
    and (p_before_id is null or (created_at,id)<(before_at,p_before_id))
    order by created_at desc,id desc limit 21) m
  join public.profiles sender on sender.id=m.sender_id
  join public.profiles recipient on recipient.id=m.recipient_id;
  perform private.require_member_write_session(actor);
  if not public.has_staff_permission('moderation.resolve') then raise exception 'Message review permission required' using errcode='42501'; end if;
  return jsonb_build_object('items',case when jsonb_array_length(items)>20 then items-20 else items end,
    'nextBeforeId',case when jsonb_array_length(items)>20 then items->19->>'id' end);
end;
$$;

-- A count-only receipt lets the staff Overview surface pending work without
-- loading message text or participant identities into that page.
create or replace function public.staff_member_message_pending_count()
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid := private.require_active_member(); pending bigint;
begin
  perform private.require_member_write_session(actor);
  if not public.has_staff_permission('moderation.resolve') then raise exception 'Message review permission required' using errcode='42501'; end if;
  select count(*) into pending from public.member_messages where status='pending_review';
  perform private.require_member_write_session(actor);
  if not public.has_staff_permission('moderation.resolve') then raise exception 'Message review permission required' using errcode='42501'; end if;
  return jsonb_build_object('pendingCount',pending);
end;
$$;

create or replace function public.staff_decide_member_message(p_id uuid,p_version bigint,p_action text,p_reason text,p_request_id text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid := private.require_active_member(); message public.member_messages%rowtype; result jsonb;
begin
  perform private.require_member_write_session(actor);
  if not public.has_staff_permission('moderation.resolve') then raise exception 'Message review permission required' using errcode='42501'; end if;
  if p_action is null or p_action not in ('approve','block') or char_length(btrim(coalesce(p_reason,''))) not between 5 and 500 then
    raise exception 'Choose a valid decision and reason' using errcode='22023'; end if;
  select * into message from public.member_messages where id=p_id for update;
  if message.id is null or message.status<>'pending_review' or message.version is distinct from p_version then
    raise exception 'This message changed. Reload it.' using errcode='PT409'; end if;
  if p_action='approve' then
    result:=private.member_message_deliver(p_id,p_version,actor,btrim(p_reason));
  else
    update public.member_messages set status='blocked',version=version+1,
      reviewed_by=actor,review_reason=btrim(p_reason),reviewed_at=clock_timestamp()
      where id=p_id returning * into message;
    result:=jsonb_build_object('id',message.id,'status',message.status,'version',message.version);
  end if;
  insert into public.staff_audit_events(actor_id,action,target_type,target_id,reason,request_id,before_state,after_state)
    values(actor,'message.'||p_action,'member_message',p_id::text,btrim(p_reason),left(p_request_id,100),
      jsonb_build_object('status','pending_review','version',p_version),result);
  perform private.require_member_write_session(actor);
  if not public.has_staff_permission('moderation.resolve') then raise exception 'Message review permission required' using errcode='42501'; end if;
  return result;
end;
$$;
revoke all on function public.staff_member_message_reviews(uuid),public.staff_member_message_pending_count(),
  public.staff_decide_member_message(uuid,bigint,text,text,text)
  from public,anon,authenticated,service_role;
grant execute on function public.staff_member_message_reviews(uuid),public.staff_member_message_pending_count(),
  public.staff_decide_member_message(uuid,bigint,text,text,text)
  to authenticated;

revoke all on function public.member_message_overview(uuid),
  public.member_message_thread(uuid,uuid),public.member_message_send(text,text),
  public.member_message_mark_read(uuid),public.member_message_set_policy(text),
  public.member_message_set_block(text,boolean),public.member_message_report(uuid,text,text)
  from public,anon,authenticated,service_role;
grant execute on function public.member_message_overview(uuid),
  public.member_message_thread(uuid,uuid),public.member_message_send(text,text),
  public.member_message_mark_read(uuid),public.member_message_set_policy(text),
  public.member_message_set_block(text,boolean),public.member_message_report(uuid,text,text)
  to authenticated;

-- Extend the existing owner-bound structured copy rather than leaving this
-- new private collection out of approved account-data exports.
alter function private.member_export_records(uuid) rename to member_export_records_before_inbox;
revoke all on function private.member_export_records_before_inbox(uuid) from public,anon,authenticated,service_role;
create function private.member_export_records(p_subject uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb; records jsonb; blocks jsonb; preferences jsonb;
  n bigint; bytes bigint; block_count bigint; block_bytes bigint; total_rows bigint;
begin
  if p_subject is distinct from private.require_active_member() then
    raise exception 'Only your own account can be copied.' using errcode='42501'; end if;
  result:=private.member_export_records_before_inbox(p_subject);
  select coalesce(sum(value::bigint),0) into total_rows from jsonb_each_text(result->'counts');
  select count(*),coalesce(sum(octet_length(item::text)),0) into n,bytes from (
    select jsonb_build_object('id',m.id,'conversationId',m.conversation_id,
      'sender',sender.username,'recipient',recipient.username,'body',m.body,
      'createdAt',m.created_at,'readAt',m.read_at,'status',m.status) item
    from public.member_messages m
    join public.profiles sender on sender.id=m.sender_id
    join public.profiles recipient on recipient.id=m.recipient_id
    where m.sender_id=p_subject or (m.recipient_id=p_subject and m.status='delivered')
    order by m.created_at,m.id limit 2001) bounded;
  if n>2000 or total_rows+n>10000 or octet_length((result->'collections')::text)+bytes>2000000 then
    raise exception 'This account needs a larger export. Your request remains open for staff follow-up.' using errcode='PT413'; end if;
  select coalesce(jsonb_agg(item),'[]'::jsonb) into records from (
    select jsonb_build_object('id',m.id,'conversationId',m.conversation_id,
      'sender',sender.username,'recipient',recipient.username,'body',m.body,
      'createdAt',m.created_at,'readAt',m.read_at,'status',m.status) item
    from public.member_messages m
    join public.profiles sender on sender.id=m.sender_id
    join public.profiles recipient on recipient.id=m.recipient_id
    where m.sender_id=p_subject or (m.recipient_id=p_subject and m.status='delivered')
    order by m.created_at,m.id limit 2001) bounded;
  select count(*),coalesce(sum(octet_length(item::text)),0) into block_count,block_bytes from (
    select jsonb_build_object('username',p.username,'createdAt',b.created_at) item
    from public.member_message_blocks b join public.profiles p on p.id=b.blocked_id
    where b.blocker_id=p_subject order by p.username limit 2001) bounded;
  if block_count>2000 or total_rows+n+block_count+1>10000
    or octet_length((result->'collections')::text)+bytes+block_bytes>2000000 then
    raise exception 'This account needs a larger export. Your request remains open for staff follow-up.' using errcode='PT413'; end if;
  select coalesce(jsonb_agg(item),'[]'::jsonb) into blocks from (
    select jsonb_build_object('username',p.username,'createdAt',b.created_at) item
    from public.member_message_blocks b join public.profiles p on p.id=b.blocked_id
    where b.blocker_id=p_subject order by p.username limit 2001) bounded;
  select jsonb_build_object('contactPolicy',coalesce((select contact_policy
    from public.member_message_preferences where user_id=p_subject),'members')) into preferences;
  result:=jsonb_set(result,'{collections}',(result->'collections')||jsonb_build_object(
    'memberMessages',records,'messageBlocks',blocks,'messagePreferences',preferences));
  result:=jsonb_set(result,'{counts}',(result->'counts')||jsonb_build_object(
    'memberMessages',n,'messageBlocks',block_count,'messagePreferences',1));
  if octet_length((result->'collections')::text)>2000000 or octet_length(result::text)>2097152 then
    raise exception 'This account needs a larger export. Your request remains open for staff follow-up.' using errcode='PT413'; end if;
  return result;
end;
$$;
revoke all on function private.member_export_records(uuid) from public,anon,authenticated,service_role;

commit;
