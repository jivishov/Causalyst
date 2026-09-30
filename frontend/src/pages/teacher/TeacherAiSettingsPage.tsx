import { useEffect, useState } from "react";
import { KeyRound, Plus, Save, ShieldCheck, SlidersHorizontal, Trash2 } from "lucide-react";
import { AI_MODEL_ROLES, AI_PROVIDERS, AI_MODEL_CAPABILITIES, AI_TEXT_MODEL_ROLES, AI_MIN_OUTPUT_TOKENS, AI_MAX_OUTPUT_TOKENS, reasoningEffortsForModel, modelCapabilityForRole, teacherProviderModels,
  type AiModelRole, type AiProvider, type AiReasoningEffort, type TeacherProviderModel, type TeacherRoleModel, type TeacherAiSettings, type TeacherAiSettingsUpdate } from "@alt-assessment/shared";
import { teacherApiFetch } from "../../lib/api";

const providerNames = { openai: "OpenAI", kimi: "Kimi / Moonshot", zai: "Z.AI" };
const roleNames: Record<AiModelRole, string> = {
  grading: "Voice grading", visionGrading: "Writing grading", transcription: "Audio transcription",
  simulationSpec: "Simulation specification", simulationHtml: "Default simulation code", simulationSketchImage: "Simulation sketch image",
  simulationReadinessClassifier: "Description readiness check", fidelityReview: "Fidelity review", realtimeVoice: "Live voice conversation"
};
const textRoles = new Set(AI_TEXT_MODEL_ROLES);
const capabilityNames = { text: "Text / simulation", transcription: "Audio transcription", image: "Image generation", realtime: "Live voice" };

