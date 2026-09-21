# Cycle 11: Install And Deployment Documentation

## Goal

Make the repo installable by a teacher from GitHub.

## Current Starting State

- Existing frontend GitHub Pages workflow exists.
- Worker deploy is manual via Wrangler.
- README has local student-app setup only or partial docs from earlier cycles.
- Teacher-installable v1 features should exist by this cycle.

## Read First

- `docs/implementation-status.md`
- `README.md`
- `.github/workflows/deploy-frontend.yml`
- `frontend/.env.example`
- `worker/.dev.vars.example`
- `worker/wrangler.toml`

## Design Decisions

- "GitHub installable" means code and frontend are installed/deployed from GitHub, while teacher still owns Supabase, Cloudflare, and OpenAI accounts.
- Do not claim this is GitHub Pages-only.

## Implement

- Add Worker deploy workflow using Cloudflare secrets.
- Add `docs/install.md`.
- Add `docs/privacy.md`.
- Add `docs/troubleshooting.md`.
- Update README for teacher-installable v1.
- Document Supabase setup explicitly: Email provider enabled, Anonymous sign-in enabled, email confirmation disabled for install-admin path or confirmation flow documented, site URL set, redirect allow-list includes GitHub Pages domain and localhost.
- Document migrations, storage buckets, GitHub vars/secrets, Cloudflare Worker secrets, OpenAI key, first-teacher setup, `PIN_PEPPER` requirements, and rotation impact.
- Document roster CSV and grade export CSV formats.
- Document manual SQL purge for `grade_exports`.

## Acceptance Criteria

- A teacher can follow docs from fork/template to deployed app.
- Required vars/secrets are listed exactly once and match env examples.
- Local setup still works.
- Run typecheck, tests, build, and `security:dist`.

## Verification

Run:

```bash
npm run typecheck --workspaces --if-present
npm test --workspaces --if-present
npm run build
npm run security:dist
```

## Status Ledger Update

Update `docs/implementation-status.md` with the Cycle 11 completion block. Include docs added, deploy workflow, env examples, verification results, and next handoff for security hardening.
