# Cycle 4: Roster Import And PIN Issuance

## Goal

Let teachers import students before login and generate one-time PINs.

## Current Starting State

- `class_memberships` currently exists only after a student claims a PIN.
- `student_access_codes` has `student_label`, `pin_hash`, and `claimed_by`.
- There is no durable teacher-managed roster table.
- Course management should already exist from Cycle 2.

## Read First

- `docs/implementation-status.md`
- Latest course migration
- `worker/src/routes/student.ts`
- `worker/src/lib/crypto.ts`
- `worker/src/lib/db.ts`

## Design Decisions

- Roster identity is course-scoped.
- `student_identifier` is unique per course when present.
- `email` is unique per course when present.
- Duplicate display names are allowed.
- Plaintext PINs are returned only in the commit response and never stored.
- Keep `PIN_PEPPER` as the PIN HMAC key for v1 unless a dedicated secret split is implemented explicitly.
- If a future split introduces `PIN_HMAC_SECRET` and `UPLOAD_TOKEN_SECRET`, it must include a fallback/migration plan and reissue unclaimed PINs.

## Implement

- Add `roster_students` table.
- Link `student_access_codes` to `roster_student_id`.
- Add pure CSV parser in Worker.
- Add roster import preview endpoint.
- Add roster commit endpoint that creates roster rows and PIN hashes.
- Add roster list endpoint with claim status but no plaintext PINs.
- Update student login to claim roster row and create/update `class_memberships`.
- Add teacher roster UI for upload, preview, commit, one-time PIN export/copy, and roster list.

## Acceptance Criteria

- Teacher imports CSV with `display_name`, optional `student_identifier`, optional `email`, optional `section`.
- Duplicate identifiers/emails are rejected per course.
- Display-name-only duplicate rows are accepted.
- Student PIN claim links roster row, profile, access code, and membership.
- Plaintext PINs are shown only once.
- Tests cover parser, duplicates, one-time PIN reveal, hash-only storage, and claim flow.

## Verification

Run:

```bash
npm run typecheck --workspaces --if-present
npm test --workspaces --if-present
```

## Status Ledger Update

Update `docs/implementation-status.md` with the Cycle 4 completion block. Include roster schema, CSV format, claim flow, one-time PIN behavior, and next handoff for assignment-scoped attempts.
