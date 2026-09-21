import {
  DEFAULT_REALTIME_VOICE_MAX_SESSION_SEC,
  DEFAULT_SIMULATION_CODE_MODEL_ID,
  DEFAULT_SIMULATION_MIN_DESCRIPTION_CHARS,
  DEFAULT_VOICE_MAX_RECORDING_SEC,
  DEFAULT_WRITING_ACCEPTED_MIME,
  DEFAULT_WRITING_MAX_BYTES,
  type AssessmentType,
  type RubricCriterion,
  type TeacherAssessment,
  type TeacherAssessmentsResponse,
  type TeacherAssignment,
  type TeacherAssignmentsResponse,
  isSimulationCodeModelId
} from "@alt-assessment/shared";
import type { SupabaseClient } from "@supabase/supabase-js";
import { HttpError, getRequiredString, readJson } from "../lib/http";
import { requireTeacherProfile } from "./teacher";
import { reconcileGradebookForCourse } from "./teacherGradebook";

interface AssessmentRow {
  id: string;
  type: AssessmentType;
  title: string;
  prompt: string;
  expected_answer: string | null;
  rubric: unknown;
  config: unknown;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}

interface AssignmentRow {
  id: string;
  assessment_id: string;
  class_id: string;
  opens_at: string | null;
  due_at: string | null;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}

interface CourseRow {
  id: string;
  code: string;
  name: string;
  archived_at: string | null;
}

const ASSESSMENT_SELECT = "id, type, title, prompt, expected_answer, rubric, config, created_by, created_at, updated_at, archived_at";
const ASSIGNMENT_SELECT = "id, assessment_id, class_id, opens_at, due_at, created_at, updated_at, archived_at";
const COURSE_SELECT = "id, code, name, archived_at";

export async function listTeacherAssessments(db: SupabaseClient, userId: string, includeArchived: boolean): Promise<TeacherAssessmentsResponse> {
  await requireTeacherProfile(db, userId);
  let query = db
    .from("assessments")
    .select(ASSESSMENT_SELECT)
    .eq("created_by", userId)
    .order("created_at", { ascending: false });
  if (!includeArchived) query = query.is("archived_at", null);

  const { data, error } = await query;
  if (error) throw new HttpError(500, "Failed to load assessments", error.message);
  return { assessments: ((data ?? []) as AssessmentRow[]).map(toTeacherAssessment) };
}

export async function createTeacherAssessment(request: Request, db: SupabaseClient, userId: string): Promise<{ assessment: TeacherAssessment }> {
  await requireTeacherProfile(db, userId);
  const body = await readJson<Record<string, unknown>>(request);
  const type = parseAssessmentType(body.type);
  const title = getRequiredString(body, "title");
  const prompt = getRequiredString(body, "prompt");
  const expectedAnswer = getNullableString(body, "expectedAnswer");
  const rubric = parseRubric(body.rubric);
  const config = parseAssessmentConfig(type, body.config);
  const now = new Date().toISOString();

  const { data, error } = await db
    .from("assessments")
    .insert({
      type,
      title,
      prompt,
      expected_answer: expectedAnswer,
      rubric,
      config,
      created_by: userId,
      updated_at: now
    })
    .select(ASSESSMENT_SELECT)
    .single();
  if (error) throw new HttpError(500, "Failed to create assessment", error.message);
  return { assessment: toTeacherAssessment(data as AssessmentRow) };
}

