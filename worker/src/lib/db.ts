import type { AppDatabaseClient } from "./database";
import { toJson } from "./database";
import type {
  AssessmentSummary,
  GradeFeedback,
  GradingAssessment,
  RubricCriterion,
  StudentAssignmentSummary,
  StudentAssignmentState,
  StudentAttemptSummary,
  StudentCourseAssignments,
  StudentDueState,
  StudentPublishedGrade
} from "@alt-assessment/shared";
import { HttpError } from "./http";

const DUE_SOON_WINDOW_MS = 48 * 60 * 60 * 1000;

export interface AssessmentRecord {
  id: string;
  type: "voice" | "voice_realtime" | "writing" | "simulation";
  title: string;
  prompt: string;
  expected_answer: string | null;
  rubric: RubricCriterion[] | null;
  config: Record<string, unknown> | null;
  archived_at?: string | null;
}

export interface AttemptRecord {
  id: string;
  assignment_id: string | null;
  assessment_id: string | null;
  student_id: string;
  status: string;
  provisional_score: number | null;
  provisional_feedback: unknown | null;
  transcript: string | null;
  ocr_text: string | null;
  simulation_description: string | null;
  simulation_spec: unknown | null;
  submitted_at: string | null;
  submitted_after_due?: boolean;
  assessment_version_id?: string;
}

export interface ArtifactRecord {
  id: string;
  attempt_id: string;
  student_id: string;
  kind: "audio" | "writing" | "simulation-derived" | "simulation-sketch";
  bucket: string;
  storage_key: string;
  mime_type: string;
  byte_size: number;
  original_filename: string;
  openai_file_id: string | null;
  source_description_sha256?: string | null;
  simulation_html_viewport_width?: number | null;
  simulation_html_viewport_height?: number | null;
  content_sha256?: string | null;
  frozen_at?: string | null;
  upload_state: "pending" | "uploaded" | "processed" | "deleted";
}

interface AssignmentRow {
  id: string;
  class_id: string;
  opens_at: string | null;
  due_at: string | null;
  archived_at?: string | null;
  assessments: AssessmentRecord | null;
  classes: {
    code: string;
    name: string;
  } | null;
}

interface VisibleAssignmentRow extends AssignmentRow {
  assessments: AssessmentRecord;
  classes: {
    code: string;
    name: string;
  };
}

interface GradebookPublishedRow {
  assignment_id: string;
  roster_student_id: string;
  published_at: string | null;
  approved_score: number | null;
  approved_feedback: unknown;
  teacher_override_score: number | null;
  missing: boolean;
}

interface AttemptJoinRow extends AttemptRecord {
  assessment_versions?: { definition: AssessmentRecord; legacy_capture: boolean } | null;
  assessments: AssessmentRecord | null;
  assessment_assignments: AssignmentRow | null;
}

interface AssignmentLatestAttemptRow {
  id: string;
  assignment_id: string | null;
  status: "draft" | "submitted" | "graded" | "error";
  submitted_at: string | null;
  provisional_score: number | null;
  submitted_after_due?: boolean | null;
  created_at: string | null;
}

export function toAssessmentSummary(record: AssessmentRecord & { due_at?: string | null }): AssessmentSummary {
  return {
    id: record.id,
    type: record.type,
    title: record.title,
    prompt: record.prompt,
    rubric: record.rubric ?? [],
    config: record.config ?? {},
    dueAt: record.due_at ?? null
  };
}

/** Only trusted Worker grading/teacher paths receive this contract. */
export function toGradingAssessment(record: AssessmentRecord & { due_at?: string | null }): GradingAssessment {
  return { ...toAssessmentSummary(record), expectedAnswer: record.expected_answer ?? null };
}

/** Whitelist fields even when the input came from an internal grading path. */
export function studentAssessment(assessment: AssessmentSummary): AssessmentSummary {
  return {
    id: assessment.id, type: assessment.type, title: assessment.title,
    prompt: assessment.prompt, rubric: assessment.rubric, config: assessment.config,
    dueAt: assessment.dueAt
  };
}

