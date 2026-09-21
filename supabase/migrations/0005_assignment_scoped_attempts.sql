alter table attempts
  add column if not exists assignment_id uuid references assessment_assignments(id) on delete set null;

create index if not exists idx_attempts_assignment on attempts(assignment_id);

with assignment_candidates as (
  select
    attempts.id as attempt_id,
    min(assessment_assignments.id::text)::uuid as assignment_id,
    count(*) as candidate_count
  from attempts
  join class_memberships
    on class_memberships.student_id = attempts.student_id
  join assessment_assignments
    on assessment_assignments.class_id = class_memberships.class_id
   and assessment_assignments.assessment_id = attempts.assessment_id
  where attempts.assignment_id is null
    and attempts.assessment_id is not null
  group by attempts.id
)
update attempts
set assignment_id = assignment_candidates.assignment_id
from assignment_candidates
where attempts.id = assignment_candidates.attempt_id
  and assignment_candidates.candidate_count = 1;

update attempts
set assessment_id = assessment_assignments.assessment_id
from assessment_assignments
where attempts.assignment_id = assessment_assignments.id
  and (attempts.assessment_id is null or attempts.assessment_id <> assessment_assignments.assessment_id);

drop policy if exists "attempts insert own draft" on attempts;

-- v1 writes attempts through Worker service-role only.
-- Keep student select policy as-is and remove direct client insert policy.
