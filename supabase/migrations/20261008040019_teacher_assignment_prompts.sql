-- Teacher-only prompt overrides. No changes to frozen assessments, artifacts or grades.
create table private.teacher_ai_prompts (
  teacher_id uuid not null references public.profiles(id) on delete cascade,
  assessment_type text not null check (assessment_type in ('voice','voice_realtime','writing','simulation')),
  scope text not null check (scope in ('defaults','assessment','assignment')),
  scope_id uuid not null,
  assessment_id uuid references public.assessments(id) on delete cascade,
  assignment_id uuid references public.assessment_assignments(id) on delete cascade,
  prompts jsonb not null check (jsonb_typeof(prompts) = 'object' and octet_length(prompts::text) <= 400000),
  updated_at timestamptz not null default clock_timestamp(),
  primary key (scope, scope_id, assessment_type),
  check ((scope = 'defaults' and scope_id = teacher_id and assessment_id is null and assignment_id is null)
    or (scope = 'assessment' and assessment_id is not null and scope_id = assessment_id and assignment_id is null)
    or (scope = 'assignment' and assignment_id is not null and scope_id = assignment_id and assessment_id is null))
);
create index teacher_ai_prompts_teacher_idx on private.teacher_ai_prompts(teacher_id);
alter table private.teacher_ai_prompts enable row level security;
revoke all on private.teacher_ai_prompts from public, anon, authenticated;
grant select, insert, update on private.teacher_ai_prompts to service_role;

create function public.get_teacher_prompt_context(p_teacher_id uuid, p_type text, p_assessment_id uuid, p_assignment_id uuid)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_type text := p_type; v_assessment_id uuid := p_assessment_id;
begin
  if not exists (select 1 from public.profiles where id = p_teacher_id and role = 'teacher') then
    raise insufficient_privilege using message = 'Teacher access required';
  end if;
  if p_assignment_id is not null then
    select aa.assessment_id, a.type into v_assessment_id, v_type
    from public.assessment_assignments aa join public.classes c on c.id = aa.class_id
    join public.assessments a on a.id = aa.assessment_id
    where aa.id = p_assignment_id and c.teacher_id = p_teacher_id and a.created_by = p_teacher_id;
    if not found or (p_assessment_id is not null and p_assessment_id <> v_assessment_id) then
      raise insufficient_privilege using message = 'Assignment not found';
    end if;
  elsif p_assessment_id is not null then
    select type into v_type from public.assessments where id = p_assessment_id and created_by = p_teacher_id;
    if not found then raise insufficient_privilege using message = 'Assessment not found'; end if;
  end if;
  if v_type is null or v_type not in ('voice','voice_realtime','writing','simulation') then
    raise check_violation using message = 'Assessment type required';
  end if;
  return (select jsonb_build_object('type', v_type, 'defaults', d.prompts, 'assessment', a.prompts, 'assignment', x.prompts,
    'defaultsUpdatedAt', d.updated_at, 'assessmentUpdatedAt', a.updated_at, 'assignmentUpdatedAt', x.updated_at)
    from (select 1) seed
    left join private.teacher_ai_prompts d on d.scope = 'defaults' and d.scope_id = p_teacher_id and d.assessment_type = v_type and d.teacher_id = p_teacher_id
    left join private.teacher_ai_prompts a on a.scope = 'assessment' and a.scope_id = v_assessment_id and a.assessment_type = v_type and a.teacher_id = p_teacher_id
    left join private.teacher_ai_prompts x on x.scope = 'assignment' and x.scope_id = p_assignment_id and x.assessment_type = v_type and x.teacher_id = p_teacher_id);
end;
$$;

