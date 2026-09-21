import type { ReactElement } from "react";
import { Navigate, Outlet, Route, Routes } from "react-router-dom";
import { AppShell } from "./components/AppShell";
import { AssessmentPage } from "./pages/AssessmentPage";
import { AttemptResultPage } from "./pages/AttemptResultPage";
import { Dashboard } from "./pages/Dashboard";
import { FinalResultPage } from "./pages/FinalResultPage";
import { Login } from "./pages/Login";
import { TeacherAssessmentsPage } from "./pages/teacher/TeacherAssessmentsPage";
import { TeacherAssignmentsPage } from "./pages/teacher/TeacherAssignmentsPage";
import { TeacherAttemptReviewPage } from "./pages/teacher/TeacherAttemptReviewPage";
import { TeacherCoursesPage } from "./pages/teacher/TeacherCoursesPage";
import { TeacherGradebookPage } from "./pages/teacher/TeacherGradebookPage";
import { TeacherPasswordReset } from "./pages/teacher/TeacherPasswordReset";
import { TeacherReviewPage } from "./pages/teacher/TeacherReviewPage";
import { TeacherWorkspace } from "./pages/teacher/TeacherWorkspace";
import {
  STUDENT_PROTECTED_ROUTES,
  STUDENT_PUBLIC_ROUTES,
  TEACHER_CHILD_ROUTES,
  type StudentProtectedRouteLabel,
  type StudentPublicRouteLabel,
  type TeacherChildRouteLabel
} from "./routes/appRoutes";
import { SessionProvider, useSession } from "./state/session";

const studentPublicElements: Record<StudentPublicRouteLabel, ReactElement> = {
  login: <Login />
};

const studentProtectedElements: Record<StudentProtectedRouteLabel, ReactElement> = {
  dashboard: <Dashboard />,
  assignment: <AssessmentPage />,
  attemptResult: <AttemptResultPage />,
  finalResult: <FinalResultPage />
};

const teacherElements: Record<TeacherChildRouteLabel, ReactElement> = {
  courses: <TeacherCoursesPage />,
  assessments: <TeacherAssessmentsPage />,
  assignments: <TeacherAssignmentsPage />,
  review: <TeacherReviewPage />,
  attemptReview: <TeacherAttemptReviewPage />,
  gradebook: <TeacherGradebookPage />
};

export default function App() {
  return (
    <Routes>
      <Route path="/teacher/reset-password" element={<TeacherPasswordReset />} />
      <Route path="/teacher/*" element={<TeacherWorkspace />}>
        {TEACHER_CHILD_ROUTES.map((route) => (
          "index" in route && route.index
            ? <Route key={route.label} index element={teacherElements[route.label]} />
            : <Route key={route.label} path={route.path} element={teacherElements[route.label]} />
        ))}
      </Route>
      <Route path="/*" element={<StudentApplication />} />
    </Routes>
  );
}

function StudentApplication() {
  return (
    <SessionProvider>
      <Routes>
        {STUDENT_PUBLIC_ROUTES.map((route) => (
          <Route key={route.label} path={route.path} element={studentPublicElements[route.label]} />
        ))}
        <Route element={<StudentProtectedLayout />}>
          {STUDENT_PROTECTED_ROUTES.map((route) => (
            <Route key={route.label} path={route.path} element={studentProtectedElements[route.label]} />
          ))}
        </Route>
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </SessionProvider>
  );
}

function StudentProtectedLayout() {
  const { status } = useSession();

  if (status === "checking") {
    return (
      <main className="page-stack">
        <p className="status-line">Still checking your Google session.</p>
      </main>
    );
  }

  if (status !== "authenticated") {
    return <Navigate to="/login" replace />;
  }

  return (
    <AppShell>
      <Outlet />
    </AppShell>
  );
}
