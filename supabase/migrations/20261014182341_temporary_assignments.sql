-- Additive and disabled until explicit operator bootstrap. No inferred owner.
create schema explain_temporary;
revoke all on schema explain_temporary from public,anon,authenticated;
grant usage on schema explain_temporary to service_role;
create table explain_temporary.application_owner_grants (
 user_id uuid primary key references auth.users(id), created_at timestamptz not null default now()
);
create table explain_temporary.teacher_access (
 email text primary key check(email=lower(trim(email))), teacher_id uuid unique references auth.users(id),
 active boolean not null default true, actor_id uuid not null references auth.users(id),
 invited_at timestamptz not null default now(), redeemed_at timestamptz, revoked_at timestamptz
);
create table explain_temporary.temporary_settings (
 singleton boolean primary key default true check(singleton), enforce_admission boolean not null default false,
 enabled boolean not null default false, processing_enabled boolean not null default false,
 max_hours integer not null default 72 check(max_hours between 24 and 72),
 max_participants integer not null default 40 check(max_participants between 1 and 100),
 max_revisions integer not null default 6 check(max_revisions between 1 and 20),
 max_bytes bigint not null default 40000000 check(max_bytes between 1000000 and 100000000),
 max_jobs integer not null default 240 check(max_jobs between 1 and 2000),
 sweep_root_offset integer not null default 0, sweep_prefix text, sweep_object_offset integer not null default 0
);
insert into explain_temporary.temporary_settings(singleton) values(true);

create table explain_temporary.temporary_assignments (
 id uuid primary key default gen_random_uuid(), public_id uuid not null unique default gen_random_uuid(),
 teacher_id uuid not null references auth.users(id), assessment_id uuid not null references public.assessments(id),
 source_updated_at timestamptz not null, snapshot_id uuid, context_id uuid,
 publish_key uuid not null, published_at timestamptz not null default now(), closes_at timestamptz not null,
 expires_at timestamptz not null, revoked boolean not null default false, used_bytes bigint not null default 0,
 check(published_at < closes_at and closes_at < expires_at), unique(teacher_id,publish_key)
);
create table explain_temporary.temporary_objects (
 id uuid primary key default gen_random_uuid(), assignment_id uuid not null references explain_temporary.temporary_assignments(id),
 kind text not null check(kind in ('question','context','draft','response','simulation','grade')),
 bytes integer not null check(bytes between 1 and 750000), digest text not null check(digest ~ '^[a-f0-9]{64}$'),
 committed boolean not null default false, created_at timestamptz not null default now(),
 delete_after timestamptz not null, retry_at timestamptz not null default now(), failures integer not null default 0,
 unique(assignment_id,id)
);
alter table explain_temporary.temporary_assignments add foreign key(id,snapshot_id) references explain_temporary.temporary_objects(assignment_id,id) deferrable initially deferred;
alter table explain_temporary.temporary_assignments add foreign key(id,context_id) references explain_temporary.temporary_objects(assignment_id,id) deferrable initially deferred;
create table explain_temporary.guest_participants (
 id uuid primary key default gen_random_uuid(), assignment_id uuid not null references explain_temporary.temporary_assignments(id) on delete cascade,
 code text not null, token_hash text not null unique check(token_hash ~ '^[a-f0-9]{64}$'), token_version integer not null default 1,
 draft_id uuid, draft_version integer not null default 0, last_save_at timestamptz,
 foreign key(assignment_id,draft_id) references explain_temporary.temporary_objects(assignment_id,id),
 unique(assignment_id,id), unique(assignment_id,code)
);
create table explain_temporary.guest_sessions (
 credential_hash text primary key, participant_id uuid not null references explain_temporary.guest_participants(id) on delete cascade,
 token_version integer not null, expires_at timestamptz not null, created_at timestamptz not null default now()
);
alter table explain_temporary.temporary_objects add column participant_id uuid;
alter table explain_temporary.temporary_objects add foreign key(assignment_id,participant_id) references explain_temporary.guest_participants(assignment_id,id);
create table explain_temporary.response_revisions (
 id uuid primary key default gen_random_uuid(), assignment_id uuid not null, participant_id uuid not null,
 revision integer not null, response_id uuid not null, submit_key uuid not null, submitted_at timestamptz not null default now(),
 foreign key(assignment_id,participant_id) references explain_temporary.guest_participants(assignment_id,id) on delete cascade,
 foreign key(assignment_id,response_id) references explain_temporary.temporary_objects(assignment_id,id),
 unique(assignment_id,participant_id,id), unique(participant_id,revision), unique(participant_id,submit_key)
);
create table explain_temporary.external_generation_jobs (
 id uuid primary key default gen_random_uuid(), assignment_id uuid not null, participant_id uuid not null, response_id uuid not null unique,
 context_id uuid not null, execution_mode text not null default 'teacher_client' check(execution_mode='teacher_client'),
 status text not null default 'queued' check(status in ('queued','processing','ready','failed')),
 connection text, run_key uuid, fence integer not null default 0, lease_until timestamptz, attempts integer not null default 0,
 generation_version integer not null default 1 check(generation_version between 1 and 3),
 artifact_id uuid, result_digest text, created_at timestamptz not null default now(),
 foreign key(assignment_id,participant_id,response_id) references explain_temporary.response_revisions(assignment_id,participant_id,id) on delete cascade,
 foreign key(assignment_id,context_id) references explain_temporary.temporary_objects(assignment_id,id),
 foreign key(assignment_id,artifact_id) references explain_temporary.temporary_objects(assignment_id,id)
);
create table explain_temporary.temporary_grade_revisions (
 id uuid primary key default gen_random_uuid(), assignment_id uuid not null, participant_id uuid not null, response_id uuid not null,
 artifact_id uuid, object_id uuid not null, grade_key uuid not null, revision integer not null, created_at timestamptz not null default now(),
 foreign key(assignment_id,participant_id,response_id) references explain_temporary.response_revisions(assignment_id,participant_id,id) on delete cascade,
 foreign key(assignment_id,artifact_id) references explain_temporary.temporary_objects(assignment_id,id),
 foreign key(assignment_id,object_id) references explain_temporary.temporary_objects(assignment_id,id),
 unique(response_id,revision), unique(response_id,grade_key)
);
create index temporary_expiry on explain_temporary.temporary_assignments(expires_at);
create index temporary_teacher on explain_temporary.temporary_assignments(teacher_id,published_at);
create index temporary_objects_cleanup on explain_temporary.temporary_objects(delete_after,retry_at);
create index temporary_jobs_claim on explain_temporary.external_generation_jobs(assignment_id,status,lease_until,created_at);
create index guest_session_participant on explain_temporary.guest_sessions(participant_id);
create table explain_temporary.cleanup_work (
 object_path text primary key, failures integer not null default 0, retry_at timestamptz not null default now(),
 created_at timestamptz not null default now()
);

