# Assessment integrity release

This implements the integrity and operational work from the 22 September 2026 review. It is a migration-bearing release. Technical tests use synthetic data; they do not establish grading quality or verify the production configuration.

The review stack is [private keys](https://github.com/jivishov/Causalyst/pull/1), [enrollment](https://github.com/jivishov/Causalyst/pull/2), [dependencies](https://github.com/jivishov/Causalyst/pull/3), and [evidence/grading](https://github.com/jivishov/Causalyst/pull/4), followed by [live voice and browser hardening](https://github.com/jivishov/Causalyst/pull/5) and [database types and Supabase integration](https://github.com/jivishov/Causalyst/pull/6). Retarget each dependent PR after its base merges; deploy the completed stack using the migration order below.

Local verification on Node 22.23.2 passed 332 distinct unit tests, replayed 27 migrations with five SQL suites in PGlite, and passed three Chromium browser tests. The production build, Worker dry run, bundle and secret scans passed; the audited dependency tree reported zero known vulnerabilities. Initial JavaScript measured 453,408 bytes / 132,630 gzip bytes. The browser executable was supplied locally because the standard browser download failed in this environment; CI installs Playwright's Chromium. Native PostgreSQL 17 migration replay and concurrent enrollment, submission, reservation and cleanup checks also passed in [GitHub CI](https://github.com/jivishov/Causalyst/actions/runs/35694434878). Hosted-provider behavior has separate gates below. The empty teacher-evaluation template correctly refuses to pass. Shared-package tests exclude compiled `dist` copies so local reruns and clean CI count the same source tests.

## Review map

| Finding | Implemented boundary | Verification |
| --- | --- | --- |
| Private answer keys | Separate student and grading contracts; student response whitelist; direct client access revoked; keys omitted from live instructions; old session cache discarded | Privacy unit tests and database role checks |
| Mutable submitted evidence | New storage keys, no overwrite, 15-minute upload capabilities, server SHA-256, completion/submission locks, immutable submission manifest | Upload route and database evidence tests; native concurrency suite |
| Untrusted voice evidence | Recorded voice requires provider transcription; live voice collects provider audio events through a private Durable Object; browser events are telemetry | Provider-event and forged-browser tests; live submission/grade database transactions |
| Live deadline | Browser uses the server expiry, flushes before cutoff, keeps transport until finalization; server allows two minutes to finish grading evidence committed before cutoff | Chromium automatic-completion test with delayed connection; cutoff unit tests |
| Partial or missed enrollment | Reconcile canonical verified Auth email on every session refresh; atomic profile, membership, roster and access writes; transactional roster import | Enrollment rollback/role tests and concurrent enrollment suite |
| Unchecked scores | Stable criterion IDs, exact rubric validation, explicit additive/capped/review-adjustment policies, server total calculation, approval gate for ambiguous legacy totals | Policy unit tests and teacher gradebook tests |
| Truncated gradebooks | Stable pagination through an empty page, bounded ID batches, count/duplicate checks, SQL reconciliation | 1,201-student gradebook/CSV fixture with a 73-row response cap |
| Unreserved/stuck jobs | Reserve before provider work, deterministic input key, one active generation per attempt, terminal-state guard, expiry and interrupted-work recovery | Job failure/idempotency tests; native concurrent reservation suite |
| Preview isolation | Parse/reconstruct HTML, reject resource URLs, put CSP inside the executing Blob, retain opaque-origin iframe sandbox | Chromium resource-blocking, parent-isolation and self-navigation tests |
| Mutable assessment context | Private immutable snapshot on attempt creation; UI loads the attempt snapshot; model, policy and prompt version recorded with grades | Snapshot/identity SQL tests and attempt routes |
| Retention/audit gaps | Scheduled cleanup, SQL tombstones before object removal, retry state and audit transaction, append-only grade history | Retention, service-role grants and concurrent cleanup/submission tests |
| Missing CI coverage | Validation on every PR including SQL-only changes; Node 22; PostgreSQL 17; unit, browser, bundle, dependency, secret and Worker build checks; disposable Supabase Auth/Storage/PostgREST integration and generated-type drift check | `Validate / checks` and `Validate / supabase` jobs |

The assessment page is split by modality. Job reservation, evidence collection, policy validation, quotas, pagination and retention have dedicated modules. Routes and PDF processing load lazily. The initial JavaScript budget is 500,000 bytes / 150,000 gzip bytes. Worker database clients now use migration-derived Supabase types. Further simplifying the simulation UI remains follow-up maintenance work.

## Database types and service integration

`worker/src/lib/database.generated.ts` is generated by Supabase CLI 2.81.3 from the migrations applied to a disposable local stack. Every Worker database client carries that schema type, including route parameters and maintenance helpers. The small application type in `database.ts` accounts for the snapshot trigger: attempt inserts omit `assessment_version_id`, which PostgreSQL supplies. The generated file itself is never hand-edited. Compile-time contracts reject unknown tables, columns, RPCs and missing required RPC arguments. JSON-returning RPCs still require runtime validation; generated types cannot validate JSON contents, database permissions, every CHECK constraint, or all RPC result nullability.

The separate `supabase` CI job starts real Auth, Storage and PostgREST containers, replays migrations against Supabase-owned schemas, generates and compares the committed types, and runs five integration tests. Synthetic accounts sign in through Auth; anonymous, student and unrelated-user clients must be denied private keys, snapshots and direct Storage access. Worker helpers exercise upload ownership, immutable bytes, submission manifests and complete 1,201-row CSV export with an actual 73-row PostgREST limit. The SQL role/transaction suites and concurrent races also run against that stack. Teardown removes its local data even when tests fail.

These tests use password sign-in and invoke Worker helpers directly. They do not verify deployed Google OAuth, Cloudflare routing, live provider calls, production settings or teacher grading quality. The staging gates below still apply. The setup follows Supabase's [type generation](https://supabase.com/docs/guides/api/rest/generating-types) and [environment management](https://supabase.com/docs/guides/deployment/managing-environments) workflows.

## Evidence and recovery rules

- Artifact bytes are written outside the PostgreSQL transaction. Each version has a new object key. SQL binds only completed, owned artifacts with a server hash; incomplete uploads cannot enter a submission. If object upload succeeds but its acknowledgement is lost, the retry verifies the stored bytes before completing the row.
- Cleanup claims an expired, unfrozen artifact under the same attempt lock as submission. Its tombstone prevents submission while object removal is in progress. A failed removal remains retryable. Submitted artifacts are preserved.
- Live submission atomically checkpoints the sealed transcript and moves the attempt/session to submitted/finalizing before requesting a grade. A failed grade therefore leaves trusted evidence for teacher review. Saving the grade and final session state is also atomic. Duplicate finalization cannot replace the winning request's evidence or downgrade a finalized session.
- Provider audio establishes captured words, not speaker identity, independent work, or transcript accuracy. Missing turns, late incomplete speech and interrupted sideband connections fail closed. Browser-authored text, roles and timestamps never become authoritative evidence.
- Job reservation prevents ordinary duplicate starts. Unknown provider outcomes are terminal failures requiring review, without automatic paid re-execution. This does not guarantee exactly-once provider billing. An explicit generate/refine action supplies a new request ID; transport retries reuse its serialized ID and return the existing job. New IDs still consume quota and cannot bypass the one-active-job rule. Legacy requests without an ID deduplicate by input.
- Simulation submissions continue to require teacher review and have no automatic provisional score.

## Retention and request limits

| Category | Policy |
| --- | --- |
| Pending or completed, unsubmitted artifacts | Eligible for cleanup after seven days |
| Submitted artifacts and assessment snapshots | Preserve for teacher review; deletion requires an approved institutional retention policy |
| Provider upload copies | Provider expiry set to 24 hours; writing cache deletion scheduled after one hour, simulation cache after one day; historical handles scheduled after one day |
| Temporary Durable Object transcript | Cleared after one day; submitted transcript remains with the attempt |
| Simulation jobs | Twenty-minute expiry; missing provider acknowledgement and interrupted finalization recover after two minutes |
| Interrupted live sessions / non-simulation submission | Session recovery after two minutes; submitted attempt recovery after ten minutes |
| Cleanup failures | Exponential backoff up to one day; stop automatic attempts after ten failures and require operator review |

Cleanup runs every ten minutes. Inspect failed scheduled invocations and `attempt_artifacts.cleanup_error` / `cleanup_attempts >= 10`; resolve the cause before resetting retry counters. Provider deletion and Storage deletion are idempotent external operations, followed by a transactional cleanup record and audit entry. A provider request whose file handle never reaches the database relies on provider expiry; the implementation cannot enumerate unknown provider objects from an absent handle.

The database reserves at most 60 AI units per student and 3,000 per course per UTC day, including failed or unknown outcomes. Recorded voice/writing cost three units, simulation HTML five, and live voice ten. Other simulation operations reserve their configured units in the Worker. Attempts are limited to twenty per assignment/student in 24 hours. JSON bodies are capped at 2 MiB and uploads at their reserved size. These are request-volume limits, not currency limits: configure provider account spending controls and alerts before enabling a classroom.

## Preview limitation

The effective Blob CSP blocks external resources and network APIs, and the iframe cannot access or navigate its parent. Arbitrary generated JavaScript can still navigate its own frame. The browser test deliberately records that limitation. Do not promise a network-free arbitrary-JavaScript sandbox or put confidential material into a preview. If zero outbound communication is required, disable generated HTML previews and use a constrained specification rendered by trusted code; a dedicated origin alone does not supply that guarantee.

## Migration and deployment order

1. Review the PR stack and run all checks. Require both validation jobs (`checks` and `supabase`) in branch protection before merging; repository settings are a separate administrator action. Use a disposable PostgreSQL database for `test:db` because its bootstrap creates fixture roles and schemas.
2. Back up the staging database and replay all migrations against a representative copy without student identifiers. Confirm Auth/Storage schema compatibility, Worker service-role grants and denied direct `anon`/`authenticated` access. The local PGlite run skips only the `pgcrypto` extension declaration; CI uses native PostgreSQL 17 and two separate connections for race tests. The additional disposable Supabase job checks real service integration, but it does not certify the hosted project's configuration or historical data.
3. Schedule an assessment maintenance window. The new manifest-aware submission function and snapshot requirement are incompatible with the old Worker submission path. Apply the pending SQL migrations in filename order, deploy the matching Worker with the `REALTIME_SESSIONS` Durable Object migration and cron, then deploy the frontend. Do not roll the Worker back alone against this schema.
4. Run staging journeys with synthetic teacher and student accounts: returning-student enrollment in a newly added course, roster import rollback, interrupted upload, attempted post-submit overwrite, teacher edits during a draft, capped rubric approval, large CSV export, cancellation/late provider results, and cleanup retries.
5. Validate real provider sideband attachment, speech committed at the deadline, delayed transcription, manual and automatic completion, transport interruption, and hangup. The browser fixture mocks WebRTC/provider calls and cannot certify those deployed integrations. Confirm provider file expiry and scheduled cleanup in staging.
6. Complete the [teacher evaluation gate](../evals/README.md), then a small supervised classroom trial on school devices and Wi-Fi. Record acceptance criteria and results before enabling consequential use.

Historical attempts receive a migration-time snapshot marked `legacy_capture`; it is not a reconstruction of the original rubric or answer key. Legacy uploaded artifacts may lack hashes and a draft may require re-upload. Previously delivered answer keys cannot be revoked from downloaded data: replace affected confidential assessments before consequential reuse. Existing published grades remain stored; unvalidated legacy AI recommendations require an explicit teacher decision rather than one-click approval.

Legacy PIN login no longer transfers historical attempts between different Auth user IDs. Such records require reviewed administrator identity reconciliation. Verified email enrollment is the supported routine path, and teacher profiles cannot be converted into student profiles by enrollment.

## Verification commands

```bash
npm ci
npm run typecheck
npm test
npm run test:db
npm run build
npm run check:bundle
npm run security
npm run audit
npm run build:worker
npx playwright install --with-deps chromium
npm run test:browser
```

Use `TEST_DATABASE_URL` only for a disposable localhost database to enable native concurrency checks. `PLAYWRIGHT_CHROMIUM_EXECUTABLE` can select an existing Chromium executable in restricted development environments. No tests require live provider keys, production data, or paid model requests.

With Docker available, run the real Supabase suite separately:

```bash
npm run supabase:start
npm run db:types:check
npm run test:supabase
npm run supabase:stop
```

The dedicated `causalyst-ci` stack is disposable: `supabase:stop` deletes its local database volumes. It must contain only synthetic test data. After adding a migration, stop and restart that stack, run `npm run db:types`, and commit the generated file with the migration. CI regenerates it and fails on drift or a missing tracked file. The wrappers use local CLI credentials and reject non-local URLs; they never use a linked hosted project.
