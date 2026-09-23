begin;
do $$
declare teacher uuid:=gen_random_uuid(); student uuid:=gen_random_uuid(); assessment uuid:=gen_random_uuid();
 attempt uuid:=gen_random_uuid(); held uuid:=gen_random_uuid(); fresh uuid:=gen_random_uuid();
begin
 insert into auth.users(id,email,email_confirmed_at) values(teacher,'hold-teacher@test.invalid',now()),(student,'hold-student@test.invalid',now());
 insert into profiles(id,role) values(teacher,'teacher'),(student,'student');
 insert into assessments(id,type,title,prompt,created_by) values(assessment,'writing','Hold test','Prompt',teacher);
 insert into attempts(id,assessment_id,student_id) values(attempt,assessment,student);
 insert into attempt_artifacts(id,attempt_id,student_id,kind,bucket,storage_key,mime_type,cleanup_at)
 values(held,attempt,student,'writing','writing','fresh-hold-test','application/pdf',now()-interval '1 minute'),
  (fresh,attempt,student,'writing','writing','fresh-expiry-test','application/pdf',now()-interval '1 minute');
 -- Only schema owner can create a hold: the Worker service role reads it.
 insert into app_private.legacy_artifact_retention_holds(artifact_id) values(held);
 if has_schema_privilege('anon','app_private','usage') or has_schema_privilege('authenticated','app_private','usage')
    or has_table_privilege('service_role','app_private.legacy_artifact_retention_holds','insert') then
  raise exception 'Retention holds are writable or readable by a direct client';
 end if;
 execute 'set local role service_role';
 if claim_artifact_cleanup(held) then raise exception 'Held bytes were claimed by service role'; end if;
 if not claim_artifact_cleanup(fresh) then raise exception 'Unheld bytes could not be claimed'; end if;
 execute 'reset role';
end $$;
rollback;
