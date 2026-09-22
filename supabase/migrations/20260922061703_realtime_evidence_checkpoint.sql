-- Persist sealed provider evidence before a grading request can fail or time out.
create function public.claim_realtime_submission(p_user_id uuid,p_session_id uuid,p_transcript text)
returns void language plpgsql security invoker set search_path='' as $$
declare s public.attempt_realtime_sessions; result text;
begin
 select * into s from public.attempt_realtime_sessions where id=p_session_id and student_id=p_user_id;
 if not found then raise exception 'Session unavailable' using errcode='23514'; end if;
 perform 1 from public.attempts where id=s.attempt_id and student_id=p_user_id for update;
 select * into s from public.attempt_realtime_sessions where id=p_session_id for update;
 if s.status<>'active' or s.expires_at is null or now()>s.expires_at+interval '2 minutes'
    or p_transcript is null or btrim(p_transcript)='' then
  raise exception 'Session cannot submit' using errcode='23514';
 end if;
 select claim_status into result from public.claim_attempt_submission(p_user_id,s.attempt_id,now(),'{}');
 if result<>'success' then raise exception 'Attempt cannot submit' using errcode='23514'; end if;
 update public.attempts set transcript=p_transcript,updated_at=now() where id=s.attempt_id;
 update public.attempt_realtime_sessions set status='finalizing',finalized_transcript=p_transcript,updated_at=now() where id=s.id;
end $$;
revoke all on function public.claim_realtime_submission(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.claim_realtime_submission(uuid,uuid,text) to service_role;

create function public.save_realtime_grade(p_user_id uuid,p_session_id uuid,p_transcript text,p_feedback jsonb,p_diagnostics jsonb,p_metadata jsonb)
returns void language plpgsql security invoker set search_path='' as $$
declare s public.attempt_realtime_sessions; t public.attempts;
begin
 select * into s from public.attempt_realtime_sessions where id=p_session_id and student_id=p_user_id;
 if not found then raise exception 'Session unavailable' using errcode='23514'; end if;
 select * into t from public.attempts where id=s.attempt_id and student_id=p_user_id for update;
 select * into s from public.attempt_realtime_sessions where id=p_session_id for update;
 if s.status='finalized' then return; end if;
 if s.status<>'finalizing' or t.status<>'submitted' or p_transcript is distinct from t.transcript then raise exception 'Session cannot finalize' using errcode='23514'; end if;
 update public.attempts set status='graded',transcript=p_transcript,provisional_score=(p_feedback->>'score')::numeric,
  provisional_feedback=p_feedback,grading_metadata=p_metadata,updated_at=now() where id=t.id;
 update public.attempt_realtime_sessions set status='finalized',ended_at=now(),updated_at=now(),continuity_diagnostics=p_diagnostics,
  finalized_attempt_id=t.id,finalized_transcript=p_transcript,finalized_score=(p_feedback->>'score')::numeric,
  finalized_feedback=p_feedback,finalized_at=now(),finalize_error=null where id=s.id;
end $$;
revoke all on function public.save_realtime_grade(uuid,uuid,text,jsonb,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.save_realtime_grade(uuid,uuid,text,jsonb,jsonb,jsonb) to service_role;
