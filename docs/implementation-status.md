# Implementation Status

This file is the durable handoff ledger for teacher-installable v1 implementation sessions. Fresh sessions should read this file after `docs/implementation-plan/global-contract.md`, then continue with the current cycle file.

## Current Architecture

- `frontend/`: Vite + React student app deployed to GitHub Pages.
- `worker/`: Cloudflare Worker API for privileged Supabase and OpenAI operations.
- `shared/`: shared TypeScript types and validators.
- `supabase/`: SQL migrations and seed data.
- External services: Supabase SQL/storage/auth, Cloudflare Workers, OpenAI API, GitHub Pages/Actions.

## Existing Runtime Surface

- Student app is implemented, and the teacher workspace foundation now includes setup/sign-in, course management, and roster import with one-time PIN issuance.
- Existing Worker route files:
  - `worker/src/routes/student.ts`
  - `worker/src/routes/attempts.ts`
  - `worker/src/routes/artifacts.ts`
  - `worker/src/routes/voice.ts`
  - `worker/src/routes/writing.ts`
  - `worker/src/routes/simulation.ts`
  - `worker/src/routes/teacher.ts`
  - `worker/src/routes/teacherAssessments.ts`
  - `worker/src/routes/teacherReview.ts`
  - `worker/src/routes/teacherGradebook.ts`
- Teacher role exists in the schema with Worker-mediated teacher setup/session/course routes.
- Browser uses Supabase Google auth for students, Supabase email/password auth plus `/teacher/reset-password` recovery for teachers, and opaque artifact IDs; privileged operations go through the Worker.

## Existing Schema

Initial migration `supabase/migrations/0001_init.sql` creates:

- `profiles`
- `classes`
- `class_memberships`
- `student_access_codes`
- `assessments`
- `assessment_assignments`
- `attempts`
- `attempt_artifacts`
- `attempt_audit_logs`

Additional migrations now add:

- `classes.section`, `classes.term`, `classes.archived_at`, `classes.updated_at` (`0003_teacher_courses.sql`)
- `roster_students` plus course-scoped unique identity indexes (`0004_roster_import.sql`)
- `student_access_codes.roster_student_id`
- `class_memberships.roster_student_id`
- `attempts.assignment_id` and assignment-scoped backfill + policy cleanup (`0005_assignment_scoped_attempts.sql`)
- `assessments.archived_at`, `assessments.updated_at`, `assessment_assignments.archived_at`, `assessment_assignments.updated_at`, and active-only unique assignment index (`0006_assessment_builder.sql`)
- `gradebook_entries` and roster deactivation metadata (`0007_gradebook.sql`)
- `grade_exports` metadata-only export audit records (`0008_grade_exports.sql`)
- `attempts.due_at_snapshot`, `attempts.submitted_after_due`, and active draft uniqueness (`0009_student_lifecycle.sql`)
- RPC hardening for first-teacher setup and submission claim transitions (`0010_release_hardening.sql`)
- Realtime voice session/event tables (`0011_realtime_voice_assessments.sql`, hardened by `0013_realtime_voice_hardening.sql`)
- Simulation sketch artifacts and private `simulation-sketch` bucket (`0012_simulation_sketch_artifacts.sql`)
- `profiles.email` and `claim_student_google_login(...)` for Google student PIN enrollment/legacy transfer (`0014_student_google_login.sql`)

Existing private storage buckets:

- `audio`
- `writing`
- `simulation-sketch`
- `simulation-derived`

RLS is enabled for all app tables. Client policies currently cover student-owned profile, class enrollment, assignment visibility, assessment visibility, and own-attempt access. There are no client policies for `student_access_codes`, `attempt_artifacts`, or `attempt_audit_logs`; the Worker uses Supabase service-role access and enforces application-level access checks.

## Privacy Boundary

The frontend must not receive or serialize Supabase service-role keys, storage keys, PIN hashes, OpenAI file IDs, raw provider responses, local file paths, backend-only HMAC/signing secrets, or SHA/hash values. Browser-visible state should contain public config, opaque IDs, safe display data, and Worker-mediated URLs/content only.

Runtime-only attachment data must stay server-side. Attachments should be staged locally first, uploaded lazily on the first provider call that needs them, cached as remote handles for reuse, and deleted both locally and remotely on reset/cleanup.

## Known Gaps

- Teacher setup/auth foundation exists for first-teacher setup and teacher session detection.
- Teacher-owned course management UI and Worker APIs exist.
- Roster import and one-time PIN issuance are implemented, but roster edit/reissue workflows are not yet implemented.
- Assessment and assignment builders are implemented, but teacher-side cloning/sharing templates are not implemented in v1.
- Install docs, hardening, and release QA are complete for teacher-installable v1.
- Cycle 3 is reserved/skipped because multi-teacher invitations are deferred after v1.

## Milestone Sequence

- Cycle 0: Status ledger, README pointer, verification script check.
- Cycle 1: Teacher setup/auth, `TEACHER_SETUP_CODE`, hardened `PIN_PEPPER`, `/api/teacher/*` foundation.
- Cycle 2: Teacher-owned courses, global course-code uniqueness, duplicate-code UI guidance.
- Cycle 3: Reserved/skipped because teacher invitations are deferred post-v1.
- Cycle 4: Roster import, course-scoped identity, one-time PIN issuance.
- Cycle 5: Assignment-scoped attempts, legacy handling, RLS cleanup.
- Cycle 6: Assessment builder and assignment CRUD, partial active unique index for assignments.
- Cycle 7: Simulation HTML stored as `simulation-derived` artifact, student preview route update.
- Cycle 8: Teacher response review and Worker-mediated artifact preview/download.
- Cycle 9: Gradebook entries, idempotent reconciliation, final grade precedence.
- Cycle 10: Long/wide CSV export and `grade_exports` audit.
- Cycle 11: Install, privacy, troubleshooting, Worker deploy workflow.
- Cycle 12A: Security/privacy hardening and `security:dist` expansion.
- Cycle 12B: Release-candidate happy path and final docs/status update.
- Cycle 13: Student contracts and structured lifecycle error plumbing.
- Cycle 14: Student login identity guard and safe multi-course joins.
- Cycle 15: Attempt-start precedence, draft uniqueness, and publish gate hardening.
- Cycle 16: Submission claim and late tracking.
- Cycle 17: Published final result visibility and simulation recovery.
- Cycle 18: Server-side writing/simulation config enforcement.
- Cycle 19: Student dashboard lifecycle UX and release QA.
- Release hardening: auth separation, atomic setup/submit RPCs, and no-attempt final-result viewing.

## Feature Matrix

