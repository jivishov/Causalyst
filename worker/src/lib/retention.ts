import type { AppDatabaseClient } from "./database";
import type { Json } from "./database";
import type { Env } from "./env";
import { HttpError } from "./http";
import { openaiClient } from "./openai";

export async function runRetention(db: AppDatabaseClient, env: Env): Promise<void> {
  const now = new Date().toISOString();
  // Local recovery must not depend on an external provider being available.
  const { error: recoveryError } = await db.rpc("recover_stale_assessment_work");
  if (recoveryError) throw new HttpError(500, "Could not recover interrupted assessment work", recoveryError.message);
  const stale = new Date(Date.now() - 120_000).toISOString();
  const { error: jobsError } = await db.from("simulation_generation_jobs").update({ status: "failed", completed_at: now,
    error_message: "Generation interrupted. Provider outcome may be unknown; automatic re-execution is disabled." })
    .in("status", ["queued", "in_progress", "finalizing"]).lt("updated_at", stale)
    .or("provider_response_id.is.null,status.eq.finalizing");
  if (jobsError) throw new HttpError(500, "Could not recover stale generation jobs", jobsError.message);
  const { data, error } = await db.from("attempt_artifacts").select("id,bucket,storage_key,openai_file_id,cleanup_at,provider_cleanup_at,frozen_at,cleanup_attempts,upload_state")
    .or(`cleanup_at.lte.${now},provider_cleanup_at.lte.${now}`).lt("cleanup_attempts", 10).order("id").limit(100);
  if (error) throw new HttpError(500, "Could not load retention work", error.message);
  const client = openaiClient(env.OPENAI_API_KEY);
  for (const artifact of data ?? []) {
    const changes: Record<string, Json> = {};
    if (artifact.frozen_at && artifact.cleanup_at) changes.cleanup_at = null;
    try {
      if (artifact.openai_file_id && artifact.provider_cleanup_at && artifact.provider_cleanup_at <= now) {
        try { await client.files.delete(artifact.openai_file_id, { timeout: 5000, maxRetries: 0 }); } catch (error) {
          if (!(error && typeof error === "object" && "status" in error && error.status === 404)) throw error;
        }
        changes.openai_file_id = null;
        changes.provider_cleanup_at = null;
      }
      if (artifact.cleanup_at && artifact.cleanup_at <= now && !artifact.frozen_at) {
        // Claim expiry in SQL under the attempt lock before deleting any bytes.
        const { data: claimed, error: claimError } = await db.rpc("claim_artifact_cleanup", { p_artifact_id: artifact.id });
        if (claimError) throw claimError;
        if (claimed) {
          const { error: removeError } = await db.storage.from(artifact.bucket).remove([artifact.storage_key]);
          if (removeError) throw removeError;
          changes.upload_state = "deleted";
          changes.cleanup_at = null;
        }
      }
      changes.cleanup_error = null;
      changes.cleanup_attempts = 0;
    } catch {
      const attempts = artifact.cleanup_attempts + 1;
      const retryAt = new Date(Date.now() + Math.min(86400_000, 60_000 * 2 ** attempts)).toISOString();
      changes.cleanup_attempts = attempts;
      changes.cleanup_error = "Cleanup failed; retry scheduled. After ten failures, operator review is required.";
      if (artifact.cleanup_at) changes.cleanup_at = retryAt;
      if (artifact.provider_cleanup_at) changes.provider_cleanup_at = retryAt;
    }
    const { error: updateError } = await db.rpc("record_artifact_cleanup", { p_artifact_id: artifact.id, p_changes: changes });
    if (updateError) throw new HttpError(500, "Could not persist cleanup result", updateError.message);
  }
  // A known response is not resubmitted; missing IDs represent unknown provider
  // outcomes. Stale finalization also terminates rather than remaining stuck.
  const { data: expired, error: expiredError } = await db.from("simulation_generation_jobs").select("id,provider,provider_response_id")
    .or("status.in.(queued,in_progress),and(status.eq.expired,provider_status.eq.cancellation_pending)")
    .lte("expires_at", now).order("updated_at").limit(25);
  if (expiredError) throw new HttpError(500, "Could not load expired jobs", expiredError.message);
  for (const job of expired ?? []) {
    let cancellationPending = false;
    if (job.provider === "openai" && job.provider_response_id) {
      try { await client.responses.cancel(job.provider_response_id, { timeout: 5000, maxRetries: 0 }); } catch (error) {
        cancellationPending = !(error && typeof error === "object" && "status" in error && [400, 404, 409].includes(Number(error.status)));
      }
    }
    const { error } = await db.from("simulation_generation_jobs").update({ status: "expired", completed_at: now,
      provider_status: cancellationPending ? "cancellation_pending" : null, updated_at: now,
      error_message: cancellationPending ? "Generation expired. Provider cancellation will be retried." : "Generation expired." })
      .eq("id", job.id).in("status", ["queued", "in_progress", "expired"]);
    if (error) throw new HttpError(500, "Could not expire generation", error.message);
  }
}
