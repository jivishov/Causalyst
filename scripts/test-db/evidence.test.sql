begin;
do $$
declare teacher uuid:=gen_random_uuid(); student uuid:=gen_random_uuid(); course uuid:=gen_random_uuid();
 assessment uuid:=gen_random_uuid(); assignment uuid:=gen_random_uuid(); attempt uuid:=gen_random_uuid();
 artifact uuid:=gen_random_uuid(); late_artifact uuid:=gen_random_uuid(); result record; frozen jsonb;
begin
 insert into auth.users(id) values(teacher),(student);
 insert into profiles(id,role) values(teacher,'teacher'),(student,'student');
 insert into classes(id,code,name,teacher_id) values(course,'EVIDENCE','Test',teacher);
 insert into assessments(id,type,title,prompt,expected_answer,created_by) values(assessment,'writing','Title','Original prompt','Private key',teacher);
 insert into assessment_assignments(id,class_id,assessment_id) values(assignment,course,assessment);
 insert into attempts(id,assessment_id,assignment_id,student_id) values(attempt,assessment,assignment,student);
 update assessments set prompt='Edited',expected_answer='New key' where id=assessment;
 select v.definition into frozen from assessment_versions v join attempts t on t.assessment_version_id=v.id where t.id=attempt;
 if frozen->>'prompt'<>'Original prompt' or frozen->>'expected_answer'<>'Private key' then raise exception 'Attempt context changed'; end if;
 insert into attempt_artifacts(id,attempt_id,student_id,kind,bucket,storage_key,mime_type,byte_size)
 values(artifact,attempt,student,'writing','writing','immutable-test','application/pdf',10),
 (late_artifact,attempt,student,'writing','writing','late-test','application/pdf',10);
 begin
  perform * from claim_attempt_submission(student,attempt,now(),array[artifact]);
  raise exception 'Pending artifact was submitted';
 exception when check_violation then null; end;
 perform complete_artifact_upload(student,artifact,repeat('a',64));
 perform complete_artifact_upload(student,artifact,repeat('a',64));
 select * into result from claim_attempt_submission(student,attempt,now(),array[artifact]);
 if result.claim_status<>'success' then raise exception 'Submission failed: %',result; end if;
 if not exists(select 1 from submission_artifacts where attempt_id=attempt and artifact_id=artifact and content_sha256=repeat('a',64)) then raise exception 'Missing frozen manifest'; end if;
 begin
  update attempt_artifacts set content_sha256=repeat('b',64) where id=artifact;
  raise exception 'Frozen hash changed';
 exception when check_violation then null; end;
 begin
  perform complete_artifact_upload(student,late_artifact,repeat('b',64));
  raise exception 'Late completion succeeded';
 exception when check_violation then null; end;
 begin
  insert into attempt_artifacts(attempt_id,student_id,kind,bucket,storage_key,mime_type) values(attempt,student,'writing','writing','after-submit','application/pdf');
  raise exception 'Post-submission reservation succeeded';
 exception when check_violation then null; end;
 select * into result from claim_attempt_submission(student,attempt,now(),array[artifact]);
 if result.claim_status<>'not_draft' then raise exception 'Duplicate submission claimed'; end if;
 if has_table_privilege('authenticated','assessment_versions','select') or has_table_privilege('service_role','assessment_versions','update') then raise exception 'Snapshot permissions are too broad'; end if;
end $$;
rollback;
