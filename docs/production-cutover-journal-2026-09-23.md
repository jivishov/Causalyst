# Production cutover journal — 2026-09-23 UTC

This is an operational checkpoint, **not a backup certificate or classroom acceptance**. Never include passwords, API keys, user identifiers, student records, object names, or unencrypted backup bytes in this repository or public Actions artifacts.

## Current status — production deployment completed

- Production Supabase `bpqckntsnattswwzmroq` received the **seven pending committed SQL files**, in the order below, through hosted migrations using their exact committed bytes. Earlier numbered migrations were already reflected in the schema and were not replayed.
- Post-migration read-only checks found **2,301 legacy retention holds**, **zero held artifacts with a cleanup deadline**, four assessment versions, and zero attempts missing a snapshot. `authenticated` cannot select assessments or assessment versions or execute the cleanup RPC; `service_role` can select assessment versions. This checks the specific cutover invariants, not every production permission or application path.
- [`Deploy Worker` run 35814334827](https://github.com/jivishov/Causalyst/actions/runs/35814334827) **succeeded** from `main` at `cbd4933c78bab99d120bcde84817870c600bd580`. Both validation jobs, Worker deployment, frontend build, and GitHub Pages deployment passed. The Worker log records version `f7b75524-a42a-4922-a45e-fc89d8b7948a` and a successful `/api/health` check at 03:29 UTC; the deployed URL matches the frontend's Worker setting. The live frontend loads its student sign-in page. The workflow's `migrations_applied` declaration reflects the completed hosted schema and staging predeployment checks plus the user's backup waiver, not acceptance of signed-in classroom or real voice journeys.
- The user stated: **"Actually I don't need any previous data in the db"**. Historical-data backup and restore were waived for this cutover. No backup or restore was completed or certified. The seven SQL migrations preserved existing records; no live-data clearing was planned. A canceled backup workflow was never pushed or run.
- No enforced maintenance mode was configured. The user was told to keep the app closed; final read-only preflight found no active unexpired voice sessions or generation jobs and no attempt writes in the preceding 30 minutes. This was a quiet-window observation, not a write lock.

Full signed-in OAuth, enrollment, submission, and real voice paths are still unverified. Independent teacher grading acceptance is missing. A supervised **ungraded writing pilot** can be considered only after one teacher and two test students complete the flow. Do not infer live classroom readiness from a green deployment.

## Historical pre-cutover baseline (superseded by the status above)

- Candidate source: `main` at `cbd4933c78bab99d120bcde84817870c600bd580`; matching Worker and frontend were not deployed at initial inspection.
- Production Supabase project: `bpqckntsnattswwzmroq` (AlterMent). Dashboard explicitly reports that the Free project has **no managed backups**.
- At initial inspection production migration history recorded only `20260921034549_harden_causalyst_rpc_and_student_rls` and `20260921034702_optimize_causalyst_rls_auth_claims`. Earlier numbered migrations were reflected in the existing schema without matching history; **do not replay all 28**.
- Hosted staging `nscgqhsfudbnzfayvrnl` received all 28 migrations and transactional SQL suites, but has no authenticated deployed frontend/Worker journey.
- CI and provider probe results appear in `release-readiness-2026-09-23.md`. They do not constitute a production backup, deployed integration check, or teacher grading acceptance.

## Historical backup preflight (waived for this cutover)

Official Supabase backup guidance distinguishes a logical PostgreSQL export from Storage object **contents**; a database backup includes Storage metadata but not uploaded bytes. The original plan required both before DDL. No verified private database dump, object-byte archive, or restore test was obtained. The user's explicit historical-data waiver superseded that prerequisite; it did not create a backup.

Historical access findings: the dashboard showed a password placeholder in the connection string, and direct pooler access was unavailable from the shell network. The API Keys dashboard path was **rejected by automatic approval review** because revealing service-role credentials risked exposure; do not retry it indirectly. These findings did not establish a backup.

The original recovery plan called for Auth/public/Storage metadata and migration history, all object bytes, checksums, and an isolated restore. That work was canceled after the scope change.

| Evidence | Verified value |
| --- | --- |
| Private backup package reference | **None; waived for this cutover** |
| DB dump integrity and isolated restore | **Not performed** |
| Storage enumerated/downloaded/matched | **Not performed** |
| Baseline production tables/objects | Read-only aggregate SQL at 2026-09-23 ~01:22 UTC: **25 Auth users**, 4 profiles, 7 assessments, 15 attempts, 2,310 artifacts, 2,310 Storage objects, 20 simulation jobs, 8 gradebook entries. Earlier object join identified 2,300 draft uploaded objects plus 1 pending draft, 2 errored, 1 graded, and 6 submitted objects. Recheck at maintenance window. |
| Schema and retention baseline | Read-only SQL at ~01:25 UTC: snapshot column and private hold table absent; 2 draft attempts and **2,301** existing unsubmitted pending/uploaded/processed artifact rows. The final migration must hold legacy rows after the release migration has added the hash/frozen fields. |

## Cutover sequence and result

1. **Completed with scope change:** hosted staging migrations and transactional suites passed; the user waived historical-data recovery. No enforced maintenance mode existed. The app was to remain closed, and a quiet-window preflight found no active unexpired voice/generation work or recent attempt writes.
2. **Completed:** only the seven pending files below were applied once through hosted migrations, using exact committed SQL bytes, in this order:
   1. `20260922045624_assessment_privacy.sql`
   2. `20260922045744_assessment_evidence.sql`
   3. `20260922045749_enrollment_transactions.sql`
   4. `20260922045754_ai_job_recovery.sql`
   5. `20260922052455_operational_retention.sql`
   6. `20260922061703_realtime_evidence_checkpoint.sql`
   7. `20260922235906_preserve_legacy_artifacts.sql` (holds legacy unhashed drafts before cron)
   Verification: 2,301 holds, zero held deadlines, four assessment versions, zero attempts without snapshots; `authenticated` denied assessment/versions SELECT and cleanup EXECUTE, and `service_role` granted version SELECT. The hold migration finished before enabling the new Worker cron.
3. **Completed:** [run 35814334827](https://github.com/jivishov/Causalyst/actions/runs/35814334827) validated and deployed the Worker to `https://alt-assessment-student-api.emil-jivishov.workers.dev`, passed its health check, then deployed the frontend to `https://jivishov.github.io/Causalyst/` from the same commit. The new Worker includes the Realtime Durable Object and ten-minute cleanup schedule. Browser verification reached the live student sign-in page at `/Causalyst/login`.
4. **Waived:** no pre- or post-cutover backup is claimed. Revisit backup and retention needs before any later change for which existing data matters.

Production security advisor's RLS-without-policy notices on intentionally private tables are informational and align with denied direct client access. Its existing **Leaked Password Protection Disabled** warning is separate Auth configuration work; see [Supabase password security guidance](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).

An additional direct HTTP check from this workspace received Cloudflare HTTP 403/code 1010 for health and unauthenticated student/teacher endpoints. It supplies no application-route acceptance evidence. The deployment runner's health check passed, and the frontend browser page loaded; authenticated journeys on the actual classroom devices/network remain open. No retry using altered client identity or network path was attempted.
