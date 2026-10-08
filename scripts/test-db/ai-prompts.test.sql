begin;
do $$
declare t uuid := gen_random_uuid(); other_t uuid := gen_random_uuid(); s uuid := gen_random_uuid();
 c1 uuid := gen_random_uuid(); c2 uuid := gen_random_uuid(); a uuid := gen_random_uuid();
 x1 uuid := gen_random_uuid(); x2 uuid := gen_random_uuid(); attempt uuid := gen_random_uuid();
 ctx jsonb; saved jsonb; frozen jsonb; result jsonb; revision text; core_revision text;
begin
 insert into auth.users(id) values(t),(other_t),(s);
 insert into public.profiles(id,role) values(t,'teacher'),(other_t,'teacher'),(s,'student');
 insert into public.classes(id,code,name,teacher_id) values(c1,'PROMPT1','One',t),(c2,'PROMPT2','Two',t);
 insert into public.assessments(id,type,title,prompt,created_by) values(a,'simulation','Original','Student question',t);
 insert into public.assessment_assignments(id,class_id,assessment_id) values(x1,c1,a),(x2,c2,a);
 insert into public.attempts(id,assessment_id,assignment_id,student_id) values(attempt,a,x1,s);
 select v.definition into frozen from public.attempts q join public.assessment_versions v on v.id=q.assessment_version_id where q.id=attempt;
 perform public.set_teacher_ai_prompts(t,'defaults',t,'simulation','{"simulationHtml":{"system":"Teacher default"}}',null);
 perform public.set_teacher_ai_prompts(t,'assessment',a,'simulation','{"simulationHtml":{"user":"Assessment user"}}',null);
 saved := public.set_teacher_ai_prompts(t,'assignment',x1,'simulation','{"simulationHtml":{"system":"Class One"}}',null);
 ctx := public.get_attempt_ai_context(attempt)->'promptContext';
 if ctx->'assignment'->'simulationHtml'->>'system' <> 'Class One' or ctx->'defaults'->'simulationHtml'->>'system' <> 'Teacher default' then raise exception 'Incorrect prompt hierarchy'; end if;
 ctx := public.get_teacher_prompt_context(t,null,null,x2);
 if ctx->'assignment' <> 'null'::jsonb or ctx->'assessment'->'simulationHtml'->>'user' <> 'Assessment user' then raise exception 'Assignment prompts leaked into another class'; end if;
 -- A next action on the SAME existing attempt observes the update.
 revision := saved->>'assignmentUpdatedAt';
 perform public.set_teacher_ai_prompts(t,'assignment',x1,'simulation','{"simulationHtml":{"system":"Class One revised"}}',revision);
 if public.get_attempt_ai_context(attempt)->'promptContext'->'assignment'->'simulationHtml'->>'system' <> 'Class One revised' then raise exception 'Existing attempt used stale prompts'; end if;
 if (select v.definition from public.attempts q join public.assessment_versions v on v.id=q.assessment_version_id where q.id=attempt) is distinct from frozen then raise exception 'Prompt editing changed the frozen question or rubric'; end if;
 -- A stale prompt save must roll back the parent update too.
 select updated_at::text into core_revision from public.assessments where id=a;
 begin
  perform public.save_teacher_resource_with_prompts(t,'assessment',a,'{"title":"Must roll back"}','{}',core_revision,null);
  raise exception 'Stale prompt update was accepted';
 exception when serialization_failure then null; end;
 if (select title from public.assessments where id=a) <> 'Original' then raise exception 'Failed prompt save left partial assessment changes'; end if;
 ctx := public.get_teacher_prompt_context(t,null,a,null);
 result := public.save_teacher_resource_with_prompts(t,'assessment',a,'{"title":"Saved atomically"}','{"simulationHtml":{"system":"New assessment"}}',core_revision,ctx->>'assessmentUpdatedAt');
 if result->>'title' <> 'Saved atomically' or public.get_teacher_prompt_context(t,null,a,null)->'assessment'->'simulationHtml'->>'system' <> 'New assessment' then raise exception 'Atomic assessment update failed'; end if;
 -- Creation and reset are supported without copying defaults into every assignment.
 result := public.save_teacher_resource_with_prompts(t,'assessment',null,'{"type":"voice","title":"Voice","prompt":"Speak","rubric":[],"config":{}}','{"voiceGrade":{"system":"Voice instructions"}}',null,null);
 if public.get_teacher_prompt_context(t,null,(result->>'id')::uuid,null)->'assessment'->'voiceGrade'->>'system' <> 'Voice instructions' then raise exception 'New assessment lost custom prompts'; end if;
 ctx := public.get_teacher_prompt_context(t,null,null,x1);
 perform public.set_teacher_ai_prompts(t,'assignment',x1,'simulation','{}',ctx->>'assignmentUpdatedAt');
 if public.get_attempt_ai_context(attempt)->'promptContext'->'assignment' <> '{}'::jsonb then raise exception 'Reset did not restore inheritance'; end if;
 begin perform public.get_teacher_prompt_context(other_t,null,null,x1); raise exception 'Other teacher read prompts'; exception when insufficient_privilege then null; end;
 begin perform public.set_teacher_ai_prompts(other_t,'assignment',x1,'simulation','{}',null); raise exception 'Other teacher changed prompts'; exception when insufficient_privilege then null; end;
 begin perform public.set_teacher_ai_prompts(s,'defaults',s,'voice','{}',null); raise exception 'Student changed defaults'; exception when insufficient_privilege then null; end;
 if has_table_privilege('authenticated','private.teacher_ai_prompts','select')
  or has_function_privilege('anon','public.get_teacher_prompt_context(uuid,text,uuid,uuid)','execute')
  or has_function_privilege('authenticated','public.set_teacher_ai_prompts(uuid,text,uuid,text,jsonb,text)','execute')
  or has_function_privilege('authenticated','public.save_teacher_resource_with_prompts(uuid,text,uuid,jsonb,jsonb,text,text)','execute') then raise exception 'Browser roles can access teacher prompts'; end if;
end $$;
rollback;
