create table if not exists roster_students (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references classes(id) on delete cascade,
  display_name text not null,
  student_identifier text,
  email text,
  section text,
  claimed_by uuid references profiles(id),
  claimed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_roster_students_class on roster_students(class_id);
create index if not exists idx_roster_students_claimed_by on roster_students(claimed_by);

create unique index if not exists idx_roster_students_identifier_unique
  on roster_students(class_id, upper(student_identifier))
  where student_identifier is not null and btrim(student_identifier) <> '';

create unique index if not exists idx_roster_students_email_unique
  on roster_students(class_id, lower(email))
  where email is not null and btrim(email) <> '';

alter table roster_students enable row level security;

alter table student_access_codes
  add column if not exists roster_student_id uuid references roster_students(id) on delete set null;

create unique index if not exists idx_student_access_codes_roster_student
  on student_access_codes(roster_student_id)
  where roster_student_id is not null;

alter table class_memberships
  add column if not exists roster_student_id uuid references roster_students(id) on delete set null;

create index if not exists idx_class_memberships_roster_student on class_memberships(roster_student_id);

create unique index if not exists idx_class_memberships_class_roster_unique
  on class_memberships(class_id, roster_student_id)
  where roster_student_id is not null;