| Area | Status | Notes |
| --- | --- | --- |
| Student app | Implemented | Student-facing login, assigned assessment flow, uploads, and feedback are the current app surface. |
| Teacher setup | Implemented foundation | `/api/teacher/setup-status`, `/api/teacher/setup`, `/api/teacher/me`, shared teacher response types, and `/teacher` frontend route exist. |
| Courses | Implemented foundation | Teacher can list/create/update/archive/unarchive owned courses; DB table remains `classes`; course codes stay globally unique. |
| Roster | Implemented foundation | Teacher can preview/commit CSV roster imports per course, issue one-time PINs, and view roster claim status through Worker-mediated routes and dashboard UI. |
| Assignments | Implemented | Teacher assessment library and assignment CRUD are implemented with archive/reassign behavior; student visibility is limited to open, active assignments. |
| Simulation artifact storage | Implemented | Generated simulation HTML is stored in `simulation-derived`, and student preview uses a Worker-mediated artifact route with ownership checks. |
| Review | Implemented foundation | Teacher can list/filter attempts, open attempt detail, and preview/download artifacts through Worker ownership checks without exposing storage keys. |
| Gradebook | Implemented foundation | Gradebook entries now reconcile per course assignment/roster matrix, teacher finalization controls exist in review + gradebook pages, and publish state is tracked. |
| Export | Implemented foundation | Teacher can export long/wide CSV with preview counts, published/missing options, selected assignments, and audit metadata in `grade_exports`. |
| Install docs | Implemented | Install, privacy, and troubleshooting guides now cover teacher-run deployment, env setup, and operational support. |
| Hardening | Implemented foundation | Error redaction and expanded frontend-dist secret scanning are in place; remote-provider/stale-artifact purge automation remains deferred. |
| Release QA | Implemented | Cycle 12B completed release verification gates, manual happy-path evidence capture, and v1 ledger handoff updates. |

## Cycle 0 Completion Block

- DB migrations added: none.
- Worker routes added/changed: none.
- Shared types added/changed: none.
- Frontend pages/components added/changed: none.
- Tests added: none; existing workspace scripts were already non-trivial.
- Verification commands run: `npm run typecheck --workspaces --if-present` passed for shared, frontend, and worker; `npm test --workspaces --if-present` passed with shared 4 files/8 tests, frontend 2 files/5 tests, worker 3 files/8 tests. Frontend tests emitted Vite deprecation warnings about `esbuild`/`optimizeDeps.esbuildOptions`; no failures.
- Known limitations: teacher implementation not started; Cycle 3 reserved/skipped.
- Next cycle handoff: Cycle 1 should start teacher setup/auth foundation.

## Cycle 1 Completion Block

- DB migrations added: none.
- Worker routes added/changed: added `worker/src/routes/teacher.ts`; added `GET /api/teacher/setup-status`, `POST /api/teacher/setup`, and `GET /api/teacher/me`; tightened `/api/student/me` so teacher profiles are not treated as student sessions; added production secret validation via `APP_ENV`, `PIN_PEPPER`, and `TEACHER_SETUP_CODE`.
- Shared types added/changed: added `TeacherProfile`, `TeacherSetupStatusResponse`, and `TeacherSessionResponse` in `shared/src/types.ts`.
- Frontend pages/components added/changed: added `frontend/src/pages/TeacherLogin.tsx`; added `/teacher` route in `frontend/src/App.tsx`; added teacher auth helpers in `frontend/src/lib/api.ts`; added minimal teacher auth styles.
- Tests added: added `worker/test/teacher.test.ts` covering setup availability, setup-code rejection, first-teacher-only behavior, non-teacher role rejection, weak production `PIN_PEPPER` rejection, and dev default allowance.
- Verification commands run: `npm run typecheck --workspaces --if-present` passed for shared, frontend, and worker; `npm test --workspaces --if-present` passed with shared 4 files/8 tests, frontend 2 files/5 tests, worker 4 files/14 tests. Frontend tests still emit Vite deprecation warnings about `esbuild`/`optimizeDeps.esbuildOptions`; no failures.
- Known limitations: Supabase Email provider must be enabled manually for teacher auth, and Anonymous sign-in must remain enabled for students; full install documentation is deferred to Cycle 11. Teacher dashboard/course management is not started until Cycle 2.
- Next cycle handoff: Cycle 2 should add teacher-owned courses, global course-code uniqueness, and duplicate-code UI guidance.

## Cycle 2 Completion Block

- DB migrations added: `supabase/migrations/0003_teacher_courses.sql` adds `classes.section`, `classes.term`, `classes.archived_at`, and `classes.updated_at`; adds `idx_classes_teacher`, `idx_classes_teacher_archived`, and `idx_classes_code_upper`. Existing `classes.code` global unique constraint remains the v1 course-code rule.
- Worker routes added/changed: added `GET /api/teacher/courses`, `POST /api/teacher/courses`, `PUT /api/teacher/courses/:courseId`, `POST /api/teacher/courses/:courseId/archive`, and `POST /api/teacher/courses/:courseId/unarchive` in `worker/src/routes/teacher.ts`; every route requires teacher role and enforces `classes.teacher_id = auth user`.
- Shared types added/changed: added `TeacherCourse` and `TeacherCoursesResponse` in `shared/src/types.ts`.
- Frontend pages/components added/changed: expanded `frontend/src/pages/TeacherLogin.tsx` into a signed-in teacher dashboard with course create/edit/list/archive/unarchive controls; added course API helpers in `frontend/src/lib/api.ts`; added teacher course layout styles in `frontend/src/styles.css`.
- Tests added: expanded `worker/test/teacher.test.ts` with course ownership list filtering, cross-teacher update rejection, and duplicate course-code conflict coverage.
- Verification commands run: `npm run typecheck --workspaces --if-present` passed for shared, frontend, and worker; `npm test --workspaces --if-present` passed with shared 4 files/8 tests, frontend 2 files/5 tests, worker 4 files/17 tests. Frontend tests still emit Vite deprecation warnings about `esbuild`/`optimizeDeps.esbuildOptions`; no failures.
- Known limitations: course roster, PIN issuance, assignments, and teacher course detail workflows remain future cycles. Duplicate course-code conflicts return `Course code is already taken. Try adding a term suffix such as BIO101-S26.`
- Next cycle handoff: Cycle 3 is reserved/skipped; Cycle 4 should implement roster import, course-scoped identity, and one-time PIN issuance.

## Cycle 3 Completion Block

- DB migrations added: none.
- Worker routes added/changed: none.
- Shared types added/changed: none.
- Frontend pages/components added/changed: none.
- Tests added: none.
- Verification commands run: none (no runtime changes; status-ledger update only).
- Known limitations: teacher invitations and multi-teacher installs remain deferred post-v1 by design.
- Next cycle handoff: Cycle 4 should implement roster import, course-scoped identity, and one-time PIN issuance.

## Cycle 4 Completion Block

