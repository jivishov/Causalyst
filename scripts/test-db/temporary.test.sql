begin;
set local search_path=explain_temporary,public,pg_temp;
insert into auth.users(id,email,email_confirmed_at) values
 ('a1000000-0000-4000-8000-000000000001','owner@example.test',now()),
 ('a1000000-0000-4000-8000-000000000002','colleague@example.test',now()),
 ('a1000000-0000-4000-8000-000000000003','other@example.test',now()),
 ('a1000000-0000-4000-8000-000000000004','unverified@example.test',null);
insert into auth.sessions(id,user_id) select id,id from auth.users where id::text like 'a1000000%';
insert into auth.sessions(id,user_id) values('a1000000-0000-4000-8000-000000000005','a1000000-0000-4000-8000-000000000001');
insert into profiles(id,role,display_name) values('a1000000-0000-4000-8000-000000000001','teacher','Synthetic owner');
insert into application_owner_grants(user_id) values('a1000000-0000-4000-8000-000000000001');
insert into teacher_access(email,teacher_id,actor_id) values('owner@example.test','a1000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001');
update temporary_settings set enabled=true,processing_enabled=true,enforce_admission=true;
create function pg_temp.check_error(q text,expected text) returns void language plpgsql as $$
begin
 begin execute q; exception when others then if sqlerrm=expected then return; end if;raise; end;
 raise exception 'Expected %, statement succeeded',expected;
end $$;
select temporary_command('admin_invite','a1000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001','{"email":"Colleague@example.test","active":true}');
select teacher_admission('a1000000-0000-4000-8000-000000000002','a1000000-0000-4000-8000-000000000002');
do $$ begin
 if (select role from profiles where id='a1000000-0000-4000-8000-000000000002')<>'teacher' then raise exception 'Invitation did not provision a teacher';end if;
end $$;
select pg_temp.check_error($q$select teacher_admission('a1000000-0000-4000-8000-000000000003','a1000000-0000-4000-8000-000000000003')$q$,'ACCESS_REVOKED');
select temporary_command('admin_invite','a1000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001','{"email":"unverified@example.test","active":true}');
select pg_temp.check_error($q$select teacher_admission('a1000000-0000-4000-8000-000000000004','a1000000-0000-4000-8000-000000000004')$q$,'ACCESS_REVOKED');
select pg_temp.check_error($q$select temporary_command('admin_list','a1000000-0000-4000-8000-000000000002','a1000000-0000-4000-8000-000000000002','{}')$q$,'ACCESS_REVOKED');
insert into assessments(id,type,title,prompt,rubric,config,created_by) values
 ('a2000000-0000-4000-8000-000000000001','simulation','Synthetic pressure test','Explain the relationships.','[]','{}','a1000000-0000-4000-8000-000000000001');

do $$
declare a jsonb; b jsonb; q jsonb; c jsonb; o jsonb; ctx jsonb; r jsonb; jobs jsonb; j jsonb; result jsonb;
 owner_id uuid:='a1000000-0000-4000-8000-000000000001'; colleague uuid:='a1000000-0000-4000-8000-000000000002';
 pubkey uuid:=gen_random_uuid(); submitkey uuid:=gen_random_uuid(); aid uuid; pid uuid:=gen_random_uuid(); p2 uuid:=gen_random_uuid(); rid uuid;
