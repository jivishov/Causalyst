# Implementation Notes

## Privacy Boundary

The frontend never stores Supabase storage keys, OpenAI file IDs, raw model responses, local paths, SHA hashes, or PIN hashes. It receives opaque artifact IDs and Worker upload URLs. Durable artifact metadata lives in `attempt_artifacts`, which has no client RLS policy.

## Login Flow

The canonical student login workflow is `docs/student-login-workflow.md`. Follow it exactly for every student-auth change.

Student login uses Supabase Google OAuth redirect, manual PKCE callback completion, and Worker-backed student profile resolution. It does not use Google Identity Services in-page button/popup logic.

1. Frontend starts Supabase Google OAuth with the student client.
2. Supabase returns to `/login` with callback markers.
3. `SessionProvider` completes the callback, reads the Supabase session, and fetches `/api/student/me`.
4. Worker verifies the Supabase JWT, resolves or auto-enrolls the student by roster email, and returns the student workspace.

## SimulationSpec

Knowledge-coding assessments use structured JSON instead of arbitrary generated code. Every element/action must carry:

```ts
source: { quote: string; start: number; end: number }
```

The Worker rejects output unless `description.slice(start, end) === quote` for every source.

## Model Catalog

OpenAI model choices live in `worker/src/lib/models.ts`. The app remains OpenAI-only for v1, but logical roles prevent model IDs from being scattered across route handlers.

## Teacher Auth Setup

Teacher identity uses Supabase email/password auth. Student identity uses Supabase Google auth plus class-code/PIN enrollment, with roster email as the account binding.

`TEACHER_SETUP_CODE` gates first-teacher setup. Once any teacher profile exists, setup closes permanently. In production (`APP_ENV=production` or `APP_ENV=prod`), `PIN_PEPPER` must be a high-entropy non-default secret; rotating it invalidates existing unclaimed PINs and pending upload tokens.

## Auth Guardrails

Future student pages belong in `STUDENT_PROTECTED_ROUTES` unless they are intentionally public. The only public student route is `/login`; protected student routes render through `StudentProtectedLayout`.

Future teacher pages belong under the `/teacher/*` route and `TEACHER_CHILD_ROUTES`, so `TeacherWorkspace` remains the auth boundary.

Future Worker API routes must use `publicRoute`, `studentRoute`, or `teacherRoute`. Adding a public route requires updating the explicit public-route allowlist test.

## UI Header Standard

Keep app headers compact. Put the page icon and title on the same horizontal line, then place any supporting metadata beneath the title. Avoid oversized dashboard headers; use sleek app-scale type rather than hero-scale type inside authenticated workflows.
