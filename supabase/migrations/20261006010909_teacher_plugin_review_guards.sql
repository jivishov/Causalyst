-- OAuth tokens must use the ownership-checked MCP resource, not the website
-- REST routes or a direct Data API path with broader website permissions.
do $$ declare t record; begin
  for t in select n.nspname, c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind in ('r','p') and c.relrowsecurity
  loop
    execute format('create policy "website sessions only" on %I.%I as restrictive for all to authenticated using (nullif((select auth.jwt()->>''client_id''),'''') is null) with check (nullif((select auth.jwt()->>''client_id''),'''') is null)', t.nspname, t.relname);
  end loop;
  if to_regclass('storage.objects') is not null then
    execute 'create policy "website sessions only" on storage.objects as restrictive for all to authenticated using (nullif((select auth.jwt()->>''client_id''),'''') is null) with check (nullif((select auth.jwt()->>''client_id''),'''') is null)';
  end if;
end $$;

drop function public.teacher_plugin_session_active(uuid, uuid);
create function public.teacher_plugin_session_active(p_session_id uuid, p_user_id uuid, p_client_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists(select 1 from auth.sessions where id=p_session_id and user_id=p_user_id and oauth_client_id=p_client_id
    and (not_after is null or not_after>now())
    and regexp_split_to_array(coalesce(scopes,''), '[[:space:]]+') @> array['openid','email','profile']);
$$;
revoke all on function public.teacher_plugin_session_active(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.teacher_plugin_session_active(uuid, uuid, uuid) to service_role;

-- Lock the grade and reviewed evidence together so a concurrent publication or
-- revision cannot silently replace the result that the teacher approved.
create function public.save_teacher_plugin_grade(
  p_teacher_id uuid, p_attempt_id uuid, p_expected_attempt_updated_at timestamptz,
  p_entry_id uuid, p_expected_entry_updated_at timestamptz, p_score numeric, p_note text
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare g public.gradebook_entries; a public.attempts; saved_at timestamptz;
begin
  if p_score is null or p_score not between 0 and 100 or nullif(btrim(p_note),'') is null or length(p_note)>7000 then
    raise exception 'Invalid teacher grade' using errcode='23514';
  end if;
  select e.* into g from public.gradebook_entries e
    join public.assessment_assignments assignment on assignment.id=e.assignment_id
    join public.classes course on course.id=assignment.class_id
    join public.profiles teacher on teacher.id=course.teacher_id
    where e.id=p_entry_id and teacher.id=p_teacher_id and teacher.role='teacher' for update of e;
  if not found then return jsonb_build_object('status','conflict','reason','unavailable'); end if;
  if g.published_at is not null or g.updated_at is distinct from p_expected_entry_updated_at then
    return jsonb_build_object('status','conflict','reason','grade_changed');
  end if;
  select t.* into a from public.attempts t join public.assessment_assignments assignment on assignment.id=t.assignment_id
    join public.roster_students roster on roster.id=g.roster_student_id and roster.class_id=assignment.class_id
    where t.id=p_attempt_id and t.assignment_id=g.assignment_id and (
      roster.claimed_by=t.student_id or exists(select 1 from public.class_memberships membership
        where membership.class_id=assignment.class_id and membership.roster_student_id=roster.id and membership.student_id=t.student_id)
    ) for update of t;
  if not found or a.status='draft' or a.submitted_at is null or a.updated_at is distinct from p_expected_attempt_updated_at then
    return jsonb_build_object('status','conflict','reason','evidence_changed');
  end if;
  if exists(select 1 from public.attempts newer where newer.assignment_id=a.assignment_id and newer.student_id=a.student_id
    and newer.status<>'draft' and newer.submitted_at is not null
    and (newer.submitted_at,newer.created_at,newer.id)>(a.submitted_at,a.created_at,a.id)) then
    return jsonb_build_object('status','conflict','reason','newer_submission');
  end if;
  saved_at:=clock_timestamp();
  update public.gradebook_entries set teacher_override_score=p_score, teacher_override_note=p_note,
    missing=false, updated_at=saved_at where id=g.id;
  return jsonb_build_object('status','saved','updatedAt',saved_at);
end $$;
revoke all on function public.save_teacher_plugin_grade(uuid,uuid,timestamptz,uuid,timestamptz,numeric,text) from public,anon,authenticated;
grant execute on function public.save_teacher_plugin_grade(uuid,uuid,timestamptz,uuid,timestamptz,numeric,text) to service_role;
