-- Additive: preserve every existing job and its recorded effort.
alter table public.simulation_generation_jobs
  drop constraint simulation_generation_jobs_reasoning_effort_check,
  add constraint simulation_generation_jobs_reasoning_effort_check
    check (reasoning_effort in ('none', 'low', 'medium', 'high', 'xhigh', 'max'));
