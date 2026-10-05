import { useCallback, useEffect, useState } from "react";
import { StudentFrontpage } from "../components/StudentFrontpage";
import { getCanonicalLocalUrl, getLocalAuthOriginIssue } from "../lib/localAuthOrigin";
import { useSession, type StudentAuthStep } from "../state/session";

const AUTH_STEP_MESSAGES: Record<StudentAuthStep, string> = {
  idle: "Checking for an existing student session.",
  checking_existing_session: "Checking for an existing student session.",
  completing_google_callback: "Completing Google sign-in.",
  reading_google_session: "Reading Google session.",
  loading_student_workspace: "Loading student workspace.",
  resetting: "Resetting sign-in."
};

export function Login() {
  const { authEmail, authError, authStep, logout, signInWithGoogle, status } = useSession();
  const [error, setError] = useState<string | null>(null);
  const [originBlocked, setOriginBlocked] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const handleSignIn = useCallback(async () => {
    setSubmitting(true);
    setError(null);
    try {
      await signInWithGoogle();
    } catch (err) {
      setError(err instanceof Error && err.message.trim() ? err.message : "Google sign-in could not start.");
      setSubmitting(false);
    }
  }, [signInWithGoogle]);

  const resetSignIn = useCallback(async () => {
    setSubmitting(true);
    setError(null);
    try {
      await logout();
    } catch (err) {
      setError(err instanceof Error && err.message.trim() ? err.message : "Could not reset sign-in.");
    } finally {
      setSubmitting(false);
    }
  }, [logout]);

  useEffect(() => {
    if (status === "authenticated") {
      window.location.replace(new URL(import.meta.env.BASE_URL || "/", window.location.origin).toString());
    }
  }, [status]);

  useEffect(() => {
    const canonicalUrl = getCanonicalLocalUrl(window.location.href);
    if (canonicalUrl) {
      window.location.replace(canonicalUrl);
      return;
    }

    const originIssue = getLocalAuthOriginIssue(window.location.origin);
    if (originIssue) {
      setOriginBlocked(true);
      setError(originIssue);
      return;
    }

    setOriginBlocked(false);
  }, []);

  const statusMessage = submitting
    ? "Signing in with Google."
    : status === "checking"
      ? AUTH_STEP_MESSAGES[authStep]
      : null;

  return (
    <StudentFrontpage>
      <section className="frontpage-signin-panel" id="student-sign-in" aria-busy={submitting}>
        <div className="frontpage-signin-heading"><h2>Student Assessment Workspace</h2><span>Start here</span></div>
        <p>Use the Google account your teacher added to the class roster.</p>
        <div className="google-oauth-button-slot">
          <button
            type="button"
            className="google-oauth-button"
            onClick={handleSignIn}
            disabled={submitting || originBlocked}
          >
            <span className="google-oauth-icon" aria-hidden="true">G</span>
            <span>{submitting ? "Starting Google sign-in" : "Continue with Google"}</span>
          </button>
        </div>
        {(error || authError) && <p className="field-error google-only-error" role="alert">{error ?? authError}</p>}
        {statusMessage && <p className="google-only-status" role="status">{statusMessage}</p>}
        {status === "needs_enrollment" && authEmail && (
          <p className="google-only-status" role="status">Signed in as {authEmail}. This account is not on a class roster yet. Ask your teacher to add it.</p>
        )}
        <button type="button" className="text-button google-only-reset-button" onClick={resetSignIn} disabled={submitting}>
          Reset sign-in
        </button>
      </section>
    </StudentFrontpage>
  );
}