- DB migrations added: `supabase/migrations/0004_roster_import.sql` adds `roster_students`, course-scoped unique indexes for `student_identifier`/`email` when present, and `roster_student_id` links on `student_access_codes` and `class_memberships`.
- Worker routes added/changed: added `POST /api/teacher/courses/:courseId/roster/preview`, `POST /api/teacher/courses/:courseId/roster/commit`, and `GET /api/teacher/courses/:courseId/roster` in `worker/src/routes/teacher.ts`; added `worker/src/lib/rosterCsv.ts` pure parser/row validation; updated `POST /api/student/login` to claim linked roster rows and persist `class_memberships.roster_student_id`.
- Shared types added/changed: added `TeacherRosterImportPreviewRow`, `TeacherRosterImportPreviewError`, `TeacherRosterImportPreviewResponse`, `TeacherRosterStudent`, `TeacherRosterResponse`, `TeacherRosterIssuedPin`, and `TeacherRosterImportCommitResponse` in `shared/src/types.ts`.
- Frontend pages/components added/changed: expanded `frontend/src/pages/TeacherLogin.tsx` with roster CSV upload/preview/commit flows, one-time PIN reveal and copy/download CSV export, and roster claim-status list; added roster API helpers in `frontend/src/lib/api.ts`; added roster UI styles in `frontend/src/styles.css`.
- Tests added: added `worker/test/roster.test.ts` covering CSV parser behavior, duplicate validation in preview, one-time plaintext PIN reveal with hash-only persistence, and student claim linkage between access code, roster student, and class membership.
- Verification commands run: `npm run typecheck --workspaces --if-present` passed for shared, frontend, and worker; `npm test --workspaces --if-present` passed with shared 4 files/8 tests, frontend 2 files/5 tests, worker 5 files/21 tests. Frontend tests still emit Vite deprecation warnings about `esbuild`/`optimizeDeps.esbuildOptions`; no failures.
- Known limitations: roster commit is best-effort per row and not wrapped in an explicit cross-row transaction; reissue/edit/remove roster workflows are deferred.
- Next cycle handoff: Cycle 5 should implement assignment-scoped attempts, legacy attempt handling, and related RLS cleanup.

## Cycle 5 Completion Block

- DB migrations added: `supabase/migrations/0005_assignment_scoped_attempts.sql` adds `attempts.assignment_id`, backfills only unambiguous legacy attempts, keeps ambiguous attempts as `assignment_id = null`, syncs `assessment_id` from assignment when assignment exists, and drops direct client `attempts` insert policy (`attempts insert own draft`) so Worker remains the v1 attempt writer.
- Worker routes added/changed: updated `POST /api/attempts/start` in `worker/src/routes/attempts.ts` to accept `assignmentId` and create attempts with `assignment_id`; updated `GET /api/student/me` and `POST /api/student/login` responses in `worker/src/routes/student.ts` to return course-grouped assignment summaries.
- Shared types added/changed: added `StudentAssignmentSummary` and `StudentCourseAssignments`; updated `AttemptResult` with `assignmentId` in `shared/src/types.ts`.
- Frontend pages/components added/changed: updated student session state to course-grouped assignments in `frontend/src/state/session.tsx`; updated dashboard grouping and assignment links in `frontend/src/pages/Dashboard.tsx`; updated app navigation links in `frontend/src/components/AppShell.tsx`; updated assignment page routing and attempt start logic to assignment IDs in `frontend/src/pages/AssessmentPage.tsx` and `frontend/src/App.tsx`; updated API response validation and attempt start payloads in `frontend/src/lib/api.ts`.
- Tests added: added `worker/test/assignmentAttempts.test.ts` covering assignment access control, same-assessment multi-course attempt separation, and legacy null-assignment attempt loading; updated frontend login response test expectations in `frontend/test/loginResponse.test.ts`.
- Verification commands run: `npm run typecheck --workspaces --if-present` passed for shared, frontend, and worker; `npm test --workspaces --if-present` passed with shared 4 files/8 tests, frontend 2 files/5 tests, worker 6 files/24 tests. Frontend tests still emit Vite deprecation warnings about `esbuild`/`optimizeDeps.esbuildOptions`; no failures.
- Known limitations: assignment builder/create-edit-archive flows are still pending Cycle 6; legacy attempts with `assignment_id = null` remain until builder-driven migration is complete.
- Next cycle handoff: Cycle 6 should implement assessment builder and assignment CRUD with partial active unique index semantics.

## Cycle 6 Completion Block

- DB migrations added: `supabase/migrations/0006_assessment_builder.sql` adds `archived_at`/`updated_at` columns for `assessments` and `assessment_assignments`, drops the old global unique constraint for assignments, and adds active-only uniqueness (`idx_assignment_active_unique`) for `(assessment_id, class_id)` where `archived_at is null`.
- Worker routes added/changed: added `worker/src/routes/teacherAssessments.ts`; added `GET/POST/PUT /api/teacher/assessments`, `POST /api/teacher/assessments/:assessmentId/archive`, `POST /api/teacher/assessments/:assessmentId/unarchive`, `GET/POST/PUT /api/teacher/assignments`, `POST /api/teacher/assignments/:assignmentId/archive`, and `POST /api/teacher/assignments/:assignmentId/unarchive`; student assignment visibility now excludes archived/future assignments in `worker/src/lib/db.ts`.
- Shared types added/changed: added `TeacherAssessment`, `TeacherAssessmentsResponse`, `TeacherAssignment`, and `TeacherAssignmentsResponse` in `shared/src/types.ts`.
- Frontend pages/components added/changed: expanded `frontend/src/pages/TeacherLogin.tsx` with assessment builder (rubric editor + type-specific config), assignment builder, and assessment/assignment archive/unarchive flows; added teacher assessment/assignment API helpers in `frontend/src/lib/api.ts`; added builder layout styles in `frontend/src/styles.css`.
- Tests added: added `worker/test/teacherAssessments.test.ts` covering ownership checks, date validation, archive/reassign behavior for the partial unique index flow, and student visibility for open/active assignments.
- Verification commands run: `npm run typecheck --workspaces --if-present` passed for shared, frontend, and worker; `npm test --workspaces --if-present` passed with shared 4 files/8 tests, frontend 2 files/5 tests, worker 7 files/29 tests. Frontend tests still emit Vite deprecation warnings about `esbuild`/`optimizeDeps.esbuildOptions`; no failures.
- Known limitations: assignment edits remain independent from existing student attempts (existing attempts keep their original assignment linkage), and richer rubric templates/import are deferred.
- Next cycle handoff: Cycle 7 should store generated simulation HTML as a `simulation-derived` artifact and update student preview flow.

## Cycle 7 Completion Block

- DB migrations added: none.
- Worker routes added/changed: updated `POST /api/simulation/generate` in `worker/src/routes/simulation.ts` to store generated HTML in Supabase storage as `simulation-derived` and return artifact-based preview metadata (`artifactId`, `previewPath`, `previewToken`) instead of raw HTML; added `GET /api/artifacts/:artifactId/preview` in `worker/src/routes/artifacts.ts` with student ownership checks, preview-token verification, and sandbox-preview response headers; registered preview route in `worker/src/index.ts`.
- Shared types added/changed: none.
- Frontend pages/components added/changed: updated `frontend/src/pages/AssessmentPage.tsx` simulation flow to consume artifact-based responses and load sandbox preview via Worker artifact route/object URL instead of `srcDoc` raw HTML state; updated `frontend/src/lib/api.ts` with simulation preview fetch helper and new response shape.
- Tests added: added `worker/test/simulationArtifacts.test.ts` covering simulation artifact creation flow, preview-token enforcement, owned preview fetch, and audit payload redaction; expanded `worker/test/crypto.test.ts` with upload-vs-preview token scope assertions.
- Verification commands run: `npm run typecheck --workspaces --if-present` passed for shared, frontend, and worker; `npm test --workspaces --if-present` passed with shared 4 files/8 tests, frontend 2 files/5 tests, worker 8 files/33 tests. Frontend tests still emit Vite deprecation warnings about `esbuild`/`optimizeDeps.esbuildOptions`; no failures.
- Known limitations: simulation preview currently relies on artifact preview tokens generated at simulation time (not separately rotated or expired) and teacher-side simulation review is still pending Cycle 8.
- Next cycle handoff: Cycle 8 should implement teacher response review and teacher-mediated artifact preview/download using the same artifact storage path.

