begin;
do $$
declare teacher uuid:=gen_random_uuid(); student uuid:=gen_random_uuid(); course uuid:=gen_random_uuid();
 assessment uuid:=gen_random_uuid(); assignment uuid:=gen_random_uuid(); attempt uuid:=gen_random_uuid(); artifact uuid:=gen_random_uuid();
 j jsonb; again jsonb; params jsonb; i integer; entry uuid;
begin
 insert into auth.users(id,email,email_confirmed_at) values(teacher,'teacher@test.invalid',now()),(student,'student@test.invalid',now());
 insert into profiles(id,role) values(teacher,'teacher'),(student,'student');
 insert into classes(id,code,name,teacher_id) values(course,'JOBTEST','Test',teacher);
 insert into assessments(id,type,title,prompt,created_by) values(assessment,'simulation','Test','Explain',teacher);
 insert into assessment_assignments(id,class_id,assessment_id) values(assignment,course,assessment);
 insert into attempts(id,assessment_id,assignment_id,student_id) values(attempt,assessment,assignment,student);
 insert into attempt_artifacts(id,attempt_id,student_id,kind,bucket,storage_key,mime_type,cleanup_at) values(artifact,attempt,student,'simulation-sketch','simulation-sketch','retention-test','image/png',now()-interval '1 day');
 params:=jsonb_build_object('operation','generate','provider','openai','requestedModel','synthetic','htmlReasoningEffort','low','sketchArtifactId',artifact,'sourceDescriptionSha256',repeat('a',64));
 execute 'set local role service_role';
 j:=reserve_simulation_job(student,attempt,'stable-operation',params);
 again:=reserve_simulation_job(student,attempt,'stable-operation',params);
 if not (j->>'claimed')::boolean or (again->>'claimed')::boolean or j->'job'->>'id'<>again->'job'->>'id' then raise exception 'Reservation is not idempotent'; end if;
 if (select count(*) from ai_usage_reservations where attempt_id=attempt)<>1 then raise exception 'Retry consumed duplicate allowance'; end if;
 begin
  perform reserve_simulation_job(student,attempt,'different-operation',params);
  raise exception 'Concurrent work allowed';
 exception when check_violation then null; end;
 update simulation_generation_jobs set status='failed' where id=(j->'job'->>'id')::uuid;
 begin
  update simulation_generation_jobs set status='in_progress' where id=(j->'job'->>'id')::uuid;
  raise exception 'Terminal job reopened';
 exception when check_violation then null; end;
 for i in 1..11 loop perform consume_ai_budget(student,attempt,'test',5); end loop;
 begin
  perform consume_ai_budget(student,attempt,'test',1);
  raise exception 'Budget was exceeded' using errcode='23514';
 exception when raise_exception then null; end;
 if not claim_artifact_cleanup(artifact) then raise exception 'Expired orphan was not claimed'; end if;
 begin
  perform complete_artifact_upload(student,artifact,repeat('a',64));
  raise exception 'Tombstone was reopened';
 exception when check_violation then null; end;
 execute 'reset role';
 insert into roster_students(class_id,display_name,email) values(course,'Student','student@test.invalid');
 perform reconcile_course_gradebook(teacher,course);
 select id into entry from gradebook_entries where assignment_id=assignment limit 1;
 execute 'set local role service_role';
 update gradebook_entries set teacher_override_score=55,teacher_override_note='Teacher review' where id=entry;
 if not exists(select 1 from gradebook_history where entry_id=entry and new_value->>'teacher_override_score'='55') then raise exception 'Missing grade history'; end if;
 begin
  delete from gradebook_history where entry_id=entry;
  raise exception 'History deletion allowed';
 exception when insufficient_privilege then null; end;
 execute 'reset role';
end $$;
rollback;
