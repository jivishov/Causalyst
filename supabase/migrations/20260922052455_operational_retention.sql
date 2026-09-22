alter table public.attempts add column grading_metadata jsonb;
alter table public.attempt_artifacts add column cleanup_attempts integer not null default 0,
 add column cleanup_error text, add column provider_cleanup_at timestamptz;
-- Provider handles expire on their provider too; reconcile cached historical files.
update public.attempt_artifacts set provider_cleanup_at=now()+interval '1 day' where openai_file_id is not null;
create index artifact_cleanup_due on public.attempt_artifacts(cleanup_at) where upload_state<>'deleted';
create index provider_cleanup_due on public.attempt_artifacts(provider_cleanup_at) where openai_file_id is not null;

create table public.gradebook_history (
 id uuid primary key default gen_random_uuid(), entry_id uuid not null,
 course_owner_id uuid not null, previous_value jsonb not null, new_value jsonb not null,
 created_at timestamptz not null default now()
);
alter table public.gradebook_history enable row level security;
revoke all on public.gradebook_history from public,anon,authenticated,service_role;
grant select,insert on public.gradebook_history to service_role;
create function public.capture_gradebook_change() returns trigger language plpgsql security invoker set search_path='' as $$
declare owner uuid;
begin
 if to_jsonb(old)-'updated_at' is distinct from to_jsonb(new)-'updated_at' then
  select c.teacher_id into owner from public.assessment_assignments a join public.classes c on c.id=a.class_id where a.id=new.assignment_id;
  insert into public.gradebook_history(entry_id,course_owner_id,previous_value,new_value) values(new.id,owner,to_jsonb(old),to_jsonb(new));
 end if;
 return new;
end $$;
revoke all on function public.capture_gradebook_change() from public,anon,authenticated;
create trigger capture_gradebook_change after update on public.gradebook_entries for each row execute function public.capture_gradebook_change();
revoke update,delete,truncate on public.attempt_audit_logs from service_role;
-- Worker-mediated operations must not have parallel direct client write paths.
revoke all on public.attempt_artifacts,public.attempt_realtime_sessions,public.attempt_realtime_events,public.simulation_generation_jobs from anon,authenticated;

create function public.limit_attempt_creation() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 perform pg_advisory_xact_lock(hashtextextended('attempts:'||new.student_id::text,0));
 if (select count(*) from public.attempts where student_id=new.student_id and assignment_id=new.assignment_id and created_at>=now()-interval '1 day')>=20 then
  raise exception 'Daily assessment attempt allowance reached' using errcode='23514';
 end if;
 return new;
end $$;
revoke all on function public.limit_attempt_creation() from public,anon,authenticated;
create trigger limit_attempt_creation before insert on public.attempts for each row execute function public.limit_attempt_creation();
-- Expiration is claimed before object removal. A tombstone prevents concurrent
-- submission selecting bytes while cleanup is running, and remains retryable.
alter table public.attempt_artifacts add column cleanup_claimed_at timestamptz;
create function public.claim_artifact_cleanup(p_artifact_id uuid) returns boolean
language plpgsql security invoker set search_path='' as $$
declare a public.attempt_artifacts;
begin
 select * into a from public.attempt_artifacts where id=p_artifact_id;
 if not found then return false; end if;
 perform 1 from public.attempts where id=a.attempt_id for update;
 select * into a from public.attempt_artifacts where id=p_artifact_id for update;
 if a.frozen_at is not null or a.cleanup_at is null or a.cleanup_at>now() then return false; end if;
 update public.attempt_artifacts set upload_state='deleted',cleanup_claimed_at=now() where id=a.id;
 return true;
end $$;
revoke all on function public.claim_artifact_cleanup(uuid) from public,anon,authenticated;
grant execute on function public.claim_artifact_cleanup(uuid) to service_role;

create function public.recover_stale_assessment_work() returns void
language plpgsql security invoker set search_path='' as $$
begin
 update public.attempt_realtime_sessions set status='error',finalize_error='Session interrupted; teacher review or a new attempt is required',updated_at=now()
 where (status in ('connecting','finalizing') and updated_at<now()-interval '2 minutes') or (status='active' and expires_at<now()-interval '2 minutes');
 update public.attempts t set status='error',updated_at=now() from public.assessment_versions v
 where t.assessment_version_id=v.id and v.definition->>'type'<>'simulation' and t.status='submitted' and t.updated_at<now()-interval '10 minutes';
end $$;
revoke all on function public.recover_stale_assessment_work() from public,anon,authenticated;
grant execute on function public.recover_stale_assessment_work() to service_role;
grant select,insert on public.ai_usage_reservations to service_role;

create function public.record_artifact_cleanup(p_artifact_id uuid,p_changes jsonb) returns void
language plpgsql security invoker set search_path='' as $$
declare a public.attempt_artifacts;
begin
 select * into a from public.attempt_artifacts where id=p_artifact_id;
 if not found then raise exception 'Artifact not found' using errcode='23514'; end if;
 perform 1 from public.attempts where id=a.attempt_id for update;
 select * into a from public.attempt_artifacts where id=p_artifact_id for update;
 update public.attempt_artifacts set
  openai_file_id=case when p_changes ? 'openai_file_id' then p_changes->>'openai_file_id' else openai_file_id end,
  provider_cleanup_at=case when p_changes ? 'provider_cleanup_at' then (p_changes->>'provider_cleanup_at')::timestamptz else provider_cleanup_at end,
  cleanup_at=case when p_changes ? 'cleanup_at' then (p_changes->>'cleanup_at')::timestamptz else cleanup_at end,
  upload_state=coalesce(p_changes->>'upload_state',upload_state),
  cleanup_attempts=(p_changes->>'cleanup_attempts')::integer,cleanup_error=p_changes->>'cleanup_error'
 where id=a.id;
 insert into public.attempt_audit_logs(attempt_id,route,provider,model,request_summary,error)
 values(a.attempt_id,'/scheduled/cleanup','system','none',jsonb_build_object('artifactId',a.id,'changes',p_changes),p_changes->>'cleanup_error');
end $$;
revoke all on function public.record_artifact_cleanup(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.record_artifact_cleanup(uuid,jsonb) to service_role;
