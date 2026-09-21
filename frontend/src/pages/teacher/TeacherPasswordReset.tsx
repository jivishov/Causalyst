import { FormEvent, useEffect, useState } from "react";
import { KeyRound, LogIn, Save } from "lucide-react";
import { Link } from "react-router-dom";
import { completeTeacherPasswordRecovery, updateTeacherPassword } from "../../lib/api";

type RecoveryStatus = "checking" | "ready" | "updated" | "error";

export function TeacherPasswordReset() {
  const [status, setStatus] = useState<RecoveryStatus>("checking");
  const [error, setError] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let active = true;

    completeTeacherPasswordRecovery()
      .then(() => {
        if (!active) return;
        setStatus("ready");
      })
      .catch((err) => {
        if (!active) return;
        setError(err instanceof Error ? err.message : "Teacher recovery link could not be verified.");
        setStatus("error");
      });

    return () => {
      active = false;
    };
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      if (password !== confirmation) {
        throw new Error("Passwords do not match.");
      }
      await updateTeacherPassword({ password });
      setStatus("updated");
      setPassword("");
      setConfirmation("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Teacher password could not be updated.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="login-page">
      <section className="login-card teacher-card teacher-reset-card" aria-busy={status === "checking" || submitting}>
        <header className="teacher-page-header">
          <div className="teacher-page-header-main">
            <span className="login-mark teacher-mark"><KeyRound size={24} /></span>
            <div>
              <h1>Reset Teacher Password</h1>
              <p>{readStatusMessage(status)}</p>
            </div>
          </div>
        </header>

        {status === "checking" ? (
          <div className="login-form" aria-live="polite">
            <div className="loading-mark" />
            <p>Checking teacher recovery link.</p>
          </div>
        ) : status === "updated" ? (
          <div className="login-form" aria-live="polite">
            <p className="status-line">Teacher password updated.</p>
            <Link className="primary-button" to="/teacher">
              <LogIn size={18} />
              Continue to teacher workspace
            </Link>
          </div>
        ) : status === "ready" ? (
          <form onSubmit={submit} className="login-form">
            <label>
              New password
              <input
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                type="password"
                autoComplete="new-password"
                required
              />
            </label>
            <label>
              Confirm new password
              <input
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
                type="password"
                autoComplete="new-password"
                required
              />
            </label>
            {error && <p className="field-error">{error}</p>}
            <button className="primary-button" type="submit" disabled={submitting}>
              <Save size={18} />
              {submitting ? "Saving" : "Save password"}
            </button>
          </form>
        ) : (
          <div className="login-form" aria-live="polite">
            {error && <p className="field-error">{error}</p>}
            <Link className="text-button" to="/teacher">Back to teacher sign in</Link>
          </div>
        )}
      </section>
    </main>
  );
}

function readStatusMessage(status: RecoveryStatus): string {
  if (status === "checking") return "Verifying the recovery email link.";
  if (status === "updated") return "Use the new password the next time you sign in.";
  if (status === "error") return "Request a new teacher reset link.";
  return "Choose a new teacher account password.";
}
