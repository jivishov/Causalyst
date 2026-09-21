alter table attempt_artifacts
  drop constraint if exists attempt_artifacts_kind_check;

alter table attempt_artifacts
  add constraint attempt_artifacts_kind_check
  check (kind in ('audio', 'writing', 'simulation-derived', 'simulation-sketch'));

alter table attempt_artifacts
  add column if not exists source_description_sha256 text;

insert into storage.buckets (id, name, public)
values ('simulation-sketch', 'simulation-sketch', false)
on conflict (id) do nothing;
