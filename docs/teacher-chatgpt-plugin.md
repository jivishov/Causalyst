# Explain Teacher ChatGPT plugin

Explain Teacher performs teacher-initiated AI work inside a ChatGPT conversation. The MCP tools retrieve teacher-owned data and save approved results; they never invoke OpenAI, Kimi, Z.AI, image generation, transcription, or realtime inference endpoints. ChatGPT's selected model, account features, approvals, and usage limits apply. Students' existing workflows and API settings continue to work independently.

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
3. Register a **public** OAuth client for Explain Teacher, using `token_endpoint_auth_method: none` and the exact ChatGPT callback URL shown by the custom MCP connection setup. ChatGPT uses HTTPS callbacks on `chatgpt.com` or `chat.openai.com`. Native Codex needs a separately approved public client with its exact `http://127.0.0.1:<port>/callback` (or `/callback/<callback_id>`) redirect. The consent page accepts only that loopback host and callback path for HTTP. Prefer explicitly registered clients rather than unrestricted dynamic registration.
4. Configure the access-token hook below for the registered client. Its MCP audience must exactly equal `https://alt-assessment-student-api.emil-jivishov.workers.dev/mcp/teacher`. If a project already has a custom access-token hook, integrate this audience branch into that existing hook rather than replacing its logic.
5. Set the GitHub repository variable `TEACHER_PLUGIN_CLIENT_IDS` to the registered client's UUID. Multiple approved clients can be comma separated. The **Deploy Worker** workflow forwards it as a non-secret Worker variable. Keep the audience hook consistent with every approved client. Empty configuration disables access.
6. Deploy the reviewed Worker and frontend through the existing production release gates. The plugin connection page is `/teacher/chatgpt-plugin`; the protected resource is `/mcp/teacher`; discovery is `/.well-known/oauth-protected-resource/mcp/teacher`.
7. In ChatGPT on the web, open Plugins → Add custom MCP server, enter the MCP URL, choose OAuth, and enter the registered public client ID if requested. Complete teacher sign-in and consent. Then invoke Explain Teacher in a conversation. The portable package in `plugins/explain-teacher` also supplies a reusable teacher workflow skill; local package availability varies by ChatGPT surface.
8. Test with a teacher account and synthetic student evidence before classroom use. Confirm assessment creation, rubric updates, proposed-grade review, conflict handling, and disconnection. The teacher can revoke grants from the plugin page.

## Codex desktop installation

The repository now contains a local marketplace named `explain-local`, displayed as **Explain Teacher**. Its entry points at the portable package in `plugins/explain-teacher`. This is installation metadata, not evidence that a desktop client has installed the plugin or authenticated it.

1. Finish the hosted deployment and OAuth setup above. For native Codex, register a separate public client and include its UUID in both `TEACHER_PLUGIN_CLIENT_IDS` and the audience hook. Do not reuse a ChatGPT-only client's callback registration.
2. Configure that pre-registered client in Codex's supported bundled-MCP OAuth format. The documented native fields are `clientId`, `callbackUrl`, and `callbackPort`. The shared portable package currently contains the MCP URL only; it does **not** contain a registered Codex client ID. That wiring must be completed with the real registration before native authentication can work. Do not add secrets, API keys, or placeholder credentials to the package.
3. Register the exact callback shown by the installed Codex version. For an auth server that requires exact redirect matches, use a fixed listener port and match it in both the callback URL and listener configuration. Codex may append a server-specific callback ID when the provider does not support issuer-bound authorization responses; preserve that suffix. This page supports the default Codex callback path, not arbitrary local or remote callback URLs.
4. Open this repository's checkout in Codex desktop, restart the desktop app, open Plugins, select the **Explain Teacher** local source, and install **Explain Teacher**. Local catalogs depend on the supported client and the checkout being on that computer; editing this cloud workspace does not install anything on another computer.
5. Complete the teacher-account OAuth consent and start a new conversation. Verify that the connected teacher profile and all 13 tools are available, then test with synthetic evidence before saving classroom grades.

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

The automated MCP tests use the real MCP SDK client and transports without model calls. They cover initialization, subsequent stateless requests, tool schemas, OAuth challenges, resource-audience checks, approved clients, revocation, teacher roles, origin checks, roster identity omission, artifact handling, and grade/rubric write guards. PostgreSQL tests cover live session lookup, user mismatch, revocation, and function privileges. Existing app checks cover the ordinary teacher/student routes.

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