create function public.set_teacher_ai_prompts(p_teacher_id uuid, p_scope text, p_scope_id uuid, p_type text, p_prompts jsonb, p_expected_updated_at text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_context jsonb; v_updated_at timestamptz;
begin
  -- All prompt and parent saves for this owner serialize, including a first save.
  perform 1 from public.profiles where id = p_teacher_id and role = 'teacher' for update;
  if not found then raise insufficient_privilege using message = 'Teacher access required'; end if;
  if p_scope = 'defaults' and p_scope_id = p_teacher_id then
    v_context := public.get_teacher_prompt_context(p_teacher_id, p_type, null, null);
  elsif p_scope = 'assessment' then
    v_context := public.get_teacher_prompt_context(p_teacher_id, p_type, p_scope_id, null);
  elsif p_scope = 'assignment' then
    v_context := public.get_teacher_prompt_context(p_teacher_id, p_type, null, p_scope_id);
  else raise insufficient_privilege using message = 'Invalid prompt scope'; end if;
  if v_context->>'type' <> p_type then raise check_violation using message = 'Assessment type changed'; end if;
  select updated_at into v_updated_at from private.teacher_ai_prompts
    where scope = p_scope and scope_id = p_scope_id and assessment_type = p_type;
  if v_updated_at is distinct from p_expected_updated_at::timestamptz then
    raise serialization_failure using message = 'AI prompts changed; reload before saving';
  end if;
  insert into private.teacher_ai_prompts(teacher_id, assessment_type, scope, scope_id, assessment_id, assignment_id, prompts)
    values (p_teacher_id, p_type, p_scope, p_scope_id,
      case when p_scope = 'assessment' then p_scope_id end,
      case when p_scope = 'assignment' then p_scope_id end, p_prompts)
    on conflict (scope,scope_id,assessment_type) do update set prompts = excluded.prompts, updated_at = clock_timestamp();
  return public.get_teacher_prompt_context(p_teacher_id, p_type,
    case when p_scope = 'assessment' then p_scope_id end,
    case when p_scope = 'assignment' then p_scope_id end);
end;
$$;

create function public.save_teacher_resource_with_prompts(p_teacher_id uuid, p_scope text, p_resource_id uuid, p_patch jsonb,
  p_prompts jsonb, p_expected_updated_at text, p_expected_prompt_updated_at text)
returns jsonb language plpgsql security invoker set search_path = '' as $$
declare v_id uuid; v_type text; v_result jsonb; v_assessment public.assessments; v_assignment public.assessment_assignments;
  v_assessment_id uuid; v_class_id uuid;
begin
  perform 1 from public.profiles where id = p_teacher_id and role = 'teacher' for update;
  if not found then raise insufficient_privilege using message = 'Teacher access required'; end if;
  if p_scope = 'assessment' then
    if p_resource_id is null then
      insert into public.assessments(type,title,prompt,expected_answer,rubric,config,created_by)
        values (p_patch->>'type',p_patch->>'title',p_patch->>'prompt',p_patch->>'expected_answer',p_patch->'rubric',p_patch->'config',p_teacher_id)
        returning * into v_assessment;
    else
      select * into v_assessment from public.assessments where id = p_resource_id and created_by = p_teacher_id for update;
      if not found then raise insufficient_privilege using message = 'Assessment not found'; end if;
      if p_expected_updated_at is not null and v_assessment.updated_at is distinct from p_expected_updated_at::timestamptz then
        raise serialization_failure using message = 'Assessment changed';
      end if;
      update public.assessments set
        type = case when p_patch ? 'type' then p_patch->>'type' else type end,
        title = case when p_patch ? 'title' then p_patch->>'title' else title end,
        prompt = case when p_patch ? 'prompt' then p_patch->>'prompt' else prompt end,
        expected_answer = case when p_patch ? 'expected_answer' then p_patch->>'expected_answer' else expected_answer end,
        rubric = case when p_patch ? 'rubric' then p_patch->'rubric' else rubric end,
        config = case when p_patch ? 'config' then p_patch->'config' else config end,
        updated_at = clock_timestamp()
        where id = p_resource_id and created_by = p_teacher_id returning * into v_assessment;
    end if;
    v_id := v_assessment.id; v_type := v_assessment.type; v_result := to_jsonb(v_assessment);
  elsif p_scope = 'assignment' then
    if p_resource_id is not null then
      select aa.* into v_assignment from public.assessment_assignments aa
        join public.classes c on c.id = aa.class_id join public.assessments a on a.id = aa.assessment_id
        where aa.id = p_resource_id and c.teacher_id = p_teacher_id and a.created_by = p_teacher_id for update of aa;
      if not found then raise insufficient_privilege using message = 'Assignment not found'; end if;
      if p_expected_updated_at is not null and v_assignment.updated_at is distinct from p_expected_updated_at::timestamptz then
        raise serialization_failure using message = 'Assignment changed';
      end if;
    end if;
    v_assessment_id := coalesce((p_patch->>'assessment_id')::uuid, v_assignment.assessment_id);
    v_class_id := coalesce((p_patch->>'class_id')::uuid, v_assignment.class_id);
    select type into v_type from public.assessments where id = v_assessment_id and created_by = p_teacher_id and archived_at is null;
    if not found or not exists(select 1 from public.classes where id = v_class_id and teacher_id = p_teacher_id and archived_at is null) then
      raise insufficient_privilege using message = 'Assessment or course not found';
    end if;
    if p_resource_id is null then
      insert into public.assessment_assignments(assessment_id,class_id,opens_at,due_at)
        values (v_assessment_id,v_class_id,(p_patch->>'opens_at')::timestamptz,(p_patch->>'due_at')::timestamptz)
        returning * into v_assignment;
    else
      update public.assessment_assignments set assessment_id = v_assessment_id, class_id = v_class_id,
        opens_at = case when p_patch ? 'opens_at' then (p_patch->>'opens_at')::timestamptz else opens_at end,
        due_at = case when p_patch ? 'due_at' then (p_patch->>'due_at')::timestamptz else due_at end,
        updated_at = clock_timestamp() where id = p_resource_id returning * into v_assignment;
    end if;
    v_id := v_assignment.id; v_result := to_jsonb(v_assignment);
  else raise check_violation using message = 'Invalid resource scope'; end if;
  perform public.set_teacher_ai_prompts(p_teacher_id,p_scope,v_id,v_type,p_prompts,p_expected_prompt_updated_at);
  return v_result;
end;
$$;

-- Fetch current prompts alongside the existing AI settings in the same database request.
-- Questions/rubrics remain frozen. Prompt updates affect the next AI action only.
create or replace function public.get_attempt_ai_context(p_attempt_id uuid) returns jsonb
language sql security invoker set search_path = '' as $$
  select jsonb_build_object('teacherId', coalesce(c.teacher_id, a.created_by), 'runtime', r.settings, 'settings', t.settings,
    'promptContext', jsonb_build_object('type', coalesce(v.definition->>'type',a.type),
      'defaults', d.prompts, 'assessment', ap.prompts, 'assignment', xp.prompts,
      'defaultsUpdatedAt', d.updated_at, 'assessmentUpdatedAt', ap.updated_at, 'assignmentUpdatedAt', xp.updated_at))
  from public.attempts x join public.assessments a on a.id = x.assessment_id
  left join public.assessment_versions v on v.id = x.assessment_version_id
  left join public.assessment_assignments aa on aa.id = x.assignment_id
  left join public.classes c on c.id = aa.class_id
  left join private.attempt_ai_settings r on r.attempt_id = x.id
  left join private.teacher_ai_settings t on t.teacher_id = coalesce(c.teacher_id,a.created_by)
  left join private.teacher_ai_prompts d on d.scope = 'defaults' and d.scope_id = coalesce(c.teacher_id,a.created_by)
    and d.assessment_type = coalesce(v.definition->>'type',a.type) and d.teacher_id = coalesce(c.teacher_id,a.created_by)
  left join private.teacher_ai_prompts ap on ap.scope = 'assessment' and ap.scope_id = a.id
    and ap.assessment_type = coalesce(v.definition->>'type',a.type) and ap.teacher_id = coalesce(c.teacher_id,a.created_by)
  left join private.teacher_ai_prompts xp on xp.scope = 'assignment' and xp.scope_id = x.assignment_id
    and xp.assessment_type = coalesce(v.definition->>'type',a.type) and xp.teacher_id = coalesce(c.teacher_id,a.created_by)
  where x.id = p_attempt_id;
$$;

revoke all on function public.get_teacher_prompt_context(uuid,text,uuid,uuid),
 public.set_teacher_ai_prompts(uuid,text,uuid,text,jsonb,text),
 public.save_teacher_resource_with_prompts(uuid,text,uuid,jsonb,jsonb,text,text) from public, anon, authenticated;
grant execute on function public.get_teacher_prompt_context(uuid,text,uuid,uuid),
 public.set_teacher_ai_prompts(uuid,text,uuid,text,jsonb,text),
 public.save_teacher_resource_with_prompts(uuid,text,uuid,jsonb,jsonb,text,text) to service_role;
