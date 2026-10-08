import { useEffect, useId, useState } from "react";
import { RotateCcw, Save, SlidersHorizontal } from "lucide-react";
import { AI_PROMPT_MAX_LENGTH, type AiPromptOverrides, type AiPromptScope, type AiPromptStage, type AssessmentType, type TeacherAiPrompts } from "@alt-assessment/shared";
import { teacherApiFetch } from "../../lib/api";

interface PromptOptions { type: AssessmentType; scope: AiPromptScope; assessmentId?: string | null; assignmentId?: string | null; replacementAssessment?: boolean; resetKey?: string | number }
export function useTeacherAiPrompts(options: PromptOptions) {
  const key = JSON.stringify(options);
  const [loaded, setLoaded] = useState<{ key: string; data: TeacherAiPrompts } | null>(null);
  const [overrides, setOverrides] = useState<AiPromptOverrides>({});
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  useEffect(() => {
    let active = true;
    setError(null); setLoaded(null); setOverrides({});
    const query = new URLSearchParams({ type: options.type });
    if (options.assignmentId) query.set("assignmentId", options.assignmentId);
    else if (options.assessmentId) query.set("assessmentId", options.assessmentId);
    void (async () => {
      const response = await teacherApiFetch<TeacherAiPrompts>(`/teacher/ai-prompts?${query}`);
      if (!options.replacementAssessment || !options.assessmentId) return response;
      const replacement = await teacherApiFetch<TeacherAiPrompts>(`/teacher/ai-prompts?assessmentId=${encodeURIComponent(options.assessmentId)}`);
      return { ...replacement, scope: "assignment" as const, scopeId: options.assignmentId ?? null,
        inherited: replacement.prompts, overrides: {}, updatedAt: response.type === replacement.type ? response.updatedAt : null };
    })().then(response => {
      if (!active) return;
      if (!Array.isArray(response.stages) || !response.inherited || !response.prompts) throw new Error("Could not load AI prompts. Reload before saving.");
      const data = response.scope === options.scope ? response : { ...response, scope: options.scope,
        scopeId: null, updatedAt: null, inherited: response.prompts, overrides: {} };
      setLoaded({ key, data }); setOverrides(data.overrides);
    }).catch(err => { if (active) setError(err instanceof Error ? err.message : "Could not load AI prompts."); });
    return () => { active = false; };
  }, [key, reloadKey]);
  const data = loaded?.key === key ? loaded.data : null;
  function accept(next: TeacherAiPrompts) { setLoaded({ key, data: next }); setOverrides(next.overrides); }
  return { data, overrides, setOverrides, error, ready: Boolean(data), accept, reload: () => setReloadKey(current => current + 1),
    saveFields: data ? { aiPrompts: overrides, expectedPromptUpdatedAt: data.updatedAt } : null };
}
export type PromptEditorState = ReturnType<typeof useTeacherAiPrompts>;

