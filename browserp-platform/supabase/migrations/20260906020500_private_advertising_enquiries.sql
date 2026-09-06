begin;
create table private.advertising_enquiries (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id),
 subject text not null check(char_length(subject) between 3 and 120),
 destination_url text not null check(char_length(destination_url) between 10 and 1000),
 placement text not null check(placement in ('any','homepage','directory','game_pages')),
 message text not null check(char_length(message) between 20 and 2000),
 status text not null default 'submitted' check(status in ('submitted','reviewing','replied','closed','withdrawn')),
 reply text not null default '' check(char_length(reply)<=2000), version bigint not null default 1 check(version>0),
 created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
 check((status not in ('replied','closed') or char_length(reply)>=20) and (status not in ('submitted','reviewing') or reply=''))
);
create index advertising_enquiries_member on private.advertising_enquiries(user_id,created_at desc,id desc);
create index advertising_enquiries_queue on private.advertising_enquiries(status,created_at desc,id desc);
create table private.advertising_enquiry_keys (
 actor_id uuid not null, request_key uuid not null, enquiry_id uuid not null references private.advertising_enquiries(id),
 fingerprint bytea not null check(octet_length(fingerprint)=32), created_at timestamptz not null default now(),
 primary key(actor_id,request_key)
);
alter table private.advertising_enquiries enable row level security;
alter table private.advertising_enquiry_keys enable row level security;
revoke all on private.advertising_enquiries,private.advertising_enquiry_keys from public,anon,authenticated,service_role;

create or replace function private.advertising_enquiry_json(r private.advertising_enquiries)
returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('id',r.id,'subject',r.subject,'destinationUrl',r.destination_url,'placement',r.placement,
  'message',r.message,'status',r.status,'reply',r.reply,'version',r.version,'createdAt',r.created_at,'updatedAt',r.updated_at);
$$;
revoke all on function private.advertising_enquiry_json(private.advertising_enquiries) from public,anon,authenticated,service_role;

create or replace function private.can_review_advertising_enquiries()
returns boolean language sql stable security definer set search_path='' as $$
 select public.staff_mfa_enrollment_allowed() and public.has_staff_permission('adverts.manage')
  and coalesce((select auth.jwt())->>'aal','')='aal2'
  and coalesce((select auth.jwt())->'amr','[]'::jsonb) @> '[{"method":"totp"}]'::jsonb;
$$;
revoke all on function private.can_review_advertising_enquiries() from public,anon,authenticated,service_role;
create or replace function public.staff_advertising_enquiry_access()
returns boolean language sql stable security definer set search_path='' as $$select private.can_review_advertising_enquiries();$$;
revoke all on function public.staff_advertising_enquiry_access() from public,anon,authenticated,service_role;
grant execute on function public.staff_advertising_enquiry_access() to authenticated;

create or replace function private.advertising_enquiry_page(p_user uuid,p_status text,p_before_time timestamptz,p_before_id uuid,p_limit integer,p_staff boolean)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare items jsonb; more boolean;
begin
 if p_status is null or p_status not in ('open','all','submitted','reviewing','replied','closed','withdrawn')
  or p_limit is null or p_limit not between 1 and 50 or (p_before_time is null)<>(p_before_id is null)
  or (p_before_time is not null and not isfinite(p_before_time)) then raise exception 'Choose valid enquiry filters.' using errcode='22023';end if;
 select coalesce(jsonb_agg(x.payload order by x.created_at desc,x.id desc),'[]') into items from(
  select r.id,r.created_at,private.advertising_enquiry_json(r)||case when p_staff then
   jsonb_build_object('accountId',r.user_id,'displayName',coalesce(p.display_name,'Member')) else '{}'::jsonb end payload
  from private.advertising_enquiries r left join public.profiles p on p.id=r.user_id
  where (p_user is null or r.user_id=p_user)
   and (p_status='all' or (p_status='open' and r.status not in ('closed','withdrawn')) or r.status=p_status)
   and (p_before_time is null or (r.created_at,r.id)<(p_before_time,p_before_id))
  order by r.created_at desc,r.id desc limit p_limit+1)x;
 more:=jsonb_array_length(items)>p_limit;if more then items:=items-p_limit;end if;
 return jsonb_build_object('items',items,'next',case when more then jsonb_build_object('createdAt',items->(p_limit-1)->>'createdAt','id',items->(p_limit-1)->>'id') end);
