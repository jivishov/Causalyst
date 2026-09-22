import { reserveSimulationJob, type SimulationGenerationJobRow } from "../lib/simulationJobs";
import { reserveAiBudget, boundStudentText } from "../lib/aiBudget";
import { completeArtifact, contentDigest } from "../lib/evidence";
import type { AppDatabaseClient } from "../lib/database";
import type { TablesUpdate } from "../lib/database";
import {
  type StudentSimulationGenerationJob,
  type StudentSimulationGenerationJobOperation,
  type StudentSimulationGenerationJobStatus,
  type SimulationHtmlReasoningEffort,
  type StudentSimulationPreview,
  DEFAULT_SIMULATION_HTML_REASONING_EFFORT,
  SIMULATION_HTML_REASONING_EFFORTS,
  SIMULATION_INSUFFICIENT_DETAIL_MESSAGE,
  SIMULATION_READINESS_UNAVAILABLE_MESSAGE,
  DEFAULT_SIMULATION_CODE_MODEL_ID,
  isSimulationCodeModelId,
  type SimulationHtmlViewport,
  assessSimulationDescriptionReadiness
} from "@alt-assessment/shared";
import { cancelSimulationBackgroundResponse, classifySimulationReadiness, deleteOpenAIFile, enforceModelConfirmation, generateSimulationHtmlChatCompletion, generateSimulationSketch as generateSimulationSketchImage, openaiClient, parseSimulationHtmlResponse, refineSimulationHtmlChatCompletion, retrieveSimulationBackgroundResponse, startRefineSimulationHtmlBackgroundResponse, startSimulationHtmlBackgroundResponse, uploadUserDataFile } from "../lib/openai";
import { requireArtifact, requireAttempt, logAudit } from "../lib/db";
import type { Env } from "../lib/env";
import { HttpError, getRequiredString, readJson } from "../lib/http";
import { signPreviewToken } from "../lib/crypto";
import { assertDraftAttemptStatus, claimAttemptSubmission } from "../lib/attemptLifecycle";
import { getModel, getSimulationCodeModel, toOpenAIModelCatalogEntry, type SimulationCodeModelEntry } from "../lib/models";
import { buildSimulationFallbackHtml } from "../lib/simulationFallbackRenderer";
import { prepareGeneratedSimulationHtml } from "../lib/simulationHtmlPolicy";
import { CURRENT_SIMULATION_HTML_VIEWPORT, normalizeSimulationHtmlViewport, simulationHtmlViewportColumns } from "../lib/simulationViewport";

const SIMULATION_JOB_EXPIRY_MS = 20 * 60 * 1000;
const ACTIVE_SIMULATION_JOB_STATUSES: StudentSimulationGenerationJobStatus[] = ["queued", "in_progress", "finalizing"];
const TERMINAL_SIMULATION_JOB_STATUSES: StudentSimulationGenerationJobStatus[] = ["completed", "failed", "incomplete", "cancelled", "expired"];


export async function generateSimulationSketch(request: Request, env: Env, db: AppDatabaseClient, userId: string) {
  const body = await readJson<Record<string, unknown>>(request);
  const attemptId = getRequiredString(body, "attemptId");
  const description = getRequiredString(body, "description");
  boundStudentText(description);
  const confirmed = body.expensiveModelConfirmed === true;
  enforceModelConfirmation(["simulationSketchImage", "simulationReadinessClassifier"], confirmed);

  const { attempt, assessment } = await requireAttempt(db, userId, attemptId);
  if (assessment.type !== "simulation") throw new HttpError(400, "Attempt is not a simulation assessment");
  assertDraftAttemptStatus(attempt.id, attempt.status);

  await reserveAiBudget(db, userId, attemptId, "simulation_sketch", 5);
  let client: ReturnType<typeof openaiClient> | null = null;
  await ensureSimulationDescriptionReady({
    assessmentPrompt: assessment.prompt,
    description,
    config: assessment.config,
    getClient: () => client ??= openaiClient(env.OPENAI_API_KEY)
  });
  client ??= openaiClient(env.OPENAI_API_KEY);
  const sketchRoleModel = getModel("simulationSketchImage").id;
  const sourceDescriptionSha256 = await hashSimulationDescription(description);
  const sketch = await generateSimulationSketchImage(client, { description });
  const artifact = await storeGeneratedArtifact(db, userId, attemptId, {
    kind: "simulation-sketch",
    bucket: "simulation-sketch",
    filename: "simulation-sketch.png",
    mimeType: sketch.mimeType,
    bytes: sketch.bytes,
    sourceDescriptionSha256,
    client
  });
  const previewToken = await signPreviewToken(artifact.id, userId, env);
  await saveSimulationDraftDescription(db, userId, attempt.id, description);

  await logAudit(db, {
    attemptId,
    route: "/api/simulation/sketch",
    provider: "openai",
    model: sketchRoleModel,
    requestSummary: {
      descriptionLength: description.length,
      sketchModelRequested: sketchRoleModel,
      sketchModelUsed: sketch.modelUsed,
      outputKind: "image",
      artifactId: artifact.id,
      artifactByteSize: artifact.byteSize
    },
    rawResponse: {
      outputKind: "simulation-sketch-artifact",
      artifactId: artifact.id,
      byteSize: artifact.byteSize
    }
  });

  return {
    artifactId: artifact.id,
    previewPath: `/artifacts/${artifact.id}/preview`,
    previewToken,
    modelUsed: sketch.modelUsed,
    requestedModel: sketch.requestedModel,
    outputKind: "image"
  };
}