## Cycle 8 Completion Block

- DB migrations added: none.
- Worker routes added/changed: added `worker/src/routes/teacherReview.ts`; added `GET /api/teacher/attempts` (filters: `courseId`, `assignmentId`, `student`, `status`), `GET /api/teacher/attempts/:attemptId`, `GET /api/teacher/artifacts/:artifactId/preview`, and `GET /api/teacher/artifacts/:artifactId/download`; enforced teacher ownership by traversing assignment/course ownership before returning attempt or artifact data.
- Shared types added/changed: added `TeacherAttemptReviewArtifact`, `TeacherAttemptReviewListItem`, `TeacherAttemptReviewListResponse`, `TeacherAttemptReviewDetail`, and `TeacherAttemptReviewDetailResponse` in `shared/src/types.ts`.
- Frontend pages/components added/changed: added `frontend/src/pages/teacher/TeacherReviewPage.tsx` and `frontend/src/pages/teacher/TeacherAttemptReviewPage.tsx`; wired review routes in `frontend/src/App.tsx`; added review API helpers and teacher artifact fetch helpers in `frontend/src/lib/api.ts`; updated teacher workspace nav/deep-link resolver in `frontend/src/pages/teacher/TeacherWorkspace.tsx`; added review layout styles in `frontend/src/styles.css`.
- Tests added: added `worker/test/teacherReview.test.ts` covering owned attempt filtering, cross-teacher detail denial (`403`), mediated artifact preview, and review detail response shape; updated `frontend/test/teacherWorkspace.test.ts` to include `/teacher/review` deep-link normalization.
- Verification commands run: `npm run typecheck --workspaces --if-present` passed for shared, frontend, and worker; `npm test --workspaces --if-present` passed with shared 4 files/8 tests, frontend 3 files/10 tests, worker 9 files/37 tests. Frontend tests still emit Vite warnings about deprecated `esbuild`/`optimizeDeps.esbuildOptions` from `vite:react-babel`; no failures.
- Known limitations: teacher notes are currently a placeholder surface and are not persisted yet; Cycle 9 owns gradebook/notes persistence and reconciliation.
- Next cycle handoff: Cycle 9 should finalize gradebook entries, idempotent reconciliation, and final-grade precedence using the new teacher review surface.

## Cycle 9 Completion Block

- DB migrations added: `supabase/migrations/0007_gradebook.sql` adds `gradebook_entries` with unique `(assignment_id, roster_student_id)` and finalization fields (`approved_*`, `teacher_override_*`, `missing`, `published_at`), plus `roster_students.deactivated_at` for active/inactive roster filtering.
- Worker routes added/changed: added `worker/src/routes/teacherGradebook.ts`; added `GET /api/teacher/gradebook`, `POST /api/teacher/gradebook/rebuild`, `POST /api/teacher/attempts/:attemptId/approve-score`, `POST /api/teacher/gradebook/entries/:entryId/override`, `POST /api/teacher/gradebook/entries/:entryId/missing`, `POST /api/teacher/gradebook/entries/:entryId/clear`, `POST /api/teacher/gradebook/entries/:entryId/publish`, and `POST /api/teacher/gradebook/entries/:entryId/unpublish`; updated `worker/src/routes/teacher.ts` and `worker/src/routes/teacherAssessments.ts` to reconcile gradebook rows on roster commit/delete and assignment create/update archive transitions; updated `worker/src/routes/teacherReview.ts` to surface gradebook entry state in attempt detail.
- Shared types added/changed: added `TeacherGradebookFinalStatus`, `TeacherGradebookEntry`, `TeacherGradebookListResponse`, and `TeacherGradebookRebuildResponse`; replaced `teacherNotesPlaceholder` in `TeacherAttemptReviewDetail` with `gradebookEntry`.
- Frontend pages/components added/changed: added `frontend/src/pages/teacher/TeacherGradebookPage.tsx`; wired `/teacher/gradebook` route in `frontend/src/App.tsx`; added gradebook/finalization API helpers in `frontend/src/lib/api.ts`; expanded `frontend/src/pages/teacher/TeacherAttemptReviewPage.tsx` with approve/override/missing/clear/publish controls; added gradebook nav/deep-link handling in `frontend/src/pages/teacher/TeacherWorkspace.tsx`.
- Tests added: added `worker/test/teacherGradebook.test.ts` covering reconciliation row generation/idempotency, assignment-triggered reconciliation, final-grade precedence behavior, missing/clear/publish flows, archive visibility filtering, and ownership checks; updated `worker/test/teacherReview.test.ts` for gradebook-aware attempt detail; updated `worker/test/teacherAssessments.test.ts` fixture state for gradebook reconciliation dependencies; updated `frontend/test/teacherWorkspace.test.ts` for `/teacher/gradebook` deep-link normalization.
- Verification commands run: `npm run typecheck --workspaces --if-present` passed for shared, frontend, and worker; `npm test --workspaces --if-present` passed with shared 4 files/8 tests, frontend 3 files/10 tests, worker 10 files/44 tests. Frontend tests still emit Vite warnings about deprecated `esbuild`/`optimizeDeps.esbuildOptions` from `vite:react-babel`; no failures.
- Known limitations: roster deactivation UI/workflows are not yet exposed (only migration/storage support + filter handling are in place), and grade publish state is tracked server-side but student-visible release behavior is deferred to export/release cycles.
- Next cycle handoff: Cycle 10 should implement long/wide CSV grade exports with `grade_exports` audit records based on finalized gradebook entries.

## Cycle 10 Completion Block

- DB migrations added: `supabase/migrations/0008_grade_exports.sql` adds `grade_exports` audit table with format/options metadata (`include_unpublished`, `missing_mode`, selected assignment IDs, column order/labels) and row/column counts; table keeps metadata-only records and enables RLS with no client policies.
- Worker routes added/changed: updated `worker/src/routes/teacherGradebook.ts` with `POST /api/teacher/gradebook/export` for long/wide CSV export plus preview mode, option parsing (`includeUnpublished`, missing blank/zero, selected assignments, column order/labels), metadata-only audit writes, and migration guard for missing `grade_exports`; added CSV serializer/escaping helpers in `worker/src/lib/csv.ts`; wired route in `worker/src/index.ts`.
- Shared types added/changed: added `TeacherGradeExportFormat`, `TeacherGradeExportMissingMode`, `TeacherGradebookExportRequest`, and `TeacherGradebookExportResponse` in `shared/src/types.ts`.
- Frontend pages/components added/changed: expanded `frontend/src/pages/teacher/TeacherGradebookPage.tsx` with export controls (format, published filter, missing zero toggle, assignment selection, optional column mapping), preview count action, and CSV download action; added `exportTeacherGradebook` API helper in `frontend/src/lib/api.ts`; added `.compact-textarea` style in `frontend/src/styles.css`.
- Tests added: added `worker/test/csv.test.ts` for escaping/serialization behavior; expanded `worker/test/teacherGradebook.test.ts` with export preview/download behavior, long/wide format checks, missing-as-zero handling, ownership denial, and metadata-only audit assertions.
- Verification commands run: `npm run typecheck --workspaces --if-present`, `npm test --workspaces --if-present`, `npm run build`, and `npm run security:dist`.
- Known limitations: export column mapping UI is intentionally lightweight (manual key lists/label lines) and does not include vendor LMS presets or transformations; export remains CSV-only with no direct LMS API integrations.
- Next cycle handoff: Cycle 11 should deliver install/privacy/troubleshooting documentation and deployment workflow guidance, including grade export retention/purge operational notes.

