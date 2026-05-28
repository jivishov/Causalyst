import { useEffect, useId, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock3,
  FileText,
  Mic,
  MoveRight,
  PencilLine,
  Radio,
  Shapes
} from "lucide-react";
import type { StudentAssignmentSummary, StudentCourseAssignments } from "@alt-assessment/shared";
import {
  formatStudentAssignmentStateLabel,
  formatStudentDueStateLabel,
  resolveStudentAssignmentAction,
  resolveStudentAssignmentState,
  resolveStudentDueState
} from "../lib/studentLifecycle";
import { useSession } from "../state/session";

const icons = {
  voice: Mic,
  voice_realtime: Radio,
  writing: PencilLine,
  simulation: Shapes
};

export function Dashboard() {
  const { courses, assignments } = useSession();

  return (
    <div className="page-stack student-dashboard">
      <header className="student-dashboard-header">
        <div>
          <h1>Assigned assessments</h1>
          <p>Assignments are grouped by course. Automated scores are provisional until reviewed.</p>
        </div>
        <Link className="secondary-button" to="/login">Join another course</Link>
      </header>
      {courses.map((course) => (
        <CourseAssignmentSection key={course.classId} course={course} />
      ))}
      {assignments.length === 0 && (
        <section className="empty-state">
          <FileText size={34} />
          <h2>No assigned assessments</h2>
          <p>Check the class code or ask your teacher to assign an assessment.</p>
        </section>
      )}
    </div>
  );
}

function CourseAssignmentSection({ course }: { course: StudentCourseAssignments }) {
  return (
    <section className="student-course-section">
      <header className="student-course-header">
        <h2>{course.classCode}</h2>
        <span>{course.className}</span>
      </header>
      <div className="assessment-grid student-assignment-grid">
        {course.assignments.map((assignment) => (
          <AssignmentCard key={assignment.assignmentId} assignment={assignment} />
        ))}
      </div>
    </section>
  );
}

function AssignmentCard({ assignment }: { assignment: StudentAssignmentSummary }) {
  const Icon = icons[assignment.assessment.type];
  const state = resolveStudentAssignmentState(assignment);
  const dueState = resolveStudentDueState(assignment, state);
  const action = resolveStudentAssignmentAction(assignment, state);
  const statusTone = dueState === "overdue"
    ? "critical"
    : dueState === "due_soon" || state === "error_retry"
      ? "warning"
      : state === "final_published" || state === "provisional_ready"
        ? "positive"
        : "neutral";
  const StatusIcon = statusTone === "critical"
    ? AlertCircle
    : statusTone === "positive"
      ? CheckCircle2
      : Clock3;

  return (
    <article className="assessment-card student-assignment-card">
      <div className="student-assignment-card-header">
        <span className={`type-icon ${assignment.assessment.type}`}><Icon size={20} /></span>
        <h3>{assignment.assessment.title}</h3>
      </div>
      <ExpandablePrompt text={assignment.assessment.prompt} />
      <footer className="student-assignment-card-footer">
        <div className="student-assignment-meta">
          <div className={`status-row status-${statusTone}`}>
            <StatusIcon size={15} />
            <span>{formatStudentAssignmentStateLabel(state)}</span>
          </div>
          {dueState !== "none" && <span className={`due-pill due-${dueState}`}>{formatStudentDueStateLabel(dueState)}</span>}
        </div>
        {action.href ? (
          <Link className="card-action" to={action.href}>
            {action.label} <MoveRight size={16} />
          </Link>
        ) : (
          <span className="card-action-disabled">{action.label}</span>
        )}
      </footer>
    </article>
  );
}

function ExpandablePrompt({ text }: { text: string }) {
  const promptId = useId();
  const promptRef = useRef<HTMLParagraphElement>(null);
  const expandedRef = useRef(false);
  const [expanded, setExpanded] = useState(false);
  const [canExpand, setCanExpand] = useState(false);

  useEffect(() => {
    expandedRef.current = expanded;
  }, [expanded]);

  useEffect(() => {
    setExpanded(false);
  }, [text]);

  useEffect(() => {
    const element = promptRef.current;
    if (!element) return;

    let frame: number | null = null;
    const measure = () => {
      if (expandedRef.current) return;
      if (frame !== null) window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => {
        frame = null;
        const current = promptRef.current;
        if (!current) return;
        setCanExpand(current.scrollHeight > current.clientHeight + 1);
      });
    };

    measure();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => {
        if (frame !== null) window.cancelAnimationFrame(frame);
        window.removeEventListener("resize", measure);
      };
    }

    const observer = new ResizeObserver(measure);
    observer.observe(element);

    return () => {
      if (frame !== null) window.cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [text]);

  return (
    <div className={`student-assignment-prompt-block ${canExpand ? "has-toggle" : "no-toggle"}`}>
      <p
        ref={promptRef}
        id={promptId}
        className={`student-assignment-prompt ${expanded ? "is-expanded" : "is-collapsed"}`}
      >
        {text}
      </p>
      {canExpand && (
        <button
          type="button"
          className="assignment-details-toggle"
          aria-expanded={expanded}
          aria-controls={promptId}
          onClick={() => setExpanded((current) => !current)}
        >
          {expanded ? (
            <>
              <ChevronUp size={15} /> Less
            </>
          ) : (
            <>
              <ChevronDown size={15} /> More
            </>
          )}
        </button>
      )}
    </div>
  );
}
