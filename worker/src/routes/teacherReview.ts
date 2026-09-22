import type {
  GradingAssessment,
  AttemptStatus,
  GradeFeedback,
  RubricCriterion,
  SimulationSpec,
  TeacherGradebookEntry,
  TeacherAttemptReviewArtifact,
  TeacherRealtimeEvent,
  TeacherRealtimeTrust,
  TeacherRealtimeTrustHistory,
  TeacherAttemptReviewDetailResponse,
  TeacherAttemptReviewListResponse
} from "@alt-assessment/shared";
import type { AppDatabaseClient } from "../lib/database";
import type { Env } from "../lib/env";
import { corsHeaders, HttpError, safeFilename } from "../lib/http";
import { requireTeacherProfile } from "./teacher";
import { getTeacherGradebookEntryById, reconcileGradebookForCourse } from "./teacherGradebook";
import { normalizeSimulationHtmlViewport } from "../lib/simulationViewport";

interface CourseOwnershipRow {
  id: string;
  code: string;
  name: string;
  teacher_id: string | null;
}

interface AssignmentOwnershipRow {
  id: string;
  class_id: string;
  assessment_id: string;
  opens_at: string | null;
  due_at: string | null;
  classes: CourseOwnershipRow | CourseOwnershipRow[] | null;
  assessments: AssessmentRow | AssessmentRow[] | null;
}

interface AssessmentRow {
  id: string;
  type: "voice" | "voice_realtime" | "writing" | "simulation";
  title: string;
  prompt: string;
  expected_answer: string | null;
  rubric: unknown;
  config: unknown;
}

interface AttemptRow {
  assessment_versions?: { definition: AssessmentRow; legacy_capture: boolean };
  id: string;
  assignment_id: string | null;
  student_id: string;
  status: AttemptStatus;
  submitted_after_due: boolean;
  provisional_score: number | null;
  provisional_feedback: unknown | null;
  transcript: string | null;
  ocr_text: string | null;
  simulation_description: string | null;
  simulation_spec: unknown | null;
  submitted_at: string | null;
  created_at: string;
}

interface ProfileRow {
  id: string;
  display_name: string;
}

interface ArtifactRow {
  id: string;
  attempt_id: string;
  kind: TeacherAttemptReviewArtifact["kind"];
  bucket: string;
  storage_key: string;
  mime_type: string;
  byte_size: number;
  original_filename: string;
  upload_state: TeacherAttemptReviewArtifact["uploadState"];
  frozen_at?: string | null;
  simulation_html_viewport_width: number | null;
  simulation_html_viewport_height: number | null;
}

interface RealtimeEventRow {
  id: string;
  session_id: string;
  sequence: number;
  event_type: string;
  role: TeacherRealtimeEvent["role"];
  text: string | null;
  metadata: unknown;
  created_at: string;
}

interface RealtimeSessionRow {
  id: string;
  attempt_id: string;
  status: "connecting" | "active" | "finalizing" | "finalized" | "error";
  started_at: string;
  ended_at: string | null;
  expires_at: string | null;
  continuity_diagnostics: unknown;
  finalized_at: string | null;
  finalize_error: string | null;
}

