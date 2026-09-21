create table if not exists grade_exports (
  id uuid primary key default gen_random_uuid(),
  teacher_id uuid not null references profiles(id) on delete cascade,
  course_id uuid not null references classes(id) on delete cascade,
  format text not null check (format in ('long', 'wide')),
  include_unpublished boolean not null default false,
  missing_mode text not null check (missing_mode in ('blank', 'zero')),
  assignment_ids uuid[] not null default '{}',
  column_order text[] not null default '{}',
  column_labels jsonb not null default '{}'::jsonb,
  row_count integer not null default 0 check (row_count >= 0),
  column_count integer not null default 0 check (column_count >= 0),
  created_at timestamptz not null default now()
);

create index if not exists idx_grade_exports_teacher_created on grade_exports(teacher_id, created_at desc);
create index if not exists idx_grade_exports_course_created on grade_exports(course_id, created_at desc);

alter table grade_exports enable row level security;
