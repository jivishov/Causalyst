-- Sole mutation authority. Only the Worker service role can execute this RPC.
-- Every content acceptance rechecks authorization, server deadlines and fencing.
create function public.temporary_command(p_op text,p_actor uuid,p_connection text,p_input jsonb)
returns jsonb language plpgsql security invoker set search_path=explain_temporary,public,pg_temp as $$
declare a temporary_assignments%rowtype; p guest_participants%rowtype; o temporary_objects%rowtype;
 j external_generation_jobs%rowtype; r response_revisions%rowtype; g temporary_grade_revisions%rowtype;
 s temporary_settings%rowtype; x jsonb; result jsonb; aid uuid; oid uuid; n integer; total integer; email_value text;
begin
 if p_op='publish' then perform pg_advisory_xact_lock(hashtextextended(p_actor::text,0)); end if;
 if p_actor is not null then
  if p_connection is null then raise exception 'ACCESS_REVOKED'; end if;
  perform public.teacher_admission(p_actor,p_connection::uuid);
 end if;
 select * into s from temporary_settings where singleton;
 if p_op like 'admin_%' then
  if not exists(select 1 from application_owner_grants where user_id=p_actor)
    or not exists(select 1 from teacher_access where teacher_id=p_actor and active) then raise exception 'ACCESS_REVOKED'; end if;
  if p_op='admin_list' then return jsonb_build_object('invitations',coalesce((select jsonb_agg(jsonb_build_object('email',email,'active',active,'redeemed',teacher_id is not null)) from teacher_access),'[]'::jsonb),'settings',jsonb_build_object('enabled',s.enabled,'processing_enabled',s.processing_enabled,'enforce_admission',s.enforce_admission,'max_hours',s.max_hours,'max_participants',s.max_participants,'max_revisions',s.max_revisions,'max_bytes',s.max_bytes,'max_jobs',s.max_jobs),'cleanupFailures',(select count(*) from temporary_objects where failures>=3)+(select count(*) from cleanup_work where failures>=3)); end if;
  if p_op='admin_invite' then
   email_value:=lower(trim(p_input->>'email'));
   if email_value is null or length(email_value)>254 or email_value !~ '^[^ @]+@[^ @]+\.[^ @]+$' then raise exception 'VALIDATION_FAILED'; end if;
   if coalesce((p_input->>'active')::boolean,false)=false and exists(select 1 from teacher_access t join application_owner_grants ow on ow.user_id=t.teacher_id where email=email_value) then raise exception 'ACCESS_REVOKED'; end if;
   insert into teacher_access(email,active,actor_id) values(email_value,(p_input->>'active')::boolean,p_actor)
   on conflict(email) do update set active=excluded.active,actor_id=p_actor,revoked_at=case when excluded.active then null else now() end;
  elsif p_op='admin_settings' then
   if (p_input->>'enabled')::boolean and not (p_input->>'enforceAdmission')::boolean then raise exception 'VALIDATION_FAILED'; end if;
   if (p_input->>'enforceAdmission')::boolean and exists(select 1 from profiles q where role='teacher' and not exists(select 1 from teacher_access t where t.teacher_id=q.id)) then raise exception 'VALIDATION_FAILED'; end if;
   update temporary_settings set enabled=(p_input->>'enabled')::boolean,processing_enabled=(p_input->>'processingEnabled')::boolean,
    enforce_admission=(p_input->>'enforceAdmission')::boolean,max_hours=(p_input->>'maxHours')::integer where singleton;
  else raise exception 'VALIDATION_FAILED'; end if;
  return jsonb_build_object('saved',true);
 end if;
 if p_op like 'cleanup_%' then
  if p_op='cleanup_integrity' then select * into o from temporary_objects where id=(p_input->>'objectId')::uuid and assignment_id=(p_input->>'assignmentId')::uuid and committed;
   if not found then raise exception 'NOT_FOUND'; end if;return jsonb_build_object('digest',o.digest,'bytes',o.bytes);
  elsif p_op='cleanup_cursor' then return jsonb_build_object('offset',s.sweep_root_offset,'prefix',s.sweep_prefix,'objectOffset',s.sweep_object_offset);
  elsif p_op='cleanup_cursor_set' then
   update temporary_settings set sweep_root_offset=(p_input->>'offset')::integer,sweep_prefix=p_input->>'prefix',sweep_object_offset=(p_input->>'objectOffset')::integer where singleton;
  elsif p_op='cleanup_probe' then
   return jsonb_build_object('ids',coalesce((select jsonb_agg(id) from temporary_objects where assignment_id=(p_input->>'assignmentId')::uuid and id::text in (select jsonb_array_elements_text(p_input->'ids'))),'[]'::jsonb));
  elsif p_op='cleanup_orphan' then
   if p_input->>'path' !~ '^[a-f0-9-]{36}/[a-f0-9-]{36}\.json$' then raise exception 'VALIDATION_FAILED'; end if;
   insert into cleanup_work(object_path) values(p_input->>'path') on conflict do nothing;
  elsif p_op='cleanup_orphans' then return jsonb_build_object('objects',coalesce((select jsonb_agg(object_path) from (select object_path from cleanup_work where retry_at<=now() order by created_at limit 50) q),'[]'::jsonb));
  elsif p_op='cleanup_orphan_deleted' then delete from cleanup_work where object_path=p_input->>'path';
  elsif p_op='cleanup_orphan_failed' then update cleanup_work set failures=failures+1,retry_at=now()+make_interval(secs=>least(3600,30*power(2,least(failures,7)))::integer) where object_path=p_input->>'path';
  elsif p_op='cleanup_list' then
   -- Stages become garbage after 30 minutes, even when their assignment lives on.
   return jsonb_build_object('objects',coalesce((select jsonb_agg(to_jsonb(q)) from
    (select ob.id,ob.assignment_id from temporary_objects ob join temporary_assignments ta on ta.id=ob.assignment_id
     where (ob.delete_after<=now() or ta.expires_at<=clock_timestamp() or ta.revoked or (not ob.committed and ob.created_at<clock_timestamp()-interval '30 minutes'))
     and ob.retry_at<=now() order by ob.delete_after limit 200) q),'[]'::jsonb));
  elsif p_op='cleanup_failed' then
   update temporary_objects set failures=failures+1,retry_at=now()+make_interval(secs=>least(3600,30*power(2,least(failures,7)))::integer) where id=(p_input->>'objectId')::uuid;
  elsif p_op='cleanup_deleted' then
   select * into o from temporary_objects where id=(p_input->>'objectId')::uuid for update;
   if found then
    -- References are removed only after the Storage API confirms deletion.
    update temporary_assignments set snapshot_id=null where snapshot_id=o.id;
    update temporary_assignments set context_id=null where context_id=o.id;
    update guest_participants set draft_id=null where draft_id=o.id;
    delete from temporary_grade_revisions where object_id=o.id or artifact_id=o.id;
    delete from external_generation_jobs where artifact_id=o.id or context_id=o.id;
    delete from response_revisions where response_id=o.id;
    delete from temporary_objects where id=o.id;
    update temporary_assignments set used_bytes=greatest(0,used_bytes-o.bytes) where id=o.assignment_id;
   end if;
  elsif p_op='cleanup_finish' then
   delete from temporary_assignments ta where (expires_at<=clock_timestamp() or revoked or (snapshot_id is null and published_at<now()-interval '1 hour'))
    and not exists(select 1 from temporary_objects ob where ob.assignment_id=ta.id);
   delete from guest_sessions where expires_at<=clock_timestamp();
  else raise exception 'VALIDATION_FAILED'; end if;
  return '{}'::jsonb;
 end if;
 if p_actor is not null then
  perform 1 from teacher_access where teacher_id=p_actor and active for share;
  if not found then raise exception 'ACCESS_REVOKED'; end if;
  if p_op='capabilities' then return jsonb_build_object('enabled',s.enabled,'processingEnabled',s.processing_enabled,'maxHours',s.max_hours,'participantLimit',s.max_participants,'revisionLimit',s.max_revisions,'storedByteLimit',s.max_bytes,'activeJobLimit',s.max_jobs,'owner',exists(select 1 from application_owner_grants where user_id=p_actor)); end if;
  if p_op='list' then return jsonb_build_object('assignments',coalesce((select jsonb_agg(to_jsonb(q)) from
    (select id,public_id,assessment_id,published_at,closes_at,expires_at from temporary_assignments where teacher_id=p_actor and snapshot_id is not null and not revoked and expires_at>clock_timestamp() order by published_at desc limit 100) q),'[]'::jsonb)); end if;
  if p_op='publish' then
   if not s.enabled then raise exception 'ACCESS_REVOKED'; end if;
   select * into a from temporary_assignments where teacher_id=p_actor and publish_key=(p_input->>'key')::uuid for update;
   if found then
    if a.expires_at<=clock_timestamp() then raise exception 'ASSIGNMENT_EXPIRED'; end if;
    if a.assessment_id<>(p_input->>'assessmentId')::uuid then raise exception 'REVISION_CONFLICT'; end if;
    return to_jsonb(a);
   end if;
   if (select count(*) from temporary_assignments where teacher_id=p_actor and expires_at>clock_timestamp())>=10 then raise exception 'QUOTA_EXCEEDED'; end if;
   n:=(p_input->>'hours')::integer;
   if n not in (24,48,72) or n>s.max_hours then raise exception 'VALIDATION_FAILED'; end if;
   perform 1 from assessments where id=(p_input->>'assessmentId')::uuid and created_by=p_actor and type='simulation' and updated_at=(p_input->>'sourceUpdatedAt')::timestamptz for share;
   if not found then raise exception 'REVISION_CONFLICT'; end if;
   insert into temporary_assignments(teacher_id,assessment_id,source_updated_at,publish_key,closes_at,expires_at)
   values(p_actor,(p_input->>'assessmentId')::uuid,(p_input->>'sourceUpdatedAt')::timestamptz,(p_input->>'key')::uuid,
    (p_input->>'closesAt')::timestamptz,now()+make_interval(hours=>n)) returning * into a;
   return to_jsonb(a);
  end if;
 end if;
 if p_op='exchange' then
  select t.* into a from temporary_assignments t where public_id=(p_input->>'publicId')::uuid for update;
 else
  if p_actor is null then
   select gp.* into p from guest_sessions gs join guest_participants gp on gp.id=gs.participant_id
    where gs.credential_hash=p_connection and gs.expires_at>clock_timestamp() and gs.token_version=gp.token_version;
   if not found then raise exception 'ACCESS_REVOKED'; end if;
   aid:=p.assignment_id;
  else aid:=(p_input->>'assignmentId')::uuid; end if;
  select * into a from temporary_assignments where id=aid for update;
 end if;
 if a.id is null or (p_actor is not null and a.teacher_id<>p_actor) then raise exception 'NOT_FOUND'; end if;
 if p_actor is null and p_op<>'exchange' then
  select gp.* into p from guest_sessions gs join guest_participants gp on gp.id=gs.participant_id
   where gs.credential_hash=p_connection and gs.expires_at>clock_timestamp() and gs.token_version=gp.token_version for share of gs,gp;
  if not found then raise exception 'ACCESS_REVOKED'; end if;
 end if;
 if a.expires_at<=clock_timestamp() or a.revoked then raise exception 'ASSIGNMENT_EXPIRED'; end if;
 if p_actor is null and p_input ? 'publicId' and a.public_id<>(p_input->>'publicId')::uuid then raise exception 'ACCESS_REVOKED'; end if;
 if p_actor is null and a.snapshot_id is null then raise exception 'NOT_FOUND'; end if;
 if p_op='exchange' then
  select * into p from guest_participants where assignment_id=a.id and token_hash=p_input->>'tokenHash' for update;
  if not found then raise exception 'ACCESS_REVOKED'; end if;
  -- Limit replay/session flooding; each capability may have up to five sessions.
  if (select count(*) from guest_sessions where participant_id=p.id and expires_at>clock_timestamp())>=5 then raise exception 'RATE_LIMITED'; end if;
  insert into guest_sessions(credential_hash,participant_id,token_version,expires_at) values(p_input->>'sessionHash',p.id,p.token_version,a.expires_at);
  return jsonb_build_object('expiresAt',a.expires_at);
 end if;
 if p_op='stage' then
  n:=(p_input->>'bytes')::integer;
  if n<1 or n>750000 or a.used_bytes+n>s.max_bytes then raise exception 'QUOTA_EXCEEDED'; end if;
  if p_actor is null then select * into p from guest_participants where id=p.id for update; end if;
  if p_actor is null and (a.closes_at<=clock_timestamp() or p_input->>'kind' not in ('draft','response','context')) then raise exception 'ASSIGNMENT_CLOSED'; end if;
  if p_actor is null and p_input->>'kind'<>'context' and p.last_save_at>now()-interval '1 second' then raise exception 'RATE_LIMITED'; end if;
  insert into temporary_objects(assignment_id,participant_id,kind,bytes,digest,delete_after)
   values(a.id,case when p_actor is null then p.id else null end,p_input->>'kind',n,p_input->>'digest',a.expires_at) returning * into o;
  update temporary_assignments set used_bytes=used_bytes+n where id=a.id;
  if p_actor is null and p_input->>'kind'<>'context' then update guest_participants set last_save_at=now() where id=p.id; end if;
  return to_jsonb(o);
 end if;
 if p_actor is not null and p_op='publish_commit' then
  if a.snapshot_id is not null then return to_jsonb(a); end if;
  if (select count(*) from temporary_objects where assignment_id=a.id and ((id=(p_input->>'questionId')::uuid and kind='question') or (id=(p_input->>'contextId')::uuid and kind='context')) and not committed and created_at>clock_timestamp()-interval '30 minutes')<>2 then raise exception 'VALIDATION_FAILED'; end if;
  update temporary_objects set committed=true where id in ((p_input->>'questionId')::uuid,(p_input->>'contextId')::uuid);
  update temporary_assignments set snapshot_id=(p_input->>'questionId')::uuid,context_id=(p_input->>'contextId')::uuid where id=a.id returning * into a;
  return to_jsonb(a);
 end if;
 if p_actor is not null and p_op='participants' then
  if not s.enabled or a.closes_at<=clock_timestamp() then raise exception 'ASSIGNMENT_CLOSED'; end if;
  n:=jsonb_array_length(p_input->'participants');
  if n<1 or n+(select count(*) from guest_participants where assignment_id=a.id)>s.max_participants then raise exception 'QUOTA_EXCEEDED'; end if;
  for x in select * from jsonb_array_elements(p_input->'participants') loop
   if x->>'code' !~ '^P[0-9]{2,3}-[A-Z0-9]{4}$' then raise exception 'VALIDATION_FAILED'; end if;
   insert into guest_participants(id,assignment_id,code,token_hash) values((x->>'id')::uuid,a.id,x->>'code',x->>'tokenHash');
  end loop;
  return jsonb_build_object('created',n);
 end if;
 if p_actor is not null and p_op='reissue' then
  update guest_participants set token_hash=p_input->>'tokenHash',token_version=token_version+1
   where id=(p_input->>'participantId')::uuid and assignment_id=a.id returning * into p;
  if not found then raise exception 'NOT_FOUND'; end if;
  delete from guest_sessions where participant_id=p.id;
  return jsonb_build_object('id',p.id,'code',p.code);
 end if;
 if p_actor is not null and p_op='revoke' then update temporary_assignments set revoked=true where id=a.id; return '{}'::jsonb; end if;
 if p_op='guest' then
  select * into r from response_revisions where participant_id=p.id order by revision desc limit 1;
  select * into j from external_generation_jobs where response_id=r.id;
  return jsonb_build_object('assignment',to_jsonb(a),'participant',jsonb_build_object('id',p.id,'code',p.code,'draft_id',p.draft_id,'draft_version',p.draft_version),
   'response',to_jsonb(r),'job',to_jsonb(j)||jsonb_build_object('status',case when j.status='processing' and (j.lease_until is null or j.lease_until<=clock_timestamp()) then case when j.attempts>=3 then 'failed' else 'queued' end else j.status end));
 end if;
 if p_actor is null and p_op in ('draft','submit') then
  if a.closes_at<=clock_timestamp() then raise exception 'ASSIGNMENT_CLOSED'; end if;
  select * into p from guest_participants where id=p.id for update;
  if p_op='submit' then
   select * into r from response_revisions where participant_id=p.id and submit_key=(p_input->>'key')::uuid;
   if found then return to_jsonb(r); end if;
  end if;
  if p.draft_version<>(p_input->>'expectedVersion')::integer then raise exception 'REVISION_CONFLICT'; end if;
  select * into o from temporary_objects where id=(p_input->>'objectId')::uuid and assignment_id=a.id and not committed
   and participant_id=p.id and created_at>clock_timestamp()-interval '30 minutes' and kind=case when p_op='draft' then 'draft' else 'response' end;
  if not found then raise exception 'VALIDATION_FAILED'; end if;
  if p_op='draft' then
   update temporary_objects set delete_after=now() where id=p.draft_id;
   update guest_participants set draft_id=o.id,draft_version=draft_version+1 where id=p.id;
   update temporary_objects set committed=true where id=o.id;
   return jsonb_build_object('version',p.draft_version+1);
  end if;
  select count(*) into n from response_revisions where participant_id=p.id;
  if n>=s.max_revisions or (select count(*) from external_generation_jobs where assignment_id=a.id)>=s.max_jobs then raise exception 'QUOTA_EXCEEDED'; end if;
  insert into response_revisions(assignment_id,participant_id,revision,response_id,submit_key)
   values(a.id,p.id,n+1,o.id,(p_input->>'key')::uuid) returning * into r;
  update temporary_objects set committed=true where id=o.id;
  update temporary_objects set delete_after=now() where id=p.draft_id;
  update guest_participants set draft_id=null,draft_version=draft_version+1 where id=p.id;
  perform 1 from temporary_objects where id=(p_input->>'contextId')::uuid and assignment_id=a.id and participant_id=p.id and kind='context' and not committed and created_at>clock_timestamp()-interval '30 minutes';
  if not found then raise exception 'VALIDATION_FAILED'; end if;
  update temporary_objects set committed=true where id=(p_input->>'contextId')::uuid;
  insert into external_generation_jobs(assignment_id,participant_id,response_id,context_id) values(a.id,p.id,r.id,(p_input->>'contextId')::uuid);
  return to_jsonb(r);
 end if;
 if p_actor is null then raise exception 'ACCESS_REVOKED'; end if;
 if p_op='draft_evidence' then
  select * into p from guest_participants where id=(p_input->>'participantId')::uuid and assignment_id=a.id;
  if not found or p.draft_id is null then raise exception 'NOT_FOUND'; end if;
  if p.draft_version<>(p_input->>'draftVersion')::integer then raise exception 'REVISION_CONFLICT'; end if;
  return jsonb_build_object('assignment',to_jsonb(a),'objectId',p.draft_id,'participantId',p.id,'code',p.code,'draftVersion',p.draft_version);
 end if;
 if p_op='retry' then
  if not s.processing_enabled then raise exception 'ACCESS_REVOKED'; end if;
  update external_generation_jobs set status='queued',attempts=0,generation_version=generation_version+1,fence=fence+1,connection=null,run_key=null,lease_until=null
   where assignment_id=a.id and response_id=(p_input->>'responseId')::uuid and (status='failed' or (status='processing' and lease_until<=clock_timestamp() and attempts>=3)) and generation_version<3;
  if not found then raise exception 'REVISION_CONFLICT'; end if;
  return jsonb_build_object('queued',true);
 end if;
 if p_op='detail' then
  return jsonb_build_object('assignment',to_jsonb(a),'participants',coalesce((select jsonb_agg(jsonb_build_object('id',id,'code',code,'hasDraft',draft_id is not null,'draftVersion',draft_version)) from guest_participants where assignment_id=a.id),'[]'::jsonb),
  'revisions',coalesce((select jsonb_agg(jsonb_build_object('id',rr.id,'participantId',rr.participant_id,'code',gp.code,'revision',rr.revision,'submittedAt',rr.submitted_at,'status',case when jj.status='processing' and (jj.lease_until is null or jj.lease_until<=clock_timestamp()) then case when jj.attempts>=3 then 'failed' else 'queued' end else jj.status end,'artifactId',jj.artifact_id,
   'gradeId',(select gg.id from temporary_grade_revisions gg where gg.response_id=rr.id order by revision desc limit 1),'gradeVersion',(select count(*) from temporary_grade_revisions gg where gg.response_id=rr.id))) from response_revisions rr join guest_participants gp on gp.id=rr.participant_id join external_generation_jobs jj on jj.response_id=rr.id where rr.assignment_id=a.id),'[]'::jsonb));
 end if;
 if p_op='claim' then
  if not s.processing_enabled or p_connection is null then raise exception 'ACCESS_REVOKED'; end if;
  -- Idempotent retries return the same run's unexpired leases.
  select jsonb_agg(to_jsonb(q)) into result from (select * from external_generation_jobs where assignment_id=a.id and connection=p_connection and run_key=(p_input->>'key')::uuid and status='processing' and lease_until>clock_timestamp()) q;
  if result is not null then return jsonb_build_object('jobs',result,'assignment',to_jsonb(a)); end if;
  n:=least(3,greatest(1,coalesce((p_input->>'limit')::integer,1)));
  if (select count(*) from external_generation_jobs where assignment_id=a.id and connection=p_connection and status='processing' and lease_until>clock_timestamp())+n>3 then raise exception 'QUOTA_EXCEEDED'; end if;
  update external_generation_jobs set status='failed' where assignment_id=a.id and attempts>=3 and status='processing' and lease_until<=clock_timestamp();
  with selected as (select id from external_generation_jobs where assignment_id=a.id and attempts<3 and
   (status='queued' or (status='processing' and lease_until<=clock_timestamp())) order by created_at for update skip locked limit n),
  claimed as (update external_generation_jobs q set status='processing',connection=p_connection,run_key=(p_input->>'key')::uuid,
   fence=fence+1,attempts=attempts+1,lease_until=least(a.expires_at,clock_timestamp()+interval '15 minutes') from selected where q.id=selected.id returning q.*)
  select jsonb_agg(to_jsonb(claimed)) into result from claimed;
  return jsonb_build_object('jobs',coalesce(result,'[]'::jsonb),'assignment',to_jsonb(a));
 end if;
 if p_op in ('renew','release','result','grade','evidence') then
  select * into r from response_revisions where id=(p_input->>'responseId')::uuid and assignment_id=a.id;
  if not found then raise exception 'NOT_FOUND'; end if;
  select * into j from external_generation_jobs where response_id=r.id for update;
  if p_op in ('renew','release','result') then
   if j.id<>(p_input->>'jobId')::uuid or j.connection is distinct from p_connection or j.fence<>(p_input->>'fence')::integer then raise exception 'LEASE_EXPIRED'; end if;
   if p_op='result' and j.status='ready' then
    if j.result_digest is distinct from p_input->>'identity' then raise exception 'REVISION_CONFLICT'; end if;
    return jsonb_build_object('artifactId',j.artifact_id,'saved',true);
   end if;
   if not s.processing_enabled or j.status<>'processing' or j.lease_until<=clock_timestamp() then raise exception 'LEASE_EXPIRED'; end if;
   if p_op='renew' then update external_generation_jobs set lease_until=least(a.expires_at,clock_timestamp()+interval '15 minutes') where id=j.id; return jsonb_build_object('renewed',true); end if;
   if p_op='release' then update external_generation_jobs set status=case when attempts>=3 then 'failed' else 'queued' end,connection=null,lease_until=null where id=j.id; return jsonb_build_object('released',true); end if;
   select * into o from temporary_objects where id=(p_input->>'objectId')::uuid and assignment_id=a.id and kind='simulation' and digest=p_input->>'digest' and not committed and created_at>clock_timestamp()-interval '30 minutes';
   if not found then raise exception 'VALIDATION_FAILED'; end if;
   update temporary_objects set committed=true where id=o.id;
   update external_generation_jobs set status='ready',artifact_id=o.id,result_digest=p_input->>'identity' where id=j.id;
   return jsonb_build_object('saved',true,'artifactId',o.id);
  end if;
  if p_op='grade' then
   select * into g from temporary_grade_revisions where response_id=r.id and grade_key=(p_input->>'key')::uuid;
   if found then return jsonb_build_object('gradeId',g.id); end if;
   if j.artifact_id is distinct from nullif(p_input->>'artifactId','')::uuid then raise exception 'REVISION_CONFLICT'; end if;
   select count(*) into n from temporary_grade_revisions where response_id=r.id;
   if n<>coalesce((p_input->>'expectedGradeVersion')::integer,0) then raise exception 'REVISION_CONFLICT'; end if;
   if n>=20 then raise exception 'QUOTA_EXCEEDED'; end if;
   select * into o from temporary_objects where id=(p_input->>'objectId')::uuid and assignment_id=a.id and kind='grade' and not committed and created_at>clock_timestamp()-interval '30 minutes';
   if not found then raise exception 'VALIDATION_FAILED'; end if;
   update temporary_objects set committed=true where id=o.id;
   insert into temporary_grade_revisions(assignment_id,participant_id,response_id,artifact_id,object_id,grade_key,revision)
    values(a.id,r.participant_id,r.id,j.artifact_id,o.id,(p_input->>'key')::uuid,n+1) returning * into g;
   return jsonb_build_object('gradeId',g.id);
  end if;
  if p_op='evidence' then
   if p_input ? 'artifactId' then
    if nullif(p_input->>'artifactId','')::uuid is not null and j.artifact_id is distinct from (p_input->>'artifactId')::uuid then raise exception 'REVISION_CONFLICT'; end if;
   end if;
   select * into p from guest_participants where id=r.participant_id;
   if p_input ? 'gradeId' then select * into g from temporary_grade_revisions where id=nullif(p_input->>'gradeId','')::uuid and response_id=r.id;
   else select * into g from temporary_grade_revisions where response_id=r.id order by revision desc limit 1; end if;
   if nullif(p_input->>'gradeId','') is not null and g.id is null then raise exception 'NOT_FOUND'; end if;
   return jsonb_build_object('assignment',to_jsonb(a),'response',to_jsonb(r),'job',to_jsonb(j)||jsonb_build_object('status',case when j.status='processing' and (j.lease_until is null or j.lease_until<=clock_timestamp()) then case when j.attempts>=3 then 'failed' else 'queued' end else j.status end),'grade',to_jsonb(g),'code',p.code);
  end if;
 end if;
 raise exception 'VALIDATION_FAILED';
end $$;
revoke all on function public.temporary_command(text,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.temporary_command(text,uuid,text,jsonb) to service_role;
