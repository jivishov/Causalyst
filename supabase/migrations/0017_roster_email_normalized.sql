alter table public.roster_students
  add column if not exists email_normalized text
  generated always as (lower(btrim(email))) stored;

create index if not exists idx_roster_students_email_normalized
  on public.roster_students(email_normalized)
  where email_normalized is not null and email_normalized <> '';
