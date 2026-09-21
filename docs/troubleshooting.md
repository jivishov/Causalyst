# Troubleshooting

## Worker Deploy Fails In GitHub Actions

Symptoms:

- `wrangler deploy` fails with auth or account errors.

Checks:

1. Confirm `CLOUDFLARE_API_TOKEN` has Workers deploy/edit permissions.
2. Confirm `CLOUDFLARE_ACCOUNT_ID` matches the account that owns the Worker.
3. Confirm repository variables/secrets are all populated (`docs/install.md` config matrix).

## Frontend Deploy Succeeds But App Cannot Reach Worker

Symptoms:

- Browser shows failed `/api/*` requests.

Checks:

1. Ensure `VITE_WORKER_URL` points to the deployed Worker URL.
2. Ensure Worker `ALLOWED_ORIGINS` includes:
   - `https://<github-username>.github.io`
   - local dev origins if needed.
3. Verify Worker health endpoint: `GET <worker-url>/api/health`.

## Teacher Route Returns 404 On GitHub Pages

Symptoms:

- Opening `/teacher` shows GitHub Pages 404 instead of app.

Checks:

1. Confirm frontend workflow completed the `Enable SPA deep links on GitHub Pages` step.
2. In deployed Pages artifact, verify both `index.html` and `404.html` are present.
3. Retry `https://<github-username>.github.io/<repo-name>/teacher`.

## Teacher Setup Rejected

Symptoms:

- Setup code is rejected, or setup route says it is unavailable.

Checks:

1. If setup already completed once, it is intentionally closed.
2. Ensure the entered setup code matches current `TEACHER_SETUP_CODE`.
3. If email confirmation is enabled, confirm the teacher email before attempting setup.

## Production Secret Validation Error

Symptoms:

- Worker responds with error mentioning `PIN_PEPPER` or setup secret quality.

Checks:

1. `APP_ENV` is `production`/`prod` in deployed environments.
2. `PIN_PEPPER` is high-entropy and at least 32 characters.
3. `TEACHER_SETUP_CODE` is non-default and at least 16 characters.

## Supabase Auth Issues (Teacher Or Student)

Symptoms:

- Teacher login cannot authenticate, or student login flow fails unexpectedly.
- Teacher password reset/recovery emails open `/login` instead of the teacher reset page.

Checks:

0. For student login, follow `docs/student-login-workflow.md` exactly. It is the canonical workflow.
1. Supabase Email provider is enabled (teacher flow).
2. Supabase Google provider is enabled and has a valid Google OAuth client ID/secret (student flow).
3. Site URL points to the frontend root URL, not `/login`.
4. Redirect allow-list includes the GitHub Pages root URL, `/login`, `/teacher/reset-password`, and the matching localhost/127.0.0.1 dev URLs.
5. The student is choosing the Google account that matches the roster `email` value.
6. Do not add `VITE_GOOGLE_CLIENT_ID` or GIS button setup for the student app. Student login uses Supabase OAuth redirect and the Supabase callback URL, not Google Identity Services in-page origin checks.

Local development notes:

- Use the same origin for opening the app and for Supabase redirect URLs. The default frontend dev origin is `http://127.0.0.1:5173`, and student Google login redirects to `http://127.0.0.1:5173/login` when the app is opened there.
- `http://localhost:5173` and `http://127.0.0.1:5173` are different browser origins. Both can work when both are listed in Supabase Auth redirect URLs and Worker `ALLOWED_ORIGINS`, but do not switch between them mid-login because OAuth PKCE verifier storage is origin-specific.
- If Vite reports that port `5173` is already in use, stop the stale frontend dev process and restart Vite. Do not continue Google login on a fallback port such as `5174`; OAuth PKCE state and redirect allow-lists are origin-specific.
- The frontend completes student OAuth callbacks explicitly before session bootstrap. If the app shows `Completing Google sign-in.`, it is processing the Supabase PKCE callback exchange. If it remains there for about 20 seconds, it must recover to a visible timeout error. If it does not, inspect the StrictMode mounted-ref guard described in `docs/student-login-workflow.md`.

## Roster CSV Import Validation Errors

Symptoms:

- Preview step reports invalid rows.

Checks:

1. CSV header uses expected names: `display_name`, `student_identifier`, `email`, `section`.
2. `display_name` is present on each row.
3. `student_identifier` and `email` (when used) are unique within the course.

## Student Stuck During Beta

Use `docs/beta-test-playbook.md` first for the classroom triage checklist. The fast checks are: confirm the student picked the rostered Google account, verify the roster email and PIN, check `GET <worker-url>/api/health`, use **Reset sign-in** if login is stuck, and have the student retry an assignment card marked as retryable/error instead of starting from an old browser tab.

## Grade Export Issues

Symptoms:

- Export fails, preview count seems wrong, or exported grades are missing.

Checks:

1. Run gradebook rebuild for the course before export.
2. Verify published/unpublished filter selection.
3. Verify missing mode (`blank` vs `zero`) and selected assignments.

If the Worker reports missing `grade_exports` relation, apply migration `supabase/migrations/0008_grade_exports.sql`.

If the Worker reports missing first-teacher or submission-claim RPCs, apply `supabase/migrations/0009_student_lifecycle.sql` and `supabase/migrations/0010_release_hardening.sql` in order.

If the Worker reports missing student Google login RPCs, apply `supabase/migrations/0014_student_google_login.sql`.

If the Worker logs `column reference "class_id" is ambiguous` during `POST /api/student/login`, apply `supabase/migrations/0016_student_google_login_ambiguous_columns.sql`. This replaces the student Google login RPC with ambiguity-safe column references.

If simulation HTML generation reports that job storage is not ready, apply `supabase/migrations/0018_simulation_generation_jobs.sql`. This table is required for queued background preview generation and refinement.

If simulation HTML generation or draft recovery reports a missing `reasoning_effort` column on `simulation_generation_jobs`, apply `supabase/migrations/0019_simulation_generation_reasoning_effort.sql`. This column records the GPT-5.5 reasoning effort used for each HTML preview job.

If simulation previews fail to restore or teacher review fails after the 1024x640 preview update, apply `supabase/migrations/0020_simulation_html_viewport_metadata.sql`. This stores the viewport used for each HTML artifact while preserving older 1200x800 previews.

## Manual Purge For `grade_exports`

Default behavior keeps export audit metadata indefinitely. To purge manually, run SQL in Supabase:

```sql
-- Purge all export audit rows.
delete from grade_exports;
```

Optional scoped purge:

```sql
-- Purge by course.
delete from grade_exports
where course_id = '<course-uuid>';
```

```sql
-- Purge by age (example: older than 180 days).
delete from grade_exports
where created_at < now() - interval '180 days';
```

## Unsupported UI Flows (By Design)

The current student/teacher UI intentionally does not include these controls:

- Claimed-PIN reset from the student UI.
- Teacher retake/reopen controls that bypass the lifecycle contract.
- Calendar-based hard-close automation that force-closes assignments at a global wall-clock cutoff.

If any of these are needed, they must be implemented as explicit post-v1 product work with updated lifecycle and policy rules.
