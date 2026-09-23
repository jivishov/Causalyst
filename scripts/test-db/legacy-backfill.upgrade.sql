begin;
do $$
declare student uuid; draft uuid; held uuid; fresh uuid; submitted uuid;
begin
 if (select count(*) from app_private.legacy_artifact_retention_holds)<>2301 then
  raise exception 'Legacy draft retention hold must cover all 2,300 uploads and the pending artifact';
 end if;
 if exists(select 1 from public.attempt_artifacts a join app_private.legacy_artifact_retention_holds h on h.artifact_id=a.id
           where a.cleanup_at is not null or a.frozen_at is not null) then
  raise exception 'Held legacy artifact has a cleanup deadline or is frozen';
 end if;
 select id into held from public.attempt_artifacts where storage_key='legacy-seeded-1';
 select attempt_id,student_id into draft,student from public.attempt_artifacts where id=held;
 if not exists(select 1 from public.submission_artifacts s join public.attempt_artifacts a on a.id=s.artifact_id
               where a.storage_key='legacy-seeded-submitted' and a.frozen_at is not null and a.cleanup_at is null) then
  raise exception 'Historical submitted artifact was not frozen';
 end if;
 if exists(select 1 from app_private.legacy_artifact_retention_holds h join public.attempt_artifacts a on a.id=h.artifact_id
           where a.storage_key='legacy-seeded-submitted') then
  raise exception 'Submitted evidence was placed on a draft hold';
 end if;
 -- Even an accidental future cleanup deadline cannot remove a held object.
 update public.attempt_artifacts set cleanup_at=now()-interval '1 minute' where id=held;
 execute 'set local role service_role';
 if public.claim_artifact_cleanup(held) then raise exception 'Held legacy bytes were claimed for deletion'; end if;
 execute 'reset role';
 if (select upload_state from public.attempt_artifacts where id=held)<>'uploaded' then
  raise exception 'Held legacy bytes changed state';
 end if;
 insert into public.attempt_artifacts(attempt_id,student_id,kind,bucket,storage_key,mime_type,cleanup_at)
 values(draft,student,'writing','writing','new-expiring-artifact','application/pdf',now()-interval '1 minute') returning id into fresh;
 if exists(select 1 from app_private.legacy_artifact_retention_holds where artifact_id=fresh) then
  raise exception 'New artifact incorrectly held';
 end if;
 execute 'set local role service_role';
 if not public.claim_artifact_cleanup(fresh) then raise exception 'New unsubmitted artifact did not expire'; end if;
 execute 'reset role';
 if (select upload_state from public.attempt_artifacts where id=fresh)<>'deleted' then
  raise exception 'New artifact was not tombstoned';
 end if;
end $$;
rollback;
