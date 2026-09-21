alter table simulation_generation_jobs
  add column if not exists reasoning_effort text not null default 'medium';

alter table simulation_generation_jobs
  drop constraint if exists simulation_generation_jobs_reasoning_effort_check;

alter table simulation_generation_jobs
  add constraint simulation_generation_jobs_reasoning_effort_check
  check (reasoning_effort in ('low', 'medium', 'high'));
