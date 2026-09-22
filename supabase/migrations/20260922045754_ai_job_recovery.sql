create table public.ai_usage_reservations (
 id uuid primary key default gen_random_uuid(), student_id uuid not null references public.profiles(id),
 class_id uuid not null references public.classes(id), attempt_id uuid not null references public.attempts(id),
 operation text not null, units integer not null check(units>0), created_at timestamptz not null default now()
);
create index ai_usage_student_day on public.ai_usage_reservations(student_id,created_at);
create index ai_usage_course_day on public.ai_usage_reservations(class_id,created_at);
alter table public.ai_usage_reservations enable row level security;
revoke all on public.ai_usage_reservations from public,anon,authenticated;
-- Conservatively charged reservations, including unknown/failed provider outcomes.
-- Units bound request volume; they are not a claim about provider dollar billing.
create function public.consume_ai_budget(p_user_id uuid,p_attempt_id uuid,p_operation text,p_units integer)
returns uuid language plpgsql security invoker set search_path='' as $$
declare course uuid; reservation uuid; student_total integer; course_total integer;
begin
 if p_units not between 1 and 20 then raise exception 'Invalid quota reservation' using errcode='23514'; end if;
 select aa.class_id into course from public.attempts t join public.assessment_assignments aa on aa.id=t.assignment_id
 join public.classes c on c.id=aa.class_id where t.id=p_attempt_id and t.student_id=p_user_id and c.archived_at is null and aa.archived_at is null;
 if course is null then raise exception 'Attempt is unavailable' using errcode='23514'; end if;
 perform pg_advisory_xact_lock(hashtextextended('budget:course:'||course::text,0));
 perform pg_advisory_xact_lock(hashtextextended('budget:user:'||p_user_id::text,0));
 select coalesce(sum(units),0) into student_total from public.ai_usage_reservations where student_id=p_user_id and created_at>=date_trunc('day',now() at time zone 'UTC') at time zone 'UTC';
 select coalesce(sum(units),0) into course_total from public.ai_usage_reservations where class_id=course and created_at>=date_trunc('day',now() at time zone 'UTC') at time zone 'UTC';
 if student_total+p_units>60 or course_total+p_units>3000 then raise exception 'Daily AI allowance reached' using errcode='P0001'; end if;
 insert into public.ai_usage_reservations(student_id,class_id,attempt_id,operation,units) values(p_user_id,course,p_attempt_id,p_operation,p_units) returning id into reservation;
 return reservation;
end $$;
revoke all on function public.consume_ai_budget(uuid,uuid,text,integer) from public,anon,authenticated;
grant execute on function public.consume_ai_budget(uuid,uuid,text,integer) to service_role;

alter table public.simulation_generation_jobs add column idempotency_key text;
create unique index simulation_job_idempotency on public.simulation_generation_jobs(student_id,attempt_id,idempotency_key);
-- Existing duplicate active jobs remain recoverable; all new reservations serialize
-- on the attempt and enforce one active operation before provider execution.
create function public.reserve_simulation_job(p_user_id uuid,p_attempt_id uuid,p_key text,p_input jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare t public.attempts; j public.simulation_generation_jobs;
begin
 select * into t from public.attempts where id=p_attempt_id and student_id=p_user_id for update;
 if not found or t.status<>'draft' then raise exception 'Attempt is not editable' using errcode='23514'; end if;
 select * into j from public.simulation_generation_jobs where student_id=p_user_id and attempt_id=p_attempt_id and idempotency_key=p_key;
 if found then return jsonb_build_object('claimed',false,'job',to_jsonb(j)); end if;
 if exists(select 1 from public.simulation_generation_jobs where attempt_id=p_attempt_id and status in ('queued','in_progress','finalizing')) then
  raise exception 'Another generation is still active' using errcode='23514';
 end if;
 perform public.consume_ai_budget(p_user_id,p_attempt_id,'simulation_html',5);
 insert into public.simulation_generation_jobs(attempt_id,student_id,idempotency_key,operation,status,provider,requested_model,reasoning_effort,sketch_artifact_id,input_html_artifact_id,source_description_sha256,expires_at)
 values(p_attempt_id,p_user_id,p_key,p_input->>'operation','queued',p_input->>'provider',p_input->>'requestedModel',p_input->>'htmlReasoningEffort',(p_input->>'sketchArtifactId')::uuid,(p_input->>'inputHtmlArtifactId')::uuid,p_input->>'sourceDescriptionSha256',now()+interval '20 minutes') returning * into j;
 return jsonb_build_object('claimed',true,'job',to_jsonb(j));
end $$;
revoke all on function public.reserve_simulation_job(uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.reserve_simulation_job(uuid,uuid,text,jsonb) to service_role;

create function public.guard_simulation_job() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if old.status in ('completed','failed','incomplete','cancelled','expired') and new.status<>old.status then
  raise exception 'Terminal generation cannot be restarted' using errcode='23514';
 end if;
 if old.status='finalizing' and new.status in ('queued','in_progress') then
  raise exception 'Finalization cannot return to provider execution' using errcode='23514';
 end if;
 return new;
end $$;
revoke all on function public.guard_simulation_job() from public,anon,authenticated;
create trigger guard_simulation_job before update on public.simulation_generation_jobs for each row execute function public.guard_simulation_job();
