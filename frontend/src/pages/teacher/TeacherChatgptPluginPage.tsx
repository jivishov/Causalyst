import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { teacherApiFetch } from "../../lib/api";
import { teacherSupabase } from "../../lib/supabase";

export const PLUGIN_PENDING_AUTH_KEY = "explain.teacher-plugin-authorization";
export function teacherPluginCallbackUrl(value: string) {
  const destination = new URL(value);
  const chatgpt = destination.protocol === "https:" && (!destination.port || destination.port === "443") && ["chatgpt.com", "chat.openai.com"].includes(destination.hostname);
  // Supabase validates the registered client's exact redirect URI. This extra
  // guard permits Codex's loopback callback without allowing arbitrary HTTP URLs.
  const codex = destination.protocol === "http:" && destination.hostname === "127.0.0.1" && /^\/callback(?:\/[A-Za-z0-9_-]+)?$/.test(destination.pathname);
  if (destination.username || destination.password || destination.hash || (!chatgpt && !codex)) throw new Error("The connection callback is not a supported ChatGPT or Codex address.");
  return destination.href;
}
interface PluginConfig { endpoint: string; configured: boolean; clientIds: string[] }
type Details = NonNullable<Awaited<ReturnType<typeof teacherSupabase.auth.oauth.getAuthorizationDetails>>["data"]>;
type Grant = NonNullable<Awaited<ReturnType<typeof teacherSupabase.auth.oauth.listGrants>>["data"]>[number];

