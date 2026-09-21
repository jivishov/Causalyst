import { useCallback, useEffect, useState } from "react";
import { getCanonicalLocalUrl, getLocalAuthOriginIssue } from "./localAuthOrigin";
import { useAuth } from "./AuthProvider";

export function GoogleLoginButton() {
  const { signInWithGoogle } = useAuth();
  const [submitting, setSubmitting] = useState(false);
  const [originBlocked, setOriginBlocked] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  return (
    <div className="google-login-button-stack">
      <button
        type="button"
        className="google-login-button"
        onClick={handleSignIn}
        disabled={submitting || originBlocked}
      >
        <span className="google-login-mark" aria-hidden="true">G</span>
        <span>{submitting ? "Starting Google sign-in" : "Continue with Google"}</span>
      </button>
      {error && <p className="auth-error" role="alert">{error}</p>}
    </div>
  );
}
