import { useEffect, useId, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, FileText } from "lucide-react";
import type { StudentPublishedFinalResultResponse } from "@alt-assessment/shared";
import { RubricFeedback } from "../components/RubricFeedback";
import { AssignmentPrompt } from "../components/AssignmentPrompt";
import { PublishedGradeSummary, SubmissionHeader, SubmissionPanel, SubmissionTabs, type SubmissionTab } from "../components/SubmissionLayout";
import { getPublishedFinalResult } from "../lib/api";

export function FinalResultPage() {
  const { assignmentId } = useParams();
  return <FinalResultWorkspace key={assignmentId} assignmentId={assignmentId} />;
}

function FinalResultWorkspace({ assignmentId }: { assignmentId: string | undefined }) {
  const [result, setResult] = useState<StudentPublishedFinalResultResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const panelId = useId();
  const [activeTab, setActiveTab] = useState<SubmissionTab>("feedback");

  useEffect(() => {
    if (!assignmentId) return;
    setError(null);
    setResult(null);
    let cancelled = false;
    getPublishedFinalResult(assignmentId)
      .then(loaded => { if (!cancelled) setResult(loaded); })
      .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : "Could not load final result"); });
    return () => { cancelled = true; };
  }, [assignmentId]);

  if (error) return <div className="page-stack student-submission-page submission-error"><Link className="text-button" to="/"><ArrowLeft size={17} />Dashboard</Link><h1>Final result unavailable</h1><p className="field-error">{error}</p></div>;
  if (!result) return <p className="status-line" role="status">Loading final result</p>;

  return (
    <div className="page-stack student-submission-page">
      <SubmissionHeader title={result.assessment.title} type={result.assessment.type} context={`${result.classCode} · ${result.className}`} status="Final result published" attention={result.publishedGrade.finalStatus === "missing"} />
      <SubmissionTabs id={panelId} value={activeTab} onChange={setActiveTab} tabs={[{ value: "feedback", label: "Final result" }, { value: "instructions", label: "Assessment prompt" }]} />
      <SubmissionPanel id={panelId} tab="feedback" active={activeTab}>
        <PublishedGradeSummary grade={result.publishedGrade}>
          {result.latestAttempt?.attemptId && <Link className="text-button" to={`/attempt/${result.latestAttempt.attemptId}`}><FileText size={14} aria-hidden="true" />View submission evidence</Link>}
        </PublishedGradeSummary>
        {result.publishedGrade.finalStatus === "approved_ai" && result.publishedGrade.feedback && <RubricFeedback feedback={result.publishedGrade.feedback} rubric={result.assessment.rubric} heading="Published Feedback" subheading="This feedback is part of the published final result." />}
      </SubmissionPanel>
      <SubmissionPanel id={panelId} tab="instructions" active={activeTab}>
        <section className="evidence-panel"><h2>Assessment Prompt</h2><AssignmentPrompt text={result.assessment.prompt} /></section>
      </SubmissionPanel>
    </div>
  );
}
