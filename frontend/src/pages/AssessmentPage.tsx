import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, ChevronDown, ClipboardList } from "lucide-react";
import type { AssessmentSummary, StudentAssignmentSummary } from "@alt-assessment/shared";
import { ApiRequestError, startAttempt } from "../lib/api";
import { extractLifecycleAssignmentId, extractLifecycleAttemptId, resolveStudentLifecycleError } from "../lib/studentLifecycle";
import { useSession } from "../state/session";
import { VoiceAssessment } from "./assessment/VoiceAssessment";
import { RealtimeVoiceAssessment } from "./assessment/RealtimeVoiceAssessment";
import { WritingAssessment } from "./assessment/WritingAssessment";
import { SimulationAssessment, type SimulationDraftState } from "./assessment/SimulationAssessment";
import { StudentActionProgress } from "../components/StudentActionProgress";
import { AssignmentPrompt } from "../components/AssignmentPrompt";
import { StudentAssignmentLayoutControl, useStudentAssignmentLayout } from "../components/StudentAssignmentLayoutControl";

export function AssessmentPage() {
  const { assignmentId } = useParams();
  // React Router reuses this page across parameter changes. Remount the whole
  // workspace by assignment, including its attempt, uploads and child editors.
  return <AssignmentWorkspace key={assignmentId} assignmentId={assignmentId} />;
}

