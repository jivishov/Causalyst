import type { SupabaseClient } from "@supabase/supabase-js";
import type { StudentSimulationGenerationJobOperation, StudentSimulationGenerationJobStatus, SimulationHtmlReasoningEffort } from "@alt-assessment/shared";
import { contentDigest } from "./evidence";
import { HttpError } from "./http";

export interface SimulationGenerationJobRow {
  id: string;
  attempt_id: string;
  student_id: string;
  operation: StudentSimulationGenerationJobOperation;
  status: StudentSimulationGenerationJobStatus;
  provider: string;
  provider_response_id: string | null;
  requested_model: string;
  model_used: string | null;
  reasoning_effort: SimulationHtmlReasoningEffort;
  sketch_artifact_id: string;
  input_html_artifact_id: string | null;
  result_artifact_id: string | null;
  source_description_sha256: string;
  error_message: string | null;
  provider_status: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  expires_at: string;
  cancelled_at: string | null;
}

export async function reserveSimulationJob(db: SupabaseClient, input: {
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
  const key = await contentDigest(new TextEncoder().encode(JSON.stringify(input)));
  const { data, error } = await db.rpc("reserve_simulation_job", {
    p_user_id: input.userId, p_attempt_id: input.attemptId, p_key: key, p_input: input
  });
  if (error) throw new HttpError(error.code === "P0001" ? 429 : error.code === "23514" ? 409 : 503, "Could not reserve simulation generation", error.message);
  if (!data?.job) throw new HttpError(503, "Invalid simulation reservation");
  return { claimed: data.claimed === true, job: data.job as SimulationGenerationJobRow };
}

