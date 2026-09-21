create or replace function public.claim_student_google_login(
  p_user_id uuid,
  p_email text,
  p_class_code text,
  p_pin_hash text
)
returns table(
  claim_status text,
  class_id uuid,
  class_code text,
  class_name text,
  roster_student_id uuid,
  display_name text,
  previous_user_id uuid
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_access record;
  v_assignment_ids uuid[];
  v_class record;
  v_conflicting_membership_user_id uuid;
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_existing_profile record;
  v_now timestamptz := now();
  v_previous_user_id uuid;
  v_roster record;
begin
  if p_user_id is null or v_email = '' or btrim(coalesce(p_class_code, '')) = '' or btrim(coalesce(p_pin_hash, '')) = '' then
    return query select 'invalid_credentials'::text, null::uuid, null::text, null::text, null::uuid, null::text, null::uuid;
    return;
  end if;

  select id, code, name
  into v_class
  from public.classes as class_row
  where upper(class_row.code) = upper(btrim(p_class_code))
  limit 1;

  if not found then
    return query select 'invalid_credentials'::text, null::uuid, null::text, null::text, null::uuid, null::text, null::uuid;
    return;
  end if;

  select id, class_id, student_label, pin_hash, claimed_by, claimed_at, roster_student_id
  into v_access
  from public.student_access_codes as access_row
  where access_row.class_id = v_class.id
    and access_row.pin_hash = p_pin_hash
  limit 1;

  if not found then
    return query select 'invalid_credentials'::text, null::uuid, null::text, null::text, null::uuid, null::text, null::uuid;
    return;
  end if;

  perform pg_advisory_xact_lock(hashtext('alternative_assessment:student_google_login:' || v_access.id::text)::bigint);

  select id, class_id, student_label, pin_hash, claimed_by, claimed_at, roster_student_id
  into v_access
  from public.student_access_codes as access_row
  where access_row.id = v_access.id
  for update;

  if v_access.roster_student_id is null then
    return query select 'roster_email_required'::text, v_class.id::uuid, v_class.code::text, v_class.name::text, null::uuid, null::text, null::uuid;
    return;
  end if;

  select id, class_id, display_name, email, claimed_by, claimed_at
  into v_roster
  from public.roster_students as roster_row
  where roster_row.id = v_access.roster_student_id
  for update;

  if not found or v_roster.class_id <> v_class.id then
    return query select 'invalid_credentials'::text, null::uuid, null::text, null::text, null::uuid, null::text, null::uuid;
    return;
  end if;

  if v_roster.email is null or btrim(v_roster.email) = '' then
    return query select 'roster_email_required'::text, v_class.id::uuid, v_class.code::text, v_class.name::text, v_roster.id::uuid, v_roster.display_name::text, null::uuid;
    return;
  end if;

  if lower(btrim(v_roster.email)) <> v_email then
    return query select 'roster_email_mismatch'::text, v_class.id::uuid, v_class.code::text, v_class.name::text, v_roster.id::uuid, v_roster.display_name::text, null::uuid;
    return;
  end if;

  select id, role, display_name, email
  into v_existing_profile
  from public.profiles as profile_row
  where profile_row.id = p_user_id
  for update;

  if found and v_existing_profile.role = 'teacher' then
    return query select 'teacher_profile'::text, v_class.id::uuid, v_class.code::text, v_class.name::text, v_roster.id::uuid, v_roster.display_name::text, null::uuid;
    return;
  end if;

  if exists (
    select 1
    from public.class_memberships as membership_row
    where membership_row.class_id = v_class.id
      and membership_row.student_id = p_user_id
      and membership_row.roster_student_id is distinct from v_roster.id
  ) or exists (
    select 1
    from public.student_access_codes as access_row
    where access_row.class_id = v_class.id
      and access_row.claimed_by = p_user_id
      and access_row.id <> v_access.id
  ) then
    return query select 'same_course_identity_conflict'::text, v_class.id::uuid, v_class.code::text, v_class.name::text, v_roster.id::uuid, v_roster.display_name::text, null::uuid;
    return;
  end if;

  select membership_row.student_id
  into v_conflicting_membership_user_id
  from public.class_memberships as membership_row
  where membership_row.class_id = v_class.id
    and membership_row.roster_student_id = v_roster.id
    and membership_row.student_id <> p_user_id
  limit 1
  for update;

  v_previous_user_id := coalesce(
    nullif(v_access.claimed_by, p_user_id),
    nullif(v_roster.claimed_by, p_user_id),
    v_conflicting_membership_user_id
  );

  select coalesce(array_agg(assignment_row.id), '{}'::uuid[])
  into v_assignment_ids
  from public.assessment_assignments as assignment_row
  where assignment_row.class_id = v_class.id;

  if v_previous_user_id is not null then
    update public.attempts
    set
      student_id = p_user_id,
      updated_at = v_now
    where student_id = v_previous_user_id
      and assignment_id = any(v_assignment_ids);

    update public.attempt_artifacts as artifact
    set student_id = p_user_id
    where artifact.student_id = v_previous_user_id
      and exists (
        select 1
        from public.attempts as attempt_row
        where attempt_row.id = artifact.attempt_id
          and attempt_row.student_id = p_user_id
          and attempt_row.assignment_id = any(v_assignment_ids)
      );

    update public.attempt_realtime_sessions as realtime_session
    set
      student_id = p_user_id,
      updated_at = v_now
    where realtime_session.student_id = v_previous_user_id
      and exists (
        select 1
        from public.attempts as attempt_row
        where attempt_row.id = realtime_session.attempt_id
          and attempt_row.student_id = p_user_id
          and attempt_row.assignment_id = any(v_assignment_ids)
      );

    update public.attempt_realtime_events as realtime_event
    set student_id = p_user_id
    where realtime_event.student_id = v_previous_user_id
      and exists (
        select 1
        from public.attempts as attempt_row
        where attempt_row.id = realtime_event.attempt_id
          and attempt_row.student_id = p_user_id
          and attempt_row.assignment_id = any(v_assignment_ids)
      );

    delete from public.class_memberships as membership_row
    where membership_row.class_id = v_class.id
      and membership_row.student_id = v_previous_user_id;
  end if;

  delete from public.class_memberships as membership_row
  where membership_row.class_id = v_class.id
    and membership_row.roster_student_id = v_roster.id
    and membership_row.student_id <> p_user_id;

  insert into public.profiles as profile (id, role, display_name, email, updated_at)
  values (p_user_id, 'student', v_roster.display_name, v_email, v_now)
  on conflict (id) do update
    set role = excluded.role,
        display_name = excluded.display_name,
        email = excluded.email,
        updated_at = excluded.updated_at
  where profile.role <> 'teacher';

  insert into public.class_memberships as membership (class_id, student_id, display_name, roster_student_id)
  values (v_class.id, p_user_id, v_roster.display_name, v_roster.id)
  on conflict (class_id, student_id) do update
    set display_name = excluded.display_name,
        roster_student_id = excluded.roster_student_id;

  update public.student_access_codes
  set
    claimed_by = p_user_id,
    claimed_at = coalesce(claimed_at, v_now)
  where id = v_access.id;

  update public.roster_students
  set
    claimed_by = p_user_id,
    claimed_at = coalesce(claimed_at, v_now),
    updated_at = v_now
  where id = v_roster.id;

  return query select
    'success'::text,
    v_class.id::uuid,
    v_class.code::text,
    v_class.name::text,
    v_roster.id::uuid,
    v_roster.display_name::text,
    v_previous_user_id::uuid;
end;
$$;