function AssignmentWorkspace({ assignmentId }: { assignmentId: string | undefined }) {
  const navigate = useNavigate();
  const [layout, chooseLayout] = useStudentAssignmentLayout();
  const { assignments } = useSession();
  const assignment = useMemo(() => assignments.find((item) => item.assignmentId === assignmentId), [assignmentId, assignments]);
  const [attemptId, setAttemptId] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [simulationDraft, setSimulationDraft] = useState<SimulationDraftState | null>(null);
  const [attemptAssignment, setAttemptAssignment] = useState<StudentAssignmentSummary | null>(null);
  const [workspaceReady, setWorkspaceReady] = useState(false);
  const mountedRef = useRef(true);
  const submissionRef = useRef(false);
  const attemptPromiseRef = useRef<ReturnType<typeof startAttempt> | null>(null);
  const isActive = useCallback(() => mountedRef.current, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const ensureAttempt = useCallback(async () => {
    if (!assignmentId) throw new Error("This assignment could not be opened.");
    // Opening and clicking an action share one request; neither can overwrite
    // the attempt selected by the other.
    const pending = attemptPromiseRef.current ?? startAttempt(assignmentId);
    attemptPromiseRef.current = pending;
    try {
      const created = await pending;
      if (created.assignment.assignmentId !== assignmentId) {
        throw new Error("The response belongs to a different assignment. Open this assignment again.");
      }
      if (mountedRef.current && attemptPromiseRef.current === pending) {
        setAttemptId(created.attemptId);
        setAttemptAssignment(created.assignment);
        setSimulationDraft(created.simulationDraft ? { attemptId: created.attemptId, ...created.simulationDraft } : null);
        setWorkspaceReady(true);
      }
      return created.attemptId;
    } catch (err) {
      if (attemptPromiseRef.current === pending) attemptPromiseRef.current = null;
      throw err;
    }
  }, [assignmentId]);

  useEffect(() => {
    if (!assignment) return;
    if (attemptId || assignment.publishedGrade || assignment.latestAttempt?.status === "submitted" || assignment.latestAttempt?.status === "graded") return;

    let cancelled = false;
    ensureAttempt()
      .catch((err) => {
        if (!cancelled) setError(resolveStudentLifecycleError(err));
      });

    return () => {
      cancelled = true;
    };
  }, [assignment?.assignmentId, assignment?.publishedGrade, assignment?.latestAttempt?.status, attemptId, ensureAttempt]);

  if (!assignment) return <Navigate to="/" replace />;
  if (assignment.latestAttempt?.status === "submitted" || assignment.latestAttempt?.status === "graded") {
    return <Navigate to={`/attempt/${assignment.latestAttempt.attemptId}`} replace />;
  }
  const activeAssignment = attemptAssignment?.assignmentId === assignment.assignmentId ? attemptAssignment : assignment;
  const activeAssessment = activeAssignment.assessment;

  async function runSubmission(task: (id: string) => Promise<void>): Promise<void> {
    if (!isActive() || submissionRef.current) return;
    submissionRef.current = true;
    setError(null);
    setWorking(true);
    try {
      const id = attemptId ?? await ensureAttempt();
      if (!isActive()) return;
      await task(id);
    } catch (err: unknown) {
      if (!isActive()) return;
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
      submissionRef.current = false;
      if (isActive()) setWorking(false);
    }
  }

  return (
    <div className="page-stack student-assessment-page" data-assignment-layout={layout}>
      <header className="assessment-header student-assessment-header">
        <div>
          <div className="assessment-title-row">
            <h1>{activeAssessment.title}</h1>
            <span className={`mode-label ${activeAssessment.type}`}>{formatAssessmentTypeLabel(activeAssessment.type)}</span>
          </div>
          <p className="assessment-course-context">{activeAssignment.classCode} · {activeAssignment.className}</p>
        </div>
        <div className="student-assessment-controls">
          <div className="student-workflow" aria-label="Assignment workflow">
            <span><b>1</b>{activeAssessment.type === "voice" || activeAssessment.type === "voice_realtime" ? "Record" : "Explain"}</span><i aria-hidden="true" />
            <span><b>2</b>{activeAssessment.type === "simulation" ? "Test & revise" : "Review"}</span><i aria-hidden="true" />
            <span><b>3</b>Submit</span>
          </div>
          <StudentAssignmentLayoutControl layout={layout} onChange={chooseLayout} />
        </div>
      </header>
      {activeAssessment.type !== "simulation" && <details className="assignment-instructions" open>
        <summary><ClipboardList size={17} aria-hidden="true" /><span>Assignment instructions</span><span className="instructions-hint">Read, then describe in your own words</span><ChevronDown size={16} className="accordion-chevron" aria-hidden="true" /></summary>
        <AssignmentPrompt text={activeAssessment.prompt} />
      </details>}
      {error && <p className="field-error">{error}</p>}
      {!workspaceReady && error && <button className="secondary-button assignment-retry" type="button" onClick={() => { setError(null); void ensureAttempt().catch(err => { if (isActive()) setError(resolveStudentLifecycleError(err)); }); }}>Retry opening assignment</button>}
      <StudentActionProgress active={!workspaceReady && !error} title="Opening your assignment" />
      <StudentActionProgress
        active={working && (activeAssessment.type === "writing" || activeAssessment.type === "voice")}
        title={activeAssessment.type === "writing" ? "Submitting your written work" : "Submitting your voice response"}
      />
      {workspaceReady && activeAssessment.type === "voice" && (
          <VoiceAssessment assessment={activeAssessment} disabled={working} isActive={isActive} onSubmit={(task) => runSubmission(task)} />
      )}
      {workspaceReady && activeAssessment.type === "voice_realtime" && (
          <RealtimeVoiceAssessment assessment={activeAssessment} disabled={working} isActive={isActive} onSubmit={(task) => runSubmission(task)} />
      )}
      {workspaceReady && activeAssessment.type === "writing" && (
          <WritingAssessment assessment={activeAssessment} disabled={working} isActive={isActive} onSubmit={(task) => runSubmission(task)} />
      )}
      {workspaceReady && activeAssessment.type === "simulation" && (
          <SimulationAssessment
            assessment={activeAssessment}
            disabled={working}
            draftAttemptId={attemptId}
            isActive={isActive}
            initialDraft={simulationDraft}
            onRecoverAttempt={() => { attemptPromiseRef.current = null; setAttemptId(null); }}
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
