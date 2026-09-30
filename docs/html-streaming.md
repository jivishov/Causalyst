# HTML generation streaming

The sketch workflow, teacher-assigned model, reasoning effort, and output token
limit remain unchanged. New OpenAI HTML generation/refinement responses enable
both background execution and streaming. The start request returns as soon as
the provider acknowledges the job; generation continues after disconnect.

The authenticated `/api/simulation/jobs/:jobId/stream` endpoint verifies job
ownership and relays only output-text deltas, numeric replay cursors, heartbeats,
and the existing student job projection. It never forwards raw reasoning,
provider response IDs, tools, credentials, or provider errors. Connections rotate
after 55 seconds and reconnect to the same response from the last cursor. No new
generation is created by streaming, reconnects, or polling.

The Interactive Preview area shows elapsed time and an escaped, scrolling HTML
excerpt as code arrives. Partial HTML and JavaScript are displayed as text and
never executed. Existing working previews remain mounted while replacements are
generated. A completion signal wakes normal status polling immediately, which
claims, validates, and saves the complete artifact before it becomes runnable or
submittable. The submission preservation behavior remains intact.

Old non-streaming jobs and networks/providers that cannot stream use the existing
status-polling recovery path. Leaving a page disconnects streaming without
cancelling provider work; reopening a draft can replay the same background job.
Explicit cancellation still uses the existing cancellation endpoint. There are
no database schema or credential changes in this release.

Streaming exposes output sooner; it does not shorten the model's reasoning phase
or change its selected effort. Before the first HTML arrives, students see a
running status and elapsed time rather than a fabricated completion percentage.
