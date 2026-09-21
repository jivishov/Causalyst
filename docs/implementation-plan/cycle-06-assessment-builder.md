# Cycle 6: Teacher Assessment Builder And Assignment Management

## Goal

Let teachers create assessments and assign them to courses.

## Current Starting State

- Seed SQL creates demo assessments.
- No teacher UI/API creates assessments or assignments.
- `assessment_assignments` has a global unique constraint on `(assessment_id, class_id)`.
- Assignment-scoped attempts should already exist from Cycle 5.

## Read First

- `docs/implementation-status.md`
- Latest assignment migration
- `worker/src/lib/db.ts`
- `shared/src/types.ts`
- `frontend/src/lib/api.ts`
- `supabase/migrations/0001_init.sql`

## Design Decisions

- Assessments are owned by one teacher.
- No teacher assessment sharing in v1.
- Assignments are course-wide, not per-student.
- Rubrics remain JSON arrays of criteria.
- Archived assignments should not block reassigning the same assessment to the same course.

## Implement

- Add `archived_at` and `updated_at` to `assessment_assignments` if not already present.
- Drop existing `unique (assessment_id, class_id)` constraint.
- Add partial unique index for active assignments: unique `(assessment_id, class_id)` where `archived_at is null`.
- Ensure teacher-created assessments require `created_by`.
- Add assessment CRUD: title, type, prompt, expected answer, rubric, config, archive.
- Add assignment CRUD: assessment, course, `opens_at`, `due_at`, archive.
- Add rubric editor.
- Add type-specific config fields for voice, writing, and simulation.
- Add teacher UI for assessment library and assignment editor.

## Acceptance Criteria

- Teacher can create voice, writing, and simulation assessments.
- Teacher can assign one assessment to multiple owned courses.
- Teacher can archive an assignment and later create a new active assignment for the same assessment/course.
- Student dashboard shows assigned/open assignments.
- Teacher cannot assign another teacher's assessment.
- Tests cover ownership, validation, assignment dates, archive/reassign behavior, and visibility.

## Verification

Run:

```bash
npm run typecheck --workspaces --if-present
npm test --workspaces --if-present
```

## Status Ledger Update

Update `docs/implementation-status.md` with the Cycle 6 completion block. Include assessment/assignment routes, partial unique index behavior, UI files, tests, and next handoff for simulation artifact storage.
