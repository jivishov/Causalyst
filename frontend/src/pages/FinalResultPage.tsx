import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, FileCheck2 } from "lucide-react";
import type { StudentPublishedFinalResultResponse } from "@alt-assessment/shared";
import { RubricFeedback } from "../components/RubricFeedback";
import { getPublishedFinalResult } from "../lib/api";

export function FinalResultPage() {
  const { assignmentId } = useParams();
  const [result, setResult] = useState<StudentPublishedFinalResultResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!assignmentId) return;
    setError(null);
    setResult(null);
    getPublishedFinalResult(assignmentId)
      .then(setResult)
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load final result"));
  }, [assignmentId]);

  if (error) {
    return <p className="field-error">{error}</p>;
  }
  if (!result) {
    return <p className="status-line">Loading final result</p>;
  }

  return (
    <div className="page-stack">
      <Link className="text-button" to="/">
        <ArrowLeft size={17} /> Dashboard
      </Link>
      <header className="page-header">
        <div>
          <h1>{result.assessment.title}</h1>
          <p>{result.classCode} · {result.className}</p>
        </div>
      </header>
      <section className="evidence-panel final-grade-panel">
        <h2><FileCheck2 size={20} /> Published Final Grade</h2>
        <p>
          Status: <strong>{formatFinalStatus(result.publishedGrade.finalStatus)}</strong>
          {" · "}
          Score: <strong>{result.publishedGrade.finalScore ?? "Not scored"}</strong>
        </p>
        <p>Published at {new Date(result.publishedGrade.publishedAt).toLocaleString()}</p>
        {result.latestAttempt?.attemptId && (
          <Link className="text-button" to={`/attempt/${result.latestAttempt.attemptId}`}>View submission evidence</Link>
        )}
      </section>
      <section className="evidence-panel">
        <h2>Assessment Prompt</h2>
        <p>{result.assessment.prompt}</p>
      </section>
      {result.publishedGrade.finalStatus === "approved_ai" && result.publishedGrade.feedback && (
        <RubricFeedback
          feedback={result.publishedGrade.feedback}
          rubric={result.assessment.rubric}
          heading="Published Feedback"
          subheading="This feedback is part of the published final result."
        />
      )}
    </div>
  );
}

function formatFinalStatus(status: "approved_ai" | "teacher_override" | "missing"): string {
  if (status === "approved_ai") return "Approved AI";
  if (status === "teacher_override") return "Teacher Override";
  return "Missing";
}
