# Cycle 18: Server-Side Config Enforcement

## Goal

Enforce reliable assessment constraints in Worker-controlled paths instead of relying on frontend-only checks.

## Current Starting State

- Writing MIME acceptance logic exists in frontend upload policy.
- Writing size and MIME are not fully guaranteed server-side before upload.
- Simulation minimum description length is frontend-only and can drift from teacher-configured values.
- Voice duration has no trusted server-side parser.

## Read First

- `docs/implementation-status.md`
- `worker/src/routes/artifacts.ts`
- `worker/src/routes/simulation.ts`
- `worker/src/routes/teacherAssessments.ts`
- `frontend/src/lib/uploadPolicy.ts`
- `frontend/src/pages/AssessmentPage.tsx`
- `worker/test/simulationArtifacts.test.ts`

## Design Decisions

- Reliable input enforcement belongs in Worker routes where possible.
- Writing validation happens at artifact reservation time, before upload token issuance.
- Simulation minimum length enforcement uses assessment config with shared default.
- Voice duration remains frontend-only and is explicitly documented as a known limitation.

## Implement

- In artifact reservation (`kind='writing'`):
  - Load attempt/assessment context.
  - Validate MIME against `assessment.config.acceptedMime ?? ["image/png","image/jpeg","application/pdf"]`.
  - Validate `byteSize` against `assessment.config.maxBytes ?? 10485760`.
  - Reject invalid requests before issuing upload token.
- In simulation submission:
  - Validate `description.trim().length >= assessment.config.minDescriptionChars ?? 40` before claim/finalization.
- Align frontend writing/simulation defaults with Worker defaults to prevent UX mismatch.
- Keep voice duration frontend-only; no server-side duration parser is added in this cycle.

## Acceptance Criteria

- Invalid writing MIME/size cannot reserve upload tokens.
- Too-short simulation descriptions fail server-side before attempt submission is claimed.
- Frontend defaults are consistent with Worker defaults for writing and simulation constraints.
- Voice duration limitation is explicitly recorded.

## Verification

Run:

```bash
npm run typecheck --workspaces --if-present
npm test --workspaces --if-present
```

## Status Ledger Update

Update `docs/implementation-status.md` with the Cycle 18 completion block. Include server-side validation changes, frontend default alignment, known limitations update, tests, and handoff to Cycle 19 UX + release QA.
