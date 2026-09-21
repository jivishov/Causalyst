# Cycle 17: Published Final Grades And Simulation Result Recovery

## Goal

Expose student-safe published final grades and make simulation attempt result previews reloadable through Worker-signed metadata.

## Current Starting State

- Teacher publish/unpublish exists.
- Student APIs do not consistently expose published final-grade summaries.
- Simulation result pages do not have a durable re-sign-on-fetch preview contract.

## Read First

- `docs/implementation-status.md`
- `worker/src/routes/student.ts`
- `worker/src/routes/attempts.ts`
- `worker/src/routes/artifacts.ts`
- `worker/src/routes/teacherGradebook.ts`
- `worker/src/lib/crypto.ts`
- `frontend/src/pages/AttemptResultPage.tsx`
- `frontend/src/components/RubricFeedback.tsx`

## Design Decisions

- Student-visible final-grade data is available only when `published_at` is non-null.
- Valid published final status set is total and student-safe:
  - `approved_ai`
  - `teacher_override`
  - `missing`
- Unpublish removes student-visible final-grade data but does not reopen attempt creation.
- Simulation preview access is re-signed on result fetch using deterministic token signing; no token persistence is introduced.

## Implement

- Extend `GET /api/student/me` and `GET /api/attempts/:attemptId/result` with published final-grade summary when published:
  - `finalScore`
  - `finalStatus`
  - `publishedAt`
  - `feedback` only when `finalStatus='approved_ai'`
- Ensure student responses suppress:
  - `teacher_override_note`
  - gradebook entry IDs
  - `approved_attempt_id`
  - storage keys
  - provider IDs
  - raw provider payloads
  - unpublished entries
- Defensively ignore historical blank-published entries in student payload shaping if any predate Cycle 15 publish gate.
- Add simulation result preview metadata in attempt results for owned `simulation-derived` artifacts, using Worker-side re-signing on fetch.
- Update result page UI to render recovered simulation previews from Worker-signed metadata.

## Acceptance Criteria

- Students cannot see unpublished gradebook state.
- Students can view published final grades for approved AI, teacher override, and missing outcomes.
- Publish then unpublish hides final-grade state from student endpoints.
- New attempts remain blocked after unpublish per Cycle 15 semantics.
- Simulation previews can be re-opened from attempt results after navigation or refresh.

## Verification

Run:

```bash
npm run typecheck --workspaces --if-present
npm test --workspaces --if-present
```

## Status Ledger Update

Update `docs/implementation-status.md` with the Cycle 17 completion block. Include student final-grade response contract, simulation result recovery behavior, tests, and handoff to Cycle 18 config enforcement.
