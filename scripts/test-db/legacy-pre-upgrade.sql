-- Synthetic pre-upgrade records. Never run against a hosted database.
do $$
declare teacher uuid:=gen_random_uuid(); student uuid:=gen_random_uuid();
 assessment uuid:=gen_random_uuid(); draft uuid:=gen_random_uuid(); submitted uuid:=gen_random_uuid();
begin
 insert into auth.users(id,email,email_confirmed_at) values(teacher,'legacy-teacher@test.invalid',now()),(student,'legacy-student@test.invalid',now());
 insert into public.profiles(id,role) values(teacher,'teacher'),(student,'student');
 insert into public.assessments(id,type,title,prompt,created_by) values(assessment,'writing','Legacy synthetic test','Prompt',teacher);
 insert into public.attempts(id,assessment_id,student_id,status) values(draft,assessment,student,'draft'),
  (submitted,assessment,student,'submitted');
 insert into public.attempt_artifacts(attempt_id,student_id,kind,bucket,storage_key,mime_type,upload_state,cleanup_at,created_at)
 select draft,student,'writing','writing','legacy-seeded-'||i,'application/pdf','uploaded',now()-interval '1 day',now()-interval '30 days'
 from generate_series(1,2300) as i;
 insert into public.attempt_artifacts(attempt_id,student_id,kind,bucket,storage_key,mime_type,upload_state,cleanup_at)
 values(draft,student,'writing','writing','legacy-seeded-pending','application/pdf','pending',now()-interval '1 day'),
  (submitted,student,'writing','writing','legacy-seeded-submitted','application/pdf','uploaded',now()-interval '1 day');
end $$;