end;
$$;
revoke all on function private.advertising_enquiry_page(uuid,text,timestamptz,uuid,integer,boolean) from public,anon,authenticated,service_role;

create or replace function public.member_advertising_enquiries(
 p_action text default 'list',p_data jsonb default '{}',p_key uuid default null,p_id uuid default null,
 p_expected_version bigint default null,p_before_time timestamptz default null,p_before_id uuid default null,p_limit integer default 25
)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=private.require_active_member();r private.advertising_enquiries;prior private.advertising_enquiry_keys;
 subject text;destination text;placement text;message text;hostname text;signature bytea;
begin
 if p_action='list' then return private.advertising_enquiry_page(actor,'all',p_before_time,p_before_id,p_limit,false);end if;
 if p_action is null or p_action not in ('create','withdraw') or p_key is null then raise exception 'Choose an enquiry action.' using errcode='22023';end if;
 if p_action='create' then
  if p_data is null or jsonb_typeof(p_data)<>'object' or octet_length(p_data::text)>14000
   or exists(select 1 from jsonb_object_keys(p_data) k where k not in ('subject','destinationUrl','placement','message'))
   or exists(select 1 from unnest(array['subject','destinationUrl','placement','message']) k where jsonb_typeof(p_data->k) is distinct from 'string') then raise exception 'Check your enquiry details.' using errcode='22023';end if;
  subject:=btrim(p_data->>'subject');destination:=btrim(p_data->>'destinationUrl');placement:=p_data->>'placement';message:=btrim(p_data->>'message');
  hostname:=lower(substring(destination from '^https://([^/?#]+)'));
  if char_length(subject) not between 3 and 120 or char_length(message) not between 20 and 2000
   or translate(subject||message,E'\n\r\t','') ~ '[[:cntrl:]]' or subject ~ '[[:cntrl:]]'
   or placement not in ('any','homepage','directory','game_pages') or char_length(destination) not between 10 and 1000
   or destination !~ '^https://([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?[.])+[a-zA-Z]{2,63}([/?#][^[:space:]]*)?$'
   or destination ~ '[[:cntrl:]]' or position(chr(92) in destination)>0 or hostname ~ '(^|[.])(localhost|local|internal|test|invalid|example|lan|home|onion)$'
   then raise exception 'Use a public HTTPS destination and clear, plain-text enquiry details.' using errcode='22023';end if;
  signature:=sha256(convert_to(jsonb_build_object('action',p_action,'subject',subject,'destination',destination,'placement',placement,'message',message)::text,'UTF8'));
 else
  if p_id is null or p_expected_version is null or p_expected_version<1 or p_data is distinct from '{}'::jsonb then raise exception 'Refresh the enquiry before withdrawing it.' using errcode='22023';end if;
  signature:=sha256(convert_to(jsonb_build_object('action',p_action,'id',p_id,'version',p_expected_version)::text,'UTF8'));
 end if;
 perform pg_advisory_xact_lock(hashtextextended('advertising-actor:'||actor::text,0));
 perform private.require_active_member();
 select * into prior from private.advertising_enquiry_keys where actor_id=actor and request_key=p_key;
 if found then
  if prior.fingerprint is distinct from signature then raise exception 'This key was already used for different enquiry details. Refresh before trying again.' using errcode='PT409';end if;
  select * into r from private.advertising_enquiries where id=prior.enquiry_id and user_id=actor;
  if not found then raise exception 'Enquiry not found.' using errcode='PT404';end if;
  return jsonb_build_object('enquiry',private.advertising_enquiry_json(r));
 end if;
 if p_action='create' then
  if (select count(*) from private.advertising_enquiries where user_id=actor and status not in ('closed','withdrawn'))>=3 then raise exception 'You already have three open enquiries. Check their replies before sending another.' using errcode='PT409';end if;
  perform private.enforce_member_rate_limit('advertising-enquiry-create',3,86400);
  insert into private.advertising_enquiries(user_id,subject,destination_url,placement,message) values(actor,subject,destination,placement,message) returning * into r;
 else
  select * into r from private.advertising_enquiries where id=p_id and user_id=actor for update;
  if not found then raise exception 'Enquiry not found.' using errcode='PT404';end if;
  if r.version is distinct from p_expected_version or r.status in ('closed','withdrawn') then raise exception 'This enquiry changed or closed. Refresh it before withdrawing.' using errcode='PT409';end if;
  perform private.enforce_member_rate_limit('advertising-enquiry-withdraw',10,3600);
  update private.advertising_enquiries set status='withdrawn',version=version+1,updated_at=now() where id=r.id returning * into r;
 end if;
 insert into private.advertising_enquiry_keys(actor_id,request_key,enquiry_id,fingerprint) values(actor,p_key,r.id,signature);
 return jsonb_build_object('enquiry',private.advertising_enquiry_json(r));
