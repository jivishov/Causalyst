import { useEffect, useId, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { AlertCircle, BookOpen, CheckCircle2, ChevronDown, ChevronUp, Clock3, FileText, Mic, MoveRight, PencilLine, Radio, Search, Shapes } from "lucide-react";
import type { StudentAssignmentSummary } from "@alt-assessment/shared";
import { formatStudentAssignmentStateLabel, formatStudentDueStateLabel, resolveStudentAssignmentAction, resolveStudentAssignmentState, resolveStudentDueState } from "../lib/studentLifecycle";
import { useSession } from "../state/session";

const icons = { voice: Mic, voice_realtime: Radio, writing: PencilLine, simulation: Shapes };
type AssignmentFilter = "all" | "todo" | "submitted" | "results";
function groupFor(assignment: StudentAssignmentSummary): Exclude<AssignmentFilter, "all"> {
  const state = resolveStudentAssignmentState(assignment);
  if (state === "final_published" || state === "provisional_ready") return "results";
  return state === "submitted" ? "submitted" : "todo";
}

export function Dashboard() {
  const { courses, assignments } = useSession();
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState("");
  const myWork = params.get("view") === "work";
  const requestedFilter = params.get("status");
  const filter: AssignmentFilter = requestedFilter === "todo" || requestedFilter === "submitted" || requestedFilter === "results" ? requestedFilter : "all";
  const courseId = params.get("course") || "all";
  const scoped = assignments.filter(item => (courseId === "all" || item.classId === courseId) && (!myWork || groupFor(item) !== "todo"));
  const filters = [
    { id: "all", label: myWork ? "All work" : "All assignments", count: scoped.length },
    ...(!myWork ? [{ id: "todo", label: "To do", count: scoped.filter(item => groupFor(item) === "todo").length }] : []),
    { id: "submitted", label: "Submitted", count: scoped.filter(item => groupFor(item) === "submitted").length },
    { id: "results", label: "Results", count: scoped.filter(item => groupFor(item) === "results").length }
  ] as { id: AssignmentFilter; label: string; count: number }[];
  const visible = scoped.filter(item => (filter === "all" || groupFor(item) === filter) && `${item.assessment.title} ${item.className} ${item.classCode}`.toLowerCase().includes(query.trim().toLowerCase()));
  const pending = scoped.filter(item => groupFor(item) === "todo");
  const resume = pending.find(item => resolveStudentAssignmentState(item) === "draft") ?? pending[0];
  const resumeAction = resume ? resolveStudentAssignmentAction(resume, resolveStudentAssignmentState(resume)) : null;
  const upcoming = [...pending].sort((a, b) => (Date.parse(a.dueAt ?? "") || Infinity) - (Date.parse(b.dueAt ?? "") || Infinity)).slice(0, 3);
  const results = scoped.filter(item => groupFor(item) === "results").slice(0, 3);
  function setParameter(name: string, value: string) {
    const next = new URLSearchParams(params);
    if (value === "all") next.delete(name); else next.set(name, value);
    setParams(next, { replace: true });
  }
  return (
    <div className="page-stack student-dashboard">
      <header className="student-dashboard-header">
        <h1>{myWork ? "My work" : "My assignments"}</h1>
        {assignments.length > 0 && <div className="assignment-filters" role="group" aria-label="Filter assignments">
          {filters.map(item => <button key={item.id} type="button" aria-pressed={filter === item.id} onClick={() => setParameter("status", item.id)}>{item.label}<span>{item.count}</span></button>)}
        </div>}
      </header>
      <div className="student-dashboard-columns">
        <section aria-label={myWork ? "Submitted work" : "Assignments"} className="student-assignment-main">
          {!myWork && resume && resumeAction?.href && <article className="student-resume-card">
            <div className="student-resume-content">
              <div className="student-resume-heading">
                <div><p className="student-resume-course">{resume.className}</p><h2>{resume.assessment.title}</h2></div>
                <Link className="primary-button" to={resumeAction.href}>{resolveStudentAssignmentState(resume) === "draft" ? "Continue my work" : "Start investigation"}<MoveRight size={17} /></Link>
              </div>
              <p>{resolveStudentAssignmentState(resume) === "draft" ? "Pick up your investigation where you left off." : "Start with your own explanation, then put your thinking to the test."}</p>
            </div>
            <div className="student-resume-art" aria-hidden="true">
              <svg viewBox="0 0 200 90" focusable="false"><path className="resume-grid" d="M12 12V78H190M12 60H190M12 42H190M12 24H190"/><path className="resume-spectrum" d="M12 78H20C27 78 27 59 34 59S41 78 48 78H61C68 78 68 58 75 58S82 78 89 78H99C110 78 110 15 119 15S128 78 139 78H151C159 78 159 69 165 69S171 78 179 78H190"/></svg>
              <small>Put your thinking to the test</small>
            </div>
          </article>}
          {assignments.length > 0 && <div className="assignment-toolbar">
            <span className="student-result-count">{visible.length} {visible.length === 1 ? "assessment" : "assessments"}</span>
            <div className="student-list-tools">
              <label className="workspace-search"><Search size={16} aria-hidden="true" /><input aria-label="Search assignments" type="search" placeholder="Search assignments" value={query} onChange={event => setQuery(event.target.value)} /></label>
              <select aria-label="Filter by course" value={courseId} onChange={event => setParameter("course", event.target.value)}><option value="all">All classes</option>{courses.map(course => <option key={course.classId} value={course.classId}>{course.className}</option>)}</select>
            </div>
          </div>}
          {visible.length > 0 && <div className="assessment-grid student-assignment-grid">{visible.map(assignment => <AssignmentCard key={assignment.assignmentId} assignment={assignment} />)}</div>}
          {assignments.length > 0 && visible.length === 0 && <section className="empty-state" role="status"><Search size={28} aria-hidden="true" /><h2>{myWork && scoped.length === 0 ? "Your work will appear here" : "No matching assignments"}</h2><p>{myWork && scoped.length === 0 ? "Submit an assignment to keep your explanation, evidence and results together." : "Try another filter or search term."}</p><button className="secondary-button" type="button" onClick={() => { setParams(myWork ? { view: "work" } : {}, { replace: true }); setQuery(""); }}>{myWork ? "Show all work" : "Show all assignments"}</button></section>}
          {assignments.length === 0 && <section className="empty-state"><FileText size={34} /><h2>No assigned assessments</h2><p>Check the class code or ask your teacher to assign an assessment.</p><Link className="secondary-button" to="/login">Join another course</Link></section>}
        </section>
        {assignments.length > 0 && <aside className="student-dashboard-aside" aria-label="Upcoming assignments and results">
          {!myWork && <section className="student-aside-card"><div className="student-aside-heading"><h2>Coming up</h2><span>{pending.length} to do</span></div>{upcoming.length ? upcoming.map(item => <Link key={item.assignmentId} className="student-upcoming-item" to={resolveStudentAssignmentAction(item, resolveStudentAssignmentState(item)).href ?? `/assignment/${item.assignmentId}`}>
            <span className="student-calendar-date">{item.dueAt && Number.isFinite(Date.parse(item.dueAt)) ? <><small>{new Date(item.dueAt).toLocaleDateString(undefined, { month: "short" })}</small>{new Date(item.dueAt).getDate()}</> : <Clock3 size={17} />}</span><span><strong>{item.assessment.title}</strong><small>{item.className}</small></span>
          </Link>) : <p>Everything assigned is submitted.</p>}</section>}
          <section className="student-aside-card student-results-card"><div className="student-aside-heading"><h2>Results to read</h2><span>{scoped.filter(item => groupFor(item) === "results").length}</span></div>{results.length ? results.map(item => <Link key={item.assignmentId} className="student-result-item" to={resolveStudentAssignmentAction(item, resolveStudentAssignmentState(item)).href ?? `/assignment/${item.assignmentId}`}><strong>{item.assessment.title}</strong><small>{formatStudentAssignmentStateLabel(resolveStudentAssignmentState(item))}</small><MoveRight size={15} /></Link>) : <p>Your teacher-reviewed results will appear here. Automated scores remain provisional until reviewed.</p>}</section>
          <div className="student-work-guide"><p><PencilLine size={16} />Write the science in your own words.</p><p><Shapes size={16} />Test what your explanation produces.</p><p><BookOpen size={16} />Keep your thinking and evidence together.</p></div>
        </aside>}
      </div>
      {assignments.length > 0 && <p className="workspace-footnote"><CheckCircle2 size={15} aria-hidden="true" />Automated scores are provisional until your teacher reviews them.</p>}
    </div>
  );
}

function AssignmentCard({ assignment }: { assignment: StudentAssignmentSummary }) {
  const Icon = icons[assignment.assessment.type];
  const state = resolveStudentAssignmentState(assignment);
  const dueState = resolveStudentDueState(assignment, state);
  const action = resolveStudentAssignmentAction(assignment, state);
  const tone = dueState === "overdue" ? "critical" : dueState === "due_soon" || state === "error_retry" ? "warning" : state === "final_published" || state === "provisional_ready" ? "positive" : "neutral";
  const StatusIcon = tone === "critical" ? AlertCircle : tone === "positive" ? CheckCircle2 : Clock3;
  return <article className="assessment-card student-assignment-card">
    <div className="student-assignment-card-header"><span className={`type-icon ${assignment.assessment.type}`}><Icon size={20} /></span><div><div className="student-card-title"><h3>{assignment.assessment.title}</h3><span className={`status-row status-${tone}`}><StatusIcon size={12} />{formatStudentAssignmentStateLabel(state)}</span></div><span className="assignment-type-label">{{ voice: "Voice response", voice_realtime: "Live conversation", writing: "Written response", simulation: "Simulation" }[assignment.assessment.type]}</span></div></div>
    <ExpandablePrompt text={assignment.assessment.prompt} />
    <footer className="student-assignment-card-footer"><div className="student-assignment-meta"><span className="student-card-course">{assignment.className}</span>{dueState !== "none" && <span className={`due-pill due-${dueState}`}>{formatStudentDueStateLabel(dueState)}</span>}{assignment.dueAt && Number.isFinite(Date.parse(assignment.dueAt)) && <time className="assignment-due-date" dateTime={assignment.dueAt} title={new Date(assignment.dueAt).toLocaleString()}>Due {new Date(assignment.dueAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</time>}</div>{action.href ? <Link className="card-action" to={action.href}>{action.label}<MoveRight size={16} /></Link> : <span className="card-action-disabled">{action.label}</span>}</footer>
  </article>;
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
