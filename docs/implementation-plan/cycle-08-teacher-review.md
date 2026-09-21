# Cycle 8: Teacher Response Review

## Goal

Give teachers response review for submitted attempts and provisional AI outputs.

## Current Starting State

- Students can submit and view their own result.
- Teacher routes for attempts do not exist.
- Artifact preview/download is student-oriented or internal only.
- Raw provider responses must remain server-side.

## Read First

- `docs/implementation-status.md`
- Latest simulation artifact changes
- `worker/src/routes/attempts.ts`
- `worker/src/routes/artifacts.ts`
- `frontend/src/pages/AttemptResultPage.tsx`
- `frontend/src/components/RubricFeedback.tsx`

## Design Decisions

- Teacher review shows evidence and provisional feedback.
- Raw provider responses remain server-side.
- Artifact preview/download always goes through Worker ownership checks.

## Implement

- Add teacher attempt list endpoint filtered by course, assignment, student, status.
- Add teacher attempt detail endpoint.
- Add teacher artifact preview/download endpoint.
- Add response list UI and attempt review UI.
- Show transcript, OCR text, simulation preview, provisional score, review flags, and teacher notes placeholder.

## Acceptance Criteria

- Teacher can list and open attempts from owned courses.
- Cross-teacher access returns 403.
- Evidence preview/download does not expose storage keys.
- Student result page still works.
- Tests cover ownership, artifact mediation, and response detail shape.

## Verification

Run:

```bash
npm run typecheck --workspaces --if-present
npm test --workspaces --if-present
```

## Status Ledger Update

Update `docs/implementation-status.md` with the Cycle 8 completion block. Include teacher attempt routes, artifact mediation behavior, frontend review pages, tests, and next handoff for gradebook finalization.