end;
$$;
revoke all on function public.member_advertising_enquiries(text,jsonb,uuid,uuid,bigint,timestamptz,uuid,integer) from public,anon,authenticated,service_role;
grant execute on function public.member_advertising_enquiries(text,jsonb,uuid,uuid,bigint,timestamptz,uuid,integer) to authenticated;

create or replace function public.staff_advertising_enquiries(p_status text default 'open',p_before_time timestamptz default null,p_before_id uuid default null,p_limit integer default 25)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if not private.can_review_advertising_enquiries() then raise exception 'Permission and an authenticator check are required to review enquiries.' using errcode='42501';end if;
 return private.advertising_enquiry_page(null,p_status,p_before_time,p_before_id,p_limit,true);
end;
$$;
revoke all on function public.staff_advertising_enquiries(text,timestamptz,uuid,integer) from public,anon,authenticated,service_role;
grant execute on function public.staff_advertising_enquiries(text,timestamptz,uuid,integer) to authenticated;

create or replace function public.staff_review_advertising_enquiry(p_id uuid,p_expected_version bigint,p_status text,p_reply text,p_key uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=(select auth.uid());r private.advertising_enquiries;prior private.advertising_enquiry_keys;
 clean text:=btrim(coalesce(p_reply,''));signature bytea;before_value jsonb;
begin
 if not private.can_review_advertising_enquiries() then raise exception 'Permission and an authenticator check are required to review enquiries.' using errcode='42501';end if;
 if p_id is null or p_key is null or p_expected_version is null or p_expected_version<1 or p_status is null or p_status not in ('reviewing','replied','closed')
  or char_length(clean)>2000 or translate(clean,E'\n\r\t','') ~ '[[:cntrl:]]' then raise exception 'Choose a review action and a clear reply.' using errcode='22023';end if;
 signature:=sha256(convert_to(jsonb_build_object('action','review','id',p_id,'version',p_expected_version,'status',p_status,'reply',clean)::text,'UTF8'));
 perform pg_advisory_xact_lock(hashtextextended('advertising-actor:'||actor::text,0));
 if not private.can_review_advertising_enquiries() then raise exception 'Permission and an authenticator check are required to review enquiries.' using errcode='42501';end if;
 select * into prior from private.advertising_enquiry_keys where actor_id=actor and request_key=p_key;
 if found then
  if prior.fingerprint is distinct from signature then raise exception 'This key was already used for a different review. Refresh the enquiry.' using errcode='PT409';end if;
  select * into r from private.advertising_enquiries where id=prior.enquiry_id;
  return jsonb_build_object('enquiry',private.advertising_enquiry_json(r));
 end if;
 select * into r from private.advertising_enquiries where id=p_id for update;
 if not found then raise exception 'Enquiry not found.' using errcode='PT404';end if;
 if r.version is distinct from p_expected_version or r.status in ('closed','withdrawn') then raise exception 'This enquiry changed or closed. Refresh it before reviewing.' using errcode='PT409';end if;
 if p_status='reviewing' and (r.status<>'submitted' or clean<>'') then raise exception 'Only a new enquiry can be marked for review without a reply.' using errcode='PT409';end if;
 if p_status='replied' and (r.status not in ('submitted','reviewing') or char_length(clean)<20) then raise exception 'Add a reply of at least 20 characters to an unanswered enquiry.' using errcode='22023';end if;
 if p_status='closed' and r.reply='' and char_length(clean)<20 then raise exception 'Explain the outcome before closing this enquiry.' using errcode='22023';end if;
 if r.reply<>'' and clean<>'' and clean is distinct from r.reply then raise exception 'A sent reply is kept unchanged. Close the enquiry without replacing it.' using errcode='PT409';end if;
 if not private.can_review_advertising_enquiries() then raise exception 'Permission and an authenticator check are required to review enquiries.' using errcode='42501';end if;
 perform private.enforce_member_rate_limit('advertising-enquiry-review',40,600);
 before_value:=jsonb_build_object('status',r.status,'version',r.version);
 update private.advertising_enquiries set status=p_status,reply=case when r.reply<>'' then r.reply else clean end,version=version+1,updated_at=now() where id=r.id returning * into r;
 insert into public.staff_audit_events(actor_id,action,target_type,target_id,reason,request_id,before_state,after_state)
 values(actor,'advertising.enquiry.reviewed','advertising_enquiry',r.id::text,'Reviewed an advertising enquiry.',p_key::text,before_value,jsonb_build_object('status',r.status,'version',r.version,'hasReply',r.reply<>''));
 insert into private.advertising_enquiry_keys(actor_id,request_key,enquiry_id,fingerprint) values(actor,p_key,r.id,signature);
 return jsonb_build_object('enquiry',private.advertising_enquiry_json(r));
end;
$$;
revoke all on function public.staff_review_advertising_enquiry(uuid,bigint,text,text,uuid) from public,anon,authenticated,service_role;
grant execute on function public.staff_review_advertising_enquiry(uuid,bigint,text,text,uuid) to authenticated;

-- Extend the existing explicit export without duplicating its entire schema.
-- Its current limits still apply; the combined row/byte budgets also include
-- these enquiries. Already downloaded copies remain truthful dated snapshots.
alter function private.member_export_records(uuid) rename to member_export_records_before_advertising;
revoke all on function private.member_export_records_before_advertising(uuid) from public,anon,authenticated,service_role;
create or replace function private.member_export_records(p_subject uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;data jsonb;n bigint;bytes bigint;total_rows bigint;
begin
 if p_subject is distinct from private.require_active_member() then raise exception 'Only your own account can be copied.' using errcode='42501';end if;
 result:=private.member_export_records_before_advertising(p_subject);
 select count(*),coalesce(sum(octet_length(value::text)),0) into n,bytes from
  (select private.advertising_enquiry_json(r) value from private.advertising_enquiries r where r.user_id=p_subject order by r.id limit 2001) bounded;
 select coalesce(sum(value::bigint),0) into total_rows from jsonb_each_text(result->'counts');
 if n>2000 or total_rows+n>10000 or octet_length((result->'collections')::text)+bytes>2000000 then raise exception 'This account needs a larger export. Your request remains open for staff follow-up.' using errcode='PT413';end if;
 select coalesce(jsonb_agg(value),'[]') into data from
  (select private.advertising_enquiry_json(r) value from private.advertising_enquiries r where r.user_id=p_subject order by r.id limit 2001) bounded;
 result:=jsonb_set(result,'{collections}',(result->'collections')||jsonb_build_object('advertisingEnquiries',data));
 result:=jsonb_set(result,'{counts}',(result->'counts')||jsonb_build_object('advertisingEnquiries',n));
 if octet_length(result::text)>2097152 then raise exception 'This account needs a larger export. Your request remains open for staff follow-up.' using errcode='PT413';end if;
 return result;
end;
$$;
revoke all on function private.member_export_records(uuid) from public,anon,authenticated,service_role;
notify pgrst,'reload schema';
commit;
