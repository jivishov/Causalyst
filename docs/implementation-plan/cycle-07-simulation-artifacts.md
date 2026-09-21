# Cycle 7: Simulation Artifact Storage Cleanup

## Goal

Move generated simulation HTML out of inline/audit-only handling and into server-side artifact storage.

## Current Starting State

- `simulation-derived` bucket and `attempt_artifacts.kind = 'simulation-derived'` already exist.
- Current simulation route returns generated HTML inline to the frontend.
- Current audit logging may store raw HTML.
- Teacher review is not implemented yet, so this cycle must preserve student simulation rendering.

## Read First

- `docs/implementation-status.md`
- `worker/src/routes/simulation.ts`
- `worker/src/routes/artifacts.ts`
- `worker/src/lib/openai.ts`
- `frontend/src/pages/AssessmentPage.tsx`

## Design Decisions

- `simulation-derived` bucket and artifact kind already exist.
- Simulation generated HTML is stored as a `simulation-derived` artifact.
- Frontend receives opaque artifact ID and Worker-mediated preview access.
- Audit logs store metadata and summaries, not full raw HTML.
- Preview remains sandboxed.

## Implement

- Update simulation generation route to store HTML in Supabase storage under `simulation-derived`.
- Create or update `attempt_artifacts` row for generated HTML.
- Return artifact ID and preview metadata, not raw HTML.
- Add Worker preview route for simulation artifact with attempt/student ownership checks.
- Update student UI in the same cycle so simulation preview loads through the Worker artifact route.
- Remove full simulation HTML from audit raw response.

## Acceptance Criteria

- Existing student simulation flow still renders end-to-end after response shape changes.
- Student-side preview uses Worker artifact route in the same cycle.
- Storage key is never exposed.
- Generated HTML is not persisted in frontend-visible state except as sandbox-loaded preview content.
- Teacher review can later reuse the same artifact path.
- Tests cover artifact creation, preview authorization, no raw HTML in audit payload, and simulation flow regression.

## Verification

Run:

```bash
npm run typecheck --workspaces --if-present
npm test --workspaces --if-present
```

## Status Ledger Update

Update `docs/implementation-status.md` with the Cycle 7 completion block. Include simulation response-shape changes, artifact route details, audit payload changes, tests, and next handoff for teacher review.
