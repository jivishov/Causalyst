-- Null preserves unknown service tiers for legacy jobs; never infer Standard.
alter table public.simulation_generation_jobs
  add column service_tier_requested text check (service_tier_requested in ('default', 'fast', 'provider_default')),
  add column service_tier_used text check (service_tier_used in ('default', 'fast', 'priority', 'flex', 'auto', 'provider_default'));

create or replace function public.reserve_simulation_job(p_user_id uuid,p_attempt_id uuid,p_key text,p_input jsonb)
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
 insert into public.simulation_generation_jobs(attempt_id,student_id,idempotency_key,operation,status,provider,requested_model,reasoning_effort,service_tier_requested,sketch_artifact_id,input_html_artifact_id,source_description_sha256,expires_at)
 values(p_attempt_id,p_user_id,p_key,p_input->>'operation','queued',p_input->>'provider',p_input->>'requestedModel',p_input->>'htmlReasoningEffort',p_input->>'htmlServiceTierRequested',(p_input->>'sketchArtifactId')::uuid,(p_input->>'inputHtmlArtifactId')::uuid,p_input->>'sourceDescriptionSha256',now()+interval '20 minutes') returning * into j;
 return jsonb_build_object('claimed',true,'job',to_jsonb(j));
end $$;
revoke all on function public.reserve_simulation_job(uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.reserve_simulation_job(uuid,uuid,text,jsonb) to service_role;
