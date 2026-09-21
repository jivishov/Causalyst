create or replace function public.claim_first_teacher(
  p_user_id uuid,
  p_display_name text
)
returns table(id uuid, display_name text)
language plpgsql
security definer
set search_path = public
as $$
begin
  perform pg_advisory_xact_lock(hashtext('alternative_assessment:first_teacher_setup')::bigint);

  if exists (select 1 from public.profiles where role = 'teacher') then
    raise exception 'Teacher setup has already been completed' using errcode = '23505';
  end if;

  return query
  insert into public.profiles as profile (id, role, display_name)
  values (p_user_id, 'teacher', coalesce(nullif(btrim(p_display_name), ''), 'Teacher'))
  on conflict (id) do update
    set role = excluded.role,
        display_name = excluded.display_name
  returning profile.id, profile.display_name;
end;
$$;

create or replace function public.claim_attempt_submission(
  p_user_id uuid,
  p_attempt_id uuid,
  p_submitted_at timestamptz
)
returns table(
  claim_status text,
  attempt_id uuid,
  assignment_id uuid,
  submitted_at timestamptz,
  submitted_after_due boolean,
  assignment_due_at timestamptz,
  current_attempt_status text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_claim record;
  v_attempt record;
begin
  update public.attempts as attempt_row
  set
    status = 'submitted',
    submitted_at = p_submitted_at,
    submitted_after_due = assignment_row.due_at is not null and p_submitted_at > assignment_row.due_at,
    updated_at = p_submitted_at
  from public.assessment_assignments as assignment_row
  where attempt_row.id = p_attempt_id
    and attempt_row.student_id = p_user_id
    and attempt_row.status = 'draft'
    and attempt_row.assignment_id = assignment_row.id
    and assignment_row.archived_at is null
  returning
    attempt_row.id,
    attempt_row.assignment_id,
    attempt_row.submitted_at,
    attempt_row.submitted_after_due,
    assignment_row.due_at,
    attempt_row.status
  into v_claim;

  if found then
    return query select
      'success'::text,
      v_claim.id::uuid,
      v_claim.assignment_id::uuid,
      v_claim.submitted_at::timestamptz,
      v_claim.submitted_after_due::boolean,
      v_claim.due_at::timestamptz,
      v_claim.status::text;
    return;
  end if;

  select
    attempt_row.id,
    attempt_row.status,
    attempt_row.assignment_id,
    assignment_row.id as assignment_row_id,
    assignment_row.due_at,
    assignment_row.archived_at
  into v_attempt
  from public.attempts as attempt_row
  left join public.assessment_assignments as assignment_row
    on assignment_row.id = attempt_row.assignment_id
  where attempt_row.id = p_attempt_id
    and attempt_row.student_id = p_user_id;

  if not found then
    return query select 'not_found'::text, null::uuid, null::uuid, null::timestamptz, null::boolean, null::timestamptz, null::text;
    return;
  end if;

  if v_attempt.assignment_id is null or v_attempt.assignment_row_id is null then
    return query select 'missing_assignment'::text, v_attempt.id::uuid, v_attempt.assignment_id::uuid, null::timestamptz, null::boolean, v_attempt.due_at::timestamptz, v_attempt.status::text;
    return;
  end if;

  if v_attempt.status <> 'draft' then
    return query select 'not_draft'::text, v_attempt.id::uuid, v_attempt.assignment_id::uuid, null::timestamptz, null::boolean, v_attempt.due_at::timestamptz, v_attempt.status::text;
    return;
  end if;

  if v_attempt.archived_at is not null then
    return query select 'archived_assignment'::text, v_attempt.id::uuid, v_attempt.assignment_id::uuid, null::timestamptz, null::boolean, v_attempt.due_at::timestamptz, v_attempt.status::text;
    return;
  end if;

  return query select 'claim_failed'::text, v_attempt.id::uuid, v_attempt.assignment_id::uuid, null::timestamptz, null::boolean, v_attempt.due_at::timestamptz, v_attempt.status::text;
end;
$$;
