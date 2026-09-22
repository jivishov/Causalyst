import type { SupabaseClient } from "@supabase/supabase-js";
import type { AttemptStatus } from "@alt-assessment/shared";
import { HttpError } from "./http";
import { attemptLifecycleMigrationRequired } from "./studentLifecycleErrors";

interface AttemptLifecycleAssignmentRow {
  id: string;
  due_at: string | null;
  archived_at: string | null;
}

interface AttemptLifecycleAttemptRow {
  id: string;
  student_id: string;
  status: AttemptStatus;
  assignment_id: string | null;
  assessment_assignments: AttemptLifecycleAssignmentRow | AttemptLifecycleAssignmentRow[] | null;
}

interface ClaimAttemptSubmissionRpcRow {
  claim_status: "success" | "not_found" | "missing_assignment" | "not_draft" | "archived_assignment" | "claim_failed";
  attempt_id: string | null;
  assignment_id: string | null;
  submitted_at: string | null;
  submitted_after_due: boolean | null;
  assignment_due_at: string | null;
  current_attempt_status: AttemptLifecycleAttemptRow["status"] | null;
}

export interface ClaimAttemptSubmissionResult {
  attemptId: string;
  assignmentId: string;
  submittedAt: string;
  submittedAfterDue: boolean;
  assignmentDueAt: string | null;
}

export function assertDraftAttemptStatus(attemptId: string, status: string): void {
  if (status === "draft") return;
  throw nonDraftAttemptError(attemptId, status);
}

export async function claimAttemptSubmission(
  db: SupabaseClient,
  userId: string,
  attemptId: string,
  now: string,
  artifactIds: string[] = [],
  simulation?: { description: string; sourceHash: string }
): Promise<ClaimAttemptSubmissionResult> {
  const claimTime = normalizeIsoTime(now);
  const { data, error } = await db
    .rpc("claim_attempt_submission", {
      p_user_id: userId,
      p_attempt_id: attemptId,
      p_submitted_at: claimTime,
      p_artifact_ids: artifactIds,
      p_simulation_description: simulation?.description ?? null,
      p_description_sha256: simulation?.sourceHash ?? null
    })
    .single();

  if (error && isMissingLifecycleSchema(error)) {
    throw attemptLifecycleMigrationRequired();
  }
  if (error) {
    throw new HttpError(error.code === "23514" ? 409 : 500, "Could not submit the selected evidence; check that all uploads completed", error.message);
  }

  const claim = data as ClaimAttemptSubmissionRpcRow | null;
  if (!claim || claim.claim_status === "not_found") {
    throw new HttpError(404, "Attempt not found");
  }
  if (claim.claim_status === "missing_assignment") {
    throw new HttpError(409, "Attempt is not linked to an assignment");
  }
  if (claim.claim_status === "archived_assignment") {
    throw new HttpError(409, "Assignment is no longer available");
  }
  if (claim.claim_status === "not_draft") {
    throw nonDraftAttemptError(claim.attempt_id ?? attemptId, claim.current_attempt_status ?? "submitted");
  }
  if (
    claim.claim_status !== "success" ||
    !claim.attempt_id ||
    !claim.assignment_id ||
    !claim.submitted_at ||
    typeof claim.submitted_after_due !== "boolean"
  ) {
    throw new HttpError(409, "Attempt could not be claimed for submission");
  }

  return {
    attemptId: claim.attempt_id,
    assignmentId: claim.assignment_id,
    submittedAt: new Date(Date.parse(claim.submitted_at)).toISOString(),
    submittedAfterDue: claim.submitted_after_due,
    assignmentDueAt: claim.assignment_due_at
  };
}

export async function markAttemptSubmissionError(
  db: SupabaseClient,
  userId: string,
  attemptId: string,
  now: string
): Promise<void> {
  const errorTime = normalizeIsoTime(now);
  const { error } = await db
    .from("attempts")
    .update({
      status: "error",
      updated_at: errorTime
    })
    .eq("id", attemptId)
    .eq("student_id", userId)
    .eq("status", "submitted");

  if (error && isMissingLifecycleSchema(error)) {
    throw attemptLifecycleMigrationRequired();
  }
  if (error) {
    throw new HttpError(500, "Failed to mark attempt as error", error.message);
  }
}

function normalizeIsoTime(now: string): string {
  const ms = Date.parse(now);
  if (!Number.isFinite(ms)) {
    throw new HttpError(500, "Invalid submission claim timestamp");
  }
  return new Date(ms).toISOString();
}

function nonDraftAttemptError(attemptId: string, status: string): HttpError {
  const code = status === "submitted" || status === "graded"
    ? "already_submitted"
    : undefined;
  return new HttpError(409, "Attempt is no longer in draft state", { attemptId, status }, code);
}

function isMissingLifecycleSchema(error: { code?: string; message?: string; details?: string; hint?: string }): boolean {
  const text = `${error.code ?? ""} ${error.message ?? ""} ${error.details ?? ""} ${error.hint ?? ""}`.toLowerCase();
  return (
    text.includes("claim_attempt_submission") ||
    text.includes("submitted_after_due") ||
    text.includes("42703") ||
    text.includes("42883") ||
    text.includes("pgrst202") ||
    text.includes("pgrst204")
  );
}