export async function updateTeacherAssessment(
  request: Request,
  db: SupabaseClient,
  userId: string,
  assessmentId: string
): Promise<{ assessment: TeacherAssessment }> {
  await requireTeacherProfile(db, userId);
  const current = await requireOwnedAssessment(db, userId, assessmentId);
  const body = await readJson<Record<string, unknown>>(request);
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };

  const type = "type" in body ? parseAssessmentType(body.type) : current.type;
  if ("type" in body) patch.type = type;
  if ("title" in body) patch.title = getRequiredString(body, "title");
  if ("prompt" in body) patch.prompt = getRequiredString(body, "prompt");
  if ("expectedAnswer" in body) patch.expected_answer = getNullableString(body, "expectedAnswer");
  if ("rubric" in body) patch.rubric = parseRubric(body.rubric);
  if ("config" in body) {
    patch.config = parseAssessmentConfig(type, body.config);
  } else if ("type" in body) {
    patch.config = parseAssessmentConfig(type, current.config);
  }

  const { data, error } = await db
    .from("assessments")
    .update(patch)
    .eq("id", assessmentId)
    .eq("created_by", userId)
    .select(ASSESSMENT_SELECT)
    .maybeSingle();
  if (error) throw new HttpError(500, "Failed to update assessment", error.message);
  if (!data) throw new HttpError(404, "Assessment not found");
  return { assessment: toTeacherAssessment(data as AssessmentRow) };
}

export async function setTeacherAssessmentArchived(
  db: SupabaseClient,
  userId: string,
  assessmentId: string,
  archived: boolean
): Promise<{ assessment: TeacherAssessment }> {
  await requireTeacherProfile(db, userId);
  const now = new Date().toISOString();
  const { data, error } = await db
    .from("assessments")
    .update({ archived_at: archived ? now : null, updated_at: now })
    .eq("id", assessmentId)
    .eq("created_by", userId)
    .select(ASSESSMENT_SELECT)
    .maybeSingle();
  if (error) throw new HttpError(500, archived ? "Failed to archive assessment" : "Failed to unarchive assessment", error.message);
  if (!data) throw new HttpError(404, "Assessment not found");
  return { assessment: toTeacherAssessment(data as AssessmentRow) };
}

export async function listTeacherAssignments(
  db: SupabaseClient,
  userId: string,
  includeArchived: boolean,
  courseId?: string
): Promise<TeacherAssignmentsResponse> {
  await requireTeacherProfile(db, userId);
  const ownedCourses = await listOwnedCourses(db, userId);
  const ownedCourseIds = ownedCourses.map((row) => row.id);
  if (ownedCourseIds.length === 0) return { assignments: [] };

  if (courseId && !ownedCourseIds.includes(courseId)) {
    throw new HttpError(404, "Course not found");
  }

  const ownedAssessments = await listOwnedAssessments(db, userId, true);
  const ownedAssessmentIds = ownedAssessments.map((row) => row.id);
  if (ownedAssessmentIds.length === 0) return { assignments: [] };

  let query = db
    .from("assessment_assignments")
    .select(ASSIGNMENT_SELECT)
    .in("class_id", courseId ? [courseId] : ownedCourseIds)
    .in("assessment_id", ownedAssessmentIds)
    .order("created_at", { ascending: false });
  if (!includeArchived) query = query.is("archived_at", null);

  const { data, error } = await query;
  if (error) throw new HttpError(500, "Failed to load assignments", error.message);

  const assessmentMap = new Map(ownedAssessments.map((row) => [row.id, row]));
  const courseMap = new Map(ownedCourses.map((row) => [row.id, row]));
  return {
    assignments: ((data ?? []) as AssignmentRow[])
      .map((row) => toTeacherAssignment(row, courseMap.get(row.class_id), assessmentMap.get(row.assessment_id)))
      .filter((row): row is TeacherAssignment => row !== null)
  };
}