## Cycle 11 Completion Block

- DB migrations added: none.
- Worker routes added/changed: none.
- Shared types added/changed: none.
- Frontend pages/components added/changed: none.
- CI/deploy workflows added/changed: added `.github/workflows/deploy-worker.yml` for Cloudflare Worker deploy from `main`, including concurrency guard, shared build/typecheck/test, required input validation, quoted runtime var injection, temporary secret-file deploy with Wrangler, and secrets-file cleanup trap; updated `.github/workflows/deploy-frontend.yml` to consume `VITE_BASE_PATH` from repository variables and publish `404.html` SPA fallback for deep-link support on GitHub Pages.
- Documentation added/changed: added `docs/install.md`, `docs/privacy.md`, and `docs/troubleshooting.md`; updated `README.md` for teacher-installable v1 entry points and verification commands.
- Install coverage delivered: Supabase auth/url setup requirements, migration order, private bucket expectations, GitHub vars/secrets matrix, Cloudflare deploy prerequisites, first-teacher setup flow, roster CSV format, grade export CSV behavior, and manual SQL purge guidance for `grade_exports`.
- Verification commands run: `npm run typecheck --workspaces --if-present`, `npm test --workspaces --if-present`, `npm run build`, and `npm run security:dist`.
- Known limitations: deploy workflows assume repository admins supply all required GitHub vars/secrets; there is no automated post-deploy smoke test yet.
- Next cycle handoff: Cycle 12A should implement security/privacy hardening expansion and strengthen automated release checks around deployment/runtime config drift.

## Cycle 12A Completion Block

- DB migrations added: none.
- Worker routes added/changed: updated `worker/src/lib/http.ts` to redact sensitive error details and sanitize sensitive error message text (SQL/storage/provider/path-like internals) from client-visible error responses while preserving safe validation details; updated `worker/src/routes/artifacts.ts` to clear cached `openai_file_id` whenever an artifact is re-uploaded so stale provider handles are not reused.
- Security scan updates: expanded `scripts/check-dist-secrets.mjs` patterns for `pin_hash`, `openai_file_id`, `storage_key`, `raw_response`, OpenAI keys, OpenAI `file-...` ids, Supabase service-role variable names, service-role JWT-like payloads, private storage path signatures, SHA-256-like hashes, and local Windows path signatures.
- Route audit scope: reviewed all teacher route files (`teacher.ts`, `teacherAssessments.ts`, `teacherReview.ts`, `teacherGradebook.ts`) for auth/ownership handling and denial behavior; all are still Worker-auth-gated and enforce teacher ownership before returning course/assignment/attempt/artifact/gradebook data.
- Frontend-visible response audit: confirmed teacher/student success payloads do not serialize backend-only fields such as `pin_hash`, `openai_file_id`, `storage_key`, raw provider payloads, or local file paths.
- Tests added/expanded: added `worker/test/http.test.ts` for error-detail/message redaction behavior; expanded `worker/test/teacherAssessments.test.ts` and `worker/test/teacherGradebook.test.ts` with extra cross-teacher denial cases; expanded `worker/test/simulationArtifacts.test.ts` to verify `openai_file_id` invalidation on artifact re-upload.
- Verification commands run: `npm run typecheck --workspaces --if-present`, `npm test --workspaces --if-present`, `npm run build`, and `npm run security:dist`.
- Known limitations: OpenAI Files API handles are cached and invalidated on re-upload, but there is still no dedicated background purge job for previously uploaded remote file handles or stale storage objects; cleanup remains lifecycle-bound to current workflows.
- Next cycle handoff: Cycle 12B should run release QA happy paths and deployment/runtime smoke checks using the hardened error and dist-scan gates.

## Cycle 12B Completion Block

- DB migrations added: none.
- Worker routes added/changed: removed legacy pre-migration course-schema fallback behavior in `worker/src/routes/teacher.ts` (`LEGACY_COURSE_SELECT` path); teacher course list/create/update/archive routes now return explicit `409` migration-required errors when `0003_teacher_courses.sql` metadata columns are missing.
- Shared types added/changed: none.
- Frontend pages/components added/changed: none.
- Model catalog/runtime hardening: moved simulation/fidelity model fallback mapping into `worker/src/lib/models.ts` (`fallbackModelId`) and updated `worker/src/lib/openai.ts` to use catalog-driven fallback selection instead of hard-coded model string checks.
- Tests added/expanded: updated `worker/test/openai.test.ts` for catalog-driven fallback behavior; expanded `worker/test/teacher.test.ts` with missing-course-metadata migration error coverage.
- Verification commands run: `npm run typecheck --workspaces --if-present`, `npm test --workspaces --if-present`, `npm run build`, and `npm run security:dist` all passed. Latest run: shared 4 files/8 tests, frontend 3 files/10 tests, worker 12 files/57 tests. Frontend still emits Vite deprecation warnings from `vite:react-babel` (`esbuild`/`optimizeDeps.esbuildOptions`) and a Node experimental CJS/ESM warning from `react-router-dom`; no failures.
- Manual happy path result: release smoke evidence captured in repo artifacts from `2026-04-29` local RC run (`smoke-teacher-home-worker-up.png`, `smoke-teacher-assessments-worker-up.png`, `smoke-teacher-assignments-worker-up-after-timeout.png`, `smoke-teacher-final-state.png`) covering teacher workspace navigation and stabilized worker-backed flows; corresponding Playwright traces/logs are in `.playwright-mcp/` (latest `2026-04-30T01:15Z` files).
- Old compatibility paths disposition: removed the old pre-`0003` teacher course-schema compatibility shim; retained non-demo compatibility paths only where tied to real migrated data/runtime resilience (legacy `attempts.assignment_id = null` handling and catalog-defined model fallback).
- Release status: teacher-installable v1 is complete.
- Deferred post-v1 scope (explicit): multi-teacher invitations, roster edit/reissue/deactivation UX, automated stale remote file/artifact purge jobs, LMS-specific export presets/API integrations, and post-deploy automated smoke tests.

## Cycle 13 Completion Block