export async function generateSimulation(request: Request, env: Env, db: AppDatabaseClient, userId: string) {
  const routeStartedAt = Date.now();
  const body = await readJson<Record<string, unknown>>(request);
  const attemptId = getRequiredString(body, "attemptId");
  const description = getRequiredString(body, "description");
  boundStudentText(description);
  const sketchArtifactId = getRequiredString(body, "sketchArtifactId");
  const htmlReasoningEffort = readSimulationHtmlReasoningEffort(body);
  const confirmed = body.expensiveModelConfirmed === true;

  const { attempt, assessment } = await requireAttempt(db, userId, attemptId);
  if (assessment.type !== "simulation") throw new HttpError(400, "Attempt is not a simulation assessment");
  assertDraftAttemptStatus(attempt.id, attempt.status);
  const simulationCodeModel = readAssessmentSimulationCodeModel(assessment.config);
  enforceSimulationCodeModelConfirmation(simulationCodeModel, confirmed);

  const sourceDescriptionSha256 = await hashSimulationDescription(description);
  const sketchArtifact = await requireSimulationArtifactForDescription(
    db,
    userId,
    attempt.id,
    sketchArtifactId,
    "simulation-sketch",
    sourceDescriptionSha256
  );
  logSimulationRouteStage("/api/simulation/generate", attemptId, "sketch-artifact-validated", routeStartedAt);

  let reservedId: string | null = null;
  try {
    const reservation = await reserveSimulationJob(db, {
      requestId: body.requestId,
      userId,
      attemptId: attempt.id,
      operation: "generate",
      sketchArtifactId,
      sourceDescriptionSha256,
      htmlReasoningEffort,
      provider: simulationCodeModel.provider,
      requestedModel: simulationCodeModel.id
    });
    const activeJob = reservation.job;
    if (!reservation.claimed) {
      logSimulationRouteStage("/api/simulation/generate", attemptId, "active-job-reused", routeStartedAt);
      return toStudentSimulationJob(activeJob, await previewForCompletedSimulationJob(db, env, userId, activeJob));
    }

    reservedId = activeJob.id;
    await saveSimulationDraftDescription(db, userId, attempt.id, description);
    if (simulationCodeModel.generationApi === "responses") {
      const client = openaiClient(env.OPENAI_API_KEY);
      const sketchFileId = await ensureOpenAIFileForArtifact(db, client, userId, sketchArtifact);
      logSimulationRouteStage("/api/simulation/generate", attemptId, "sketch-file-ready-for-openai", routeStartedAt);
      const background = await startSimulationHtmlBackgroundResponse(client, {
        description,
        sketchFileId,
        htmlReasoningEffort,
        model: toOpenAIModelCatalogEntry(simulationCodeModel)
      });
      logSimulationRouteStage("/api/simulation/generate", attemptId, "background-response-started", routeStartedAt);
      const job = await createSimulationGenerationJob(db, {
        reservedId: activeJob.id,
        attemptId: attempt.id,
        userId,
        operation: "generate",
        provider: simulationCodeModel.provider,
        providerResponseId: background.responseId,
        providerStatus: background.status,
        requestedModel: simulationCodeModel.id,
        modelUsed: background.modelUsed,
        htmlReasoningEffort,
        sketchArtifactId,
        inputHtmlArtifactId: null,
        sourceDescriptionSha256
      });
      logSimulationRouteStage("/api/simulation/generate", attemptId, "job-created", routeStartedAt);
      return toStudentSimulationJob(job);
    }

    const sketchDataUrl = await downloadArtifactDataUrl(db, sketchArtifact, "Failed to download simulation sketch artifact");
    const client = openaiClient(requireSimulationCodeModelApiKey(env, simulationCodeModel), simulationCodeModel.baseURL);
    const generated = await generateSimulationHtmlChatCompletion(client, simulationCodeModel, {
      description,
      sketchDataUrl
    });
    logSimulationRouteStage("/api/simulation/generate", attemptId, "chat-completion-finished", routeStartedAt);
    return await completeImmediateSimulationGenerationJob(db, env, userId, {
      reservedId: activeJob.id,
      attemptId: attempt.id,
      operation: "generate",
      provider: simulationCodeModel.provider,
      providerResponseId: generated.providerResponseId ?? null,
      requestedModel: simulationCodeModel.id,
      modelUsed: generated.modelUsed,
      htmlReasoningEffort,
      sketchArtifactId,
      inputHtmlArtifactId: null,
      sourceDescriptionSha256,
      html: generated.html
    });
  } catch (error) {
    if (reservedId) await failReservedJob(db, userId, reservedId);
    throw toPublicSimulationGenerationError(error);
  }
}

export async function refineSimulation(request: Request, env: Env, db: AppDatabaseClient, userId: string) {
  const routeStartedAt = Date.now();
  const body = await readJson<Record<string, unknown>>(request);
  const attemptId = getRequiredString(body, "attemptId");
  const description = getRequiredString(body, "description");
  boundStudentText(description);
  const sketchArtifactId = getRequiredString(body, "sketchArtifactId");
  const htmlArtifactId = getRequiredString(body, "htmlArtifactId");
  const htmlReasoningEffort = readSimulationHtmlReasoningEffort(body);
  const confirmed = body.expensiveModelConfirmed === true;

  const { attempt, assessment } = await requireAttempt(db, userId, attemptId);
  if (assessment.type !== "simulation") throw new HttpError(400, "Attempt is not a simulation assessment");
  assertDraftAttemptStatus(attempt.id, attempt.status);
  const simulationCodeModel = readAssessmentSimulationCodeModel(assessment.config);
  enforceSimulationCodeModelConfirmation(simulationCodeModel, confirmed);

  const sourceDescriptionSha256 = await hashSimulationDescription(description);
  const sketchArtifact = await requireSimulationArtifactForDescription(
    db,
    userId,
    attempt.id,
    sketchArtifactId,
    "simulation-sketch",
    sourceDescriptionSha256
  );
  const htmlArtifact = await requireSimulationArtifactForDescription(
    db,
    userId,
    attempt.id,
    htmlArtifactId,
    "simulation-derived",
    sourceDescriptionSha256
  );
  logSimulationRouteStage("/api/simulation/refine", attemptId, "artifacts-validated", routeStartedAt);

  let reservedId: string | null = null;
  try {
    const reservation = await reserveSimulationJob(db, {
      requestId: body.requestId,
      userId,
      attemptId: attempt.id,
      operation: "refine",
      sketchArtifactId,
      inputHtmlArtifactId: htmlArtifactId,
      sourceDescriptionSha256,
      htmlReasoningEffort,
      provider: simulationCodeModel.provider,
      requestedModel: simulationCodeModel.id
    });
    const activeJob = reservation.job;
    if (!reservation.claimed) {
      logSimulationRouteStage("/api/simulation/refine", attemptId, "active-job-reused", routeStartedAt);
      return toStudentSimulationJob(activeJob, await previewForCompletedSimulationJob(db, env, userId, activeJob));
    }

    reservedId = activeJob.id;
    const currentHtml = await downloadArtifactText(db, htmlArtifact, "Failed to download simulation HTML artifact");
    logSimulationRouteStage("/api/simulation/refine", attemptId, "current-html-downloaded", routeStartedAt);
    await saveSimulationDraftDescription(db, userId, attempt.id, description);
    if (simulationCodeModel.generationApi === "responses") {
      const client = openaiClient(env.OPENAI_API_KEY);
      const sketchFileId = await ensureOpenAIFileForArtifact(db, client, userId, sketchArtifact);
      logSimulationRouteStage("/api/simulation/refine", attemptId, "sketch-file-ready-for-openai", routeStartedAt);
      const background = await startRefineSimulationHtmlBackgroundResponse(client, {
        description,
        sketchFileId,
        currentHtml,
        htmlReasoningEffort,
        model: toOpenAIModelCatalogEntry(simulationCodeModel)
      });
      logSimulationRouteStage("/api/simulation/refine", attemptId, "background-response-started", routeStartedAt);
      const job = await createSimulationGenerationJob(db, {
        reservedId: activeJob.id,
        attemptId: attempt.id,
        userId,
        operation: "refine",
        provider: simulationCodeModel.provider,
        providerResponseId: background.responseId,
        providerStatus: background.status,
        requestedModel: simulationCodeModel.id,
        modelUsed: background.modelUsed,
        htmlReasoningEffort,
        sketchArtifactId,
        inputHtmlArtifactId: htmlArtifactId,
        sourceDescriptionSha256
      });
      logSimulationRouteStage("/api/simulation/refine", attemptId, "job-created", routeStartedAt);
      return toStudentSimulationJob(job);
    }

    const sketchDataUrl = await downloadArtifactDataUrl(db, sketchArtifact, "Failed to download simulation sketch artifact");
    const client = openaiClient(requireSimulationCodeModelApiKey(env, simulationCodeModel), simulationCodeModel.baseURL);
    const refined = await refineSimulationHtmlChatCompletion(client, simulationCodeModel, {
      description,
      sketchDataUrl,
      currentHtml
    });
    logSimulationRouteStage("/api/simulation/refine", attemptId, "chat-completion-finished", routeStartedAt);
    return await completeImmediateSimulationGenerationJob(db, env, userId, {
      reservedId: activeJob.id,
      attemptId: attempt.id,
      operation: "refine",
      provider: simulationCodeModel.provider,
      providerResponseId: refined.providerResponseId ?? null,
      requestedModel: simulationCodeModel.id,
      modelUsed: refined.modelUsed,
      htmlReasoningEffort,
      sketchArtifactId,
      inputHtmlArtifactId: htmlArtifactId,
      sourceDescriptionSha256,
      html: refined.html
    });
  } catch (error) {
    if (reservedId) await failReservedJob(db, userId, reservedId);
    throw toPublicSimulationGenerationError(error);
  }
}