export async function listStudentCourseAssignments(db: AppDatabaseClient, userId: string): Promise<StudentCourseAssignments[]> {
  const classIds = await classIdsForUser(db, userId);
  if (classIds.length === 0) return [];
  const nowMs = Date.now();

  const { data, error } = await db
    .from("assessment_assignments")
    .select("id, class_id, opens_at, due_at, archived_at, classes(code,name), assessments(id,type,title,prompt,expected_answer,rubric,config,archived_at)")
    .in("class_id", classIds);

  if (error) throw new HttpError(500, "Failed to load assigned assessments", error.message);

  const visibleAssignments: VisibleAssignmentRow[] = [];
  for (const row of (data ?? []) as unknown as AssignmentRow[]) {
    if (row.archived_at) continue;
    if (row.opens_at && parseTimestampMs(row.opens_at) > nowMs) continue;
    const assessment = row.assessments;
    const course = row.classes;
    if (!assessment?.id || !course) continue;
    if (assessment.archived_at) continue;
    visibleAssignments.push({
      ...row,
      assessments: assessment,
      classes: course
    });
  }

  const publishedGradeByAssignmentId = await loadPublishedGradeByAssignmentId(db, userId, visibleAssignments);
  const latestAttemptByAssignmentId = await loadLatestAttemptByAssignmentId(db, userId, visibleAssignments);
  const grouped = new Map<string, StudentCourseAssignments>();
  for (const row of visibleAssignments) {
    const existing = grouped.get(row.class_id) ?? {
      classId: row.class_id,
      classCode: row.classes.code,
      className: row.classes.name,
      assignments: []
    };
    const publishedGrade = publishedGradeByAssignmentId.get(row.id) ?? null;
    const latestAttempt = latestAttemptByAssignmentId.get(row.id) ?? null;
    const state = toStudentAssignmentState(publishedGrade, latestAttempt);
    const dueState = toStudentDueState({
      nowMs,
      dueAt: row.due_at ?? null,
      state,
      latestAttempt
    });

    existing.assignments.push({
      assignmentId: row.id,
      classId: row.class_id,
      classCode: row.classes.code,
      className: row.classes.name,
      opensAt: row.opens_at ?? null,
      dueAt: row.due_at ?? null,
      state,
      dueState,
      latestAttempt,
      publishedGrade,
      assessment: toAssessmentSummary({ ...row.assessments, due_at: row.due_at })
    });
    grouped.set(row.class_id, existing);
  }

  const courses = Array.from(grouped.values());
  for (const course of courses) {
    course.assignments.sort((a, b) => {
      const left = a.dueAt ?? "";
      const right = b.dueAt ?? "";
      if (left && right) return left.localeCompare(right);
      if (left) return -1;
      if (right) return 1;
      return a.assessment.title.localeCompare(b.assessment.title);
    });
  }
  courses.sort((a, b) => a.classCode.localeCompare(b.classCode));
  return courses;
}

async function loadLatestAttemptByAssignmentId(
  db: AppDatabaseClient,
  userId: string,
  assignments: VisibleAssignmentRow[]
): Promise<Map<string, StudentAttemptSummary>> {
  if (assignments.length === 0) return new Map();
  const assignmentIds = unique(assignments.map((row) => row.id));
  const initial = await db
    .from("attempts")
    .select("id, assignment_id, status, submitted_at, provisional_score, submitted_after_due, created_at")
    .eq("student_id", userId)
    .in("assignment_id", assignmentIds);
  let data = initial.data as AssignmentLatestAttemptRow[] | null;
  if (initial.error) {
    if (!isMissingSubmittedAfterDueColumn(initial.error)) {
      throw new HttpError(500, "Failed to load assignment attempts", initial.error.message);
    }
    const fallback = await db
      .from("attempts")
      .select("id, assignment_id, status, submitted_at, provisional_score, created_at")
      .eq("student_id", userId)
      .in("assignment_id", assignmentIds);
    if (fallback.error) throw new HttpError(500, "Failed to load assignment attempts", fallback.error.message);
    data = (fallback.data ?? []) as AssignmentLatestAttemptRow[];
  }

  const latestByAssignmentId = new Map<string, AssignmentLatestAttemptRow>();
  for (const row of (data ?? []) as AssignmentLatestAttemptRow[]) {
    if (!row.assignment_id) continue;
    const current = latestByAssignmentId.get(row.assignment_id);
    if (!current || compareAttemptRecency(row, current) > 0) {
      latestByAssignmentId.set(row.assignment_id, row);
    }
  }

  const projected = new Map<string, StudentAttemptSummary>();
  for (const [assignmentId, row] of latestByAssignmentId) {
    projected.set(assignmentId, {
      attemptId: row.id,
      status: row.status,
      submittedAt: row.submitted_at,
      provisionalScore: row.provisional_score,
      submittedAfterDue: row.submitted_after_due === true
    });
  }
  return projected;
}