export async function createTeacherAssignment(
  request: Request,
  db: SupabaseClient,
  userId: string
): Promise<{ assignment: TeacherAssignment }> {
  await requireTeacherProfile(db, userId);
  const body = await readJson<Record<string, unknown>>(request);
  const assessmentId = getRequiredString(body, "assessmentId");
  const courseId = getRequiredString(body, "courseId");
  const opensAt = parseNullableDateString(body.opensAt, "opensAt");
  const dueAt = parseNullableDateString(body.dueAt, "dueAt");
  validateAssignmentDateOrder(opensAt, dueAt);
  const now = new Date().toISOString();

  const assessment = await requireOwnedAssessment(db, userId, assessmentId);
  if (assessment.archived_at) {
    throw new HttpError(409, "Cannot assign an archived assessment");
  }
  const course = await requireOwnedCourse(db, userId, courseId);
  if (course.archived_at) {
    throw new HttpError(409, "Cannot assign to an archived course");
  }

  const { data, error } = await db
    .from("assessment_assignments")
    .insert({
      assessment_id: assessmentId,
      class_id: courseId,
      opens_at: opensAt,
      due_at: dueAt,
      updated_at: now,
      archived_at: null
    })
    .select(ASSIGNMENT_SELECT)
    .single();
  if (error) {
    if (isDuplicateAssignmentError(error)) {
      throw new HttpError(409, "An active assignment already exists for this course and assessment");
    }
    throw new HttpError(500, "Failed to create assignment", error.message);
  }

  const assignment = toTeacherAssignment(data as AssignmentRow, course, assessment);
  if (!assignment) throw new HttpError(500, "Failed to resolve assignment details");
  await reconcileGradebookForCourse(db, userId, courseId);
  return { assignment };
}

export async function updateTeacherAssignment(
  request: Request,
  db: SupabaseClient,
  userId: string,
  assignmentId: string
): Promise<{ assignment: TeacherAssignment }> {
  await requireTeacherProfile(db, userId);
  const current = await requireOwnedAssignment(db, userId, assignmentId);
  const body = await readJson<Record<string, unknown>>(request);
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };

  let nextAssessmentId = current.assessment_id;
  if ("assessmentId" in body) {
    nextAssessmentId = getRequiredString(body, "assessmentId");
    const assessment = await requireOwnedAssessment(db, userId, nextAssessmentId);
    if (assessment.archived_at) {
      throw new HttpError(409, "Cannot assign an archived assessment");
    }
    patch.assessment_id = nextAssessmentId;
  }

  let nextCourseId = current.class_id;
  if ("courseId" in body) {
    nextCourseId = getRequiredString(body, "courseId");
    const course = await requireOwnedCourse(db, userId, nextCourseId);
    if (course.archived_at) {
      throw new HttpError(409, "Cannot assign to an archived course");
    }
    patch.class_id = nextCourseId;
  }

  const opensAt = "opensAt" in body ? parseNullableDateString(body.opensAt, "opensAt") : current.opens_at;
  const dueAt = "dueAt" in body ? parseNullableDateString(body.dueAt, "dueAt") : current.due_at;
  validateAssignmentDateOrder(opensAt, dueAt);
  if ("opensAt" in body) patch.opens_at = opensAt;
  if ("dueAt" in body) patch.due_at = dueAt;

  const { data, error } = await db
    .from("assessment_assignments")
    .update(patch)
    .eq("id", assignmentId)
    .eq("class_id", current.class_id)
    .eq("assessment_id", current.assessment_id)
    .select(ASSIGNMENT_SELECT)
    .maybeSingle();
  if (error) {
    if (isDuplicateAssignmentError(error)) {
      throw new HttpError(409, "An active assignment already exists for this course and assessment");
    }
    throw new HttpError(500, "Failed to update assignment", error.message);
  }
  if (!data) throw new HttpError(404, "Assignment not found");

  const course = await requireOwnedCourse(db, userId, nextCourseId);
  const assessment = await requireOwnedAssessment(db, userId, nextAssessmentId);
  const assignment = toTeacherAssignment(data as AssignmentRow, course, assessment);
  if (!assignment) throw new HttpError(500, "Failed to resolve assignment details");
  await reconcileGradebookForCourse(db, userId, current.class_id);
  if (nextCourseId !== current.class_id) {
    await reconcileGradebookForCourse(db, userId, nextCourseId);
  }
  return { assignment };
}

