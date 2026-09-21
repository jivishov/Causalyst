# Cycle 14: Student Login Identity Guard

## Goal

Prevent accidental same-course roster identity collisions while preserving legitimate multi-course joins in a single anonymous session.

## Current Starting State

- `POST /api/student/login` can allow the same anonymous UID to claim multiple PINs in the same course and overwrite `class_memberships.roster_student_id`.
- There is no explicit decision matrix contract for same-user re-login versus conflicting same-course claims.

## Read First

- `docs/implementation-status.md`
- `worker/src/routes/student.ts`
- `worker/test/roster.test.ts`
- `frontend/src/state/session.tsx`
- `frontend/src/pages/Login.tsx`
- `frontend/src/lib/api.ts`

## Design Decisions

- Apply a strict five-branch login matrix before mutating profile, membership, or claim state.
- Same-course identity conflicts are rejected as recoverable product errors, not generic 500 failures.
- Multi-course joins for the same anonymous session remain supported.
- No reset-device or sign-out CTA is introduced in this cycle.

## Implement

- In `POST /api/student/login`, evaluate the login matrix first:
  - Same anon UID + same PIN + same course: idempotent success.
  - Same anon UID + different PIN + same course: reject with `same_course_identity_conflict`.
  - Different anon UID + already claimed PIN: reject (existing claimed-PIN behavior).
  - Same anon UID + different course: allow join.
  - Same anon UID + unclaimed PIN + new course: allow first claim.
- Ensure conflict branches do not mutate:
  - `profiles`
  - `class_memberships`
  - `student_access_codes`
  - `roster_students`
- Add a student "Join another course" path using the existing login endpoint and current session.
- Add/extend worker tests for all five matrix branches.

## Acceptance Criteria

- Same-course conflicting claim is blocked and state-preserving.
- Multi-course join retains existing memberships and assignment visibility.
- Idempotent same-PIN re-login remains safe.
- Frontend can render specific handling for `same_course_identity_conflict`.

## Verification

Run:

```bash
npm run typecheck --workspaces --if-present
npm test --workspaces --if-present
```

## Status Ledger Update

Update `docs/implementation-status.md` with the Cycle 14 completion block. Include route behavior matrix, frontend join-course handling, tests, and handoff to Cycle 15 attempt-start hardening.
