-- Private, versioned decisions. No provider is enabled by this migration.
begin;
create table private.content_submissions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('comment','display_name','avatar')),
  target_id uuid not null,
  comment_id uuid generated always as (case when kind='comment' then target_id end) stored
    references public.server_comments(id) on delete cascade deferrable initially deferred,
  content_text text check (char_length(content_text) <= 1000),
  source_url text check (char_length(source_url) <= 2048),
  asset_id uuid references public.uploaded_assets(id) on delete set null,
  fingerprint text not null,
  status text not null default 'pending_review' check (status in ('pending_review','published','blocked','superseded')),
  reason text not null default 'Waiting for a content check or staff review.' check (char_length(reason) between 5 and 500),
  version bigint not null default 1 check (version between 1 and 9007199254740991),
  check_result jsonb,
  checked_at timestamptz,
  check_applied_at timestamptz,
  appeal_status text not null default 'none' check (appeal_status in ('none','pending','resolved')),
  appeal_statement text check (char_length(appeal_statement) between 5 and 1000),
  appealed_at timestamptz,
  reviewed_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);
alter table private.content_submissions add constraint content_owner_profile_fk foreign key(owner_id)
 references public.profiles(id) on delete cascade deferrable initially deferred;
alter table private.content_submissions enable row level security;
revoke all on private.content_submissions from public,anon,authenticated,service_role;
create index content_submissions_owner_page on private.content_submissions(owner_id,created_at desc,id desc);
create index content_submissions_review_page on private.content_submissions(kind,created_at desc,id desc) where status='pending_review' or appeal_status='pending';
create index content_submissions_target on private.content_submissions(kind,target_id,created_at desc);
create index content_submissions_duplicate on private.content_submissions(owner_id,kind,fingerprint,created_at desc);
create unique index content_submissions_one_identity on private.content_submissions(owner_id,kind) where kind<>'comment' and status='pending_review';

create or replace function private.content_item(s private.content_submissions)
returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('id',s.id,'kind',s.kind,'targetId',s.target_id,'status',s.status,'reason',s.reason,
   'version',s.version,'createdAt',s.created_at,'appealStatus',s.appeal_status,
   'appealStatement',s.appeal_statement,'text',s.content_text,
   'previewUrl',case when s.kind='avatar' and s.asset_id is not null then '/api/content-moderation/preview?id='||s.id::text else null end);
$$;