const ASSESSMENT_SELECT = "id, type, title, prompt, expected_answer, rubric, config";
const ASSIGNMENT_SELECT = `id, class_id, assessment_id, opens_at, due_at, classes(id,code,name,teacher_id), assessments(${ASSESSMENT_SELECT})`;
const ATTEMPT_SELECT = "assessment_versions(definition,legacy_capture), id, assignment_id, student_id, status, submitted_after_due, provisional_score, provisional_feedback, transcript, ocr_text, simulation_description, simulation_spec, submitted_at, created_at";
const ARTIFACT_SELECT = "frozen_at, id, attempt_id, kind, bucket, storage_key, mime_type, byte_size, original_filename, upload_state, simulation_html_viewport_width, simulation_html_viewport_height";
const REALTIME_EVENT_SELECT = "id, session_id, sequence, event_type, role, text, metadata, created_at";
const REALTIME_SESSION_SELECT = "id, attempt_id, status, started_at, ended_at, expires_at, continuity_diagnostics, finalized_at, finalize_error";
export async function listTeacherAttempts(request: Request, db: AppDatabaseClient, userId: string): Promise<TeacherAttemptReviewListResponse> {
  await requireTeacherProfile(db, userId);
  const url = new URL(request.url);
  const courseIdFilter = nonEmpty(url.searchParams.get("courseId"));
  const assignmentIdFilter = nonEmpty(url.searchParams.get("assignmentId"));
  const studentFilter = nonEmpty(url.searchParams.get("student"))?.toLowerCase() ?? null;
  const statusFilter = parseAttemptStatusFilter(url.searchParams.get("status"));

  if (courseIdFilter) {
    await requireOwnedCourse(db, userId, courseIdFilter);
  }
  if (assignmentIdFilter) {
    await requireOwnedAssignment(db, userId, assignmentIdFilter);
  }

  const assignments = await listOwnedAssignments(db, userId, courseIdFilter, assignmentIdFilter);
  if (assignments.length === 0) {
    return { attempts: [] };
  }

  const assignmentIds = assignments.map((row) => row.id);
  const assignmentMap = new Map(assignments.map((row) => [row.id, row]));
  let attemptsQuery = db
    .from("attempts")
    .select(ATTEMPT_SELECT)
    .in("assignment_id", assignmentIds)
    .order("submitted_at", { ascending: false })
    .order("created_at", { ascending: false });
  if (statusFilter) {
    attemptsQuery = attemptsQuery.eq("status", statusFilter);
  }
  const { data: attemptsData, error: attemptsError } = await attemptsQuery;
  if (attemptsError) throw new HttpError(500, "Failed to load attempts", attemptsError.message);
  const attempts = (attemptsData ?? []) as unknown as AttemptRow[];
  if (attempts.length === 0) {
    return { attempts: [] };
  }

  const studentIds = unique(attempts.map((row) => row.student_id));
  const profiles = await loadProfiles(db, studentIds);
  const profileMap = new Map(profiles.map((row) => [row.id, row]));

  const reviewItems = attempts
    .map((attempt) => {
      if (!attempt.assignment_id) return null;
      const assignment = assignmentMap.get(attempt.assignment_id);
      const assignmentCourse = firstRelation(assignment?.classes);
      const assignmentAssessment = firstRelation(assignment?.assessments);
      if (!assignment || !assignmentCourse || !assignmentAssessment) return null;
      const profile = profileMap.get(attempt.student_id);
      const displayName = profile?.display_name?.trim() || "Student";
      if (studentFilter) {
        const normalized = `${displayName} ${attempt.student_id}`.toLowerCase();
        if (!normalized.includes(studentFilter)) return null;
      }
      return {
        attemptId: attempt.id,
        assignmentId: attempt.assignment_id,
        assessmentId: attempt.assessment_versions?.definition.id ?? assignmentAssessment.id,
        assessmentType: attempt.assessment_versions?.definition.type ?? assignmentAssessment.type,
        assessmentTitle: attempt.assessment_versions?.definition.title ?? assignmentAssessment.title,
        status: attempt.status,
        submittedAt: attempt.submitted_at,
        provisionalScore: attempt.provisional_score,
        reviewFlags: reviewFlagsForAttempt(attempt),
        student: {
          id: attempt.student_id,
          displayName
        },
        course: {
          id: assignmentCourse.id,
          code: assignmentCourse.code,
          name: assignmentCourse.name
        },
        assignment: {
          id: assignment.id,
          opensAt: assignment.opens_at,
          dueAt: assignment.due_at
        }
      };
    })
    .filter((item): item is NonNullable<typeof item> => item !== null);

  return { attempts: reviewItems };
}