export async function setTeacherAssignmentArchived(
  db: SupabaseClient,
  userId: string,
  assignmentId: string,
  archived: boolean
): Promise<{ assignment: TeacherAssignment }> {
  await requireTeacherProfile(db, userId);
  const current = await requireOwnedAssignment(db, userId, assignmentId);
  const now = new Date().toISOString();

  const { data, error } = await db
    .from("assessment_assignments")
    .update({ archived_at: archived ? now : null, updated_at: now })
    .eq("id", assignmentId)
    .eq("class_id", current.class_id)
    .eq("assessment_id", current.assessment_id)
    .select(ASSIGNMENT_SELECT)
    .maybeSingle();
  if (error) {
    if (isDuplicateAssignmentError(error)) {
      throw new HttpError(409, "An active assignment already exists for this course and assessment");
    }
    throw new HttpError(500, archived ? "Failed to archive assignment" : "Failed to unarchive assignment", error.message);
  }
  if (!data) throw new HttpError(404, "Assignment not found");

  const course = await requireOwnedCourse(db, userId, current.class_id);
  const assessment = await requireOwnedAssessment(db, userId, current.assessment_id);
  const assignment = toTeacherAssignment(data as AssignmentRow, course, assessment);
  if (!assignment) throw new HttpError(500, "Failed to resolve assignment details");
  await reconcileGradebookForCourse(db, userId, current.class_id);
  return { assignment };
}

export function archiveTeacherAssessment(db: SupabaseClient, userId: string, assessmentId: string) {
  return setTeacherAssessmentArchived(db, userId, assessmentId, true);
}

export function unarchiveTeacherAssessment(db: SupabaseClient, userId: string, assessmentId: string) {
  return setTeacherAssessmentArchived(db, userId, assessmentId, false);
}

export function archiveTeacherAssignment(db: SupabaseClient, userId: string, assignmentId: string) {
  return setTeacherAssignmentArchived(db, userId, assignmentId, true);
}

export function unarchiveTeacherAssignment(db: SupabaseClient, userId: string, assignmentId: string) {
  return setTeacherAssignmentArchived(db, userId, assignmentId, false);
}

async function requireOwnedAssessment(db: SupabaseClient, userId: string, assessmentId: string): Promise<AssessmentRow> {
  const { data, error } = await db
    .from("assessments")
    .select(ASSESSMENT_SELECT)
    .eq("id", assessmentId)
    .eq("created_by", userId)
    .maybeSingle();
  if (error) throw new HttpError(500, "Failed to load assessment", error.message);
  if (!data) throw new HttpError(404, "Assessment not found");
  return data as AssessmentRow;
}

async function requireOwnedCourse(db: SupabaseClient, userId: string, courseId: string): Promise<CourseRow> {
  const { data, error } = await db
    .from("classes")
    .select("id, code, name, archived_at, teacher_id")
    .eq("id", courseId)
    .eq("teacher_id", userId)
    .maybeSingle();
  if (error) throw new HttpError(500, "Failed to load course", error.message);
  if (!data) throw new HttpError(404, "Course not found");
  return data as CourseRow;
}

async function requireOwnedAssignment(db: SupabaseClient, userId: string, assignmentId: string): Promise<AssignmentRow> {
  const { data, error } = await db
    .from("assessment_assignments")
    .select(ASSIGNMENT_SELECT)
    .eq("id", assignmentId)
    .maybeSingle();
  if (error) throw new HttpError(500, "Failed to load assignment", error.message);
  if (!data) throw new HttpError(404, "Assignment not found");
  const assignment = data as AssignmentRow;
  await requireOwnedCourse(db, userId, assignment.class_id);
  await requireOwnedAssessment(db, userId, assignment.assessment_id);
  return assignment;
}

async function listOwnedCourses(db: SupabaseClient, userId: string): Promise<CourseRow[]> {
  const { data, error } = await db
    .from("classes")
    .select(COURSE_SELECT)
    .eq("teacher_id", userId);
  if (error) throw new HttpError(500, "Failed to load courses", error.message);
  return (data ?? []) as CourseRow[];
}

