# Cycle 19: Student Dashboard UX And Release QA

## Goal

Surface the hardened student lifecycle clearly in the UI and finalize release-quality documentation and QA evidence.

## Current Starting State

- Backend lifecycle contracts are available from prior student cycles:
  - assignment state
  - due/late metadata
  - structured attempt-start error codes
  - published final-grade summaries
  - simulation result preview metadata
- Student dashboard currently needs explicit state-driven actions and messaging.

## Read First

- `docs/implementation-status.md`
- `frontend/src/pages/Dashboard.tsx`
- `frontend/src/pages/AssessmentPage.tsx`
- `frontend/src/pages/AttemptResultPage.tsx`
- `frontend/src/state/session.tsx`
- `frontend/src/lib/api.ts`
- `frontend/src/components/AppShell.tsx`
- `docs/troubleshooting.md`

## Design Decisions

- Dashboard actions are state-driven and deterministic.
- Student UI must not expose reset-device, sign-out, or teacher-controlled retake/reopen mechanics.
- Provisional AI feedback and teacher-published final grades are visually and semantically distinct.
- Deferred scope is explicit to prevent accidental expansion in future sessions.

## Implement

- Update dashboard assignment cards to render lifecycle states:
  - not-started
  - draft
  - submitted
  - provisional-ready
  - final-published
  - error-retry
  - due-soon
  - overdue
  - late-submitted
- Map state to deterministic actions:
  - start
  - continue draft
  - view submission
  - view final
  - retry after error
- Add student "Join another course" flow in workspace navigation.
- Do not add reset-device or sign-out controls in this cycle.
- Update attempt result UI to clearly separate provisional AI feedback from published final-grade status.
- Wire structured error-code UI handling for:
  - `same_course_identity_conflict`
  - `already_submitted`
  - `final_published`
  - `final_required`
- Update docs:
  - `docs/implementation-status.md` cycle completion and deferred scope
  - `docs/troubleshooting.md` to explicitly state unsupported UI flows:
    - claimed-PIN reset
    - student reset-device
    - teacher retake/reopen
    - calendar-based hard close

## Acceptance Criteria

- Student can determine the next valid action from dashboard state without teacher intervention.
- No UI path clears anonymous student session state.
- Published final grades appear only after publish and disappear after unpublish.
- Late status is visible but does not permit repeated attempt creation.
- Deferred scope remains explicit in docs and status ledger.

## Verification

Run:

```bash
npm run typecheck --workspaces --if-present
npm test --workspaces --if-present
npm run build
npm run security:dist
```

Manual release QA should include:

- Same anon UID multi-course joins.
- Different anon UID claimed-PIN rejection.
- Deadline extension before submit.
- Publish/unpublish student visibility round-trip.
- Provider failure to error-retry path.
- Archived-assignment submit rejection.

## Status Ledger Update

Update `docs/implementation-status.md` with the Cycle 19 completion block. Include UI states/actions delivered, docs updates, release QA evidence summary, and explicit post-cycle deferred items.
