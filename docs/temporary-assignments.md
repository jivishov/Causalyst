# Temporary assignments: implementation and operations

Implementation baseline: `66464f5a2d3d60aeea09f5e7177e2eed3447cb93` (14 October 2026 handoff). This is an additive feature, disabled for creation and processing in the migration defaults. This document does not authorize a production deployment or an identity-provider change.

## Delivered behavior

Teachers publish an owned simulation assessment for 24, 48 or 72 hours, with a separate submission deadline before expiry. Publication freezes the student-visible question and rubric. Teachers distribute individual, one-time-displayed capability links from `/teacher/temporary`; the plugin returns that authenticated page, never student credentials.

The guest route `/s/:publicId` is outside the student authentication gate. Fragment credentials are exchanged for Secure, HttpOnly, host-only SameSite=Strict cookies. Reloads use the cookie. Reissue preserves work and invalidates older credentials and sessions. A code identifies a participant in the teacher's local records; it is not proof of identity. No guest student profile, email, roster or anonymous Supabase account is created.

An open guest tab pins its reads and writes to the session established at load. Opening another participant's private link in the same browser stops the first tab rather than switching its identity or saving its draft to the other participant. Reopen the intended private link to continue.

Drafts are autosaved with optimistic version checks. Submission creates an immutable response revision and a separate `teacher_client` job. Each new response snapshots the effective assessment/default HTML-generation prompt context. Earlier accepted simulations stay attached to their original responses. Teacher prompt defaults are unchanged by this feature. There is no provider inference call or API fallback in this mode.

The connected client claims 1 job by default, at most 3. Reservations last 15 minutes, are capped at assignment expiry and use fencing versions. A client/session can renew or release its own claims. Expired leases display waiting/failed rather than indefinitely claiming active processing. Technical failures allow three attempts per generation version; the teacher can explicitly retry a failed generation up to three versions. There is one accepted artifact per job; retrying an identical successful save returns it. Model/client provenance is explicitly reported or unknown, never inferred from an OAuth client ID.

Grades are immutable versions pinned to the response and optional simulation selected when graded. Saving from MCP requires the teacher's approval; the tools do not publish grades. The teacher UI's save button is the explicit approval action.

Publication, submission and grade retries recover accepted records before reserving more storage. Reused keys with changed payloads conflict. An accepted submission can be recovered after submissions close, while current credentials and hosted expiry still apply. Accepted simulation retries compare the original client source and reported provenance, so a later validator/runtime version cannot rewrite or invalidate the saved result.

The browser assembles HTML reports and selected/all ZIPs without inference. Reports preserve Unicode text, the exact effective simulation bundle, inert source, selected grade evidence and timestamps. Local names stay in tab memory and exported files. Missing latest simulations create labeled response-only reports. Earlier revisions and unsubmitted drafts are explicit options. Selection pins response/artifact/grade IDs before content fetching; omissions make the ZIP partial and are enumerated in its manifest. HTML uses a sandboxed frame and a download attachment, never application-origin execution.

The individual HTML action pins the row the teacher clicked even when a newer response arrives during refresh. Unavailable explicit selections produce manifest omissions; they cannot become a complete empty export. The owner invitation page includes a separate emergency revocation list with activity references, teacher emails and expiry only. It can revoke a disabled colleague's activity without granting the owner access to their student evidence.

Changing activities, including after publishing another one, clears earlier distribution links, review state and local names. Evidence from a previous activity is not rendered under the newly selected activity.

## Code and storage boundaries

- `shared/src/temporary.ts`: versioned public wire contract and conservative defaults.
- `worker/src/lib/temporary.ts`: shared authorization-aware application services and Storage operations.
- `worker/src/routes/temporary.ts`: bounded HTTP adapters, cookie exchange and CSRF/origin checks.
- `worker/src/lib/temporaryTools.ts`: MCP adapters; existing tool IDs and endpoint identity are preserved.
- `worker/src/lib/temporarySimulation.ts`: validate source, reject forged runtime markers, transform once, and store the complete effective runtime plus CSP.
- `frontend/src/pages/GuestAssignmentPage.tsx` and `teacher/TeacherTemporaryPage.tsx`: guest and teacher workflows.
- `frontend/src/lib/temporaryReports.ts`: deterministic standalone reports and ZIP STORE assembly.
- `explain_temporary`: unexposed schema with service-only tables and RLS. Public RPC execution is revoked from browser roles. Student content is in the private `temporary-evidence` bucket, never content columns in permanent tables.

