# Explain plugin for ChatGPT and Codex

Explain performs teacher-initiated AI work inside a ChatGPT conversation. The MCP tools retrieve teacher-owned data and save approved results; they never invoke OpenAI, Kimi, Z.AI, image generation, transcription, or realtime inference endpoints. ChatGPT's selected model, account features, approvals, and usage limits apply. Students' existing workflows and API settings continue to work independently.

Supported workflows:

- Create assessments of all four app types, including expected-answer guidance and analytic rubrics; save them to the teacher's library.
- Review and revise rubrics, with feedback shown before applying revisions and point totals preserved by default.
- Revise an existing title, prompt, or expected answer after teacher approval.
- Evaluate submitted explanations, transcripts, writing, simulation source, images, PDFs, and recordings using the tools available in the ChatGPT host.
- Save an approved 0–100 teacher grade and rationale as an unpublished override. Published grades cannot be changed by the plugin.
- Generate teacher explanations, demonstration HTML, or images as ChatGPT artifacts. These files are not automatically attached to student submissions or imported into Explain.

The plugin is not an API credit conversion mechanism or a background subscription proxy. It does not replace live student voice sessions or automatically process student requests. Image/audio resource processing depends on the ChatGPT client; when a resource cannot be inspected, the skill requires disclosure and a supported attachment workflow.

## Deployment setup

The integration stays disabled until the administrator registers and explicitly allows a ChatGPT OAuth client. No bearer tokens, provider keys, or client secrets should be placed in the plugin manifest, frontend, or conversation.

1. Apply the committed `20261006002335_teacher_plugin_session_verification.sql` and `20261006010909_teacher_plugin_review_guards.sql` migrations. They create service-role-only session verification and grade-saving functions. Every MCP request verifies the session's user, OAuth client, required scopes, and expiry. Restrictive RLS policies block OAuth tokens from direct public-table or Storage access; ordinary website sessions retain their existing policies. Future exposed tables must retain this OAuth restriction.
2. In Supabase Authentication → OAuth Server, enable OAuth 2.1 and set Authorization Path to `/teacher/chatgpt-plugin`. The project Site URL must be `https://explain.az` (or the correct staging origin).
3. Register a **public** OAuth client for Explain, using `token_endpoint_auth_method: none` and the exact ChatGPT callback URL shown by the custom MCP connection setup. ChatGPT uses HTTPS callbacks on `chatgpt.com` or `chat.openai.com`. Native Codex needs a separately approved public client with its exact `http://127.0.0.1:<port>/callback` (or `/callback/<callback_id>`) redirect. The consent page accepts only that loopback host and callback path for HTTP. Prefer explicitly registered clients rather than unrestricted dynamic registration.
4. Configure the access-token hook below for the registered client. Its MCP audience must exactly equal `https://alt-assessment-student-api.emil-jivishov.workers.dev/mcp/teacher`. If a project already has a custom access-token hook, integrate this audience branch into that existing hook rather than replacing its logic.
5. Set the GitHub repository variable `TEACHER_PLUGIN_CLIENT_IDS` to the registered client's UUID. Multiple approved clients can be comma separated. The **Deploy Worker** workflow forwards it as a non-secret Worker variable. Keep the audience hook consistent with every approved client. Empty configuration disables access.
6. Deploy the reviewed Worker and frontend through the existing production release gates. The plugin connection page is `/teacher/chatgpt-plugin`; the protected resource is `/mcp/teacher`; discovery is `/.well-known/oauth-protected-resource/mcp/teacher`.
7. In ChatGPT on the web, open Plugins → Add custom MCP server, enter the MCP URL, choose OAuth, and enter the registered public client ID if requested. Complete teacher sign-in and consent. Then invoke Explain in a conversation. The portable package in `plugins/explain-teacher` also supplies a reusable teacher workflow skill; local package availability varies by ChatGPT surface.
8. Test with a teacher account and synthetic student evidence before classroom use. Confirm assessment creation, rubric updates, proposed-grade review, conflict handling, and disconnection. The teacher can revoke grants from the plugin page.

## Codex desktop installation

The displayed plugin name is **Explain**. Its internal ID remains `explain-teacher`, and the OAuth client ID and callback are unchanged, preserving existing installation and connection identities.

The repository contains a marketplace named `explain-local`, displayed as **Explain**. Its entry points at `plugins/explain-teacher-codex`, a native Codex package with a compatibility manifest and `.mcp.json`. The portable package remains in `plugins/explain-teacher`. Codex 0.160.1's portable MCP parser does not accept native OAuth fields, so the desktop catalog uses the native package. Both packages include the same teacher workflow skill. Installation metadata does not establish that another computer has installed or authenticated the plugin.

The approved native client is `604811c9-433a-455c-b52d-5b1802c09496`, named **Explain**. It is manually registered as a public PKCE client with token endpoint authentication `none`; no client secret exists in the package. Its only redirect is `http://127.0.0.1:49152/callback/GvVY5xemsnpI`. Native `.mcp.json` sets both this callback and listener port 49152. The callback suffix follows the official Codex 0.160.1 implementation: URL-safe base64 of the first nine SHA-256 bytes of the complete MCP URL without a fragment. Preserve the suffix, endpoint, and listener port together when updating the connection.

