revoke all on function public.claim_attempt_submission(uuid, uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.claim_first_teacher(uuid, text) from public, anon, authenticated;
revoke all on function public.claim_student_google_login(uuid, text, text, text) from public, anon, authenticated;

grant execute on function public.claim_attempt_submission(uuid, uuid, timestamptz) to service_role;
grant execute on function public.claim_first_teacher(uuid, text) to service_role;
grant execute on function public.claim_student_google_login(uuid, text, text, text) to service_role;

alter policy "profiles select own"
on public.profiles
to authenticated
using (
  (select auth.uid()) = id
  and (select coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false)) is false
);

alter policy "profiles insert own student"
on public.profiles
to authenticated
with check (
  (select auth.uid()) = id
  and role = 'student'::text
  and (select coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false)) is false
);

alter policy "profiles update own display name"
on public.profiles
to authenticated
using (
  (select auth.uid()) = id
  and (select coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false)) is false
)
with check (
  (select auth.uid()) = id
  and role = 'student'::text
  and (select coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false)) is false
);

alter policy "memberships select own"
on public.class_memberships
to authenticated
using (
  student_id = (select auth.uid())
  and (select coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false)) is false
);

alter policy "classes select enrolled"
on public.classes
to authenticated
using (
  (select coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false)) is false
  and exists (
    select 1
    from public.class_memberships cm
    where cm.class_id = classes.id
      and cm.student_id = (select auth.uid())
  )
);

alter policy "assignments select enrolled"
on public.assessment_assignments
to authenticated
using (
  (select coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false)) is false
  and exists (
    select 1
    from public.class_memberships cm
    where cm.class_id = assessment_assignments.class_id
      and cm.student_id = (select auth.uid())
  )
);

alter policy "assessments select assigned"
on public.assessments
to authenticated
using (
  (select coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false)) is false
  and exists (
    select 1
    from public.assessment_assignments aa
    join public.class_memberships cm on cm.class_id = aa.class_id
    where aa.assessment_id = assessments.id
      and cm.student_id = (select auth.uid())
      and (aa.opens_at is null or aa.opens_at <= now())
  )
);

alter policy "attempts select own"
on public.attempts
to authenticated
using (
  student_id = (select auth.uid())
  and (select coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false)) is false
);
