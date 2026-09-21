# Cycle 16: Submission Claim And Late Tracking

## Goal

Centralize submission claiming and late computation so voice, writing, and simulation submission flows cannot drift.

## Current Starting State

- Submission state updates are route-local and duplicated across `voice.ts`, `writing.ts`, and `simulation.ts`.
- No shared claim-before-provider helper exists.
- Late-status fields exist after Cycle 15 migration, but route behavior is not yet consolidated.

## Read First

- `docs/implementation-status.md`
- `worker/src/routes/voice.ts`
- `worker/src/routes/writing.ts`
- `worker/src/routes/simulation.ts`
- `worker/src/routes/attempts.ts`
- `worker/src/lib/db.ts`
- `worker/test/assignmentAttempts.test.ts`
- `worker/test/simulationArtifacts.test.ts`

## Design Decisions

- Submission is a two-phase lifecycle:
  - Claim submission before provider work.
  - Complete route-specific grading/generation after provider work.
- Late evaluation uses current assignment `due_at` at claim time.
- `due_at_snapshot` remains audit-only context from draft creation.
- Route-specific audit payloads remain in route handlers, not in shared lifecycle helper.

## Implement

- Add `worker/src/lib/attemptLifecycle.ts` with `claimAttemptSubmission(db, userId, attemptId, now)`.
- `claimAttemptSubmission` must:
  - Atomically enforce `status='draft' -> status='submitted'`.
  - Reject non-draft attempts.
  - Reject archived assignments.
  - Compute `submitted_after_due` using current `assessment_assignments.due_at`.
  - Set `submitted_at` at claim time.
  - Return assignment/attempt context required by callers.
  - Not call `logAudit`.
- Update submission routes:
  - `voice.ts`: claim first, provider work second, update to `graded` on success, update to `error` on provider failure.
  - `writing.ts`: claim first, provider work second, update to `graded` on success, update to `error` on provider failure.
  - `simulation.ts`: claim first, generation second, keep `submitted` on success, update to `error` on generation failure.
- Keep existing route-specific audit calls; ensure they still fire with appropriate provider metadata.

## Acceptance Criteria

- Submit-before-deadline remains on-time even if provider runtime crosses deadline.
- Deadline extensions made before submit are honored.
- Archived assignments cannot be finalized from stale drafts.
- Double-submit races do not trigger duplicate provider work.
- Provider failures transition attempts to `error`, enabling Cycle 15 retry semantics.

## Verification

Run:

```bash
npm run typecheck --workspaces --if-present
npm test --workspaces --if-present
```

## Status Ledger Update

Update `docs/implementation-status.md` with the Cycle 16 completion block. Include helper scope, route integrations, late computation semantics, tests, and handoff to Cycle 17 student final-grade/result recovery.
