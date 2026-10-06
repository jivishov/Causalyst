-- Supabase does not expose auth.sessions through the Data API. This bounded RPC
-- is callable only by the service role after the Worker verifies the OAuth JWT.
create or replace function public.teacher_plugin_session_active(p_session_id uuid, p_user_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from auth.sessions where id = p_session_id and user_id = p_user_id);
$$;
revoke all on function public.teacher_plugin_session_active(uuid, uuid) from public, anon, authenticated;
grant execute on function public.teacher_plugin_session_active(uuid, uuid) to service_role;
