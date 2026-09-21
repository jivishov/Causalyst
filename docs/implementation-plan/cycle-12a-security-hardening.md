# Cycle 12A: Security And Privacy Hardening

## Goal

Validate authorization and sensitive-data boundaries before release.

## Current Starting State

- Teacher setup, courses, roster, assignments, simulation artifacts, review, gradebook, exports, and docs should exist.
- `scripts/check-dist-secrets.mjs` already scans built frontend assets for sensitive patterns.
- Teacher route files should be listed in `docs/implementation-status.md`.

## Read First

- `docs/implementation-status.md`
- `scripts/check-dist-secrets.mjs`
- All route files listed in the status ledger as teacher routes

## Design Decisions

- The Worker is the primary authorization layer for teacher access.
- Frontend-visible responses must not include backend-only identifiers or raw provider data.
- Opaque public IDs are allowed when needed for UI actions.
- Do not blanket-ban opaque public IDs such as `roster_student_id` unless the implementation replaces them with separate public IDs.

## Implement

- Audit every teacher route for 401, 403, and ownership checks.
- Audit every frontend-visible response for forbidden fields.
- Expand `security:dist` patterns for `pin_hash`, `openai_file_id`, `storage_key`, `raw_response`, service-role JWT-looking values, OpenAI keys, Supabase service-role variable names, storage path patterns, and local Windows paths.
- Do not blanket-ban opaque public IDs such as `roster_student_id` unless the implementation replaces them with separate public IDs.
- Ensure errors do not leak SQL details, storage paths, OpenAI file IDs, or local paths.
- Confirm cleanup behavior for stale artifacts and OpenAI file handles, or document exact limitation if cleanup is deferred.

## Acceptance Criteria

- Route tests cover cross-teacher denial for core teacher resources.
- Frontend dist scan passes.
- Status ledger lists remaining privacy limitations, if any.
- Build and tests pass.

## Verification

Run:

```bash
npm run typecheck --workspaces --if-present
npm test --workspaces --if-present
npm run build
npm run security:dist
```

## Status Ledger Update

Update `docs/implementation-status.md` with the Cycle 12A completion block. Include route audit scope, security scan pattern changes, known limitations, cleanup status, and next handoff for release QA.
