-- Canonical auth identity is read only by the service-role transaction.
grant select(id,email,email_confirmed_at,is_anonymous) on auth.users to service_role;
create function public.enroll_student_by_email(p_user_id uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare u record; p public.profiles; r public.roster_students; matched boolean := false; conflict boolean := false;
begin
 perform pg_advisory_xact_lock(hashtextextended('enroll:'||p_user_id::text,0));
 select id,email,email_confirmed_at,is_anonymous into u from auth.users where id=p_user_id;
 if not found or u.email_confirmed_at is null or coalesce(u.is_anonymous,false) or nullif(btrim(u.email),'') is null then
  raise exception 'Verified student email required' using errcode='23514';
 end if;
 select * into p from public.profiles where id=p_user_id for update;
 if p.role='teacher' then return jsonb_build_object('profile',null,'status','teacher_profile'); end if;
 for r in select rs.* from public.roster_students rs join public.classes c on c.id=rs.class_id
  where rs.email_normalized=lower(btrim(u.email)) and rs.deactivated_at is null and c.archived_at is null
  order by rs.id for update of rs
 loop
  if r.claimed_by is not null and r.claimed_by<>p_user_id then conflict:=true; continue; end if;
  if exists(select 1 from public.class_memberships where class_id=r.class_id and roster_student_id=r.id and student_id<>p_user_id) then conflict:=true; continue; end if;
  if exists(select 1 from public.class_memberships cm where cm.class_id=r.class_id and cm.student_id=p_user_id and cm.roster_student_id is distinct from r.id)
   or exists(select 1 from public.student_access_codes ac where ac.class_id=r.class_id and ac.claimed_by=p_user_id and ac.roster_student_id is distinct from r.id) then
   conflict:=true; continue;
  end if;
  insert into public.profiles(id,role,display_name,email)
   values(p_user_id,'student',r.display_name,lower(btrim(u.email)))
   on conflict(id) do update set email=excluded.email,updated_at=now();
  insert into public.class_memberships(class_id,student_id,display_name,roster_student_id)
   values(r.class_id,p_user_id,r.display_name,r.id)
   on conflict(class_id,student_id) do update set display_name=excluded.display_name,roster_student_id=excluded.roster_student_id;
  update public.student_access_codes set claimed_by=p_user_id,claimed_at=coalesce(claimed_at,now()) where roster_student_id=r.id and (claimed_by is null or claimed_by=p_user_id);
  if exists(select 1 from public.student_access_codes where roster_student_id=r.id and claimed_by<>p_user_id) then
   raise exception 'Roster access identity conflict' using errcode='23514';
  end if;
  update public.roster_students set claimed_by=p_user_id,claimed_at=coalesce(claimed_at,now()),updated_at=now() where id=r.id;
  matched:=true;
 end loop;
 select * into p from public.profiles where id=p_user_id;
 return jsonb_build_object('profile',case when p.id is null then null else to_jsonb(p) end,
  'status',case when matched or p.role='student' then 'matched' when conflict then 'identity_conflict' else 'no_roster_match' end);
end $$;
revoke all on function public.enroll_student_by_email(uuid) from public,anon,authenticated;
grant execute on function public.enroll_student_by_email(uuid) to service_role;

create function public.import_course_roster(p_teacher_id uuid,p_course_id uuid,p_rows jsonb) returns integer
language plpgsql security invoker set search_path='' as $$
declare r jsonb; n integer:=0;
begin
 perform 1 from public.classes c join public.profiles p on p.id=c.teacher_id
  where c.id=p_course_id and c.teacher_id=p_teacher_id and p.role='teacher' and c.archived_at is null for update of c;
 if not found then raise exception 'Course is not available' using errcode='23514'; end if;
 if jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows)>2000 then raise exception 'Invalid roster batch' using errcode='23514'; end if;
 for r in select * from jsonb_array_elements(p_rows) loop
  insert into public.roster_students(id,class_id,display_name,student_identifier,email,section)
  values((r->>'id')::uuid,p_course_id,r->>'displayName',r->>'studentIdentifier',r->>'email',r->>'section');
  insert into public.student_access_codes(class_id,roster_student_id,student_label,pin_hash)
  values(p_course_id,(r->>'id')::uuid,r->>'displayName',r->>'pinHash');
  n:=n+1;
 end loop;
 return n;
