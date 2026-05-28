import type {
  StudentAssignmentState,
  StudentAssignmentSummary,
  StudentDueState,
  StudentLifecycleErrorCode
} from "@alt-assessment/shared";
import { ApiRequestError } from "./api";

const DUE_SOON_WINDOW_MS = 48 * 60 * 60 * 1000;

export interface StudentAssignmentAction {
  label: string;
  href: string | null;
}

export function resolveStudentAssignmentState(assignment: StudentAssignmentSummary): StudentAssignmentState {
  const normalizedState = normalizeAssignmentState(assignment.state);
  if (normalizedState) return normalizedState;
  if (assignment.publishedGrade) return "final_published";
  if (!assignment.latestAttempt) return "not_started";
  if (assignment.latestAttempt.status === "draft") return "draft";
  if (assignment.latestAttempt.status === "error") return "error_retry";
  if (assignment.latestAttempt.status === "submitted") return "submitted";
  return "provisional_ready";
}

export function resolveStudentDueState(
  assignment: StudentAssignmentSummary,
  state: StudentAssignmentState,
  nowMs = Date.now()
): StudentDueState {
  const normalizedDueState = normalizeDueState(assignment.dueState);
  if (normalizedDueState) return normalizedDueState;
  if (assignment.latestAttempt?.submittedAfterDue) return "late_submitted";
  if (!assignment.dueAt) return "none";
  if (state === "final_published" || state === "submitted" || state === "provisional_ready") return "none";

  const dueMs = Date.parse(assignment.dueAt);
  if (!Number.isFinite(dueMs)) return "none";
  if (dueMs <= nowMs) return "overdue";
  if (dueMs - nowMs <= DUE_SOON_WINDOW_MS) return "due_soon";
  return "none";
}

export function resolveStudentAssignmentAction(
  assignment: StudentAssignmentSummary,
  state: StudentAssignmentState
): StudentAssignmentAction {
  const latestAttemptId = assignment.latestAttempt?.attemptId ?? null;
  if (state === "draft") {
    return { label: "Continue draft", href: `/assignment/${assignment.assignmentId}` };
  }
  if (state === "submitted" || state === "provisional_ready") {
    return { label: "View submission", href: latestAttemptId ? `/attempt/${latestAttemptId}` : `/assignment/${assignment.assignmentId}` };
  }
  if (state === "final_published") {
    return { label: "View final", href: `/final/${assignment.assignmentId}` };
  }
  if (state === "error_retry") {
    return { label: "Retry after error", href: `/assignment/${assignment.assignmentId}` };
  }
  return { label: "Start", href: `/assignment/${assignment.assignmentId}` };
}

export function formatStudentAssignmentStateLabel(state: StudentAssignmentState): string {
  if (state === "not_started") return "Not started";
  if (state === "draft") return "Draft";
  if (state === "submitted") return "Submitted";
  if (state === "provisional_ready") return "Provisional ready";
  if (state === "final_published") return "Final published";
  return "Retry needed";
}

export function formatStudentDueStateLabel(dueState: StudentDueState): string {
  if (dueState === "due_soon") return "Due soon";
  if (dueState === "overdue") return "Overdue";
  if (dueState === "late_submitted") return "Submitted late";
  return "On schedule";
}

export function resolveStudentLifecycleError(error: unknown): string {
  if (!(error instanceof ApiRequestError) || !error.code) {
    if (!(error instanceof Error)) return "Request failed";
    return error.message.trim() ? error.message : "Request failed";
  }
  const code = error.code as StudentLifecycleErrorCode | string;
  if (code === "same_course_identity_conflict") {
    return "You are already joined to this course with a different PIN. Use the original PIN for this course.";
  }
  if (code === "roster_email_required") {
    return "This PIN needs a roster email before Google login can be used. Ask your teacher to update the roster.";
  }
  if (code === "roster_email_mismatch") {
    return "Use the Google account that matches the email on your teacher's roster.";
  }
  if (code === "student_login_unavailable") {
    return "Student login is temporarily unavailable. Ask your teacher to contact support.";
  }
  if (code === "attempt_lifecycle_migration_required") {
    return "This assignment needs a database update before generating can run. Ask your teacher to contact support.";
  }
  if (code === "already_submitted") {
    return "This assignment was already submitted. Open your existing submission from the dashboard.";
  }
  if (code === "final_published") {
    return "A final grade has already been published for this assignment.";
  }
  if (code === "final_required") {
    return "A final grade is required before publish can complete. Ask your teacher to finalize the grade first.";
  }
  return error.message.trim() ? error.message : "Request failed";
}

export function extractLifecycleAttemptId(error: unknown): string | null {
  if (!(error instanceof ApiRequestError) || !isRecord(error.details)) return null;
  const attemptId = error.details.attemptId;
  return typeof attemptId === "string" && attemptId.trim() ? attemptId : null;
}

export function extractLifecycleAssignmentId(error: unknown): string | null {
  if (!(error instanceof ApiRequestError) || !isRecord(error.details)) return null;
  const assignmentId = error.details.assignmentId;
  return typeof assignmentId === "string" && assignmentId.trim() ? assignmentId : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeAssignmentState(value: StudentAssignmentSummary["state"]): StudentAssignmentState | null {
  if (value === "not_started") return value;
  if (value === "draft") return value;
  if (value === "submitted") return value;
  if (value === "provisional_ready") return value;
  if (value === "final_published") return value;
  if (value === "error_retry") return value;
  return null;
}

function normalizeDueState(value: StudentAssignmentSummary["dueState"]): StudentDueState | null {
  if (value === "none") return value;
  if (value === "due_soon") return value;
  if (value === "overdue") return value;
  if (value === "late_submitted") return value;
  return null;
}
