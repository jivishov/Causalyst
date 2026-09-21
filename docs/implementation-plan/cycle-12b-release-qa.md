# Cycle 12B: Release Candidate QA

## Goal

Complete end-to-end validation and release handoff.

## Current Starting State

- All teacher-installable v1 feature cycles should be complete.
- Security/privacy hardening should be complete from Cycle 12A.
- Install and troubleshooting docs should exist.

## Read First

- `docs/implementation-status.md`
- `README.md`
- `docs/install.md`
- `docs/privacy.md`
- `docs/troubleshooting.md`

## Design Decisions

- Release QA is evidence-driven: document the exact manual happy path result in the status ledger.
- Demo-only compatibility paths should be removed or clearly labeled before v1.
- Deferred work must be explicit so future sessions do not expand v1 scope.

## Implement

- Fix RC blockers found in manual path.
- Remove or clearly label old demo-only compatibility paths.
- Update README and status ledger to mark v1 complete.
- Document deferred work.

## Acceptance Criteria

- Full test suite passes.
- Full build passes.
- `security:dist` passes.
- Manual happy path result is recorded in `docs/implementation-status.md`.
- README presents the project as teacher-installable v1.

## Verification

Run:

```bash
npm run typecheck --workspaces --if-present
npm test --workspaces --if-present
npm run build
npm run security:dist
```

Manual happy path:

- Teacher setup with `TEACHER_SETUP_CODE`.
- Course creation.
- Roster import and PIN issuance.
- Assessment creation.
- Assignment to course.
- Student login with course code and PIN.
- Voice submission.
- Writing submission.
- Simulation submission and sandbox preview.
- Teacher response review.
- Grade approval/override.
- Long and wide CSV export.

## Status Ledger Update

Update `docs/implementation-status.md` with the Cycle 12B completion block. Include verification commands, manual happy path result, release status, old compatibility paths, and deferred work.
