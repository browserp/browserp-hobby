-- Add only the profile route identity; existing profile access checks remain authoritative.
begin;
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
     'username',case when p.profile_visibility in ('public','basic','members') then p.username else null end,
     'avatarUrl',case when p.avatar_review_status='approved' then p.approved_avatar_url else null end,
     'editedAt',c.edited_at,'badges',bp.value->'badges','staffRole',bp.value->'staffRole',
     'parent',case
       when c.parent_comment_id is null then null
       when parent.id is null or parent_author.id is null then jsonb_build_object('id',c.parent_comment_id,'unavailable',true)
       else jsonb_build_object('id',parent.id,'author',parent_author.display_name,'body',parent.body,'createdAt',parent.created_at,'unavailable',false)
     end
   ) order by c.created_at desc)
   from public.server_comments c
   join public.profiles p on p.id=c.author_id
   cross join lateral (select private.member_badge_projection(c.author_id) value) bp
   left join public.server_comments parent on parent.id=c.parent_comment_id and parent.server_id=s.id and parent.status='published'
   left join public.profiles parent_author on parent_author.id=parent.author_id
   where c.server_id=s.id and c.status='published'),'[]'::jsonb)
 )
 from public.servers s where s.slug=lower(btrim(p_slug)) and s.status='published' and s.age_rating<>'adult' limit 1;
$$;
revoke all on function public.public_server_engagement(text) from public,anon,authenticated,service_role;
grant execute on function public.public_server_engagement(text) to anon,authenticated,service_role;

notify pgrst,'reload schema';
commit;
