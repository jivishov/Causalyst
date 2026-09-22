import type { AppDatabaseClient } from "../lib/database";
import type {
  AttemptResult,
  SimulationHtmlReasoningEffort,
  SimulationSpec,
  StudentAttemptSummary,
  StudentSimulationGenerationJob,
  StudentPublishedFinalResultResponse,
  StudentPublishedGrade,
  StudentSimulationPreview
} from "@alt-assessment/shared";
import {
  DEFAULT_SIMULATION_HTML_REASONING_EFFORT,
  SIMULATION_HTML_REASONING_EFFORTS
} from "@alt-assessment/shared";
import { requireAssignedAssignment, requireAttempt, toGradeFeedback, studentAssessment } from "../lib/db";
import type { Env } from "../lib/env";
import { HttpError, getRequiredString, readJson } from "../lib/http";
import { signPreviewToken } from "../lib/crypto";
import { attemptLifecycleMigrationRequired } from "../lib/studentLifecycleErrors";
import { normalizeSimulationHtmlViewport } from "../lib/simulationViewport";

interface AttemptLifecycleRow {
  id: string;
  status: "draft" | "submitted" | "graded" | "error";
  due_at_snapshot: string | null;
  submitted_at?: string | null;
  provisional_score?: number | null;
  submitted_after_due?: boolean | null;
  simulation_description?: string | null;
  created_at: string;
}

interface PublishedGradeRow {
  published_at: string | null;
  approved_attempt_id: string | null;
  approved_score: number | null;
  approved_feedback: unknown;
  teacher_override_score: number | null;
  missing: boolean;
}

export async function startAttempt(
  request: Request,
  envOrDb: Env | AppDatabaseClient,
  dbOrUserId: AppDatabaseClient | string,
  maybeUserId?: string
) {
  const env = typeof dbOrUserId === "string" ? null : envOrDb as Env;
  const db = typeof dbOrUserId === "string" ? envOrDb as AppDatabaseClient : dbOrUserId;
  const userId = typeof dbOrUserId === "string" ? dbOrUserId : maybeUserId;
  if (!userId) throw new HttpError(500, "Missing student user for attempt start");

  const body = await readJson<Record<string, unknown>>(request);
  const assignmentId = getRequiredString(body, "assignmentId");
  const assignment = await requireAssignedAssignment(db, userId, assignmentId);

  const attempts = await loadAssignmentAttempts(db, userId, assignment.assignmentId);
  const latestAttemptId = attempts[0]?.id ?? null;

  const publishedFinal = await loadPublishedFinalGrade(db, userId, assignment.classId, assignment.assignmentId);
  if (publishedFinal) {
    throw new HttpError(
      409,
      "Final grade has already been published for this assignment",
      { assignmentId: assignment.assignmentId, attemptId: publishedFinal.approved_attempt_id ?? latestAttemptId },
      "final_published"
    );
  }

  const draft = attempts.find((attempt) => attempt.status === "draft");
  if (draft) {
    if (!draft.due_at_snapshot && assignment.dueAt) {
      await backfillDraftDueSnapshot(db, userId, draft.id, assignment.dueAt);
    }
    return {
      attemptId: draft.id,
      assignment: { ...assignment, assessment: studentAssessment((await requireAttempt(db, userId, draft.id)).assessment) },
      simulationDraft: env ? await loadSimulationDraftPreview(db, env, userId, draft) : null
    };
  }

  const attemptId = await createDraftAttempt(db, userId, assignment.assignmentId, assignment.assessment.id, assignment.dueAt ?? null);
  return { attemptId, assignment: { ...assignment, assessment: studentAssessment((await requireAttempt(db, userId, attemptId)).assessment) }, simulationDraft: null };
}