export async function fallbackSimulation(request: Request, env: Env, db: AppDatabaseClient, userId: string) {
  const body = await readJson<Record<string, unknown>>(request);
  const attemptId = getRequiredString(body, "attemptId");
  const description = getRequiredString(body, "description");
  boundStudentText(description);
  const sketchArtifactId = getRequiredString(body, "sketchArtifactId");
  const htmlArtifactId = getRequiredString(body, "htmlArtifactId");
  const reasonCodes = Array.isArray(body.reasonCodes)
    ? body.reasonCodes.filter((value): value is string => typeof value === "string" && value.trim().length > 0).slice(0, 12)
    : [];

  const { attempt, assessment } = await requireAttempt(db, userId, attemptId);
  if (assessment.type !== "simulation") throw new HttpError(400, "Attempt is not a simulation assessment");
  assertDraftAttemptStatus(attempt.id, attempt.status);

  const sourceDescriptionSha256 = await hashSimulationDescription(description);
  await requireSimulationArtifactForDescription(
    db,
    userId,
    attempt.id,
    sketchArtifactId,
    "simulation-sketch",
    sourceDescriptionSha256
  );
  await requireSimulationArtifactForDescription(
    db,
    userId,
    attempt.id,
    htmlArtifactId,
    "simulation-derived",
    sourceDescriptionSha256
  );

  const rendered = buildSimulationFallbackHtml({
    title: assessment.title,
    description,
    reasonCodes
  });
  const artifact = await storeGeneratedArtifact(db, userId, attempt.id, {
    kind: "simulation-derived",
    bucket: "simulation-derived",
    filename: "simulation-fallback.html",
    mimeType: "text/html; charset=utf-8",
    bytes: new TextEncoder().encode(rendered.html),
    sourceDescriptionSha256,
    artifactId: crypto.randomUUID(),
    htmlViewport: CURRENT_SIMULATION_HTML_VIEWPORT
  });
  const previewToken = await signPreviewToken(artifact.id, userId, env);
  await saveSimulationDraftDescription(db, userId, attempt.id, description);

  await logAudit(db, {
    attemptId,
    route: "/api/simulation/fallback",
    provider: "system",
    model: "none",
    requestSummary: {
      descriptionLength: description.length,
      sketchArtifactId,
      inputHtmlArtifactId: htmlArtifactId,
      outputKind: "html",
      artifactId: artifact.id,
      artifactByteSize: artifact.byteSize,
      htmlViewport: CURRENT_SIMULATION_HTML_VIEWPORT,
      renderer: rendered.renderer,
      reasonCodes
    },
    rawResponse: {
      outputKind: "simulation-derived-fallback-artifact",
      artifactId: artifact.id,
      byteSize: artifact.byteSize,
      htmlViewport: CURRENT_SIMULATION_HTML_VIEWPORT,
      renderer: rendered.renderer
    }
  });

  return {
    artifactId: artifact.id,
    previewPath: `/artifacts/${artifact.id}/preview`,
    previewToken,
    outputKind: "html" as const,
    generationSource: "structured_fallback" as const,
    htmlViewport: CURRENT_SIMULATION_HTML_VIEWPORT
  };
}

