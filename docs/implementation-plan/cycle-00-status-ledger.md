# Cycle 0: Status Ledger And Guardrails

## Goal

Create the durable handoff document for all future fresh sessions.

## Current Starting State

- The repo currently has README and implementation notes, but no durable status ledger.
- The current app is student-facing only.
- No teacher routes or teacher UI exist.
- This cycle should not change runtime behavior.

## Read First

- `README.md`
- `docs/implementation-notes.md`
- `supabase/migrations/0001_init.sql`
- `package.json`

## Design Decisions

- `docs/implementation-status.md` is the single durable handoff for fresh-memory sessions.
- README should only receive a minimal pointer in this cycle.
- Full README restructuring belongs to Cycle 11.
- Cycle 3 is reserved/skipped because teacher invitations are deferred post-v1.

## Implement

- Create `docs/implementation-status.md`.
- Document current architecture, existing routes, existing schema, privacy boundary, and known gaps.
- Add the full milestone sequence and mark Cycle 3 as reserved/skipped because multi-teacher invitations are deferred post-v1.
- Add a feature matrix for student app, teacher setup, courses, roster, assignments, simulation artifact storage, review, gradebook, export, install docs, hardening, release QA.
- Add a single pointer line in README linking to the status ledger.
- Do not restructure README in this cycle.
- Confirm `npm test --workspaces --if-present` and `npm run typecheck --workspaces --if-present` run non-trivial workspace checks; if not, wire missing scripts minimally.

## Acceptance Criteria

- A fresh session can understand status from `docs/implementation-status.md`.
- README points to the ledger.
- Typecheck and tests pass.
- Cycle 0 completion block exists.

## Verification

Run:

```bash
npm run typecheck --workspaces --if-present
npm test --workspaces --if-present
```

## Status Ledger Update

Add a Cycle 0 completion block to `docs/implementation-status.md` with:

- DB migrations added: none.
- Worker routes added/changed: none.
- Shared types added/changed: none.
- Frontend pages/components added/changed: none.
- Tests added: none unless script wiring was needed.
- Verification commands run: exact commands and results.
- Known limitations: teacher implementation not started; Cycle 3 reserved/skipped.
- Next cycle handoff: Cycle 1 should start teacher setup/auth foundation.
