-- Allow new Max jobs while preserving the recorded effort of historical jobs.
alter table public.simulation_generation_jobs
  drop constraint simulation_generation_jobs_reasoning_effort_check,
  add constraint simulation_generation_jobs_reasoning_effort_check
    check (reasoning_effort in ('low', 'medium', 'high', 'max')),
  alter column reasoning_effort set default 'max';
