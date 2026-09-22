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
npm run test:db
npm run build
npm run check:bundle
npm run security
npm run audit
npm run build:worker
npx playwright install --with-deps chromium
npm run test:browser
```

## Deployment

For the assessment integrity release, follow the [migration order and release gates](docs/assessment-hardening.md) before deploying. Pushing to `main` runs validation; it does not deploy either application.

- Run **Deploy Worker** manually on `main` after applying the committed migrations and completing staging checks. Its required acknowledgement defaults to false. It runs both validation jobs, deploys the Worker, and checks that its URL matches the configured `VITE_WORKER_URL`.
- After the Worker succeeds, it calls `.github/workflows/deploy-frontend.yml` at the same commit to build, scan and deploy `frontend/dist` to GitHub Pages. The frontend has no independent push trigger.

See [`docs/install.md`](docs/install.md) for the complete Supabase, Cloudflare, OpenAI, GitHub, and OAuth configuration.
