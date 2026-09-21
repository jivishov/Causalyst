# Cycle 1: Teacher Setup And Auth Foundation

## Goal

Add secure first-teacher setup and teacher session detection.

## Current Starting State

- `profiles.role` supports `student` and `teacher`.
- Frontend currently starts anonymous Supabase student sessions.
- Worker verifies Supabase JWTs with `requireUser`.
- There are no teacher routes or teacher UI routes.
- Existing `PIN_PEPPER` is used for PIN HMAC and upload-token signing.

## Read First

- `docs/implementation-status.md`
- `worker/src/index.ts`
- `worker/src/lib/auth.ts`
- `worker/src/lib/env.ts`
- `worker/src/lib/crypto.ts`
- `worker/src/routes/student.ts`
- `frontend/src/lib/api.ts`
- `frontend/src/state/session.tsx`
- `frontend/src/App.tsx`
- `frontend/src/pages/Login.tsx`

## Design Decisions

- Teacher identity uses Supabase email/password auth from the frontend.
- Student identity remains anonymous Supabase auth plus course code/PIN.
- Worker verifies Supabase JWT, then checks `profiles.role = 'teacher'`.
- First teacher setup requires Worker secret `TEACHER_SETUP_CODE`.
- Setup closes permanently once any teacher profile exists.
- Keep existing `PIN_PEPPER` for now; harden validation instead of silently adding duplicate secrets.
- Add `APP_ENV` or equivalent Worker environment marker so production rejects dev/default secrets.

## Implement

- Add `TEACHER_SETUP_CODE` and production-mode secret validation to Worker env handling.
- Tighten `PIN_PEPPER` validation: require high entropy in production, reject obvious defaults like `dev-pepper`, and document that rotating it invalidates existing unclaimed PINs and pending upload tokens.
- Add `/api/teacher/setup-status`.
- Add `/api/teacher/setup`, requiring authenticated Supabase user plus setup code.
- Add `/api/teacher/me`, requiring teacher role.
- Add shared `TeacherProfile` and teacher session response types.
- Add frontend `/teacher` route for teacher login/setup.
- Add a minimal docs note that Supabase Email provider and Anonymous sign-in must both be enabled; full install docs land in Cycle 11.
- Keep student PIN login unchanged.

## Acceptance Criteria

- Setup fails without setup code.
- Setup succeeds only when no teacher exists.
- Setup cannot be claimed twice.
- Production rejects weak/default `PIN_PEPPER`.
- Student anonymous login still works.
- Teacher session can call `/api/teacher/me`; student session gets 403.
- Tests cover setup code, first-teacher-only behavior, role rejection, and weak secret rejection.

## Verification

Run:

```bash
npm run typecheck --workspaces --if-present
npm test --workspaces --if-present
```

## Status Ledger Update

Update `docs/implementation-status.md` with the Cycle 1 completion block. Include exact teacher routes, env vars added, tests added, and any limitations around Supabase Email provider setup.
