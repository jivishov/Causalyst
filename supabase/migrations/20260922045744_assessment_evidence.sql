-- Attempts bind an immutable definition, including the private key and policy.
create table public.assessment_versions (
 id uuid primary key default gen_random_uuid(),
 assessment_id uuid not null references public.assessments(id),
 definition jsonb not null,
 legacy_capture boolean not null default false,
 created_at timestamptz not null default now()
);
alter table public.assessment_versions enable row level security;
revoke all on public.assessment_versions from public, anon, authenticated;
revoke all on public.assessment_versions from service_role;
grant select, insert on public.assessment_versions to service_role;
alter table public.attempts add column assessment_version_id uuid references public.assessment_versions(id);

-- Historical definitions cannot be reconstructed. Mark the migration-time copy.
insert into public.assessment_versions(assessment_id, definition, legacy_capture)
select a.id, to_jsonb(a), true from public.assessments a
where exists (select 1 from public.attempts t where t.assessment_id=a.id);
update public.attempts t set assessment_version_id=v.id
from public.assessment_versions v where v.assessment_id=t.assessment_id and v.legacy_capture;

alter table public.attempts alter column assessment_version_id set not null;

create function public.capture_attempt_assessment() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare a public.assessments;
begin
 if tg_op = 'UPDATE' then
  if old.status<>'draft' and new.simulation_description is distinct from old.simulation_description then
   raise exception 'Submitted description is immutable' using errcode='23514';
  end if;
  if new.assessment_version_id is distinct from old.assessment_version_id
     or new.assessment_id is distinct from old.assessment_id
     or new.assignment_id is distinct from old.assignment_id
     or new.student_id is distinct from old.student_id then
   raise exception 'Attempt assessment identity is immutable' using errcode='23514';
  end if;
  return new;
 end if;
 select * into a from public.assessments where id=new.assessment_id for share;
 if not found then raise exception 'Assessment not found'; end if;
 if new.assignment_id is not null and not exists (
  select 1 from public.assessment_assignments aa where aa.id=new.assignment_id and aa.assessment_id=a.id
 ) then raise exception 'Assignment assessment mismatch' using errcode='23514'; end if;
 insert into public.assessment_versions(assessment_id, definition)
 values(a.id, to_jsonb(a)) returning id into new.assessment_version_id;
 return new;
end $$;
revoke all on function public.capture_attempt_assessment() from public, anon, authenticated;
create trigger capture_attempt_assessment before insert or update on public.attempts
for each row execute function public.capture_attempt_assessment();

alter table public.attempt_artifacts
 add column content_sha256 text check(content_sha256 is null or content_sha256 ~ '^[0-9a-f]{64}$'),
 add column frozen_at timestamptz;
update public.attempt_artifacts a set frozen_at=coalesce(t.submitted_at, t.created_at),cleanup_at=null
from public.attempts t where t.id=a.attempt_id and t.status<>'draft' and a.upload_state in ('uploaded','processed');
update public.attempt_artifacts set cleanup_at=now()+interval '7 days' where frozen_at is null and upload_state in ('pending','uploaded','processed');
revoke all on public.attempt_artifacts from anon,authenticated;

create table public.submission_artifacts (
 attempt_id uuid not null references public.attempts(id),
 artifact_id uuid not null references public.attempt_artifacts(id),
 content_sha256 text,
 primary key(attempt_id, artifact_id)
);
alter table public.submission_artifacts enable row level security;
revoke all on public.submission_artifacts from public, anon, authenticated;
revoke all on public.submission_artifacts from service_role;
grant select, insert on public.submission_artifacts to service_role;
insert into public.submission_artifacts(attempt_id, artifact_id, content_sha256)
select attempt_id,id,content_sha256 from public.attempt_artifacts where frozen_at is not null;

create function public.guard_artifact_evidence() returns trigger
language plpgsql security invoker set search_path = '' as $$
declare t public.attempts;
begin
 -- Metadata refreshes must not acquire an artifact-then-attempt lock. Evidence
 -- transitions enter through RPCs that consistently lock the attempt first.
 if tg_op='INSERT' or (old.upload_state='pending' and new.upload_state='uploaded') then
  select * into t from public.attempts where id=new.attempt_id for update;
  if not found or t.student_id<>new.student_id then raise exception 'Artifact owner mismatch' using errcode='23514'; end if;
  if t.status<>'draft' then raise exception 'Attempt is no longer editable' using errcode='23514'; end if;
 end if;
 if tg_op='UPDATE' then
  if new.attempt_id<>old.attempt_id or new.student_id<>old.student_id or new.storage_key<>old.storage_key or new.bucket<>old.bucket or new.kind<>old.kind then
   raise exception 'Artifact identity is immutable' using errcode='23514';
  end if;
  if old.upload_state in ('uploaded','processed','deleted') and new.upload_state='pending' then
   raise exception 'Completed uploads cannot be reopened' using errcode='23514';
  end if;
  if old.upload_state in ('uploaded','processed','deleted') and
   (new.content_sha256 is distinct from old.content_sha256 or new.byte_size<>old.byte_size or new.mime_type<>old.mime_type
    or new.source_description_sha256 is distinct from old.source_description_sha256) then
   raise exception 'Uploaded evidence is immutable' using errcode='23514';
  end if;
  if old.frozen_at is not null and new.upload_state='deleted' then
   raise exception 'Submitted evidence cannot be deleted' using errcode='23514';
  end if;
  if old.frozen_at is not null and new.frozen_at is distinct from old.frozen_at then
   raise exception 'Submission binding is immutable' using errcode='23514';
  end if;
 end if;
 return new;
