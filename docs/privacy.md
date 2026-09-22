# Privacy And Data Handling

This document defines the v1 privacy boundary for the deployed teacher-installable app.

## Security Boundary

- Frontend is untrusted for secrets and provider payloads.
- Worker is trusted for privileged Supabase + OpenAI operations.
- Supabase stores app records and private artifacts.

## Data That Must Stay Server-Side

Never expose these to browser state, URLs, CSV exports, or logs returned to end users:

- Supabase `service_role` key.
- Storage bucket keys and raw `storage_key` paths.
- PIN hashes and pepper values.
- OpenAI file handles (`file_id`) and raw provider responses.
- Teacher answer keys and private assessment-version definitions.
- Local filesystem paths or local temp-file metadata.
- SHA/SHA256-like hashes unless explicitly required for backend-only integrity logic.

## Attachment Lifecycle

Uploads receive new private object keys and expiring capabilities. Completed bytes cannot be overwritten. Submission binds completed artifact IDs and server-private hashes in a database transaction. Unsubmitted objects expire after seven days; submitted evidence is retained for teacher review until an institutional deletion policy is approved.

Provider copies are created lazily with a 24-hour expiry. Scheduled cleanup deletes cached provider files and expired unsubmitted objects, retries failures, and records cleanup results. Temporary live-voice collection state expires after one day; the authoritative submitted transcript is stored with the attempt. See [the retention policy and operator checks](assessment-hardening.md#retention-and-request-limits).

## Stored Artifacts

- Private storage buckets:
  - `audio`
  - `writing`
  - `simulation-sketch`
  - `simulation-derived`
- Browser receives opaque artifact IDs and Worker-mediated preview/download responses.
- `simulation-derived` HTML is stored as an artifact and served with Worker ownership checks.

## Authentication And Access

- Student flow: Supabase Google session and verified canonical email reconciled against the roster through Worker; legacy PIN claims cannot transfer historical evidence across user IDs.
- Teacher flow: Supabase email/password + one-time first-teacher setup gate.
- Teacher APIs enforce ownership via teacher profile + course/assignment traversal checks.
- RLS is enabled across core tables; privileged writes/reads are Worker-mediated with service role.

## Audit, Logging, And Exports

- Attempt audit logs capture request/response summaries needed for grading diagnostics.
- Grade export audit (`grade_exports`) stores export metadata (format/options/counts), not CSV payload bodies.
- Exported CSV content is teacher-initiated and intentionally excludes backend-only secrets and provider internals.

## Secret Rotation Impact

- If a Google OAuth client-secret JSON file was ever committed, synced, or shared outside local-only configuration, rotate that OAuth client secret in Google Cloud and delete the exposed JSON everywhere it may have been copied.
- Rotating `PIN_PEPPER` invalidates unclaimed student PINs and pending upload/preview tokens.
- Rotating `TEACHER_SETUP_CODE` only affects first-teacher setup if setup has not yet been completed.
- Rotating API keys may temporarily fail grading routes until Worker deploy completes with updated secrets.
