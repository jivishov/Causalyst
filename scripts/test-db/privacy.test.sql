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
