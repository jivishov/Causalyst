begin;
insert into auth.users (id, email) values ('90000000-0000-4000-8000-000000000001', 'teacher-plugin@example.test');
insert into auth.oauth_clients(id,registration_type,redirect_uris,grant_types,client_type,token_endpoint_auth_method)
values('90000000-0000-4000-8000-000000000004','manual','http://127.0.0.1:49152/callback','authorization_code,refresh_token','public','none');
insert into auth.sessions (id, user_id, oauth_client_id, scopes) values ('90000000-0000-4000-8000-000000000002', '90000000-0000-4000-8000-000000000001', '90000000-0000-4000-8000-000000000004', 'openid email profile');
set local role service_role;
do $$ begin
  if not public.teacher_plugin_session_active('90000000-0000-4000-8000-000000000002', '90000000-0000-4000-8000-000000000001', '90000000-0000-4000-8000-000000000004') then raise exception 'live plugin session rejected'; end if;
  if public.teacher_plugin_session_active('90000000-0000-4000-8000-000000000002', '90000000-0000-4000-8000-000000000003', '90000000-0000-4000-8000-000000000004') then raise exception 'wrong user accepted'; end if;
  if public.teacher_plugin_session_active('90000000-0000-4000-8000-000000000002', '90000000-0000-4000-8000-000000000001', '90000000-0000-4000-8000-000000000003') then raise exception 'wrong client accepted'; end if;
end $$;
reset role;
update auth.sessions set not_after=now()-interval '1 second';
set local role service_role;
do $$ begin
  if public.teacher_plugin_session_active('90000000-0000-4000-8000-000000000002', '90000000-0000-4000-8000-000000000001', '90000000-0000-4000-8000-000000000004') then raise exception 'expired session accepted'; end if;
end $$;
reset role;
update auth.sessions set not_after=null, scopes='email';
set local role service_role;
do $$ begin
  if public.teacher_plugin_session_active('90000000-0000-4000-8000-000000000002', '90000000-0000-4000-8000-000000000001', '90000000-0000-4000-8000-000000000004') then raise exception 'missing scopes accepted'; end if;
end $$;
reset role;
delete from auth.sessions where id = '90000000-0000-4000-8000-000000000002';
set local role service_role;
do $$ begin
  if public.teacher_plugin_session_active('90000000-0000-4000-8000-000000000002', '90000000-0000-4000-8000-000000000001', '90000000-0000-4000-8000-000000000004') then raise exception 'revoked session accepted'; end if;
end $$;
reset role;
do $$ begin
  if has_function_privilege('anon', 'public.teacher_plugin_session_active(uuid,uuid,uuid)', 'execute') or has_function_privilege('authenticated', 'public.teacher_plugin_session_active(uuid,uuid,uuid)', 'execute') then raise exception 'session lookup publicly exposed'; end if;
end $$;
rollback;

begin;
do $$ begin
  if not has_function_privilege('supabase_auth_admin','public.explain_teacher_plugin_access_token_hook(jsonb)','execute') then
    raise exception 'Supabase Auth cannot invoke the access-token hook';
  end if;
  -- Native PostgreSQL can impersonate the auth service. The disposable
  -- Supabase postgres login intentionally cannot; verify its exact grants
  -- here and run the claims assertions as the function owner in that stack.
  if pg_has_role(current_user,'supabase_auth_admin','SET') then
    execute 'set local role supabase_auth_admin';
  end if;
end $$;
do $$ declare original jsonb; result jsonb; begin
  original:='{"aud":"authenticated","sub":"teacher","exp":9999999999,"client_id":"90000000-0000-4000-8000-000000000004","scope":"openid email profile","role":"authenticated"}';
  result:=public.explain_teacher_plugin_access_token_hook(jsonb_build_object('claims',original,'authentication_method','oauth_provider/authorization_code'));
  if result->'claims'->>'aud'<>'https://alt-assessment-student-api.emil-jivishov.workers.dev/mcp/teacher' or ((result->'claims')-'aud')<>(original-'aud') then raise exception 'OAuth hook did not preserve claims and target the resource'; end if;
  result:=public.explain_teacher_plugin_access_token_hook(jsonb_build_object('claims',original,'authentication_method','token_refresh'));
  if result->'claims'->>'aud'<>'https://alt-assessment-student-api.emil-jivishov.workers.dev/mcp/teacher' then raise exception 'Token refresh lost plugin audience'; end if;
  original:=original-'client_id';
  result:=public.explain_teacher_plugin_access_token_hook(jsonb_build_object('claims',original,'client_id','90000000-0000-4000-8000-000000000004','authentication_method','password'));
  if result->'claims'<>original then raise exception 'Hook changed a website session using a top-level client ID'; end if;
  original:=original||'{"client_id":"other-client","user_metadata":{"client_id":"90000000-0000-4000-8000-000000000004"}}';
  if public.explain_teacher_plugin_access_token_hook(jsonb_build_object('claims',original))->'claims'<>original then raise exception 'Hook trusted user-editable metadata'; end if;
end $$;
reset role;
do $$ begin
  if has_function_privilege('authenticated','public.explain_teacher_plugin_access_token_hook(jsonb)','execute') then raise exception 'Hook exposed to website users'; end if;
end $$;
rollback;

begin;
insert into auth.users(id) values('90000000-0000-4000-8000-000000000005');
insert into public.profiles(id,role,display_name) values('90000000-0000-4000-8000-000000000005','teacher','Original teacher');
insert into storage.objects(id,bucket_id,name) values('90000000-0000-4000-8000-000000000005','writing','test-object');
create policy synthetic_storage_access on storage.objects for select to authenticated using(true);
set local role authenticated;
select set_config('request.jwt.claim.sub','90000000-0000-4000-8000-000000000005',true);
select set_config('request.jwt.claims','{"sub":"90000000-0000-4000-8000-000000000005","client_id":"90000000-0000-4000-8000-000000000004"}',true);
do $$ begin
  if exists(select 1 from public.profiles) then raise exception 'OAuth token bypassed MCP to read a profile'; end if;
  if exists(select 1 from storage.objects) then raise exception 'OAuth token bypassed MCP to read Storage'; end if;
  update public.profiles set display_name='Changed' where id='90000000-0000-4000-8000-000000000005';
  if found then raise exception 'OAuth token bypassed MCP to update a profile'; end if;
end $$;
select set_config('request.jwt.claims','{"sub":"90000000-0000-4000-8000-000000000005","client_id":""}',true);
do $$ begin
  if not exists(select 1 from public.profiles where display_name='Original teacher') then raise exception 'Website profile access regressed'; end if;
  if not exists(select 1 from storage.objects) then raise exception 'Website Storage access regressed'; end if;
end $$;
reset role;
rollback;
