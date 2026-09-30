-- Additive: no auth/session, assessment, roster, or existing grade changes.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
grant usage on schema private to service_role;

create table private.teacher_ai_settings (
  teacher_id uuid primary key references public.profiles(id) on delete cascade,
  settings jsonb not null check (jsonb_typeof(settings) = 'object'),
  updated_at timestamptz not null default now()
);
create table private.attempt_ai_settings (
  attempt_id uuid primary key references public.attempts(id) on delete cascade,
  teacher_id uuid not null references public.profiles(id),
  settings jsonb not null check (jsonb_typeof(settings) = 'object'),
  created_at timestamptz not null default now()
);
alter table private.teacher_ai_settings enable row level security;
alter table private.attempt_ai_settings enable row level security;
revoke all on private.teacher_ai_settings, private.attempt_ai_settings from public, anon, authenticated;
grant select, insert, update on private.teacher_ai_settings to service_role;
grant select, insert on private.attempt_ai_settings to service_role;

create function public.get_teacher_ai_settings(p_teacher_id uuid) returns jsonb
language sql security invoker set search_path = '' as $$
  select jsonb_build_object('settings', s.settings, 'updatedAt', s.updated_at)
  from (select p_teacher_id as id) t
  left join private.teacher_ai_settings s on s.teacher_id = t.id;
$$;

create function public.get_attempt_ai_context(p_attempt_id uuid) returns jsonb
language sql security invoker set search_path = '' as $$
  select jsonb_build_object('teacherId', coalesce(c.teacher_id, a.created_by),
    'runtime', r.settings, 'settings', t.settings)
  from public.attempts x
  join public.assessments a on a.id = x.assessment_id
  left join public.assessment_assignments aa on aa.id = x.assignment_id
  left join public.classes c on c.id = aa.class_id
  left join private.attempt_ai_settings r on r.attempt_id = x.id
  left join private.teacher_ai_settings t on t.teacher_id = coalesce(c.teacher_id, a.created_by)
  where x.id = p_attempt_id;
$$;

create function public.capture_attempt_ai_settings(p_attempt_id uuid, p_teacher_id uuid, p_settings jsonb) returns jsonb
language plpgsql security invoker set search_path = '' as $$
begin
  if not exists (
    select 1 from public.attempts x
    join public.assessments a on a.id = x.assessment_id
    left join public.assessment_assignments aa on aa.id = x.assignment_id
    left join public.classes c on c.id = aa.class_id
    where x.id = p_attempt_id and coalesce(c.teacher_id, a.created_by) = p_teacher_id
  ) then raise insufficient_privilege using message = 'Attempt does not belong to this teacher'; end if;
  insert into private.attempt_ai_settings(attempt_id, teacher_id, settings)
    values (p_attempt_id, p_teacher_id, p_settings) on conflict (attempt_id) do nothing;
  return (select settings from private.attempt_ai_settings where attempt_id = p_attempt_id);
end;
$$;

create function public.set_teacher_ai_settings(p_teacher_id uuid, p_settings jsonb, p_previous_runtime jsonb, p_expected_updated_at text) returns jsonb
language plpgsql security invoker set search_path = '' as $$
declare current_updated_at timestamptz;
begin
  perform 1 from public.profiles where id = p_teacher_id and role = 'teacher' for update;
  if not found then raise insufficient_privilege using message = 'Teacher access required'; end if;
  select updated_at into current_updated_at from private.teacher_ai_settings where teacher_id = p_teacher_id;
  if current_updated_at is distinct from p_expected_updated_at::timestamptz then
    raise serialization_failure using message = 'AI settings changed; reload before saving';
  end if;
  -- Freeze existing attempts before rotating credentials/models. This also
  -- preserves provider file ownership and background polling/voice permissions.
  insert into private.attempt_ai_settings(attempt_id, teacher_id, settings)
    select x.id, p_teacher_id, p_previous_runtime from public.attempts x
    join public.assessments a on a.id = x.assessment_id
    left join public.assessment_assignments aa on aa.id = x.assignment_id
    left join public.classes c on c.id = aa.class_id
    where coalesce(c.teacher_id, a.created_by) = p_teacher_id
    on conflict (attempt_id) do nothing;
  insert into private.teacher_ai_settings(teacher_id, settings, updated_at)
    values (p_teacher_id, p_settings, clock_timestamp())
    on conflict (teacher_id) do update set settings = excluded.settings, updated_at = excluded.updated_at;
  return public.get_teacher_ai_settings(p_teacher_id);
end;
$$;

revoke all on function public.get_teacher_ai_settings(uuid), public.get_attempt_ai_context(uuid),
  public.capture_attempt_ai_settings(uuid,uuid,jsonb), public.set_teacher_ai_settings(uuid,jsonb,jsonb,text)
  from public, anon, authenticated;
grant execute on function public.get_teacher_ai_settings(uuid), public.get_attempt_ai_context(uuid),
  public.capture_attempt_ai_settings(uuid,uuid,jsonb), public.set_teacher_ai_settings(uuid,jsonb,jsonb,text)
  to service_role;
