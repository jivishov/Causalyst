# Global Contract

## Active Repo

`C:\Users\EmilJivishov\Projects\alternative_assessment`

## Architecture

- `frontend/`: Vite + React app deployed to GitHub Pages.
- `worker/`: Cloudflare Worker API for privileged Supabase/OpenAI operations.
- `shared/`: shared TypeScript types and validators.
- `supabase/`: schema migrations and seed data.
- External services: Supabase SQL/storage/auth, Cloudflare Workers, OpenAI API, GitHub Pages/Actions.

## Current Starting Point

The app is currently student-facing only. Teacher role exists in the schema, but there are no teacher routes or teacher UI.

Existing DB tables:

- `profiles`
- `classes`
- `class_memberships`
- `student_access_codes`
- `assessments`
- `assessment_assignments`
- `attempts`
- `attempt_artifacts`
- `attempt_audit_logs`

Existing Worker route files:

- `worker/src/routes/student.ts`
- `worker/src/routes/attempts.ts`
- `worker/src/routes/artifacts.ts`
- `worker/src/routes/voice.ts`
- `worker/src/routes/writing.ts`
- `worker/src/routes/simulation.ts`

Existing artifact buckets:

- `audio`
- `writing`
- `simulation-derived`

## Privacy Rules

Never expose these values to frontend-visible state, built frontend assets, CSV exports, or public docs examples:

- Supabase service-role keys
- Storage keys
- PIN hashes
- OpenAI file IDs
- Raw provider responses
- Local file paths
- Backend-only HMAC/signing secrets

The browser should receive public config, opaque IDs, safe display data, and Worker-mediated URLs/content only.

## Teacher Authorization Stance

- Teacher UI must use Worker APIs only.
- Do not add direct teacher Supabase table access from the frontend.
- Worker uses Supabase service-role access and must enforce ownership on every teacher route.
- RLS is defense-in-depth, not the primary teacher authorization layer.
- Keep `classes` as the DB table name for v1; UI should say "course". Any future rename is a dedicated cycle.

## Verification Commands

After every cycle:

```bash
npm run typecheck --workspaces --if-present
npm test --workspaces --if-present
```

For deploy/security cycles, also run:

```bash
npm run build
npm run security:dist
```

## Status Ledger Requirement

Every cycle must update `docs/implementation-status.md` using this block:

```md
## Cycle N Completion Block
- DB migrations added:
- Worker routes added/changed:
- Shared types added/changed:
- Frontend pages/components added/changed:
- Tests added:
- Verification commands run:
- Known limitations:
- Next cycle handoff:
```

## Deferred After V1

- Teacher invitations and multi-teacher installs.
- Direct LMS API integrations.
- Multi-teacher shared course ownership.
- Department-level roles and permissions.
- Dedicated split of `PIN_HMAC_SECRET` and `UPLOAD_TOKEN_SECRET`, unless implemented deliberately before v1 with fallback migration.
- Per-student differentiated assignments.
- Email delivery for PINs/invitations.
- Scheduled grade exports.
- Advanced analytics.