end $$;
revoke all on function public.guard_artifact_evidence() from public, anon, authenticated;
create trigger guard_artifact_evidence before insert or update on public.attempt_artifacts
for each row execute function public.guard_artifact_evidence();

-- Lock the attempt first in both submission and upload completion.
create function public.complete_artifact_upload(p_user_id uuid, p_artifact_id uuid, p_sha256 text)
returns void language plpgsql security invoker set search_path='' as $$
declare a public.attempt_artifacts; t public.attempts;
begin
 select * into a from public.attempt_artifacts where id=p_artifact_id and student_id=p_user_id;
 if not found then raise exception 'Artifact not found' using errcode='23514'; end if;
 select * into t from public.attempts where id=a.attempt_id for update;
 select * into a from public.attempt_artifacts where id=p_artifact_id for update;
 if t.status<>'draft' then raise exception 'Attempt is no longer editable' using errcode='23514'; end if;
 if a.upload_state='uploaded' and a.content_sha256=p_sha256 then return; end if;
 if a.upload_state<>'pending' then raise exception 'Artifact already completed' using errcode='23514'; end if;
 update public.attempt_artifacts set upload_state='uploaded', content_sha256=p_sha256,
  cleanup_at=now()+interval '7 days' where id=a.id;
end $$;
revoke all on function public.complete_artifact_upload(uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.complete_artifact_upload(uuid,uuid,text) to service_role;

-- Replace the legacy claim with a manifest-aware transaction.
drop function public.claim_attempt_submission(uuid,uuid,timestamptz);
create function public.claim_attempt_submission(p_user_id uuid,p_attempt_id uuid,p_submitted_at timestamptz,p_artifact_ids uuid[] default '{}', p_simulation_description text default null, p_description_sha256 text default null)
returns table(claim_status text,attempt_id uuid,assignment_id uuid,submitted_at timestamptz,submitted_after_due boolean,assignment_due_at timestamptz,current_attempt_status text)
language plpgsql security invoker set search_path='' as $$
declare t public.attempts; a public.assessment_assignments; assessment_kind text; n integer;
begin
 select * into t from public.attempts where id=p_attempt_id and student_id=p_user_id for update;
 if not found then return query select 'not_found',null::uuid,null::uuid,null::timestamptz,null::boolean,null::timestamptz,null::text; return; end if;
 select * into a from public.assessment_assignments where id=t.assignment_id;
 if not found then return query select 'missing_assignment',t.id,t.assignment_id,null::timestamptz,null::boolean,null::timestamptz,t.status; return; end if;
 if t.status<>'draft' then return query select 'not_draft',t.id,t.assignment_id,null::timestamptz,null::boolean,a.due_at,t.status; return; end if;
 if a.archived_at is not null or exists(select 1 from public.classes c where c.id=a.class_id and c.archived_at is not null) then
  return query select 'archived_assignment',t.id,t.assignment_id,null::timestamptz,null::boolean,a.due_at,t.status; return;
 end if;
 select definition->>'type' into assessment_kind from public.assessment_versions where id=t.assessment_version_id;
 if p_artifact_ids is null or cardinality(p_artifact_ids)<>(case when assessment_kind='simulation' then 2 when assessment_kind='voice_realtime' then 0 else 1 end) then
  raise exception 'Submission must select its complete evidence' using errcode='23514';
 end if;
 select count(*) into n from public.attempt_artifacts ar where ar.id=any(p_artifact_ids)
  and ar.attempt_id=t.id and ar.student_id=p_user_id and ar.upload_state='uploaded' and ar.content_sha256 is not null;
 if n<>cardinality(p_artifact_ids) then raise exception 'Evidence is incomplete or unavailable; upload it again' using errcode='23514'; end if;
 if assessment_kind in ('voice','writing') and not exists(select 1 from public.attempt_artifacts ar where ar.id=any(p_artifact_ids) and ar.kind=case when assessment_kind='voice' then 'audio' else 'writing' end) then
  raise exception 'Evidence type mismatch' using errcode='23514';
 end if;
 if assessment_kind='simulation' and (select count(distinct ar.kind) from public.attempt_artifacts ar where ar.id=any(p_artifact_ids) and ar.kind in ('simulation-sketch','simulation-derived'))<>2 then
  raise exception 'Simulation requires sketch and HTML evidence' using errcode='23514';
 end if;
 if assessment_kind='simulation' and (p_simulation_description is null or p_description_sha256 is null or exists(
  select 1 from public.attempt_artifacts ar where ar.id=any(p_artifact_ids) and ar.source_description_sha256 is distinct from p_description_sha256
 )) then raise exception 'Simulation description does not match selected evidence' using errcode='23514'; end if;
 insert into public.submission_artifacts(attempt_id,artifact_id,content_sha256)
 select t.id,ar.id,ar.content_sha256 from public.attempt_artifacts ar where ar.id=any(p_artifact_ids);
 update public.attempt_artifacts ar set frozen_at=p_submitted_at,cleanup_at=null where ar.id=any(p_artifact_ids);
 update public.attempts set status='submitted',submitted_at=p_submitted_at,
  simulation_description=case when assessment_kind='simulation' then p_simulation_description else simulation_description end,
  submitted_after_due=a.due_at is not null and p_submitted_at>a.due_at,updated_at=p_submitted_at where id=t.id;
 return query select 'success',t.id,t.assignment_id,p_submitted_at,
  a.due_at is not null and p_submitted_at>a.due_at,a.due_at,'submitted';
end $$;
revoke all on function public.claim_attempt_submission(uuid,uuid,timestamptz,uuid[],text,text) from public, anon, authenticated;
grant execute on function public.claim_attempt_submission(uuid,uuid,timestamptz,uuid[],text,text) to service_role;
