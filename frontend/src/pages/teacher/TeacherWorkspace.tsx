import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  BookOpen,
  ClipboardCheck,
  ClipboardList,
  ChevronLeft,
  ChevronRight,
  FlaskConical,
  KeyRound,
  LogIn,
  LogOut,
  Mail,
  MessageSquareText,
  Table2,
  UserPlus
} from "lucide-react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import type { TeacherProfile } from "@alt-assessment/shared";
import {
  ApiRequestError,
  ensureTeacherSetupSession,
  getTeacherSession,
  getTeacherSetupStatus,
  requestTeacherPasswordReset,
  setupTeacher,
  signInTeacherWithGoogle,
  signInTeacher
} from "../../lib/api";
import { completeTeacherAuthCallbackIfPresent, isSupabaseConfigured, teacherSupabase } from "../../lib/supabase";
import { TeacherWorkspaceDataProvider, useTeacherWorkspaceData } from "./TeacherWorkspaceData";

type Mode = "signin" | "setup";
type TeacherAuthStatus = "checking" | "signed_out" | "authenticated";

export function TeacherWorkspace() {
  const [mode, setMode] = useState<Mode>("signin");
  const [setupAvailable, setSetupAvailable] = useState<boolean | null>(null);
  const [authStatus, setAuthStatus] = useState<TeacherAuthStatus>(isSupabaseConfigured ? "checking" : "signed_out");
  const [profile, setProfile] = useState<TeacherProfile | null>(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [setupCode, setSetupCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [resetMessage, setResetMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();

  useEffect(() => {
    getTeacherSetupStatus()
      .then((status) => {
        setSetupAvailable(status.setupAvailable);
        if (status.setupAvailable) setMode("setup");
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load teacher setup status"));

    if (isSupabaseConfigured) {
      completeTeacherAuthCallbackIfPresent()
        .then(() => getTeacherSession())
        .then((session) => {
          setProfile(session.profile);
          setAuthStatus("authenticated");
        })
        .catch((err) => {
          setError(err instanceof Error ? err.message : "Teacher sign-in could not be completed.");
          setAuthStatus("signed_out");
        });
    }
  }, []);

  async function startGoogleSignIn() {
    setSubmitting(true);
    setError(null);
    setResetMessage(null);
    try {
      await signInTeacherWithGoogle();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Teacher Google sign-in could not start.");
      setSubmitting(false);
    }
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    setResetMessage(null);
    try {
      if (mode === "setup") {
        await ensureTeacherSetupSession({ email, password });
        const session = await setupTeacher({ setupCode, displayName: displayName || undefined });
        setProfile(session.profile);
        setAuthStatus("authenticated");
        setSetupAvailable(false);
      } else {
        try {
          const session = await signInTeacher({ email, password });
          setProfile(session.profile);
          setAuthStatus("authenticated");
        } catch (err) {
          if (err instanceof ApiRequestError && err.status === 403 && setupAvailable !== false) {
            setMode("setup");
            setError("Teacher setup is not complete. Enter the setup code to claim this teacher account.");
            return;
          }
          throw err;
        }
      }
      navigate(resolvePostAuthTeacherPath(location.pathname), { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Teacher sign-in failed");
    } finally {
      setSubmitting(false);
    }
  }

  async function sendPasswordReset() {
    setSubmitting(true);
    setError(null);
    setResetMessage(null);
    try {
      await requestTeacherPasswordReset({ email });
      setResetMessage("Check your email for a teacher password reset link.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Teacher password reset email could not be sent.");
    } finally {
      setSubmitting(false);
    }
  }

  if (profile) {
    return <TeacherWorkspaceDataProvider><TeacherWorkspaceShell profile={profile} onSignOut={async () => {
      await teacherSupabase.auth.signOut();
      setProfile(null);
      setAuthStatus("signed_out");
      navigate("/teacher", { replace: true });
    }} /></TeacherWorkspaceDataProvider>;
  }

  return (
    <main className="login-page">
      <section className="login-card teacher-card">
        <header className="teacher-page-header">
          <div className="teacher-page-header-main">
            <span className="login-mark teacher-mark"><KeyRound size={24} /></span>
            <div>
              <h1>Teacher Workspace</h1>
              <p>Sign in with your teacher Google or email account.</p>
            </div>
          </div>
        </header>

        {!isSupabaseConfigured && <p className="field-error">Configure Supabase frontend environment variables before teacher login.</p>}

        {authStatus === "checking" ? (
          <div className="login-form" aria-live="polite">
            <div className="loading-mark" />
            <p>Checking teacher session</p>
          </div>
        ) : (
          <>
            {setupAvailable !== false && (
              <div className="segmented-control" aria-label="Teacher auth mode">
                <button type="button" className={mode === "signin" ? "active" : ""} onClick={() => setMode("signin")}>
                  <LogIn size={16} /> Sign in
                </button>
                <button type="button" className={mode === "setup" ? "active" : ""} onClick={() => setMode("setup")}>
                  <UserPlus size={16} /> First setup
                </button>
              </div>
            )}

            {mode === "signin" && (
              <>
                <button
                  type="button"
                  className="google-oauth-button teacher-google-button"
                  onClick={startGoogleSignIn}
                  disabled={submitting || !isSupabaseConfigured}
                >
                  <span className="google-oauth-icon" aria-hidden="true">G</span>
                  <span>{submitting ? "Starting Google sign-in" : "Continue with Google"}</span>
                </button>
                <div className="teacher-auth-divider" aria-hidden="true"><span>or use email</span></div>
              </>
            )}

            <form onSubmit={submit} className="login-form">
              <label>
                Email
                <input value={email} onChange={(event) => setEmail(event.target.value)} type="email" autoComplete="email" required />
              </label>
              <label>
                Password
                <input value={password} onChange={(event) => setPassword(event.target.value)} type="password" autoComplete={mode === "setup" ? "new-password" : "current-password"} required />
              </label>
              {mode === "signin" && (
                <button className="text-button teacher-reset-link" type="button" onClick={sendPasswordReset} disabled={submitting || !isSupabaseConfigured}>
                  <Mail size={16} />
                  Send password reset email
                </button>
              )}
              {mode === "setup" && (
                <>
                  <label>
                    Name
                    <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} autoComplete="name" />
                  </label>
                  <label>
                    Setup code
                    <input value={setupCode} onChange={(event) => setSetupCode(event.target.value)} type="password" autoComplete="one-time-code" required />
                  </label>
                </>
              )}
              {error && <p className="field-error">{error}</p>}
              {resetMessage && <p className="status-line">{resetMessage}</p>}
              <button className="primary-button" type="submit" disabled={submitting || !isSupabaseConfigured}>
                {mode === "setup" ? <UserPlus size={18} /> : <LogIn size={18} />}
                {submitting ? "Checking" : mode === "setup" ? "Create teacher" : "Enter"}
              </button>
            </form>
          </>
        )}
      </section>
    </main>
  );
}

function TeacherWorkspaceShell({ profile, onSignOut }: { profile: TeacherProfile; onSignOut: () => Promise<void> }) {
  const { error, courses } = useTeacherWorkspaceData();
  const [collapsed, setCollapsed] = useState(false);
  const location = useLocation();
  const navItems = useMemo(
    () => [
      { to: "/teacher", label: "Courses & roster", description: "Your classes, students, and enrollment in one place.", end: true, Icon: BookOpen },
      { to: "/teacher/assessments", label: "Assessments", description: "Create thoughtful prompts and clear criteria for success.", end: false, Icon: ClipboardList },
      { to: "/teacher/assignments", label: "Assignments", description: "Choose what your students work on and when it is due.", end: false, Icon: ClipboardCheck },
      { to: "/teacher/review", label: "Response review", description: "Review student thinking, evidence, and provisional scores.", end: false, Icon: MessageSquareText },
      { to: "/teacher/gradebook", label: "Gradebook", description: "Finalize grades, publish feedback, and export your records.", end: false, Icon: Table2 }
    ],
    []
  );
  const current = navItems.find((item) => item.end ? location.pathname === item.to : location.pathname.startsWith(item.to)) ?? navItems[0];

  return (
    <div className={`teacher-page account-workspace ${collapsed ? "sidebar-collapsed" : ""}`}>
      <a className="skip-link" href="#teacher-content">Skip to content</a>
      <aside className="side-rail" aria-label="Teacher navigation">
        <div className="rail-top">
          <Link to="/teacher" className="brand-lockup" aria-label="Causalyst teacher home"><span className="brand-mark"><FlaskConical size={20} /></span><span className="brand-copy"><strong>Causalyst</strong><small>Teacher workspace</small></span></Link>
          <button className="icon-button rail-toggle" type="button" aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} aria-expanded={!collapsed} onClick={() => setCollapsed(!collapsed)} title={collapsed ? "Expand sidebar" : "Collapse sidebar"}>{collapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}</button>
        </div>
        <div className="nav-section-label">Classroom</div>
        <nav className="teacher-workspace-nav side-nav" aria-label="Teacher workspace sections">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            title={item.label}
            aria-label={item.label}
            className={({ isActive }) => (isActive ? "active" : "")}
          >
            <item.Icon size={16} aria-hidden="true" />
            <span>{item.label}</span>
          </NavLink>
        ))}
      </nav>
      <div className="rail-account" title={teacherIdentitySummary(profile)}>
        <span className="account-avatar" aria-hidden="true">{(profile.displayName.trim() || "T").slice(0, 1).toUpperCase()}</span>
        <div className="rail-account-copy"><strong>{profile.displayName || "Teacher"}</strong><small>Teacher account</small></div>
        <button className="icon-button" type="button" onClick={onSignOut} title="Sign out" aria-label="Sign out"><LogOut size={17} /></button>
      </div>
      </aside>
      <main className="teacher-workspace content-shell" id="teacher-content" tabIndex={-1}>
      <header className="workspace-page-header"><div><span className="workspace-eyebrow">Teacher workspace</span><h1>{current.label}</h1><p>{current.description}</p></div><span className="workspace-context"><BookOpen size={16} aria-hidden="true" />{courses.filter((course) => !course.archivedAt).length} courses</span></header>
      <div className="teacher-dashboard">
      {error && (
        <p className="field-error teacher-workspace-error" role="alert">
          <AlertTriangle size={17} aria-hidden="true" />
          <span>{error}</span>
        </p>
      )}
      <Outlet />
      </div>
      </main>
    </div>
  );
}

function teacherIdentitySummary(profile: TeacherProfile): string {
  const name = profile.displayName.trim() || "Teacher";
  const email = profile.email?.trim();
  return email ? `${name} · ${email}` : name;
}

export function resolvePostAuthTeacherPath(pathname: string): "/teacher" | "/teacher/assessments" | "/teacher/assignments" | "/teacher/review" | "/teacher/gradebook" {
  if (pathname === "/teacher/assessments" || pathname.startsWith("/teacher/assessments/")) {
    return "/teacher/assessments";
  }
  if (pathname === "/teacher/assignments" || pathname.startsWith("/teacher/assignments/")) {
    return "/teacher/assignments";
  }
  if (pathname === "/teacher/gradebook" || pathname.startsWith("/teacher/gradebook/")) {
    return "/teacher/gradebook";
  }
  if (pathname === "/teacher/review" || pathname.startsWith("/teacher/review/")) {
    return "/teacher/review";
  }
  return "/teacher";
}