export async function getSimulationGenerationJob(_request: Request, env: Env, db: AppDatabaseClient, userId: string, jobId: string) {
  const job = await requireSimulationGenerationJob(db, userId, jobId);
  if (job.status === "completed") return toStudentSimulationJob(job, await previewForCompletedSimulationJob(db, env, userId, job));
  if (TERMINAL_SIMULATION_JOB_STATUSES.includes(job.status)) return toStudentSimulationJob(job);
  if (job.status === "finalizing") {
    if (Date.now() - Date.parse(job.updated_at) < 120_000) return toStudentSimulationJob(job);
    await failReservedJob(db, userId, job.id);
    return toStudentSimulationJob(await requireSimulationGenerationJob(db, userId, job.id));
  }
  if (!job.provider_response_id && Date.now() - Date.parse(job.created_at) < 120_000) return toStudentSimulationJob(job);
  if (!job.provider_response_id) {
    const failed = await updateSimulationGenerationJob(db, userId, job.id, {
      status: "failed",
      error_message: "Generation job was missing provider state.",
      updated_at: new Date().toISOString()
    });
    return toStudentSimulationJob(failed);
  }
  if (job.provider !== "openai") {
    const failed = await updateSimulationGenerationJob(db, userId, job.id, {
      status: "failed",
      error_message: "Generation job cannot be polled for this provider. Start a new preview generation.",
      updated_at: new Date().toISOString(),
      completed_at: new Date().toISOString()
    });
    return toStudentSimulationJob(failed);
  }

  const client = openaiClient(env.OPENAI_API_KEY);
  const now = Date.now();
  const expired = Date.parse(job.expires_at) <= now;
  let response: any;
  try {
    response = await retrieveSimulationBackgroundResponse(client, job.provider_response_id);
  } catch (error) {
    if (!expired) {
      console.error("Failed to poll simulation background response", {
        jobId: job.id,
        error: error instanceof Error ? error.message : String(error)
      });
      throw new HttpError(502, "Could not check generation status. Try again.");
    }
  }

  if (!expired && response && normalizeProviderStatus(response.status) === "completed") {
    return completeSimulationGenerationJob(db, env, userId, job, response);
  }

  if (expired) {
    await cancelSimulationBackgroundResponseBestEffort(client, job.provider_response_id, job.id);
    const expiredJob = await updateSimulationGenerationJob(db, userId, job.id, {
      status: "expired",
      provider_status: response ? normalizeProviderStatus(response.status) : job.provider_status,
      error_message: "Generation timed out. Start a new preview generation.",
      updated_at: new Date().toISOString()
    });
    logSimulationRouteStage("/api/simulation/jobs/:jobId", job.attempt_id, "expired", now);
    return toStudentSimulationJob(expiredJob);
  }

  const providerStatus = normalizeProviderStatus(response?.status);
  if (providerStatus === "failed" || providerStatus === "incomplete" || providerStatus === "cancelled") {
    const terminalJob = await updateSimulationGenerationJob(db, userId, job.id, {
      status: providerStatus,
      provider_status: providerStatus,
      error_message: providerFailureMessage(response, providerStatus),
      updated_at: new Date().toISOString(),
      completed_at: new Date().toISOString()
    });
    logSimulationRouteStage("/api/simulation/jobs/:jobId", job.attempt_id, providerStatus, now);
    return toStudentSimulationJob(terminalJob);
  }

  const activeStatus: StudentSimulationGenerationJobStatus = providerStatus === "queued" ? "queued" : "in_progress";
  const updatedJob = activeStatus === job.status && providerStatus === job.provider_status
    ? job
    : await updateSimulationGenerationJob(db, userId, job.id, {
      status: activeStatus,
      provider_status: providerStatus,
      updated_at: new Date().toISOString()
    });
  return toStudentSimulationJob(updatedJob);
}

export async function cancelSimulationGenerationJob(_request: Request, env: Env, db: AppDatabaseClient, userId: string, jobId: string) {
  const job = await requireSimulationGenerationJob(db, userId, jobId);
  if (job.status === "completed") return toStudentSimulationJob(job, await previewForCompletedSimulationJob(db, env, userId, job));
  if (TERMINAL_SIMULATION_JOB_STATUSES.includes(job.status)) return toStudentSimulationJob(job);
  if (job.provider === "openai" && job.provider_response_id) {
    await cancelSimulationBackgroundResponseBestEffort(openaiClient(env.OPENAI_API_KEY), job.provider_response_id, job.id);
  }
  const cancelledAt = new Date().toISOString();
  const cancelled = await updateSimulationGenerationJob(db, userId, job.id, {
    status: "cancelled",
    error_message: "Generation was cancelled.",
    updated_at: cancelledAt,
    completed_at: cancelledAt,
    cancelled_at: cancelledAt
  });
  return toStudentSimulationJob(cancelled);
}

export async function submitSimulation(request: Request, _env: Env, db: AppDatabaseClient, userId: string) {
  const body = await readJson<Record<string, unknown>>(request);
  const attemptId = getRequiredString(body, "attemptId");
  const description = getRequiredString(body, "description");
  boundStudentText(description);
  const sketchArtifactId = getRequiredString(body, "sketchArtifactId");
  const htmlArtifactId = getRequiredString(body, "htmlArtifactId");

  const { attempt, assessment } = await requireAttempt(db, userId, attemptId);
  if (assessment.type !== "simulation") throw new HttpError(400, "Attempt is not a simulation assessment");
  assertDraftAttemptStatus(attempt.id, attempt.status);

  const sourceDescriptionSha256 = await hashSimulationDescription(description);
  await requireSimulationArtifactForDescription(db, userId, attempt.id, sketchArtifactId, "simulation-sketch", sourceDescriptionSha256);
  await requireSimulationArtifactForDescription(db, userId, attempt.id, htmlArtifactId, "simulation-derived", sourceDescriptionSha256);

  await claimAttemptSubmission(db, userId, attempt.id, new Date().toISOString(),
    [sketchArtifactId, htmlArtifactId], { description, sourceHash: sourceDescriptionSha256 });
  await logAudit(db, {
    attemptId,
    route: "/api/simulation/submit",
    provider: "system",
    model: "none",
    requestSummary: {
      descriptionLength: description.length,
      sketchArtifactId,
      htmlArtifactId,
      outputKind: "html"
    },
    rawResponse: {
      outputKind: "simulation-submission",
      attemptId: attempt.id
    }
  });

  return { attemptId: attempt.id };
}


async function failReservedJob(db: AppDatabaseClient, userId: string, jobId: string): Promise<void> {
  const { error } = await db.from("simulation_generation_jobs").update({ status: "failed", completed_at: new Date().toISOString(),
    error_message: "Generation did not finish safely. Provider outcome may be unknown; this operation will not be automatically repeated." })
    .eq("id", jobId).eq("student_id", userId).in("status", ACTIVE_SIMULATION_JOB_STATUSES);
  if (error) console.error("Could not persist generation failure", { jobId, code: error.code });
}

async function createSimulationGenerationJob(db: AppDatabaseClient, input: {
  reservedId: string;
  attemptId: string;
  userId: string;
  operation: StudentSimulationGenerationJobOperation;
  provider?: string;
  providerResponseId?: string | null;
  providerStatus: string;
  status?: StudentSimulationGenerationJobStatus;
  requestedModel: string;
  modelUsed: string;
  htmlReasoningEffort: SimulationHtmlReasoningEffort;
  sketchArtifactId: string;
  inputHtmlArtifactId: string | null;
  resultArtifactId?: string | null;
  sourceDescriptionSha256: string;
  completedAt?: string | null;
}): Promise<SimulationGenerationJobRow> {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SIMULATION_JOB_EXPIRY_MS);
  const status = input.status ?? (input.providerStatus === "completed" ? "in_progress" : mapProviderStatusToJobStatus(input.providerStatus));
  const row = {
    attempt_id: input.attemptId,
    student_id: input.userId,
    operation: input.operation,
    status,
    provider: input.provider ?? "openai",
    provider_response_id: input.providerResponseId ?? null,
    requested_model: input.requestedModel,
    model_used: input.modelUsed,
    reasoning_effort: input.htmlReasoningEffort,
    sketch_artifact_id: input.sketchArtifactId,
    input_html_artifact_id: input.inputHtmlArtifactId,
    result_artifact_id: input.resultArtifactId ?? null,
    source_description_sha256: input.sourceDescriptionSha256,
    provider_status: normalizeProviderStatus(input.providerStatus),
    expires_at: expiresAt.toISOString(),
    completed_at: input.completedAt ?? null
  };
  const { data, error } = await db
    .from("simulation_generation_jobs")
    .update(row)
    .eq("id", input.reservedId)
    .in("status", ["queued", "in_progress"])
    .select("*")
    .single();
  if (error || !data) {
    if (error && isMissingSimulationGenerationJobsTable(error)) {
      throw simulationJobStorageNotReady(error.message);
    }
    throw new HttpError(500, "Failed to create simulation generation job", error?.message);
  }
  return toSimulationGenerationJobRow(data);
}

