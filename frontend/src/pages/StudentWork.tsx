import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { AlertCircle, CheckCircle2, Clock3, FileText, Mic, MoveRight, PencilLine, Radio, RotateCw, Search, Shapes } from "lucide-react";
import type { StudentSubmissionSummary } from "@alt-assessment/shared";
import { getStudentSubmissions } from "../lib/api";
import { useSession } from "../state/session";

const icons = { voice: Mic, voice_realtime: Radio, writing: PencilLine, simulation: Shapes };
const labels = { voice: "Voice response", voice_realtime: "Live conversation", writing: "Written response", simulation: "Simulation" };
type WorkFilter = "all" | "submitted" | "results";
function groupFor(item: StudentSubmissionSummary): Exclude<WorkFilter, "all"> {
  return item.publishedGrade || item.status === "graded" || item.provisionalScore !== null ? "results" : "submitted";
}

export function StudentWork() {
  const { profile } = useSession();
  const [params, setParams] = useSearchParams();
  const [submissions, setSubmissions] = useState<StudentSubmissionSummary[]>([]);
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
      const response = await getStudentSubmissions();
      if (requestId !== requestIdRef.current) return;
      if (!Array.isArray(response.submissions)) throw new Error("Saved submissions could not be loaded. Please try again.");
      setSubmissions(response.submissions);
      setLoaded(true);
    } catch (err) {
      if (requestId === requestIdRef.current) setError(err instanceof Error ? err.message : "Could not load saved submissions.");
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
  const filter: WorkFilter = requestedFilter === "submitted" || requestedFilter === "results" ? requestedFilter : "all";
  const courseId = params.get("course") || "all";
  const scoped = submissions.filter(item => courseId === "all" || item.classId === courseId);
  const visible = scoped.filter(item => (filter === "all" || groupFor(item) === filter)
    && [item.assessment?.title, item.className, item.classCode].join(" ").toLowerCase().includes(query.trim().toLowerCase()));
  const courses = [...new Map(submissions.filter(item => item.classId).map(item => [item.classId!, item.className ?? item.classCode ?? "Class"])).entries()];
  const filters: { id: WorkFilter; label: string; count: number }[] = [
    { id: "all", label: "All work", count: scoped.length },
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
      {loaded && <div className="assignment-filters" role="group" aria-label="Filter submissions">
        {filters.map(item => <button key={item.id} type="button" aria-pressed={filter === item.id} onClick={() => setParameter("status", item.id)}>{item.label}<span>{item.count}</span></button>)}
      </div>}
    </header>
    <p className="student-history-note">Your saved submissions, including earlier attempts and archived assignments.</p>
    <div className="assignment-toolbar">
      <span className="student-result-count">{visible.length} {visible.length === 1 ? "submission" : "submissions"}</span>
      <div className="student-list-tools">
        <label className="workspace-search"><Search size={16} aria-hidden="true" /><input aria-label="Search submissions" type="search" placeholder="Search" value={query} onChange={event => setQuery(event.target.value)} /></label>
        <select aria-label="Filter submissions by course" value={courseId} onChange={event => setParameter("course", event.target.value)}><option value="all">All classes</option>{courses.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select>
        <button className="secondary-button" type="button" aria-label="Refresh saved work" disabled={loading} onClick={() => { void reload(); }}><RotateCw size={15} aria-hidden="true" />Refresh</button>
      </div>
    </div>
    {loading && <p className="status-line" role="status">{loaded ? "Refreshing saved submissions…" : "Loading saved submissions…"}</p>}
    {error && <section className="student-history-error" role="alert"><p className="field-error">{error}</p><button className="secondary-button" type="button" onClick={() => { void reload(); }}>Retry loading saved work</button></section>}
    {visible.length > 0 && <div className="assessment-grid student-assignment-grid">{visible.map(item => <SubmissionCard key={item.attemptId} submission={item} />)}</div>}
    {loaded && !loading && !error && visible.length === 0 && <section className="empty-state" role="status">
      <FileText size={28} aria-hidden="true" /><h2>{submissions.length ? "No matching submissions" : "Your work will appear here"}</h2>
      <p>{submissions.length ? "Try another filter or search term." : "Submitted explanations, evidence and results will appear here."}</p>
      {submissions.length > 0 && <button className="secondary-button" type="button" onClick={() => { setParams({ view: "work" }, { replace: true }); setQuery(""); }}>Show all work</button>}
    </section>}
    {submissions.length > 0 && <p className="workspace-footnote"><CheckCircle2 size={15} aria-hidden="true" />Automated scores are provisional until your teacher reviews them.</p>}
  </div>;
}

function SubmissionCard({ submission }: { submission: StudentSubmissionSummary }) {
  const type = submission.assessment?.type;
  const Icon = type ? icons[type] : FileText;
  const hasResults = groupFor(submission) === "results";
  const needsAttention = submission.status === "error";
  const StatusIcon = needsAttention ? AlertCircle : hasResults ? CheckCircle2 : Clock3;
  const status = submission.publishedGrade ? "Final published" : needsAttention ? "Needs attention" : hasResults ? "Provisional ready" : "Submitted";
  const timestamp = submission.submittedAt ?? submission.createdAt;
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
      <Link className="card-action" to={`/attempt/${submission.attemptId}`}>View submission<MoveRight size={16} aria-hidden="true" /></Link>
    </footer>
  </article>;
}