async function listOwnedAssessments(db: SupabaseClient, userId: string, includeArchived: boolean): Promise<AssessmentRow[]> {
  let query = db
    .from("assessments")
    .select(ASSESSMENT_SELECT)
    .eq("created_by", userId);
  if (!includeArchived) query = query.is("archived_at", null);
  const { data, error } = await query;
  if (error) throw new HttpError(500, "Failed to load assessments", error.message);
  return (data ?? []) as AssessmentRow[];
}

function toTeacherAssessment(row: AssessmentRow): TeacherAssessment {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    prompt: row.prompt,
    expectedAnswer: row.expected_answer ?? null,
    rubric: coerceRubric(row.rubric),
    config: isRecord(row.config) ? row.config : {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at
  };
}

function toTeacherAssignment(row: AssignmentRow, course?: CourseRow, assessment?: AssessmentRow): TeacherAssignment | null {
  if (!course || !assessment) return null;
  return {
    id: row.id,
    assessmentId: row.assessment_id,
    classId: row.class_id,
    opensAt: row.opens_at ?? null,
    dueAt: row.due_at ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at ?? null,
    assessment: {
      id: assessment.id,
      type: assessment.type,
      title: assessment.title,
      archivedAt: assessment.archived_at
    },
    course: {
      id: course.id,
      code: course.code,
      name: course.name,
      archivedAt: course.archived_at
    }
  };
}

function parseAssessmentType(value: unknown): AssessmentType {
  if (value === "voice" || value === "voice_realtime" || value === "writing" || value === "simulation") {
    return value;
  }
  throw new HttpError(400, "Assessment type must be one of: voice, voice_realtime, writing, simulation");
}

function parseRubric(value: unknown): RubricCriterion[] {
  if (!Array.isArray(value)) {
    throw new HttpError(400, "Rubric must be an array");
  }
  if (value.length === 0) {
    throw new HttpError(400, "Rubric must include at least one criterion");
  }
  return value.map((entry, index) => {
    if (!isRecord(entry)) {
      throw new HttpError(400, `Rubric row ${index + 1} must be an object`);
    }
    const name = typeof entry.name === "string" ? entry.name.trim() : "";
    const description = typeof entry.description === "string" ? entry.description.trim() : "";
    const maxPoints = typeof entry.maxPoints === "number" ? entry.maxPoints : Number.NaN;
    if (!name) throw new HttpError(400, `Rubric row ${index + 1} is missing name`);
    if (!description) throw new HttpError(400, `Rubric row ${index + 1} is missing description`);
    if (!Number.isFinite(maxPoints) || maxPoints <= 0) {
      throw new HttpError(400, `Rubric row ${index + 1} maxPoints must be greater than zero`);
    }
    return {
      name,
      description,
      maxPoints: Math.round(maxPoints)
    };
  });
}

function coerceRubric(value: unknown): RubricCriterion[] {
  if (!Array.isArray(value)) return [];
  const rows: RubricCriterion[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) continue;
    const name = typeof entry.name === "string" ? entry.name : "";
    const description = typeof entry.description === "string" ? entry.description : "";
    const maxPoints = typeof entry.maxPoints === "number" ? entry.maxPoints : 0;
    if (!name || !description || maxPoints <= 0) continue;
    rows.push({ name, description, maxPoints });
  }
  return rows;
}

