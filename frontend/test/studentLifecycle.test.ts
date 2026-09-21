import { describe, expect, it } from "vitest";
import type { StudentAssignmentSummary } from "@alt-assessment/shared";
import { ApiRequestError } from "../src/lib/api";
import {
  extractLifecycleAttemptId,
  extractLifecycleAssignmentId,
  resolveStudentAssignmentAction,
  resolveStudentAssignmentState,
  resolveStudentDueState,
  resolveStudentLifecycleError
} from "../src/lib/studentLifecycle";

describe("student lifecycle assignment mapping", () => {
  it("maps draft, submitted, final, and retry actions deterministically", () => {
    const draft = makeAssignment({
      latestAttempt: { attemptId: "attempt-draft", status: "draft", submittedAt: null, provisionalScore: null }
    });
    const submitted = makeAssignment({
      latestAttempt: { attemptId: "attempt-submitted", status: "submitted", submittedAt: "2026-05-01T11:00:00.000Z", provisionalScore: null }
    });
    const published = makeAssignment({
      latestAttempt: { attemptId: "attempt-final", status: "graded", submittedAt: "2026-05-01T11:00:00.000Z", provisionalScore: 88 },
      publishedGrade: { finalScore: 90, finalStatus: "approved_ai", publishedAt: "2026-05-01T12:00:00.000Z" }
    });
    const retry = makeAssignment({
      latestAttempt: { attemptId: "attempt-error", status: "error", submittedAt: "2026-05-01T11:00:00.000Z", provisionalScore: null }
    });

    expect(resolveStudentAssignmentAction(draft, resolveStudentAssignmentState(draft))).toEqual({
      label: "Continue draft",
      href: "/assignment/assignment-1"
    });
    expect(resolveStudentAssignmentAction(submitted, resolveStudentAssignmentState(submitted))).toEqual({
      label: "View submission",
      href: "/attempt/attempt-submitted"
    });
    expect(resolveStudentAssignmentAction(published, resolveStudentAssignmentState(published))).toEqual({
      label: "View final",
      href: "/final/assignment-1"
    });
    expect(resolveStudentAssignmentAction(retry, resolveStudentAssignmentState(retry))).toEqual({
      label: "Retry after error",
      href: "/assignment/assignment-1"
    });
  });

  it("routes final-published assignments to final results even without an attempt", () => {
    const missingFinal = makeAssignment({
      latestAttempt: null,
      publishedGrade: { finalScore: null, finalStatus: "missing", publishedAt: "2026-05-01T12:00:00.000Z" }
    });

    expect(resolveStudentAssignmentAction(missingFinal, resolveStudentAssignmentState(missingFinal))).toEqual({
      label: "View final",
      href: "/final/assignment-1"
    });
  });

  it("derives due and late states when server fields are absent", () => {
    const nowMs = Date.parse("2026-05-01T10:00:00.000Z");
    const dueSoon = makeAssignment({ dueAt: "2026-05-02T00:00:00.000Z" });
    const overdue = makeAssignment({ dueAt: "2026-05-01T09:00:00.000Z" });
    const lateSubmitted = makeAssignment({
      dueAt: "2026-05-01T09:00:00.000Z",
      latestAttempt: {
        attemptId: "attempt-1",
        status: "graded",
        submittedAt: "2026-05-01T09:30:00.000Z",
        provisionalScore: 80,
        submittedAfterDue: true
      }
    });

    expect(resolveStudentDueState(dueSoon, resolveStudentAssignmentState(dueSoon), nowMs)).toBe("due_soon");
    expect(resolveStudentDueState(overdue, resolveStudentAssignmentState(overdue), nowMs)).toBe("overdue");
    expect(resolveStudentDueState(lateSubmitted, resolveStudentAssignmentState(lateSubmitted), nowMs)).toBe("late_submitted");
  });

  it("normalizes malformed cached state values to safe fallbacks", () => {
    const fromCache = makeAssignment({
      // Simulate stale localStorage or mixed-version payloads.
      state: "assigned" as never,
      dueState: "past_due" as never,
      dueAt: "2026-05-01T09:00:00.000Z"
    });
    const nowMs = Date.parse("2026-05-01T10:00:00.000Z");
    expect(resolveStudentAssignmentState(fromCache)).toBe("not_started");
    expect(resolveStudentDueState(fromCache, resolveStudentAssignmentState(fromCache), nowMs)).toBe("overdue");
  });
});

describe("student lifecycle error mapping", () => {
  it("maps structured lifecycle codes to deterministic guidance", () => {
    expect(resolveStudentLifecycleError(new ApiRequestError("x", 409, "same_course_identity_conflict"))).toContain("already joined");
    expect(resolveStudentLifecycleError(new ApiRequestError("x", 403, "roster_email_required"))).toContain("roster email");
    expect(resolveStudentLifecycleError(new ApiRequestError("x", 403, "roster_email_mismatch"))).toContain("Google account");
    expect(resolveStudentLifecycleError(new ApiRequestError("x", 409, "already_submitted"))).toContain("already submitted");
    expect(resolveStudentLifecycleError(new ApiRequestError("x", 409, "final_published"))).toContain("final grade");
    expect(resolveStudentLifecycleError(new ApiRequestError("x", 409, "final_required"))).toContain("final grade is required");
    expect(resolveStudentLifecycleError(new ApiRequestError("x", 503, "student_login_unavailable"))).toContain("temporarily unavailable");
    expect(resolveStudentLifecycleError(new ApiRequestError("x", 409, "attempt_lifecycle_migration_required"))).toContain("database update");
  });

  it("extracts attempt IDs when structured details are present", () => {
    const withAttempt = new ApiRequestError("x", 409, "already_submitted", { attemptId: "attempt-77" });
    const withoutAttempt = new ApiRequestError("x", 409, "already_submitted", { assignmentId: "assignment-1" });
    expect(extractLifecycleAttemptId(withAttempt)).toBe("attempt-77");
    expect(extractLifecycleAttemptId(withoutAttempt)).toBeNull();
    expect(extractLifecycleAssignmentId(withoutAttempt)).toBe("assignment-1");
  });

  it("falls back for empty error messages", () => {
    expect(resolveStudentLifecycleError(new Error(""))).toBe("Request failed");
  });
});

function makeAssignment(partial: Partial<StudentAssignmentSummary>): StudentAssignmentSummary {
  return {
    assignmentId: "assignment-1",
    classId: "class-1",
    classCode: "BIO101",
    className: "Biology",
    opensAt: null,
    dueAt: null,
    assessment: {
      id: "assessment-1",
      type: "writing",
      title: "Lab writeup",
      prompt: "Explain findings",
      expectedAnswer: null,
      rubric: [],
      config: {},
      dueAt: null
    },
    ...partial
  };
}
