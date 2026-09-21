# Cycle 13: Student Contracts And Structured Errors

## Goal

Add shared student lifecycle contracts and structured error plumbing with minimal runtime behavior change.

## Current Starting State

- Student API responses expose course-grouped assignments but no durable assignment state, due state, final-grade summary, simulation preview metadata, or structured frontend error codes.
- Worker errors are primarily message/status oriented; frontend API parsing does not consistently preserve route-defined machine-readable error codes.

## Read First

- `docs/implementation-status.md`
- `shared/src/types.ts`
- `worker/src/lib/http.ts`
- `frontend/src/lib/api.ts`
- `frontend/test/loginResponse.test.ts`

## Design Decisions

- Structured error codes are part of the shared contract, not ad-hoc route strings.
- Existing unstructured error behavior remains backward-compatible.
- Structured error details must remain privacy-safe and follow global redaction boundaries.

## Implement

- Add shared student lifecycle types:
  - `StudentAssignmentState`
  - `StudentDueState`
  - `StudentAttemptSummary`
  - `StudentPublishedGrade`
  - `StudentSimulationPreview`
- Add shared structured error-code union for student lifecycle flows:
  - `same_course_identity_conflict`
  - `already_submitted`
  - `final_published`
  - `final_required`
- Extend Worker HTTP error serialization so routes can intentionally return `{ error, code, details }` while preserving current message/status behavior.
- Extend frontend API error parsing so `ApiRequestError` carries optional `code` and safe `details` from Worker responses.
- Keep sensitive-field redaction guarantees intact for structured responses.

## Acceptance Criteria

- Existing student login/session tests continue passing.
- Existing unstructured route errors remain compatible.
- Frontend API layer can reliably distinguish lifecycle error codes without string-matching full messages.

## Verification

Run:

```bash
npm run typecheck --workspaces --if-present
npm test --workspaces --if-present
```

## Status Ledger Update

Update `docs/implementation-status.md` with the Cycle 13 completion block. Include shared types added, Worker/frontend error-contract changes, tests added, and handoff to Cycle 14 identity guard work.
