import { BookOpenCheck, ChevronLeft, ChevronRight, ClipboardList, FlaskConical, LogOut, NotebookPen, UserRoundPlus } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { resolveStudentAssignmentAction, resolveStudentAssignmentState } from "../lib/studentLifecycle";
import { useSession } from "../state/session";

const SIDEBAR_COLLAPSED_KEY = "alt-assessment.sidebar-collapsed";
export function AppShell({ children }: { children: React.ReactNode }) {
  const { profile, assignments, courses, logout } = useSession();
  const location = useLocation();
  const navigate = useNavigate();
  const inWorkspace = /^\/(assignment|attempt|final)\//.test(location.pathname);
  const myWork = new URLSearchParams(location.search).get("view") === "work";
  const [workspaceExpanded, setWorkspaceExpanded] = useState(false);
  const [collapsed, setCollapsed] = useState<boolean>(() => { try { return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "true"; } catch { return false; } });
  const compact = inWorkspace ? !workspaceExpanded : collapsed;
  useEffect(() => { try { localStorage.setItem(SIDEBAR_COLLAPSED_KEY, collapsed ? "true" : "false"); } catch {} }, [collapsed]);
  useEffect(() => { setWorkspaceExpanded(false); }, [location.pathname]);
  async function signOut() { await logout(); navigate("/login", { replace: true }); }
  return <div className={`app-shell account-workspace student-design ${compact ? "sidebar-collapsed" : ""} ${inWorkspace ? "student-workspace-mode" : ""}`}>
    <a className="skip-link" href="#student-content">Skip to content</a>
    <aside className="side-rail" aria-label="Assessment navigation">
      <div className="rail-top"><Link to="/" className="brand-lockup" aria-label="Dashboard" title="Dashboard"><span className="brand-mark"><FlaskConical size={20} /></span><span className="brand-copy"><strong>Causalyst</strong><small>Student workspace</small></span></Link><button type="button" className="icon-button rail-toggle" aria-label={compact ? "Expand sidebar" : "Collapse sidebar"} aria-expanded={!compact} onClick={() => inWorkspace ? setWorkspaceExpanded(value => !value) : setCollapsed(value => !value)} title={compact ? "Expand sidebar" : "Collapse sidebar"}>{compact ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}</button></div>
      <nav className="side-nav"><Link className={location.pathname === "/" && !myWork ? "active" : ""} to="/" aria-current={location.pathname === "/" && !myWork ? "page" : undefined} aria-label="Dashboard" title="My assignments"><ClipboardList size={18} /><span>My assignments</span></Link><Link className={myWork ? "active" : ""} to="/?view=work" aria-current={myWork ? "page" : undefined} aria-label="My work" title="My work"><NotebookPen size={18} /><span>My work</span></Link><div className="nav-section-label">Your classes</div>{courses.map((course, index) => <Link key={course.classId} className="student-course-nav" to={`/?course=${encodeURIComponent(course.classId)}`} title={`${course.classCode} · ${course.className}`}><span className={`student-course-dot ${index % 2 ? "coral" : ""}`} aria-hidden="true" /><span>{course.className}</span></Link>)}{inWorkspace && assignments.slice(0, 4).map(assignment => { const action = resolveStudentAssignmentAction(assignment, resolveStudentAssignmentState(assignment)); return <Link key={assignment.assignmentId} className={`assigned-nav-link ${location.pathname === action.href ? "active" : ""}`} to={action.href ?? `/assignment/${assignment.assignmentId}`} aria-label={`${assignment.classCode} ${assignment.assessment.title}`} title={`${assignment.classCode} · ${assignment.assessment.title}`}><BookOpenCheck size={18} /><span>{assignment.assessment.title}</span></Link>; })}</nav>
      <div className="student-rail-bottom"><Link className="student-join-course" to="/login" aria-label="Join another course" title="Join another course"><UserRoundPlus size={17} /><span>Join course</span></Link><div className="rail-account"><span className="account-avatar" aria-hidden="true">{(profile?.displayName?.trim() || "S").slice(0, 1).toUpperCase()}</span><div className="rail-account-copy"><strong>{profile?.displayName || "Student"}</strong><small>Student account</small></div><button className="icon-button" type="button" onClick={signOut} aria-label="Sign out" title="Sign out"><LogOut size={17} /></button></div></div>
    </aside>
    <div className="student-main-shell"><header className="student-topbar"><div className="student-breadcrumbs">{inWorkspace ? <><Link to="/">Assignments</Link><ChevronRight size={12} /><span>Student workspace</span></> : <span>Student workspace</span>}</div><span className="student-account-label">Student account</span></header><main className="content-shell" id="student-content" tabIndex={-1}>{children}</main></div>
  </div>;
}
