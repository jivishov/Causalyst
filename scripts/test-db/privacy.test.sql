do $$
begin
 if has_table_privilege('authenticated', 'public.assessments', 'select') then
  raise exception 'Student role can read answer keys';
 end if;
 if has_table_privilege('anon', 'public.assessments', 'select') then
  raise exception 'Anonymous role can read answer keys';
 end if;
 if not has_table_privilege('service_role', 'public.assessments', 'select') then
  raise exception 'Worker cannot read grading specification';
 end if;
 if has_table_privilege('authenticated', 'public.attempts', 'insert') then
  raise exception 'Student role can bypass Worker attempt creation';
 end if;
end $$;

begin;
set local role authenticated;
do $$ begin
 begin perform expected_answer from public.assessments limit 1;
  raise exception 'Student queried private assessment keys';
 exception when insufficient_privilege then null; end;
 begin perform definition from public.assessment_versions limit 1;
  raise exception 'Student queried private frozen keys';
 exception when insufficient_privilege then null; end;
 begin perform public.consume_ai_budget(gen_random_uuid(),gen_random_uuid(),'test',1);
  raise exception 'Student invoked privileged RPC';
 exception when insufficient_privilege then null; end;
end $$;
rollback;
