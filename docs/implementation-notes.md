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

Model choices live in `worker/src/lib/models.ts`, with the shared simulation picker in `shared/src/assessmentConfig.ts`. The OpenAI text choices are GPT-5.6 Sol, Terra, and Luna, all using `max` reasoning. Sol is the default for HTML generation and grading; Terra handles simulation specifications, readiness checks, and fidelity review, with Sol fallback where configured. Kimi and Z.AI remain available for simulation HTML through their existing adapters.

Saved GPT-5.5 and GPT-5.4 assessments resolve to Sol; saved GPT-5.4 Mini assessments resolve to Terra. Retired model IDs are compatibility inputs only, never selectable options or new provider requests. Existing job records retain their original model and effort for recovery and audit. Apply `20260927182456_gpt56_max_reasoning.sql` before deploying this release to allow new Max jobs. Audio transcription, Realtime voice, and image generation use their specialized models.

The Worker pins OpenAI SDK `7.23.0` (Node 22+ in CI; Cloudflare Workers in production). Responses and Images payloads use SDK types so unsupported request fields fail typechecking. Text generation uses Responses with `reasoning.effort: "max"`; sketches use Images with `gpt-image-2.5-flare`, with `gpt-image-2.5-sunburst` fallback only for model-unavailable errors. Both image paths retain medium quality, 1536×1024 PNG output, and a bounded 180-second request timeout. Image quality is separate from text reasoning effort. The provider check exercises all three text models and generates one synthetic PNG with the configured primary image model. No student data or image bytes are logged.

## Teacher Auth Setup

Teacher identity uses Supabase email/password auth. Student identity uses Supabase Google auth plus class-code/PIN enrollment, with roster email as the account binding.

`TEACHER_SETUP_CODE` gates first-teacher setup. Once any teacher profile exists, setup closes permanently. In production (`APP_ENV=production` or `APP_ENV=prod`), `PIN_PEPPER` must be a high-entropy non-default secret; rotating it invalidates existing unclaimed PINs and pending upload tokens.

## Auth Guardrails

Future student pages belong in `STUDENT_PROTECTED_ROUTES` unless they are intentionally public. The only public student route is `/login`; protected student routes render through `StudentProtectedLayout`.

Future teacher pages belong under the `/teacher/*` route and `TEACHER_CHILD_ROUTES`, so `TeacherWorkspace` remains the auth boundary.

Future Worker API routes must use `publicRoute`, `studentRoute`, or `teacherRoute`. Adding a public route requires updating the explicit public-route allowlist test.

## UI Header Standard

Keep app headers compact. Put the page icon and title on the same horizontal line, then place any supporting metadata beneath the title. Avoid oversized dashboard headers; use sleek app-scale type rather than hero-scale type inside authenticated workflows.
