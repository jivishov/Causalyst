# Cycle 5: Assignment-Scoped Attempts

## Goal

Make `assessment_assignments` the durable unit for attempts, review, gradebook, and exports.

## Current Starting State

- `attempts` currently references `assessment_id` directly.
- `assessment_assignments` links assessments to classes/courses.
- Student dashboard currently lists assigned assessments, not assignment records.
- Existing RLS policy for attempt insert joins on `assessment_id`.

## Read First

- `docs/implementation-status.md`
- `supabase/migrations/0001_init.sql`
- `worker/src/routes/attempts.ts`
- `worker/src/routes/student.ts`
- `worker/src/lib/db.ts`
- `frontend/src/pages/Dashboard.tsx`
- `frontend/src/pages/AssessmentPage.tsx`

## Design Decisions

- New attempts require `assignment_id`.
- Existing attempts may remain legacy if backfill is ambiguous.
- Do not infer assignment for old attempts when one assessment is assigned to multiple courses.
- Keep `attempts.assessment_id` temporarily for compatibility, but derive it from assignment for new attempts.
- Worker remains the writer for attempts in v1.

## Implement

- Add `assignment_id` to `attempts`.
- Backfill only unambiguous existing attempts.
- Leave ambiguous old attempts with `assignment_id = null` and treat them as legacy.
- Update `attempts` RLS to avoid stale `assessment_id` assumptions.
- Prefer dropping the direct client insert policy and documenting that Worker is the only v1 attempt writer.
- Keep select policy simple and student-owned, unless assignment visibility requires additional restrictions.
- Update `/api/student/me` to return course-grouped assignment summaries.
- Update `/api/attempts/start` to accept `assignmentId`.
- Update student dashboard and assessment page routing to use assignments.
- Preserve current grading routes by loading assessment through the attempt's assignment.

## Acceptance Criteria

- Same assessment assigned to two courses creates separate assignments and separate attempts.
- Student can only start attempts for assignments in their course memberships.
- Legacy demo attempts do not break result loading.
- Voice, writing, and simulation flows still work.
- Tests cover assignment access, multi-course reuse, legacy null assignment handling, and RLS/policy intent.

## Verification

Run:

```bash
npm run typecheck --workspaces --if-present
npm test --workspaces --if-present
```

## Status Ledger Update

Update `docs/implementation-status.md` with the Cycle 5 completion block. Include migration/backfill behavior, legacy attempt handling, RLS stance, route changes, and next handoff for assessment builder.