export function TeacherChatgptPluginPage() {
  const [params] = useSearchParams();
  const authorizationId = params.get("authorization_id");
  const [config, setConfig] = useState<PluginConfig | null>(null);
  const [consent, setConsent] = useState<{ authorizationId: string; details?: Details; redirectUrl?: string } | null>(null);
  const details = consent?.authorizationId === authorizationId ? consent.details : undefined;
  const continuationUrl = consent?.authorizationId === authorizationId ? consent.redirectUrl : undefined;
  const generation = useRef(0);
  const [grants, setGrants] = useState<Grant[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    generation.current++;
    setConsent(null); setConfig(null); setGrants([]); setError(null); setMessage(null); setBusy(false);
    async function load() {
      const setup = await teacherApiFetch<PluginConfig>("/teacher/chatgpt-plugin");
      if (!active) return;
      setConfig(setup);
      if (authorizationId) {
        if (!setup.configured) throw new Error("An administrator needs to finish the teacher plugin setup before it can be used.");
        const { data, error: consentError } = await teacherSupabase.auth.oauth.getAuthorizationDetails(authorizationId);
        if (!active) return;
        if (consentError || !data) throw new Error("This connection request has expired or could not be loaded. Start the connection again in the requesting app.");
        // Supabase can return only a redirect for a previously approved grant.
        if (!data.client && data.redirect_url) {
          setConsent({ authorizationId, redirectUrl: teacherPluginCallbackUrl(data.redirect_url) });
          return;
        }
        if (!data.client || !setup.clientIds.includes(data.client.id)) throw new Error("This app is not an approved Explain Teacher connection.");
        const scopes = new Set((data.scope ?? "").split(/\s+/));
        if (!scopes.has("openid") || !scopes.has("email") || !scopes.has("profile")) throw new Error("This request is missing the required account permissions. Start the connection again in the requesting app.");
        setConsent({ authorizationId, details: data });
      } else if (setup.configured) {
        sessionStorage.removeItem(PLUGIN_PENDING_AUTH_KEY);
        const { data, error: grantError } = await teacherSupabase.auth.oauth.listGrants();
        if (grantError) throw new Error("Could not load existing connections. Try again shortly.");
        if (active) setGrants((data ?? []).filter(grant => setup.clientIds.includes(grant.client.id)));
      }
    }
    void load().catch(err => { if (active) setError(err instanceof Error ? err.message : "Could not load the teacher plugin connection."); });
    return () => { active = false; generation.current++; };
  }, [authorizationId]);

  async function decide(approve: boolean) {
    if (!authorizationId || !details || !config?.clientIds.includes(details.client.id)) return;
    setBusy(true); setError(null);
    const currentGeneration = generation.current;
    try {
      const result = approve
        ? await teacherSupabase.auth.oauth.approveAuthorization(authorizationId, { skipBrowserRedirect: true })
        : await teacherSupabase.auth.oauth.denyAuthorization(authorizationId, { skipBrowserRedirect: true });
      if (generation.current !== currentGeneration) return;
      if (result.error || !result.data?.redirect_url) throw new Error("Could not complete the connection. Try again in the requesting app.");
      const destination = teacherPluginCallbackUrl(result.data.redirect_url);
      sessionStorage.removeItem(PLUGIN_PENDING_AUTH_KEY);
      window.location.assign(destination);
    } catch (err) { if (generation.current === currentGeneration) { setError(err instanceof Error ? err.message : "Could not complete the connection."); setBusy(false); } }
  }
  async function revoke(clientId: string) {
    setBusy(true); setError(null);
    try {
      const { error: revokeError } = await teacherSupabase.auth.oauth.revokeGrant({ clientId });
      if (revokeError) throw new Error("Could not disconnect this account. Try again shortly.");
      setGrants(current => current.filter(grant => grant.client.id !== clientId));
      setMessage("Plugin access to this teacher account has been disconnected.");
    } catch (err) { setError(err instanceof Error ? err.message : "Could not disconnect."); }
    finally { setBusy(false); }
  }

  return <div className="page-stack teacher-plugin-page">
    <header className="teacher-page-header"><div><h1>Teacher AI plugin</h1><p>Create and review assessments in ChatGPT or Codex.</p></div></header>
    <section className="card"><h2>{authorizationId ? "Connect your teacher account" : "Explain Teacher"}</h2>
      <p>Ask ChatGPT or Codex to create an assessment, improve its rubric, or evaluate submitted work. The plugin reads your selected Explain records and saves the results you approve.</p>
      <p>AI work happens in your conversation. Sign in to Codex with ChatGPT to use your subscription allowance. Codex configured with an API key uses API billing. Your selected conversation model controls the reasoning; Explain’s API model settings apply to in-app requests.</p>
      <p>Image creation and audio review depend on the tools available in the requesting app. Students continue using their current assignment workflow.</p>
      {error && <p className="field-error" role="alert">{error}</p>}
      {message && <p className="status-line" role="status">{message}</p>}
      {!config && !error && <p className="status-line">Loading connection…</p>}
      {config && !config.configured && <p className="status-line">An administrator needs to finish the teacher plugin setup before it can be used.</p>}
      {continuationUrl && <><p>This request already has your consent. Continue to finish the connection in the requesting app.</p><button className="primary-button" onClick={() => { sessionStorage.removeItem(PLUGIN_PENDING_AUTH_KEY); window.location.assign(continuationUrl); }}>Continue to {new URL(continuationUrl).hostname === "127.0.0.1" ? "Codex" : "ChatGPT"}</button></>}
      {details && <>
        <p><strong>Requesting app:</strong> {details.client.name}</p>
        <p><strong>Teacher account:</strong> {details.user.email}</p>
        <p><strong>Account permissions:</strong> {details.scope}</p>
        <ul><li>Read your assessments and selected student work, including evidence shared with the requesting app.</li><li>Create assessments and apply approved rubric revisions.</li><li>Save approved teacher grades that have not been published.</li></ul>
        <p>You can disconnect access here at any time. Publish grades from Explain’s Gradebook after your review.</p>
        <div className="teacher-plugin-actions"><button className="primary-button" disabled={busy} onClick={() => void decide(true)}>Connect teacher account</button><button className="secondary-button" disabled={busy} onClick={() => void decide(false)}>Cancel</button></div>
      </>}
      {config && !authorizationId && <>
        <p><strong>Plugin server URL</strong></p><input aria-label="Plugin server URL" readOnly value={config.endpoint} onFocus={event => event.currentTarget.select()} />
        <p>In ChatGPT on the web, open Plugins → Add custom MCP server, use this URL, and choose OAuth. Connect your Explain teacher account, then select Explain Teacher in a conversation.</p>
        <p>In Codex desktop, install Explain Teacher from its repository marketplace and complete the teacher-account connection from the plugin.</p>
        <p>Try: “Create a 10th-grade chemistry simulation assessment about gas pressure, with a 20-point rubric. Show me the draft before saving it.”</p>
        {grants.map(grant => <div className="teacher-plugin-actions" key={grant.client.id}><span>{grant.client.name}</span><button className="secondary-button" disabled={busy} onClick={() => void revoke(grant.client.id)}>Disconnect</button></div>)}
      </>}
    </section>
  </div>;
}