export function TeacherAiSettingsPage() {
  const [settings, setSettings] = useState<TeacherAiSettings | null>(null);
  const [selectedProvider, setSelectedProvider] = useState<AiProvider>("openai");
  const [newModelId, setNewModelId] = useState<string | null>(null);
  const [apiKeys, setApiKeys] = useState<Partial<Record<AiProvider, string>>>({});
  const [resetKeys, setResetKeys] = useState<Partial<Record<AiProvider, boolean>>>({});
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState<AiProvider | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Partial<Record<AiProvider, { ok: boolean; message: string }>>>({});

  async function reload() {
    setError(null); setNewModelId(null);
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
    return { updatedAt: settings.updatedAt, roleModels: { ...settings.roleModels, simulationHtml: { id: defaultCodeModel.modelId, catalogModelId: defaultCodeModel.id, reasoningEffort: defaultCodeModel.reasoningEffort, maxOutputTokens: defaultCodeModel.maxOutputTokens } }, codeModels: settings.codeModels, providerModels: teacherProviderModels(settings),
      defaultSimulationModelId: settings.defaultSimulationModelId, forceDefaultSimulationModel: settings.forceDefaultSimulationModel, apiKeys: replacements };
  }

  function editProviderModel(id: TeacherProviderModel["id"], patch: Partial<TeacherProviderModel>) {
    setSettings(current => {
      if (!current) return current;
      const catalog = teacherProviderModels(current);
      const previous = catalog.find(model => model.id === id)!;
      const next = { ...previous, ...patch };
      if (next.capability !== "text") { next.reasoningEffort = "none"; next.maxOutputTokens = undefined; next.enabled = false; }
      else if (!reasoningEffortsForModel(next.modelId).includes(next.reasoningEffort)) next.reasoningEffort = "low";
      const models = catalog.map(model => model.id === id ? next : model);
      const roleModels = { ...current.roleModels };
      for (const role of AI_MODEL_ROLES) {
        const model = roleModels[role];
        if (model.catalogModelId === id || (!model.catalogModelId && previous.provider === "openai" && model.id === previous.modelId)) {
          roleModels[role] = { ...model, id: next.modelId, catalogModelId: id,
            reasoningEffort: reasoningEffortsForModel(next.modelId).includes(model.reasoningEffort) ? model.reasoningEffort : "low" };
        }
      }
      return { ...current, providerModels: models, codeModels: models.filter(model => model.capability === "text"), roleModels };
    });
  }

  function addProviderModel() {
    const model: TeacherProviderModel = { id: `${selectedProvider}:${crypto.randomUUID()}`, provider: selectedProvider, modelId: "", label: "New model",
      capability: "text", reasoningEffort: selectedProvider === "openai" ? "max" : "none", enabled: false };
    setSettings(current => {
      if (!current) return current;
      const models = [model, ...teacherProviderModels(current)];
      return { ...current, providerModels: models, codeModels: models.filter(entry => entry.capability === "text") };
    });
    setNewModelId(model.id);
  }

  function removeProviderModel(id: TeacherProviderModel["id"]) {
    setSettings(current => {
      if (!current) return current;
      const models = teacherProviderModels(current).filter(model => model.id !== id);
      return { ...current, providerModels: models, codeModels: models.filter(model => model.capability === "text") };
    });
  }

  function assignRoleModel(role: AiModelRole, id: string) {
    if (!settings) return;
    const model = teacherProviderModels(settings).find(entry => entry.id === id)!;
    editRoleModel(role, { id: model.modelId, catalogModelId: model.id, reasoningEffort: model.reasoningEffort, maxOutputTokens: model.maxOutputTokens });
  }

  function editRoleModel(role: AiModelRole, patch: Partial<TeacherRoleModel>) {
    setSettings(current => {
      if (!current) return current;
      const model = { ...current.roleModels[role], ...patch };
      if (!reasoningEffortsForModel(model.id).includes(model.reasoningEffort)) model.reasoningEffort = "low";
      return { ...current, roleModels: { ...current.roleModels, [role]: model } };
    });
  }

  async function save() {
    setSaving(true); setError(null); setMessage(null);
    try {
      const next = await teacherApiFetch<TeacherAiSettings>("/teacher/ai-settings", { method: "PUT", body: JSON.stringify(updatePayload()) }, 30000);
      setSettings(next); setNewModelId(null); setApiKeys({}); setResetKeys({}); setTestResults({});
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
  const models = teacherProviderModels(settings);
  function isAssigned(model: TeacherProviderModel) {
    return settings!.defaultSimulationModelId === model.id || AI_MODEL_ROLES.filter(role => role !== "simulationHtml").some(role => {
      const assigned = settings!.roleModels[role];
      return assigned.catalogModelId ? assigned.catalogModelId === model.id : model.provider === "openai" && assigned.id === model.modelId;
    });
  }
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
        <h2>Providers and model lists</h2>
        <p className="panel-description">Choose a provider to add, edit, or remove its models. Allow text models for student simulations, then assign assessment roles below. Choose a replacement before removing an assigned model.</p>
        <p className="field-help">GPT-6.1 Sol uses the ID <code>gpt-6.1-sol</code> and supports Low, Medium, High, XHigh, and Max. OpenAI token limits include reasoning and answer tokens together. A small limit can stop generation before an answer is ready. Leave a limit blank to use the app default.</p>
        <div className="ai-provider-list" aria-label="Model providers">{AI_PROVIDERS.map(provider => <button key={provider} type="button" className={selectedProvider === provider ? "primary-button" : "secondary-button"}
          aria-pressed={selectedProvider === provider} onClick={() => { setSelectedProvider(provider); setNewModelId(null); }}>{providerNames[provider]} <span>({models.filter(model => model.provider === provider).length})</span></button>)}</div>
        <div className="ai-provider-heading"><h3>{providerNames[selectedProvider]} models</h3><button type="button" className="secondary-button" onClick={addProviderModel}><Plus size={16} />Add model</button></div>
        {models.filter(model => model.provider === selectedProvider).length === 0 && <p className="field-help">No models for this provider. Add a model to make it available.</p>}
        <div className="ai-model-list">{models.filter(model => model.provider === selectedProvider).map(model => <article className={`ai-provider-model-card${model.id === newModelId ? " is-new" : ""}`} key={model.id}>
          <div className="ai-provider-model-fields">
            <label>Display name<input autoFocus={model.id === newModelId} value={model.label} maxLength={100} onChange={event => editProviderModel(model.id, { label: event.target.value })} /></label>
            <label>Provider model ID<input value={model.modelId} spellCheck={false} maxLength={128} onChange={event => editProviderModel(model.id, { modelId: event.target.value })} /></label>
            <label>Model capability<select value={model.capability} disabled={isAssigned(model)} onChange={event => editProviderModel(model.id, { capability: event.target.value as TeacherProviderModel["capability"] })}>
              {(model.provider === "openai" ? AI_MODEL_CAPABILITIES : ["text"] as const).map(capability => <option key={capability} value={capability}>{capabilityNames[capability]}</option>)}
            </select></label>
            <div className="ai-model-actions">
              {isAssigned(model) && <span className="ai-model-assignment" title="Choose a replacement in the defaults or assessment roles before removing this model."><ShieldCheck size={13} aria-hidden="true" />Assigned</span>}
              <button className="secondary-button ai-remove-model" type="button" aria-label={`Remove ${model.label}`} disabled={isAssigned(model)} onClick={() => removeProviderModel(model.id)}><Trash2 size={14} />Remove</button>
            </div>
          </div>
          {model.capability === "text" && <div className="ai-provider-model-controls">
            <label className="checkbox-label"><input type="checkbox" checked={model.enabled} aria-label={`Enable ${model.label}`}
              onChange={event => editProviderModel(model.id, { enabled: event.target.checked })} />Allow for student simulations</label>
            {model.provider === "openai" ? <>
              <label>Reasoning effort<select aria-label={`${model.label} reasoning`} value={model.reasoningEffort} onChange={event => editProviderModel(model.id, { reasoningEffort: event.target.value as AiReasoningEffort })}>
                {reasoningEffortsForModel(model.modelId).map(effort => <option key={effort} value={effort}>{effort === "none" ? "Provider default" : effort}</option>)}
              </select></label>
              <label title="Maximum reasoning and answer tokens combined">Token limit<input aria-label={`${model.label} token limit`} type="number" min={AI_MIN_OUTPUT_TOKENS} max={AI_MAX_OUTPUT_TOKENS} step={1}
                value={model.maxOutputTokens ?? ""} placeholder="App default" onChange={event => editProviderModel(model.id, { maxOutputTokens: event.target.value === "" ? undefined : Number(event.target.value) })} /></label>
            </> : <p className="field-help">Reasoning: Provider default</p>}
          </div>}
        </article>)}</div>
        <div className="ai-student-policy">
          <label>Default student simulation model<select value={settings.defaultSimulationModelId} onChange={event => setSettings(current => current && ({ ...current, defaultSimulationModelId: event.target.value as typeof current.defaultSimulationModelId }))}>
            {settings.codeModels.filter(model => model.enabled).map(model => <option key={model.id} value={model.id}>{model.label}</option>)}
          </select></label>
          <label className="checkbox-label"><input type="checkbox" checked={settings.forceDefaultSimulationModel} onChange={event => setSettings(current => current && ({ ...current, forceDefaultSimulationModel: event.target.checked }))} /> Use this default for every new student simulation attempt</label>
        </div>
      </section>
      <section className="course-list-panel">
        <h2>Assessment model assignments</h2>
        <p className="panel-description">Choose from your provider model lists. OpenAI supports grading, transcription, images, and live voice; Kimi and Z.AI are available for student simulation code. Each list shows models with the matching capability.</p>
        <p className="field-help">Token limits for OpenAI text models cover reasoning and the answer together, from {AI_MIN_OUTPUT_TOKENS.toLocaleString()} to {AI_MAX_OUTPUT_TOKENS.toLocaleString()}. Leave blank to use the app default.</p>
        <div className="ai-model-list">{AI_MODEL_ROLES.filter(role => role !== "simulationHtml").map(role => <div className="ai-role-model-row" key={role}>
          <label htmlFor={`ai-role-${role}`}>{roleNames[role]}</label>
          <select id={`ai-role-${role}`} value={settings.roleModels[role].catalogModelId ?? models.find(model => model.provider === "openai" && model.modelId === settings.roleModels[role].id)?.id ?? ""}
            onChange={event => assignRoleModel(role, event.target.value)}>
            <optgroup label="OpenAI">{models.filter(model => model.provider === "openai" && model.capability === modelCapabilityForRole(role)).map(model => <option key={model.id} value={model.id}>{model.label} ({model.modelId})</option>)}</optgroup>
          </select>
          {textRoles.has(role) ? <>
            <label>Reasoning effort<select aria-label={`${roleNames[role]} reasoning`} value={settings.roleModels[role].reasoningEffort}
              onChange={event => editRoleModel(role, { reasoningEffort: event.target.value as AiReasoningEffort })}>
              {reasoningEffortsForModel(settings.roleModels[role].id).map(effort => <option key={effort} value={effort}>{effort === "none" ? "Provider default" : effort}</option>)}
            </select></label>
            <label title="Maximum reasoning and answer tokens combined">Token limit<input aria-label={`${roleNames[role]} token limit`} type="number" min={AI_MIN_OUTPUT_TOKENS} max={AI_MAX_OUTPUT_TOKENS} step={1}
              value={settings.roleModels[role].maxOutputTokens ?? ""} placeholder="App default" onChange={event => editRoleModel(role, { maxOutputTokens: event.target.value === "" ? undefined : Number(event.target.value) })} /></label>
          </> : <p className="field-help">Provider default</p>}
        </div>)}</div>
      </section>
    </fieldset>
    <div className="ai-settings-actions"><button className="secondary-button" type="button" disabled={disabled} onClick={() => { setApiKeys({}); setResetKeys({}); setMessage(null); void reload(); }}>Reload saved settings</button>
      <button className="primary-button" type="button" disabled={disabled} onClick={() => void save()}><Save size={16} />{saving ? "Saving…" : "Save settings"}</button></div>
  </div>;
}