-- Nothing in this mode is directly accessible from a browser JWT or Data API.
do $$ declare t text; begin
 foreach t in array array['application_owner_grants','teacher_access','temporary_settings','temporary_assignments',
 'temporary_objects','guest_participants','guest_sessions','response_revisions','external_generation_jobs','temporary_grade_revisions','cleanup_work'] loop
  execute format('alter table explain_temporary.%I enable row level security',t);
  execute format('revoke all on explain_temporary.%I from public,anon,authenticated',t);
  execute format('grant all on explain_temporary.%I to service_role',t);
 end loop;
end $$;
insert into storage.buckets(id,name,public) values('temporary-evidence','temporary-evidence',false);
create policy temporary_bucket_is_private on storage.objects as restrictive for all to anon,authenticated
 using(bucket_id <> 'temporary-evidence') with check(bucket_id <> 'temporary-evidence');

-- Live grant restriction also applies to legacy direct database/storage routes.
create function public.teacher_admitted(p_user uuid) returns boolean language sql stable security definer set search_path='' as $$
 select not exists(select 1 from explain_temporary.teacher_access where teacher_id=p_user and not active)
 and (not (select enforce_admission from explain_temporary.temporary_settings where singleton)
 or not exists(select 1 from public.profiles where id=p_user and role='teacher')
 or exists(select 1 from explain_temporary.teacher_access where teacher_id=p_user and active))
$$;
revoke all on function public.teacher_admitted(uuid) from public,anon;
grant execute on function public.teacher_admitted(uuid) to authenticated,service_role;
do $$ declare r record; begin
 for r in select tablename from pg_tables where schemaname='public' and rowsecurity loop
  if r.tablename not in ('application_owner_grants','teacher_access','temporary_settings','temporary_assignments','temporary_objects',
  'guest_participants','guest_sessions','response_revisions','external_generation_jobs','temporary_grade_revisions') then
   execute format('create policy teacher_access_live on public.%I as restrictive for all to authenticated using(public.teacher_admitted((select auth.uid()))) with check(public.teacher_admitted((select auth.uid())))',r.tablename);
  end if;
 end loop;
end $$;
create policy teacher_access_live on storage.objects as restrictive for all to authenticated
 using(public.teacher_admitted((select auth.uid()))) with check(public.teacher_admitted((select auth.uid())));

create function public.teacher_admission(p_user uuid,p_session uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare u auth.users%rowtype; g explain_temporary.teacher_access%rowtype; begin
 select * into u from auth.users where id=p_user and email_confirmed_at is not null and not coalesce(is_anonymous,false);
 if not found then raise exception 'ACCESS_REVOKED'; end if;
 perform 1 from auth.sessions where id=p_session and user_id=p_user and (not_after is null or not_after>clock_timestamp()) for share;
 if not found then
  raise exception 'ACCESS_REVOKED'; end if;
 select * into g from explain_temporary.teacher_access where teacher_id=p_user or email=lower(trim(u.email)) order by (teacher_id=p_user) desc nulls last limit 1 for update;
 if found then
  if not g.active or (g.teacher_id is not null and g.teacher_id<>p_user) then raise exception 'ACCESS_REVOKED'; end if;
  if g.teacher_id is null then
   update explain_temporary.teacher_access set teacher_id=p_user,redeemed_at=now() where email=g.email;
   insert into public.profiles(id,role,display_name) values(p_user,'teacher','Teacher')
   on conflict(id) do update set role='teacher',updated_at=now();
  end if;
 elsif not public.teacher_admitted(p_user) or (select enforce_admission from explain_temporary.temporary_settings where singleton) then raise exception 'ACCESS_REVOKED';
 end if;
 return jsonb_build_object('owner',exists(select 1 from explain_temporary.application_owner_grants where user_id=p_user));
end $$;
revoke all on function public.teacher_admission(uuid,uuid) from public,anon,authenticated;
grant execute on function public.teacher_admission(uuid,uuid) to service_role;
