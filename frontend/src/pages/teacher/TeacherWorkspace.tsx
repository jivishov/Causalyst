import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  BookOpen,
  ClipboardCheck,
  ClipboardList,
  KeyRound,
  LogIn,
  LogOut,
  Mail,
  MessageSquareText,
  Table2,
  UserPlus
} from "lucide-react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
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

  return (
    <main className={profile ? "teacher-page" : "login-page"}>
      <section className={profile ? "teacher-workspace" : "login-card teacher-card"}>
        <header className="teacher-page-header">
          <div className="teacher-page-header-main">
            <span className="login-mark teacher-mark"><KeyRound size={24} /></span>
            <div>
              <h1>Teacher Workspace</h1>
              <p>{profile ? teacherIdentitySummary(profile) : "Sign in with your teacher Google or email account."}</p>
            </div>
          </div>
          {profile && (
            <button className="secondary-button teacher-signout-button" type="button" onClick={async () => {
              await teacherSupabase.auth.signOut();
              setProfile(null);
              setAuthStatus("signed_out");
              navigate("/teacher", { replace: true });
            }}>
              <LogOut size={16} />
              Sign out
            </button>
          )}
        </header>

        {!isSupabaseConfigured && <p className="field-error">Configure Supabase frontend environment variables before teacher login.</p>}

        {authStatus === "checking" ? (
          <div className="login-form" aria-live="polite">
            <div className="loading-mark" />
            <p>Checking teacher session</p>
          </div>
        ) : profile ? (
          <TeacherWorkspaceDataProvider>
            <TeacherWorkspaceShell />
          </TeacherWorkspaceDataProvider>
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

function TeacherWorkspaceShell() {
  const { error } = useTeacherWorkspaceData();
  const navItems = useMemo(
    () => [
      { to: "/teacher", label: "Courses/Roster", end: true, Icon: BookOpen },
      { to: "/teacher/assessments", label: "Assessments", end: false, Icon: ClipboardList },
      { to: "/teacher/assignments", label: "Assignments", end: false, Icon: ClipboardCheck },
      { to: "/teacher/review", label: "Review", end: false, Icon: MessageSquareText },
      { to: "/teacher/gradebook", label: "Gradebook", end: false, Icon: Table2 }
    ],
    []
  );

  return (
    <div className="teacher-dashboard">
      <nav className="teacher-workspace-nav" aria-label="Teacher workspace sections">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) => (isActive ? "active" : "")}
          >
            <item.Icon size={16} aria-hidden="true" />
            {item.label}
          </NavLink>
        ))}
      </nav>

      {error && (
        <p className="field-error teacher-workspace-error" role="alert">
          <AlertTriangle size={17} aria-hidden="true" />
          <span>{error}</span>
        </p>
      )}
      <Outlet />
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