- DB migrations added: none.
- Worker routes added/changed: updated student login identity-conflict responses in `worker/src/routes/student.ts` to emit structured lifecycle error code `same_course_identity_conflict`; extended `worker/src/lib/http.ts` so `HttpError` can carry optional lifecycle `code` and serialize `{ error, code, details }` while preserving sensitive-detail/message redaction behavior and legacy `{ error }` compatibility.
- Shared types added/changed: added `StudentAssignmentState`, `StudentDueState`, `StudentAttemptSummary`, `StudentPublishedGrade`, `StudentSimulationPreview`, and `StudentLifecycleErrorCode` in `shared/src/types.ts`; extended `StudentAssignmentSummary` with optional lifecycle fields (`state`, `dueState`, `latestAttempt`, `publishedGrade`, `simulationPreview`) to keep current payloads backward-compatible.
- Frontend pages/components added/changed: updated `frontend/src/lib/api.ts` so `ApiRequestError` now carries optional `code` and `details`; centralized API error parsing across anonymous/public/teacher fetch paths and teacher artifact fetch to preserve Worker-provided structured error contracts.
- Tests added/expanded: expanded `worker/test/http.test.ts` to cover structured code serialization and code retention when details are redacted; added `frontend/test/apiErrors.test.ts` to verify `ApiRequestError` captures structured `code`/`details` and fallback behavior when payload fields are missing.
- Verification commands run: `npm run typecheck --workspaces --if-present` and `npm test --workspaces --if-present`.
- Known limitations: only `same_course_identity_conflict` is emitted by current student lifecycle routes; additional lifecycle codes (`already_submitted`, `final_published`, `final_required`) are now contract-ready but will be wired to future route guards as those flows are introduced.
- Next cycle handoff: Cycle 14 should implement student identity guard rails and lifecycle enforcement paths that consume the structured error-code contract end-to-end.

## Cycle 14 Completion Block

- DB migrations added: none.
- Worker routes added/changed: updated `worker/src/routes/student.ts` with a pre-mutation same-course identity guard matrix for `POST /api/student/login`; same-user same-course different-PIN attempts now return `409` with `code: "same_course_identity_conflict"` and safe details, while different-user already-claimed PIN attempts keep existing `403` claimed-PIN behavior; guard branches execute before profile/membership/access-code/roster mutation paths.
- Login behavior matrix enforced:
  - same anon UID + same PIN + same course => idempotent success.
  - same anon UID + different PIN + same course => `409 same_course_identity_conflict` (no mutation).
  - different anon UID + already claimed PIN => existing `403` claimed-PIN rejection.
  - same anon UID + different course => allowed.
  - same anon UID + unclaimed PIN + new course => allowed first claim.
- Frontend pages/components added/changed: updated `/login` route behavior in `frontend/src/App.tsx` to allow an authenticated student session to open the login form again; updated `frontend/src/pages/Login.tsx` with a join-course mode and structured handling for `same_course_identity_conflict`; added a dashboard "Join another course" entry point in `frontend/src/pages/Dashboard.tsx` using the existing session + login endpoint flow.
- Tests added/expanded: expanded `worker/test/roster.test.ts` with five matrix-branch coverage and a no-mutation assertion for same-course conflict branches; added `frontend/test/loginPage.test.ts` for structured conflict message handling in login UI.
- Verification commands run: `npm run typecheck --workspaces --if-present` and `npm test --workspaces --if-present` passed (shared 4 files/8 tests, frontend 5 files/14 tests, worker 12 files/67 tests).
- Known limitations: lifecycle code handling is still focused on login identity conflicts in student flows; remaining lifecycle codes are reserved for later attempt/publish/submit guard cycles.
- Next cycle handoff: Cycle 15 should implement attempt-start precedence hardening, draft uniqueness enforcement, and publish-gate tightening.

## Cycle 15 Completion Block

- DB migrations added: `supabase/migrations/0009_student_lifecycle.sql` adds `attempts.due_at_snapshot` (audit-only), adds `attempts.submitted_after_due` defaulting false, normalizes duplicate draft attempts per `(student_id, assignment_id)` by keeping the newest and transitioning older drafts to `error` with one `attempt_audit_logs` row per transition (`route='migration:0009_draft_normalization'`, `provider='system'`, `model='none'`, `request_summary.reason='duplicate_draft_collapsed'`, `request_summary.kept_attempt_id`), and adds partial unique draft index `idx_attempts_unique_student_assignment_draft` on `(student_id, assignment_id)` where `status='draft'` and `assignment_id is not null`.
- Worker routes added/changed: updated `POST /api/attempts/start` in `worker/src/routes/attempts.ts` to enforce precedence (`final_published` published-final block with nullable `attemptId`, `already_submitted` submitted/graded block, existing-draft resume, error-state retry draft, no-attempt draft create), set `due_at_snapshot` on draft creation, backfill null `due_at_snapshot` when resuming legacy drafts, and recover from draft unique-index concurrency conflicts by returning the existing draft; updated `setTeacherGradebookPublished(..., true)` in `worker/src/routes/teacherGradebook.ts` to reject blank publish with structured `final_required` and keep valid re-publish as a no-op while leaving unpublish visibility-only; updated `clearTeacherGradebookGrade(...)` to reject clearing a published entry until the teacher explicitly unpublishes so blank-published states cannot be recreated.
- Shared types added/changed: none (existing lifecycle code union already covered `already_submitted`, `final_published`, `final_required`).
- Frontend pages/components added/changed: none required; existing API error plumbing already supports structured lifecycle codes and details.
- Tests added/expanded: rewrote and expanded `worker/test/assignmentAttempts.test.ts` with attempt-start precedence coverage (published-final block, submitted/graded block, draft resume/backfill, error retry, and unique-conflict draft reuse); updated `worker/test/teacherGradebook.test.ts` to cover `final_required` publish rejection, published re-publish no-op behavior, and clear-while-published rejection.
- Verification commands run: `npm run typecheck --workspaces --if-present` and `npm test --workspaces --if-present` passed (shared 4 files/8 tests, frontend 5 files/14 tests, worker 12 files/74 tests). Frontend still emits Vite deprecation warnings about `esbuild`/`optimizeDeps.esbuildOptions` and a Node experimental CJS/ESM warning from `react-router-dom`; no failures.
- Known limitations: lifecycle status projection for student dashboard cards remains deferred (current cycle enforces backend attempt-start/publish semantics without adding new student-facing state labels).
- Next cycle handoff: Cycle 16 should implement submission-claim, late-tracking (`submitted_after_due`), and related lifecycle/state propagation for student/teacher flows.

## Cycle 16 Completion Block

- DB migrations added: none (uses Cycle 15 `submitted_after_due` schema fields).
- Worker routes added/changed: added `worker/src/lib/attemptLifecycle.ts` with shared `claimAttemptSubmission(db, userId, attemptId, now)` and `markAttemptSubmissionError(...)`; claim helper enforces draft-only atomic claim (`status='draft' -> 'submitted'`), rejects archived assignments, computes/stores `submitted_after_due` from current `assessment_assignments.due_at`, sets `submitted_at` at claim time, and returns claim context. Updated `worker/src/routes/voice.ts`, `worker/src/routes/writing.ts`, and `worker/src/routes/simulation.ts` to use claim-before-provider flow and transition attempts to `error` on provider/runtime failures.
- Shared types added/changed: none.
- Frontend pages/components added/changed: none (submission semantics changed server-side only).
- Tests added/expanded: added `worker/test/attemptLifecycle.test.ts` covering on-time vs late claim semantics, due-date extension honoring, archived-assignment rejection, non-draft rejection, and double-submit race winner behavior; added `worker/test/submissionLifecycle.test.ts` covering voice/writing provider-failure transitions to `error`; expanded `worker/test/simulationArtifacts.test.ts` for claim-helper integration and simulation provider-failure `error` transition.
- Verification commands run: `npm run typecheck --workspaces --if-present` and `npm test --workspaces --if-present` passed (shared 4 files/8 tests, frontend 5 files/14 tests, worker 14 files/81 tests). Frontend still emits Vite deprecation warnings about `esbuild`/`optimizeDeps.esbuildOptions` and a Node experimental CJS/ESM warning from `react-router-dom`; no failures.
- Known limitations: claim-time lifecycle state is now centralized, but student-facing lifecycle rendering (`state`, `dueState`, published final projections) is still deferred to later student-release/result cycles.
- Next cycle handoff: Cycle 17 should implement published final result visibility + recovery semantics and complete student result-state projection using the consolidated submission lifecycle.

