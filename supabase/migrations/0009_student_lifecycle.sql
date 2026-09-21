alter table attempts
  add column if not exists due_at_snapshot timestamptz;

alter table attempts
  add column if not exists submitted_after_due boolean not null default false;

with ranked_drafts as (
  select
    id,
    student_id,
    assignment_id,
    row_number() over (
      partition by student_id, assignment_id
      order by created_at desc, id desc
    ) as draft_rank,
    first_value(id) over (
      partition by student_id, assignment_id
      order by created_at desc, id desc
    ) as kept_attempt_id
  from attempts
  where status = 'draft'
    and assignment_id is not null
),
collapsed_drafts as (
  select id, kept_attempt_id
  from ranked_drafts
  where draft_rank > 1
),
updated_drafts as (
  update attempts
  set
    status = 'error',
    updated_at = now()
  from collapsed_drafts
  where attempts.id = collapsed_drafts.id
  returning attempts.id, collapsed_drafts.kept_attempt_id
)
insert into attempt_audit_logs (
  attempt_id,
  route,
  provider,
  model,
  request_summary,
  raw_response,
  error
)
select
  updated_drafts.id,
  'migration:0009_draft_normalization',
  'system',
  'none',
  jsonb_build_object(
    'reason', 'duplicate_draft_collapsed',
    'kept_attempt_id', updated_drafts.kept_attempt_id::text
  ),
  null,
  null
from updated_drafts;

create unique index if not exists idx_attempts_unique_student_assignment_draft
  on attempts(student_id, assignment_id)
  where status = 'draft'
    and assignment_id is not null;
