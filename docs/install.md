# Install Guide (Teacher-Installable v1)

This guide deploys the app from GitHub while keeping Supabase, Cloudflare, and OpenAI under the teacher's own accounts.

## 1. Prerequisites

- GitHub account with Actions enabled.
- Supabase project (Pro or Free tier both work for v1).
- Cloudflare account with Workers enabled.
- OpenAI API key.
- Node.js 22+ and npm 10+ for local verification.

## 2. Create Your Copy Of The Repo

1. Fork this repository (or use it as a template).
2. In your fork, keep the default branch as `main`.
3. Turn on GitHub Pages:
   - Repository settings -> Pages
   - Source: `GitHub Actions`

## 3. Configure Supabase

1. Create a new Supabase project.
2. In **Authentication -> Providers**:
   - Enable **Email** provider (teacher login).
   - Enable **Google** provider (student login).
   - Configure the Google OAuth client ID/secret in Supabase. Use the callback URL shown by Supabase for the Google provider in the Google Cloud OAuth client.
3. In **Authentication -> URL Configuration**:
   - Set **Site URL** to your deployed frontend root URL, not `/login`: `https://<github-username>.github.io/<repo-name>/`
   - Add redirect URLs:
      - `https://<github-username>.github.io/<repo-name>/`
      - `https://<github-username>.github.io/<repo-name>/login`
      - `https://<github-username>.github.io/<repo-name>/teacher/reset-password`
      - `http://localhost:5173`
      - `http://localhost:5173/login`
      - `http://localhost:5173/teacher/reset-password`
      - `http://127.0.0.1:5173`
      - `http://127.0.0.1:5173/login`
      - `http://127.0.0.1:5173/teacher/reset-password`
4. For first-teacher setup:
   - Recommended: disable email confirmation temporarily, run first setup, then re-enable if your district policy requires confirmation.
   - Alternate: keep confirmation enabled and complete teacher email confirmation before `/teacher` setup.
5. Run SQL migrations in order from `supabase/migrations/`:
   - `0001_init.sql`
   - `0003_teacher_courses.sql`
   - `0004_roster_import.sql`
   - `0005_assignment_scoped_attempts.sql`
   - `0006_assessment_builder.sql`
   - `0007_gradebook.sql`
   - `0008_grade_exports.sql`
   - `0009_student_lifecycle.sql`
   - `0010_release_hardening.sql`
   - `0011_realtime_voice_assessments.sql`
   - `0012_simulation_sketch_artifacts.sql`
   - `0013_realtime_voice_hardening.sql`
   - `0014_student_google_login.sql`
   - `0015_student_google_login_stale_membership.sql`
   - `0016_student_google_login_ambiguous_columns.sql`
   - `0017_roster_email_normalized.sql`
   - `0018_simulation_generation_jobs.sql`
   - `0019_simulation_generation_reasoning_effort.sql`
   - `0020_simulation_html_viewport_metadata.sql`
   - `20260921034549_harden_causalyst_rpc_and_student_rls.sql`
   - `20260921034702_optimize_causalyst_rls_auth_claims.sql`
6. Optional local demo seed: run `supabase/seed.sql` (uses `CHEM101` and PIN `2468` with `PIN_PEPPER=dev-pepper`; update the seeded roster email to match your Google test account).
7. Storage buckets are created by migrations `0001_init.sql` and `0012_simulation_sketch_artifacts.sql`; verify these private buckets exist:
   - `audio`
   - `writing`
   - `simulation-sketch`
   - `simulation-derived`

## 4. Configure GitHub Variables And Secrets

Set these once in your GitHub repository settings.

