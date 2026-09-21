import { Navigate, useLocation } from "react-router-dom";
import type { ReactNode } from "react";
import { authConfig } from "./authConfig";
import { useAuth } from "./AuthProvider";

export function AuthGate({ children }: { children: ReactNode }) {
  const { status } = useAuth();
  const location = useLocation();

  if (status === "checking") {
    return (
      <main className="auth-shell">
        <section className="auth-panel compact">
          <div className="loading-mark" />
          <p className="auth-status">Checking your Google session.</p>
        </section>
      </main>
    );
  }

  if (status !== "authenticated") {
    return <Navigate to={authConfig.loginPath} replace state={{ from: location.pathname }} />;
  }

  return <>{children}</>;
}
