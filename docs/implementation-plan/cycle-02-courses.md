# Cycle 2: Teacher-Owned Courses

## Goal

Let teachers create and manage multiple courses while keeping student course-code login.

## Current Starting State

- DB table is named `classes`; UI should call these records courses.
- `classes` has `code`, `name`, and nullable `teacher_id`.
- `classes.code` is globally unique.
- Student login looks up a class/course by code.
- Teacher auth foundation should already exist from Cycle 1.

## Read First

- `docs/implementation-status.md`
- Latest migration from Cycle 1
- `supabase/migrations/0001_init.sql`
- `worker/src/lib/db.ts`
- `worker/src/index.ts`
- `frontend/src/components/AppShell.tsx`

## Design Decisions

- UI says "course"; DB keeps `classes`.
- Course ownership is `classes.teacher_id`.
- Keep `classes.code` globally unique for v1.
- If a code is taken, UI must suggest a term suffix such as `BIO101-S26`.
- No cross-teacher course sharing in v1.

## Implement

- Add migration `0003_teacher_courses.sql`.
- Add `section`, `term`, `archived_at`, `updated_at`, and teacher/course indexes.
- Add teacher course routes: list, create, update, archive, unarchive.
- Enforce teacher ownership in Worker.
- Add teacher dashboard and course list UI.
- Surface duplicate course-code errors clearly with term-suffix guidance.
- Update status ledger with exact routes and schema.

## Acceptance Criteria

- Teacher can create multiple courses.
- Teacher cannot read, update, archive, or unarchive another teacher's course.
- Archived courses are hidden by default and not deleted.
- Duplicate course code returns a clear teacher-facing error.
- Existing student login by course code still works.
- Tests cover ownership and duplicate course-code conflicts.

## Verification

Run:

```bash
npm run typecheck --workspaces --if-present
npm test --workspaces --if-present
```

## Status Ledger Update

Update `docs/implementation-status.md` with the Cycle 2 completion block. Include course routes, migration columns/indexes, UI files, duplicate-code behavior, and next handoff for roster import.
