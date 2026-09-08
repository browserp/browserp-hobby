-- Public comment identity is projected from current authoritative records.
-- Replies reuse the existing member, rate and moderation boundary unchanged.
begin;

alter table public.server_comments
  add column parent_comment_id uuid,
  add column edited_at timestamptz,
  add constraint server_comments_server_and_id_key unique(server_id,id),
  add constraint server_comments_parent_not_self check(parent_comment_id is null or parent_comment_id<>id),
  add constraint server_comments_same_server_parent_fkey foreign key(server_id,parent_comment_id)
    references public.server_comments(server_id,id) on delete set null(parent_comment_id);
create index server_comments_parent_idx on public.server_comments(server_id,parent_comment_id)
  where parent_comment_id is not null;

-- Existing updated_at includes moderation changes and cannot establish a body
-- edit. Historical edits stay unknown; every existing comment starts at null.
create or replace function private.track_server_comment_body_edit()
returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op='INSERT' then
   new.edited_at:=null;
 elsif new.body is distinct from old.body then
   new.edited_at:=clock_timestamp();
 else
   new.edited_at:=old.edited_at;
 end if;
 return new;
end;
$$;
revoke all on function private.track_server_comment_body_edit() from public,anon,authenticated,service_role;
create trigger server_comment_body_edit before insert or update on public.server_comments
  for each row execute function private.track_server_comment_body_edit();

create or replace function public.member_server_comment_reply(p_server_id uuid,p_parent_comment_id uuid,p_body text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
 perform private.require_active_member();
 -- Retain eligibility while the comment and its review entry are created.
 perform 1 from public.servers where id=p_server_id and status='published' and age_rating<>'adult' for share;
 if not found then raise exception 'Server not found.' using errcode='PT404'; end if;
 perform 1 from public.server_comments where id=p_parent_comment_id and server_id=p_server_id and status='published' for share;
 if not found then raise exception 'This comment is unavailable for replies.' using errcode='PT404'; end if;

 -- This existing RPC alone consumes the account rate limit, validates the body,
 -- creates the pending comment and queues its ordinary moderation review.
 result:=public.member_server_interaction(p_server_id,'comment',p_body,null);
 update public.server_comments set parent_comment_id=p_parent_comment_id
   where id=(result->>'id')::uuid and server_id=p_server_id
     and author_id=(select auth.uid()) and status='pending_review';
 if not found then raise exception 'The reply could not be created.' using errcode='PT409'; end if;
 perform private.require_active_member();
 return result||jsonb_build_object('parentCommentId',p_parent_comment_id);
end;
$$;
revoke all on function public.member_server_comment_reply(uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.member_server_comment_reply(uuid,uuid,text) to authenticated;

create or replace function public.public_server_engagement(p_slug text)
returns jsonb
language sql
stable
security definer
set search_path=''
as $$
 select jsonb_build_object(
   'serverId',s.id,'slug',s.slug,'accessType',s.access_type,
   'cfxJoinUrl',case when s.cfx_join_url ~* '^https://cfx\.re/join/[a-z0-9]{3,32}/?$' then s.cfx_join_url else null end,
   'animatedMediaEnabled',s.animated_media_enabled,
   'voteCount',(select count(*) from public.server_votes v where v.server_id=s.id),
   'comments',coalesce((select jsonb_agg(jsonb_build_object(
     'id',c.id,'body',c.body,'createdAt',c.created_at,'author',p.display_name,
     'avatarUrl',case when p.avatar_review_status='approved' then p.approved_avatar_url else null end,
     'editedAt',c.edited_at,
     'badges',(case when sm.user_id is not null then jsonb_build_array(jsonb_build_object('kind','staff','label',sr.name)) else '[]'::jsonb end)
       ||(case when s.owner_id=c.author_id then jsonb_build_array(jsonb_build_object('kind','server_owner','label','Server owner')) else '[]'::jsonb end),
     'parent',case
       when c.parent_comment_id is null then null
       when parent.id is null or parent_author.id is null then jsonb_build_object('id',c.parent_comment_id,'unavailable',true)
       else jsonb_build_object('id',parent.id,'author',parent_author.display_name,'body',parent.body,'createdAt',parent.created_at,'unavailable',false)
     end
   ) order by c.created_at desc)
   from public.server_comments c
   join public.profiles p on p.id=c.author_id
   left join public.staff_memberships sm on sm.user_id=c.author_id and sm.status='active'
   left join public.staff_roles sr on sr.key=sm.role_key
   left join public.server_comments parent on parent.id=c.parent_comment_id and parent.server_id=s.id and parent.status='published'
   left join public.profiles parent_author on parent_author.id=parent.author_id
   where c.server_id=s.id and c.status='published'),'[]'::jsonb)
 )
 from public.servers s where s.slug=lower(btrim(p_slug)) and s.status='published' and s.age_rating<>'adult' limit 1;
$$;
revoke all on function public.public_server_engagement(text) from public,anon,authenticated,service_role;
grant execute on function public.public_server_engagement(text) to anon,authenticated,service_role;

commit;
