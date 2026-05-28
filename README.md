# Causalyst Student Assessment

Student-only GitHub Pages frontend for Causalyst.

This repository intentionally contains only the static student frontend and shared client contracts. The Worker API, Supabase migrations, teacher workspace, server secrets, and local environment files are not part of this Pages repository.

## GitHub Pages

The Pages workflow builds `frontend/dist` and deploys it with GitHub Actions.

Required repository variables:

- `VITE_BASE_PATH`: `/Causalyst/`
- `VITE_SUPABASE_URL`: public Supabase project URL
- `VITE_SUPABASE_ANON_KEY`: public Supabase anon key
- `VITE_WORKER_URL`: deployed Causalyst Worker API origin

Student Google OAuth redirect URLs must include:

```text
https://jivishov.github.io/Causalyst/login
```

## Local Verification

```bash
npm install
npm run typecheck
npm run build
npm run security:dist
```
