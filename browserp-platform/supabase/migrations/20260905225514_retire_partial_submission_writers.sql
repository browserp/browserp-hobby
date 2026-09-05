-- POST-PROMOTION ONLY: apply after every live web deployment uses
-- create_server_application_server, following docs/ROBLOX_APPLICATIONS.md.
-- Do not bulk-apply this alongside the additive migration before deployment.
revoke execute on function public.create_server_submission_server(uuid,text,text,text,text,text,text,text,text,integer,jsonb) from service_role;
revoke execute on function public.create_server_submission_server_v2(uuid,text,text,text,text,text,text,text,text,integer,jsonb,text,text,text,text) from service_role;
revoke execute on function public.attach_server_submission_metadata_server(uuid,uuid,text[],text,text,text) from service_role;
