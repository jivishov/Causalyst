import { FormEvent, useEffect, useState } from "react";
import { Archive, ChevronUp, ClipboardList, Pencil, Plus, RotateCcw, Save, Trash2, X } from "lucide-react";
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
  isSimulationCodeModelId
} from "@alt-assessment/shared";
import { useTeacherWorkspaceData } from "./TeacherWorkspaceData";

type AssessmentEditorMode = "create" | "edit";

interface RubricDraftRow {
  id?: string;
  name: string;
  maxPoints: string;
  description: string;
}

export function TeacherAssessmentsPage() {
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
  const [builderOpen, setBuilderOpen] = useState(false);

  useEffect(() => {
    if (!loadingAssessments && assessments.length === 0) {
      setBuilderOpen(true);
    }
  }, [assessments.length, loadingAssessments]);

  function resetAssessmentForm() {
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
    setSimulationCodeModelId(DEFAULT_SIMULATION_CODE_MODEL_ID);
  }

  function applyAssessmentTemplate(template: AssessmentTemplate) {
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
    setSimulationCodeModelId(DEFAULT_SIMULATION_CODE_MODEL_ID);
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
        isSimulationCodeModelId(assessment.config.simulationCodeModelId)
          ? assessment.config.simulationCodeModelId
          : DEFAULT_SIMULATION_CODE_MODEL_ID
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
    setAssessmentSaving(true);
    setError(null);
    try {
      const rubric = buildRubricPayload();
      if (rubric.length === 0) {
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
    <section className="course-list-panel teacher-assessment-page">
      <div className="course-list-header">
        <div>
          <h2>Assessment Library</h2>
          <p>Create from templates or manage reusable assessment prompts.</p>
        </div>
        <div className="course-actions">
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={includeArchivedAssessments}
              onChange={(event) => setIncludeArchivedAssessments(event.target.checked)}
            />
            Show archived
          </label>
          <button
            className={builderOpen ? "secondary-button" : "primary-button"}
            type="button"
            onClick={() => {
              if (builderOpen) {
                resetAssessmentForm();
                setBuilderOpen(false);
              } else {
                resetAssessmentForm();
                setBuilderOpen(true);
              }
            }}
          >
            {builderOpen ? <X size={16} /> : <Plus size={16} />}
            {builderOpen ? "Close builder" : "New assessment"}
          </button>
        </div>
      </div>
      <div className="assessment-template-panel">
        <div>
          <strong>Scaffolded templates</strong>
          <p>Load a complete writing assessment with prompt, answer key, rubric, and upload settings.</p>
        </div>
        <button
          className="secondary-button"
          type="button"
          onClick={() => applyAssessmentTemplate(FINDING_TO_QUESTION_TEMPLATE)}
        >
          <ClipboardList size={16} /> Load Finding-to-Question
        </button>
      </div>

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
        <div className="course-list">
          {assessments.map((assessment) => (
            <article key={assessment.id} className="course-row">
              <div>
                <strong>{assessment.title}</strong>
                <p>{formatAssessmentTypeLabel(assessment.type)} · {assessment.rubric.length} rubric criteria</p>
                {assessment.archivedAt && <span className="archive-badge">Archived</span>}
              </div>
              <div className="course-actions">
                <button className="secondary-button" type="button" onClick={() => beginEditAssessment(assessment)}>
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

      {builderOpen && (
        <div className="assessment-builder-panel">
          <div className="course-list-header">
            <div>
              <h3>{assessmentMode === "edit" ? `Edit Assessment: ${assessmentTitle || "Untitled"}` : "Assessment Builder"}</h3>
              <p>Keep the library focused while editing the full prompt, rubric, and type settings here.</p>
            </div>
            <ChevronUp size={18} aria-hidden="true" />
          </div>
          <form className="assessment-builder-form compact-assessment-builder" onSubmit={submitAssessment}>
            <section className="assessment-builder-section assessment-span-full">
              <h4>Scoring</h4>
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
                  <button type="button" onClick={() => setScoringCaps((caps) => caps.filter((_, i) => i !== index))}>Remove cap</button>
                </div>)}
                <button type="button" onClick={() => setScoringCaps((caps) => [...caps, { id: crypto.randomUUID(), condition: "", maximumPercent: 50 }])}>Add score cap</button>
              </>}
            </section>
            <section className="assessment-builder-section assessment-span-full">
              <h4>Basics</h4>
              <div className="assessment-builder-section-grid">
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

            <section className="assessment-builder-section assessment-span-full">
              <h4>Prompt</h4>
              <div className="assessment-builder-section-grid">
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

            <section className="assessment-builder-section assessment-span-full">
              <h4>Rubric</h4>
              <div className="rubric-editor">
                {rubricRows.map((row, index) => (
                  <article key={`rubric-${index}`} className="rubric-editor-row">
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
                    <label className="assessment-span-full">
                      Description
                      <textarea value={row.description} onChange={(event) => updateRubricRow(index, { description: event.target.value })} rows={2} />
                    </label>
                    <div className="assessment-span-full">
                      <button
                        className="secondary-button"
                        type="button"
                        onClick={() => removeRubricRow(index)}
                        disabled={rubricRows.length === 1}
                      >
                        <Trash2 size={14} /> Remove
                      </button>
                    </div>
                  </article>
                ))}
              </div>
              <div className="rubric-editor-actions">
                <button className="secondary-button" type="button" onClick={addRubricRow}>
                  <Plus size={14} /> Add criterion
                </button>
              </div>
            </section>

            <section className="assessment-builder-section assessment-span-full">
              <h4>Type Settings</h4>
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
                        {SIMULATION_CODE_MODEL_OPTIONS.map((option) => (
                          <option key={option.id} value={option.id}>{option.label}</option>
                        ))}
                      </select>
                    </label>
                  </>
                )}
              </div>
            </section>

            <div className="control-row assessment-span-full">
              <button className="primary-button" type="submit" disabled={assessmentSaving}>
                <Save size={16} /> {assessmentSaving ? "Saving" : assessmentMode === "edit" ? "Save assessment" : "Create assessment"}
              </button>
              {assessmentMode === "edit" && (
                <button className="secondary-button" type="button" onClick={resetAssessmentForm}>
                  Cancel edit
                </button>
              )}
            </div>
          </form>
        </div>
      )}
    </section>
  );
}

function formatAssessmentTypeLabel(type: AssessmentType): string {
  if (type === "voice") return "Voice Message";
  if (type === "voice_realtime") return "Live Voice Assessment";
  if (type === "writing") return "Writing";
  return "Simulation";
}
