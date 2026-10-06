import { lazy, Suspense, type ReactElement } from "react";
import { Navigate, Outlet, Route, Routes, useLocation } from "react-router-dom";
import { AppShell } from "./components/AppShell";
const AssessmentPage = lazy(() => import("./pages/AssessmentPage").then((module) => ({ default: module.AssessmentPage })));
const AttemptResultPage = lazy(() => import("./pages/AttemptResultPage").then((module) => ({ default: module.AttemptResultPage })));
const Dashboard = lazy(() => import("./pages/Dashboard").then((module) => ({ default: module.Dashboard })));
const FinalResultPage = lazy(() => import("./pages/FinalResultPage").then((module) => ({ default: module.FinalResultPage })));
const Login = lazy(() => import("./pages/Login").then((module) => ({ default: module.Login })));
const TeacherAssessmentsPage = lazy(() => import("./pages/teacher/TeacherAssessmentsPage").then((module) => ({ default: module.TeacherAssessmentsPage })));
const TeacherAssignmentsPage = lazy(() => import("./pages/teacher/TeacherAssignmentsPage").then((module) => ({ default: module.TeacherAssignmentsPage })));
const TeacherAttemptReviewPage = lazy(() => import("./pages/teacher/TeacherAttemptReviewPage").then((module) => ({ default: module.TeacherAttemptReviewPage })));
const TeacherCoursesPage = lazy(() => import("./pages/teacher/TeacherCoursesPage").then((module) => ({ default: module.TeacherCoursesPage })));
const TeacherGradebookPage = lazy(() => import("./pages/teacher/TeacherGradebookPage").then((module) => ({ default: module.TeacherGradebookPage })));
const TeacherPasswordReset = lazy(() => import("./pages/teacher/TeacherPasswordReset").then((module) => ({ default: module.TeacherPasswordReset })));
const TeacherReviewPage = lazy(() => import("./pages/teacher/TeacherReviewPage").then((module) => ({ default: module.TeacherReviewPage })));
const TeacherWorkspace = lazy(() => import("./pages/teacher/TeacherWorkspace").then((module) => ({ default: module.TeacherWorkspace })));
const TeacherAiSettingsPage = lazy(() => import("./pages/teacher/TeacherAiSettingsPage").then((module) => ({ default: module.TeacherAiSettingsPage })));
const TeacherChatgptPluginPage = lazy(() => import("./pages/teacher/TeacherChatgptPluginPage").then((module) => ({ default: module.TeacherChatgptPluginPage })));
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
  gradebook: <TeacherGradebookPage />,
  aiSettings: <TeacherAiSettingsPage />,
  chatgptPlugin: <TeacherChatgptPluginPage />
};

export default function App() {
  return (
    <Suspense fallback={<p className="status-line">Loading…</p>}>
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
    </Suspense>
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
  const { pathname } = useLocation();

  if (pathname === "/" && status !== "authenticated") {
    return <Login />;
  }

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