function parseAssessmentConfig(type: AssessmentType, value: unknown): Record<string, unknown> {
  if (!isRecord(value)) return defaultConfigForType(type);
  switch (type) {
    case "voice": {
      const maxRecordingSec = toOptionalInt(value.maxRecordingSec, "config.maxRecordingSec");
      return {
        maxRecordingSec: maxRecordingSec ?? DEFAULT_VOICE_MAX_RECORDING_SEC
      };
    }
    case "voice_realtime": {
      const maxSessionSec = toOptionalInt(value.maxSessionSec, "config.maxSessionSec");
      return {
        maxSessionSec: maxSessionSec ?? DEFAULT_REALTIME_VOICE_MAX_SESSION_SEC
      };
    }
    case "writing": {
      const maxBytes = toOptionalInt(value.maxBytes, "config.maxBytes");
      const acceptedMime = normalizeMimeList(
        Array.isArray(value.acceptedMime)
          ? value.acceptedMime.filter((item): item is string => typeof item === "string" && item.trim().length > 0)
          : [...DEFAULT_WRITING_ACCEPTED_MIME]
      );
      if (acceptedMime.length === 0) {
        throw new HttpError(400, "config.acceptedMime must include at least one mime type");
      }
      return {
        maxBytes: maxBytes ?? DEFAULT_WRITING_MAX_BYTES,
        acceptedMime
      };
    }
    case "simulation": {
      const minDescriptionChars = toOptionalInt(value.minDescriptionChars, "config.minDescriptionChars");
      const simulationCodeModelId = parseSimulationCodeModelId(value.simulationCodeModelId);
      return {
        minDescriptionChars: minDescriptionChars ?? DEFAULT_SIMULATION_MIN_DESCRIPTION_CHARS,
        simulationCodeModelId
      };
    }
  }
}

function defaultConfigForType(type: AssessmentType): Record<string, unknown> {
  switch (type) {
    case "voice":
      return { maxRecordingSec: DEFAULT_VOICE_MAX_RECORDING_SEC };
    case "voice_realtime":
      return { maxSessionSec: DEFAULT_REALTIME_VOICE_MAX_SESSION_SEC };
    case "writing":
      return { acceptedMime: [...DEFAULT_WRITING_ACCEPTED_MIME], maxBytes: DEFAULT_WRITING_MAX_BYTES };
    case "simulation":
      return {
        minDescriptionChars: DEFAULT_SIMULATION_MIN_DESCRIPTION_CHARS,
        simulationCodeModelId: DEFAULT_SIMULATION_CODE_MODEL_ID
      };
  }
}

function parseSimulationCodeModelId(value: unknown): string {
  if (value === undefined || value === null || value === "") return DEFAULT_SIMULATION_CODE_MODEL_ID;
  if (isSimulationCodeModelId(value)) return value;
  throw new HttpError(400, "config.simulationCodeModelId must be an allowed simulation code model");
}

function toOptionalInt(value: unknown, field: string): number | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new HttpError(400, `${field} must be a positive number`);
  }
  return Math.round(value);
}

function parseNullableDateString(value: unknown, field: string): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") throw new HttpError(400, `${field} must be an ISO timestamp`);
  const iso = value.trim();
  const timestamp = Date.parse(iso);
  if (Number.isNaN(timestamp)) throw new HttpError(400, `${field} must be a valid ISO timestamp`);
  return new Date(timestamp).toISOString();
}

function validateAssignmentDateOrder(opensAt: string | null, dueAt: string | null): void {
  if (!opensAt || !dueAt) return;
  if (new Date(dueAt).getTime() < new Date(opensAt).getTime()) {
    throw new HttpError(400, "dueAt must be later than or equal to opensAt");
  }
}

function getNullableString(input: Record<string, unknown>, key: string): string | null {
  if (!(key in input)) return null;
  const value = input[key];
  if (value === null) return null;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isDuplicateAssignmentError(error: { code?: string; message?: string }): boolean {
  const text = `${error.code ?? ""} ${error.message ?? ""}`.toLowerCase();
  return text.includes("23505") || text.includes("duplicate") || text.includes("idx_assignment_active_unique");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizeMimeList(values: string[]): string[] {
  const unique = new Set<string>();
  for (const value of values) {
    const normalized = value.trim().toLowerCase();
    if (!normalized) continue;
    unique.add(normalized);
  }
  return Array.from(unique);
}
