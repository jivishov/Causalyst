import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { AlertCircle, CheckCircle2, Clock3, FileText, Mic, MoveRight, PencilLine, Radio, RotateCw, Search, Shapes } from "lucide-react";
import type { StudentSubmissionSummary } from "@alt-assessment/shared";
import { getStudentSession, getStudentSubmissions } from "../lib/api";
import { useSession } from "../state/session";

const icons = { voice: Mic, voice_realtime: Radio, writing: PencilLine, simulation: Shapes };
const labels = { voice: "Voice response", voice_realtime: "Live conversation", writing: "Written response", simulation: "Simulation" };
type WorkFilter = "all" | "in_progress" | "submitted" | "results";
type SavedWorkItem = Omit<StudentSubmissionSummary, "createdAt"> & { createdAt?: string; resumeHref?: string };
function groupFor(item: SavedWorkItem): Exclude<WorkFilter, "all"> {
  if (item.status === "draft") return "in_progress";
  return item.publishedGrade || item.status === "graded" || item.provisionalScore !== null ? "results" : "submitted";
}

export function StudentWork() {
  const { profile } = useSession();
  const [params, setParams] = useSearchParams();
  const [submissions, setSubmissions] = useState<SavedWorkItem[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef(0);
  const reload = useCallback(async () => {
    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError(null);
    try {
      // Reload assignments as well as submitted history: a draft may have been
      // created after the cached dashboard was loaded.
      const [response, session] = await Promise.all([getStudentSubmissions(), getStudentSession()]);
      if (requestId !== requestIdRef.current) return;
      if (!Array.isArray(response.submissions) || !Array.isArray(session.courses)) throw new Error("Saved work could not be loaded. Please try again.");
      if (session.profile?.id !== profile?.id) throw new Error("Your student account changed. Reload this page.");
      const drafts: SavedWorkItem[] = session.courses.flatMap(course => course.assignments)
        .filter(assignment => assignment.latestAttempt?.status === "draft" && !assignment.publishedGrade)
        .map(assignment => ({
          ...assignment.latestAttempt!,
          assignmentId: assignment.assignmentId,
          classId: assignment.classId,
          classCode: assignment.classCode,
          className: assignment.className,
          assessment: assignment.assessment,
          publishedGrade: null,
          resumeHref: `/assignment/${assignment.assignmentId}`
        }));
      setSubmissions([...drafts, ...response.submissions]);
      setLoaded(true);
    } catch (err) {
      if (requestId === requestIdRef.current) setError(err instanceof Error ? err.message : "Could not load saved work.");
    } finally {
      if (requestId === requestIdRef.current) setLoading(false);
    }
  }, [profile?.id]);
  useEffect(() => {
    setSubmissions([]);
    setLoaded(false);
    void reload();
    return () => { requestIdRef.current++; };
  }, [reload]);

  const requestedFilter = params.get("status");
  const filter: WorkFilter = requestedFilter === "in_progress" || requestedFilter === "submitted" || requestedFilter === "results" ? requestedFilter : "all";
  const courseId = params.get("course") || "all";
  const scoped = submissions.filter(item => courseId === "all" || item.classId === courseId);
  const visible = scoped.filter(item => (filter === "all" || groupFor(item) === filter)
    && [item.assessment?.title, item.className, item.classCode].join(" ").toLowerCase().includes(query.trim().toLowerCase()));
  const courses = [...new Map(submissions.filter(item => item.classId).map(item => [item.classId!, item.className ?? item.classCode ?? "Class"])).entries()];
  const filters: { id: WorkFilter; label: string; count: number }[] = [
    { id: "all", label: "All work", count: scoped.length },
    { id: "in_progress", label: "In progress", count: scoped.filter(item => groupFor(item) === "in_progress").length },
    { id: "submitted", label: "Submitted", count: scoped.filter(item => groupFor(item) === "submitted").length },
    { id: "results", label: "Results", count: scoped.filter(item => groupFor(item) === "results").length }
  ];
  function setParameter(name: string, value: string) {
    const next = new URLSearchParams(params);
    if (value === "all") next.delete(name); else next.set(name, value);
    setParams(next, { replace: true });
  }

  return <div className="page-stack student-dashboard student-work-history">
    <header className="student-dashboard-header">
      <h1>My work</h1>
      {loaded && <div className="assignment-filters" role="group" aria-label="Filter saved work">
        {filters.map(item => <button key={item.id} type="button" aria-pressed={filter === item.id} onClick={() => setParameter("status", item.id)}>{item.label}<span>{item.count}</span></button>)}
      </div>}
    </header>
    <p className="student-history-note">Your saved drafts and submissions, including earlier attempts and archived assignments.</p>
    <div className="assignment-toolbar">
      <span className="student-result-count">{visible.length} {visible.length === 1 ? "item" : "items"}</span>
      <div className="student-list-tools">
        <label className="workspace-search"><Search size={16} aria-hidden="true" /><input aria-label="Search saved work" type="search" placeholder="Search" value={query} onChange={event => setQuery(event.target.value)} /></label>
        <select aria-label="Filter saved work by course" value={courseId} onChange={event => setParameter("course", event.target.value)}><option value="all">All classes</option>{courses.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select>
        <button className="secondary-button" type="button" aria-label="Refresh saved work" disabled={loading} onClick={() => { void reload(); }}><RotateCw size={15} aria-hidden="true" />Refresh</button>
      </div>
    </div>
    {loading && <p className="status-line" role="status">{loaded ? "Refreshing saved work…" : "Loading saved work…"}</p>}
    {error && <section className="student-history-error" role="alert"><p className="field-error">{error}</p><button className="secondary-button" type="button" onClick={() => { void reload(); }}>Retry loading saved work</button></section>}
    {visible.length > 0 && <div className="assessment-grid student-assignment-grid">{visible.map(item => <SubmissionCard key={item.attemptId} submission={item} />)}</div>}
    {loaded && !loading && !error && visible.length === 0 && <section className="empty-state" role="status">
      <FileText size={28} aria-hidden="true" /><h2>{submissions.length ? "No matching work" : "Your work will appear here"}</h2>
      <p>{submissions.length ? "Try another filter or search term." : "Saved drafts, submissions and results will appear here."}</p>
      {submissions.length > 0 && <button className="secondary-button" type="button" onClick={() => { setParams({ view: "work" }, { replace: true }); setQuery(""); }}>Show all work</button>}
    </section>}
    {submissions.length > 0 && <p className="workspace-footnote"><CheckCircle2 size={15} aria-hidden="true" />Automated scores are provisional until your teacher reviews them.</p>}
  </div>;
}

function SubmissionCard({ submission }: { submission: SavedWorkItem }) {
  const type = submission.assessment?.type;
  const Icon = type ? icons[type] : FileText;
  const inProgress = groupFor(submission) === "in_progress";
  const hasResults = groupFor(submission) === "results";
  const needsAttention = submission.status === "error";
  const StatusIcon = needsAttention ? AlertCircle : hasResults ? CheckCircle2 : Clock3;
  const status = inProgress ? "In progress" : submission.publishedGrade ? "Final published" : needsAttention ? "Needs attention" : hasResults ? "Provisional ready" : "Submitted";
  const timestamp = submission.submittedAt ?? submission.createdAt ?? "";
  const validTimestamp = Number.isFinite(Date.parse(timestamp));
  return <article className="assessment-card student-assignment-card student-submission-history-card">
    <div className="student-assignment-card-header">
      <span className={`type-icon ${type ?? "writing"}`}><Icon size={20} aria-hidden="true" /></span>
      <div><div className="student-card-title"><h3>{submission.assessment?.title ?? "Saved submission"}</h3><span className={`status-row status-${needsAttention ? "warning" : hasResults ? "positive" : "neutral"}`}><StatusIcon size={12} aria-hidden="true" />{status}</span></div><span className="assignment-type-label">{type ? labels[type] : "Saved response"}</span></div>
    </div>
    <footer className="student-assignment-card-footer">
      <div className="student-assignment-meta">
        {submission.className && <span className="student-card-course">{submission.className}</span>}
        {validTimestamp && <time className="assignment-due-date" dateTime={timestamp} title={new Date(timestamp).toLocaleString()}>{submission.submittedAt ? "Submitted" : "Saved"} {new Date(timestamp).toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })}</time>}
        {submission.submittedAfterDue && <span className="due-pill due-late_submitted">Submitted late</span>}
      </div>
      <Link className="card-action" to={submission.resumeHref ?? `/attempt/${submission.attemptId}`}>{inProgress ? "Continue draft" : "View submission"}<MoveRight size={16} aria-hidden="true" /></Link>
    </footer>
  </article>;
}
