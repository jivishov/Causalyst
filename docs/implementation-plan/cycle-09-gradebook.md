# Cycle 9: Gradebook Finalization

## Goal

Create durable teacher-controlled final grades.

## Current Starting State

- Attempts store provisional AI score and feedback.
- No final gradebook table exists.
- Roster and assignment tables should already exist.
- Teacher response review should already exist from Cycle 8.

## Read First

- `docs/implementation-status.md`
- Latest roster and assignment migrations
- `worker/src/routes/teacher-attempts.ts`
- `shared/src/types.ts`

## Design Decisions

- Add `gradebook_entries` keyed by `(assignment_id, roster_student_id)`.
- Row generation is deterministic and idempotent.
- On roster commit or roster add, reconcile gradebook rows for active assignments in that course.
- On roster deactivate, keep rows but hide inactive students by default.
- On assignment creation or unarchive, reconcile rows for active roster students in that course.
- On assignment archive, keep rows but hide archived assignments by default.
- Add manual teacher "rebuild gradebook" action.
- Final grade precedence: teacher override, approved AI score, blank/missing.

## Implement

- Add `gradebook_entries` table.
- Add idempotent `reconcileGradebookForCourse` helper.
- Call reconciliation from roster commit/add/deactivate and assignment create/archive/unarchive.
- Add manual rebuild endpoint.
- Add gradebook list endpoint by course/assignment.
- Add endpoints to approve provisional score, override final score, mark missing, clear grade, publish/unpublish.
- Update attempt review UI with finalization controls.
- Add gradebook table UI with filters.

## Acceptance Criteria

- Every active roster student appears for every active assignment.
- Missing/unsubmitted students appear without fake attempts.
- Roster changes and assignment archive/unarchive reconcile correctly.
- Teacher override wins over AI score.
- Final grade does not change from later attempts unless teacher updates it.
- Manual rebuild is idempotent.
- Tests cover row generation, reconciliation call sites, precedence, missing state, archive visibility, and ownership.

## Verification

Run:

```bash
npm run typecheck --workspaces --if-present
npm test --workspaces --if-present
```

## Status Ledger Update

Update `docs/implementation-status.md` with the Cycle 9 completion block. Include gradebook schema, reconciliation triggers, final grade precedence, UI files, tests, and next handoff for grade export.
