# Temporary assignments staging pilot

The pilot uses a separate Cloudflare Worker and the existing Causalyst Staging Supabase project. It does not require merging the feature branch into main.

| Resource | Staging target |
| --- | --- |
| Website and API | `https://staging.explain.az` |
| Worker | `explain-staging` (`--env staging`) |
| Database | `nscgqhsfudbnzfayvrnl` (Causalyst Staging) |
| MCP resource | `https://staging.explain.az/mcp/teacher` |

The frontend and API share one HTTPS origin for guest HttpOnly SameSite=Strict cookies. Static assets use SPA fallback for guest deep links. API, MCP and discovery paths reach the Worker. The separate Worker's Durable Object bindings reference no production namespaces; its ten-minute cleanup cron remains enabled.

`APP_ENV=production` retains strong-secret and origin checks. `--env staging` selects the separate resources.

## Recorded setup state, 15 October 2026

- The existing paused staging database was restored and is healthy.
- The committed teacher-assignment prompt and temporary-assignment schema migrations were applied.
- Verified 11 temporary tables with RLS, a private evidence bucket, and disabled creation/processing.
- `20261014182440_temporary_operations.sql` is still pending. Inspect migration history before retrying an interrupted operation.
- Staging has no teacher profile or verified owner account yet.
- The staging Worker, domain, secrets, website and plugin connection have not been deployed. There is no usable pilot URL yet.

Local execution and browser automation currently fail at startup because Linux workspace permission paths were supplied to the Windows host. Resume in a working session.

## Complete setup

1. Require green Validate checks for the feature revision, including the staging package dry-run. Confirm the connected Cloudflare account owns `explain.az`.
2. Apply the remaining committed operations migration to staging only. Verify `temporary_command` exists and can be executed by the service role, but not by `anon` or `authenticated`.
3. Configure this project's Supabase Auth site URL and exact frontend callback URLs on `https://staging.explain.az`. Retain PKCE and explicit callback completion. Configure staging provider registration separately; do not change production Auth.
4. Set staging-only Worker secrets with interactive `wrangler secret put NAME --env staging` prompts: `SUPABASE_SERVICE_ROLE_KEY`, `PIN_PEPPER` (at least 32 high-entropy characters), and `TEACHER_SETUP_CODE` (at least 16 high-entropy characters). Obtain the service credential through the authenticated Supabase dashboard. Do not print, commit, pass secrets as command arguments, or reuse production secrets. Temporary teacher-client processing requires no provider API key.
5. Build from the repository root with the public frontend environment below.

| Variable | Value |
| --- | --- |
| `VITE_BASE_PATH` | `/` |
| `VITE_WORKER_URL` | `https://staging.explain.az` |
| `VITE_GUEST_API_ORIGIN` | `https://staging.explain.az` |
| `VITE_SUPABASE_URL` | `https://nscgqhsfudbnzfayvrnl.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | This staging project's enabled publishable key |

```sh
npm ci
npm run typecheck
npm test
npm run build
npm run security
npm exec --workspace worker -- wrangler deploy --env staging --dry-run
npm exec --workspace worker -- wrangler deploy --env staging
```

The final command deploys the staging Worker, frontend assets and custom domain. Ensure the frontend uses the real staging publishable key, not the CI fixture. Run Worker secret commands from the `worker` directory, or through `npm exec --workspace worker --`. The default `wrangler deploy` command targets the existing live Worker.

6. Sign in as the intended owner on staging. Verify this project's `auth.users` UUID, confirmed exact email and non-anonymous identity. Deliberately provision its teacher profile and seed owner/admission grants from that verified identity, following [temporary-assignments.md](temporary-assignments.md). Do not copy a production UUID or infer ownership from the first visitor. Review every staging teacher before enabling admission enforcement.
7. Approve a separate staging MCP client in the staging project's OAuth server with its actual callback and protected-resource audience. Set its approved ID in the staging `TEACHER_PLUGIN_CLIENT_IDS` binding and connect a clearly named staging profile. Preserve the installed production connection.
8. Record actual backup retention and verify expired-metadata restore behavior. Complete synthetic acceptance, then enable creation/processing for the owner-only pilot.

## Acceptance before sharing

Use synthetic text and participant codes. Test a raw guest private link, fragment removal, cookie exchange/reload, autosave, submission retries, teacher-client claim/result commit, teacher-approved grading and offline HTML/ZIP exports. Check wrong-origin requests, reissued/revoked links, two participants in one browser, expiry and cleanup retry after a failed deletion. Complete the intended host's reconnect/renewal workflow before calling it supported.

CI validates the staging frontend and Wrangler package without deploying or accessing accounts. Its publishable-key fixture cannot sign in and must never be deployed. Actual school-device and connected-host checks remain live acceptance gates.

The staging security advisor reports the expected deny-by-default RLS tables and the `teacher_admitted` SECURITY DEFINER helper used by restrictive policies. Keep that helper's empty search path and deliberately limited boolean return. It does not grant browser access to temporary content.