export function TeacherAiPromptEditor({ state, disabled = false, scope = "assignment" }: { state: PromptEditorState; disabled?: boolean; scope?: AiPromptScope }) {
  const [selected, setSelected] = useState<AiPromptStage | "">("");
  const prefix = useId();
  const stages = state.data?.stages.filter(stage => scope !== "assignment" || stage.id !== "assessmentBuilder") ?? [];
  const stage = stages.find(item => item.id === selected) ?? stages[0];
  const pair = stage && state.data ? { ...state.data.inherited[stage.id]!, ...state.overrides[stage.id] } : null;
  function edit(field: "system" | "user", value: string) {
    if (!stage || !state.data) return;
    state.setOverrides(current => {
      const next = { ...current, [stage.id]: { ...current[stage.id] } };
      if (value === state.data!.inherited[stage.id]![field]) delete next[stage.id]![field]; else next[stage.id]![field] = value;
      if (Object.keys(next[stage.id]!).length === 0) delete next[stage.id];
      return next;
    });
  }
  return <section className="teacher-prompt-editor assessment-span-full" aria-label="AI prompts">
    <div className="teacher-prompt-heading"><h3><SlidersHorizontal size={17} aria-hidden="true" />AI prompts</h3>
      <span className="teacher-prompt-badge">Teacher only</span></div>
    <p className="field-help">{scope === "defaults" ? "Save reusable defaults for this assessment type. Assignments with their own overrides keep those overrides."
      : scope === "assessment" ? "These prompts follow this assessment when you assign it to a class. Each assignment can also have its own prompts."
      : "Customize this class assignment independently. Unchanged fields inherit the assessment’s prompts and your defaults."}</p>
    {state.error ? <div role="alert"><p className="error-banner">{state.error}</p><button className="secondary-button" type="button" onClick={state.reload}>Reload prompts</button></div>
      : !state.ready ? <p className="status-line" role="status">Loading AI prompts…</p>
      : stage && pair && <>
        <label className="teacher-prompt-stage">AI step<select aria-label="AI step" value={stage.id} disabled={disabled} onChange={event => setSelected(event.target.value as AiPromptStage)}>
          {stages.map(item => <option key={item.id} value={item.id}>{item.label}{state.overrides[item.id] ? " · Customized" : ""}</option>)}
        </select></label>
        <p className="field-help">{stage.description}</p>
        <div className="teacher-prompt-fields">{(["system", "user"] as const).map(field => <div key={`${stage.id}-${field}`}>
          <div className="teacher-prompt-field-heading"><label htmlFor={`${prefix}-${field}`}>{field === "system" ? "System prompt" : "User prompt"}</label>
            <span>{state.overrides[stage.id]?.[field] === undefined ? scope === "defaults" ? "Explain default" : "Inherited" : "Customized"}</span></div>
          <textarea id={`${prefix}-${field}`} value={pair[field]} rows={8} maxLength={AI_PROMPT_MAX_LENGTH} spellCheck={false} disabled={disabled}
            onChange={event => edit(field, event.target.value)} />
          <button className="teacher-prompt-reset" type="button" disabled={disabled || state.overrides[stage.id]?.[field] === undefined}
            onClick={() => edit(field, state.data!.inherited[stage.id]![field])}><RotateCcw size={13} />{scope === "defaults" ? "Reset to Explain default" : "Reset to inherited prompt"}</button>
        </div>)}</div>
        <details className="teacher-prompt-help"><summary>Template variables and app requirements</summary>
          <p>Add instructions or rearrange variables in the user prompt. Variables insert the actual assignment and student evidence as JSON values. Required evidence is included automatically when omitted.</p>
          <p className="teacher-prompt-variables">{[...new Set(["context", ...stage.variables])].map(variable => <code key={variable}>{`{{${variable}}}`}</code>)}</p>
          <p>The app still attaches files and enforces output formats, rubric limits, and preview security. System and grading prompts stay out of the student interface.</p>
        </details>
        {scope !== "defaults" && <p className="field-help">Saved changes apply to the next AI action. Existing answers, images, simulations, and grades stay saved. A running generation or live conversation keeps the prompts it started with.</p>}
      </>}
  </section>;
}

export function TeacherPromptDefaultsPanel() {
  const [type, setType] = useState<AssessmentType>("simulation");
  const state = useTeacherAiPrompts({ type, scope: "defaults" });
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function save() {
    if (!state.data) return;
    setSaving(true); setError(null); setMessage(null);
    try {
      const next = await teacherApiFetch<TeacherAiPrompts>("/teacher/ai-prompts/defaults", { method: "PUT",
        body: JSON.stringify({ type, prompts: state.overrides, updatedAt: state.data.updatedAt }) });
      state.accept(next); setMessage("Prompt defaults saved. Future AI actions use these defaults unless an assessment or assignment overrides them.");
    } catch (err) { setError(err instanceof Error ? err.message : "Could not save prompt defaults."); }
    finally { setSaving(false); }
  }
  return <section className="course-list-panel teacher-prompt-defaults" aria-label="Assessment prompt defaults">
    <div className="course-list-header"><h2>Assessment prompt defaults</h2>
      <label>Assessment type<select aria-label="Assessment type" value={type} disabled={saving} onChange={event => { setType(event.target.value as AssessmentType); setMessage(null); setError(null); }}>
        <option value="simulation">Simulation</option><option value="voice">Voice Message</option><option value="voice_realtime">Live Voice</option><option value="writing">Writing</option>
      </select></label></div>
    <TeacherAiPromptEditor state={state} scope="defaults" disabled={saving} />
    {error && <p className="error-banner" role="alert">{error}</p>}{message && <p className="status-line" role="status">{message}</p>}
    <div className="control-row"><button className="secondary-button" type="button" disabled={saving} onClick={() => { state.reload(); setMessage(null); setError(null); }}>Reload saved prompts</button>
      <button className="primary-button" type="button" disabled={saving || !state.ready} onClick={() => void save()}><Save size={16} />{saving ? "Saving…" : "Save prompt defaults"}</button></div>
  </section>;
}