## Cycle 17 Completion Block

- DB migrations added: none.
- Worker routes added/changed: updated `worker/src/routes/attempts.ts` so `GET /api/attempts/:attemptId/result` now returns student-safe `publishedGrade` summaries (`finalScore`, `finalStatus`, `publishedAt`, and `feedback` only for `approved_ai`) and Worker re-signed `simulationPreview` metadata for owned uploaded `simulation-derived` artifacts; blank historical published rows are ignored defensively. Updated `worker/src/index.ts` to pass `env` into attempt-result token signing flow.
- Shared types added/changed: updated `shared/src/types.ts` student lifecycle contracts so `StudentPublishedGrade.finalStatus` is now constrained to student-safe published outcomes (`approved_ai`, `teacher_override`, `missing`), includes optional published feedback only for approved-AI finals, and `AttemptResult` now carries optional `publishedGrade` + `simulationPreview` recovery metadata.
- Frontend pages/components added/changed: updated `frontend/src/pages/AttemptResultPage.tsx` to render published final-grade summaries, load/reload recovered simulation previews via Worker-signed metadata after navigation/refresh, and clearly distinguish published final feedback from provisional feedback; updated `frontend/src/components/RubricFeedback.tsx` with configurable heading/subheading labels so final feedback is not mislabeled as provisional.
- Tests added/expanded: expanded `worker/test/assignmentAttempts.test.ts` with attempt-result projection coverage for published approved-AI finals, simulation preview metadata re-signing, and blank-published defensive filtering; added `worker/test/studentSessionProjection.test.ts` covering student-course payload publication visibility/suppression semantics and blank-published filtering; updated `worker/test/roster.test.ts` in-memory DB scaffolding to include `gradebook_entries` reads used by `student/me` course shaping.
- Verification commands run: `npm run typecheck --workspaces --if-present` and `npm test --workspaces --if-present` passed (shared 4 files/8 tests, frontend 5 files/14 tests, worker 15 files/88 tests). Frontend still emits Vite deprecation warnings about `esbuild`/`optimizeDeps.esbuildOptions` and a Node experimental CJS/ESM warning from `react-router-dom`; no failures.
- Known limitations: student dashboard assignment cards still do not render lifecycle state badges/actions (`state`, `dueState`, publish-state cues); Cycle 17 delivers backend/student-result contracts and result-page recovery behavior, but full dashboard lifecycle UX remains deferred.
- Next cycle handoff: Cycle 18 should enforce writing/simulation config constraints server-side (with aligned frontend defaults) so student submissions cannot rely on client-only config validation.

## Cycle 18 Completion Block

- DB migrations added: none.
- Worker routes added/changed: updated `worker/src/routes/artifacts.ts` so upload-token reservation now enforces attempt/type kind-gating (`audio` for voice attempts, `writing` for writing attempts, and rejects client-side `simulation-derived` reservations), writing reservations validate MIME and byte size against assessment config defaults (`acceptedMime` default `["image/png","image/jpeg","application/pdf"]`, `maxBytes` default `10485760`) before issuing upload tokens, malformed/empty configured MIME arrays now defensively fall back to shared defaults instead of rejecting all writing uploads, reservation `byteSize` must be a positive integer, and upload finalization now always enforces exact byte-size match to close zero-byte reservation bypasses; updated `worker/src/routes/simulation.ts` to enforce `description.trim().length >= assessment.config.minDescriptionChars` (default `40`) before submission claim/finalization.
- Shared types/constants added/changed: added `shared/src/assessmentConfig.ts` and exported constants via `shared/src/index.ts` for writing/simulation (and voice) default config values to reduce frontend/worker drift.
- Frontend pages/components added/changed: updated `frontend/src/pages/AssessmentPage.tsx` to use config-driven writing constraints (MIME + size), align voice max-recording fallback with shared defaults through validated resolver logic, and gate simulation submission by the configured minimum-description threshold; updated `frontend/src/components/PdfImageUploader.tsx` to enforce assessment-config MIME + max-size checks locally; updated `frontend/src/lib/uploadPolicy.ts` and `frontend/src/pages/teacher/TeacherAssessmentsPage.tsx` to consume shared default constants and normalized MIME handling instead of duplicated literals.
- Tests added/expanded: expanded `worker/test/simulationArtifacts.test.ts` with server-side rejection coverage for invalid writing MIME, oversize writing reservations, invalid/zero byte-size reservations, strict upload byte-size mismatch rejection, attempt-kind mismatches (`audio` on non-voice, `writing` on non-writing), client-blocked `simulation-derived` reservations, too-short simulation descriptions (including assertion that short simulation requests fail before submission claim), and a malformed-writing-config fallback regression case that must still accept default MIME types; expanded `frontend/test/uploadPolicy.test.ts` with MIME normalization and voice-config fallback coverage.
- Verification commands run: `npm run typecheck --workspaces --if-present` and `npm test --workspaces --if-present`.
- Known limitations: voice duration enforcement remains frontend-only in this cycle; no server-side audio-duration parser was added.
- Next cycle handoff: Cycle 19 should focus student dashboard lifecycle UX/release QA using the now-enforced server-side writing/simulation constraints.

## Cycle 19 Completion Block

- DB migrations added: none.
- Worker routes added/changed: updated `worker/src/lib/db.ts` student-session shaping so assignment rows now include deterministic lifecycle projection (`state`, `dueState`, `latestAttempt`) derived from published-final visibility and latest assignment attempt metadata; late submissions now project as `dueState="late_submitted"` using persisted `submitted_after_due`.
- Shared types added/changed: updated `shared/src/types.ts` with Cycle 19 lifecycle contract enums (`not_started`, `draft`, `submitted`, `provisional_ready`, `final_published`, `error_retry`; plus `none`, `due_soon`, `overdue`, `late_submitted`) and optional `StudentAttemptSummary.submittedAfterDue`.
- Frontend pages/components added/changed:
  - `frontend/src/pages/Dashboard.tsx` now renders state-driven cards with deterministic action mapping: start, continue draft, view submission, view final, and retry-after-error.
  - `frontend/src/components/AppShell.tsx` now exposes a workspace-nav `Join course` entry point to `/login`.
  - `frontend/src/pages/AssessmentPage.tsx` now handles structured lifecycle error codes (`already_submitted`, `final_published`, `final_required`, `same_course_identity_conflict`) and auto-routes to an existing attempt result when an attempt ID is provided.
  - `frontend/src/pages/AttemptResultPage.tsx` now explicitly separates published final status from provisional automated feedback headings.
  - Added `frontend/src/lib/studentLifecycle.ts` for centralized lifecycle state/action/error mapping.