async function loadPublishedGradeByAssignmentId(
  db: AppDatabaseClient,
  userId: string,
  assignments: VisibleAssignmentRow[]
): Promise<Map<string, StudentPublishedGrade>> {
  if (assignments.length === 0) return new Map();

  const classIds = unique(assignments.map((row) => row.class_id));
  const rosterByClassId = await resolveRosterStudentIdsForClasses(db, userId, classIds);
  if (rosterByClassId.size === 0) return new Map();

  const rosterStudentIds = unique(Array.from(rosterByClassId.values()).filter((value): value is string => typeof value === "string" && value.length > 0));
  if (rosterStudentIds.length === 0) return new Map();

  const assignmentIds = unique(assignments.map((row) => row.id));
  const assignmentClassById = new Map(assignments.map((row) => [row.id, row.class_id]));

  const { data, error } = await db
    .from("gradebook_entries")
    .select("assignment_id, roster_student_id, published_at, approved_score, approved_feedback, teacher_override_score, missing")
    .in("assignment_id", assignmentIds)
    .in("roster_student_id", rosterStudentIds);
  if (error) throw new HttpError(500, "Failed to load published final grades", error.message);

  const publishedByAssignmentId = new Map<string, StudentPublishedGrade>();
  for (const row of (data ?? []) as GradebookPublishedRow[]) {
    const classId = assignmentClassById.get(row.assignment_id);
    if (!classId) continue;
    const rosterStudentId = rosterByClassId.get(classId);
    if (!rosterStudentId || rosterStudentId !== row.roster_student_id) continue;

    const published = toStudentPublishedGrade(row);
    if (!published) continue;

    const current = publishedByAssignmentId.get(row.assignment_id);
    if (!current || current.publishedAt.localeCompare(published.publishedAt) < 0) {
      publishedByAssignmentId.set(row.assignment_id, published);
    }
  }

  return publishedByAssignmentId;
}

async function resolveRosterStudentIdsForClasses(
  db: AppDatabaseClient,
  userId: string,
  classIds: string[]
): Promise<Map<string, string>> {
  if (classIds.length === 0) return new Map();

  const byClassId = new Map<string, string>();

  const { data: memberships, error: membershipsError } = await db
    .from("class_memberships")
    .select("class_id, roster_student_id")
    .eq("student_id", userId)
    .in("class_id", classIds);
  if (membershipsError) throw new HttpError(500, "Failed to load class memberships", membershipsError.message);

  for (const row of (memberships ?? []) as Array<{ class_id: string; roster_student_id: string | null }>) {
    if (row.roster_student_id) byClassId.set(row.class_id, row.roster_student_id);
  }

  const unresolvedClassIds = classIds.filter((classId) => !byClassId.has(classId));
  if (unresolvedClassIds.length === 0) return byClassId;

  const { data: rosterStudents, error: rosterError } = await db
    .from("roster_students")
    .select("id, class_id")
    .eq("claimed_by", userId)
    .in("class_id", unresolvedClassIds);
  if (rosterError) throw new HttpError(500, "Failed to resolve roster students", rosterError.message);

  for (const row of (rosterStudents ?? []) as Array<{ id: string; class_id: string }>) {
    if (!byClassId.has(row.class_id)) {
      byClassId.set(row.class_id, row.id);
    }
  }

  return byClassId;
}

