import { useEffect, useRef, useState } from "react";
import { Check, LoaderCircle, RotateCcw, Sparkles, X } from "lucide-react";
import { Link } from "react-router-dom";
import { teacherProviderModels, type AssessmentBuilderAction, type AssessmentBuilderAiResponse, type AssessmentBuilderDraft, type AssessmentType, type TeacherAiSettings } from "@alt-assessment/shared";
import { teacherApiFetch } from "../../lib/api";

interface Props {
  open: boolean;
  action: AssessmentBuilderAction;
  type: AssessmentType;
  draft: AssessmentBuilderDraft;
  settings: TeacherAiSettings | null;
  aiPrompts?: import("@alt-assessment/shared").AiPromptOverrides;
  assessmentId?: string | null;
  promptsReady?: boolean;
  onClose: () => void;
  onBusyChange: (busy: boolean) => void;
  onApply: (draft: AssessmentBuilderDraft) => void;
}
const titles = { assessment: "Generate assessment with AI", rubric: "Generate rubric with AI", reviewRubric: "Review rubric with AI" };

export function TeacherAssessmentAiPanel({ open, action, type, draft, settings, aiPrompts, assessmentId, promptsReady = true, onClose, onBusyChange, onApply }: Props) {
  const [assessmentRequest, setAssessmentRequest] = useState("");
  const [rubricRequest, setRubricRequest] = useState("");
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [proposal, setProposal] = useState<AssessmentBuilderAiResponse | null>(null);
  const [proposalSource, setProposalSource] = useState("");
  const [undo, setUndo] = useState<AssessmentBuilderDraft | null>(null);
  const [usedModel, setUsedModel] = useState<AssessmentBuilderAiResponse["model"] | null>(null);
  const requestField = useRef<HTMLTextAreaElement>(null);
  const mounted = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; onBusyChange(false); }; }, [onBusyChange]);
  useEffect(() => { if (open) requestField.current?.focus(); }, [open, action]);
  useEffect(() => {
    if (!busy) return;
    const start = Date.now();
    const timer = window.setInterval(() => setElapsed(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, [busy]);

  const request = action === "assessment" ? assessmentRequest : rubricRequest;
  const assignment = settings?.roleModels.assessmentBuilder;
  const catalogModel = settings && assignment ? teacherProviderModels(settings).find(model => assignment.catalogModelId ? model.id === assignment.catalogModelId : model.provider === "openai" && model.modelId === assignment.id) : null;
  const fingerprint = JSON.stringify({ type, draft, aiPrompts });
  const proposalCurrent = proposalSource === fingerprint;
  const canRun = !busy && promptsReady && (action === "assessment" ? Boolean(request.trim()) : Boolean(draft.prompt.trim()) && (action !== "reviewRubric" || draft.rubric.length > 0));

  function apply(next: AssessmentBuilderDraft) {
    setUndo(structuredClone(draft));
    onApply(next);
  }
  async function generate() {
    if (!canRun) return;
    setBusy(true); onBusyChange(true); setElapsed(0); setError(null); setMessage(null); setProposal(null);
    const before = structuredClone(draft);
    try {
      const result = await teacherApiFetch<AssessmentBuilderAiResponse>("/teacher/assessments/generate", {
        method: "POST", body: JSON.stringify({ action, type, request, assessment: before, assessmentId, aiPrompts })
      }, 300000);
      if (!mounted.current) return;
      setUsedModel(result.model);
      if (result.action === "assessment" && result.draft) {
        setUndo(before); onApply(result.draft);
        setMessage("Draft filled. Review the prompt, expected answer, and rubric, then save the assessment.");
      } else {
        setProposal(result); setProposalSource(fingerprint);
        setMessage(result.action === "reviewRubric" ? "Review the feedback and proposed rubric below. Apply it when ready." : "Your proposed rubric is ready. Review it below, then apply it.");
      }
    } catch (err) {
      if (mounted.current) setError(err instanceof Error ? err.message : "AI generation could not finish. Your draft and request were kept.");
    } finally {
      if (mounted.current) { setBusy(false); onBusyChange(false); }
    }
  }

  return <section id="assessment-ai-panel" className="assessment-ai-panel assessment-span-full" aria-label="AI assessment assistant" hidden={!open}>
    <div className="assessment-ai-heading"><h4><Sparkles size={16} />{titles[action]}</h4><button className="icon-button" type="button" onClick={onClose} aria-label="Collapse AI assistant" disabled={busy}><X size={16} /></button></div>
    <p className="field-help">{action === "assessment" ? "Describe the objective, class, subject, student level, time, and any requirements. AI fills a draft for you to edit." : "AI uses the current assessment prompt and expected answer. Add any rubric instructions below."}</p>
    <p className="assessment-ai-model">{assignment ? <>{catalogModel?.label || assignment.id} · {assignment.reasoningEffort === "none" ? "Provider default" : assignment.reasoningEffort + " reasoning"} · {assignment.maxOutputTokens?.toLocaleString() || "App default"} tokens{assignment.fastMode === true ? " · Fast" : ""}</> : "Uses your saved Assessment Builder model"} <Link to="/teacher/ai-settings">AI settings</Link></p>
    <label>{action === "assessment" ? "AI assessment request" : "Rubric instructions (optional)"}<textarea ref={requestField} value={request} maxLength={16000} rows={4} disabled={busy} onChange={event => action === "assessment" ? setAssessmentRequest(event.target.value) : setRubricRequest(event.target.value)} placeholder={action === "assessment" ? "For Honors Chemistry, create a 15-minute simulation assessment about Boyle’s law. Students should explain pressure–volume relationships at constant temperature and test a prediction. Use a 20-point rubric." : "For example: keep a 20-point total, clarify partial credit, and emphasize scientific reasoning."} /></label>
    {action !== "assessment" && !draft.prompt.trim() && <p className="field-help">Add the assessment prompt in the Prompt tab first.</p>}
    {action === "reviewRubric" && draft.rubric.length === 0 && <p className="field-help">Add at least one complete rubric criterion to review.</p>}
    <div className="assessment-ai-actions"><button className="primary-button" type="button" disabled={!canRun} onClick={() => void generate()}>{busy ? <LoaderCircle className="assessment-ai-spinner" size={16} /> : <Sparkles size={16} />}{busy ? "Generating…" : "Generate Now"}</button>
      {undo && <button className="secondary-button" type="button" disabled={busy} onClick={() => { onApply(undo); setUndo(null); setProposal(null); setMessage("AI changes undone. Your request is still available."); }}><RotateCcw size={14} />Undo AI changes</button>}
    </div>
    {busy && <p className="assessment-ai-status" role="status" aria-live="polite">Working on your {action === "assessment" ? "assessment draft" : "rubric"} · {elapsed}s. Reasoning may take a few minutes.</p>}
    {error && <p className="assessment-ai-error" role="alert">{error}</p>}
    {message && <p className="assessment-ai-status" role="status">{message}</p>}
    {usedModel && !busy && <p className="field-help">Last result: {usedModel.id} · {usedModel.reasoningEffort === "none" ? "Provider default" : usedModel.reasoningEffort + " reasoning"}{usedModel.fastMode ? " · Fast" : ""}</p>}
    {proposal && <div className="assessment-ai-proposal">
      {proposal.feedback.length > 0 && <><h4>AI feedback</h4><ul>{proposal.feedback.map((item, index) => <li key={index}>{item}</li>)}</ul></>}
      <div className="assessment-section-heading"><h4>Proposed rubric</h4><span>{proposal.rubric.reduce((sum, criterion) => sum + criterion.maxPoints, 0)} points</span></div>
      <div className="assessment-ai-criteria">{proposal.rubric.map((criterion, index) => <article key={index}><div><strong>{criterion.name}</strong><span>{criterion.maxPoints} points</span></div><p>{criterion.description}</p></article>)}</div>
      {!proposalCurrent && <p className="assessment-ai-error" role="status">The assessment or rubric has changed since this proposal. Generate again to review the current draft.</p>}
      <button className="primary-button" type="button" disabled={busy || !proposalCurrent} onClick={() => { apply({ ...draft, rubric: proposal.rubric }); setProposal(null); setMessage("Rubric applied. Review it in the Rubric tab, then save the assessment."); }}><Check size={15} />{proposal.action === "reviewRubric" ? "Apply revised rubric" : "Apply generated rubric"}</button>
    </div>}
  </section>;
}
