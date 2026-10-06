begin;
do $$
declare teacher uuid:=gen_random_uuid(); student uuid:=gen_random_uuid(); stranger uuid:=gen_random_uuid(); course uuid:=gen_random_uuid();
 assessment uuid:=gen_random_uuid(); assignment uuid:=gen_random_uuid(); attempt uuid:=gen_random_uuid(); newer uuid:=gen_random_uuid();
 roster uuid:=gen_random_uuid(); entry uuid:=gen_random_uuid(); stamp timestamptz:=now()-interval '1 minute'; result jsonb;
begin
 insert into auth.users(id) values(teacher),(student),(stranger);
 insert into public.profiles(id,role) values(teacher,'teacher'),(student,'student'),(stranger,'teacher');
 insert into public.classes(id,code,name,teacher_id) values(course,'PLUGIN-GRADE','Test',teacher);
 insert into public.assessments(id,type,title,prompt,created_by) values(assessment,'writing','Title','Explain',teacher);
 insert into public.assessment_assignments(id,class_id,assessment_id) values(assignment,course,assessment);
 insert into public.roster_students(id,class_id,display_name,claimed_by) values(roster,course,'Synthetic student',student);
 insert into public.class_memberships(class_id,student_id,roster_student_id) values(course,student,roster);
 insert into public.attempts(id,assessment_id,assignment_id,student_id,status,submitted_at,updated_at)
 values(attempt,assessment,assignment,student,'submitted',stamp,stamp);
 insert into public.gradebook_entries(id,assignment_id,roster_student_id,updated_at) values(entry,assignment,roster,stamp);
 -- Auth fixtures belong to the schema owner; exercise the grade writer with
 -- the production service role only after those fixtures have been created.
 execute 'set local role service_role';
 result:=public.save_teacher_plugin_grade(stranger,attempt,stamp,entry,stamp,85,'Reviewed');
 if result->>'status'='saved' then raise exception 'Another teacher saved the grade'; end if;
 result:=public.save_teacher_plugin_grade(teacher,attempt,stamp-interval '1 second',entry,stamp,85,'Reviewed');
 if result->>'status'='saved' then raise exception 'Stale evidence accepted'; end if;
 result:=public.save_teacher_plugin_grade(teacher,attempt,stamp,entry,stamp-interval '1 second',85,'Reviewed');
 if result->>'status'='saved' then raise exception 'Stale grade accepted'; end if;
 update public.gradebook_entries set published_at=stamp where id=entry;
 result:=public.save_teacher_plugin_grade(teacher,attempt,stamp,entry,stamp,85,'Reviewed');
 if result->>'status'='saved' then raise exception 'Published grade changed'; end if;
 update public.gradebook_entries set published_at=null where id=entry;
 insert into public.attempts(id,assessment_id,assignment_id,student_id,status,submitted_at,updated_at)
 values(newer,assessment,assignment,student,'submitted',stamp+interval '1 second',stamp);
 result:=public.save_teacher_plugin_grade(teacher,attempt,stamp,entry,stamp,85,'Reviewed');
 if result->>'reason'<>'newer_submission' then raise exception 'Older evidence overrode a newer submission: %',result; end if;
 result:=public.save_teacher_plugin_grade(teacher,newer,stamp,entry,stamp,85,'Reviewed in ChatGPT');
 if result->>'status'<>'saved' or (select teacher_override_score from public.gradebook_entries where id=entry)<>85 then raise exception 'Fresh grade failed: %',result; end if;
 if (select published_at from public.gradebook_entries where id=entry) is not null then raise exception 'Plugin published a grade'; end if;
 result:=public.save_teacher_plugin_grade(teacher,newer,stamp,entry,stamp,20,'Blind retry');
 if result->>'status'='saved' then raise exception 'Repeat save ignored revision conflict'; end if;
end $$;
reset role;
do $$ begin
 if has_function_privilege('anon','public.save_teacher_plugin_grade(uuid,uuid,timestamptz,uuid,timestamptz,numeric,text)','execute') or has_function_privilege('authenticated','public.save_teacher_plugin_grade(uuid,uuid,timestamptz,uuid,timestamptz,numeric,text)','execute') then raise exception 'Grade writer publicly exposed'; end if;
end $$;
rollback;
