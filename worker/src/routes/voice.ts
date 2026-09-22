import { reserveAiBudget } from "../lib/aiBudget";
import type { AppDatabaseClient } from "../lib/database";
import { toJson } from "../lib/database";
import { openaiClient, enforceModelConfirmation, gradeVoice, transcribeAudio } from "../lib/openai";
import { requireArtifact, requireAttempt, logAudit } from "../lib/db";
import type { Env } from "../lib/env";
import { HttpError, getOptionalString, getRequiredString, readJson } from "../lib/http";
import { claimAttemptSubmission, markAttemptSubmissionError } from "../lib/attemptLifecycle";
import { getModel } from "../lib/models";

export async function gradeVoiceAttempt(request: Request, env: Env, db: AppDatabaseClient, userId: string) {
  const body = await readJson<Record<string, unknown>>(request);
  const attemptId = getRequiredString(body, "attemptId");
  const artifactId = getRequiredString(body, "artifactId");
  const browserTranscript = getOptionalString(body, "browserTranscript");
  const confirmed = body.expensiveModelConfirmed === true;
  enforceModelConfirmation(["transcription", "grading"], confirmed);

  const { attempt, assessment } = await requireAttempt(db, userId, attemptId);
  if (assessment.type !== "voice") throw new HttpError(400, "Attempt is not a voice assessment");
  const artifact = await requireArtifact(db, userId, artifactId, attempt.id);
  if (artifact.kind !== "audio" || artifact.upload_state !== "uploaded") {
    throw new HttpError(400, "Audio artifact is not ready");
  }

  const now = new Date().toISOString();
  await reserveAiBudget(db, userId, attempt.id, "voice_grade", 3);
  await claimAttemptSubmission(db, userId, attempt.id, now, [artifact.id]);

  try {
    const { data, error } = await db.storage.from(artifact.bucket).download(artifact.storage_key);
    if (error || !data) throw new HttpError(500, "Failed to download audio artifact", error?.message);

    const client = openaiClient(env.OPENAI_API_KEY);
    const audioFile = new File([await data.arrayBuffer()], artifact.original_filename, { type: artifact.mime_type });
    const transcript = await transcribeAudio(client, audioFile);
    const finalTranscript = transcript.trim();
    if (!finalTranscript) throw new HttpError(422, "No speech was transcribed. Please record a new attempt or ask your teacher to review the recording.");
    const feedback = await gradeVoice(client, {
      prompt: assessment.prompt,
      expectedAnswer: assessment.expectedAnswer ?? null,
      rubric: assessment.rubric,
      scoringPolicy: assessment.config.scoringPolicy,
      transcript: finalTranscript
    });

    await logAudit(db, {
      attemptId,
      route: "/api/voice/grade",
      provider: "openai",
      model: `${getModel("transcription").id},${getModel("grading").id}`,
      requestSummary: { artifactId, browserTranscriptPresent: Boolean(browserTranscript) },
      rawResponse: { transcriptLength: finalTranscript.length, feedback }
    });

    const { error: updateError } = await db.from("attempts").update({
      status: "graded",
      grading_metadata: { model: getModel("grading").id, policyVersion: "rubric-v2", promptVersion: "grading-v2", assessmentVersionId: attempt.assessment_version_id, gradedAt: new Date().toISOString() },
      transcript: finalTranscript,
      provisional_score: feedback.score,
      provisional_feedback: toJson(feedback)
    }).eq("id", attemptId).eq("student_id", userId);
    if (updateError) throw new HttpError(500, "Failed to save voice grade", updateError.message);

    return { transcript: finalTranscript, score: feedback.score, feedback };
  } catch (error) {
    await markSubmissionErrorBestEffort(db, userId, attempt.id);
    throw error;
  }
}

async function markSubmissionErrorBestEffort(db: AppDatabaseClient, userId: string, attemptId: string): Promise<void> {
  try {
    await markAttemptSubmissionError(db, userId, attemptId, new Date().toISOString());
  } catch (error) {
    console.error("Failed to mark voice attempt as error", {
      attemptId,
      userId,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}
