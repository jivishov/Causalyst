-- All assessment/grading access goes through the ownership-checked Worker.
-- RLS filters rows; it cannot hide expected_answer from a permitted row.
revoke all privileges on public.assessments from anon, authenticated;
revoke all privileges on public.attempts from anon, authenticated;
-- Explicit grants make the Worker independent of project default grants.
grant all privileges on public.assessments, public.attempts to service_role;
