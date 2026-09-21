alter policy "profiles select own"
on public.profiles
to authenticated
using (
  (select auth.uid()) = id
  and coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) is false
);

alter policy "profiles insert own student"
on public.profiles
to authenticated
with check (
  (select auth.uid()) = id
  and role = 'student'::text
  and coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) is false
);

alter policy "profiles update own display name"
on public.profiles
to authenticated
using (
  (select auth.uid()) = id
  and coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) is false
)
with check (
  (select auth.uid()) = id
  and role = 'student'::text
  and coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) is false
);

alter policy "memberships select own"
on public.class_memberships
to authenticated
using (
  student_id = (select auth.uid())
  and coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) is false
);

alter policy "classes select enrolled"
on public.classes
to authenticated
using (
  coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) is false
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
  coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) is false
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
  coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) is false
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
  and coalesce(((select auth.jwt()) ->> 'is_anonymous')::boolean, false) is false
);
