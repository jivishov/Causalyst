create table if not exists simulation_generation_jobs (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references attempts(id) on delete cascade,
  student_id uuid not null references profiles(id) on delete cascade,
  operation text not null check (operation in ('generate', 'refine')),
  status text not null check (status in ('queued', 'in_progress', 'finalizing', 'completed', 'failed', 'incomplete', 'cancelled', 'expired')),
  provider text not null default 'openai',
  provider_response_id text,
  requested_model text not null,
  model_used text,
  sketch_artifact_id uuid not null references attempt_artifacts(id) on delete cascade,
  input_html_artifact_id uuid references attempt_artifacts(id) on delete set null,
  result_artifact_id uuid references attempt_artifacts(id) on delete set null,
  source_description_sha256 text not null,
  error_message text,
  provider_status text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  expires_at timestamptz not null,
  cancelled_at timestamptz
);

create index if not exists idx_simulation_generation_jobs_student
  on simulation_generation_jobs(student_id, created_at desc);

create index if not exists idx_simulation_generation_jobs_attempt
  on simulation_generation_jobs(attempt_id, created_at desc);

create index if not exists idx_simulation_generation_jobs_active
  on simulation_generation_jobs(student_id, attempt_id, operation, status)
  where status in ('queued', 'in_progress', 'finalizing');

alter table simulation_generation_jobs enable row level security;

-- No client policies for simulation_generation_jobs.
-- The Worker uses the Supabase service-role key and enforces application-level access checks.
