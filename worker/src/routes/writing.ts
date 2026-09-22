import { reserveAiBudget } from "../lib/aiBudget";
import type { AppDatabaseClient } from "../lib/database";
import { toJson } from "../lib/database";
import { enforceModelConfirmation, gradeWriting, openaiClient, uploadUserDataFile } from "../lib/openai";
import { requireArtifact, requireAttempt, logAudit } from "../lib/db";
import type { Env } from "../lib/env";
import { HttpError, getRequiredString, readJson } from "../lib/http";
import { claimAttemptSubmission, markAttemptSubmissionError } from "../lib/attemptLifecycle";
import { getModel } from "../lib/models";

export async function gradeWritingAttempt(request: Request, env: Env, db: AppDatabaseClient, userId: string) {
  const body = await readJson<Record<string, unknown>>(request);
  const attemptId = getRequiredString(body, "attemptId");
  const artifactId = getRequiredString(body, "artifactId");
  const confirmed = body.expensiveModelConfirmed === true;
  enforceModelConfirmation(["visionGrading"], confirmed);

  const { attempt, assessment } = await requireAttempt(db, userId, attemptId);
  if (assessment.type !== "writing") throw new HttpError(400, "Attempt is not a writing assessment");
  const artifact = await requireArtifact(db, userId, artifactId, attempt.id);
  if (artifact.kind !== "writing" || artifact.upload_state !== "uploaded") {
    throw new HttpError(400, "Writing artifact is not ready");
  }

  const now = new Date().toISOString();
  await reserveAiBudget(db, userId, attempt.id, "writing_grade", 3);
  await claimAttemptSubmission(db, userId, attempt.id, now, [artifact.id]);

  try {
    const client = openaiClient(env.OPENAI_API_KEY);
    let openaiFileId = artifact.openai_file_id;
    if (!openaiFileId) {
      const { data, error } = await db.storage.from(artifact.bucket).download(artifact.storage_key);
      if (error || !data) throw new HttpError(500, "Failed to download writing artifact", error?.message);

      const file = new File([await data.arrayBuffer()], artifact.original_filename, { type: artifact.mime_type });
      openaiFileId = await uploadUserDataFile(client, file);
      const { error: cacheError } = await db
        .from("attempt_artifacts")
        .update({ openai_file_id: openaiFileId, provider_cleanup_at: new Date(Date.now() + 3600_000).toISOString() })
        .eq("id", artifact.id)
        .eq("student_id", userId);
      if (cacheError) throw new HttpError(500, "Failed to cache writing artifact file handle", cacheError.message);
    }

    const result = await gradeWriting(client, {
      fileId: openaiFileId,
      prompt: assessment.prompt,
      expectedAnswer: assessment.expectedAnswer ?? null,
      rubric: assessment.rubric,
      scoringPolicy: assessment.config.scoringPolicy
    });

    await logAudit(db, {
      attemptId,
      route: "/api/writing/grade",
      provider: "openai",
      model: getModel("visionGrading").id,
      requestSummary: { artifactId, mimeType: artifact.mime_type },
      rawResponse: { transcribedLength: result.transcribedText.length, feedback: result.feedback }
    });

    const { error: updateError } = await db.from("attempts").update({
      status: "graded",
      grading_metadata: { model: getModel("visionGrading").id, policyVersion: "rubric-v2", promptVersion: "grading-v2", assessmentVersionId: attempt.assessment_version_id, gradedAt: new Date().toISOString() },
      ocr_text: result.transcribedText,
      provisional_score: result.feedback.score,
      provisional_feedback: toJson(result.feedback)
    }).eq("id", attemptId).eq("student_id", userId);
    if (updateError) throw new HttpError(500, "Failed to save writing grade", updateError.message);

    return { ocrText: result.transcribedText, score: result.feedback.score, feedback: result.feedback };
  } catch (error) {
    await markSubmissionErrorBestEffort(db, userId, attempt.id);
    throw error;
  }
}

async function markSubmissionErrorBestEffort(db: AppDatabaseClient, userId: string, attemptId: string): Promise<void> {
  try {
    await markAttemptSubmissionError(db, userId, attemptId, new Date().toISOString());
  } catch (error) {
    console.error("Failed to mark writing attempt as error", {
      attemptId,
      userId,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}
