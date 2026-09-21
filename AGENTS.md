# Repository Guardrails

## Google OAuth Auth Module

Keep `frontend/src/auth` neutral and reusable. App-specific student, teacher, role, profile, and Worker behavior belongs outside that directory.

- Use a Supabase Google OAuth redirect from an app-owned button.
- Do not load Google Identity Services or call `google.accounts.id.renderButton`.
- Do not add `VITE_GOOGLE_CLIENT_ID`; Google provider credentials belong in Supabase.
- Keep PKCE and `detectSessionInUrl: false`; callback completion remains explicit.
- Keep OAuth on one stable origin for the full round trip. Local development uses `http://127.0.0.1:5173`.
- Never expose service-role keys, OpenAI keys, PIN peppers, setup codes, provider internals, local file paths, hashes, vendor file IDs, or private storage identifiers in the frontend.

## Required Checks

After auth or deployment changes, run:

```bash
npm run typecheck
npm test
npm run build
npm run security
```