export async function attemptResult(db: AppDatabaseClient, env: Env, userId: string, attemptId: string): Promise<AttemptResult> {
  const { attempt, assessment } = await requireAttempt(db, userId, attemptId);
  const assignmentId = attempt.assignment_id;
  const assignmentClassId = assignmentId ? await loadAssignmentClassId(db, assignmentId) : null;
  const publishedGrade = assignmentId && assignmentClassId
    ? await loadStudentPublishedFinalGradeForAssignment(db, userId, assignmentClassId, assignmentId)
    : null;
  const simulationPreview = await loadSimulationPreviewForAttempt(db, env, userId, attempt.id, "simulation-derived", "html", attempt.status !== "draft");
  const simulationSketchPreview = await loadSimulationPreviewForAttempt(db, env, userId, attempt.id, "simulation-sketch", "image", attempt.status !== "draft");

  return {
    attemptId: attempt.id,
    assignmentId,
    assessment: studentAssessment(assessment),
    status: attempt.status as AttemptResult["status"],
    provisionalScore: attempt.provisional_score,
    provisionalFeedback: toGradeFeedback(attempt.provisional_feedback),
    transcript: attempt.transcript,
    ocrText: attempt.ocr_text,
    simulationSpec: attempt.simulation_spec as SimulationSpec | null,
    simulationPreview,
    simulationSketchPreview,
    publishedGrade,
    submittedAt: attempt.submitted_at
  };
}

export async function publishedFinalResult(db: AppDatabaseClient, userId: string, assignmentId: string): Promise<StudentPublishedFinalResultResponse> {
  const assignment = await requireAssignedAssignment(db, userId, assignmentId);
  const publishedGrade = await loadStudentPublishedFinalGradeForAssignment(db, userId, assignment.classId, assignment.assignmentId);
  if (!publishedGrade) {
    throw new HttpError(404, "Published final grade not found");
  }

  const attempts = await loadAssignmentAttempts(db, userId, assignment.assignmentId);
  const latestAttempt = attempts[0] ? toStudentAttemptSummary(attempts[0]) : null;
  return {
    assignmentId: assignment.assignmentId,
    classId: assignment.classId,
    classCode: assignment.classCode,
    className: assignment.className,
    opensAt: assignment.opensAt,
    dueAt: assignment.dueAt,
    assessment: assignment.assessment,
    publishedGrade,
    latestAttempt
  };
}

async function loadAssignmentAttempts(db: AppDatabaseClient, userId: string, assignmentId: string): Promise<AttemptLifecycleRow[]> {
  const initial = await db
    .from("attempts")
    .select("id, status, due_at_snapshot, submitted_at, provisional_score, submitted_after_due, simulation_description, created_at")
    .eq("student_id", userId)
    .eq("assignment_id", assignmentId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false });

  if (!initial.error) {
    return (initial.data ?? []) as AttemptLifecycleRow[];
  }

  if (isMissingSubmittedAfterDueColumn(initial.error)) {
    const fallback = await db
      .from("attempts")
      .select("id, status, due_at_snapshot, submitted_at, provisional_score, simulation_description, created_at")
      .eq("student_id", userId)
      .eq("assignment_id", assignmentId)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false });

    if (fallback.error) {
      if (isMissingRequiredLifecycleSchema(fallback.error)) {
        throw attemptLifecycleMigrationRequired();
      }
      throw new HttpError(500, "Failed to load existing attempts", fallback.error.message);
    }

    return ((fallback.data ?? []) as AttemptLifecycleRow[]).map((row) => ({
      ...row,
      submitted_after_due: false
    }));
  }

  if (isMissingRequiredLifecycleSchema(initial.error)) {
    throw attemptLifecycleMigrationRequired();
  }
  throw new HttpError(500, "Failed to load existing attempts", initial.error.message);
}

function toStudentAttemptSummary(row: AttemptLifecycleRow): StudentAttemptSummary {
  return {
    attemptId: row.id,
    status: row.status,
    submittedAt: row.submitted_at ?? null,
    provisionalScore: row.provisional_score ?? null,
    submittedAfterDue: row.submitted_after_due === true
  };
}

async function loadSimulationDraftPreview(
  db: AppDatabaseClient,
  env: Env,
  userId: string,
  draft: AttemptLifecycleRow
): Promise<{
  description: string;
  simulationPreview: StudentSimulationPreview | null;
  simulationSketchPreview: StudentSimulationPreview | null;
  activeSimulationJob: StudentSimulationGenerationJob | null;
} | null> {
  const simulationPreview = await loadSimulationPreviewForAttempt(db, env, userId, draft.id, "simulation-derived", "html");
  const simulationSketchPreview = await loadSimulationPreviewForAttempt(db, env, userId, draft.id, "simulation-sketch", "image");
  const activeSimulationJob = await loadActiveSimulationGenerationJob(db, userId, draft.id);
  if (!draft.simulation_description && !simulationPreview && !simulationSketchPreview && !activeSimulationJob) return null;
  return {
    description: draft.simulation_description ?? "",
    simulationPreview,
    simulationSketchPreview,
    activeSimulationJob
  };
}

