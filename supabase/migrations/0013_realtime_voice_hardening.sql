alter table attempt_realtime_sessions
  drop constraint if exists attempt_realtime_sessions_status_check;

alter table attempt_realtime_sessions
  add constraint attempt_realtime_sessions_status_check
  check (status in ('connecting', 'active', 'finalizing', 'finalized', 'error'));

alter table attempt_realtime_sessions
  add column if not exists continuity_diagnostics jsonb not null default '{}'::jsonb,
  add column if not exists finalized_attempt_id uuid references attempts(id) on delete set null,
  add column if not exists finalized_transcript text,
  add column if not exists finalized_score double precision,
  add column if not exists finalized_feedback jsonb,
  add column if not exists finalized_at timestamptz,
  add column if not exists finalize_error text;

create index if not exists idx_realtime_sessions_attempt_status
  on attempt_realtime_sessions (attempt_id, status, started_at desc);
