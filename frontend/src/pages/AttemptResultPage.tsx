import { useEffect, useId, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Check, Clock3, FileText, Image, Maximize2, Minimize2, Play, RotateCw } from "lucide-react";
import type { AttemptResult } from "@alt-assessment/shared";
import { RubricFeedback } from "../components/RubricFeedback";
import { AssignmentPrompt } from "../components/AssignmentPrompt";
import { PublishedGradeSummary, SubmissionHeader, SubmissionPanel, SubmissionTabs, type SubmissionTab } from "../components/SubmissionLayout";
import { SimulationPreviewFrame } from "../components/SimulationPreviewFrame";
import { SimulationRenderer } from "../components/SimulationRenderer";
import { getAttemptResult, getSimulationPreviewUrl } from "../lib/api";
import { useSession } from "../state/session";

export function AttemptResultPage() {
  const { attemptId } = useParams();
  return <AttemptResultWorkspace key={attemptId} attemptId={attemptId} />;
}

function AttemptResultWorkspace({ attemptId }: { attemptId: string | undefined }) {
  const { rememberAttemptResult } = useSession();
  const [result, setResult] = useState<AttemptResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [simulationPreviewUrl, setSimulationPreviewUrl] = useState<string | null>(null);
  const [simulationPreviewError, setSimulationPreviewError] = useState<string | null>(null);
  const [simulationPreviewLoading, setSimulationPreviewLoading] = useState(false);
  const [sketchPreviewUrl, setSketchPreviewUrl] = useState<string | null>(null);
  const [sketchPreviewError, setSketchPreviewError] = useState<string | null>(null);
  const [sketchPreviewLoading, setSketchPreviewLoading] = useState(false);
  const simulationPreviewUrlRef = useRef<string | null>(null);
  const sketchPreviewUrlRef = useRef<string | null>(null);
  const previewRequestIdRef = useRef(0);
  const sketchRequestIdRef = useRef(0);
  const resultRequestIdRef = useRef(0);
  const panelId = useId();
  const [activeTab, setActiveTab] = useState<SubmissionTab>("submission");
  const previewPanelRef = useRef<HTMLElement | null>(null);
  const [previewExpanded, setPreviewExpanded] = useState(false);

  useEffect(() => {
    const onFullscreenChange = () => setPreviewExpanded(document.fullscreenElement === previewPanelRef.current && previewPanelRef.current !== null);
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => { document.removeEventListener("fullscreenchange", onFullscreenChange); };
  }, []);

  async function togglePreviewExpanded() {
    try {
      if (document.fullscreenElement === previewPanelRef.current) await document.exitFullscreen();
      else await previewPanelRef.current?.requestFullscreen();
    } catch {
      setSimulationPreviewError("The preview could not open in full screen. You can continue using it here.");
    }
  }

  async function reloadResult() {
    if (!attemptId) return;
    const requestId = ++resultRequestIdRef.current;
    setError(null);
    try {
      const loaded = await getAttemptResult(attemptId);
      if (resultRequestIdRef.current !== requestId) return;
      setResult(loaded);
      rememberAttemptResult(loaded);
    } catch (err) {
      if (resultRequestIdRef.current !== requestId) return;
      setError(err instanceof Error ? err.message : "Could not load result");
    }
  }

  useEffect(() => {
    if (!attemptId) return;
    previewRequestIdRef.current += 1;
    sketchRequestIdRef.current += 1;
    setError(null);
    setResult(null);
    setSimulationPreviewError(null);
    setSimulationPreviewLoading(false);
    setSketchPreviewError(null);
    setSketchPreviewLoading(false);
    setSimulationPreviewUrl((existing) => {
      if (existing) URL.revokeObjectURL(existing);
      simulationPreviewUrlRef.current = null;
      return null;
    });
    setSketchPreviewUrl((existing) => {
      if (existing) URL.revokeObjectURL(existing);
      sketchPreviewUrlRef.current = null;
      return null;
    });
    void reloadResult();
    return () => {
      resultRequestIdRef.current += 1;
      previewRequestIdRef.current += 1;
      sketchRequestIdRef.current += 1;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attemptId, rememberAttemptResult]);

  useEffect(() => {
    return () => {
      previewRequestIdRef.current += 1;
      sketchRequestIdRef.current += 1;
      if (simulationPreviewUrlRef.current) {
        URL.revokeObjectURL(simulationPreviewUrlRef.current);
      }
      if (sketchPreviewUrlRef.current) {
        URL.revokeObjectURL(sketchPreviewUrlRef.current);
      }
    };
  }, []);

  async function reloadSketchPreview() {
    if (!result?.simulationSketchPreview) return;
    const requestId = sketchRequestIdRef.current + 1;
    sketchRequestIdRef.current = requestId;
    setSketchPreviewError(null);
    setSketchPreviewLoading(true);
    try {
      const url = await getSimulationPreviewUrl(result.simulationSketchPreview);
      if (sketchRequestIdRef.current !== requestId) {
        URL.revokeObjectURL(url);
        return;
      }
      setSketchPreviewUrl((existing) => {
        if (existing) URL.revokeObjectURL(existing);
        sketchPreviewUrlRef.current = url;
        return url;
      });
    } catch (err) {
      if (sketchRequestIdRef.current !== requestId) return;
      setSketchPreviewError(err instanceof Error ? err.message : "Could not load simulation sketch");
    } finally {
      if (sketchRequestIdRef.current !== requestId) return;
      setSketchPreviewLoading(false);
    }
  }

  async function reloadSimulationPreview() {
    if (!result?.simulationPreview) return;
    const requestId = previewRequestIdRef.current + 1;
    previewRequestIdRef.current = requestId;
    setSimulationPreviewError(null);
    setSimulationPreviewLoading(true);
    try {
      const url = await getSimulationPreviewUrl(result.simulationPreview);
      if (previewRequestIdRef.current !== requestId) {
        URL.revokeObjectURL(url);
        return;
      }
      setSimulationPreviewUrl((existing) => {
        if (existing) URL.revokeObjectURL(existing);
        simulationPreviewUrlRef.current = url;
        return url;
      });
    } catch (err) {
      if (previewRequestIdRef.current !== requestId) return;
      setSimulationPreviewError(err instanceof Error ? err.message : "Could not load simulation preview");
    } finally {
      if (previewRequestIdRef.current !== requestId) return;
      setSimulationPreviewLoading(false);
    }
  }

  useEffect(() => {
    if (!result?.simulationPreview) {
      previewRequestIdRef.current += 1;
      setSimulationPreviewUrl((existing) => {
        if (existing) URL.revokeObjectURL(existing);
        simulationPreviewUrlRef.current = null;
        return null;
      });
      setSimulationPreviewError(null);
      return;
    }
    void reloadSimulationPreview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result?.simulationPreview?.artifactId, result?.simulationPreview?.previewToken, result?.simulationPreview?.previewPath]);

  useEffect(() => {
    if (!result?.simulationSketchPreview) {
      sketchRequestIdRef.current += 1;
      setSketchPreviewUrl((existing) => {
        if (existing) URL.revokeObjectURL(existing);
        sketchPreviewUrlRef.current = null;
        return null;
      });
      setSketchPreviewError(null);
      return;
    }
    void reloadSketchPreview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result?.simulationSketchPreview?.artifactId, result?.simulationSketchPreview?.previewToken, result?.simulationSketchPreview?.previewPath]);

  if (error) {
    return (
      <div className="page-stack student-submission-page submission-error">
        <Link className="text-button" to="/"><ArrowLeft size={17} /> Dashboard</Link>
        <h1>Submission unavailable</h1>
        <p className="field-error">{error}</p>
        <p className="submission-feedback-note">Your saved submission has not been changed. Retry loading it below.</p>
        <button className="secondary-button" type="button" onClick={() => { void reloadResult(); }}>Retry loading submission</button>
      </div>
    );
  }
  if (!result) return <p className="status-line" role="status">Loading result</p>;

  return (
    <div className="page-stack student-submission-page">
      <SubmissionHeader title={result.assessment.title} type={result.assessment.type} submittedAt={result.submittedAt}
        context={result.submittedAfterDue ? "Submitted after the due date" : undefined}
        status={result.publishedGrade ? "Final result published" : result.status === "draft" ? "Draft" : result.status === "error" ? "Needs attention" : result.provisionalFeedback ? "Feedback available" : "Submitted"}
        attention={result.status === "error" || result.publishedGrade?.finalStatus === "missing"} />
      <SubmissionTabs id={panelId} value={activeTab} onChange={setActiveTab} tabs={[
        { value: "submission", label: "Your submission" }, { value: "feedback", label: "Feedback" }, { value: "instructions", label: "Assessment prompt" }
      ]}>
        {result.assessment.type === "simulation" && result.status !== "draft" && <p className="submission-save-note" role="status"><Check size={13} aria-hidden="true" />Your simulation submission is saved. You can reopen it from the dashboard.</p>}
      </SubmissionTabs>
      <SubmissionPanel id={panelId} tab="submission" active={activeTab}>
        <div className={`submission-evidence-grid${!result.simulationPreview && !result.simulationSpec ? " without-preview" : ""}`}>
          <div className="submission-evidence-stack">
            {result.simulationDescription && <section className="evidence-panel">
              <div className="submission-card-header"><h2><FileText size={16} aria-hidden="true" />Your Simulation Description</h2><span className="submission-card-label">Saved response</span></div>
              <p className="submission-response-text">{result.simulationDescription}</p>
            </section>}
            {result.transcript && <section className="evidence-panel">
              <div className="submission-card-header"><h2>Transcript</h2><span className="submission-card-label">Saved response</span></div>
              <p className="submission-response-text">{result.transcript}</p>
            </section>}
            {result.ocrText && <section className="evidence-panel">
              <div className="submission-card-header"><h2>Transcribed Writing</h2><span className="submission-card-label">Saved response</span></div>
              <p className="submission-response-text">{result.ocrText}</p>
            </section>}
            {!result.simulationDescription && !result.transcript && !result.ocrText && <section className="evidence-panel"><h2>Submission evidence</h2><p className="overall-comment">No saved text is available for this submission.</p></section>}
            {result.simulationSketchPreview && <details className="submission-sketch">
              <summary><Image size={15} aria-hidden="true" />Generated Sketch<span className="submission-card-label">View sketch</span></summary>
              <div className="submission-sketch-body">
                <button className="secondary-button" type="button" onClick={() => { void reloadSketchPreview(); }} disabled={sketchPreviewLoading}><RotateCw size={14} aria-hidden="true" />{sketchPreviewLoading ? "Reloading sketch" : "Reload sketch"}</button>
                {sketchPreviewError && <p className="field-error">{sketchPreviewError}</p>}
                {sketchPreviewUrl ? <img className="sketch-preview-image" alt="Generated simulation sketch" src={sketchPreviewUrl} /> : <p className="status-line">{sketchPreviewLoading ? "Loading sketch…" : "Sketch unavailable."}</p>}
              </div>
            </details>}
          </div>
          {(result.simulationPreview || result.simulationSpec) && <div className="submission-evidence-stack">
            {result.simulationPreview && <section className="evidence-panel submission-preview-panel" ref={previewPanelRef}>
              <div className="submission-card-header">
                <h2><Play size={15} aria-hidden="true" />Simulation Preview</h2>
                <div className="preview-actions">
                  <button className="secondary-button" type="button" aria-label={simulationPreviewLoading ? "Reloading preview" : "Reload preview"} title="Reload preview" onClick={() => { void reloadSimulationPreview(); }} disabled={simulationPreviewLoading}><RotateCw size={14} aria-hidden="true" /><span>Reload</span></button>
                  {document.fullscreenEnabled && <button className="secondary-button" type="button" aria-label={previewExpanded ? "Exit full screen" : "Expand preview"} title={previewExpanded ? "Exit full screen" : "Expand preview"} aria-pressed={previewExpanded} onClick={() => { void togglePreviewExpanded(); }}>{previewExpanded ? <Minimize2 size={14} aria-hidden="true" /> : <Maximize2 size={14} aria-hidden="true" />}<span>{previewExpanded ? "Exit" : "Expand"}</span></button>}
                </div>
              </div>
              {simulationPreviewError && <p className="field-error">{simulationPreviewError}</p>}
              {simulationPreviewUrl ? <SimulationPreviewFrame artifactId={result.simulationPreview.artifactId} title="Recovered simulation preview" src={simulationPreviewUrl} viewport={result.simulationPreview.htmlViewport} /> : <p className="status-line" role="status">{simulationPreviewLoading ? "Loading your saved simulation…" : "Preview unavailable."}</p>}
            </section>}
            {result.simulationSpec && (result.simulationPreview ? <details className="submission-sketch"><summary><FileText size={15} aria-hidden="true" />Structured simulation<span className="submission-card-label">View model</span></summary><SimulationRenderer spec={result.simulationSpec} /></details> : <SimulationRenderer spec={result.simulationSpec} />)}
          </div>}
        </div>
      </SubmissionPanel>
      <SubmissionPanel id={panelId} tab="feedback" active={activeTab}>
        {result.publishedGrade && <PublishedGradeSummary grade={result.publishedGrade}>{result.assignmentId && <Link className="text-button" to={`/final/${result.assignmentId}`}>View final result</Link>}</PublishedGradeSummary>}
        {!result.publishedGrade && !result.provisionalFeedback && <div className="submission-feedback-note"><Clock3 size={16} aria-hidden="true" /><div><strong>{result.status === "draft" ? "This is a saved draft" : result.status === "error" ? "Feedback is unavailable" : "Feedback has not been published yet"}</strong>{result.status === "draft" ? "Submit your assignment to receive feedback. The assessment rubric is shown below." : "You can return here to check for feedback. The assessment rubric is shown below."}</div></div>}
        {!isApprovedAiPublishedWithFeedback(result) && <RubricFeedback feedback={result.provisionalFeedback} rubric={result.assessment.rubric} heading="Provisional Automated Feedback" subheading="This score can differ from a teacher-published final grade." />}
        {isApprovedAiPublishedWithFeedback(result) && result.publishedGrade?.feedback && <RubricFeedback feedback={result.publishedGrade.feedback} rubric={result.assessment.rubric} heading="Published Feedback" subheading="This feedback is part of the published final result." />}
      </SubmissionPanel>
      <SubmissionPanel id={panelId} tab="instructions" active={activeTab}>
        <section className="evidence-panel"><h2>Assessment Prompt</h2><AssignmentPrompt text={result.assessment.prompt} /></section>
      </SubmissionPanel>
    </div>
  );
}

function isApprovedAiPublishedWithFeedback(result: AttemptResult): boolean {
  return result.publishedGrade?.finalStatus === "approved_ai" && Boolean(result.publishedGrade.feedback);
}