Content uploads reserve bytes before Storage writes. Inventory precedes upload. Final metadata commits recheck grants, live sessions, deadlines, revisions and reservations. Downloaded bytes are checked against the committed server-side digest before use. Temporary content metadata is not projected directly to clients.

The existing 10-minute scheduler runs temporary cleanup independently from permanent retention. Frozen/graded/exported temporary work still expires. Object inventory survives Storage failures with bounded retry backoff; a cursor-based sweep detects abandoned/orphaned objects. Persistent retry counts are available to the owner and failures emit content-free operator log codes. The healthy-service target is removal within one hour after expiry; monitor it under real pilot load. Access is denied at the authoritative deadline even if deletion is delayed. Cleanup remains active when new creation or processing is disabled.

Database backups include minimized metadata according to the actual provider retention policy. Object deletion does not recall downloaded reports, browser bytes, AI conversations, or provider copies. Before release, record the project's actual backup retention and verify restoring expired metadata still denies access and resumes cleanup.

## Operator setup after release authorization

1. Verify the selected existing owner UUID against the authenticated Explain owner and `auth.users`/`profiles`. Do not choose the first visitor or infer an owner from a domain. Apply the two committed additive migrations to staging first. The migration filenames were created with the installed Supabase CLI; no production migration was run during implementation.
2. Seed `explain_temporary.application_owner_grants(user_id)` using that verified UUID. Seed `explain_temporary.teacher_access(email,teacher_id,actor_id,redeemed_at)` from the same verified `auth.users` row, requiring `email_confirmed_at is not null`, `is_anonymous=false` and an existing teacher profile. Use normalized exact email and the stable UUID. The seed must return exactly one intended account. Do not paste credentials into SQL or documentation.
3. Review every existing authorized teacher deliberately and backfill their exact verified email/UUID grant. The owner control refuses to enable admission enforcement while an existing teacher profile has no reviewed grant. Never bulk-trust a domain or transfer records based only on an email match. Existing identity replacement/email recovery needs deliberate owner-assisted authenticated linking; no automatic rebind endpoint is provided.
4. Configure `TEACHER_ADMISSION_ENFORCED=true` for fresh session checks on all legacy teacher operations. The database grant restriction applies to web/MCP operations and exposed legacy database/storage policies regardless of this optional extra session-check flag. `/api/teacher/me` redeems active invitations and provisions the teacher profile from server-verified identity. Keep existing Supabase PKCE OAuth, resource audience hook, approved client IDs and native callback unchanged.
5. Provision the guest Worker hostname (normally `api.explain.az`) with HTTPS. Set `TEMPORARY_API_ORIGIN=https://api.explain.az`, `TEMPORARY_SITE_ORIGIN=https://explain.az` and the matching `VITE_GUEST_API_ORIGIN`. Use one canonical website origin; redirect `www` if needed. The existing MCP resource stays on its current hostname. Do not depend on third-party cookies between Explain and workers.dev. For staging use same-site HTTPS hostnames and exact matching origins.
6. In the owner controls, enable invitation enforcement, then creation and processing only after staging acceptance. Defaults are 40 participants, 6 submitted revisions each, 40 MB per assignment, 240 jobs and 10 active activities per teacher. Owner-controlled settings bound participant/revision/storage/job quotas; the browser export budget is 40 MB and 300 files. Use smaller selected exports when exceeded.
7. Validate raw private navigation and reload on the intended school browser/Chromebook. GitHub Pages already copies the SPA into `404.html`; the new route does not introduce a login redirect. Check cookies, no-store headers, CSRF rejection, revoked links and wrong participants using real staging HTTP/Storage services.
8. Complete the host acceptance matrix below, then run a small owner-only trial, an invited-colleague trial and a classroom pilot. Do not treat package validation or tools/list as a full host workflow.

Teacher removal blocks new teacher access/processing. Existing guest work retains its original expiry. An owner can revoke an activity immediately with the protected revoke operation; this triggers cleanup as well as denying access.