async function requireSimulationGenerationJob(db: AppDatabaseClient, userId: string, jobId: string): Promise<SimulationGenerationJobRow> {
  const { data, error } = await db
    .from("simulation_generation_jobs")
    .select("*")
    .eq("id", jobId)
    .eq("student_id", userId)
    .maybeSingle();
  if (error) throw new HttpError(500, "Failed to load simulation generation job", error.message);
  if (!data) throw new HttpError(404, "Simulation generation job not found");
  return toSimulationGenerationJobRow(data);
}

async function updateSimulationGenerationJob(
  db: AppDatabaseClient,
  userId: string,
  jobId: string,
  payload: TablesUpdate<"simulation_generation_jobs">
): Promise<SimulationGenerationJobRow> {
  const { data, error } = await db
    .from("simulation_generation_jobs")
    .update(payload)
    .eq("id", jobId)
    .eq("student_id", userId)
    .select("*")
    .single();
  if (error || !data) throw new HttpError(500, "Failed to update simulation generation job", error?.message);
  return toSimulationGenerationJobRow(data);
}

async function claimSimulationGenerationJobForFinalization(
  db: AppDatabaseClient,
  userId: string,
  job: SimulationGenerationJobRow
): Promise<SimulationGenerationJobRow | null> {
  if (!["queued", "in_progress"].includes(job.status)) return null;
  const { data, error } = await db
    .from("simulation_generation_jobs")
    .update({
      status: "finalizing",
      provider_status: "completed",
      updated_at: new Date().toISOString()
    })
    .eq("id", job.id)
    .eq("student_id", userId)
    .eq("status", job.status)
    .is("result_artifact_id", null)
    .select("*")
    .maybeSingle();
  if (error) throw new HttpError(500, "Failed to claim simulation generation job", error.message);
  return data ? toSimulationGenerationJobRow(data) : null;
}

async function completeSimulationGenerationJob(
  db: AppDatabaseClient,
  env: Env,
  userId: string,
  job: SimulationGenerationJobRow,
  response: any
): Promise<StudentSimulationGenerationJob> {
  if (job.result_artifact_id) {
    return toStudentSimulationJob(job, await previewForCompletedSimulationJob(db, env, userId, job));
  }

  const finalizing = await claimSimulationGenerationJobForFinalization(db, userId, job);
  if (!finalizing) {
    const current = await requireSimulationGenerationJob(db, userId, job.id);
    return toStudentSimulationJob(current, await previewForCompletedSimulationJob(db, env, userId, current));
  }
  try {
  const html = prepareGeneratedSimulationHtml(parseSimulationHtmlResponse(response));
  const artifact = await storeGeneratedArtifact(db, userId, finalizing.attempt_id, {
    kind: "simulation-derived",
    bucket: "simulation-derived",
    filename: "simulation.html",
    mimeType: "text/html; charset=utf-8",
    bytes: new TextEncoder().encode(html),
    sourceDescriptionSha256: finalizing.source_description_sha256,
    artifactId: finalizing.operation === "refine" ? finalizing.input_html_artifact_id ?? undefined : undefined,
    requireExisting: finalizing.operation === "refine",
    htmlViewport: CURRENT_SIMULATION_HTML_VIEWPORT
  });
  const completedAt = new Date().toISOString();
  const completed = await updateSimulationGenerationJob(db, userId, job.id, {
    status: "completed",
    provider_status: "completed",
    result_artifact_id: artifact.id,
    model_used: typeof response.model === "string" ? response.model : finalizing.model_used,
    error_message: null,
    updated_at: completedAt,
    completed_at: completedAt
  });

  await logAudit(db, {
    attemptId: finalizing.attempt_id,
    route: finalizing.operation === "refine" ? "/api/simulation/refine" : "/api/simulation/generate",
    provider: "openai",
    model: finalizing.requested_model,
    requestSummary: {
      simulationModelRequested: finalizing.requested_model,
      simulationModelUsed: completed.model_used,
      htmlReasoningEffort: finalizing.reasoning_effort,
      sketchArtifactId: finalizing.sketch_artifact_id,
      htmlArtifactId: finalizing.input_html_artifact_id,
      operation: finalizing.operation,
      outputKind: "html",
      artifactId: artifact.id,
      artifactByteSize: artifact.byteSize,
      htmlViewport: CURRENT_SIMULATION_HTML_VIEWPORT,
      jobId: finalizing.id
    },
    rawResponse: {
      outputKind: "simulation-derived-artifact",
      artifactId: artifact.id,
      byteSize: artifact.byteSize,
      htmlViewport: CURRENT_SIMULATION_HTML_VIEWPORT,
      jobId: finalizing.id
    }
  });

  logSimulationRouteStage("/api/simulation/jobs/:jobId", finalizing.attempt_id, "html-artifact-stored", Date.now());
  return toStudentSimulationJob(completed, await previewForCompletedSimulationJob(db, env, userId, completed));
  } catch (error) {
    await failReservedJob(db, userId, job.id);
    throw toPublicSimulationGenerationError(error);
  }
}

