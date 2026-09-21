# Causalyst

Causalyst is a teacher-managed assessment workspace with a student assessment app. Teachers create courses, import rosters, build and assign assessments, review attempts, and publish grades. Students sign in with their school Google account to complete voice, writing, and simulation assessments.

## Architecture

- `frontend/`: React/Vite application for both `/teacher` and student routes, deployed to GitHub Pages.
- `worker/`: authenticated Cloudflare Worker API for teacher operations, student attempts, artifacts, and OpenAI-backed assessment processing.
- `shared/`: shared TypeScript contracts and assessment templates.
- `supabase/`: versioned PostgreSQL migrations, row-level-security policies, storage setup, and optional demo seed.
- `docs/`: installation, operations, privacy, testing, and troubleshooting guides.

Supabase Auth supports teacher email/password sessions and student Google OAuth sessions. Privileged database and OpenAI credentials are used only by the Worker.

## Local Development

Requires Node.js 22+ and npm 10+.

```bash
npm ci
cp frontend/.env.example frontend/.env
cp worker/.dev.vars.example worker/.dev.vars
npm run dev:worker
npm run dev:frontend
```

The frontend runs at `http://127.0.0.1:5173`; the Worker runs at `http://localhost:8787`.

## Verification

```bash
npm run typecheck
npm test
npm run build
npm run security
```

## Deployment

- `.github/workflows/deploy-worker.yml` validates, tests, and deploys the Cloudflare Worker. On success it records the Worker URL in `VITE_WORKER_URL` and dispatches the frontend workflow.
- `.github/workflows/deploy-frontend.yml` validates configuration, runs the full test/build/security suite, and deploys `frontend/dist` to GitHub Pages.

See [`docs/install.md`](docs/install.md) for the complete Supabase, Cloudflare, OpenAI, GitHub, and OAuth configuration.