- Docs updated:
  - `docs/troubleshooting.md` now explicitly lists unsupported UI flows: claimed-PIN reset, student reset-device/session-clear controls, teacher retake/reopen bypass controls, and calendar-based hard close automation.
- Tests added/expanded:
  - Added `frontend/test/studentLifecycle.test.ts` for deterministic dashboard action mapping, due/late derivation fallback, lifecycle error guidance, and structured attempt-id extraction.
  - Reworked `worker/test/studentSessionProjection.test.ts` to validate projected `state`, `dueState`, `latestAttempt`, late-submitted visibility, and blank-published final-grade filtering.
- Verification commands run: `npm run typecheck --workspaces --if-present`, `npm test --workspaces --if-present`, `npm run build`, and `npm run security:dist`.
- Release QA evidence summary:
  - Automated QA gates above now cover lifecycle projection and error-code UX contract behavior.
  - Manual release QA checklist remains: same anon UID multi-course joins, claimed-PIN rejection for different anon UID, deadline extension before submit, publish/unpublish student visibility round-trip, provider failure retry path, and archived-assignment submit rejection.
- Deferred post-cycle scope (explicit): no reset-device/session-clear UI, no claimed-PIN reset UI, no teacher retake/reopen UI override path, and no calendar hard-close policy automation in this release branch.

## Release Hardening Completion Block

- DB migrations added: `supabase/migrations/0010_release_hardening.sql` adds `claim_first_teacher(...)` with an advisory transaction lock for one-time setup and `claim_attempt_submission(...)` for atomic draft-to-submitted claims with assignment archive checks.
- Worker routes added/changed: student routes now require anonymous Supabase auth, teacher routes/setup require email auth, student login refuses to downgrade an existing teacher profile, `POST /api/teacher/setup` uses the first-teacher RPC, submission claim uses the lifecycle RPC, and `GET /api/assignments/:assignmentId/final` returns student-safe published final results even without an attempt.
- Shared types added/changed: added `StudentPublishedFinalResultResponse` for assignment-level final result views.
- Frontend pages/components added/changed: split student and teacher Supabase clients with distinct storage keys, moved `SessionProvider` out of the root and into student routes only, added `/final/:assignmentId`, and routed `final_published` dashboard/sidebar actions to the assignment final view.
- Docs updated: `docs/install.md` now lists migrations through `0010_release_hardening.sql` and notes the one-time sign-in impact from separate role storage.
- Tests added/expanded: added auth guard coverage, first-teacher concurrency coverage, teacher-profile downgrade rejection, RPC-backed submission claim tests including late archive, final-result route coverage for approved AI/override/missing/no-attempt/unpublished/unassigned cases, and frontend auth-separation/final-action tests.
- Verification commands run: `npm run typecheck --workspaces --if-present`, `npm test --workspaces --if-present`, `npm run build`, and `npm run security:dist` passed. Build still emits the existing large frontend chunk warning.
- Deferred post-cycle scope: transactional roster import remains a follow-up hardening task.

## Student Google Login Completion Block

- DB migrations added: `supabase/migrations/0014_student_google_login.sql` adds `profiles.email`, a normalized-email lookup index, and `claim_student_google_login(...)` for transactional roster email/PIN claim or legacy anonymous ownership transfer.
- Worker routes added/changed: student routes now require non-anonymous Supabase auth with email, student login delegates claim/transfer to the RPC, and roster email required/mismatch failures return structured student lifecycle codes.
- Frontend pages/components added/changed: student bootstrap no longer creates anonymous sessions; login uses Google OAuth first, then class code/PIN; app shell and login support student sign-out/switch-account.
- Docs updated: install/privacy/troubleshooting notes now require Supabase Google provider setup, `/login` redirect URLs, migration `0014`, and roster email for student login.
- Tests added/expanded: worker roster tests now cover Google email matching, idempotent re-login, same-course PIN conflicts, legacy transfer scoping, missing roster email, and teacher-profile rejection; frontend tests cover Google OAuth parameters and anonymous-session removal.

## Cycle 1 Auth Refinement Note

- DB migrations added: none.
- Worker routes added/changed: tightened teacher route auth guard naming/semantics so known OAuth/Google Supabase sessions are rejected from teacher routes before handler execution; `GET /api/teacher/me` now uses the verified JWT email when available instead of making an extra Supabase user lookup; setup-code comparison now uses a timing-safe string comparison.
- Shared types added/changed: none.
- Frontend pages/components added/changed: none.
- Tests added/expanded: expanded worker auth/JWT tests for provider metadata parsing and Google-session rejection on teacher routes; added production `TEACHER_SETUP_CODE` weak-secret rejection coverage.
- Verification commands run: `npm run typecheck --workspaces --if-present` passed; targeted `npm test --workspace worker -- auth.test.ts authJwt.test.ts teacher.test.ts` passed with 3 files/21 tests; `npm test --workspaces --if-present` passed with shared 6 files/10 tests, frontend 10 files/69 tests, and worker 19 files/144 tests. Frontend still emits the existing Vite deprecation warnings and React Router CJS/ESM experimental warning; no failures.
- Known limitations: teacher setup still relies on the one-time setup code and Supabase email/password frontend flow; provider metadata is used defensively to reject known non-teacher OAuth sessions, while legacy tokens without provider metadata remain accepted if they carry a verified non-anonymous email.
- Next cycle handoff: continue from the current implementation-plan status; no cycle-order change.

## Cycle 2 Course Refinement Note

- DB migrations added: none.
- Worker routes added/changed: added `worker/src/lib/courseCode.ts`; teacher course create/update and student login now share the same course-code normalization, so student-entered whitespace is handled consistently with teacher-created codes. Existing course archive/unarchive ownership behavior was verified through route-function tests.
- Shared types added/changed: none.
- Frontend pages/components added/changed: removed stale local `section`/`term` overlays from `frontend/src/pages/teacher/TeacherWorkspaceData.tsx` so course UI reflects Worker data after refresh; course refresh now accepts an explicit preferred course ID so newly created/updated course selection is deterministic.
- Tests added/expanded: expanded `worker/test/teacher.test.ts` with explicit cross-teacher archive rejection plus archive/unarchive persistence coverage, including hidden-by-default archived course behavior and include-archived visibility; expanded `worker/test/roster.test.ts` with spaced student course-code login coverage.
- Verification commands run: targeted `npm test --workspace worker -- teacher.test.ts` passed with 1 file/15 tests; targeted `npm run typecheck --workspace worker --if-present` passed; targeted `npm test --workspace worker -- roster.test.ts teacher.test.ts` passed with 2 files/35 tests; targeted `npm test --workspace frontend -- teacherWorkspace.test.ts` passed with 1 file/5 tests; `npm run typecheck --workspaces --if-present` passed; `npm test --workspaces --if-present` passed with shared 6 files/10 tests, frontend 10 files/69 tests, and worker 19 files/147 tests. Frontend still emits the existing Vite deprecation warnings and React Router CJS/ESM experimental warning; no failures.
- Known limitations: the database RPC still performs its own class-code lookup; the Worker is the supported student login path and now normalizes course codes before invoking that RPC. The existing `classes.code` unique constraint remains the v1 global uniqueness rule.
- Next cycle handoff: Cycle 3 remains reserved/skipped; Cycle 4 roster import remains the next historical implementation step in the documented cycle order.
