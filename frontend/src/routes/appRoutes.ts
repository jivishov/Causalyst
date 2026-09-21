export const STUDENT_PUBLIC_ROUTES = [
  { label: "login", path: "/login", auth: "public" }
] as const;

export const STUDENT_PROTECTED_ROUTES = [
  { label: "dashboard", path: "/", auth: "student" },
  { label: "assignment", path: "/assignment/:assignmentId", auth: "student" },
  { label: "attemptResult", path: "/attempt/:attemptId", auth: "student" },
  { label: "finalResult", path: "/final/:assignmentId", auth: "student" }
] as const;

export const TEACHER_CHILD_ROUTES = [
  { label: "courses", path: "", index: true, auth: "teacher" },
  { label: "assessments", path: "assessments", auth: "teacher" },
  { label: "assignments", path: "assignments", auth: "teacher" },
  { label: "review", path: "review", auth: "teacher" },
  { label: "attemptReview", path: "review/:attemptId", auth: "teacher" },
  { label: "gradebook", path: "gradebook", auth: "teacher" }
] as const;

export type StudentPublicRouteLabel = (typeof STUDENT_PUBLIC_ROUTES)[number]["label"];
export type StudentProtectedRouteLabel = (typeof STUDENT_PROTECTED_ROUTES)[number]["label"];
export type TeacherChildRouteLabel = (typeof TEACHER_CHILD_ROUTES)[number]["label"];