begin
 a:=temporary_command('publish',owner_id,'a1000000-0000-4000-8000-000000000001',jsonb_build_object('assessmentId','a2000000-0000-4000-8000-000000000001','hours',72,'closesAt',now()+interval '24 hours','key',pubkey,'sourceUpdatedAt',(select updated_at from assessments where id='a2000000-0000-4000-8000-000000000001')));
 aid:=(a->>'id')::uuid;
 b:=temporary_command('publish',owner_id,'a1000000-0000-4000-8000-000000000001',jsonb_build_object('assessmentId','a2000000-0000-4000-8000-000000000001','hours',72,'closesAt',now()+interval '24 hours','key',pubkey));
 if b->>'id'<>a->>'id' then raise exception 'Publish retry duplicated activity'; end if;
 perform pg_temp.check_error(format('select temporary_command(''detail'',%L,%L,%L)',colleague,colleague,jsonb_build_object('assignmentId',aid)),'NOT_FOUND');
 q:=temporary_command('stage',owner_id,'a1000000-0000-4000-8000-000000000001',jsonb_build_object('assignmentId',aid,'kind','question','bytes',100,'digest',repeat('a',64)));
 c:=temporary_command('stage',owner_id,'a1000000-0000-4000-8000-000000000001',jsonb_build_object('assignmentId',aid,'kind','context','bytes',100,'digest',repeat('a',64)));
 perform temporary_command('publish_commit',owner_id,'a1000000-0000-4000-8000-000000000001',jsonb_build_object('assignmentId',aid,'questionId',q->>'id','contextId',c->>'id'));
 perform temporary_command('participants',owner_id,'a1000000-0000-4000-8000-000000000001',jsonb_build_object('assignmentId',aid,'participants',jsonb_build_array(
 jsonb_build_object('id',pid,'code','P01-ABCD','tokenHash',repeat('b',64)),jsonb_build_object('id',p2,'code','P02-ABCD','tokenHash',repeat('c',64)))));
 perform temporary_command('exchange',null,null,jsonb_build_object('publicId',a->>'public_id','tokenHash',repeat('b',64),'sessionHash',repeat('d',64)));
 perform temporary_command('exchange',null,null,jsonb_build_object('publicId',a->>'public_id','tokenHash',repeat('c',64),'sessionHash',repeat('e',64)));
 perform pg_temp.check_error(format('select temporary_command(''guest'',null,%L,%L)',repeat('d',64),jsonb_build_object('publicId',gen_random_uuid())),'ACCESS_REVOKED');
 o:=temporary_command('stage',null,repeat('d',64),jsonb_build_object('kind','response','bytes',100,'digest',repeat('a',64)));
 ctx:=temporary_command('stage',null,repeat('d',64),jsonb_build_object('kind','context','bytes',100,'digest',repeat('a',64)));
 -- A second participant cannot attach the first participant's staged text.
 perform pg_temp.check_error(format('select temporary_command(''submit'',null,%L,%L)',repeat('e',64),jsonb_build_object('objectId',o->>'id','contextId',ctx->>'id','key',gen_random_uuid(),'expectedVersion',0)),'VALIDATION_FAILED');
 r:=temporary_command('submit',null,repeat('d',64),jsonb_build_object('objectId',o->>'id','contextId',ctx->>'id','key',submitkey,'expectedVersion',0));rid:=(r->>'id')::uuid;
 b:=temporary_command('submit',null,repeat('d',64),jsonb_build_object('key',submitkey,'expectedVersion',0));
 if b->>'id'<>r->>'id' then raise exception 'Submit retry duplicated evidence'; end if;
 jobs:=temporary_command('claim',owner_id,'a1000000-0000-4000-8000-000000000001',jsonb_build_object('assignmentId',aid,'key',gen_random_uuid(),'limit',1));j:=jobs->'jobs'->0;
 b:=temporary_command('claim',owner_id,'a1000000-0000-4000-8000-000000000005',jsonb_build_object('assignmentId',aid,'key',gen_random_uuid(),'limit',1));
 if jsonb_array_length(b->'jobs')<>0 then raise exception 'Two clients claimed one reservation'; end if;
 perform pg_temp.check_error(format('select temporary_command(''renew'',%L,%L,%L)',owner_id,'a1000000-0000-4000-8000-000000000005',jsonb_build_object('assignmentId',aid,'responseId',rid,'jobId',j->>'id','fence',j->>'fence')),'LEASE_EXPIRED');
 o:=temporary_command('stage',owner_id,'a1000000-0000-4000-8000-000000000001',jsonb_build_object('assignmentId',aid,'kind','simulation','bytes',100,'digest',repeat('f',64)));
 result:=temporary_command('result',owner_id,'a1000000-0000-4000-8000-000000000001',jsonb_build_object('assignmentId',aid,'responseId',rid,'jobId',j->>'id','fence',j->>'fence','objectId',o->>'id','digest',repeat('f',64),'identity',repeat('a',64)));
 b:=temporary_command('result',owner_id,'a1000000-0000-4000-8000-000000000001',jsonb_build_object('assignmentId',aid,'responseId',rid,'jobId',j->>'id','fence',j->>'fence','identity',repeat('a',64)));
 if b->>'artifactId'<>result->>'artifactId' then raise exception 'Result retry duplicated artifact'; end if;
 perform pg_temp.check_error(format('select temporary_command(''result'',%L,%L,%L)',owner_id,'a1000000-0000-4000-8000-000000000001',jsonb_build_object('assignmentId',aid,'responseId',rid,'jobId',j->>'id','fence',j->>'fence','identity',repeat('b',64))),'REVISION_CONFLICT');
 -- Closing submissions preserves review and pending processing access.
 update temporary_assignments set published_at=now()-interval '2 hours',closes_at=now()-interval '1 hour' where id=aid;
 perform temporary_command('evidence',owner_id,'a1000000-0000-4000-8000-000000000001',jsonb_build_object('assignmentId',aid,'responseId',rid));
 perform pg_temp.check_error(format('select temporary_command(''draft'',null,%L,%L)',repeat('d',64),jsonb_build_object('expectedVersion',1)),'ASSIGNMENT_CLOSED');
 -- Reissue invalidates old cookies without touching submitted work.
 perform temporary_command('reissue',owner_id,'a1000000-0000-4000-8000-000000000001',jsonb_build_object('assignmentId',aid,'participantId',pid,'tokenHash',repeat('f',64)));
 perform pg_temp.check_error(format('select temporary_command(''guest'',null,%L,''{}'')',repeat('d',64)),'ACCESS_REVOKED');
 if not exists(select 1 from response_revisions where id=rid) then raise exception 'Reissue destroyed evidence'; end if;
 update temporary_assignments set published_at=now()-interval '4 days',closes_at=now()-interval '3 days',expires_at=now()-interval '1 day' where id=aid;
 perform pg_temp.check_error(format('select temporary_command(''evidence'',%L,%L,%L)',owner_id,'a1000000-0000-4000-8000-000000000001',jsonb_build_object('assignmentId',aid,'responseId',rid)),'ASSIGNMENT_EXPIRED');
 -- Even an identical previously successful result is denied after expiry.
 perform pg_temp.check_error(format('select temporary_command(''result'',%L,%L,%L)',owner_id,'a1000000-0000-4000-8000-000000000001',jsonb_build_object('assignmentId',aid,'responseId',rid,'jobId',j->>'id','fence',j->>'fence','identity',repeat('a',64))),'ASSIGNMENT_EXPIRED');
 b:=temporary_command('cleanup_list',null,null,'{}');
 if jsonb_array_length(b->'objects')<4 then raise exception 'Finalized content was not scheduled for deletion'; end if;
 perform temporary_command('cleanup_failed',null,null,jsonb_build_object('objectId',o->>'id'));
 if not exists(select 1 from temporary_objects where id=(o->>'id')::uuid and failures=1) then raise exception 'Cleanup failure discarded inventory'; end if;
 -- Objects remain inventoried until the external Storage API has succeeded.
 for q in select to_jsonb(t) from temporary_objects t where assignment_id=aid loop
  perform temporary_command('cleanup_deleted',null,null,jsonb_build_object('objectId',q->>'id'));
 end loop;
 perform temporary_command('cleanup_finish',null,null,'{}');
 if exists(select 1 from temporary_assignments where id=aid) then raise exception 'Expired metadata retained after successful cleanup'; end if;
end $$;
select temporary_command('admin_invite','a1000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001','{"email":"colleague@example.test","active":false}');
select pg_temp.check_error($q$select temporary_command('capabilities','a1000000-0000-4000-8000-000000000002','a1000000-0000-4000-8000-000000000002','{}')$q$,'ACCESS_REVOKED');
do $$ begin
 if teacher_admitted('a1000000-0000-4000-8000-000000000002') then raise exception 'Revocation bypassed by direct policies';end if;
 if has_table_privilege('authenticated','explain_temporary.temporary_objects','select') or has_function_privilege('authenticated','temporary_command(text,uuid,text,jsonb)','execute') then raise exception 'Temporary service exposed to browser roles';end if;
end $$;
rollback;