function toStudentPublishedGrade(row: GradebookPublishedRow): StudentPublishedGrade | null {
  if (!row.published_at) return null;
  if (isFiniteNumber(row.teacher_override_score)) {
    return {
      finalScore: row.teacher_override_score,
      finalStatus: "teacher_override",
      publishedAt: row.published_at
    };
  }

  if (isFiniteNumber(row.approved_score)) {
    return {
      finalScore: row.approved_score,
      finalStatus: "approved_ai",
      publishedAt: row.published_at,
      feedback: toGradeFeedback(row.approved_feedback)
    };
  }

  if (row.missing) {
    return {
      finalScore: null,
      finalStatus: "missing",
      publishedAt: row.published_at
    };
  }

  // Defensive compatibility: ignore historical blank-published gradebook rows.
  return null;
}

function toStudentAssignmentState(
  publishedGrade: StudentPublishedGrade | null,
  latestAttempt: StudentAttemptSummary | null
): StudentAssignmentState {
  if (publishedGrade) return "final_published";
  if (!latestAttempt) return "not_started";
  if (latestAttempt.status === "draft") return "draft";
  if (latestAttempt.status === "error") return "error_retry";
  if (latestAttempt.status === "submitted") return "submitted";
  return "provisional_ready";
}

function toStudentDueState(input: {
  nowMs: number;
  dueAt: string | null;
  state: StudentAssignmentState;
  latestAttempt: StudentAttemptSummary | null;
}): StudentDueState {
  if (input.latestAttempt?.submittedAfterDue) {
    return "late_submitted";
  }
  if (!input.dueAt) {
    return "none";
  }
  if (input.state === "final_published" || input.state === "submitted" || input.state === "provisional_ready") {
    return "none";
  }

  const dueMs = Date.parse(input.dueAt);
  if (!Number.isFinite(dueMs)) return "none";
  if (dueMs <= input.nowMs) return "overdue";
  if (dueMs - input.nowMs <= DUE_SOON_WINDOW_MS) return "due_soon";
  return "none";
}

export async function classIdsForUser(db: AppDatabaseClient, userId: string): Promise<string[]> {
  const { data, error } = await db
    .from("class_memberships")
    .select("class_id")
    .eq("student_id", userId);
  if (error) throw new HttpError(500, "Failed to load class memberships", error.message);
  return (data ?? []).map((row: any) => row.class_id);
}

export async function requireAssignedAssignment(db: AppDatabaseClient, userId: string, assignmentId: string): Promise<StudentAssignmentSummary> {
  const classIds = await classIdsForUser(db, userId);
  if (classIds.length === 0) throw new HttpError(403, "No class membership found for student");

  const { data, error } = await db
    .from("assessment_assignments")
    .select("id, class_id, opens_at, due_at, archived_at, classes(code,name), assessments(id,type,title,prompt,expected_answer,rubric,config,archived_at)")
    .eq("id", assignmentId)
    .in("class_id", classIds)
    .maybeSingle();

  if (error) throw new HttpError(500, "Failed to verify assignment access", error.message);
  const row = data as unknown as AssignmentRow | null;
  if (!row?.assessments?.id || !row.classes) {
    throw new HttpError(403, "Assignment is not available to this student");
  }
  if (row.archived_at) {
    throw new HttpError(403, "Assignment is not available to this student");
  }
  if (row.assessments.archived_at) {
    throw new HttpError(403, "Assignment is not available to this student");
  }

  if (row.opens_at && new Date(row.opens_at).getTime() > Date.now()) {
    throw new HttpError(403, "Assignment is not open yet");
  }

  return {
    assignmentId: row.id,
    classId: row.class_id,
    classCode: row.classes.code,
    className: row.classes.name,
    opensAt: row.opens_at ?? null,
    dueAt: row.due_at ?? null,
    assessment: toAssessmentSummary({ ...row.assessments, due_at: row.due_at })
  };
}

export async function requireAttempt(db: AppDatabaseClient, userId: string, attemptId: string): Promise<{ attempt: AttemptRecord; assessment: GradingAssessment }> {
  const { data, error } = await db
    .from("attempts")
    .select("*, assessment_versions(definition,legacy_capture), assessments(id,type,title,prompt,expected_answer,rubric,config), assessment_assignments(id,class_id,due_at,opens_at,classes(code,name),assessments(id,type,title,prompt,expected_answer,rubric,config))")
    .eq("id", attemptId)
    .eq("student_id", userId)
    .maybeSingle();

  if (error) throw new HttpError(500, "Failed to load attempt", error.message);
  if (!data) throw new HttpError(404, "Attempt not found");

  const row = data as unknown as AttemptJoinRow;
  const resolvedAssessment = row.assessment_versions?.definition;
  if (!resolvedAssessment?.id) {
    throw new HttpError(500, "Attempt is missing its frozen assessment definition");
  }

  return {
    attempt: row,
    assessment: toGradingAssessment({
      ...resolvedAssessment,
      due_at: row.assessment_assignments?.due_at ?? null
    })
  };
}

