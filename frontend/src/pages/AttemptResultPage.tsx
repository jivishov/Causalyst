import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import type { AttemptResult } from "@alt-assessment/shared";
import { RubricFeedback } from "../components/RubricFeedback";
import { SimulationPreviewFrame } from "../components/SimulationPreviewFrame";
import { SimulationRenderer } from "../components/SimulationRenderer";
import { getAttemptResult, getSimulationPreviewUrl } from "../lib/api";

export function AttemptResultPage() {
  const { attemptId } = useParams();
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
    getAttemptResult(attemptId)
      .then(setResult)
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load result"));
  }, [attemptId]);

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
    return <p className="field-error">{error}</p>;
  }
  if (!result) {
    return <p className="status-line">Loading result</p>;
  }

  return (
    <div className="page-stack">
      <Link className="text-button" to="/">
        <ArrowLeft size={17} /> Dashboard
      </Link>
      <header className="page-header">
        <div>
          <h1>{result.assessment.title}</h1>
          <p>Published final-grade status is shown separately from provisional automated feedback.</p>
        </div>
      </header>
      {result.publishedGrade && (
        <section className="evidence-panel final-grade-panel">
          <h2>Published Final Grade</h2>
          <p>
            Status: <strong>{formatFinalStatus(result.publishedGrade.finalStatus)}</strong>
            {" · "}
            Score: <strong>{result.publishedGrade.finalScore ?? "Not scored"}</strong>
          </p>
          <p>Published at {new Date(result.publishedGrade.publishedAt).toLocaleString()}</p>
        </section>
      )}
      <section className="evidence-panel">
        <h2>Assessment Prompt</h2>
        <p>{result.assessment.prompt}</p>
      </section>
      {!isApprovedAiPublishedWithFeedback(result) && (
        <RubricFeedback
          feedback={result.provisionalFeedback}
          rubric={result.assessment.rubric}
          heading="Provisional Automated Feedback"
          subheading="This score can differ from a teacher-published final grade."
        />
      )}
      {isApprovedAiPublishedWithFeedback(result) && result.publishedGrade?.feedback && (
        <RubricFeedback
          feedback={result.publishedGrade.feedback}
          rubric={result.assessment.rubric}
          heading="Published Feedback"
          subheading="This feedback is part of the published final result."
        />
      )}
      {result.transcript && (
        <section className="evidence-panel">
          <h2>Transcript</h2>
          <p>{result.transcript}</p>
        </section>
      )}
      {result.ocrText && (
        <section className="evidence-panel">
          <h2>Transcribed Writing</h2>
          <p>{result.ocrText}</p>
        </section>
      )}
      {result.simulationSpec && <SimulationRenderer spec={result.simulationSpec} />}
      {result.simulationSketchPreview && (
        <section className="evidence-panel">
          <h2>Generated Sketch</h2>
          <button className="secondary-button" type="button" onClick={() => { void reloadSketchPreview(); }} disabled={sketchPreviewLoading}>
            {sketchPreviewLoading ? "Reloading sketch" : "Reload sketch"}
          </button>
          {sketchPreviewError && <p className="field-error">{sketchPreviewError}</p>}
          {sketchPreviewUrl ? (
            <img className="sketch-preview-image" alt="Generated simulation sketch" src={sketchPreviewUrl} />
          ) : (
            <p className="status-line">Sketch unavailable.</p>
          )}
        </section>
      )}
      {result.simulationPreview && (
        <section className="evidence-panel">
          <div className="safe-preview-header">
            <h2>Simulation Preview</h2>
            <div className="preview-actions">
              <button className="secondary-button" type="button" onClick={() => { void reloadSimulationPreview(); }} disabled={simulationPreviewLoading}>
                {simulationPreviewLoading ? "Reloading preview" : "Reload preview"}
              </button>
            </div>
          </div>
          {simulationPreviewError && <p className="field-error">{simulationPreviewError}</p>}
          {simulationPreviewUrl ? (
            <SimulationPreviewFrame
              artifactId={result.simulationPreview.artifactId}
              title="Recovered simulation preview"
              src={simulationPreviewUrl}
              viewport={result.simulationPreview.htmlViewport}
            />
          ) : (
            <p className="status-line">Preview unavailable.</p>
          )}
        </section>
      )}
    </div>
  );
}

function formatFinalStatus(status: "approved_ai" | "teacher_override" | "missing"): string {
  if (status === "approved_ai") return "Approved AI";
  if (status === "teacher_override") return "Teacher Override";
  return "Missing";
}

function isApprovedAiPublishedWithFeedback(result: AttemptResult): boolean {
  return result.publishedGrade?.finalStatus === "approved_ai" && Boolean(result.publishedGrade.feedback);
}
