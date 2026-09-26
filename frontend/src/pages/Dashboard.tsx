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
  Search,
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
  const [filter, setFilter] = useState<"all" | "todo" | "submitted" | "results">("all");
  const [query, setQuery] = useState("");
  const groupFor = (assignment: StudentAssignmentSummary) => {
    const state = resolveStudentAssignmentState(assignment);
    if (state === "final_published" || state === "provisional_ready") return "results";
    if (state === "submitted") return "submitted";
    return "todo";
  };
  const filters = [
    { id: "all", label: "All assignments", count: assignments.length },
    { id: "todo", label: "To do", count: assignments.filter((item) => groupFor(item) === "todo").length },
    { id: "submitted", label: "Submitted", count: assignments.filter((item) => groupFor(item) === "submitted").length },
    { id: "results", label: "Results", count: assignments.filter((item) => groupFor(item) === "results").length }
  ] as const;
  const visibleCourses = courses.map((course) => ({ ...course, assignments: course.assignments.filter((assignment) =>
    (filter === "all" || groupFor(assignment) === filter) &&
    `${assignment.assessment.title} ${course.className} ${course.classCode}`.toLowerCase().includes(query.trim().toLowerCase())
  ) })).filter((course) => course.assignments.length > 0);

  return (
    <div className="page-stack student-dashboard">
      <header className="student-dashboard-header">
        <div>
          <span className="workspace-eyebrow">Your learning workspace</span>
          <h1>Assigned assessments</h1>
          <p>Pick up where you left off, or start something new.</p>
        </div>
        <Link className="secondary-button" to="/login">Join another course</Link>
      </header>
      {assignments.length > 0 && (
        <div className="assignment-toolbar">
          <div className="assignment-filters" role="group" aria-label="Filter assignments">
            {filters.map((item) => (
              <button key={item.id} type="button" aria-pressed={filter === item.id} onClick={() => setFilter(item.id)}>
                {item.label}{" "}<span>{item.count}</span>
              </button>
            ))}
          </div>
          <label className="workspace-search">
            <Search size={17} aria-hidden="true" />
            <input aria-label="Search assignments" type="search" placeholder="Search assignments…" value={query} onChange={(event) => setQuery(event.target.value)} />
          </label>
        </div>
      )}
      {visibleCourses.map((course) => (
        <CourseAssignmentSection key={course.classId} course={course} />
      ))}
      {assignments.length > 0 && visibleCourses.length === 0 && (
        <section className="empty-state" role="status">
          <Search size={28} aria-hidden="true" />
          <h2>No matching assignments</h2>
          <p>Try another filter or search term.</p>
          <button className="secondary-button" type="button" onClick={() => { setFilter("all"); setQuery(""); }}>Show all assignments</button>
        </section>
      )}
      {assignments.length === 0 && (
        <section className="empty-state">
          <FileText size={34} />
          <h2>No assigned assessments</h2>
          <p>Check the class code or ask your teacher to assign an assessment.</p>
        </section>
      )}
      {assignments.length > 0 && (
        <p className="workspace-footnote"><CheckCircle2 size={15} aria-hidden="true" /> Automated scores are provisional until your teacher reviews them.</p>
      )}
    </div>
  );
}

function CourseAssignmentSection({ course }: { course: StudentCourseAssignments }) {
  return (
    <section className="student-course-section">
      <header className="student-course-header">
        <span className="course-code">{course.classCode}</span>
        <h2>{course.className}</h2>
        <span className="course-assignment-count">{course.assignments.length} {course.assignments.length === 1 ? "assessment" : "assessments"}</span>
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
        <div>
          <span className="assignment-type-label">{{ voice: "Voice response", voice_realtime: "Live conversation", writing: "Written response", simulation: "Simulation" }[assignment.assessment.type]}</span>
          <h3>{assignment.assessment.title}</h3>
        </div>
      </div>
      <ExpandablePrompt text={assignment.assessment.prompt} />
      <footer className="student-assignment-card-footer">
        <div className="student-assignment-meta">
          <div className={`status-row status-${statusTone}`}>
            <StatusIcon size={15} />
            <span>{formatStudentAssignmentStateLabel(state)}</span>
          </div>
          {dueState !== "none" && <span className={`due-pill due-${dueState}`}>{formatStudentDueStateLabel(dueState)}</span>}
          {assignment.dueAt && Number.isFinite(Date.parse(assignment.dueAt)) && (
            <time className="assignment-due-date" dateTime={assignment.dueAt} title={new Date(assignment.dueAt).toLocaleString()}>
              Due {new Date(assignment.dueAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
            </time>
          )}
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
