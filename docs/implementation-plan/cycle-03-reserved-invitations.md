# Cycle 3: Reserved For Invitations

## Goal

Reserve this milestone number for teacher invitations while keeping invitations deferred post-v1.

## Current Starting State

- Teacher setup exists or is planned through Cycle 1.
- Course ownership is single-teacher for v1.
- No multi-teacher course sharing is in scope.

## Read First

- `docs/implementation-status.md`
- `docs/implementation-plan/global-contract.md`

## Design Decisions

- Multi-teacher invitations are useful but not required for a single-teacher installable v1.
- Do not implement invitation routes or tables before v1 unless the pilot explicitly requires multiple teachers.
- Keep this cycle file so future fresh sessions do not accidentally renumber the plan.

## Implement

- Do not implement runtime changes.
- Keep Cycle 3 marked as skipped/reserved in `docs/implementation-status.md`.
- If a future pilot requires invitations, create a new plan revision before implementing.

## Acceptance Criteria

- No runtime changes are made for Cycle 3.
- Status ledger clearly states invitations are deferred post-v1.
- Later cycle numbering remains stable.

## Verification

No code verification is required if no files change except the status ledger. If the status ledger is edited, no runtime tests are required.

## Status Ledger Update

Add or preserve a Cycle 3 reserved/skipped note in `docs/implementation-status.md` with no migrations, routes, shared types, frontend changes, or tests.