| Name | Kind | Used By | Required | Notes |
| --- | --- | --- | --- | --- |
| `VITE_SUPABASE_URL` | Variable | Frontend deploy workflow | Yes | Supabase project URL (`https://<project>.supabase.co`) |
| `VITE_SUPABASE_ANON_KEY` | Variable | Frontend deploy workflow | Yes | Supabase anon key |
| `VITE_WORKER_URL` | Variable | Frontend deploy workflow | Yes | Public Worker URL (`https://<worker-subdomain>.workers.dev`) |
| `VITE_BASE_PATH` | Variable | Frontend deploy workflow | Yes | `/<repo-name>/` for GitHub Pages |
| `SUPABASE_URL` | Variable | Worker deploy workflow | Yes | Same Supabase project URL as above |
| `SUPABASE_JWKS_URL` | Variable | Worker deploy workflow | Yes | `https://<project>.supabase.co/auth/v1/.well-known/jwks.json` |
| `APP_ENV` | Variable | Worker deploy workflow | Yes | Use `production` for deployed installs |
| `ALLOWED_ORIGINS` | Variable | Worker deploy workflow | Yes | Comma-separated origins (no path), for example `https://<github-username>.github.io,http://localhost:5173,http://127.0.0.1:5173` |
| `SUPABASE_SERVICE_ROLE_KEY` | Secret | Worker deploy workflow | Yes | Supabase service role key |
| `OPENAI_API_KEY` | Secret | Worker deploy workflow | Yes | OpenAI API key |
| `PIN_PEPPER` | Secret | Worker deploy workflow | Yes | Production value must be high-entropy, non-default, and at least 32 chars |
| `TEACHER_SETUP_CODE` | Secret | Worker deploy workflow | Yes | Production value must be non-default and at least 16 chars |
| `CLOUDFLARE_API_TOKEN` | Secret | Worker deploy workflow | Yes | Token with Workers edit/deploy permissions |
| `CLOUDFLARE_ACCOUNT_ID` | Secret | Worker deploy workflow | Yes | Cloudflare account ID hosting the Worker |

Student Google login uses the Supabase OAuth redirect workflow documented in `docs/student-login-workflow.md`. Do not configure a frontend `VITE_GOOGLE_CLIENT_ID`; the Google OAuth client ID and secret belong in the Supabase Google provider configuration.

## 5. Deploy From GitHub

1. Push to `main`.
2. Confirm both workflows pass:
   - `.github/workflows/deploy-frontend.yml` (frontend typecheck, frontend tests, build, and dist security scan)
   - `.github/workflows/deploy-worker.yml`
3. Validate the deployment:
   - Frontend loads at `https://<github-username>.github.io/<repo-name>/`
   - Teacher workspace loads at `https://<github-username>.github.io/<repo-name>/teacher`
   - `GET <worker-url>/api/health` returns `{ "ok": true }`
4. Before inviting students, complete the dry run and go/no-go checks in `docs/beta-test-playbook.md`.

## 6. First Teacher Setup

1. Open `https://<github-username>.github.io/<repo-name>/teacher`.
2. Sign in or create the teacher email/password account in Supabase Auth.
3. Enter `TEACHER_SETUP_CODE` once to initialize the first teacher profile.
4. After setup closes, regular teacher sessions use `/api/teacher/me`.

Teacher email sessions and student Google sessions use separate browser auth storage. After upgrading from an older build, existing browsers may need to sign in again once for each role.

## 7. Local Development (Still Supported)

```bash
npm install
cp frontend/.env.example frontend/.env
cp worker/.dev.vars.example worker/.dev.vars
npm run dev --workspace worker
npm run dev --workspace frontend
```

## 8. Data Format Reference

### Roster CSV import

- Header row is required.
- Supported columns:
  - `display_name` (required)
  - `student_identifier` (optional but recommended, unique per course when present)
  - `email` (required for student Google login, unique per course when present)
  - `section` (optional)
- Example:

```csv
display_name,student_identifier,email,section
Jane Doe,S-1001,jane@example.com,1A
John Smith,S-1002,john@example.com,1A
```

### Grade export CSV

- Export formats:
  - `long`: one row per student-assignment pair.
  - `wide`: one row per student with assignment columns.
- Missing grade behavior:
  - default `blank`
  - optional `zero`
- Published filter:
  - default excludes unpublished entries
  - optional include unpublished entries
- Export audit stores metadata in `grade_exports` and does not store full CSV payloads.

## 9. Post-Install Verification

Run in repo root:

```bash
npm run typecheck --workspaces --if-present
npm test --workspaces --if-present
npm run build
npm run security
```
