import { BookOpenCheck, ChevronLeft, ChevronRight, ClipboardList, FlaskConical, LogOut, UserRoundPlus } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { resolveStudentAssignmentAction, resolveStudentAssignmentState } from "../lib/studentLifecycle";
import { useSession } from "../state/session";

const SIDEBAR_COLLAPSED_KEY = "alt-assessment.sidebar-collapsed";

export function AppShell({ children }: { children: React.ReactNode }) {
  const { profile, assignments, logout } = useSession();
  const location = useLocation();
  const navigate = useNavigate();
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "true";
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_COLLAPSED_KEY, collapsed ? "true" : "false");
    } catch {
      // Ignore localStorage failures and keep in-memory preference only.
    }
  }, [collapsed]);

  async function signOut() {
    await logout();
    navigate("/login", { replace: true });
  }

  return (
    <div className={`app-shell account-workspace ${collapsed ? "sidebar-collapsed" : ""}`}>
      <a className="skip-link" href="#student-content">Skip to content</a>
      <aside className="side-rail" aria-label="Assessment navigation">
        <div className="rail-top">
          <Link to="/" className="brand-lockup" aria-label="Dashboard" title="Dashboard">
            <span className="brand-mark"><FlaskConical size={20} /></span>
            <span className="brand-copy">
              <strong>Causalyst</strong>
              <small>Student workspace</small>
            </span>
          </Link>
          <button
            type="button"
            className="icon-button rail-toggle"
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-expanded={!collapsed}
            onClick={() => setCollapsed((current) => !current)}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            {collapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
          </button>
        </div>
        <nav className="side-nav">
          <Link className={location.pathname === "/" ? "active" : ""} to="/" aria-current={location.pathname === "/" ? "page" : undefined} aria-label="Dashboard" title="Dashboard">
            <ClipboardList size={18} />
            <span>Dashboard</span>
          </Link>
          <Link className={location.pathname === "/login" ? "active" : ""} to="/login" aria-label="Join another course" title="Join another course">
            <UserRoundPlus size={18} />
            <span>Join course</span>
          </Link>
          <div className="nav-section-label">Assigned</div>
          {assignments.slice(0, 4).map((assignment) => {
            const state = resolveStudentAssignmentState(assignment);
            const action = resolveStudentAssignmentAction(assignment, state);
            return (
              <Link
                key={assignment.assignmentId}
                className={`assigned-nav-link ${location.pathname === action.href ? "active" : ""}`}
                to={action.href ?? `/assignment/${assignment.assignmentId}`}
                aria-label={`${assignment.classCode} ${assignment.assessment.title}`}
                title={`${assignment.classCode} · ${assignment.assessment.title}`}
              >
                <BookOpenCheck size={18} />
                <span>{assignment.assessment.title}</span>
              </Link>
            );
          })}
        </nav>
        <div className="rail-account">
          <span className="account-avatar" aria-hidden="true">{(profile?.displayName?.trim() || "S").slice(0, 1).toUpperCase()}</span>
          <div className="rail-account-copy"><strong>{profile?.displayName || "Student"}</strong><small>Student account</small></div>
          <button className="icon-button" type="button" onClick={signOut} aria-label="Sign out" title="Sign out"><LogOut size={17} /></button>
        </div>
      </aside>
      <main className="content-shell" id="student-content" tabIndex={-1}>{children}</main>
    </div>
  );
}
