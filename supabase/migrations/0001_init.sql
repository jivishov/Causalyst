create extension if not exists pgcrypto;

create table if not exists profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'student' check (role in ('student', 'teacher')),
  display_name text not null default 'Student',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists classes (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  teacher_id uuid references profiles(id),
  created_at timestamptz not null default now()
);

create table if not exists class_memberships (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references classes(id) on delete cascade,
  student_id uuid not null references profiles(id) on delete cascade,
  display_name text not null default 'Student',
  created_at timestamptz not null default now(),
  unique (class_id, student_id)
);

create table if not exists student_access_codes (
  id uuid primary key default gen_random_uuid(),
  class_id uuid not null references classes(id) on delete cascade,
  student_label text,
  pin_hash text not null,
  claimed_by uuid references profiles(id),
  claimed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (class_id, pin_hash)
);

create table if not exists assessments (
  id uuid primary key default gen_random_uuid(),
  type text not null check (type in ('voice', 'writing', 'simulation')),
  title text not null,
  prompt text not null,
  expected_answer text,
  rubric jsonb not null default '[]'::jsonb,
  config jsonb not null default '{}'::jsonb,
  created_by uuid references profiles(id),
  created_at timestamptz not null default now()
);

create table if not exists assessment_assignments (
  id uuid primary key default gen_random_uuid(),
  assessment_id uuid not null references assessments(id) on delete cascade,
  class_id uuid not null references classes(id) on delete cascade,
  opens_at timestamptz,
  due_at timestamptz,
  created_at timestamptz not null default now(),
  unique (assessment_id, class_id)
);

create table if not exists attempts (
  id uuid primary key default gen_random_uuid(),
  assessment_id uuid not null references assessments(id) on delete cascade,
  student_id uuid not null references profiles(id) on delete cascade,
  status text not null default 'draft' check (status in ('draft', 'submitted', 'graded', 'error')),
  transcript text,
  ocr_text text,
  simulation_description text,
  simulation_spec jsonb,
  provisional_score numeric check (provisional_score is null or (provisional_score >= 0 and provisional_score <= 100)),
  provisional_feedback jsonb,
  submitted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists attempt_artifacts (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references attempts(id) on delete cascade,
  student_id uuid not null references profiles(id) on delete cascade,
  kind text not null check (kind in ('audio', 'writing', 'simulation-derived')),
  bucket text not null,
  storage_key text not null,
  mime_type text not null,
  byte_size bigint not null default 0,
  original_filename text not null default 'artifact.bin',
  openai_file_id text,
  upload_state text not null default 'pending' check (upload_state in ('pending', 'uploaded', 'processed', 'deleted')),
  cleanup_at timestamptz,
  created_at timestamptz not null default now(),
  unique (storage_key)
);

create table if not exists attempt_audit_logs (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references attempts(id) on delete cascade,
  route text not null,
  provider text not null,
  model text not null,
  request_summary jsonb,
  raw_response jsonb,
  error text,
  created_at timestamptz not null default now()
);

create index if not exists idx_class_memberships_student on class_memberships(student_id);
create index if not exists idx_assignments_class on assessment_assignments(class_id);
create index if not exists idx_attempts_student on attempts(student_id);
create index if not exists idx_attempt_artifacts_attempt on attempt_artifacts(attempt_id);

alter table profiles enable row level security;
alter table classes enable row level security;
alter table class_memberships enable row level security;
alter table student_access_codes enable row level security;
alter table assessments enable row level security;
alter table assessment_assignments enable row level security;
alter table attempts enable row level security;
alter table attempt_artifacts enable row level security;
alter table attempt_audit_logs enable row level security;

create policy "profiles select own" on profiles
  for select using (auth.uid() = id);

create policy "profiles insert own student" on profiles
  for insert with check (auth.uid() = id and role = 'student');

create policy "profiles update own display name" on profiles
  for update using (auth.uid() = id)
  with check (auth.uid() = id and role = 'student');

create policy "classes select enrolled" on classes
  for select using (
    exists (
      select 1 from class_memberships cm
      where cm.class_id = classes.id and cm.student_id = auth.uid()
    )
  );

create policy "memberships select own" on class_memberships
  for select using (student_id = auth.uid());

create policy "assignments select enrolled" on assessment_assignments
  for select using (
    exists (
      select 1 from class_memberships cm
      where cm.class_id = assessment_assignments.class_id and cm.student_id = auth.uid()
    )
  );

create policy "assessments select assigned" on assessments
  for select using (
    exists (
      select 1
      from assessment_assignments aa
      join class_memberships cm on cm.class_id = aa.class_id
      where aa.assessment_id = assessments.id
        and cm.student_id = auth.uid()
        and (aa.opens_at is null or aa.opens_at <= now())
    )
  );

create policy "attempts select own" on attempts
  for select using (student_id = auth.uid());

create policy "attempts insert own draft" on attempts
  for insert with check (
    student_id = auth.uid()
    and status = 'draft'
    and exists (
      select 1
      from assessment_assignments aa
      join class_memberships cm on cm.class_id = aa.class_id
      where aa.assessment_id = attempts.assessment_id
        and cm.student_id = auth.uid()
        and (aa.opens_at is null or aa.opens_at <= now())
    )
    and transcript is null
    and ocr_text is null
    and simulation_spec is null
    and provisional_score is null
    and provisional_feedback is null
  );

-- No client policies for student_access_codes, attempt_artifacts, or attempt_audit_logs.
-- The Worker uses the Supabase service-role key and enforces application-level access checks.

insert into storage.buckets (id, name, public)
values
  ('audio', 'audio', false),
  ('writing', 'writing', false),
  ('simulation-derived', 'simulation-derived', false)
on conflict (id) do nothing;
