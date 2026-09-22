import { useEffect, useMemo, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import type { AssessmentSummary, StudentAssignmentSummary } from "@alt-assessment/shared";
import { ApiRequestError, startAttempt } from "../lib/api";
import { extractLifecycleAssignmentId, extractLifecycleAttemptId, resolveStudentLifecycleError } from "../lib/studentLifecycle";
import { useSession } from "../state/session";
import { VoiceAssessment } from "./assessment/VoiceAssessment";
import { RealtimeVoiceAssessment } from "./assessment/RealtimeVoiceAssessment";
import { WritingAssessment } from "./assessment/WritingAssessment";
import { SimulationAssessment, type SimulationDraftState } from "./assessment/SimulationAssessment";

export function AssessmentPage() {
  const { assignmentId } = useParams();
  const navigate = useNavigate();
  const { assignments } = useSession();
  const assignment = useMemo(() => assignments.find((item) => item.assignmentId === assignmentId), [assignmentId, assignments]);
  const [attemptId, setAttemptId] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [simulationDraft, setSimulationDraft] = useState<SimulationDraftState | null>(null);
  const [attemptAssignment, setAttemptAssignment] = useState<StudentAssignmentSummary | null>(null);

  useEffect(() => {
    setAttemptId(null);
    setSimulationDraft(null);
    setAttemptAssignment(null);
  }, [assignment?.assignmentId]);

  useEffect(() => {
    if (!assignment) return;
    if (attemptId || assignment.publishedGrade) return;

    let cancelled = false;
    startAttempt(assignment.assignmentId)
      .then((created) => {
        if (cancelled) return;
        setAttemptId(created.attemptId);
        setAttemptAssignment(created.assignment);
        setSimulationDraft(created.simulationDraft ? {
          attemptId: created.attemptId,
          ...created.simulationDraft
        } : null);
      })
      .catch((err) => {
        if (!cancelled) setError(resolveStudentLifecycleError(err));
      });

    return () => {
      cancelled = true;
    };
  }, [assignment, assignment?.assignmentId, assignment?.assessment.type, assignment?.latestAttempt?.status, attemptId]);

  if (!assignment) return <Navigate to="/" replace />;
  const activeAssignment = attemptAssignment?.assignmentId === assignment.assignmentId ? attemptAssignment : assignment;
  const activeAssessment = activeAssignment.assessment;

  async function ensureAttempt() {
    if (attemptId) return attemptId;
    const created = await startAttempt(activeAssignment.assignmentId);
    setAttemptId(created.attemptId);
    setAttemptAssignment(created.assignment);
    setSimulationDraft(created.simulationDraft ? {
      attemptId: created.attemptId,
      ...created.simulationDraft
    } : null);
    return created.attemptId;
  }

  async function runSubmission(task: (id: string) => Promise<void>): Promise<void> {
    setError(null);
    setWorking(true);
    try {
      await task(await ensureAttempt());
    } catch (err: unknown) {
      if (err instanceof ApiRequestError && (err.code === "already_submitted" || err.code === "final_published")) {
        const attemptIdFromError = extractLifecycleAttemptId(err);
        if (attemptIdFromError) {
          navigate(`/attempt/${attemptIdFromError}`);
          return;
        }
        const assignmentIdFromError = err.code === "final_published" ? extractLifecycleAssignmentId(err) : null;
        if (assignmentIdFromError) {
          navigate(`/final/${assignmentIdFromError}`);
          return;
        }
      }
      setError(resolveStudentLifecycleError(err));
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className="page-stack">
      <button className="text-button" type="button" onClick={() => navigate("/")}>
        <ArrowLeft size={17} /> Dashboard
      </button>
      <header className="assessment-header">
        <div>
          <div className="assessment-title-row">
            <span className={`mode-label ${activeAssessment.type}`}>{formatAssessmentTypeLabel(activeAssessment.type)}</span>
            <h1>{activeAssessment.title}</h1>
          </div>
          <p>{activeAssignment.classCode} · {activeAssignment.className}</p>
          <p>{activeAssessment.prompt}</p>
        </div>
      </header>
      {error && <p className="field-error">{error}</p>}
      {activeAssessment.type !== "simulation" && working && <p className="status-line">Processing your submission</p>}
      {activeAssessment.type === "voice" && (
          <VoiceAssessment assessment={activeAssessment} disabled={working} onSubmit={(task) => runSubmission(task)} />
      )}
      {activeAssessment.type === "voice_realtime" && (
          <RealtimeVoiceAssessment assessment={activeAssessment} disabled={working} onSubmit={(task) => runSubmission(task)} />
      )}
      {activeAssessment.type === "writing" && (
          <WritingAssessment assessment={activeAssessment} disabled={working} onSubmit={(task) => runSubmission(task)} />
      )}
      {activeAssessment.type === "simulation" && (
          <SimulationAssessment
            assessment={activeAssessment}
            disabled={working}
            initialDraft={simulationDraft}
            onRecoverAttempt={() => setAttemptId(null)}
            onSubmit={(task) => runSubmission(task)}
          />
      )}
    </div>
  );
}

function formatAssessmentTypeLabel(type: AssessmentSummary["type"]): string {
  if (type === "voice") return "Voice Message";
  if (type === "voice_realtime") return "Live Voice Assessment";
  if (type === "writing") return "Writing";
  return "Simulation";
}