end $$;
revoke all on function public.import_course_roster(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.import_course_roster(uuid,uuid,jsonb) to service_role;

create function public.reconcile_course_gradebook(p_teacher_id uuid,p_course_id uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare inserted integer; assignments integer; students integer;
begin
 if not exists(select 1 from public.classes c join public.profiles p on p.id=c.teacher_id where c.id=p_course_id and c.teacher_id=p_teacher_id and p.role='teacher') then
  raise exception 'Course not found' using errcode='23514';
 end if;
 insert into public.gradebook_entries(assignment_id,roster_student_id)
 select a.id,r.id from public.assessment_assignments a join public.assessments ass on ass.id=a.assessment_id
 cross join public.roster_students r
 where a.class_id=p_course_id and r.class_id=p_course_id and a.archived_at is null and ass.archived_at is null and r.deactivated_at is null
 on conflict(assignment_id,roster_student_id) do nothing;
 get diagnostics inserted=row_count;
 select count(*) into assignments from public.assessment_assignments a join public.assessments ass on ass.id=a.assessment_id where a.class_id=p_course_id and a.archived_at is null and ass.archived_at is null;
 select count(*) into students from public.roster_students r where r.class_id=p_course_id and r.deactivated_at is null;
 return jsonb_build_object('insertedRows',inserted,'touchedAssignments',assignments,'touchedStudents',students);
end $$;
revoke all on function public.reconcile_course_gradebook(uuid,uuid) from public,anon,authenticated;
grant execute on function public.reconcile_course_gradebook(uuid,uuid) to service_role;

-- The legacy PIN transport uses the same canonical identity transaction. It may
-- claim an unclaimed roster row; it cannot silently transfer historical work.
create or replace function public.claim_student_google_login(p_user_id uuid,p_email text,p_class_code text,p_pin_hash text)
returns table(claim_status text,class_id uuid,class_code text,class_name text,roster_student_id uuid,display_name text,previous_user_id uuid)
language plpgsql security invoker set search_path='' as $$
declare r record; enrolled jsonb;
begin
 if not exists(select 1 from auth.users u where u.id=p_user_id and u.email_confirmed_at is not null and not coalesce(u.is_anonymous,false) and lower(btrim(u.email))=lower(btrim(p_email))) then
  return query select 'invalid_credentials',null::uuid,null::text,null::text,null::uuid,null::text,null::uuid; return;
 end if;
 select c.id as course_id,c.code,c.name,rs.id as roster_id,rs.display_name,rs.email_normalized,rs.claimed_by,ac.claimed_by as access_owner,ac.id as access_id,ac.student_label into r
 from public.classes c join public.student_access_codes ac on ac.class_id=c.id left join public.roster_students rs on rs.id=ac.roster_student_id
 where c.code=upper(regexp_replace(p_class_code,'\s','','g')) and ac.pin_hash=p_pin_hash and c.archived_at is null and rs.deactivated_at is null;
 if not found then return query select 'invalid_credentials',null::uuid,null::text,null::text,null::uuid,null::text,null::uuid; return; end if;
 if r.roster_id is null then
  perform pg_advisory_xact_lock(hashtextextended('enroll:'||p_user_id::text,0));
  perform 1 from public.student_access_codes where id=r.access_id for update;
  if exists(select 1 from public.student_access_codes where id=r.access_id and claimed_by is not null and claimed_by<>p_user_id)
   or exists(select 1 from public.class_memberships where class_id=r.course_id and student_id=p_user_id and roster_student_id is not null) then
   return query select 'same_course_identity_conflict',r.course_id,r.code,r.name,null::uuid,r.student_label,null::uuid; return;
  end if;
  if exists(select 1 from public.profiles where id=p_user_id and role='teacher') then
   return query select 'teacher_profile',r.course_id,r.code,r.name,null::uuid,r.student_label,null::uuid; return;
  end if;
  insert into public.profiles(id,role,display_name,email) values(p_user_id,'student',coalesce(r.student_label,'Student'),lower(btrim(p_email)))
   on conflict(id) do update set email=excluded.email;
  insert into public.class_memberships(class_id,student_id,display_name) values(r.course_id,p_user_id,coalesce(r.student_label,'Student')) on conflict(class_id,student_id) do nothing;
  update public.student_access_codes set claimed_by=p_user_id,claimed_at=coalesce(claimed_at,now()) where id=r.access_id;
  return query select 'success',r.course_id,r.code,r.name,null::uuid,coalesce(r.student_label,'Student'),null::uuid; return;
 end if;
 if r.email_normalized is null then return query select 'roster_email_required',r.course_id,r.code,r.name,r.roster_id,r.display_name,null::uuid; return; end if;
 if r.email_normalized<>lower(btrim(p_email)) then return query select 'roster_email_mismatch',r.course_id,r.code,r.name,r.roster_id,r.display_name,null::uuid; return; end if;
 if (r.claimed_by is not null and r.claimed_by<>p_user_id) or (r.access_owner is not null and r.access_owner<>p_user_id) then
  return query select 'same_course_identity_conflict',r.course_id,r.code,r.name,r.roster_id,r.display_name,null::uuid; return;
 end if;
 enrolled:=public.enroll_student_by_email(p_user_id);
 if enrolled->>'status'='teacher_profile' then return query select 'teacher_profile',r.course_id,r.code,r.name,r.roster_id,r.display_name,null::uuid; return; end if;
 if not exists(select 1 from public.class_memberships cm where cm.class_id=r.course_id and cm.student_id=p_user_id and cm.roster_student_id=r.roster_id) then
  return query select 'same_course_identity_conflict',r.course_id,r.code,r.name,r.roster_id,r.display_name,null::uuid; return;
 end if;
 return query select 'success',r.course_id,r.code,r.name,r.roster_id,r.display_name,null::uuid;
end $$;
