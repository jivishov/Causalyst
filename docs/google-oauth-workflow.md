# Google OAuth Workflow

This document is the source-of-truth workflow for this reusable auth template.

## Critical Rules

- Login starts from an app-owned button and calls Supabase `signInWithOAuth({ provider: "google" })`.
- Do not load `gsi/client`.
- Do not call `google.accounts.id.renderButton`.
- Do not require or add `VITE_GOOGLE_CLIENT_ID`.
- Keep `detectSessionInUrl: false`.
- Complete callbacks manually on the configured callback route, default `/auth/callback`.
- Keep one browser origin for the whole OAuth round trip. Local development defaults to `http://127.0.0.1:5173`.
- Keep this module auth-only. Add roles, profile loading, and backend authorization in app-specific code outside `frontend/src/auth`.

## Routes

- `/login`: public login page.
- `/auth/callback`: manual Supabase OAuth callback page.
- `/`: protected demo route guarded by `AuthGate`.

## State

Auth status:

- `checking`
- `signed_out`
- `authenticated`
- `error`

Visible auth steps:

- `checking_existing_session`
- `completing_google_callback`
- `reading_google_session`
- `resetting`
- `idle`

## Algorithm

1. The app starts inside `AuthProvider`.
2. `AuthProvider.refresh()` checks the current URL and existing Supabase auth storage.
3. If the current path is the configured callback path and has callback markers, it runs `completeAuthCallbackIfPresent(...)`.
4. Callback markers include:
   - `?code=...`
   - hash `access_token` and `refresh_token`
   - provider error markers such as `error`, `error_code`, or `error_description`
5. PKCE code callbacks read the stored verifier from:

```text
google-oauth-template.auth-code-verifier
```

6. The app exchanges the code with:

```ts
authSupabase.auth.exchangeCodeForSession(code)
```

7. Hash token fallback uses:

```ts
authSupabase.auth.setSession({ access_token, refresh_token })
```

8. After success or provider error, callback URL markers are removed with `history.replaceState`.
9. `AuthProvider` reads the resulting session and enters `authenticated`.
10. If no valid session exists, the user remains signed out or sees a visible error.
11. `AuthGate` renders protected content only when `status === "authenticated"`.

## OAuth Start

`signInWithGoogle()` starts OAuth with:

```ts
authSupabase.auth.signInWithOAuth({
  provider: "google",
  options: {
    redirectTo: resolveAppUrl(authConfig.callbackPath),
    queryParams: { prompt: "select_account" }
  }
});
```

## Recovery

Use `resetAuth()` when:

- The browser changed host, port, profile, or private browsing state.
- The callback reports a missing PKCE verifier.
- The user wants to clear local auth state.

Reset removes only keys owned by this module:

```text
google-oauth-template.auth
google-oauth-template.auth-*
```

## Troubleshooting

### Stuck At Completing Google Sign-In

Check:

- The browser returned to `/auth/callback`.
- The URL contains `code`, hash tokens, or provider error markers.
- The storage key `google-oauth-template.auth-code-verifier` exists before exchange.
- The callback redirect URL is listed in Supabase Auth settings.

### Missing PKCE Verifier

Usually caused by changing one of these between OAuth start and callback:

- host
- port
- browser profile
- private browsing state

Use Reset sign-in and restart from `http://127.0.0.1:5173/login`.

### Redirect URL Rejected

Add the exact callback URL to Supabase Auth redirect URLs:

```text
http://127.0.0.1:5173/auth/callback
```

For deployed apps, add the deployed callback URL too.

## Required Checks

Run after every auth-related change:

```bash
npm run typecheck
npm run test
npm run build
```
