alter table assessments
  drop constraint if exists assessments_type_check;

alter table assessments
  add constraint assessments_type_check
  check (type in ('voice', 'voice_realtime', 'writing', 'simulation'));

create table if not exists attempt_realtime_sessions (
  id uuid primary key default gen_random_uuid(),
  attempt_id uuid not null references attempts(id) on delete cascade,
  student_id uuid not null references profiles(id) on delete cascade,
  provider text not null default 'openai',
  model text not null,
  status text not null default 'connecting' check (status in ('connecting', 'active', 'finalized', 'error')),
  provider_session_id text,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists attempt_realtime_events (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references attempt_realtime_sessions(id) on delete cascade,
  attempt_id uuid not null references attempts(id) on delete cascade,
  student_id uuid not null references profiles(id) on delete cascade,
  sequence integer not null,
  event_type text not null,
  role text check (role is null or role in ('student', 'assistant', 'system', 'status')),
  text text,
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (session_id, sequence)
);

create index if not exists idx_realtime_sessions_attempt
  on attempt_realtime_sessions (attempt_id);

create index if not exists idx_realtime_sessions_student
  on attempt_realtime_sessions (student_id, created_at desc);

create index if not exists idx_realtime_events_attempt
  on attempt_realtime_events (attempt_id, created_at);

alter table attempt_realtime_sessions enable row level security;
alter table attempt_realtime_events enable row level security;

-- No client policies for realtime session or event tables.
-- The Worker uses the service-role key and enforces attempt/student ownership.
