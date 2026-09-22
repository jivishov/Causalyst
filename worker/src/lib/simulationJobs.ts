import type { AppDatabaseClient } from "./database";
import { isJsonObject, type Tables } from "./database";
import type { StudentSimulationGenerationJobOperation, StudentSimulationGenerationJobStatus, SimulationHtmlReasoningEffort } from "@alt-assessment/shared";
import { contentDigest } from "./evidence";
import { HttpError } from "./http";

export type SimulationGenerationJobRow = Omit<Tables<"simulation_generation_jobs">,
  "idempotency_key" | "operation" | "status" | "reasoning_effort"> & {
  operation: StudentSimulationGenerationJobOperation;
  status: StudentSimulationGenerationJobStatus;
  reasoning_effort: SimulationHtmlReasoningEffort;
};

function isSimulationJob(value: unknown): value is SimulationGenerationJobRow {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  const strings = ["id", "attempt_id", "student_id", "provider", "requested_model", "sketch_artifact_id",
    "source_description_sha256", "created_at", "updated_at", "expires_at"];
  const nullableStrings = ["provider_response_id", "model_used", "input_html_artifact_id", "result_artifact_id",
    "error_message", "provider_status", "completed_at", "cancelled_at"];
  return strings.every(key => typeof row[key] === "string")
    && nullableStrings.every(key => row[key] === null || typeof row[key] === "string")
    && (row.operation === "generate" || row.operation === "refine")
    && (row.reasoning_effort === "low" || row.reasoning_effort === "medium" || row.reasoning_effort === "high")
    && typeof row.status === "string"
    && ["queued", "in_progress", "finalizing", "completed", "failed", "incomplete", "cancelled", "expired"].includes(row.status);
}

export async function reserveSimulationJob(db: AppDatabaseClient, input: {
  requestId?: unknown;
  userId: string;
  attemptId: string;
  operation: StudentSimulationGenerationJobOperation;
  sketchArtifactId: string;
  inputHtmlArtifactId?: string | null;
  sourceDescriptionSha256: string;
  htmlReasoningEffort: SimulationHtmlReasoningEffort;
  provider: string;
  requestedModel: string;
}): Promise<{ claimed: boolean; job: SimulationGenerationJobRow }> {
  if (input.requestId !== undefined && (typeof input.requestId !== "string" || !/^[a-zA-Z0-9_-]{8,128}$/.test(input.requestId))) {
    throw new HttpError(400, "Invalid generation request ID");
  }
  const payload = { ...input, requestId: input.requestId as string | undefined };
  const key = await contentDigest(new TextEncoder().encode(JSON.stringify(payload)));
  const { data, error } = await db.rpc("reserve_simulation_job", {
    p_user_id: input.userId, p_attempt_id: input.attemptId, p_key: key, p_input: payload
  });
  if (error) throw new HttpError(error.code === "P0001" ? 429 : error.code === "23514" ? 409 : 503, "Could not reserve simulation generation", error.message);
  if (!isJsonObject(data) || typeof data.claimed !== "boolean" || !isSimulationJob(data.job)
    || data.job.student_id !== input.userId || data.job.attempt_id !== input.attemptId) {
    throw new HttpError(503, "Invalid simulation reservation");
  }
  return { claimed: data.claimed, job: data.job };
}
