alter table roster_students
  add column if not exists deactivated_at timestamptz;

create table if not exists gradebook_entries (
  id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references assessment_assignments(id) on delete cascade,
  roster_student_id uuid not null references roster_students(id) on delete cascade,
  approved_attempt_id uuid references attempts(id) on delete set null,
  approved_score numeric check (approved_score is null or (approved_score >= 0 and approved_score <= 100)),
  approved_feedback jsonb,
  teacher_override_score numeric check (teacher_override_score is null or (teacher_override_score >= 0 and teacher_override_score <= 100)),
  teacher_override_note text,
  missing boolean not null default false,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (assignment_id, roster_student_id)
);

create index if not exists idx_gradebook_assignment on gradebook_entries(assignment_id);
create index if not exists idx_gradebook_roster_student on gradebook_entries(roster_student_id);
create index if not exists idx_gradebook_published on gradebook_entries(published_at);

alter table gradebook_entries enable row level security;
