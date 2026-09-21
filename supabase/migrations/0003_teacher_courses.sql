alter table classes
  add column if not exists section text,
  add column if not exists term text,
  add column if not exists archived_at timestamptz,
  add column if not exists updated_at timestamptz not null default now();

create index if not exists idx_classes_teacher on classes(teacher_id);
create index if not exists idx_classes_teacher_archived on classes(teacher_id, archived_at);
create index if not exists idx_classes_code_upper on classes(upper(code));