async function loadActiveSimulationGenerationJob(db: AppDatabaseClient, userId: string, attemptId: string): Promise<StudentSimulationGenerationJob | null> {
  const { data, error } = await db
    .from("simulation_generation_jobs")
    .select("id, operation, status, created_at, expires_at, requested_model, model_used, reasoning_effort, error_message")
    .eq("student_id", userId)
    .eq("attempt_id", attemptId)
    .in("status", ["queued", "in_progress", "finalizing"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    if (isMissingSimulationGenerationJobsTable(error)) {
      console.error("Simulation generation jobs table is missing during draft recovery", {
        userId,
        attemptId,
        error: error.message
      });
      return null;
    }
    throw new HttpError(500, "Failed to load active simulation generation job", error.message);
  }
  if (!data) return null;
  const status = normalizeSimulationGenerationJobStatus((data as { status?: unknown }).status);
  return {
    jobId: String((data as { id: unknown }).id),
    operation: (data as { operation?: unknown }).operation === "refine" ? "refine" : "generate",
    status,
    startedAt: String((data as { created_at?: unknown }).created_at ?? new Date().toISOString()),
    expiresAt: String((data as { expires_at?: unknown }).expires_at ?? new Date().toISOString()),
    message: status === "finalizing"
      ? "Saving preview..."
      : status === "queued"
        ? "Queued with the model..."
        : "Generating interactive HTML...",
    requestedModel: typeof (data as { requested_model?: unknown }).requested_model === "string" ? (data as { requested_model: string }).requested_model : undefined,
    modelUsed: typeof (data as { model_used?: unknown }).model_used === "string" ? (data as { model_used: string }).model_used : undefined,
    htmlReasoningEffort: normalizeSimulationHtmlReasoningEffort((data as { reasoning_effort?: unknown }).reasoning_effort) ?? undefined,
    errorMessage: typeof (data as { error_message?: unknown }).error_message === "string" ? (data as { error_message: string }).error_message : undefined
  };
}

function normalizeSimulationGenerationJobStatus(status: unknown): StudentSimulationGenerationJob["status"] {
  if (status === "queued" || status === "in_progress" || status === "finalizing") return status;
  return "in_progress";
}

function normalizeSimulationHtmlReasoningEffort(
  value: unknown,
  fallback: SimulationHtmlReasoningEffort | null = DEFAULT_SIMULATION_HTML_REASONING_EFFORT
): SimulationHtmlReasoningEffort | null {
  return typeof value === "string" && (SIMULATION_HTML_REASONING_EFFORTS as readonly string[]).includes(value)
    ? value as SimulationHtmlReasoningEffort
    : fallback;
}

function isMissingSimulationGenerationJobsTable(error: { code?: string; message?: string; details?: string; hint?: string }): boolean {
  const text = `${error.code ?? ""} ${error.message ?? ""} ${error.details ?? ""} ${error.hint ?? ""}`.toLowerCase();
  return text.includes("simulation_generation_jobs")
    && (text.includes("42p01") || text.includes("pgrst") || text.includes("schema cache") || text.includes("does not exist") || text.includes("could not find"));
}

function isMissingSimulationReasoningEffortColumn(error: { code?: string; message?: string; details?: string; hint?: string }): boolean {
  const text = `${error.code ?? ""} ${error.message ?? ""} ${error.details ?? ""} ${error.hint ?? ""}`.toLowerCase();
  return text.includes("reasoning_effort") && (text.includes("42703") || text.includes("column") || text.includes("schema cache"));
}

async function loadPublishedFinalGrade(
  db: AppDatabaseClient,
  userId: string,
  classId: string,
  assignmentId: string
): Promise<PublishedGradeRow | null> {
  const rosterStudentId = await resolveRosterStudentIdForCourse(db, classId, userId);
  if (!rosterStudentId) return null;

  const { data, error } = await db
    .from("gradebook_entries")
    .select("published_at, approved_attempt_id, approved_score, approved_feedback, teacher_override_score, missing")
    .eq("assignment_id", assignmentId)
    .eq("roster_student_id", rosterStudentId)
    .maybeSingle();

  if (error) throw new HttpError(500, "Failed to load published final grade", error.message);
  if (!data) return null;

  const row = data as PublishedGradeRow;
  if (!row.published_at) return null;
  if (!isFinalizedGrade(row)) return null;
  return row;
}

async function loadStudentPublishedFinalGradeForAssignment(
  db: AppDatabaseClient,
  userId: string,
  classId: string,
  assignmentId: string
): Promise<StudentPublishedGrade | null> {
  const published = await loadPublishedFinalGrade(db, userId, classId, assignmentId);
  if (!published) return null;

  if (typeof published.teacher_override_score === "number" && Number.isFinite(published.teacher_override_score)) {
    return {
      finalScore: published.teacher_override_score,
      finalStatus: "teacher_override",
      publishedAt: published.published_at as string
    };
  }

  if (typeof published.approved_score === "number" && Number.isFinite(published.approved_score)) {
    return {
      finalScore: published.approved_score,
      finalStatus: "approved_ai",
      publishedAt: published.published_at as string,
      feedback: toGradeFeedback(published.approved_feedback)
    };
  }

  if (published.missing) {
    return {
      finalScore: null,
      finalStatus: "missing",
      publishedAt: published.published_at as string
    };
  }

  return null;
}

async function loadSimulationPreviewForAttempt(
  db: AppDatabaseClient,
  env: Env,
  userId: string,
  attemptId: string,
  kind: "simulation-derived" | "simulation-sketch",
  outputKind: "html" | "image",
  frozenOnly = false
): Promise<StudentSimulationPreview | null> {
  let query = db
    .from("attempt_artifacts")
    .select("id, upload_state, kind, original_filename, simulation_html_viewport_width, simulation_html_viewport_height")
    .eq("attempt_id", attemptId)
    .eq("student_id", userId)
    .eq("kind", kind)
    .eq("upload_state", "uploaded")
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(1);
  if (frozenOnly) query = query.not("frozen_at", "is", null);
  const { data, error } = await query.maybeSingle();

  if (error) throw new HttpError(500, "Failed to load simulation preview artifact", error.message);
  if (!data || data.kind !== kind || data.upload_state !== "uploaded") return null;

  const artifactId = (data as { id: string }).id;
  const generationSource = outputKind === "html"
    ? (data as { original_filename?: string | null }).original_filename === "simulation-fallback.html"
      ? "structured_fallback" as const
      : "model" as const
    : undefined;
  const htmlReasoningEffort = outputKind === "html" && generationSource === "model"
    ? await loadSimulationHtmlReasoningEffortForArtifact(db, userId, attemptId, artifactId)
    : null;
  const previewToken = await signPreviewToken(artifactId, userId, env);
  return {
    artifactId,
    previewPath: `/artifacts/${artifactId}/preview`,
    previewToken,
    outputKind,
    ...(generationSource ? { generationSource } : {}),
    ...(htmlReasoningEffort ? { htmlReasoningEffort } : {}),
    ...(outputKind === "html" ? { htmlViewport: normalizeSimulationHtmlViewport(data) } : {})
  };
}

async function loadSimulationHtmlReasoningEffortForArtifact(
  db: AppDatabaseClient,
  userId: string,
  attemptId: string,
  artifactId: string
): Promise<SimulationHtmlReasoningEffort | null> {
  const { data, error } = await db
    .from("simulation_generation_jobs")
    .select("reasoning_effort")
    .eq("student_id", userId)
    .eq("attempt_id", attemptId)
    .eq("result_artifact_id", artifactId)
    .order("completed_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    if (isMissingSimulationGenerationJobsTable(error) || isMissingSimulationReasoningEffortColumn(error)) return null;
    throw new HttpError(500, "Failed to load simulation preview reasoning effort", error.message);
  }
  return normalizeSimulationHtmlReasoningEffort((data as { reasoning_effort?: unknown } | null)?.reasoning_effort, null);
}

async function resolveRosterStudentIdForCourse(db: AppDatabaseClient, classId: string, userId: string): Promise<string | null> {
  const { data: membership, error: membershipError } = await db
    .from("class_memberships")
    .select("roster_student_id")
    .eq("class_id", classId)
    .eq("student_id", userId)
    .maybeSingle();
  if (membershipError) throw new HttpError(500, "Failed to load class membership for attempt start", membershipError.message);
  if (membership?.roster_student_id) return membership.roster_student_id as string;

  const { data: rosterStudent, error: rosterError } = await db
    .from("roster_students")
    .select("id")
    .eq("class_id", classId)
    .eq("claimed_by", userId)
    .maybeSingle();
  if (rosterError) throw new HttpError(500, "Failed to load roster student for attempt start", rosterError.message);

  return (rosterStudent?.id as string | undefined) ?? null;
}

async function loadAssignmentClassId(db: AppDatabaseClient, assignmentId: string): Promise<string | null> {
  const { data, error } = await db
    .from("assessment_assignments")
    .select("class_id")
    .eq("id", assignmentId)
    .maybeSingle();
  if (error) throw new HttpError(500, "Failed to load assignment for result view", error.message);
  return (data as { class_id?: string } | null)?.class_id ?? null;
}

function isFinalizedGrade(row: Pick<PublishedGradeRow, "approved_score" | "teacher_override_score" | "missing">): boolean {
  if (typeof row.teacher_override_score === "number" && Number.isFinite(row.teacher_override_score)) return true;
  if (typeof row.approved_score === "number" && Number.isFinite(row.approved_score)) return true;
  return row.missing === true;
}

async function backfillDraftDueSnapshot(
  db: AppDatabaseClient,
  userId: string,
  attemptId: string,
  dueAt: string
): Promise<void> {
  const { error } = await db
    .from("attempts")
    .update({
      due_at_snapshot: dueAt,
      updated_at: new Date().toISOString()
    })
    .eq("id", attemptId)
    .eq("student_id", userId);

  if (error && isMissingLifecycleSchema(error)) {
    throw attemptLifecycleMigrationRequired();
  }
  if (error) throw new HttpError(500, "Failed to update attempt due-date snapshot", error.message);
}

async function createDraftAttempt(
  db: AppDatabaseClient,
  userId: string,
  assignmentId: string,
  assessmentId: string,
  dueAt: string | null
): Promise<string> {
  const { data, error } = await db
    .from("attempts")
    .insert({
      assignment_id: assignmentId,
      assessment_id: assessmentId,
      student_id: userId,
      status: "draft",
      due_at_snapshot: dueAt
    })
    .select("id")
    .single();

  if (!error) {
    return (data as { id: string }).id;
  }

  if (isMissingLifecycleSchema(error)) {
    throw attemptLifecycleMigrationRequired();
  }

  if (!isDraftUniqueConflict(error)) {
    throw new HttpError(500, "Failed to start attempt", error.message);
  }

  const { data: existingDraft, error: existingDraftError } = await db
    .from("attempts")
    .select("id, due_at_snapshot")
    .eq("student_id", userId)
    .eq("assignment_id", assignmentId)
    .eq("status", "draft")
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .maybeSingle();
  if (existingDraftError) throw new HttpError(500, "Failed to load draft after start conflict", existingDraftError.message);
  if (!existingDraft?.id) throw new HttpError(500, "Failed to resolve draft after start conflict");
  if (!existingDraft.due_at_snapshot && dueAt) {
    await backfillDraftDueSnapshot(db, userId, existingDraft.id as string, dueAt);
  }
  return existingDraft.id as string;
}

function isMissingLifecycleSchema(error: { code?: string; message?: string; details?: string; hint?: string }): boolean {
  const text = `${error.code ?? ""} ${error.message ?? ""} ${error.details ?? ""} ${error.hint ?? ""}`.toLowerCase();
  return text.includes("due_at_snapshot") || text.includes("submitted_after_due") || text.includes("42703") || text.includes("pgrst204");
}

function isMissingRequiredLifecycleSchema(error: { code?: string; message?: string; details?: string; hint?: string }): boolean {
  const text = `${error.code ?? ""} ${error.message ?? ""} ${error.details ?? ""} ${error.hint ?? ""}`.toLowerCase();
  return text.includes("due_at_snapshot");
}

function isMissingSubmittedAfterDueColumn(error: { code?: string; message?: string; details?: string; hint?: string }): boolean {
  const text = `${error.code ?? ""} ${error.message ?? ""} ${error.details ?? ""} ${error.hint ?? ""}`.toLowerCase();
  return text.includes("submitted_after_due");
}

function isDraftUniqueConflict(error: { code?: string; message?: string; details?: string; hint?: string }): boolean {
  const text = `${error.code ?? ""} ${error.message ?? ""} ${error.details ?? ""} ${error.hint ?? ""}`.toLowerCase();
  return text.includes("23505") || text.includes("idx_attempts_unique_student_assignment_draft") || text.includes("duplicate key value violates unique constraint");
}