create or replace function private.stage_content(p_owner uuid,p_kind text,p_target uuid,p_text text default null,p_asset uuid default null,p_source text default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare v_id uuid; v_fingerprint text;
begin
 if p_kind not in ('comment','display_name','avatar') then raise exception 'Invalid content kind'; end if;
 perform pg_advisory_xact_lock(hashtextextended(p_owner::text||':content:'||p_kind,0));
 v_fingerprint:=encode(sha256(convert_to(coalesce(p_text,p_asset::text,p_source,''),'UTF8')),'hex');
 if p_kind<>'comment' then
   select id into v_id from private.content_submissions where owner_id=p_owner and kind=p_kind
     and fingerprint=v_fingerprint and status in ('pending_review','blocked') order by created_at desc limit 1;
   if v_id is not null then return v_id; end if;
   update private.content_submissions set status='superseded',version=version+1,updated_at=clock_timestamp(),
     reason='Replaced by a newer submission.',appeal_status=case when appeal_status='pending' then 'resolved' else appeal_status end
     where owner_id=p_owner and kind=p_kind and status in ('pending_review','blocked');
 end if;
 insert into private.content_submissions(owner_id,kind,target_id,content_text,asset_id,source_url,fingerprint)
 values(p_owner,p_kind,p_target,p_text,p_asset,p_source,v_fingerprint) returning id into v_id;
 return v_id;
end;
$$;

-- Keep approved public values in profiles, never unreviewed replacements.
create or replace function private.guard_profile_identity()
returns trigger language plpgsql security definer set search_path='' as $$
declare v_name text; v_meta jsonb;
begin
 if tg_op='INSERT' then
   select raw_user_meta_data into v_meta from auth.users where id=new.id;
   v_name:=left(btrim(regexp_replace(coalesce(v_meta->>'global_name',v_meta->>'full_name',v_meta->>'name',new.display_name),'[<>[:cntrl:]]','','g')),48);
   if char_length(v_name)>=2 and v_name<>'BrowseRP member' then perform private.stage_content(new.id,'display_name',new.id,v_name); end if;
   if new.avatar_url ~ '^https://(cdn[.]discordapp[.]com|lh3[.]googleusercontent[.]com)/' then
     perform private.stage_content(new.id,'avatar',new.id,null,null,new.avatar_url);
   end if;
   new.display_name:='BrowseRP member';new.avatar_url:=null;new.approved_avatar_url:=null;new.avatar_review_status:='not_set';
 elsif new.display_name is distinct from old.display_name then
   if not exists(select 1 from private.content_submissions s where s.owner_id=new.id and s.kind='display_name'
     and s.status='published' and s.content_text=new.display_name)
     and not public.has_staff_permission('profiles.review') then
     raise exception 'A reviewed display name is required' using errcode='42501';
   end if;
   -- A deliberate staff identity edit supersedes any earlier member candidate.
   if public.has_staff_permission('profiles.review') and not (new.display_name='BrowseRP member' and exists(
     select 1 from private.content_submissions s where s.owner_id=new.id and s.kind='display_name' and s.status='blocked' and s.content_text=old.display_name)) then
     update private.content_submissions set status='superseded',version=version+1,reason='Replaced by a reviewed profile edit.',updated_at=clock_timestamp()
       where owner_id=new.id and kind='display_name' and status in ('pending_review','blocked');
   end if;
 end if;
 if tg_op='UPDATE' and (new.avatar_url is distinct from old.avatar_url or new.approved_avatar_url is distinct from old.approved_avatar_url) then
   if new.avatar_url is null and new.approved_avatar_url is null and exists(
     select 1 from private.content_submissions s where s.owner_id=new.id and s.kind='avatar' and s.status='blocked'
       and old.avatar_url='https://www.browserp.com/api/public/profile-avatar?id='||s.id::text) then
     new.avatar_review_status:='not_set';
   elsif not exists(select 1 from private.content_submissions s where s.owner_id=new.id and s.kind='avatar' and s.status='published'
     and s.asset_id is not null and new.avatar_url='https://www.browserp.com/api/public/profile-avatar?id='||s.id::text
     and new.approved_avatar_url=new.avatar_url) then
     raise exception 'A reviewed profile picture is required' using errcode='42501';
   end if;
 end if;
 return new;
end;
$$;
create trigger a_profile_identity_guard before insert or update of display_name,avatar_url,approved_avatar_url on public.profiles
 for each row execute function private.guard_profile_identity();

-- Every comment path, including direct authenticated RPCs and replies, stages
-- a private decision. Staff body edits must pass review again.
create or replace function private.stage_comment_content()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if tg_op='INSERT' or new.body is distinct from old.body then
   new.status:='pending_review';
   update private.content_submissions set status='superseded',version=version+1,reason='Replaced by an edited comment.',updated_at=clock_timestamp()
     where kind='comment' and target_id=new.id and status in ('pending_review','blocked','published');
   perform private.stage_content(new.author_id,'comment',new.id,new.body);
 end if;
 return new;
end;
$$;
create trigger content_comment_stage before insert or update of body on public.server_comments for each row execute function private.stage_comment_content();

-- Preserve legacy staff comment controls while invalidating outstanding checks.
create or replace function private.sync_comment_decision()
returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.status is distinct from old.status and new.status in ('published','rejected','hidden') then
   update private.content_submissions set status=case when new.status='published' then 'published' else 'blocked' end,
     reason=case when new.status='published' then 'Approved for publication.' else 'This comment was blocked by staff. You can ask for a free review.' end,
     version=version+1,updated_at=clock_timestamp(),appeal_status=case when appeal_status='pending' then 'resolved' else appeal_status end
   where kind='comment' and target_id=new.id and status<>'superseded'
     and status<>case when new.status='published' then 'published' else 'blocked' end;
 end if;
 return new;
end;
$$;
create trigger content_comment_sync after update of status on public.server_comments for each row execute function private.sync_comment_decision();

-- Queue-only decisions cannot prove which version staff reviewed. Keep the
-- legacy resolver for untouched legacy rows, but require the versioned content
-- review path as soon as a comment is enrolled in this private flow.
create or replace function public.staff_resolve_comment_review(
  p_queue_id uuid,p_action text,p_reason text,p_request_id text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid()); v_comment_id uuid; v_before jsonb; v_after jsonb;
  v_action text := lower(btrim(coalesce(p_action,''))); v_reason text := btrim(coalesce(p_reason,''));
begin
  if not public.has_staff_permission('moderation.resolve') then
    raise exception 'Moderation resolution permission required' using errcode='42501';
  end if;
  if v_action not in ('approve','reject','hide') or char_length(v_reason) not between 5 and 500 then
    raise exception 'A valid comment decision and reason are required';
  end if;
  select q.target_id::uuid into v_comment_id from public.moderation_queue q
  where q.id=p_queue_id and q.target_type='server_comment' and q.status in ('open','claimed') for update;
  if v_comment_id is null then raise exception 'Comment review item is no longer open' using errcode='40001'; end if;
  select to_jsonb(c) into v_before from public.server_comments c where c.id=v_comment_id for update;
  if v_before is null then raise exception 'Comment not found'; end if;
  if exists(select 1 from private.content_submissions s where s.kind='comment' and s.target_id=v_comment_id and s.status<>'superseded') then
    raise exception 'Open the current versioned content review before deciding' using errcode='PT409';
  end if;
  update public.server_comments set
    status=case v_action when 'approve' then 'published' when 'reject' then 'rejected' else 'hidden' end,
    updated_at=timezone('utc',now()) where id=v_comment_id;
  update public.moderation_queue set status='resolved',assigned_to=v_actor,resolved_by=v_actor,
    resolution=v_reason,resolved_at=timezone('utc',now()) where id=p_queue_id;
  select to_jsonb(c) into v_after from public.server_comments c where c.id=v_comment_id;
  insert into public.staff_audit_events(actor_id,action,target_type,target_id,reason,request_id,before_state,after_state)
  values(v_actor,'comment.'||v_action,'server_comment',v_comment_id::text,v_reason,nullif(p_request_id,''),v_before,v_after);
  return jsonb_build_object('queueId',p_queue_id,'commentId',v_comment_id,'status',v_after->>'status');
end;
$$;

create or replace function public.member_update_profile(p_display_name text,p_bio text,p_visibility text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_user uuid:=private.require_active_member();v_name text:=btrim(coalesce(p_display_name,''));v_bio text:=btrim(coalesce(p_bio,''));v_id uuid;
begin
 perform private.enforce_member_rate_limit('profile-update',12,900);
 perform private.require_member_write_session(v_user);
 if char_length(v_name) not between 2 and 48 or v_name ~ '[<>[:cntrl:]]'
   or char_length(v_bio)>500 or v_bio ~ '[[:cntrl:]]' or p_visibility not in ('public','members','private') then raise exception 'Invalid profile details'; end if;
 perform 1 from public.profiles where id=v_user for update;
 if not found then raise exception 'Profile not found';end if;
 if v_name is distinct from (select display_name from public.profiles where id=v_user) then
   v_id:=private.stage_content(v_user,'display_name',v_user,v_name);
 end if;
 update public.profiles set bio=v_bio,profile_visibility=p_visibility,updated_at=clock_timestamp() where id=v_user;
 perform private.require_member_write_session(v_user);
 return (select jsonb_build_object('displayName',p.display_name,'bio',p.bio,'visibility',p.profile_visibility,
   'avatarUrl',p.avatar_url,'avatarStatus',p.avatar_review_status,'bioStatus',p.bio_review_status,
   'moderation', (select private.content_item(s) from private.content_submissions s where s.id=v_id)) from public.profiles p where p.id=v_user);
end;
$$;

create or replace function public.member_server_interaction(
  p_server_id uuid,p_action text,p_body text default null,p_category text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare v_user uuid:=(select auth.uid()); v_id uuid; v_action text:=lower(btrim(coalesce(p_action,'')));
begin
  perform private.require_active_member();
  perform private.enforce_member_rate_limit('server-interaction',20,300);
  if v_user is null then raise exception 'Sign in to continue' using errcode='42501'; end if;
  if not exists(select 1 from public.servers where id=p_server_id and status='published' and age_rating<>'adult') then raise exception 'Server not found'; end if;
  if v_action='vote' then
    insert into public.server_votes(server_id,user_id) values(p_server_id,v_user) on conflict do nothing;
    return jsonb_build_object('voted',true,'voteCount',(select count(*) from public.server_votes where server_id=p_server_id));
  elsif v_action='unvote' then
    delete from public.server_votes where server_id=p_server_id and user_id=v_user;
    return jsonb_build_object('voted',false,'voteCount',(select count(*) from public.server_votes where server_id=p_server_id));
  elsif v_action='comment' then
    perform private.require_member_write_session(v_user);
    if char_length(btrim(coalesce(p_body,''))) not between 3 and 1000 then raise exception 'Comment must be between 3 and 1,000 characters'; end if;
    insert into public.server_comments(server_id,author_id,body) values(p_server_id,v_user,btrim(p_body)) returning id into v_id;
    insert into public.moderation_queue(target_type,target_id,confidence,score,reasons)
    values('server_comment',v_id::text,'review_recommended',40,'["member_comment"]'::jsonb);
    perform private.require_member_write_session(v_user);
    return jsonb_build_object('id',v_id,'status','pending_review');
  elsif v_action='report' then
    if char_length(btrim(coalesce(p_body,''))) not between 20 and 2000 or char_length(btrim(coalesce(p_category,''))) not between 3 and 80 then raise exception 'A report category and details are required'; end if;
    insert into public.reports(reporter_id,target_type,target_id,category,details)
    values(v_user,'server',p_server_id::text,btrim(p_category),btrim(p_body)) returning id into v_id;
    return jsonb_build_object('id',v_id,'status','open');
  end if;
  raise exception 'Invalid server action';
end;
$$;

-- Retire the old client-callable immediate-publication RPC.
revoke all on function public.member_set_profile_avatar(text,uuid) from public,anon,authenticated,service_role;
create or replace function public.member_submit_profile_avatar(p_asset_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_user uuid:=private.require_active_member();v_id uuid;
begin
 perform private.enforce_member_rate_limit('profile-avatar',6,3600);
 perform private.require_member_write_session(v_user);
 perform 1 from public.profiles where id=v_user for update;
 if not exists(select 1 from public.uploaded_assets where id=p_asset_id and owner_id=v_user and bucket='uploads-quarantine'
   and media_type='avatar' and mime_type='image/png' and byte_size between 70 and 1048576 and moderation_status='quarantined') then
   raise exception 'A private prepared profile picture is required' using errcode='42501';end if;
 v_id:=private.stage_content(v_user,'avatar',v_user,null,p_asset_id);
 perform private.require_member_write_session(v_user);
 return (select private.content_item(s) from private.content_submissions s where id=v_id);
end;
$$;

create or replace function public.member_content_moderation(p_before jsonb default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_user uuid:=private.require_active_member();v_items jsonb;v_more boolean;v_before_at timestamptz;v_before_id uuid;
begin
 if p_before is not null then
   if jsonb_typeof(p_before)<>'object' or length(p_before::text)>200 then raise exception 'Invalid page cursor';end if;
   v_before_at:=(p_before->>'createdAt')::timestamptz;v_before_id:=(p_before->>'id')::uuid;
   if v_before_at is null or not isfinite(v_before_at) or v_before_id is null then raise exception 'Invalid page cursor';end if;
 end if;
 select coalesce(jsonb_agg(private.content_item(s) order by s.created_at desc,s.id desc),'[]') into v_items from (
   select * from private.content_submissions where owner_id=v_user
   and (v_before_at is null or (created_at,id)<(v_before_at,v_before_id)) order by created_at desc,id desc limit 21) s;
 v_more:=jsonb_array_length(v_items)>20;
 if v_more then v_items:=v_items-20;end if;
 return jsonb_build_object('items',v_items,'nextBefore',case when v_more then jsonb_build_object('createdAt',v_items->19->>'createdAt','id',v_items->19->>'id') end);
end;
$$;

create or replace function public.member_content_moderation_item(p_id uuid default null,p_target uuid default null,p_kind text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_user uuid:=private.require_active_member();v_item jsonb;
begin
 select private.content_item(s) into v_item from private.content_submissions s where owner_id=v_user
   and ((p_id is not null and id=p_id) or (p_id is null and target_id=p_target and kind=p_kind)) order by created_at desc,id desc limit 1;
 if v_item is null then raise exception 'Content submission not found' using errcode='PT404';end if;
 return v_item;
end;
$$;

create or replace function public.member_appeal_content(p_id uuid,p_version bigint,p_statement text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_user uuid:=private.require_active_member();s private.content_submissions;
begin
 perform private.enforce_member_rate_limit('content-appeal',6,3600);
 perform private.require_member_write_session(v_user);
 if char_length(btrim(coalesce(p_statement,''))) not between 5 and 1000 then raise exception 'Explain your appeal in 5 to 1,000 characters';end if;
 select * into s from private.content_submissions where id=p_id and owner_id=v_user for update;
 if s.id is null then raise exception 'Content submission not found' using errcode='PT404';end if;
 perform private.require_member_write_session((select auth.uid()));
 if p_version is null or p_version not between 1 and 9007199254740990 or s.version is distinct from p_version or s.status<>'blocked' or s.appeal_status<>'none' then raise exception 'This submission changed or was already appealed. Reload it.' using errcode='PT409';end if;
 update private.content_submissions set appeal_status='pending',appeal_statement=btrim(p_statement),appealed_at=clock_timestamp(),version=version+1,updated_at=clock_timestamp()
   where id=s.id returning * into s;
 perform private.require_member_write_session(v_user);
 return private.content_item(s);
end;
$$;

create or replace function private.content_staff_allowed(p_kind text)
returns boolean language sql stable security definer set search_path='' as $$
 select public.has_staff_permission(case when p_kind='comment' then 'moderation.resolve' else 'profiles.review' end);
$$;

create or replace function public.staff_content_moderation(p_kind text default 'all',p_before jsonb default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_items jsonb;v_more boolean;v_before_at timestamptz;v_before_id uuid;
begin
 if p_kind not in ('all','comment','display_name','avatar') then raise exception 'Choose a valid content kind';end if;
 if not public.has_staff_permission('moderation.resolve') and not public.has_staff_permission('profiles.review') then raise exception 'Content review permission required' using errcode='42501';end if;
 if p_before is not null then
   if jsonb_typeof(p_before)<>'object' or length(p_before::text)>200 then raise exception 'Invalid page cursor';end if;
   v_before_at:=(p_before->>'createdAt')::timestamptz;v_before_id:=(p_before->>'id')::uuid;
   if v_before_at is null or not isfinite(v_before_at) or v_before_id is null then raise exception 'Invalid page cursor';end if;
 end if;
 select coalesce(jsonb_agg(private.content_item(s)||jsonb_build_object('ownerId',s.owner_id,'ownerName',coalesce(p.display_name,'Former member')) order by s.created_at desc,s.id desc),'[]') into v_items from (
   select * from private.content_submissions where (status='pending_review' or appeal_status='pending')
   and (p_kind='all' or kind=p_kind) and private.content_staff_allowed(kind)
   and (v_before_at is null or (created_at,id)<(v_before_at,v_before_id)) order by created_at desc,id desc limit 21) s
   left join public.profiles p on p.id=s.owner_id;
 v_more:=jsonb_array_length(v_items)>20;if v_more then v_items:=v_items-20;end if;
 return jsonb_build_object('items',v_items,'nextBefore',case when v_more then jsonb_build_object('createdAt',v_items->19->>'createdAt','id',v_items->19->>'id') end);
end;
$$;

create or replace function public.staff_content_moderation_item(p_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s private.content_submissions;
begin
 select * into s from private.content_submissions where id=p_id;
 if not private.content_staff_allowed(s.kind) then raise exception 'Content review permission required' using errcode='42501';end if;
 perform private.require_member_write_session((select auth.uid()));
 if s.id is null then raise exception 'Content submission not found' using errcode='PT404';end if;
 return private.content_item(s)||jsonb_build_object('ownerId',s.owner_id,'ownerName',(select display_name from public.profiles where id=s.owner_id));
end;
$$;

-- Shared publisher is unreachable from the client. Staff and member wrappers
-- independently recheck permission/current session and exact version.
create or replace function private.apply_content_decision(p_id uuid,p_version bigint,p_decision text,p_reason text,p_actor uuid default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s private.content_submissions;v_url text;
begin
 select * into s from private.content_submissions where id=p_id for update;
 if s.id is null then raise exception 'Content submission not found' using errcode='PT404';end if;
 perform private.require_member_write_session((select auth.uid()));
 if p_version is null or p_version not between 1 and 9007199254740990 or s.version is distinct from p_version or not (s.status in ('pending_review','blocked') or (s.status='published' and p_actor is not null and p_decision='block')) then raise exception 'This submission changed. Reload it.' using errcode='PT409';end if;
 if p_decision is null or p_decision not in ('approve','block','review') or char_length(coalesce(p_reason,'')) not between 5 and 500 then raise exception 'Invalid content decision';end if;
 if p_decision='approve' and s.kind='avatar' then
   if p_actor is null then raise exception 'Profile pictures require staff review' using errcode='42501';end if;
   if not exists(select 1 from public.uploaded_assets where id=s.asset_id and owner_id=s.owner_id and bucket='uploads-quarantine'
     and media_type='avatar' and mime_type in ('image/png','image/jpeg','image/webp') and byte_size between 24 and 1048576
     and moderation_status in ('quarantined','approved','rejected')) then raise exception 'This picture is unavailable. Ask the member to upload it again.' using errcode='PT409';end if;
 end if;
 update private.content_submissions set status=case p_decision when 'approve' then 'published' when 'block' then 'blocked' else 'pending_review' end,
   reason=p_reason,reviewed_by=p_actor,version=version+1,check_applied_at=clock_timestamp(),updated_at=clock_timestamp(),
   appeal_status=case when p_decision='block' and s.status='published' then 'none' when appeal_status='pending' and p_decision<>'review' then 'resolved' else appeal_status end,
   appeal_statement=case when p_decision='block' and s.status='published' then null else appeal_statement end,
   appealed_at=case when p_decision='block' and s.status='published' then null else appealed_at end
   where id=s.id returning * into s;
 if s.kind='comment' and p_decision<>'review' then
   update public.server_comments set status=case p_decision when 'approve' then 'published' else 'rejected' end,updated_at=clock_timestamp() where id=s.target_id and body=s.content_text;
   if not found then raise exception 'The comment changed' using errcode='PT409';end if;
   update public.moderation_queue set status='resolved',resolution=p_reason,resolved_by=p_actor,resolved_at=clock_timestamp()
     where target_type='server_comment' and target_id=s.target_id::text and status in ('open','claimed');
 elsif s.kind='display_name' and p_decision='approve' then
   update private.content_submissions set status='superseded',version=version+1,reason='Replaced by a newer approved identity.',updated_at=clock_timestamp()
     where owner_id=s.owner_id and kind=s.kind and id<>s.id and status='published';
   update public.profiles set display_name=s.content_text,updated_at=clock_timestamp() where id=s.owner_id;
 elsif s.kind='avatar' and p_decision='approve' then
   update private.content_submissions set status='superseded',version=version+1,reason='Replaced by a newer approved identity.',updated_at=clock_timestamp()
     where owner_id=s.owner_id and kind=s.kind and id<>s.id and status='published';
   v_url:='https://www.browserp.com/api/public/profile-avatar?id='||s.id::text;
   update public.uploaded_assets set moderation_status='approved',reviewed_by=p_actor,reviewed_at=clock_timestamp() where id=s.asset_id;
   update public.profiles set avatar_url=v_url,approved_avatar_url=v_url,avatar_review_status='approved',updated_at=clock_timestamp() where id=s.owner_id;
 elsif s.kind='avatar' and p_decision='block' then
   update public.uploaded_assets set moderation_status='rejected',reviewed_by=p_actor,reviewed_at=clock_timestamp() where id=s.asset_id;
   update public.profiles set avatar_url=null,approved_avatar_url=null,avatar_review_status='not_set',updated_at=clock_timestamp()
     where id=s.owner_id and approved_avatar_url='https://www.browserp.com/api/public/profile-avatar?id='||s.id::text;
 elsif s.kind='display_name' and p_decision='block' and exists(select 1 from public.profiles where id=s.owner_id and display_name=s.content_text) then
   -- A staff removal of a currently published name uses the known safe fallback.
   update public.profiles set display_name='BrowseRP member',updated_at=clock_timestamp() where id=s.owner_id;
 end if;
 perform private.require_member_write_session((select auth.uid()));
 if p_actor is not null and not private.content_staff_allowed(s.kind) then raise exception 'Content review permission required' using errcode='42501';end if;
 return private.content_item(s);
end;
$$;

create or replace function public.staff_decide_content(p_id uuid,p_version bigint,p_action text,p_reason text,p_request_id text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s private.content_submissions;v_item jsonb;
begin
 select * into s from private.content_submissions where id=p_id for update;
 if not private.content_staff_allowed(s.kind) then raise exception 'Content review permission required' using errcode='42501';end if;
 perform private.require_member_write_session((select auth.uid()));
 if p_action is null or p_action not in ('approve','block') then raise exception 'Choose a valid content decision';end if;
 v_item:=private.apply_content_decision(p_id,p_version,p_action,btrim(p_reason),(select auth.uid()));
 insert into public.staff_audit_events(actor_id,action,target_type,target_id,reason,request_id,before_state,after_state)
 values((select auth.uid()),'content.'||p_action,s.kind,s.id::text,p_reason,left(p_request_id,100),
   jsonb_build_object('status',s.status,'version',s.version),jsonb_build_object('status',v_item->>'status','version',v_item->'version'));
 perform private.require_member_write_session((select auth.uid()));
 if not private.content_staff_allowed(s.kind) then raise exception 'Content review permission required' using errcode='42501';end if;
 return v_item;
end;
$$;

-- Canonical private checker input; only the server service role can read it.
create or replace function public.service_content_check_input(p_id uuid,p_owner uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s private.content_submissions;v_duplicate boolean:=false;
begin
 select * into s from private.content_submissions where id=p_id and owner_id=p_owner and status='pending_review' and checked_at is null;
 if s.id is null then return null;end if;
 if s.kind='comment' then
   select exists(select 1 from private.content_submissions d where d.owner_id=s.owner_id and d.kind='comment' and d.fingerprint=s.fingerprint
     and d.id<>s.id and d.created_at<s.created_at and d.created_at>s.created_at-interval '10 minutes' and d.status<>'superseded' limit 1) into v_duplicate;
 end if;
 return private.content_item(s)||jsonb_build_object('ownerId',s.owner_id,'fingerprint',s.fingerprint,'sourceUrl',s.source_url,
   'assetId',s.asset_id,'duplicate',v_duplicate);
end;
$$;

create or replace function public.service_record_content_check(p_id uuid,p_owner uuid,p_version bigint,p_fingerprint text,p_result jsonb)
returns boolean language plpgsql security definer set search_path='' as $$
begin
 if p_version is null or p_version not between 1 and 9007199254740990 then raise exception 'Invalid content version' using errcode='PT400';end if;
 if p_result is null or jsonb_typeof(p_result)<>'object' or length(p_result::text)>16384 or coalesce(p_result->>'decision','') not in ('approve','block','review')
   or char_length(coalesce(p_result->>'reason','')) not between 5 and 500 or coalesce(p_result->>'policyVersion','')<>'content-v1'
   or char_length(coalesce(p_result->>'checker','')) not between 1 and 100 then raise exception 'Invalid checker result';end if;
 -- A rule-only result and incomplete image coverage can never authorize publication.
 if p_result->>'decision'='approve' and (p_result->>'checker'<>'openai:omni-moderation-2024-09-26'
   or exists(select 1 from private.content_submissions where id=p_id and kind='avatar')) then raise exception 'A complete supported checker is required';end if;
 update private.content_submissions set check_result=p_result,checked_at=clock_timestamp()
 where id=p_id and owner_id=p_owner and version=p_version and fingerprint=p_fingerprint and status='pending_review' and checked_at is null;
 return found;
end;
$$;

create or replace function public.member_apply_content_check(p_id uuid,p_version bigint)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_user uuid:=private.require_active_member();s private.content_submissions;
begin
 if p_version is null or p_version not between 1 and 9007199254740990 then raise exception 'Invalid content version' using errcode='PT400';end if;
 select * into s from private.content_submissions where id=p_id and owner_id=v_user for update;
 if s.id is null then raise exception 'Content submission not found' using errcode='PT404';end if;
 perform private.require_member_write_session((select auth.uid()));
 if p_version is null or p_version not between 1 and 9007199254740990 or s.version is distinct from p_version or s.check_result is null or s.check_applied_at is not null or s.status<>'pending_review' then
   return private.content_item(s);
 end if;
 return private.apply_content_decision(s.id,s.version,s.check_result->>'decision',s.check_result->>'reason');
end;
$$;

-- Imported OAuth images are frozen to immutable private bytes before review.
create or replace function public.service_attach_content_asset(p_id uuid,p_owner uuid,p_version bigint,p_asset uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s private.content_submissions;
begin
 if p_version is null or p_version not between 1 and 9007199254740990 then raise exception 'Invalid content version' using errcode='PT400';end if;
 if not exists(select 1 from public.uploaded_assets where id=p_asset and owner_id=p_owner and bucket='uploads-quarantine'
   and media_type='avatar' and mime_type in ('image/png','image/jpeg','image/webp') and byte_size between 24 and 1048576 and moderation_status='quarantined') then raise exception 'Invalid private picture';end if;
 update private.content_submissions set asset_id=p_asset,source_url=null,version=version+1,
   fingerprint=encode(sha256(convert_to(p_asset::text,'UTF8')),'hex'),updated_at=clock_timestamp()
 where id=p_id and owner_id=p_owner and version=p_version and kind='avatar' and status='pending_review' and asset_id is null and checked_at is null returning * into s;
 if s.id is null then return null;end if;
 return private.content_item(s);
end;
$$;

-- Both routes fetch the immutable asset server-side; no storage URL/key leaks.
create or replace function public.content_avatar_access(p_id uuid,p_public boolean default false)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s private.content_submissions;
begin
 select * into s from private.content_submissions where id=p_id and kind='avatar';
 if s.id is null then raise exception 'Picture not found' using errcode='PT404';end if;
 if p_public then
   if s.status<>'published' or not exists(select 1 from public.profiles where id=s.owner_id and avatar_review_status='approved'
     and approved_avatar_url='https://www.browserp.com/api/public/profile-avatar?id='||s.id::text) then raise exception 'Picture not found' using errcode='PT404';end if;
 else
   if not ((s.owner_id=(select auth.uid()) and private.member_access_allowed()) or private.content_staff_allowed(s.kind)) then
     raise exception 'Picture access required' using errcode='42501';end if;
 end if;
 return jsonb_build_object('id',s.id,'version',s.version,'assetId',s.asset_id);
end;
$$;

create or replace function public.service_content_asset(p_id uuid,p_asset uuid)
returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('id',a.id,'ownerId',a.owner_id,'bucket',a.bucket,'path',a.object_path,'mimeType',a.mime_type,'byteSize',a.byte_size,'sha256',a.sha256)
 from private.content_submissions s join public.uploaded_assets a on a.id=s.asset_id
 where s.id=p_id and a.id=p_asset and a.owner_id=s.owner_id and a.bucket='uploads-quarantine' and a.media_type='avatar'
   and a.mime_type in ('image/png','image/jpeg','image/webp') and a.byte_size between 24 and 1048576;
$$;

-- Bring only existing pending comments into the private review flow. Existing
-- public identities and published comments retain their prior review state.
insert into private.content_submissions(owner_id,kind,target_id,content_text,fingerprint,created_at)
 select c.author_id,'comment',c.id,c.body,encode(sha256(convert_to(c.body,'UTF8')),'hex'),c.created_at
 from public.server_comments c where c.status='pending_review';

revoke all on function private.content_item(private.content_submissions),private.stage_content(uuid,text,uuid,text,uuid,text),
 private.guard_profile_identity(),private.stage_comment_content(),private.sync_comment_decision(),private.content_staff_allowed(text),
 private.apply_content_decision(uuid,bigint,text,text,uuid) from public,anon,authenticated,service_role;
revoke all on function public.member_server_interaction(uuid,text,text,text),public.member_update_profile(text,text,text),public.member_submit_profile_avatar(uuid),
 public.member_content_moderation(jsonb),public.member_content_moderation_item(uuid,uuid,text),public.member_appeal_content(uuid,bigint,text),
 public.staff_content_moderation(text,jsonb),public.staff_content_moderation_item(uuid),public.staff_decide_content(uuid,bigint,text,text,text),public.member_apply_content_check(uuid,bigint),
 public.content_avatar_access(uuid,boolean),public.service_content_check_input(uuid,uuid),public.service_record_content_check(uuid,uuid,bigint,text,jsonb),
 public.service_attach_content_asset(uuid,uuid,bigint,uuid),public.service_content_asset(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.member_server_interaction(uuid,text,text,text),public.member_update_profile(text,text,text),public.member_submit_profile_avatar(uuid),public.member_content_moderation(jsonb),
 public.member_content_moderation_item(uuid,uuid,text),public.member_appeal_content(uuid,bigint,text),public.staff_content_moderation(text,jsonb),public.staff_content_moderation_item(uuid),
 public.staff_decide_content(uuid,bigint,text,text,text),public.member_apply_content_check(uuid,bigint) to authenticated;
grant execute on function public.content_avatar_access(uuid,boolean) to anon,authenticated;
grant execute on function public.service_content_check_input(uuid,uuid),public.service_record_content_check(uuid,uuid,bigint,text,jsonb),
 public.service_attach_content_asset(uuid,uuid,bigint,uuid),public.service_content_asset(uuid,uuid) to service_role;
commit;