export async function teacherAttemptDetail(db: AppDatabaseClient, userId: string, attemptId: string): Promise<TeacherAttemptReviewDetailResponse> {
  await requireTeacherProfile(db, userId);
  const attempt = await loadAttemptById(db, attemptId);
  const assignmentId = attempt.assignment_id;
  if (!assignmentId) throw new HttpError(403, "Attempt is not available for teacher review");
  const assignment = await requireOwnedAssignment(db, userId, assignmentId);
  const assignmentCourse = firstRelation(assignment.classes);
  const assignmentAssessment = firstRelation(assignment.assessments);
  if (!assignmentCourse || !assignmentAssessment) {
    throw new HttpError(500, "Attempt is missing assignment linkage");
  }

  const profile = await loadProfile(db, attempt.student_id);
  const displayName = profile?.display_name?.trim() || "Student";
  const definition = attempt.assessment_versions?.definition;
  if (!definition) throw new HttpError(409, "Frozen assessment definition is unavailable");
  const assessment = toReviewAssessmentSummary(definition, assignment.due_at);
  await reconcileGradebookForCourse(db, userId, assignmentCourse.id);
  const gradebookEntry = await loadAttemptGradebookEntry(db, userId, assignment.id, assignmentCourse.id, attempt.student_id);

  const artifacts = await listAttemptArtifacts(db, attempt.id);
  const realtimeSessions = await listAttemptRealtimeSessions(db, attempt.id);
  const realtimeEvents = await listAttemptRealtimeEvents(db, attempt.id);
  const realtimeTrust = buildRealtimeTrust(realtimeSessions, realtimeEvents);
  return {
    attempt: {
      attemptId: attempt.id,
      assignmentId: attempt.assignment_id,
      status: attempt.status,
      submittedAt: attempt.submitted_at,
      provisionalScore: attempt.provisional_score,
      provisionalFeedback: feedbackFromUnknown(attempt.provisional_feedback),
      reviewFlags: reviewFlagsForAttempt(attempt),
      transcript: attempt.transcript,
      ocrText: attempt.ocr_text,
      simulationDescription: attempt.simulation_description,
      simulationSpec: toSimulationSpec(attempt.simulation_spec),
      gradebookEntry,
      student: {
        id: attempt.student_id,
        displayName
      },
      course: {
        id: assignmentCourse.id,
        code: assignmentCourse.code,
        name: assignmentCourse.name
      },
      assignment: {
        id: assignment.id,
        opensAt: assignment.opens_at,
        dueAt: assignment.due_at
      },
      assessment,
      legacyContextCapture: attempt.assessment_versions?.legacy_capture === true,
      artifacts: artifacts.filter(artifact => attempt.status === "draft" || artifact.frozen_at).map(toTeacherArtifact),
      realtimeEvents: realtimeEvents.map(toTeacherRealtimeEvent),
      realtimeTrust
    }
  };
}

