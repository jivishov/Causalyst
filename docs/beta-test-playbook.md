# Beta Test Playbook

Use this checklist before and during a 20-student beta. The goal is to catch deployment, auth, and submission timing issues before students begin real assessment work.

## Pre-Beta Dry Run

Run this on the deployed GitHub Pages frontend, deployed Worker, real Supabase project, and real OpenAI key.

1. Confirm both GitHub workflows pass from `main`.
2. Confirm `GET <worker-url>/api/health` returns `{ "ok": true }`.
3. Confirm Supabase migrations are applied through `0020_simulation_html_viewport_metadata.sql`.
4. Confirm private buckets exist: `audio`, `writing`, `simulation-sketch`, and `simulation-derived`.
5. Confirm Supabase redirect URLs and Worker `ALLOWED_ORIGINS` exactly match the deployed origins.
6. Use 2-3 test student Google accounts, including one account that should be rejected because it does not match the roster email.
7. Join a course with roster email and PIN, then refresh the dashboard.
8. Start, refresh, submit, and view results for every assessment type planned for beta.
9. Test slow upload or slow grading conditions on school Wi-Fi if possible.
10. If simulations are included, test generation, cancel/retry, structured fallback, submit, and result recovery after refresh.
11. As teacher, rebuild gradebook, review an attempt, publish/unpublish, and confirm student final visibility changes.
12. Direct-load GitHub Pages routes: `/login`, `/teacher`, one assessment route, and one result or final route.

## Classroom Interruption Playbook

Use this order during the beta to avoid losing student work.

1. If login is stuck, read the visible auth stage on `/login`.
2. If the stage is Google callback related, use **Reset sign-in**, then retry without switching browser, host, or profile.
3. Confirm the student selected the Google account that matches the roster `email`.
4. Confirm the course code and PIN are from the current roster import.
5. Check `GET <worker-url>/api/health` from the teacher machine.
6. If a submission shows a retryable/error state, use the dashboard retry action instead of creating a new browser tab from an old URL.
7. If upload or grading times out, keep the student on the same device/browser and retry from the dashboard after the teacher verifies Worker health.
8. If a student has a submitted/final-published lifecycle message, route them to the result/final page instead of asking them to resubmit.

## Go / No-Go

Go only if the dry run completes without students losing submission progress, both deploy workflows are green, Worker health is green, migrations and buckets are current, and deployed auth origins exactly match Supabase and Worker configuration.
