import { FormEvent, useEffect, useRef, useState } from "react";
import { Archive, AudioLines, ClipboardList, Eye, FileText, MessageCircle, Orbit, Pencil, Plus, RotateCcw, Save, Search, Trash2, X } from "lucide-react";
import { Link } from "react-router-dom";
import {
  DEFAULT_REALTIME_VOICE_MAX_SESSION_SEC,
  DEFAULT_SIMULATION_CODE_MODEL_ID,
  DEFAULT_SIMULATION_MIN_DESCRIPTION_CHARS,
  DEFAULT_VOICE_MAX_RECORDING_SEC,
  DEFAULT_WRITING_ACCEPTED_MIME,
  DEFAULT_WRITING_MAX_BYTES,
  FINDING_TO_QUESTION_TEMPLATE,
  SIMULATION_CODE_MODEL_OPTIONS,
  type AssessmentType,
  type AssessmentTemplate,
  type RubricCriterion,
  type SimulationCodeModelId,
  type TeacherAssessment,
  type TeacherAiSettings,
  isSimulationCodeModelId,
  resolveSimulationCodeModelId
} from "@alt-assessment/shared";
import { useTeacherWorkspaceData } from "./TeacherWorkspaceData";
import { teacherApiFetch } from "../../lib/api";
import { TeacherPageToolbar } from "./TeacherPageToolbar";

type AssessmentEditorMode = "create" | "edit";
type BuilderTab = "prompt" | "rubric" | "settings";

interface RubricDraftRow {
  id?: string;
  name: string;
  maxPoints: string;
  description: string;
}

