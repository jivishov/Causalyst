begin;
do $$
declare teacher uuid:=gen_random_uuid(); student uuid:=gen_random_uuid(); course uuid:=gen_random_uuid();
 assessment uuid:=gen_random_uuid(); assignment uuid:=gen_random_uuid(); attempt uuid:=gen_random_uuid(); session uuid:=gen_random_uuid(); saved_status text;
begin
 insert into auth.users(id) values(teacher),(student);
 insert into profiles(id,role) values(teacher,'teacher'),(student,'student');
 insert into classes(id,code,name,teacher_id) values(course,'REALTIME','Test',teacher);
 insert into assessments(id,type,title,prompt,created_by) values(assessment,'voice_realtime','Test','Explain',teacher);
 insert into assessment_assignments(id,class_id,assessment_id) values(assignment,course,assessment);
 insert into attempts(id,assessment_id,assignment_id,student_id) values(attempt,assessment,assignment,student);
 insert into attempt_realtime_sessions(id,attempt_id,student_id,provider,model,status,expires_at) values(session,attempt,student,'openai','synthetic','active',now()-interval '2 seconds');
 execute 'set local role service_role';
 perform claim_realtime_submission(student,session,'Trusted audio');
 if not exists(select 1 from attempts where id=attempt and status='submitted' and transcript='Trusted audio') then
  raise exception 'Trusted evidence was not checkpointed before grading'; end if;
 begin
  perform claim_realtime_submission(student,session,'Concurrent replacement');
  raise exception 'Duplicate live submission claimed';
 exception when check_violation then null; end;
 begin
  perform save_realtime_grade(student,session,'Trusted audio','{"score":999}','{"source":"provider_audio"}','{}');
  raise exception 'Impossible grade saved';
 exception when check_violation then null; end;
 select t.status into saved_status from attempts t where id=attempt;
 if saved_status<>'submitted' then raise exception 'Partial grade write was not rolled back'; end if;
 perform save_realtime_grade(student,session,'Trusted audio','{"score":80,"policyVersion":"rubric-v2"}','{"source":"provider_audio"}','{}');
 perform save_realtime_grade(student,session,'Replacement','{"score":90}','{}','{}');
 if not exists(select 1 from attempts where id=attempt and transcript='Trusted audio' and provisional_score=80 and status='graded') then raise exception 'Finalization replay changed saved grade'; end if;
 if not exists(select 1 from attempt_realtime_sessions where id=session and status='finalized' and finalized_score=80) then raise exception 'Session and grade diverged'; end if;
 execute 'reset role';
end $$;
rollback;