export async function requireArtifact(db: AppDatabaseClient, userId: string, artifactId: string, attemptId?: string): Promise<ArtifactRecord> {
  let query = db
    .from("attempt_artifacts")
    .select("*")
    .eq("id", artifactId)
    .eq("student_id", userId);
  if (attemptId) query = query.eq("attempt_id", attemptId);

  const { data, error } = await query.maybeSingle();
  if (error) throw new HttpError(500, "Failed to load artifact", error.message);
  if (!data) throw new HttpError(404, "Artifact not found");
  return data as ArtifactRecord;
}

export async function logAudit(db: AppDatabaseClient, payload: {
  attemptId: string;
  route: string;
  provider: string;
  model: string;
  requestSummary?: unknown;
  rawResponse?: unknown;
  error?: string;
}): Promise<void> {
  const { error } = await db.from("attempt_audit_logs").insert({
    attempt_id: payload.attemptId,
    route: payload.route,
    provider: payload.provider,
    model: payload.model,
    request_summary: toJson(payload.requestSummary ?? null),
    raw_response: toJson(payload.rawResponse ?? null),
    error: payload.error ?? null
  });
  if (error) throw new HttpError(500, "Failed to record assessment audit", error.message);
}

export function toGradeFeedback(value: unknown): GradeFeedback | null {
  if (!isRecord(value)) return null;
  if (!isFiniteNumber(value.score)) return null;
  if (typeof value.overallComment !== "string") return null;
  if (value.confidence !== "low" && value.confidence !== "medium" && value.confidence !== "high") return null;
  if (!Array.isArray(value.criteria) || !Array.isArray(value.reviewFlags)) return null;

  for (const criterion of value.criteria) {
    if (!isRecord(criterion)) return null;
    if (typeof criterion.name !== "string") return null;
    if (!isFiniteNumber(criterion.score) || !isFiniteNumber(criterion.maxPoints)) return null;
    if (typeof criterion.comment !== "string") return null;
  }

  for (const flag of value.reviewFlags) {
    if (typeof flag !== "string") return null;
  }

  return {
    score: value.score, overallComment: value.overallComment, confidence: value.confidence,
    criteria: value.criteria.map((entry) => ({
      ...(typeof entry.id === "string" ? { id: entry.id } : {}), name: entry.name,
      score: entry.score, maxPoints: entry.maxPoints, comment: entry.comment
    })), reviewFlags: value.reviewFlags as string[],
    ...(typeof value.policyVersion === "string" ? { policyVersion: value.policyVersion } : {}),
    ...(Array.isArray(value.appliedCaps) ? { appliedCaps: value.appliedCaps.filter((cap) => isRecord(cap) && typeof cap.id === "string" && typeof cap.reason === "string").map((cap) => ({ id: cap.id, reason: cap.reason })) } : {})
  };
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}

function compareAttemptRecency(left: AssignmentLatestAttemptRow, right: AssignmentLatestAttemptRow): number {
  const leftCreatedAt = parseTimestampMs(left.created_at);
  const rightCreatedAt = parseTimestampMs(right.created_at);
  if (leftCreatedAt !== rightCreatedAt) {
    return leftCreatedAt - rightCreatedAt;
  }
  return left.id.localeCompare(right.id);
}

function parseTimestampMs(value: string | null): number {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function isMissingSubmittedAfterDueColumn(error: { code?: string; message?: string; details?: string; hint?: string }): boolean {
  const text = `${error.code ?? ""} ${error.message ?? ""} ${error.details ?? ""} ${error.hint ?? ""}`.toLowerCase();
  return text.includes("submitted_after_due") || text.includes("42703") || text.includes("pgrst204");
}
