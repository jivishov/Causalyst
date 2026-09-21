# Cycle 10: Grade Export

## Goal

Export gradebook data for LMS transfer via CSV.

## Current Starting State

- Gradebook entries should exist from Cycle 9.
- No grade export route exists.
- V1 does not implement direct LMS APIs.

## Read First

- `docs/implementation-status.md`
- `worker/src/routes/teacher-gradebook.ts`
- `worker/src/lib/csv.ts` if created
- `frontend/src/pages/TeacherGradebook.tsx`

## Design Decisions

- V1 export supports generic CSV only.
- Formats: long and wide.
- Custom mapping is limited to column renaming and column inclusion/order.
- No vendor presets, formulas, transformations, or direct LMS API integrations.
- `grade_exports` audit rows are kept forever by default; manual purge is documented in Cycle 11.

## Implement

- Add `grade_exports` audit table.
- Add CSV escaping utility if not already present.
- Add long CSV export.
- Add wide CSV export.
- Add options: include unpublished, blank missing, missing as zero, selected course, selected assignments, column labels.
- Add export UI with preview count and download.
- Ensure export output excludes storage keys, PIN hashes, OpenAI file IDs, raw model payloads, and local paths.

## Acceptance Criteria

- Teacher downloads long and wide CSV.
- Missing grades are blank by default and zero only when selected.
- CSV escaping handles commas, quotes, newlines, and empty values.
- Export audit records metadata, not full grade payload.
- Tests cover formats, options, escaping, ownership, and forbidden sensitive fields.
- Run typecheck, tests, build, and `security:dist`.

## Verification

Run:

```bash
npm run typecheck --workspaces --if-present
npm test --workspaces --if-present
npm run build
npm run security:dist
```

## Status Ledger Update

Update `docs/implementation-status.md` with the Cycle 10 completion block. Include export schema, routes, CSV formats/options, retention stance, tests, and next handoff for install docs.
