import { useEffect, useState } from "react";
import { KeyRound, Save, ShieldCheck, SlidersHorizontal } from "lucide-react";
import { AI_MODEL_ROLES, AI_PROVIDERS, AI_REASONING_EFFORTS, type AiModelRole, type AiProvider, type TeacherAiSettings, type TeacherAiSettingsUpdate } from "@alt-assessment/shared";
import { teacherApiFetch } from "../../lib/api";

const providerNames = { openai: "OpenAI", kimi: "Kimi / Moonshot", zai: "Z.AI" };
const roleNames: Record<AiModelRole, string> = {
  grading: "Voice grading", visionGrading: "Writing grading", transcription: "Audio transcription",
  simulationSpec: "Simulation specification", simulationHtml: "Default simulation code", simulationSketchImage: "Simulation sketch image",
  simulationReadinessClassifier: "Description readiness check", fidelityReview: "Fidelity review", realtimeVoice: "Live voice conversation"
};
const textRoles = new Set<AiModelRole>(["grading", "visionGrading", "simulationSpec", "simulationHtml", "simulationReadinessClassifier", "fidelityReview"]);

export function TeacherAiSettingsPage() {
  const [settings, setSettings] = useState<TeacherAiSettings | null>(null);
  const [apiKeys, setApiKeys] = useState<Partial<Record<AiProvider, string>>>({});
  const [resetKeys, setResetKeys] = useState<Partial<Record<AiProvider, boolean>>>({});
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState<AiProvider | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Partial<Record<AiProvider, { ok: boolean; message: string }>>>({});

  async function reload() {
    setError(null);
    try { setSettings(await teacherApiFetch<TeacherAiSettings>("/teacher/ai-settings", { cache: "no-store" })); }
    catch (err) { setError(err instanceof Error ? err.message : "Could not load AI settings"); }
  }
  useEffect(() => { void reload(); }, []);

  function updatePayload(): TeacherAiSettingsUpdate {
    if (!settings) throw new Error("Settings are still loading");
    const replacements: TeacherAiSettingsUpdate["apiKeys"] = {};
    for (const provider of AI_PROVIDERS) {
      if (resetKeys[provider]) replacements[provider] = null;
      else if (apiKeys[provider]?.trim()) replacements[provider] = apiKeys[provider]!.trim();
    }
    const defaultCodeModel = settings.codeModels.find(model => model.id === settings.defaultSimulationModelId)!;
    return { updatedAt: settings.updatedAt, roleModels: { ...settings.roleModels, simulationHtml: { id: defaultCodeModel.modelId, reasoningEffort: defaultCodeModel.reasoningEffort } }, codeModels: settings.codeModels,
      defaultSimulationModelId: settings.defaultSimulationModelId, forceDefaultSimulationModel: settings.forceDefaultSimulationModel, apiKeys: replacements };
  }

  async function save() {
    setSaving(true); setError(null); setMessage(null);
    try {
      const next = await teacherApiFetch<TeacherAiSettings>("/teacher/ai-settings", { method: "PUT", body: JSON.stringify(updatePayload()) }, 30000);
      setSettings(next); setApiKeys({}); setResetKeys({}); setTestResults({});
      setMessage("Saved. New attempts will use these settings. Existing attempts keep their original keys and models.");
    } catch (err) { setError(err instanceof Error ? err.message : "Could not save AI settings"); }
    finally { setSaving(false); }
  }

  async function test(provider: AiProvider) {
    setTesting(provider); setError(null);
    try {
      if (resetKeys[provider]) throw new Error("Save the switch to the server key before testing it.");
      const result = await teacherApiFetch<{ ok: boolean; message: string }>("/teacher/ai-settings/test", {
        method: "POST", body: JSON.stringify({ ...updatePayload(), provider, apiKey: apiKeys[provider] || undefined })
      }, 75000);
      setTestResults(current => ({ ...current, [provider]: result }));
    } catch (err) { setError(err instanceof Error ? err.message : "Provider check failed"); }
    finally { setTesting(null); }
  }

  if (!settings) return <section className="course-list-panel"><p role={error ? "alert" : "status"}>{error || "Loading AI settings…"}</p>{error && <button type="button" className="secondary-button" onClick={() => void reload()}>Retry</button>}</section>;
  const disabled = saving || testing !== null;
  return <div className="ai-settings-page page-stack">
    <section className="course-list-panel ai-settings-intro">
      <div><h2><SlidersHorizontal size={19} aria-hidden="true" /> Classroom AI settings</h2>
        <p>Manage the keys and models used for your students. Changes apply to new attempts; work already started keeps its original configuration.</p></div>
      <button className="primary-button" type="button" disabled={disabled} onClick={() => void save()}><Save size={16} />{saving ? "Saving…" : "Save settings"}</button>
    </section>
    {error && <p className="field-error" role="alert">{error}</p>}
    {message && <p className="status-line" role="status">{message}</p>}
    <fieldset disabled={disabled} className="ai-settings-fieldset">
      <section className="course-list-panel">
        <h2><KeyRound size={18} aria-hidden="true" /> Provider keys</h2>
        <p className="panel-description">Keys are encrypted on the server and are never returned to the browser. Leave a field blank to keep its current key. The test uses a small synthetic text request.</p>
        <div className="ai-key-grid">{AI_PROVIDERS.map(provider => <article className="ai-key-card" key={provider}>
          <h3>{providerNames[provider]}</h3>
          <p className="field-help"><ShieldCheck size={14} aria-hidden="true" /> {settings.keys[provider].source === "teacher" ? "Your saved key is configured" : settings.keys[provider].source === "server" ? "Shared server key is configured" : "No key configured"}</p>
          <label htmlFor={`ai-key-${provider}`}>New or replacement API key</label>
          <input id={`ai-key-${provider}`} type="password" value={apiKeys[provider] || ""} autoComplete="off" spellCheck={false}
            placeholder="Paste key securely" disabled={Boolean(resetKeys[provider])}
            onChange={event => { setApiKeys(current => ({ ...current, [provider]: event.target.value })); setTestResults(current => ({ ...current, [provider]: undefined })); }} />
          {settings.keys[provider].source === "teacher" && <label className="checkbox-label"><input type="checkbox" checked={Boolean(resetKeys[provider])}
            onChange={event => setResetKeys(current => ({ ...current, [provider]: event.target.checked }))} /> Remove my override and use the server key</label>}
          <button className="secondary-button" type="button" onClick={() => void test(provider)} disabled={Boolean(resetKeys[provider]) || (!settings.keys[provider].configured && !apiKeys[provider]?.trim())}>{testing === provider ? "Testing…" : "Test key and text model"}</button>
          {testResults[provider] && <p className={testResults[provider]!.ok ? "status-line" : "field-error"} role="status">{testResults[provider]!.message}</p>}
        </article>)}</div>
      </section>
      <section className="course-list-panel">
        <h2>Models used for student simulations</h2>
        <p className="panel-description">Edit the provider model IDs and enable the models available for your assignments. Disabled assignment choices use your default.</p>
        <div className="ai-model-list">{settings.codeModels.map((model, index) => <div className="ai-code-model-row" key={model.id}>
          <label className="checkbox-label"><input type="checkbox" checked={model.enabled} aria-label={`Enable ${model.label}`}
            onChange={event => setSettings(current => current && ({ ...current, codeModels: current.codeModels.map((entry, i) => i === index ? { ...entry, enabled: event.target.checked } : entry) }))} />{providerNames[model.provider]}</label>
          <label>Display name<input value={model.label} maxLength={100} onChange={event => setSettings(current => current && ({ ...current, codeModels: current.codeModels.map((entry, i) => i === index ? { ...entry, label: event.target.value } : entry) }))} /></label>
          <label>Provider model ID<input value={model.modelId} spellCheck={false} maxLength={128} onChange={event => setSettings(current => current && ({ ...current, codeModels: current.codeModels.map((entry, i) => i === index ? { ...entry, modelId: event.target.value } : entry) }))} /></label>
          <p className="field-help">Reasoning: {model.provider === "openai" ? "Max" : "Provider default"}</p>
        </div>)}</div>
        <div className="ai-student-policy">
          <label>Default student simulation model<select value={settings.defaultSimulationModelId} onChange={event => setSettings(current => current && ({ ...current, defaultSimulationModelId: event.target.value as typeof current.defaultSimulationModelId }))}>
            {settings.codeModels.filter(model => model.enabled).map(model => <option key={model.id} value={model.id}>{model.label}</option>)}
          </select></label>
          <label className="checkbox-label"><input type="checkbox" checked={settings.forceDefaultSimulationModel} onChange={event => setSettings(current => current && ({ ...current, forceDefaultSimulationModel: event.target.checked }))} /> Use this default for every new student simulation attempt</label>
        </div>
      </section>
      <section className="course-list-panel">
        <h2>Assessment model IDs</h2>
        <p className="panel-description">Use exact IDs supported by the provider account. Transcription, image generation, and live voice need models for those capabilities.</p>
        <div className="ai-model-list">{AI_MODEL_ROLES.filter(role => role !== "simulationHtml").map(role => <div className="ai-role-model-row" key={role}>
          <label htmlFor={`ai-role-${role}`}>{roleNames[role]}</label>
          <input id={`ai-role-${role}`} value={settings.roleModels[role].id} maxLength={128} spellCheck={false}
            onChange={event => setSettings(current => current && ({ ...current, roleModels: { ...current.roleModels, [role]: { ...current.roleModels[role], id: event.target.value } } }))} />
          <select aria-label={`${roleNames[role]} reasoning`} value={settings.roleModels[role].reasoningEffort} disabled={!textRoles.has(role)}
            onChange={event => setSettings(current => current && ({ ...current, roleModels: { ...current.roleModels, [role]: { ...current.roleModels[role], reasoningEffort: event.target.value as typeof current.roleModels[typeof role]["reasoningEffort"] } } }))}>
            {AI_REASONING_EFFORTS.map(effort => <option key={effort} value={effort}>{effort === "none" ? "Provider default" : effort}</option>)}
          </select>
        </div>)}</div>
      </section>
    </fieldset>
    <div className="ai-settings-actions"><button className="secondary-button" type="button" disabled={disabled} onClick={() => { setApiKeys({}); setResetKeys({}); setMessage(null); void reload(); }}>Reload saved settings</button>
      <button className="primary-button" type="button" disabled={disabled} onClick={() => void save()}><Save size={16} />{saving ? "Saving…" : "Save settings"}</button></div>
  </div>;
}
