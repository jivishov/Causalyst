# Fresh-Session Implementation Plan

This directory is the implementation contract for building the teacher-installable v1 of Alt Assessment across fresh-memory LLM sessions.

Every fresh session should read:

1. `docs/implementation-plan/global-contract.md`
2. `docs/implementation-status.md`
3. The current cycle file
4. Only the files named in that cycle's `Read First` section

Do not broad-scan the repo unless the status ledger contradicts a named file. Each cycle must update `docs/implementation-status.md` before finishing.

## Milestone Order

- Cycle 0: Status ledger, README pointer, verification script check.
- Cycle 1: Teacher setup/auth, `TEACHER_SETUP_CODE`, hardened `PIN_PEPPER`, `/api/teacher/*` foundation.
- Cycle 2: Teacher-owned courses, global course-code uniqueness, duplicate-code UI guidance.
- Cycle 3: Reserved/skipped invitations, explicitly deferred post-v1.
- Cycle 4: Roster import, course-scoped identity, one-time PIN issuance.
- Cycle 5: Assignment-scoped attempts, legacy handling, RLS cleanup.
- Cycle 6: Assessment builder and assignment CRUD, partial active unique index for assignments.
- Cycle 7: Simulation HTML stored as `simulation-derived` artifact, student preview route update.
- Cycle 8: Teacher response review and Worker-mediated artifact preview/download.
- Cycle 9: Gradebook entries, idempotent reconciliation, final grade precedence.
- Cycle 10: Long/wide CSV export and `grade_exports` audit.
- Cycle 11: Install, privacy, troubleshooting, Worker deploy workflow.
- Cycle 12A: Security/privacy hardening and `security:dist` expansion.
- Cycle 12B: Release-candidate happy path and final docs/status update.
- Cycle 13: Student contracts and structured lifecycle error plumbing.
- Cycle 14: Student login identity guard and safe multi-course joins.
- Cycle 15: Attempt start precedence, draft unique index, and publish gate tightening.
- Cycle 16: Shared submission claim flow and server-side late tracking.
- Cycle 17: Student published final-grade visibility and simulation result preview recovery.
- Cycle 18: Server-side writing/simulation config enforcement with aligned defaults.
- Cycle 19: Student dashboard lifecycle UX plus release QA and docs updates.

## Operating Rule

Each cycle file is intentionally self-contained. Do not rely on memory from previous sessions; rely on `docs/implementation-status.md` and the cycle file.