1. Finish the hosted deployment and OAuth setup above. Keep the client UUID consistent in the native package, `TEACHER_PLUGIN_CLIENT_IDS`, and the audience hook. Dynamic OAuth app registration stays disabled. A ChatGPT web connection requires its own separately approved client and registered HTTPS callback; the native client must not be reused there.
2. On the computer running Codex, register this repository as a marketplace and install its plugin with a current Codex CLI:

   ```bash
   codex plugin marketplace add jivishov/Causalyst --ref main
   codex plugin add explain-teacher@explain-local
   ```

   Alternatively, open an updated checkout in Codex desktop, restart the app, open Plugins, select the **Explain** local source, and install **Explain**. Editing a cloud workspace does not install anything on another computer.
3. Restart Codex desktop and complete the Explain teacher-account OAuth connection from the plugin. Sign in through the normal browser flow; never paste credentials or tokens into chat. Start a new conversation and verify the connected teacher profile and all 13 tools, then test with synthetic evidence before saving classroom grades.

If port 49152 is already in use, resolve the local port conflict or register a newly reviewed callback and update both native callback fields. Do not remove callback validation or enable unrestricted app registration as a workaround.

Use Codex signed in with the teacher's ChatGPT account for subscription usage. Codex configured with an API key instead uses API billing. The plugin makes no inference API calls and cannot change the host's billing mode.

The public submission process at https://developers.openai.com/plugins/deploy/submission is a separate distribution route. It requires a plugin ZIP, a verified publishing identity, a reachable MCP server and domain verification, automated scans, reviewer materials, approval, and a publication step. A local desktop marketplace does not require public directory publication. The current package is not claimed to meet all public submission requirements.

### Access-token hook template

This is an administrator configuration template, not an automatically applied migration. Replace `REGISTERED_PUBLIC_CLIENT_UUID` with the exact approved OAuth client ID. Keep existing hook logic if present. Supabase Auth supplies `client_id` inside `event.claims`; do not use user-editable metadata or a top-level `event.client_id` for this decision. The SQL test harness executes this exact template with a synthetic client ID to check OAuth issuance, token refresh, and preservation of ordinary website claims.

```sql
create or replace function public.explain_teacher_plugin_access_token_hook(event jsonb)
returns jsonb language plpgsql stable security invoker set search_path = '' as $$
declare claims jsonb := event->'claims';
begin
  if claims->>'client_id' = 'REGISTERED_PUBLIC_CLIENT_UUID' then
    claims := jsonb_set(claims, '{aud}',
      to_jsonb('https://alt-assessment-student-api.emil-jivishov.workers.dev/mcp/teacher'::text));
  end if;
  return jsonb_build_object('claims', claims);
end;
$$;
revoke all on function public.explain_teacher_plugin_access_token_hook(jsonb)
  from public, anon, authenticated;
grant execute on function public.explain_teacher_plugin_access_token_hook(jsonb)
  to supabase_auth_admin;
grant usage on schema public to supabase_auth_admin;
```

Select the function in Supabase Authentication → Hooks → Custom Access Token. A normal website token with the `authenticated` audience cannot call the MCP resource. MCP tokens require exactly the dedicated audience. Ordinary REST routes reject OAuth client tokens. The required `openid email profile` scopes describe account identity; record permissions come from the approved client, live teacher profile, RLS, and ownership checks, not from OIDC scopes.

Reading a submission does not create or reconcile gradebook rows. Evidence downloads require both the attempt and artifact IDs, submitted work, and frozen evidence; oversized artifacts are rejected before download when their recorded size exceeds 8 MiB. Grade writes check the reviewed attempt timestamp and grade timestamp in one database transaction, refuse published grades and older attempts superseded by a newer submission, and return a minimal confirmation without roster details. ChatGPT still needs to show the result and obtain the teacher's approval; `confirmed: true` declares that approval and is not an independent record of the human's click.

## Verification

The automated MCP tests use the real MCP SDK client and transports without model calls. They cover initialization, subsequent stateless requests, tool schemas, OAuth challenges, resource-audience checks, approved clients, revocation, teacher roles, origin checks, roster identity omission, artifact handling, and grade/rubric write guards. Native PostgreSQL and real disposable Supabase tests cover live session lookup, user mismatch, revocation, role privileges, direct Data API restrictions, and atomic grade saves. Existing app checks cover ordinary teacher/student routes. Production release checks verify MCP discovery, an OAuth challenge for unauthenticated requests, and rejection of an unapproved origin without reading account data or invoking a model.

Run `npm run typecheck`, `npm test`, `npm run test:db`, `npm run build`, `npm run security`, `npm run build:worker`, `npm run audit`, and relevant browser tests. The hosted Supabase OAuth round trip and actual ChatGPT media handling require the configured account connection and are separate acceptance checks; automated tests do not establish that they work on a particular subscription.

Official integration references:

- https://developers.openai.com/plugins/build/mcp-server
- https://developers.openai.com/plugins/build/auth
- https://developers.openai.com/plugins/build/plugins
- https://developers.openai.com/api/docs/guides/custom-mcp-server
- https://learn.chatgpt.com/docs/extend/mcp
- https://developers.openai.com/plugins/deploy/submission
- https://supabase.com/docs/guides/auth/oauth-server/getting-started
- https://supabase.com/docs/guides/auth/oauth-server/token-security

The alternative Sign in with ChatGPT plan-usage route is separate. Its preview excludes image generation and transcription and requires approval for paid/remotely hosted services; it is not used by this plugin.
