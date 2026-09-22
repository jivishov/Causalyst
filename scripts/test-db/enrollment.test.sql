begin;
do $$
declare teacher uuid:=gen_random_uuid(); student uuid:=gen_random_uuid(); c1 uuid:=gen_random_uuid(); c2 uuid:=gen_random_uuid(); result jsonb; pin_result record; intruder uuid:=gen_random_uuid(); bad uuid:=gen_random_uuid();
begin
 insert into auth.users(id,email,email_confirmed_at) values(teacher,'teacher@test.invalid',now()),(student,'  STUDENT@test.invalid ',now());
 insert into profiles(id,role) values(teacher,'teacher');
 insert into classes(id,code,name,teacher_id) values(c1,'COURSE1','First',teacher),(c2,'COURSE2','Second',teacher);
 insert into roster_students(class_id,display_name,email) values(c1,'Student','student@test.invalid');
 execute 'set local role service_role';
 result:=enroll_student_by_email(student);
 execute 'reset role';
 if result->>'status'<>'matched' then raise exception 'New enrollment failed: %',result; end if;
 insert into roster_students(class_id,display_name,email) values(c2,'Student','student@test.invalid');
 perform enroll_student_by_email(student);
 perform enroll_student_by_email(student);
 if (select count(*) from class_memberships where student_id=student)<>2 then raise exception 'Existing profile failed to reconcile'; end if;
 begin
  perform import_course_roster(teacher,c1,jsonb_build_array(
   jsonb_build_object('id',gen_random_uuid(),'displayName','New','email','rollback@test.invalid','pinHash','hash1'),
   jsonb_build_object('id',gen_random_uuid(),'displayName','Duplicate','email','rollback@test.invalid','pinHash','hash2')));
  raise exception 'Duplicate import succeeded';
 exception when unique_violation then null; end;
 if exists(select 1 from roster_students where email='rollback@test.invalid') then raise exception 'Partial import persisted'; end if;
 perform reconcile_course_gradebook(teacher,c1);
 insert into student_access_codes(class_id,roster_student_id,student_label,pin_hash)
 select c1,id,'Student','test-hash' from roster_students where class_id=c1 and email='student@test.invalid';
 select * into pin_result from claim_student_google_login(student,'student@test.invalid','COURSE1','test-hash');
 if pin_result.claim_status<>'success' then raise exception 'Same-user PIN login failed: %',pin_result; end if;
 insert into auth.users(id,email,email_confirmed_at) values(intruder,'student@test.invalid',now()),(bad,'bad@test.invalid',null);
 result:=enroll_student_by_email(intruder);
 if result->>'status'<>'identity_conflict' or result->'profile'<>'null'::jsonb then raise exception 'Roster identity reassigned'; end if;
 select * into pin_result from claim_student_google_login(intruder,'student@test.invalid','COURSE1','test-hash');
 if pin_result.claim_status<>'same_course_identity_conflict' then raise exception 'PIN reassigned historical evidence'; end if;
 begin perform enroll_student_by_email(bad); raise exception 'Unverified email accepted'; exception when check_violation then null; end;
 result:=enroll_student_by_email(teacher);
 if result->>'status'<>'teacher_profile' then raise exception 'Teacher role was changed'; end if;
 if has_function_privilege('authenticated','enroll_student_by_email(uuid)','execute') then raise exception 'Student can invoke privileged enrollment'; end if;
end $$;
rollback;