## Verification and host profiles

Run repository gates with a supported Node 22/24 runtime. On Windows, `node scripts/verify-temporary.mjs` runs workspace typechecks, bounded unit suites, disposable database tests, builds, security scans, the Worker dry-run and dependency audit, and saves results under ignored `test-results/`. `npm run test:db` uses PGlite by default; `TEST_DATABASE_URL` may target only disposable localhost PostgreSQL. Native PostgreSQL adds 30-way submission/retry, parallel-claim and stale-fence races. No production fixture or inference call is required.

Additional meaningful checks:

- `worker/test/temporaryWorkflow.test.ts`: synthetic 30-participant submission, actual MCP transport round trip, idempotent result commit, grade pinning, digest checks and expiry deletion, with all network calls forbidden.
- `scripts/test-db/temporary.test.sql`: verified admission, fresh sessions, provision/revoke/isolation, reissue, closed-vs-expired behavior, reservation fencing and persistent cleanup inventory.
- `frontend/test/temporaryReports.test.ts`: exact response/source fidelity, escaping, missing-simulation labeling, deterministic ZIP structure and safe filenames.
- `frontend/test/temporaryTeacher.test.tsx` and `temporaryGuest.test.tsx`: clicked-revision export races, partial selections, lost publication replies, owner revocation and guest session replacement.
- `worker/integration/temporary.test.ts`: the temporary workflow through disposable real PostgREST/private Storage, direct-access denials, and a failed deletion followed by successful cleanup.
- `e2e/temporary-evidence.spec.ts`: an actual standalone `file://` report opened with networking disabled, preserving controls/reset and source; guest deep-link navigation/reload and responsive layout.

`npm run build:plugins` creates allowlisted portable, native Codex and Claude Code profiles under ignored `dist/plugins/`. Existing native client ID/callback and internal identity remain unchanged. `scripts/build-explain-plugins.py --sync-sources` synchronizes the canonical skill and shared temporary guidance before packaging. It never changes installed host skills or live app registration. Claude Code's local manifest validator can validate the built profile; Claude web/Desktop connectors require their own actual supported setup, not this Code plugin archive.

| Acceptance surface | Current evidence | Remaining gate |
| --- | --- | --- |
| Local application | SQL, synthetic MCP, unit and browser tests | Complete final CI and real staging Storage/cookie integration |
| ChatGPT web / Work | Existing connection identity preserved | New full workflow, export-page opening, reconnect and renewal in the intended account |
| Codex desktop / CLI | Native package identity and callback preserved | New full workflow plus reconnect/renewal |
| Claude web | Host-neutral core tools | Actual supported OAuth registration/callback, complete workflow and renewal |
| Claude Desktop chat | Host-neutral core tools | Separate connector setup, complete workflow and renewal |
| Claude Code | New profile; local manifest validation | Register/allowlist its actual OAuth client and callback, full workflow and renewal |
| School Chromebook | Guest browser tests with synthetic HTTP fixtures | Real managed-device/network and same-site cookie acceptance |

Use the existing Supabase issuer first. If a real host flow fails, record its actual failure; do not loosen audience/session/client validation or substitute Auth0 speculatively. Auth0 remains a conditional separately scoped adapter.

## Rollback

Set `enabled=false` and `processing_enabled=false` through owner settings to stop creation and new processing. Keep authorized review/export and cleanup deployed until all active activities expire and their inventory is deleted. Do not roll back to a Worker lacking cleanup while temporary content remains. Additive tables can remain dormant. Existing permanent assessment data and generation jobs are not migrated or deleted. No production merge, deployment, provider setting change or real student-data processing was performed as part of local implementation.

Reference documentation checked during implementation: [Cloudflare Worker practices](https://developers.cloudflare.com/workers/best-practices/workers-best-practices/), [Supabase private buckets](https://supabase.com/docs/guides/storage/buckets/fundamentals), [Storage schema deletion](https://supabase.com/docs/guides/storage/schema/design), [Claude plugin manifests](https://code.claude.com/docs/en/plugins-reference), and [Claude MCP configuration](https://code.claude.com/docs/en/mcp). Provider and host details remain acceptance targets, not an assertion of live verification.
