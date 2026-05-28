import type { ReactNode } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { AssessmentPage } from "./pages/AssessmentPage";
import { AttemptResultPage } from "./pages/AttemptResultPage";
import { Dashboard } from "./pages/Dashboard";
import { FinalResultPage } from "./pages/FinalResultPage";
import { Login } from "./pages/Login";
import { SessionProvider, useSession } from "./state/session";

export default function App() {
  return (
    <SessionProvider>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/" element={<RequireStudent><Dashboard /></RequireStudent>} />
        <Route path="/assignment/:assignmentId" element={<RequireStudent><AssessmentPage /></RequireStudent>} />
        <Route path="/attempt/:attemptId" element={<RequireStudent><AttemptResultPage /></RequireStudent>} />
        <Route path="/final/:assignmentId" element={<RequireStudent><FinalResultPage /></RequireStudent>} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </SessionProvider>
  );
}

function RequireStudent({ children }: { children: ReactNode }) {
  const { status } = useSession();

  if (status === "checking") {
    return (
      <main className="page-stack">
        <p className="status-line">Checking student session.</p>
      </main>
    );
  }

  if (status !== "authenticated") {
    return <Navigate to="/login" replace />;
  }

  return children;
}
