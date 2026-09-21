alter table assessments
  add column if not exists archived_at timestamptz,
  add column if not exists updated_at timestamptz not null default now();

update assessments
set updated_at = coalesce(updated_at, created_at, now())
where updated_at is null;

alter table assessment_assignments
  add column if not exists archived_at timestamptz,
  add column if not exists updated_at timestamptz not null default now();

update assessment_assignments
set updated_at = coalesce(updated_at, created_at, now())
where updated_at is null;

alter table assessment_assignments
  drop constraint if exists assessment_assignments_assessment_id_class_id_key;

drop index if exists assessment_assignments_assessment_id_class_id_key;

create unique index if not exists idx_assignment_active_unique
  on assessment_assignments (assessment_id, class_id)
  where archived_at is null;

create index if not exists idx_assignments_class_active
  on assessment_assignments (class_id, archived_at);

create index if not exists idx_assessments_teacher_active
  on assessments (created_by, archived_at);