export async function previewTeacherArtifact(request: Request, env: Env, db: AppDatabaseClient, userId: string, artifactId: string): Promise<Response> {
  await requireTeacherProfile(db, userId);
  const artifact = await requireTeacherArtifact(db, userId, artifactId);
  if (artifact.upload_state !== "uploaded") {
    throw new HttpError(409, "Artifact is not available yet");
  }

  const { data, error } = await db.storage.from(artifact.bucket).download(artifact.storage_key);
  if (error || !data) throw new HttpError(500, "Failed to download artifact", error?.message);
  return new Response(await data.arrayBuffer(), {
    status: 200,
    headers: {
      ...corsHeaders(request, env),
      "Content-Type": artifact.mime_type || "application/octet-stream",
      "Content-Disposition": `inline; filename="${safeFilename(artifact.original_filename || "artifact.bin")}"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff"
    }
  });
}

export async function downloadTeacherArtifact(request: Request, env: Env, db: AppDatabaseClient, userId: string, artifactId: string): Promise<Response> {
  await requireTeacherProfile(db, userId);
  const artifact = await requireTeacherArtifact(db, userId, artifactId);
  if (artifact.upload_state !== "uploaded") {
    throw new HttpError(409, "Artifact is not available yet");
  }

  const { data, error } = await db.storage.from(artifact.bucket).download(artifact.storage_key);
  if (error || !data) throw new HttpError(500, "Failed to download artifact", error?.message);
  return new Response(await data.arrayBuffer(), {
    status: 200,
    headers: {
      ...corsHeaders(request, env),
      "Content-Type": artifact.mime_type || "application/octet-stream",
      "Content-Disposition": `attachment; filename="${safeFilename(artifact.original_filename || "artifact.bin")}"`,
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff"
    }
  });
}

async function requireOwnedCourse(db: AppDatabaseClient, userId: string, courseId: string): Promise<CourseOwnershipRow> {
  const { data, error } = await db
    .from("classes")
    .select("id, code, name, teacher_id")
    .eq("id", courseId)
    .maybeSingle();
  if (error) throw new HttpError(500, "Failed to load course", error.message);
  if (!data) throw new HttpError(404, "Course not found");
  if (data.teacher_id !== userId) throw new HttpError(403, "Teacher does not own this course");
  return data as CourseOwnershipRow;
}

async function requireOwnedAssignment(db: AppDatabaseClient, userId: string, assignmentId: string): Promise<AssignmentOwnershipRow> {
  const { data, error } = await db
    .from("assessment_assignments")
    .select(ASSIGNMENT_SELECT)
    .eq("id", assignmentId)
    .maybeSingle();
  if (error) throw new HttpError(500, "Failed to load assignment", error.message);
  if (!data) throw new HttpError(404, "Assignment not found");
  const assignment = data as AssignmentOwnershipRow;
  const course = firstRelation(assignment.classes);
  if (!course?.id) throw new HttpError(500, "Assignment is missing course linkage");
  if (course.teacher_id !== userId) throw new HttpError(403, "Teacher does not own this assignment");
  return assignment;
}

async function listOwnedAssignments(
  db: AppDatabaseClient,
  userId: string,
  courseIdFilter: string | null,
  assignmentIdFilter: string | null
): Promise<AssignmentOwnershipRow[]> {
  const { data: courseRows, error: courseError } = await db
    .from("classes")
    .select("id")
    .eq("teacher_id", userId);
  if (courseError) throw new HttpError(500, "Failed to load teacher courses", courseError.message);
  const ownedCourseIds = ((courseRows ?? []) as Array<{ id: string }>).map((row) => row.id);
  if (ownedCourseIds.length === 0) return [];

  let query = db
    .from("assessment_assignments")
    .select(ASSIGNMENT_SELECT)
    .in("class_id", ownedCourseIds)
    .order("created_at", { ascending: false });
  if (courseIdFilter) {
    query = query.eq("class_id", courseIdFilter);
  }
  if (assignmentIdFilter) {
    query = query.eq("id", assignmentIdFilter);
  }
  const { data, error } = await query;
  if (error) throw new HttpError(500, "Failed to load assignments", error.message);
  return ((data ?? []) as AssignmentOwnershipRow[]).filter(
    (assignment) => firstRelation(assignment.classes)?.teacher_id === userId && Boolean(firstRelation(assignment.assessments)?.id)
  );
}

async function loadAttemptById(db: AppDatabaseClient, attemptId: string): Promise<AttemptRow> {
  const { data, error } = await db
    .from("attempts")
    .select(ATTEMPT_SELECT)
    .eq("id", attemptId)
    .maybeSingle();
  if (error) throw new HttpError(500, "Failed to load attempt", error.message);
  if (!data) throw new HttpError(404, "Attempt not found");
  return data as unknown as AttemptRow;
}

async function loadProfiles(db: AppDatabaseClient, profileIds: string[]): Promise<ProfileRow[]> {
  if (profileIds.length === 0) return [];
  const { data, error } = await db
    .from("profiles")
    .select("id, display_name")
    .in("id", profileIds);
  if (error) throw new HttpError(500, "Failed to load student profiles", error.message);
  return (data ?? []) as ProfileRow[];
}

async function loadProfile(db: AppDatabaseClient, profileId: string): Promise<ProfileRow | null> {
  const { data, error } = await db
    .from("profiles")
    .select("id, display_name")
    .eq("id", profileId)
    .maybeSingle();
  if (error) throw new HttpError(500, "Failed to load student profile", error.message);
  return data as ProfileRow | null;
}

async function listAttemptArtifacts(db: AppDatabaseClient, attemptId: string): Promise<ArtifactRow[]> {
  const { data, error } = await db
    .from("attempt_artifacts")
    .select(ARTIFACT_SELECT)
    .eq("attempt_id", attemptId)
    .order("created_at", { ascending: true });
  if (error) throw new HttpError(500, "Failed to load attempt artifacts", error.message);
  return (data ?? []) as ArtifactRow[];
}

async function listAttemptRealtimeSessions(db: AppDatabaseClient, attemptId: string): Promise<RealtimeSessionRow[]> {
  const { data, error } = await db
    .from("attempt_realtime_sessions")
    .select(REALTIME_SESSION_SELECT)
    .eq("attempt_id", attemptId)
    .order("started_at", { ascending: true });
  if (error && isMissingRealtimeSchema(error)) return [];
  if (error) throw new HttpError(500, "Failed to load realtime voice sessions", error.message);
  return (data ?? []) as RealtimeSessionRow[];
}

async function listAttemptRealtimeEvents(db: AppDatabaseClient, attemptId: string): Promise<RealtimeEventRow[]> {
  const { data, error } = await db
    .from("attempt_realtime_events")
    .select(REALTIME_EVENT_SELECT)
    .eq("attempt_id", attemptId)
    .order("sequence", { ascending: true });
  if (error && isMissingRealtimeSchema(error)) return [];
  if (error) throw new HttpError(500, "Failed to load realtime voice events", error.message);
  return (data ?? []) as RealtimeEventRow[];
}

async function requireTeacherArtifact(db: AppDatabaseClient, userId: string, artifactId: string): Promise<ArtifactRow> {
  const { data, error } = await db
    .from("attempt_artifacts")
    .select(ARTIFACT_SELECT)
    .eq("id", artifactId)
    .maybeSingle();
  if (error) throw new HttpError(500, "Failed to load artifact", error.message);
  if (!data) throw new HttpError(404, "Artifact not found");
  const artifact = data as ArtifactRow;

  const attempt = await loadAttemptById(db, artifact.attempt_id);
  if (!attempt.assignment_id) throw new HttpError(403, "Artifact is not available for teacher review");
  await requireOwnedAssignment(db, userId, attempt.assignment_id);
  return artifact;
}

async function loadAttemptGradebookEntry(
  db: AppDatabaseClient,
  userId: string,
  assignmentId: string,
  courseId: string,
  studentId: string
): Promise<TeacherGradebookEntry | null> {
  const rosterStudentId = await resolveRosterStudentForAttempt(db, courseId, studentId);
  if (!rosterStudentId) return null;

  const { data, error } = await db
    .from("gradebook_entries")
    .select("id")
    .eq("assignment_id", assignmentId)
    .eq("roster_student_id", rosterStudentId)
    .maybeSingle();
  if (error) throw new HttpError(500, "Failed to load attempt gradebook entry", error.message);
  if (!data?.id) return null;
  return getTeacherGradebookEntryById(db, userId, data.id);
}

async function resolveRosterStudentForAttempt(db: AppDatabaseClient, courseId: string, studentId: string): Promise<string | null> {
  const { data: membership, error: membershipError } = await db
    .from("class_memberships")
    .select("roster_student_id")
    .eq("class_id", courseId)
    .eq("student_id", studentId)
    .maybeSingle();
  if (membershipError) throw new HttpError(500, "Failed to load attempt membership", membershipError.message);
  if (membership?.roster_student_id) return membership.roster_student_id;

  const { data: roster, error: rosterError } = await db
    .from("roster_students")
    .select("id")
    .eq("class_id", courseId)
    .eq("claimed_by", studentId)
    .maybeSingle();
  if (rosterError) throw new HttpError(500, "Failed to resolve roster student for attempt", rosterError.message);
  return (roster?.id as string | undefined) ?? null;
}

function toTeacherArtifact(row: ArtifactRow): TeacherAttemptReviewArtifact {
  const previewPath = row.upload_state === "uploaded" ? `/teacher/artifacts/${row.id}/preview` : null;
  return {
    id: row.id,
    kind: row.kind,
    mimeType: row.mime_type,
    byteSize: row.byte_size,
    originalFilename: row.original_filename,
    uploadState: row.upload_state,
    previewPath,
    downloadPath: `/teacher/artifacts/${row.id}/download`,
    ...(row.kind === "simulation-derived" ? { htmlViewport: normalizeSimulationHtmlViewport(row) } : {})
  };
}

function toTeacherRealtimeEvent(row: RealtimeEventRow): TeacherRealtimeEvent {
  return {
    id: row.id,
    sessionId: row.session_id,
    sequence: row.sequence,
    eventType: row.event_type,
    role: row.role,
    text: row.text,
    metadata: isRecord(row.metadata) ? row.metadata : {},
    createdAt: row.created_at
  };
}

function buildRealtimeTrust(sessions: RealtimeSessionRow[], events: RealtimeEventRow[]): TeacherRealtimeTrust | null {
  if (sessions.length === 0 && events.length === 0) return null;

  const eventsBySessionId = new Map<string, RealtimeEventRow[]>();
  for (const event of events) {
    const rows = eventsBySessionId.get(event.session_id) ?? [];
    rows.push(event);
    eventsBySessionId.set(event.session_id, rows);
  }

  const histories: TeacherRealtimeTrustHistory[] = sessions.map((session) =>
    buildRealtimeTrustHistory(session, eventsBySessionId.get(session.id) ?? [])
  );

  const knownSessionIds = new Set(sessions.map((row) => row.id));
  for (const [sessionId, sessionEvents] of eventsBySessionId) {
    if (knownSessionIds.has(sessionId)) continue;
    const lastEvent = sessionEvents.length > 0 ? sessionEvents[sessionEvents.length - 1] : null;
    histories.push(buildRealtimeTrustHistory({
      id: sessionId,
      attempt_id: "",
      status: "error",
      started_at: sessionEvents[0]?.created_at ?? new Date(0).toISOString(),
      ended_at: lastEvent?.created_at ?? null,
      expires_at: null,
      continuity_diagnostics: null,
      finalized_at: null,
      finalize_error: "Session row was missing for saved events"
    }, sessionEvents));
  }

  histories.sort((left, right) => left.startedAt.localeCompare(right.startedAt));
  const average = histories.reduce((total, row) => total + row.score, 0) / Math.max(1, histories.length);
  const score = clampScore(Math.round(average));
  const level: TeacherRealtimeTrust["level"] = score >= 80 ? "high" : score >= 60 ? "medium" : "low";
  const flags = unique(histories.flatMap((row) => row.flags));
  const summary = `${histories.length} session${histories.length === 1 ? "" : "s"} analyzed; trust ${level}.`;

  return { score, level, flags, summary, history: histories };
}

function buildRealtimeTrustHistory(session: RealtimeSessionRow, events: RealtimeEventRow[]): TeacherRealtimeTrustHistory {
  const ordered = [...events].sort((left, right) => left.sequence - right.sequence);
  const seen = new Set<number>();
  let duplicateCount = 0;
  for (const row of ordered) {
    if (seen.has(row.sequence)) duplicateCount += 1;
    seen.add(row.sequence);
  }

  let gapCount = 0;
  for (let index = 1; index < ordered.length; index += 1) {
    const previous = ordered[index - 1].sequence;
    const current = ordered[index].sequence;
    if (current > previous + 1) {
      gapCount += current - previous - 1;
    }
  }

  const studentTurnCount = ordered.filter((row) => row.role === "student" && typeof row.text === "string" && row.text.trim()).length;
  const assistantTurnCount = ordered.filter((row) => row.role === "assistant" && typeof row.text === "string" && row.text.trim()).length;
  const statusTurnCount = ordered.filter((row) => row.role === "status").length;

  const diagnostics = isRecord(session.continuity_diagnostics) ? session.continuity_diagnostics : {};
  const diagnosticsGapCount = toNonNegativeInt(diagnostics.gapCount);
  const diagnosticsDuplicateCount = toNonNegativeInt(diagnostics.duplicateCount);
  const persistedFlags = Array.isArray(diagnostics.flags)
    ? diagnostics.flags.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    : [];

  gapCount = Math.max(gapCount, diagnosticsGapCount);
  duplicateCount = Math.max(duplicateCount, diagnosticsDuplicateCount);

  const flags: string[] = [...persistedFlags];
  if (session.status === "error") flags.push("session_error");
  if (session.finalize_error) flags.push("finalize_error");
  if (gapCount > 0) flags.push("sequence_gaps");
  if (duplicateCount > 0) flags.push("duplicate_sequences");
  if (studentTurnCount === 0) flags.push("no_student_turns");
  if (assistantTurnCount === 0) flags.push("no_assistant_turns");
  if (ordered.length === 0) flags.push("no_events");

  let score = 100;
  if (session.status === "error") score -= 35;
  if (session.status === "finalizing") score -= 20;
  if (ordered.length === 0) score -= 30;
  if (studentTurnCount === 0) score -= 25;
  if (assistantTurnCount === 0) score -= 10;
  score -= Math.min(20, gapCount * 2);
  score -= Math.min(12, duplicateCount * 2);
  if (session.finalize_error) score -= 10;
  score = clampScore(score);

  return {
    sessionId: session.id,
    status: session.status,
    startedAt: session.started_at,
    endedAt: session.ended_at,
    expiresAt: session.expires_at,
    eventCount: ordered.length,
    studentTurnCount,
    assistantTurnCount,
    statusTurnCount,
    gapCount,
    duplicateCount,
    flags: unique(flags),
    score
  };
}

function toReviewAssessmentSummary(row: AssessmentRow, dueAt: string | null): GradingAssessment {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    prompt: row.prompt,
    expectedAnswer: row.expected_answer,
    rubric: coerceRubric(row.rubric),
    config: isRecord(row.config) ? row.config : {},
    dueAt
  };
}

function feedbackFromUnknown(value: unknown): GradeFeedback | null {
  if (!isRecord(value)) return null;
  if (typeof value.score !== "number") return null;
  if (!Array.isArray(value.criteria) || typeof value.overallComment !== "string" || typeof value.confidence !== "string") {
    return null;
  }
  return value as GradeFeedback;
}

function reviewFlagsFromFeedback(value: unknown): string[] {
  if (!isRecord(value) || !Array.isArray(value.reviewFlags)) return [];
  return value.reviewFlags.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function reviewFlagsForAttempt(attempt: Pick<AttemptRow, "provisional_feedback" | "submitted_after_due">): string[] {
  const flags = reviewFlagsFromFeedback(attempt.provisional_feedback);
  if (attempt.submitted_after_due) flags.push("late");
  return unique(flags);
}

function toSimulationSpec(value: unknown): SimulationSpec | null {
  if (!isRecord(value)) return null;
  return value as SimulationSpec;
}

function parseAttemptStatusFilter(value: string | null): AttemptStatus | null {
  if (!value) return null;
  if (value === "draft" || value === "submitted" || value === "graded" || value === "error") {
    return value;
  }
  throw new HttpError(400, "status must be one of: draft, submitted, graded, error");
}

function nonEmpty(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}

function toNonNegativeInt(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  return Math.floor(value);
}

function clampScore(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function firstRelation<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function coerceRubric(value: unknown): RubricCriterion[] {
  if (!Array.isArray(value)) return [];
  const rows: RubricCriterion[] = [];
  for (const item of value) {
    if (!isRecord(item)) continue;
    const name = typeof item.name === "string" ? item.name : "";
    const description = typeof item.description === "string" ? item.description : "";
    const maxPoints = typeof item.maxPoints === "number" ? item.maxPoints : 0;
    if (!name || !description || maxPoints <= 0) continue;
    rows.push({ name, description, maxPoints });
  }
  return rows;
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null;
}

function isMissingRealtimeSchema(error: { code?: string; message?: string; details?: string; hint?: string }): boolean {
  const text = `${error.code ?? ""} ${error.message ?? ""} ${error.details ?? ""} ${error.hint ?? ""}`.toLowerCase();
  return (
    text.includes("attempt_realtime_events")
    || text.includes("attempt_realtime_sessions")
    || text.includes("42703")
    || text.includes("42p01")
    || text.includes("pgrst204")
  );
}