export function TeacherAssessmentsPage() {
  const [aiSettings, setAiSettings] = useState<TeacherAiSettings | null>(null);
  useEffect(() => { teacherApiFetch<TeacherAiSettings>("/teacher/ai-settings").then(setAiSettings).catch(() => {}); }, []);
  const defaultWritingAcceptedMime = DEFAULT_WRITING_ACCEPTED_MIME.join(",");

  const {
    assessments,
    includeArchivedAssessments,
    setIncludeArchivedAssessments,
    loadingAssessments,
    createAssessment,
    updateAssessmentById,
    setAssessmentArchived,
    setError
  } = useTeacherWorkspaceData();
  const [assessmentMode, setAssessmentMode] = useState<AssessmentEditorMode>("create");
  const [editingAssessmentId, setEditingAssessmentId] = useState<string | null>(null);
  const [assessmentType, setAssessmentType] = useState<AssessmentType>("voice");
  const [assessmentTitle, setAssessmentTitle] = useState("");
  const [assessmentPrompt, setAssessmentPrompt] = useState("");
  const [assessmentExpectedAnswer, setAssessmentExpectedAnswer] = useState("");
  const [scoringMode, setScoringMode] = useState("additive");
  const [scoringCaps, setScoringCaps] = useState<Array<{ id: string; condition: string; maximumPercent: number }>>([]);
  function loadScoringPolicy(value: unknown) {
    const policy = value as { mode?: string; caps?: typeof scoringCaps } | undefined;
    setScoringMode(policy?.mode ?? "review_adjustments");
    setScoringCaps(policy?.caps ?? []);
  }
  const [rubricRows, setRubricRows] = useState<RubricDraftRow[]>([
    { name: "", maxPoints: "5", description: "" }
  ]);
  const [voiceMaxRecordingSec, setVoiceMaxRecordingSec] = useState(String(DEFAULT_VOICE_MAX_RECORDING_SEC));
  const [realtimeVoiceMaxSessionSec, setRealtimeVoiceMaxSessionSec] = useState(String(DEFAULT_REALTIME_VOICE_MAX_SESSION_SEC));
  const [writingAcceptedMime, setWritingAcceptedMime] = useState(defaultWritingAcceptedMime);
  const [writingMaxBytes, setWritingMaxBytes] = useState(String(DEFAULT_WRITING_MAX_BYTES));
  const [simulationMinDescriptionChars, setSimulationMinDescriptionChars] = useState(String(DEFAULT_SIMULATION_MIN_DESCRIPTION_CHARS));
  const [simulationCodeModelId, setSimulationCodeModelId] = useState<SimulationCodeModelId>(DEFAULT_SIMULATION_CODE_MODEL_ID);
  const [assessmentSaving, setAssessmentSaving] = useState(false);
  const [builderOpen, setBuilderOpen] = useState(true);
  const [builderTab, setBuilderTab] = useState<BuilderTab>("prompt");
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const previewDialog = useRef<HTMLDialogElement>(null);
  const filteredAssessments = assessments.filter(assessment => (!typeFilter || assessment.type === typeFilter) && `${assessment.title} ${assessment.prompt}`.toLowerCase().includes(search.trim().toLowerCase()));

  useEffect(() => {
    if (!aiSettings) return;
    setSimulationCodeModelId(current => aiSettings.codeModels.some(model => model.id === current && model.enabled) ? current : aiSettings.defaultSimulationModelId);
  }, [aiSettings]);

  useEffect(() => {
    if (!loadingAssessments && assessments.length === 0) {
      setBuilderOpen(true);
    }
  }, [assessments.length, loadingAssessments]);

  function resetAssessmentForm() {
    setBuilderTab("prompt");
    setAssessmentMode("create");
    setEditingAssessmentId(null);
    setAssessmentType("voice");
    setAssessmentTitle("");
    setAssessmentPrompt("");
    setAssessmentExpectedAnswer("");
    setScoringMode("additive");
    setScoringCaps([]);
    setRubricRows([{ name: "", maxPoints: "5", description: "" }]);
    setVoiceMaxRecordingSec(String(DEFAULT_VOICE_MAX_RECORDING_SEC));
    setRealtimeVoiceMaxSessionSec(String(DEFAULT_REALTIME_VOICE_MAX_SESSION_SEC));
    setWritingAcceptedMime(defaultWritingAcceptedMime);
    setWritingMaxBytes(String(DEFAULT_WRITING_MAX_BYTES));
    setSimulationMinDescriptionChars(String(DEFAULT_SIMULATION_MIN_DESCRIPTION_CHARS));
    setSimulationCodeModelId(aiSettings?.defaultSimulationModelId ?? DEFAULT_SIMULATION_CODE_MODEL_ID);
  }

  function applyAssessmentTemplate(template: AssessmentTemplate) {
    setBuilderTab("prompt");
    setAssessmentMode("create");
    setEditingAssessmentId(null);
    setBuilderOpen(true);
    setAssessmentType(template.type);
    setAssessmentTitle(template.title);
    setAssessmentPrompt(template.prompt);
    setAssessmentExpectedAnswer(template.expectedAnswer);
    loadScoringPolicy(template.config.scoringPolicy);
    setRubricRows(template.rubric.map((row) => ({
      id: row.id,
      name: row.name,
      maxPoints: String(row.maxPoints),
      description: row.description
    })));
    setVoiceMaxRecordingSec(String(DEFAULT_VOICE_MAX_RECORDING_SEC));
    setRealtimeVoiceMaxSessionSec(String(DEFAULT_REALTIME_VOICE_MAX_SESSION_SEC));
    setSimulationMinDescriptionChars(String(DEFAULT_SIMULATION_MIN_DESCRIPTION_CHARS));
    setSimulationCodeModelId(aiSettings?.defaultSimulationModelId ?? DEFAULT_SIMULATION_CODE_MODEL_ID);
    const acceptedMime = Array.isArray(template.config.acceptedMime)
      ? template.config.acceptedMime.filter((item): item is string => typeof item === "string")
      : [...DEFAULT_WRITING_ACCEPTED_MIME];
    setWritingAcceptedMime(acceptedMime.join(","));
    const maxBytes = typeof template.config.maxBytes === "number" && Number.isFinite(template.config.maxBytes)
      ? template.config.maxBytes
      : DEFAULT_WRITING_MAX_BYTES;
    setWritingMaxBytes(String(maxBytes));
  }

  function beginEditAssessment(assessment: TeacherAssessment) {
    setBuilderTab("prompt");
    setAssessmentMode("edit");
    setEditingAssessmentId(assessment.id);
    setBuilderOpen(true);
    setAssessmentType(assessment.type);
    setAssessmentTitle(assessment.title);
    setAssessmentPrompt(assessment.prompt);
    setAssessmentExpectedAnswer(assessment.expectedAnswer ?? "");
    loadScoringPolicy(assessment.config.scoringPolicy);
    setRubricRows(
      assessment.rubric.length > 0
        ? assessment.rubric.map((row) => ({ id: row.id, name: row.name, maxPoints: String(row.maxPoints), description: row.description }))
        : [{ name: "", maxPoints: "5", description: "" }]
    );
    if (assessment.type === "voice") {
      setVoiceMaxRecordingSec(String((assessment.config.maxRecordingSec as number | undefined) ?? DEFAULT_VOICE_MAX_RECORDING_SEC));
    }
    if (assessment.type === "voice_realtime") {
      setRealtimeVoiceMaxSessionSec(String((assessment.config.maxSessionSec as number | undefined) ?? DEFAULT_REALTIME_VOICE_MAX_SESSION_SEC));
    }
    if (assessment.type === "writing") {
      const mime = Array.isArray(assessment.config.acceptedMime)
        ? assessment.config.acceptedMime.filter((item): item is string => typeof item === "string")
        : [...DEFAULT_WRITING_ACCEPTED_MIME];
      setWritingAcceptedMime(mime.join(","));
      setWritingMaxBytes(String((assessment.config.maxBytes as number | undefined) ?? DEFAULT_WRITING_MAX_BYTES));
    }
    if (assessment.type === "simulation") {
      setSimulationMinDescriptionChars(String((assessment.config.minDescriptionChars as number | undefined) ?? DEFAULT_SIMULATION_MIN_DESCRIPTION_CHARS));
      setSimulationCodeModelId(
        resolveSimulationCodeModelId(assessment.config.simulationCodeModelId) ?? DEFAULT_SIMULATION_CODE_MODEL_ID
      );
    }
  }

  function addRubricRow() {
    setRubricRows((rows) => [...rows, { name: "", maxPoints: "5", description: "" }]);
  }

  function updateRubricRow(index: number, patch: Partial<RubricDraftRow>) {
    setRubricRows((rows) => rows.map((row, rowIndex) => rowIndex === index ? { ...row, ...patch } : row));
  }

  function removeRubricRow(index: number) {
    setRubricRows((rows) => rows.filter((_, rowIndex) => rowIndex !== index));
  }

  function buildRubricPayload(): RubricCriterion[] {
    return rubricRows
      .map((row) => ({
        id: row.id,
        name: row.name.trim(),
        description: row.description.trim(),
        maxPoints: Number.parseInt(row.maxPoints, 10)
      }))
      .filter((row) => row.name && row.description && Number.isFinite(row.maxPoints) && row.maxPoints > 0);
  }

  function buildConfigPayload(type: AssessmentType): Record<string, unknown> {
    if (type === "voice") {
      const maxRecordingSec = Number.parseInt(voiceMaxRecordingSec, 10);
      return {
        maxRecordingSec: Number.isFinite(maxRecordingSec) && maxRecordingSec > 0
          ? maxRecordingSec
          : DEFAULT_VOICE_MAX_RECORDING_SEC
      };
    }
    if (type === "voice_realtime") {
      const maxSessionSec = Number.parseInt(realtimeVoiceMaxSessionSec, 10);
      return {
        maxSessionSec: Number.isFinite(maxSessionSec) && maxSessionSec > 0
          ? maxSessionSec
          : DEFAULT_REALTIME_VOICE_MAX_SESSION_SEC
      };
    }
    if (type === "writing") {
      const maxBytes = Number.parseInt(writingMaxBytes, 10);
      const acceptedMime = writingAcceptedMime
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean);
      return {
        maxBytes: Number.isFinite(maxBytes) && maxBytes > 0 ? maxBytes : DEFAULT_WRITING_MAX_BYTES,
        acceptedMime: acceptedMime.length > 0 ? acceptedMime : [...DEFAULT_WRITING_ACCEPTED_MIME]
      };
    }
    const minDescriptionChars = Number.parseInt(simulationMinDescriptionChars, 10);
    return {
      minDescriptionChars: Number.isFinite(minDescriptionChars) && minDescriptionChars > 0
        ? minDescriptionChars
        : DEFAULT_SIMULATION_MIN_DESCRIPTION_CHARS,
      simulationCodeModelId
    };
  }

  async function submitAssessment(event: FormEvent) {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const invalid = [...form.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>("input, textarea, select")].find(control => !control.checkValidity());
    if (invalid || !assessmentTitle.trim() || !assessmentPrompt.trim()) {
      setBuilderTab((invalid?.closest<HTMLElement>("[data-builder-tab]")?.dataset.builderTab as BuilderTab | undefined) ?? "prompt");
      setError("Complete the highlighted assessment field before saving.");
      requestAnimationFrame(() => { invalid?.focus(); form.reportValidity(); });
      return;
    }
    setAssessmentSaving(true);
    setError(null);
    try {
      const rubric = buildRubricPayload();
      if (rubric.length === 0) {
        setBuilderTab("rubric");
        throw new Error("Add at least one complete rubric row before saving.");
      }
      const payload = {
        type: assessmentType,
        title: assessmentTitle,
        prompt: assessmentPrompt,
        expectedAnswer: assessmentExpectedAnswer.trim() ? assessmentExpectedAnswer.trim() : null,
        rubric,
        config: { ...buildConfigPayload(assessmentType), scoringPolicy: { mode: scoringMode, caps: scoringMode === "capped" ? scoringCaps : [] } }
      };
      if (assessmentMode === "edit" && editingAssessmentId) {
        await updateAssessmentById(editingAssessmentId, payload);
      } else {
        await createAssessment(payload);
      }
      resetAssessmentForm();
      setBuilderOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save assessment");
    } finally {
      setAssessmentSaving(false);
    }
  }

  async function toggleAssessmentArchived(assessmentId: string, archived: boolean) {
    const assessment = assessments.find((item) => item.id === assessmentId);
    if (!assessment) return;
    setError(null);
    try {
      await setAssessmentArchived(assessment, archived);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update assessment archive state");
    }
  }

  return (
    <div className="teacher-assessment-page assessment-library-layout">
      <TeacherPageToolbar>
        <label className="checkbox-row"><input type="checkbox" checked={includeArchivedAssessments} onChange={event => setIncludeArchivedAssessments(event.target.checked)} />Show archived</label>
        <button className="primary-button" type="button" onClick={() => { resetAssessmentForm(); setBuilderOpen(true); }}><Plus size={15} />New assessment</button>
      </TeacherPageToolbar>
      <section className="course-list-panel assessment-library-panel" aria-label="Assessment library">
        <div className="course-list-header assessment-library-header">
          <div>
            <h2><ClipboardList size={16} aria-hidden="true" />Assessment Library</h2>
          </div>
          <span className="teacher-library-count">{filteredAssessments.length}</span>
        </div>
        <div className="teacher-library-search"><label><Search size={15} aria-hidden="true" /><input aria-label="Search assessment library" placeholder="Search library" value={search} onChange={event => setSearch(event.target.value)} /></label><select aria-label="Filter assessment type" value={typeFilter} onChange={event => setTypeFilter(event.target.value)}><option value="">All types</option><option value="simulation">Simulation</option><option value="writing">Writing</option><option value="voice">Voice message</option><option value="voice_realtime">Live voice</option></select></div>
        <details className="assessment-template-panel">
          <summary>Start from a template</summary>
          <div>
            <p>Writing prompt, answer key, rubric, and upload settings.</p>
          </div>
          <button
            className="secondary-button"
            type="button"
            onClick={() => applyAssessmentTemplate(FINDING_TO_QUESTION_TEMPLATE)}
          >
            <ClipboardList size={15} /> Finding-to-Question
          </button>
        </details>

        {loadingAssessments ? (
          <p className="status-line">Loading assessments</p>
        ) : assessments.length === 0 ? (
          <div className="empty-state teacher-empty-state">
            <div>
              <ClipboardList size={28} />
              <p>No assessments yet.</p>
            </div>
          </div>
        ) : (
          <div className="course-list assessment-library-items">
            {filteredAssessments.length === 0 && <p className="status-line">No assessments match. Try another search or type.</p>}
            {filteredAssessments.map((assessment) => (
              <article key={assessment.id} className={`course-row assessment-library-item ${editingAssessmentId === assessment.id && builderOpen ? "selected-assessment" : ""}`} aria-label={assessment.title}>
                <div className="teacher-library-item-heading">
                  <span className={`teacher-format-mark teacher-format-${assessment.type}`} aria-hidden="true">{assessment.type === "simulation" ? <Orbit size={19} /> : assessment.type === "writing" ? <FileText size={19} /> : assessment.type === "voice" ? <AudioLines size={19} /> : <MessageCircle size={19} />}</span>
                  <div>
                  <strong>{assessment.title}</strong>
                  <p>{formatAssessmentTypeLabel(assessment.type)} · {assessment.rubric.length} rubric criteria</p>
                  {assessment.archivedAt && <span className="archive-badge">Archived</span>}
                  </div>
                </div>
                <div className="course-actions">
                  <button className="secondary-button" type="button" aria-pressed={editingAssessmentId === assessment.id && builderOpen} onClick={() => beginEditAssessment(assessment)}>
                    <Pencil size={16} /> Edit
                  </button>
                  {assessment.archivedAt ? (
                    <button className="secondary-button" type="button" onClick={() => toggleAssessmentArchived(assessment.id, false)}>
                      <RotateCcw size={16} /> Unarchive
                    </button>
                  ) : (
                    <button className="secondary-button" type="button" onClick={() => toggleAssessmentArchived(assessment.id, true)}>
                      <Archive size={16} /> Archive
                    </button>
                  )}
                </div>
              </article>
            ))}
          </div>
        )}

      </section>

      {builderOpen ? (
        <section className="course-list-panel assessment-builder-panel" aria-label="Assessment builder">
          <div className="course-list-header teacher-builder-header">
            <div>
              <h2>{assessmentMode === "edit" ? "Edit Assessment" : "Assessment Builder"}</h2>
            </div>
            <div className="teacher-builder-tabs" role="tablist" aria-label="Assessment builder sections">{(["prompt", "rubric", "settings"] as const).map((tab, index, tabs) => <button type="button" key={tab} role="tab" id={`builder-tab-${tab}`} aria-controls={`builder-panel-${tab}`} aria-selected={builderTab === tab} tabIndex={builderTab === tab ? 0 : -1} onClick={() => setBuilderTab(tab)} onKeyDown={event => {
              const next = event.key === "ArrowRight" ? tabs[(index + 1) % tabs.length] : event.key === "ArrowLeft" ? tabs[(index + tabs.length - 1) % tabs.length] : event.key === "Home" ? tabs[0] : event.key === "End" ? tabs[tabs.length - 1] : null;
              if (next) { event.preventDefault(); setBuilderTab(next); document.getElementById(`builder-tab-${next}`)?.focus(); }
            }}>{tab === "prompt" ? "Prompt" : tab === "rubric" ? "Rubric" : "Models & settings"}</button>)}</div>
            <button className="secondary-button assessment-builder-close" type="button" aria-label="Close assessment builder" title="Close builder" onClick={() => {
              resetAssessmentForm();
              setBuilderOpen(false);
            }}><X size={16} /></button>
          </div>
          <form className="assessment-builder-form compact-assessment-builder" onSubmit={submitAssessment} noValidate>
            <section className="assessment-builder-section assessment-span-full">
              <div className="assessment-builder-section-grid assessment-basics-fields">
                <label>
                  Type
                  <select value={assessmentType} onChange={(event) => setAssessmentType(event.target.value as AssessmentType)}>
                    <option value="voice">Voice Message</option>
                    <option value="voice_realtime">Live Voice Assessment</option>
                    <option value="writing">Writing</option>
                    <option value="simulation">Simulation</option>
                  </select>
                </label>
                <label>
                  Title
                  <input value={assessmentTitle} onChange={(event) => setAssessmentTitle(event.target.value)} autoComplete="off" required />
                </label>
              </div>
            </section>

            <section className="assessment-builder-section assessment-span-full teacher-builder-tabpanel" id="builder-panel-prompt" role="tabpanel" aria-labelledby="builder-tab-prompt" data-builder-tab="prompt" hidden={builderTab !== "prompt"}>
              <div className="assessment-builder-section-grid assessment-prompt-fields">
                <label>
                  Prompt
                  <textarea value={assessmentPrompt} onChange={(event) => setAssessmentPrompt(event.target.value)} rows={4} required />
                </label>
                <label>
                  Expected answer (optional)
                  <textarea value={assessmentExpectedAnswer} onChange={(event) => setAssessmentExpectedAnswer(event.target.value)} rows={4} />
                </label>
              </div>
            </section>

            <div className="teacher-builder-tabpanel" id="builder-panel-rubric" role="tabpanel" aria-labelledby="builder-tab-rubric" data-builder-tab="rubric" hidden={builderTab !== "rubric"}>
            <section className="assessment-builder-section assessment-span-full">
              <div className="assessment-section-heading"><h4>Rubric</h4><span>{rubricRows.length} {rubricRows.length === 1 ? "criterion" : "criteria"}</span></div>
              <div className="rubric-editor">
                {rubricRows.map((row, index) => (
                  <article key={`rubric-${index}`} className="rubric-editor-row" aria-label={`Criterion ${index + 1}`}>
                    <label>
                      Name
                      <input value={row.name} onChange={(event) => updateRubricRow(index, { name: event.target.value })} />
                    </label>
                    <label>
                      Max points
                      <input
                        value={row.maxPoints}
                        onChange={(event) => updateRubricRow(index, { maxPoints: event.target.value })}
                        inputMode="numeric"
                        pattern="[0-9]*"
                      />
                    </label>
                    <div className="rubric-remove-control">
                      <button
                        className="secondary-button rubric-remove-button"
                        type="button"
                        aria-label={`Remove criterion ${index + 1}`}
                        title="Remove criterion"
                        onClick={() => removeRubricRow(index)}
                        disabled={rubricRows.length === 1}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                    <label className="assessment-span-full rubric-description-field">
                      Description
                      <textarea value={row.description} onChange={(event) => updateRubricRow(index, { description: event.target.value })} rows={2} />
                    </label>
                  </article>
                ))}
              </div>
              <div className="rubric-editor-actions">
                <button className="secondary-button" type="button" onClick={addRubricRow}>
                  <Plus size={14} /> Add criterion
                </button>
              </div>
            </section>

            <details className="assessment-builder-section assessment-builder-options assessment-span-full">
              <summary>Scoring<span>{scoringMode === "additive" ? "Rubric percentage" : scoringMode === "capped" ? "Score caps" : "Teacher adjustments"}</span></summary>
              <div className="assessment-option-fields">
                <label>Total calculation
                  <select value={scoringMode} onChange={(event) => setScoringMode(event.target.value)}>
                    <option value="additive">Percentage of rubric points</option>
                    <option value="capped">Rubric percentage with score caps</option>
                    <option value="review_adjustments">Teacher reviews any total adjustment</option>
                  </select>
                </label>
                {scoringMode === "capped" && <>
                  {scoringCaps.map((cap, index) => <div className="assessment-builder-section-grid" key={cap.id}>
                    <label>Apply this cap when
                      <input required value={cap.condition} onChange={(event) => setScoringCaps((caps) => caps.map((c, i) => i === index ? { ...c, condition: event.target.value } : c))} />
                    </label>
                    <label>Maximum total (%)
                      <input required type="number" min="0" max="100" value={cap.maximumPercent} onChange={(event) => setScoringCaps((caps) => caps.map((c, i) => i === index ? { ...c, maximumPercent: Number(event.target.value) } : c))} />
                    </label>
                    <button className="secondary-button" type="button" onClick={() => setScoringCaps((caps) => caps.filter((_, i) => i !== index))}>Remove cap</button>
                  </div>)}
                  <button className="secondary-button" type="button" onClick={() => setScoringCaps((caps) => [...caps, { id: crypto.randomUUID(), condition: "", maximumPercent: 50 }])}>Add score cap</button>
                </>}
              </div>
            </details>
            </div>
            <div className="teacher-builder-tabpanel" id="builder-panel-settings" role="tabpanel" aria-labelledby="builder-tab-settings" data-builder-tab="settings" hidden={builderTab !== "settings"}>
            <details className="assessment-builder-section assessment-builder-options assessment-span-full" open>
              <summary>Type settings<span>{formatAssessmentTypeLabel(assessmentType)}</span></summary>
              <div className="assessment-builder-section-grid compact-settings-grid">
                {assessmentType === "voice" && (
                  <label>
                    Max recording seconds
                    <input
                      value={voiceMaxRecordingSec}
                      onChange={(event) => setVoiceMaxRecordingSec(event.target.value)}
                      inputMode="numeric"
                      pattern="[0-9]*"
                    />
                  </label>
                )}
                {assessmentType === "voice_realtime" && (
                  <label>
                    Max live session seconds
                    <input
                      value={realtimeVoiceMaxSessionSec}
                      onChange={(event) => setRealtimeVoiceMaxSessionSec(event.target.value)}
                      inputMode="numeric"
                      pattern="[0-9]*"
                    />
                  </label>
                )}
                {assessmentType === "writing" && (
                  <>
                    <label>
                      Accepted MIME types (comma-separated)
                      <input value={writingAcceptedMime} onChange={(event) => setWritingAcceptedMime(event.target.value)} />
                    </label>
                    <label>
                      Max bytes
                      <input value={writingMaxBytes} onChange={(event) => setWritingMaxBytes(event.target.value)} inputMode="numeric" pattern="[0-9]*" />
                    </label>
                  </>
                )}
                {assessmentType === "simulation" && (
                  <>
                    <label>
                      Min description chars
                      <input
                        value={simulationMinDescriptionChars}
                        onChange={(event) => setSimulationMinDescriptionChars(event.target.value)}
                        inputMode="numeric"
                        pattern="[0-9]*"
                      />
                    </label>
                    <label>
                      Code model
                      <select
                        value={simulationCodeModelId}
                        onChange={(event) => {
                          const nextModelId = event.target.value;
                          if (isSimulationCodeModelId(nextModelId)) {
                            setSimulationCodeModelId(nextModelId);
                          }
                        }}
                      >
                        {(aiSettings?.codeModels ?? SIMULATION_CODE_MODEL_OPTIONS).map((option) => (
                          <option key={option.id} value={option.id} disabled={"enabled" in option && !option.enabled}>{option.label}</option>
                        ))}
                      </select>
                      {aiSettings?.forceDefaultSimulationModel && <span className="field-help">AI settings will use your default model for all new attempts.</span>}
                    </label>
                  </>
                )}
              </div>
            </details>
            <p className="teacher-model-settings-note"><Link to="/teacher/ai-settings">Open classroom AI settings</Link> to manage provider keys, model assignments, reasoning, token limits, and Fast mode.</p>
            </div>

            <div className="control-row assessment-span-full assessment-builder-save">
              <button className="secondary-button" type="button" onClick={() => previewDialog.current?.showModal()}><Eye size={15} />Student preview</button>
              <button className="primary-button" type="submit" disabled={assessmentSaving}>
                <Save size={16} /> {assessmentSaving ? "Saving" : assessmentMode === "edit" ? "Save assessment" : "Create assessment"}
              </button>
              {assessmentMode === "edit" && (
                <button className="secondary-button" type="button" onClick={resetAssessmentForm}>
                  Cancel edit
                </button>
              )}
              {assessmentMode === "edit" && editingAssessmentId && <Link className="secondary-button" to={`/teacher/assignments?assessment=${encodeURIComponent(editingAssessmentId)}`}>Assign to a class</Link>}
            </div>
          </form>
        </section>
      ) : (
        <section className="course-list-panel assessment-builder-empty" aria-label="Assessment builder">
          <Pencil size={24} aria-hidden="true" />
          <h2>Assessment Builder</h2>
          <p>Choose Edit from the library, or start a new assessment.</p>
          <button className="primary-button" type="button" onClick={() => { resetAssessmentForm(); setBuilderOpen(true); }}><Plus size={15} /> New assessment</button>
        </section>
      )}
      <dialog className="teacher-student-preview" ref={previewDialog} aria-labelledby="student-preview-heading">
        <header><div><span>{formatAssessmentTypeLabel(assessmentType)} · Student preview</span><h2 id="student-preview-heading">{assessmentTitle || "Untitled assessment"}</h2></div><button className="secondary-button" type="button" aria-label="Close student preview" onClick={() => previewDialog.current?.close()}><X size={17} /></button></header>
        <section><h3>The assignment</h3><p className="teacher-preview-prompt">{assessmentPrompt || "Add your student instructions to preview them here."}</p><h3>Success criteria</h3><ul>{buildRubricPayload().map((criterion, index) => <li key={index}><strong>{criterion.name}</strong><span>{criterion.maxPoints} points</span><p>{criterion.description}</p></li>)}</ul><p className="teacher-preview-note">Preview of your current draft. Students receive the saved assessment when you assign it to a class.</p></section>
        <footer><button className="primary-button" type="button" onClick={() => previewDialog.current?.close()}>Back to editing</button></footer>
      </dialog>
    </div>
  );
}

function formatAssessmentTypeLabel(type: AssessmentType): string {
  if (type === "voice") return "Voice Message";
  if (type === "voice_realtime") return "Live Voice Assessment";
  if (type === "writing") return "Writing";
  return "Simulation";
}
