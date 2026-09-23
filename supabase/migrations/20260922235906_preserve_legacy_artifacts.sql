-- Apply after all six 20260922 release migrations and before deploying the new
-- Worker/cron. Preserve every unsubmitted, unhashed artifact already present
-- at this cutover, rather than scheduling its historical bytes for deletion.
-- New reservations after the cutover keep their normal seven-day deadline.
create schema if not exists app_private;
revoke all on schema app_private from public, anon, authenticated;
grant usage on schema app_private to service_role;
create table app_private.legacy_artifact_retention_holds (
 artifact_id uuid primary key references public.attempt_artifacts(id),
 held_at timestamptz not null default now()
);
alter table app_private.legacy_artifact_retention_holds enable row level security;
revoke all on app_private.legacy_artifact_retention_holds from public, anon, authenticated, service_role;
grant select on app_private.legacy_artifact_retention_holds to service_role;
insert into app_private.legacy_artifact_retention_holds(artifact_id)
select a.id from public.attempt_artifacts a join public.attempts t on t.id=a.attempt_id
where t.status='draft' and a.frozen_at is null and a.content_sha256 is null
 and a.upload_state in ('pending','uploaded','processed');
update public.attempt_artifacts a set cleanup_at=null
where exists(select 1 from app_private.legacy_artifact_retention_holds h where h.artifact_id=a.id);

-- Defense in depth: even if an operator accidentally sets a held artifact's
-- deadline, the claim cannot tombstone or remove its Storage object.
create or replace function public.claim_artifact_cleanup(p_artifact_id uuid) returns boolean
language plpgsql security invoker set search_path='' as $$
declare a public.attempt_artifacts;
begin
 select * into a from public.attempt_artifacts where id=p_artifact_id;
 if not found then return false; end if;
 perform 1 from public.attempts where id=a.attempt_id for update;
 select * into a from public.attempt_artifacts where id=p_artifact_id for update;
 if a.frozen_at is not null or a.cleanup_at is null or a.cleanup_at>now()
   or exists(select 1 from app_private.legacy_artifact_retention_holds h where h.artifact_id=a.id) then return false; end if;
 update public.attempt_artifacts set upload_state='deleted',cleanup_claimed_at=now() where id=a.id;
 return true;
end $$;
revoke all on function public.claim_artifact_cleanup(uuid) from public,anon,authenticated;
grant execute on function public.claim_artifact_cleanup(uuid) to service_role;