async function completeImmediateSimulationGenerationJob(
  db: AppDatabaseClient,
  env: Env,
  userId: string,
  input: {
    reservedId: string;
    attemptId: string;
    operation: StudentSimulationGenerationJobOperation;
    provider: string;
    providerResponseId: string | null;
    requestedModel: string;
    modelUsed: string;
    htmlReasoningEffort: SimulationHtmlReasoningEffort;
    sketchArtifactId: string;
    inputHtmlArtifactId: string | null;
    sourceDescriptionSha256: string;
    html: string;
  }
): Promise<StudentSimulationGenerationJob> {
  const html = prepareGeneratedSimulationHtml(input.html);
  const artifact = await storeGeneratedArtifact(db, userId, input.attemptId, {
    kind: "simulation-derived",
    bucket: "simulation-derived",
    filename: "simulation.html",
    mimeType: "text/html; charset=utf-8",
    bytes: new TextEncoder().encode(html),
    sourceDescriptionSha256: input.sourceDescriptionSha256,
    artifactId: input.operation === "refine" ? input.inputHtmlArtifactId ?? undefined : undefined,
    requireExisting: input.operation === "refine",
    htmlViewport: CURRENT_SIMULATION_HTML_VIEWPORT
  });
  const completedAt = new Date().toISOString();
  const job = await createSimulationGenerationJob(db, {
    reservedId: input.reservedId,
    attemptId: input.attemptId,
    userId,
    operation: input.operation,
    provider: input.provider,
    providerResponseId: input.providerResponseId,
    providerStatus: "completed",
    status: "completed",
    requestedModel: input.requestedModel,
    modelUsed: input.modelUsed,
    htmlReasoningEffort: input.htmlReasoningEffort,
    sketchArtifactId: input.sketchArtifactId,
    inputHtmlArtifactId: input.inputHtmlArtifactId,
    resultArtifactId: artifact.id,
    sourceDescriptionSha256: input.sourceDescriptionSha256,
    completedAt
  });

  await logAudit(db, {
    attemptId: input.attemptId,
    route: input.operation === "refine" ? "/api/simulation/refine" : "/api/simulation/generate",
    provider: input.provider,
    model: input.requestedModel,
    requestSummary: {
      simulationModelRequested: input.requestedModel,
      simulationModelUsed: input.modelUsed,
      htmlReasoningEffort: input.htmlReasoningEffort,
      sketchArtifactId: input.sketchArtifactId,
      htmlArtifactId: input.inputHtmlArtifactId,
      operation: input.operation,
      outputKind: "html",
      artifactId: artifact.id,
      artifactByteSize: artifact.byteSize,
      htmlViewport: CURRENT_SIMULATION_HTML_VIEWPORT,
      jobId: job.id
    },
    rawResponse: {
      outputKind: "simulation-derived-artifact",
      artifactId: artifact.id,
      byteSize: artifact.byteSize,
      htmlViewport: CURRENT_SIMULATION_HTML_VIEWPORT,
      jobId: job.id
    }
  });

  logSimulationRouteStage("/api/simulation/jobs/:jobId", input.attemptId, "html-artifact-stored", Date.now());
  return toStudentSimulationJob(job, await previewForCompletedSimulationJob(db, env, userId, job));
}

async function previewForCompletedSimulationJob(
  db: AppDatabaseClient,
  env: Env,
  userId: string,
  job: SimulationGenerationJobRow
): Promise<StudentSimulationPreview | undefined> {
  if (!job.result_artifact_id) return undefined;
  const htmlViewport = await loadSimulationHtmlViewportForArtifact(db, userId, job.result_artifact_id, CURRENT_SIMULATION_HTML_VIEWPORT);
  const previewToken = await signPreviewToken(job.result_artifact_id, userId, env);
  return {
    artifactId: job.result_artifact_id,
    previewPath: `/artifacts/${job.result_artifact_id}/preview`,
    previewToken,
    outputKind: "html",
    generationSource: "model",
    htmlReasoningEffort: job.reasoning_effort,
    htmlViewport
  };
}

async function loadSimulationHtmlViewportForArtifact(
  db: AppDatabaseClient,
  userId: string,
  artifactId: string,
  fallback: SimulationHtmlViewport
): Promise<SimulationHtmlViewport> {
  const { data, error } = await db
    .from("attempt_artifacts")
    .select("simulation_html_viewport_width, simulation_html_viewport_height")
    .eq("id", artifactId)
    .eq("student_id", userId)
    .maybeSingle();
  if (error || !data) return fallback;
  return normalizeSimulationHtmlViewport(data, fallback);
}

async function saveSimulationDraftDescription(db: AppDatabaseClient, userId: string, attemptId: string, description: string): Promise<void> {
  const { error } = await db.from("attempts").update({
    simulation_description: description,
    simulation_spec: null,
    provisional_score: null,
    provisional_feedback: null,
    updated_at: new Date().toISOString()
  }).eq("id", attemptId).eq("student_id", userId).eq("status", "draft");
  if (error) throw new HttpError(500, "Failed to save simulation draft", error.message);
}

function toStudentSimulationJob(
  job: SimulationGenerationJobRow,
  preview?: StudentSimulationPreview
): StudentSimulationGenerationJob {
  return {
    jobId: job.id,
    operation: job.operation,
    status: job.status,
    startedAt: job.created_at,
    expiresAt: job.expires_at,
    message: simulationJobMessage(job),
    requestedModel: job.requested_model,
    modelUsed: job.model_used ?? undefined,
    htmlReasoningEffort: job.reasoning_effort,
    preview,
    errorMessage: job.error_message ?? undefined
  };
}

function simulationJobMessage(job: Pick<SimulationGenerationJobRow, "status" | "operation" | "error_message">): string {
  if (job.error_message && (job.status === "failed" || job.status === "incomplete" || job.status === "cancelled" || job.status === "expired")) {
    return job.error_message;
  }
  if (job.status === "queued") return "Queued with the model...";
  if (job.status === "in_progress") return job.operation === "refine" ? "Refining interactive HTML..." : "Generating interactive HTML...";
  if (job.status === "finalizing") return "Saving preview...";
  if (job.status === "completed") return "Preview ready.";
  if (job.status === "cancelled") return "Generation was cancelled.";
  if (job.status === "expired") return "Generation timed out. Start a new preview generation.";
  if (job.status === "incomplete") return "Generation stopped before producing a complete preview.";
  return "Simulation generation failed. Please try again.";
}

function mapProviderStatusToJobStatus(providerStatus: string | undefined): StudentSimulationGenerationJobStatus {
  const status = normalizeProviderStatus(providerStatus);
  if (status === "queued") return "queued";
  if (status === "completed") return "completed";
  if (status === "failed") return "failed";
  if (status === "incomplete") return "incomplete";
  if (status === "cancelled") return "cancelled";
  return "in_progress";
}

function normalizeProviderStatus(providerStatus: unknown): string {
  return typeof providerStatus === "string" && providerStatus.trim().length > 0 ? providerStatus : "in_progress";
}

function providerFailureMessage(response: any, status: StudentSimulationGenerationJobStatus): string {
  const providerMessage = typeof response?.error?.message === "string"
    ? response.error.message
    : typeof response?.incomplete_details?.reason === "string"
      ? response.incomplete_details.reason
      : "";
  if (status === "cancelled") return "Generation was cancelled.";
  if (status === "incomplete") {
    if (providerMessage === "max_output_tokens") {
      return "Generation used too much reasoning before producing HTML. Try again with the faster setting.";
    }
    return providerMessage ? `Generation stopped before completion: ${providerMessage}` : "Generation stopped before producing a complete preview.";
  }
  return providerMessage || "Simulation generation failed. Please try again.";
}

