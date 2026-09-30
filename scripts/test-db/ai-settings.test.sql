begin;
do $$
declare teacher uuid := gen_random_uuid(); student uuid := gen_random_uuid(); course uuid := gen_random_uuid();
 assessment uuid := gen_random_uuid(); assignment uuid := gen_random_uuid(); old_attempt uuid := gen_random_uuid();
 new_attempt uuid := gen_random_uuid(); saved jsonb; original jsonb; snapshot jsonb;
begin
 insert into auth.users(id) values(teacher),(student);
 insert into public.profiles(id,role) values(teacher,'teacher'),(student,'student');
 insert into public.classes(id,code,name,teacher_id) values(course,'AISETTINGS','Test',teacher);
 insert into public.assessments(id,type,title,prompt,created_by) values(assessment,'simulation','Title','Prompt',teacher);
 insert into public.assessment_assignments(id,class_id,assessment_id) values(assignment,course,assessment);
 insert into public.attempts(id,assessment_id,assignment_id,student_id) values(old_attempt,assessment,assignment,student);
 saved := public.set_teacher_ai_settings(teacher,'{"version":"new"}','{"version":"original"}',null);
 snapshot := public.get_attempt_ai_context(old_attempt);
 if snapshot->'runtime'->>'version' <> 'original' then raise exception 'Saving settings changed an existing attempt'; end if;
 update public.attempts set status = 'error' where id = old_attempt;
 insert into public.attempts(id,assessment_id,assignment_id,student_id) values(new_attempt,assessment,assignment,student);
 snapshot := public.get_attempt_ai_context(new_attempt);
 if snapshot->'settings'->>'version' <> 'new' or snapshot->'runtime' <> 'null'::jsonb then raise exception 'New attempt has wrong configuration'; end if;
 original := public.capture_attempt_ai_settings(new_attempt,teacher,'{"version":"new"}');
 snapshot := public.capture_attempt_ai_settings(new_attempt,teacher,'{"version":"other"}');
 if snapshot is distinct from original then raise exception 'Concurrent capture overwrote the attempt snapshot'; end if;
 begin
  perform public.capture_attempt_ai_settings(new_attempt,student,'{}');
  raise exception 'Student accepted as attempt teacher';
 exception when insufficient_privilege then null; end;
 begin
  perform public.set_teacher_ai_settings(teacher,'{"version":"overwrite"}','{}',null);
  raise exception 'Stale settings update was accepted';
 exception when serialization_failure then null; end;
 perform public.set_teacher_ai_settings(teacher,'{"version":"next"}','{"version":"new"}',saved->>'updatedAt');
 if public.get_attempt_ai_context(old_attempt)->'runtime'->>'version' <> 'original' then raise exception 'Rotation changed old attempt'; end if;
 if public.get_attempt_ai_context(new_attempt)->'runtime'->>'version' <> 'new' then raise exception 'Rotation changed captured attempt'; end if;
 if has_function_privilege('authenticated','public.get_teacher_ai_settings(uuid)','execute')
  or has_function_privilege('anon','public.get_attempt_ai_context(uuid)','execute')
  or has_function_privilege('authenticated','public.set_teacher_ai_settings(uuid,jsonb,jsonb,text)','execute')
  or has_function_privilege('authenticated','public.capture_attempt_ai_settings(uuid,uuid,jsonb)','execute')
  or has_table_privilege('authenticated','private.teacher_ai_settings','select')
  or has_table_privilege('authenticated','private.attempt_ai_settings','select') then
  raise exception 'Browser roles can access provider configuration';
 end if;
end $$;
set local role authenticated;
do $$ begin
 begin perform public.get_teacher_ai_settings(gen_random_uuid()); raise exception 'Student read settings'; exception when insufficient_privilege then null; end;
 begin perform * from private.teacher_ai_settings; raise exception 'Student read credential table'; exception when insufficient_privilege then null; end;
end $$;
rollback;
