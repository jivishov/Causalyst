# Cycle 15: Attempt Start, Draft Index, And Publish Gate

## Goal

Make attempt start idempotent and concurrency-safe, and ensure published final-grade semantics are coherent for student blocking logic.

## Current Starting State

- `POST /api/attempts/start` always inserts a new draft.
- No partial unique draft index exists for `(student_id, assignment_id)`.
- Duplicate legacy drafts may already exist.
- Teacher publish can currently mark `published_at` without requiring a final state, which can create blank-published gradebook entries.

## Read First

- `docs/implementation-status.md`
- `worker/src/routes/attempts.ts`
- `worker/src/lib/db.ts`
- `worker/src/routes/teacherGradebook.ts`
- `worker/test/assignmentAttempts.test.ts`
- `worker/test/teacherGradebook.test.ts`
- `supabase/migrations/0005_assignment_scoped_attempts.sql`
- `supabase/migrations/0007_gradebook.sql`

## Design Decisions

- Attempt-start behavior follows first-match-wins precedence.
- One active draft per `(student, assignment)` is enforced at DB level.
- Retry-after-error is allowed only when no submitted/graded/final state exists for that pair.
- Publishing requires an actual final state; blank-publish is rejected with `final_required`.
- `due_at_snapshot` is audit-only and never drives late enforcement.

## Implement

- Add migration `supabase/migrations/0009_student_lifecycle.sql` with this order:
  1. Add `attempts.due_at_snapshot timestamptz` (nullable, audit-only).
  2. Add `attempts.submitted_after_due boolean not null default false`.
  3. Normalize duplicate drafts:
     - Group by `(student_id, assignment_id)` where `status='draft'`.
     - Keep newest by `created_at desc, id desc`.
     - Transition older drafts to `status='error'`.
     - Insert one `attempt_audit_logs` row per transitioned attempt with:
       - `route='migration:0009_draft_normalization'`
       - `provider='system'`
       - `model='none'`
       - `request_summary.reason='duplicate_draft_collapsed'`
       - `request_summary.kept_attempt_id`
  4. Add partial unique index:
     - `unique (student_id, assignment_id) where status='draft' and assignment_id is not null`.
- Update `POST /api/attempts/start` precedence:
  - Valid published final grade exists: block `final_published` with nullable `attemptId`.
  - Any submitted or graded attempt exists: block `already_submitted` with existing `attemptId`.
  - Draft exists: return existing draft id.
  - Latest is `error` and no submitted/graded/final exists: create retry draft.
  - No attempts: create draft.
- Set `due_at_snapshot` when creating draft attempts.
- If resuming a draft with null `due_at_snapshot`, populate from current assignment `due_at`.
- Tighten `setTeacherGradebookPublished(..., true)`:
  - Reject when `approved_score`, `teacher_override_score`, and `missing` are all unset.
  - Return structured `final_required`.
  - Keep re-publish on already-published valid entries as no-op.
- Keep unpublish as visibility-only; it must not reopen attempts.

## Acceptance Criteria

- Concurrent start calls cannot create duplicate drafts.
- Published final blocks start even when the published final is `missing`.
- Submitted/graded states block start with deterministic error code.
- Blank publish is rejected with `final_required`.
- Legacy `assignment_id = null` rows do not violate the draft unique index.

## Verification

Run:

```bash
npm run typecheck --workspaces --if-present
npm test --workspaces --if-present
```

## Status Ledger Update

Update `docs/implementation-status.md` with the Cycle 15 completion block. Include migration details, attempt-start precedence, publish-gate behavior, tests, and handoff to Cycle 16 submission-claim work.