async function cancelSimulationBackgroundResponseBestEffort(
  client: ReturnType<typeof openaiClient>,
  responseId: string,
  jobId: string
): Promise<void> {
  try {
    await cancelSimulationBackgroundResponse(client, responseId);
  } catch (error) {
    console.error("Failed to cancel simulation background response", {
      jobId,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

function toSimulationGenerationJobRow(data: any): SimulationGenerationJobRow {
  return {
    id: String(data.id),
    attempt_id: String(data.attempt_id),
    student_id: String(data.student_id),
    operation: data.operation === "refine" ? "refine" : "generate",
    status: normalizeJobStatus(data.status),
    provider: String(data.provider ?? "openai"),
    provider_response_id: typeof data.provider_response_id === "string" ? data.provider_response_id : null,
    requested_model: String(data.requested_model ?? DEFAULT_SIMULATION_CODE_MODEL_ID),
    model_used: typeof data.model_used === "string" ? data.model_used : null,
    reasoning_effort: normalizeSimulationHtmlReasoningEffort(data.reasoning_effort),
    sketch_artifact_id: String(data.sketch_artifact_id),
    input_html_artifact_id: typeof data.input_html_artifact_id === "string" ? data.input_html_artifact_id : null,
    result_artifact_id: typeof data.result_artifact_id === "string" ? data.result_artifact_id : null,
    source_description_sha256: String(data.source_description_sha256 ?? ""),
    error_message: typeof data.error_message === "string" ? data.error_message : null,
    provider_status: typeof data.provider_status === "string" ? data.provider_status : null,
    created_at: String(data.created_at ?? new Date().toISOString()),
    updated_at: String(data.updated_at ?? new Date().toISOString()),
    completed_at: typeof data.completed_at === "string" ? data.completed_at : null,
    expires_at: String(data.expires_at ?? new Date(Date.now() + SIMULATION_JOB_EXPIRY_MS).toISOString()),
    cancelled_at: typeof data.cancelled_at === "string" ? data.cancelled_at : null
  };
}

function readSimulationHtmlReasoningEffort(body: Record<string, unknown>): SimulationHtmlReasoningEffort {
  return normalizeSimulationHtmlReasoningEffort(body.htmlReasoningEffort, true);
}

function normalizeSimulationHtmlReasoningEffort(value: unknown, rejectInvalid = false): SimulationHtmlReasoningEffort {
  if (isSimulationHtmlReasoningEffort(value)) return value;
  if (value === undefined || value === null || value === "") return DEFAULT_SIMULATION_HTML_REASONING_EFFORT;
  if (rejectInvalid) {
    throw new HttpError(400, "Invalid simulation HTML reasoning effort");
  }
  return DEFAULT_SIMULATION_HTML_REASONING_EFFORT;
}

function isSimulationHtmlReasoningEffort(value: unknown): value is SimulationHtmlReasoningEffort {
  return typeof value === "string" && (SIMULATION_HTML_REASONING_EFFORTS as readonly string[]).includes(value);
}

function normalizeJobStatus(status: unknown): StudentSimulationGenerationJobStatus {
  return ACTIVE_SIMULATION_JOB_STATUSES.includes(status as StudentSimulationGenerationJobStatus)
    || TERMINAL_SIMULATION_JOB_STATUSES.includes(status as StudentSimulationGenerationJobStatus)
    ? status as StudentSimulationGenerationJobStatus
    : "in_progress";
}

function isMissingSimulationGenerationJobsTable(error: { code?: string; message?: string; details?: string; hint?: string }): boolean {
  const text = `${error.code ?? ""} ${error.message ?? ""} ${error.details ?? ""} ${error.hint ?? ""}`.toLowerCase();
  return text.includes("simulation_generation_jobs")
    && (text.includes("42p01") || text.includes("pgrst") || text.includes("schema cache") || text.includes("does not exist") || text.includes("could not find"));
}

function simulationJobStorageNotReady(details?: unknown): HttpError {
  return new HttpError(
    503,
    "Simulation generation job storage is not ready. Apply the latest Supabase database update and try again.",
    details
  );
}

function toPublicSimulationGenerationError(error: unknown): unknown {
  if (error instanceof HttpError) return error;
  console.error("Simulation HTML generation failed", {
    error: error instanceof Error ? error.message : String(error)
  });
  return new HttpError(502, "Simulation generation failed. Please try again.");
}

function logSimulationRouteStage(route: string, attemptId: string, stage: string, routeStartedAt: number): void {
  console.info("Simulation route stage", {
    route,
    attemptId,
    stage,
    elapsedMs: Date.now() - routeStartedAt
  });
}

function readAssessmentSimulationCodeModel(config: Record<string, unknown>): SimulationCodeModelEntry {
  const modelId = config.simulationCodeModelId;
  if (modelId === undefined || modelId === null || modelId === "") {
    return getSimulationCodeModel(DEFAULT_SIMULATION_CODE_MODEL_ID);
  }
  if (!isSimulationCodeModelId(modelId)) {
    throw new HttpError(400, "Simulation code model is not available");
  }
  return getSimulationCodeModel(modelId);
}

function enforceSimulationCodeModelConfirmation(model: SimulationCodeModelEntry, confirmed: boolean | undefined): void {
  if (model.provider === "openai") {
    enforceModelConfirmation(["simulationHtml"], confirmed);
  }
}

function requireSimulationCodeModelApiKey(env: Env, model: SimulationCodeModelEntry): string {
  const value = env[model.apiKeyEnv];
  if (typeof value === "string" && value.trim().length > 0) return value;
  throw new HttpError(503, `${model.label} is not configured on this server`);
}

async function downloadArtifactDataUrl(
  db: AppDatabaseClient,
  artifact: Awaited<ReturnType<typeof requireArtifact>>,
  message: string
): Promise<string> {
  const { data, error } = await db.storage.from(artifact.bucket).download(artifact.storage_key);
  if (error || !data) throw new HttpError(500, message, error?.message);
  const bytes = new Uint8Array(await data.arrayBuffer());
  const mimeType = artifact.mime_type || "application/octet-stream";
  return `data:${mimeType};base64,${encodeBase64(bytes)}`;
}

function encodeBase64(bytes: Uint8Array): string {
  if (typeof btoa === "function") {
    let binary = "";
    const chunkSize = 0x8000;
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
    }
    return btoa(binary);
  }
  const buffer = (globalThis as { Buffer?: { from(value: Uint8Array): { toString(encoding: string): string } } }).Buffer;
  if (buffer) return buffer.from(bytes).toString("base64");
  throw new HttpError(500, "Failed to encode simulation sketch artifact");
}

async function ensureOpenAIFileForArtifact(
  db: AppDatabaseClient,
  client: ReturnType<typeof openaiClient>,
  userId: string,
  artifact: Awaited<ReturnType<typeof requireArtifact>>
): Promise<string> {
  if (artifact.openai_file_id) return artifact.openai_file_id;

  const { data, error } = await db.storage.from(artifact.bucket).download(artifact.storage_key);
  if (error || !data) throw new HttpError(500, "Failed to download simulation sketch artifact", error?.message);

  const file = new File([await data.arrayBuffer()], artifact.original_filename, { type: artifact.mime_type });
  const openaiFileId = await uploadUserDataFile(client, file);
  const { error: cacheError } = await db
    .from("attempt_artifacts")
    .update({ openai_file_id: openaiFileId, provider_cleanup_at: new Date(Date.now() + 86400_000).toISOString() })
    .eq("id", artifact.id)
    .eq("student_id", userId)
    .eq("attempt_id", artifact.attempt_id);
  if (cacheError) {
    await deleteOpenAIFileBestEffort(client, openaiFileId, artifact.id);
    throw new HttpError(500, "Failed to cache simulation sketch file handle", cacheError.message);
  }
  return openaiFileId;
}

async function requireSimulationArtifactForDescription(
  db: AppDatabaseClient,
  userId: string,
  attemptId: string,
  artifactId: string,
  kind: "simulation-derived" | "simulation-sketch",
  sourceDescriptionSha256: string
): Promise<Awaited<ReturnType<typeof requireArtifact>>> {
  const artifact = await requireArtifact(db, userId, artifactId, attemptId);
  const label = kind === "simulation-sketch" ? "Simulation sketch" : "Simulation HTML";
  if (artifact.kind !== kind || artifact.upload_state !== "uploaded") {
    throw new HttpError(400, `${label} artifact is not ready`);
  }
  if (artifact.source_description_sha256 !== sourceDescriptionSha256) {
    const recovery = kind === "simulation-sketch" ? "Generate a new sketch." : "Generate a new simulation preview.";
    throw new HttpError(400, `${label} no longer matches the description. ${recovery}`);
  }
  return artifact;
}

async function downloadArtifactText(
  db: AppDatabaseClient,
  artifact: Awaited<ReturnType<typeof requireArtifact>>,
  message: string
): Promise<string> {
  const { data, error } = await db.storage.from(artifact.bucket).download(artifact.storage_key);
  if (error || !data) throw new HttpError(500, message, error?.message);
  return data.text();
}

async function storeGeneratedArtifact(db: AppDatabaseClient, userId: string, attemptId: string, input: {
  kind: "simulation-derived" | "simulation-sketch";
  bucket: "simulation-derived" | "simulation-sketch";
  filename: string;
  mimeType: string;
  bytes: Uint8Array;
  sourceDescriptionSha256?: string;
  client?: ReturnType<typeof openaiClient>;
  artifactId?: string;
  requireExisting?: boolean;
  htmlViewport?: SimulationHtmlViewport;
}): Promise<{ id: string; byteSize: number }> {
  let existingQuery = db
    .from("attempt_artifacts")
    .select("id, storage_key, openai_file_id")
    .eq("attempt_id", attemptId)
    .eq("student_id", userId)
    .eq("kind", input.kind);
  if (input.artifactId) {
    existingQuery = existingQuery.eq("id", input.artifactId);
  } else {
    existingQuery = existingQuery.order("created_at", { ascending: false }).limit(1);
  }
  const { data: existing, error: existingError } = await existingQuery.maybeSingle();
  if (existingError) throw new HttpError(500, "Failed to load simulation artifact", existingError.message);
  if (input.requireExisting && !existing) {
    throw new HttpError(404, "Simulation artifact not found");
  }

  const artifactId = crypto.randomUUID();
  const storageKey = `${input.bucket}/${userId}/${attemptId}/${artifactId}-${input.filename}`;


  {
    const { error: insertError } = await db.from("attempt_artifacts").insert({
      id: artifactId,
      attempt_id: attemptId,
      student_id: userId,
      kind: input.kind,
      bucket: input.bucket,
      storage_key: storageKey,
      mime_type: input.mimeType,
      byte_size: input.bytes.byteLength,
      original_filename: input.filename,
      source_description_sha256: input.sourceDescriptionSha256 ?? null,
      ...(input.htmlViewport ? simulationHtmlViewportColumns(input.htmlViewport) : {}),
      upload_state: "pending",
      cleanup_at: new Date(Date.now() + 7 * 86400000).toISOString()
    });
    if (insertError) throw new HttpError(500, "Failed to create simulation artifact", insertError.message);
  }

  const { error: uploadError } = await db.storage.from(input.bucket).upload(storageKey, input.bytes, {
    contentType: input.mimeType,
    upsert: false
  });
  if (uploadError) throw new HttpError(500, "Failed to upload simulation artifact", uploadError.message);

  await completeArtifact(db, userId, artifactId, await contentDigest(input.bytes));

  return { id: artifactId, byteSize: input.bytes.byteLength };
}

async function deleteOpenAIFileBestEffort(client: ReturnType<typeof openaiClient>, fileId: string, artifactId: string): Promise<void> {
  try {
    await deleteOpenAIFile(client, fileId);
  } catch (error) {
    console.error("Failed to delete stale OpenAI file handle", {
      artifactId,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

async function ensureSimulationDescriptionReady(input: {
  assessmentPrompt: string;
  description: string;
  config: Record<string, unknown>;
  getClient: () => ReturnType<typeof openaiClient>;
}): Promise<void> {
  const readiness = assessSimulationDescriptionReadiness({
    assessmentPrompt: input.assessmentPrompt,
    description: input.description,
    config: input.config
  });
  if (readiness.decision === "allow") return;
  if (readiness.decision === "block") {
    throw new HttpError(400, SIMULATION_INSUFFICIENT_DETAIL_MESSAGE);
  }

  let classified: Awaited<ReturnType<typeof classifySimulationReadiness>>;
  try {
    classified = await classifySimulationReadiness(input.getClient(), {
      assessmentPrompt: input.assessmentPrompt,
      studentDescription: input.description,
      deterministicSignals: readiness.signals
    });
  } catch (error) {
    console.error("Simulation readiness classifier failed", {
      error: error instanceof Error ? error.message : String(error)
    });
    throw new HttpError(503, SIMULATION_READINESS_UNAVAILABLE_MESSAGE);
  }

  if (classified.result.decision !== "allow") {
    throw new HttpError(400, SIMULATION_INSUFFICIENT_DETAIL_MESSAGE);
  }
}

async function hashSimulationDescription(description: string): Promise<string> {
  const bytes = new TextEncoder().encode(normalizeSimulationDescription(description));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function normalizeSimulationDescription(description: string): string {
  return description.trim();
}
