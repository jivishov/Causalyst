import { readAllPages, readAllForIds } from "../lib/pagination";
import type {
  AttemptStatus,
  TeacherGradebookEntry,
  TeacherGradebookExportRequest,
  TeacherGradebookExportResponse,
  TeacherGradeExportFormat,
  TeacherGradeExportMissingMode,
  TeacherGradebookFinalStatus,
  TeacherGradebookListResponse,
  TeacherGradebookRebuildResponse
} from "@alt-assessment/shared";
import type { SupabaseClient } from "@supabase/supabase-js";
import { toCsv } from "../lib/csv";
import { HttpError, getOptionalString, getRequiredString, readJson } from "../lib/http";

interface CourseRow {
  id: string;
  code: string;
  name: string;
  teacher_id: string;
}

interface AssessmentRow {
  id: string;
  type: TeacherGradebookEntry["assignment"]["assessmentType"];
  title: string;
}

interface AssignmentRow {
  id: string;
  class_id: string;
  assessment_id: string;
  opens_at: string | null;
  due_at: string | null;
  archived_at: string | null;
  classes: CourseRow | CourseRow[] | null;
  assessments: AssessmentRow | AssessmentRow[] | null;
}

interface RosterStudentRow {
  id: string;
  class_id: string;
  display_name: string;
  student_identifier: string | null;
  email: string | null;
  section: string | null;
  claimed_by: string | null;
  deactivated_at: string | null;
}

interface GradebookEntryRow {
  id: string;
  assignment_id: string;
  roster_student_id: string;
  approved_attempt_id: string | null;
  approved_score: number | null;
  approved_feedback: unknown;
  teacher_override_score: number | null;
  teacher_override_note: string | null;
  missing: boolean;
  published_at: string | null;
  created_at: string;
  updated_at: string;
}

interface MembershipRow {
  roster_student_id: string;
  student_id: string;
}

interface GradeExportRow {
  id: string;
}

interface AttemptRow {
  id: string;
  assignment_id: string | null;
  student_id: string;
  status: AttemptStatus;
  submitted_at: string | null;
  created_at: string;
  provisional_score: number | null;
  provisional_feedback: unknown;
}

const COURSE_SELECT = "id, code, name, teacher_id";
const ASSESSMENT_SELECT = "id, type, title";
const ASSIGNMENT_SELECT = `id, class_id, assessment_id, opens_at, due_at, archived_at, classes(${COURSE_SELECT}), assessments(${ASSESSMENT_SELECT})`;
const ROSTER_SELECT = "id, class_id, display_name, student_identifier, email, section, claimed_by, deactivated_at";
const GRADEBOOK_SELECT = "id, assignment_id, roster_student_id, approved_attempt_id, approved_score, approved_feedback, teacher_override_score, teacher_override_note, missing, published_at, created_at, updated_at";

export async function listTeacherGradebook(request: Request, db: SupabaseClient, userId: string): Promise<TeacherGradebookListResponse> {
  await requireTeacher(db, userId);
  const url = new URL(request.url);
  const includeArchivedAssignments = url.searchParams.get("includeArchivedAssignments") === "true";
  const includeInactiveStudents = url.searchParams.get("includeInactiveStudents") === "true";
  const courseIdFilter = nonEmpty(url.searchParams.get("courseId"));
  const assignmentIdFilter = nonEmpty(url.searchParams.get("assignmentId"));

  if (!courseIdFilter && !assignmentIdFilter) {
    throw new HttpError(400, "courseId or assignmentId is required");
  }

  let assignmentFilterRow: AssignmentRow | null = null;
  if (assignmentIdFilter) {
    assignmentFilterRow = await requireOwnedAssignment(db, userId, assignmentIdFilter);
  }

  const courseId = courseIdFilter ?? assignmentFilterRow?.class_id ?? null;
  if (!courseId) {
    throw new HttpError(400, "courseId or assignmentId is required");
  }

  const course = await requireOwnedCourse(db, userId, courseId);
  if (assignmentFilterRow && assignmentFilterRow.class_id !== course.id) {
    throw new HttpError(400, "assignmentId does not belong to the selected course");
  }

  await reconcileGradebookForCourse(db, userId, course.id);

  const assignments = await loadAssignments(db, userId, course.id, {
    assignmentId: assignmentFilterRow?.id ?? null,
    includeArchived: includeArchivedAssignments
  });
  if (assignments.length === 0) {
    return { entries: [] };
  }

  const rosterStudents = await loadRosterStudents(db, course.id, includeInactiveStudents);
  if (rosterStudents.length === 0) {
    return { entries: [] };
  }

  const assignmentIds = assignments.map((row) => row.id);
  const rosterStudentIds = rosterStudents.map((row) => row.id);

  const { data: entryData, error: entryError } = await readAllForIds(assignmentIds, (ids) => db
    .from("gradebook_entries")
    .select(GRADEBOOK_SELECT, { count: "exact" })
    .in("assignment_id", ids));
  if (entryError && isMissingGradebookSchema(entryError)) {
    throw new HttpError(409, "Gradebook requires database migration 0007_gradebook.sql");
  }
  if (entryError) throw new HttpError(500, "Failed to load gradebook entries", entryError.message);

  const memberships = await loadRosterMemberships(db, course.id, rosterStudentIds);
  const latestAttemptMap = await loadLatestAttemptMap(db, assignmentIds, memberships);

  const assignmentMap = new Map(assignments.map((row) => [row.id, row]));
  const rosterMap = new Map(rosterStudents.map((row) => [row.id, row]));

  const entries = ((entryData ?? []) as GradebookEntryRow[])
    .map((row) => toTeacherGradebookEntry(row, assignmentMap.get(row.assignment_id), rosterMap.get(row.roster_student_id), course, latestAttemptMap))
    .filter((row): row is TeacherGradebookEntry => row !== null)
    .sort(compareGradebookRows);

  return { entries };
}

export async function rebuildTeacherGradebook(request: Request, db: SupabaseClient, userId: string): Promise<TeacherGradebookRebuildResponse> {
  await requireTeacher(db, userId);
  const body = await readJson<Record<string, unknown>>(request);
  const courseId = getRequiredString(body, "courseId");
  const result = await reconcileGradebookForCourse(db, userId, courseId);
  return {
    courseId,
    insertedRows: result.insertedRows,
    touchedAssignments: result.touchedAssignments,
    touchedStudents: result.touchedStudents
  };
}

export async function exportTeacherGradebook(request: Request, db: SupabaseClient, userId: string): Promise<TeacherGradebookExportResponse> {
  await requireTeacher(db, userId);
  const body = await readJson<Record<string, unknown>>(request);
  const input = parseGradeExportRequest(body);
  const course = await requireOwnedCourse(db, userId, input.courseId);
  const selectedAssignmentIds = await validateSelectedAssignments(db, userId, course.id, input.assignmentIds);
  const includeArchivedAssignments = selectedAssignmentIds.length > 0;

  const exportSourceUrl = new URL("https://worker.internal/api/teacher/gradebook");
  exportSourceUrl.searchParams.set("courseId", course.id);
  exportSourceUrl.searchParams.set("includeArchivedAssignments", includeArchivedAssignments ? "true" : "false");
  const gradebook = await listTeacherGradebook(new Request(exportSourceUrl.toString()), db, userId);

  const selectedSet = selectedAssignmentIds.length > 0 ? new Set(selectedAssignmentIds) : null;
  const scopedEntries = gradebook.entries.filter((entry) => !selectedSet || selectedSet.has(entry.assignmentId));
  const exportEntries = input.includeUnpublished
    ? scopedEntries
    : scopedEntries.filter((entry) => Boolean(entry.publishedAt));

  const assignmentOrder = buildAssignmentOrder(exportEntries);
  const exported = input.format === "long"
    ? buildLongGradeExport(exportEntries, input)
    : buildWideGradeExport(exportEntries, assignmentOrder, input);
  const previewCount = exported.rows.length;

  const csv = input.previewOnly ? null : toCsv(exported.headers, exported.rows);
  const filename = buildGradeExportFilename(course.code, input.format);

  let auditId: string | null = null;
  if (!input.previewOnly) {
    const { data, error } = await db
      .from("grade_exports")
      .insert({
        teacher_id: userId,
        course_id: course.id,
        format: input.format,
        include_unpublished: input.includeUnpublished,
        missing_mode: input.missingMode,
        assignment_ids: selectedAssignmentIds,
        column_order: exported.columnKeys,
        column_labels: exported.columnLabels,
        row_count: exported.rows.length,
        column_count: exported.columnKeys.length
      })
      .select("id")
      .maybeSingle();
    if (error && isMissingGradeExportsSchema(error)) {
      throw new HttpError(409, "Grade export requires database migration 0008_grade_exports.sql");
    }
    if (error) throw new HttpError(500, "Failed to audit grade export", error.message);
    auditId = ((data as GradeExportRow | null)?.id ?? null);
  }

  return {
    format: input.format,
    filename,
    rowCount: exported.rows.length,
    previewCount,
    columnKeys: exported.columnKeys,
    auditId,
    csv
  };
}

export async function approveTeacherAttemptScore(db: SupabaseClient, userId: string, attemptId: string): Promise<{ entry: TeacherGradebookEntry }> {
  await requireTeacher(db, userId);
  const attempt = await requireAttempt(db, attemptId);
  if (!attempt.assignment_id) {
    throw new HttpError(409, "Attempt is not linked to an assignment");
  }
  if (typeof attempt.provisional_score !== "number" || Number.isNaN(attempt.provisional_score)) {
    throw new HttpError(409, "Attempt does not have a provisional score to approve");
  }

  const feedback = attempt.provisional_feedback as { policyVersion?: string; reviewFlags?: unknown[] } | null;
  if (feedback?.policyVersion !== "rubric-v2" || feedback.reviewFlags?.some((flag) => typeof flag === "string" && flag.startsWith("SCORING_REVIEW_REQUIRED"))) {
    throw new HttpError(409, "This recommendation needs a teacher grade with a reason before publication");
  }

  const assignment = await requireOwnedAssignment(db, userId, attempt.assignment_id);
  const rosterStudentId = await resolveRosterStudentForAttempt(db, assignment.class_id, attempt.student_id);
  if (!rosterStudentId) {
    throw new HttpError(409, "Attempt student is not linked to a roster student for this course");
  }

  await reconcileGradebookForCourse(db, userId, assignment.class_id);

  const entry = await requireGradebookByPair(db, assignment.id, rosterStudentId);
  const now = new Date().toISOString();
  const { error } = await db
    .from("gradebook_entries")
    .update({
      approved_attempt_id: attempt.id,
      approved_score: attempt.provisional_score,
      approved_feedback: attempt.provisional_feedback,
      missing: false,
      updated_at: now
    })
    .eq("id", entry.id);
  if (error) throw new HttpError(500, "Failed to approve provisional score", error.message);

  return { entry: await getTeacherGradebookEntryById(db, userId, entry.id) };
}

export async function setTeacherGradebookOverride(request: Request, db: SupabaseClient, userId: string, entryId: string): Promise<{ entry: TeacherGradebookEntry }> {
  await requireTeacher(db, userId);
  const body = await readJson<Record<string, unknown>>(request);
  const score = parseScore(body.score, "score");
  const note = getOptionalString(body, "note") ?? null;
  if (!note?.trim()) throw new HttpError(400, "A reason is required for a teacher grade");
  const entry = await requireOwnedGradebookEntry(db, userId, entryId);
  const now = new Date().toISOString();

  const { error } = await db
    .from("gradebook_entries")
    .update({
      teacher_override_score: score,
      teacher_override_note: note,
      missing: false,
      updated_at: now
    })
    .eq("id", entry.id);
  if (error) throw new HttpError(500, "Failed to set teacher override", error.message);

  return { entry: await getTeacherGradebookEntryById(db, userId, entry.id) };
}

export async function markTeacherGradebookMissing(db: SupabaseClient, userId: string, entryId: string): Promise<{ entry: TeacherGradebookEntry }> {
  await requireTeacher(db, userId);
  const entry = await requireOwnedGradebookEntry(db, userId, entryId);
  const now = new Date().toISOString();
  const { error } = await db
    .from("gradebook_entries")
    .update({
      approved_attempt_id: null,
      approved_score: null,
      approved_feedback: null,
      teacher_override_score: null,
      teacher_override_note: null,
      missing: true,
      updated_at: now
    })
    .eq("id", entry.id);
  if (error) throw new HttpError(500, "Failed to mark grade missing", error.message);
  return { entry: await getTeacherGradebookEntryById(db, userId, entry.id) };
}

export async function clearTeacherGradebookGrade(db: SupabaseClient, userId: string, entryId: string): Promise<{ entry: TeacherGradebookEntry }> {
  await requireTeacher(db, userId);
  const entry = await requireOwnedGradebookEntry(db, userId, entryId);
  if (entry.published_at) {
    throw new HttpError(409, "Unpublish the grade before clearing the final value");
  }
  const now = new Date().toISOString();
  const { error } = await db
    .from("gradebook_entries")
    .update({
      approved_attempt_id: null,
      approved_score: null,
      approved_feedback: null,
      teacher_override_score: null,
      teacher_override_note: null,
      missing: false,
      updated_at: now
    })
    .eq("id", entry.id);
  if (error) throw new HttpError(500, "Failed to clear grade", error.message);
  return { entry: await getTeacherGradebookEntryById(db, userId, entry.id) };
}

export async function setTeacherGradebookPublished(db: SupabaseClient, userId: string, entryId: string, published: boolean): Promise<{ entry: TeacherGradebookEntry }> {
  await requireTeacher(db, userId);
  const entry = await requireOwnedGradebookEntry(db, userId, entryId);

  if (published) {
    const final = computeFinal(entry);
    if (final.finalStatus === "blank") {
      throw new HttpError(
        409,
        "A final grade is required before publishing",
        { entryId: entry.id, assignmentId: entry.assignment_id },
        "final_required"
      );
    }
    if (entry.published_at) {
      return { entry: await getTeacherGradebookEntryById(db, userId, entry.id) };
    }
  }

  const now = new Date().toISOString();
  const { error } = await db
    .from("gradebook_entries")
    .update({
      published_at: published ? now : null,
      updated_at: now
    })
    .eq("id", entry.id);
  if (error) throw new HttpError(500, published ? "Failed to publish grade" : "Failed to unpublish grade", error.message);
  return { entry: await getTeacherGradebookEntryById(db, userId, entry.id) };
}

export async function reconcileGradebookForCourse(
  db: SupabaseClient,
  userId: string,
  courseId: string
): Promise<{ insertedRows: number; touchedAssignments: number; touchedStudents: number }> {
  await requireTeacher(db, userId);
  await requireOwnedCourse(db, userId, courseId);

  const { data, error } = await db.rpc("reconcile_course_gradebook", { p_teacher_id: userId, p_course_id: courseId });
  if (error) throw new HttpError(500, "Failed to reconcile gradebook rows", error.message);
  return data as { insertedRows: number; touchedAssignments: number; touchedStudents: number };
}

export async function getTeacherGradebookEntryById(db: SupabaseClient, userId: string, entryId: string): Promise<TeacherGradebookEntry> {
  await requireTeacher(db, userId);
  const entry = await requireOwnedGradebookEntry(db, userId, entryId);
  return await buildGradebookEntry(db, entry);
}

async function requireOwnedCourse(db: SupabaseClient, userId: string, courseId: string): Promise<CourseRow> {
  const { data, error } = await db
    .from("classes")
    .select(COURSE_SELECT)
    .eq("id", courseId)
    .maybeSingle();
  if (error) throw new HttpError(500, "Failed to load course", error.message);
  if (!data) throw new HttpError(404, "Course not found");
  if ((data as CourseRow).teacher_id !== userId) throw new HttpError(403, "Teacher does not own this course");
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
  const course = firstRelation(assignment.classes);
  if (!course) throw new HttpError(500, "Assignment is missing course linkage");
  if (course.teacher_id !== userId) throw new HttpError(403, "Teacher does not own this assignment");
  return assignment;
}

async function requireAttempt(db: SupabaseClient, attemptId: string): Promise<AttemptRow> {
  const { data, error } = await db
    .from("attempts")
    .select("id, assignment_id, student_id, status, submitted_at, created_at, provisional_score, provisional_feedback")
    .eq("id", attemptId)
    .maybeSingle();
  if (error) throw new HttpError(500, "Failed to load attempt", error.message);
  if (!data) throw new HttpError(404, "Attempt not found");
  return data as AttemptRow;
}

async function requireGradebookByPair(db: SupabaseClient, assignmentId: string, rosterStudentId: string): Promise<GradebookEntryRow> {
  const { data, error } = await db
    .from("gradebook_entries")
    .select(GRADEBOOK_SELECT)
    .eq("assignment_id", assignmentId)
    .eq("roster_student_id", rosterStudentId)
    .maybeSingle();
  if (error) throw new HttpError(500, "Failed to load gradebook entry", error.message);
  if (!data) throw new HttpError(404, "Gradebook entry not found");
  return data as GradebookEntryRow;
}

async function requireOwnedGradebookEntry(db: SupabaseClient, userId: string, entryId: string): Promise<GradebookEntryRow> {
  const { data, error } = await db
    .from("gradebook_entries")
    .select(GRADEBOOK_SELECT)
    .eq("id", entryId)
    .maybeSingle();
  if (error) throw new HttpError(500, "Failed to load gradebook entry", error.message);
  if (!data) throw new HttpError(404, "Gradebook entry not found");

  const entry = data as GradebookEntryRow;
  const assignment = await requireOwnedAssignment(db, userId, entry.assignment_id);
  const rosterStudent = await requireRosterStudent(db, entry.roster_student_id);
  if (rosterStudent.class_id !== assignment.class_id) {
    throw new HttpError(409, "Gradebook entry roster linkage is invalid");
  }
  return entry;
}

async function requireRosterStudent(db: SupabaseClient, rosterStudentId: string): Promise<RosterStudentRow> {
  const { data, error } = await db
    .from("roster_students")
    .select(ROSTER_SELECT)
    .eq("id", rosterStudentId)
    .maybeSingle();
  if (error && isMissingRosterDeactivationColumn(error)) {
    throw new HttpError(409, "Gradebook requires database migration 0007_gradebook.sql");
  }
  if (error) throw new HttpError(500, "Failed to load roster student", error.message);
  if (!data) throw new HttpError(404, "Roster student not found");
  return data as RosterStudentRow;
}

async function loadAssignments(
  db: SupabaseClient,
  userId: string,
  courseId: string,
  input: { assignmentId: string | null; includeArchived: boolean }
): Promise<AssignmentRow[]> {
  let query = db
    .from("assessment_assignments")
    .select(ASSIGNMENT_SELECT, { count: "exact" })
    .eq("class_id", courseId)
    .order("created_at", { ascending: true });

  if (input.assignmentId) query = query.eq("id", input.assignmentId);
  if (!input.includeArchived) {
    const withIs = query as unknown as { is?: (key: string, value: unknown) => typeof query };
    query = typeof withIs.is === "function" ? withIs.is("archived_at", null) : query.eq("archived_at", null);
  }

  const { data, error } = await readAllPages(query);
  if (error) throw new HttpError(500, "Failed to load assignments", error.message);
  return ((data ?? []) as AssignmentRow[])
    .filter((row) => firstRelation(row.classes)?.teacher_id === userId && Boolean(firstRelation(row.assessments)?.id));
}

async function loadRosterStudents(db: SupabaseClient, courseId: string, includeInactive: boolean): Promise<RosterStudentRow[]> {
  let query = db
    .from("roster_students")
    .select(ROSTER_SELECT, { count: "exact" })
    .eq("class_id", courseId)
    .order("created_at", { ascending: true });
  if (!includeInactive) {
    const withIs = query as unknown as { is?: (key: string, value: unknown) => typeof query };
    query = typeof withIs.is === "function" ? withIs.is("deactivated_at", null) : query.eq("deactivated_at", null);
  }

  const { data, error } = await readAllPages(query);
  if (error && isMissingRosterDeactivationColumn(error)) {
    throw new HttpError(409, "Gradebook requires database migration 0007_gradebook.sql");
  }
  if (error) throw new HttpError(500, "Failed to load roster students", error.message);
  return (data ?? []) as RosterStudentRow[];
}

async function loadRosterMemberships(db: SupabaseClient, courseId: string, rosterStudentIds: string[]): Promise<MembershipRow[]> {
  if (rosterStudentIds.length === 0) return [];
  const { data, error } = await readAllPages(db
    .from("class_memberships")
    .select("id, roster_student_id, student_id", { count: "exact" })
    .eq("class_id", courseId));
  if (error) throw new HttpError(500, "Failed to load roster memberships", error.message);

  const rows = (data ?? []) as Array<{ roster_student_id: string | null; student_id: string }>;
  return rows
    .filter((row): row is { roster_student_id: string; student_id: string } => Boolean(row.roster_student_id && row.student_id))
    .map((row) => ({ roster_student_id: row.roster_student_id, student_id: row.student_id }));
}

async function loadLatestAttemptMap(
  db: SupabaseClient,
  assignmentIds: string[],
  memberships: MembershipRow[]
): Promise<Map<string, AttemptRow>> {
  if (assignmentIds.length === 0 || memberships.length === 0) return new Map();

  const studentIds = unique(memberships.map((row) => row.student_id));
  if (studentIds.length === 0) return new Map();

  const rosterByStudentId = new Map<string, string>();
  for (const membership of memberships) {
    if (!rosterByStudentId.has(membership.student_id)) {
      rosterByStudentId.set(membership.student_id, membership.roster_student_id);
    }
  }

  const { data, error } = await readAllForIds(assignmentIds, (ids) => db
    .from("attempts")
    .select("id, assignment_id, student_id, status, submitted_at, created_at, provisional_score, provisional_feedback", { count: "exact" })
    .in("assignment_id", ids)
    .order("submitted_at", { ascending: false })
    .order("created_at", { ascending: false }));
  if (error) throw new HttpError(500, "Failed to load attempts for gradebook", error.message);

  const latestAny = new Map<string, AttemptRow>();
  const latestGraded = new Map<string, AttemptRow>();
  for (const row of (data ?? []) as AttemptRow[]) {
    if (!row.assignment_id) continue;
    const rosterStudentId = rosterByStudentId.get(row.student_id);
    if (!rosterStudentId) continue;
    const key = `${row.assignment_id}:${rosterStudentId}`;
    if (!latestAny.has(key)) latestAny.set(key, row);
    if (row.status === "graded" && !latestGraded.has(key)) {
      latestGraded.set(key, row);
    }
  }

  const preferred = new Map<string, AttemptRow>();
  const keys = unique([...latestAny.keys(), ...latestGraded.keys()]);
  for (const key of keys) {
    const graded = latestGraded.get(key);
    if (graded) {
      preferred.set(key, graded);
      continue;
    }
    const latest = latestAny.get(key);
    if (latest) preferred.set(key, latest);
  }
  return preferred;
}

async function resolveRosterStudentForAttempt(db: SupabaseClient, courseId: string, studentId: string): Promise<string | null> {
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

async function buildGradebookEntry(db: SupabaseClient, entry: GradebookEntryRow): Promise<TeacherGradebookEntry> {
  const assignment = await requireAssignmentById(db, entry.assignment_id);
  const course = firstRelation(assignment.classes);
  const assessment = firstRelation(assignment.assessments);
  if (!course || !assessment) throw new HttpError(500, "Gradebook entry assignment linkage is invalid");

  const rosterStudent = await requireRosterStudent(db, entry.roster_student_id);
  if (rosterStudent.class_id !== assignment.class_id) {
    throw new HttpError(409, "Gradebook entry roster linkage is invalid");
  }

  const memberships = await loadRosterMemberships(db, course.id, [rosterStudent.id]);
  const latestAttemptMap = await loadLatestAttemptMap(db, [assignment.id], memberships);
  const key = `${assignment.id}:${rosterStudent.id}`;
  const latestAttempt = latestAttemptMap.get(key) ?? null;

  const final = computeFinal(entry);
  return {
    id: entry.id,
    assignmentId: entry.assignment_id,
    rosterStudentId: entry.roster_student_id,
    approvedAttemptId: entry.approved_attempt_id,
    approvedScore: entry.approved_score,
    teacherOverrideScore: entry.teacher_override_score,
    teacherOverrideNote: entry.teacher_override_note,
    missing: entry.missing,
    publishedAt: entry.published_at,
    finalScore: final.finalScore,
    finalStatus: final.finalStatus,
    createdAt: entry.created_at,
    updatedAt: entry.updated_at,
    student: {
      id: rosterStudent.id,
      displayName: rosterStudent.display_name,
      studentIdentifier: rosterStudent.student_identifier,
      email: rosterStudent.email,
      section: rosterStudent.section,
      active: rosterStudent.deactivated_at === null,
      claimed: Boolean(rosterStudent.claimed_by)
    },
    course: {
      id: course.id,
      code: course.code,
      name: course.name
    },
    assignment: {
      id: assignment.id,
      opensAt: assignment.opens_at,
      dueAt: assignment.due_at,
      archivedAt: assignment.archived_at,
      assessmentId: assessment.id,
      assessmentType: assessment.type,
      assessmentTitle: assessment.title
    },
    latestAttempt: latestAttempt
      ? {
        attemptId: latestAttempt.id,
        status: latestAttempt.status,
        submittedAt: latestAttempt.submitted_at,
        provisionalScore: latestAttempt.provisional_score
      }
      : null
  };
}

function toTeacherGradebookEntry(
  entry: GradebookEntryRow,
  assignment: AssignmentRow | undefined,
  rosterStudent: RosterStudentRow | undefined,
  course: CourseRow,
  latestAttemptMap: Map<string, AttemptRow>
): TeacherGradebookEntry | null {
  if (!assignment || !rosterStudent) return null;
  const assessment = firstRelation(assignment.assessments);
  if (!assessment) return null;

  const key = `${assignment.id}:${rosterStudent.id}`;
  const latestAttempt = latestAttemptMap.get(key) ?? null;
  const final = computeFinal(entry);

  return {
    id: entry.id,
    assignmentId: assignment.id,
    rosterStudentId: rosterStudent.id,
    approvedAttemptId: entry.approved_attempt_id,
    approvedScore: entry.approved_score,
    teacherOverrideScore: entry.teacher_override_score,
    teacherOverrideNote: entry.teacher_override_note,
    missing: entry.missing,
    publishedAt: entry.published_at,
    finalScore: final.finalScore,
    finalStatus: final.finalStatus,
    createdAt: entry.created_at,
    updatedAt: entry.updated_at,
    student: {
      id: rosterStudent.id,
      displayName: rosterStudent.display_name,
      studentIdentifier: rosterStudent.student_identifier,
      email: rosterStudent.email,
      section: rosterStudent.section,
      active: rosterStudent.deactivated_at === null,
      claimed: Boolean(rosterStudent.claimed_by)
    },
    course: {
      id: course.id,
      code: course.code,
      name: course.name
    },
    assignment: {
      id: assignment.id,
      opensAt: assignment.opens_at,
      dueAt: assignment.due_at,
      archivedAt: assignment.archived_at,
      assessmentId: assessment.id,
      assessmentType: assessment.type,
      assessmentTitle: assessment.title
    },
    latestAttempt: latestAttempt
      ? {
        attemptId: latestAttempt.id,
        status: latestAttempt.status,
        submittedAt: latestAttempt.submitted_at,
        provisionalScore: latestAttempt.provisional_score
      }
      : null
  };
}

async function requireAssignmentById(db: SupabaseClient, assignmentId: string): Promise<AssignmentRow> {
  const { data, error } = await db
    .from("assessment_assignments")
    .select(ASSIGNMENT_SELECT)
    .eq("id", assignmentId)
    .maybeSingle();
  if (error) throw new HttpError(500, "Failed to load assignment", error.message);
  if (!data) throw new HttpError(404, "Assignment not found");
  return data as AssignmentRow;
}

function compareGradebookRows(a: TeacherGradebookEntry, b: TeacherGradebookEntry): number {
  const assignmentSort = compareNullableIso(a.assignment.dueAt, b.assignment.dueAt)
    || a.assignment.assessmentTitle.localeCompare(b.assignment.assessmentTitle)
    || a.assignment.id.localeCompare(b.assignment.id);
  if (assignmentSort !== 0) return assignmentSort;
  return a.student.displayName.localeCompare(b.student.displayName);
}

function compareNullableIso(left: string | null, right: string | null): number {
  if (left && right) return left.localeCompare(right);
  if (left) return -1;
  if (right) return 1;
  return 0;
}

function computeFinal(entry: Pick<GradebookEntryRow, "teacher_override_score" | "approved_score" | "missing">): {
  finalScore: number | null;
  finalStatus: TeacherGradebookFinalStatus;
} {
  if (typeof entry.teacher_override_score === "number") {
    return { finalScore: entry.teacher_override_score, finalStatus: "teacher_override" };
  }
  if (typeof entry.approved_score === "number") {
    return { finalScore: entry.approved_score, finalStatus: "approved_ai" };
  }
  if (entry.missing) {
    return { finalScore: null, finalStatus: "missing" };
  }
  return { finalScore: null, finalStatus: "blank" };
}

function parseGradeExportRequest(body: Record<string, unknown>): Required<TeacherGradebookExportRequest> {
  const format = parseGradeExportFormat(body.format);
  const courseId = getRequiredString(body, "courseId");
  const includeUnpublished = parseBooleanField(body.includeUnpublished, false, "includeUnpublished");
  const previewOnly = parseBooleanField(body.previewOnly, false, "previewOnly");
  const missingMode = parseMissingMode(body.missingMode);
  const assignmentIds = parseStringList(body.assignmentIds, "assignmentIds");
  const columns = parseStringList(body.columns, "columns");
  const columnLabels = parseColumnLabels(body.columnLabels);

  return {
    format,
    courseId,
    includeUnpublished,
    previewOnly,
    missingMode,
    assignmentIds,
    columns,
    columnLabels
  };
}

function parseGradeExportFormat(value: unknown): TeacherGradeExportFormat {
  if (value === "long" || value === "wide") return value;
  throw new HttpError(400, "format must be one of: long, wide");
}

function parseMissingMode(value: unknown): TeacherGradeExportMissingMode {
  if (value === undefined || value === null || value === "") return "blank";
  if (value === "blank" || value === "zero") return value;
  throw new HttpError(400, "missingMode must be one of: blank, zero");
}

function parseStringList(value: unknown, field: string): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new HttpError(400, `${field} must be an array of strings`);
  }
  const output: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") {
      throw new HttpError(400, `${field} must be an array of strings`);
    }
    const trimmed = item.trim();
    if (!trimmed) continue;
    if (!output.includes(trimmed)) output.push(trimmed);
  }
  return output;
}

function parseColumnLabels(value: unknown): Record<string, string> {
  if (value === undefined || value === null) return {};
  if (!isRecord(value)) {
    throw new HttpError(400, "columnLabels must be an object of key/value labels");
  }

  const output: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (typeof raw !== "string") continue;
    const trimmedKey = key.trim();
    const trimmedLabel = raw.trim();
    if (!trimmedKey || !trimmedLabel) continue;
    output[trimmedKey] = trimmedLabel.slice(0, 120);
  }
  return output;
}

function parseBooleanField(value: unknown, defaultValue: boolean, field: string): boolean {
  if (value === undefined || value === null) return defaultValue;
  if (typeof value !== "boolean") throw new HttpError(400, `${field} must be a boolean`);
  return value;
}

async function validateSelectedAssignments(
  db: SupabaseClient,
  userId: string,
  courseId: string,
  assignmentIds: string[]
): Promise<string[]> {
  if (assignmentIds.length === 0) return [];
  const selected: string[] = [];
  for (const assignmentId of assignmentIds) {
    const assignment = await requireOwnedAssignment(db, userId, assignmentId);
    if (assignment.class_id !== courseId) {
      throw new HttpError(400, "All assignmentIds must belong to the selected course");
    }
    selected.push(assignment.id);
  }
  return selected;
}

function buildAssignmentOrder(entries: TeacherGradebookEntry[]): Array<{ id: string; title: string }> {
  const seen = new Set<string>();
  const ordered: Array<{ id: string; title: string }> = [];
  for (const entry of entries) {
    if (seen.has(entry.assignmentId)) continue;
    seen.add(entry.assignmentId);
    ordered.push({
      id: entry.assignmentId,
      title: entry.assignment.assessmentTitle
    });
  }
  return ordered;
}

function buildLongGradeExport(
  entries: TeacherGradebookEntry[],
  input: Required<TeacherGradebookExportRequest>
): {
  headers: string[];
  rows: Array<Array<string | number | null>>;
  columnKeys: string[];
  columnLabels: Record<string, string>;
} {
  const defaults: Record<string, string> = {
    student_name: "Student Name",
    student_identifier: "Student Identifier",
    student_email: "Student Email",
    student_section: "Student Section",
    course_code: "Course Code",
    course_name: "Course Name",
    assignment_title: "Assignment",
    assignment_id: "Assignment ID",
    assessment_type: "Assessment Type",
    final_score: "Final Score",
    final_status: "Final Status",
    published_at: "Published At",
    latest_attempt_status: "Latest Attempt Status",
    latest_attempt_submitted_at: "Latest Attempt Submitted At"
  };

  const rowMaps = entries.map((entry) => ({
    student_name: entry.student.displayName,
    student_identifier: entry.student.studentIdentifier,
    student_email: entry.student.email,
    student_section: entry.student.section,
    course_code: entry.course.code,
    course_name: entry.course.name,
    assignment_title: entry.assignment.assessmentTitle,
    assignment_id: entry.assignmentId,
    assessment_type: entry.assignment.assessmentType,
    final_score: resolveExportScore(entry, input.missingMode),
    final_status: entry.finalStatus,
    published_at: entry.publishedAt,
    latest_attempt_status: entry.latestAttempt?.status ?? null,
    latest_attempt_submitted_at: entry.latestAttempt?.submittedAt ?? null
  }));

  return buildExportMatrixFromRows(defaults, rowMaps, input);
}

function buildWideGradeExport(
  entries: TeacherGradebookEntry[],
  assignmentOrder: Array<{ id: string; title: string }>,
  input: Required<TeacherGradebookExportRequest>
): {
  headers: string[];
  rows: Array<Array<string | number | null>>;
  columnKeys: string[];
  columnLabels: Record<string, string>;
} {
  const defaults: Record<string, string> = {
    student_name: "Student Name",
    student_identifier: "Student Identifier",
    student_email: "Student Email",
    student_section: "Student Section",
    course_code: "Course Code",
    course_name: "Course Name"
  };

  const assignmentColumnKeyById = new Map<string, string>();
  const assignmentLabelCounts = new Map<string, number>();
  for (const assignment of assignmentOrder) {
    const key = `assignment__${assignment.id}`;
    assignmentColumnKeyById.set(assignment.id, key);
    const baseLabel = `${assignment.title} (${assignment.id.slice(0, 8)})`;
    const count = (assignmentLabelCounts.get(baseLabel) ?? 0) + 1;
    assignmentLabelCounts.set(baseLabel, count);
    defaults[key] = count === 1 ? baseLabel : `${baseLabel} #${count}`;
  }

  const rowByStudent = new Map<string, Record<string, string | number | null>>();
  for (const entry of entries) {
    const assignmentKey = assignmentColumnKeyById.get(entry.assignmentId);
    if (!assignmentKey) continue;

    const existing = rowByStudent.get(entry.rosterStudentId) ?? {
      student_name: entry.student.displayName,
      student_identifier: entry.student.studentIdentifier,
      student_email: entry.student.email,
      student_section: entry.student.section,
      course_code: entry.course.code,
      course_name: entry.course.name
    };
    existing[assignmentKey] = resolveExportScore(entry, input.missingMode);
    rowByStudent.set(entry.rosterStudentId, existing);
  }

  const assignmentKeys = Array.from(assignmentColumnKeyById.values());
  const rowMaps = Array.from(rowByStudent.values()).map((row) => {
    for (const key of assignmentKeys) {
      if (!(key in row)) row[key] = null;
    }
    return row;
  });

  return buildExportMatrixFromRows(defaults, rowMaps, input);
}

function buildExportMatrixFromRows(
  defaults: Record<string, string>,
  rowMaps: Array<Record<string, string | number | null>>,
  input: Required<TeacherGradebookExportRequest>
): {
  headers: string[];
  rows: Array<Array<string | number | null>>;
  columnKeys: string[];
  columnLabels: Record<string, string>;
} {
  const defaultKeys = Object.keys(defaults);
  const filteredKeys = input.columns.filter((key) => defaultKeys.includes(key));
  const columnKeys = filteredKeys.length > 0 ? filteredKeys : defaultKeys;

  const mergedLabels: Record<string, string> = {};
  for (const key of defaultKeys) {
    const override = input.columnLabels[key];
    mergedLabels[key] = override && override.trim().length > 0 ? override.trim() : defaults[key];
  }

  const headers = columnKeys.map((key) => mergedLabels[key] ?? key);
  const rows = rowMaps.map((row) => columnKeys.map((key) => row[key] ?? null));

  return {
    headers,
    rows,
    columnKeys,
    columnLabels: mergedLabels
  };
}

function resolveExportScore(entry: TeacherGradebookEntry, missingMode: TeacherGradeExportMissingMode): number | null {
  if (typeof entry.finalScore === "number") return entry.finalScore;
  if (entry.finalStatus === "missing" && missingMode === "zero") return 0;
  return null;
}

function buildGradeExportFilename(courseCode: string, format: TeacherGradeExportFormat): string {
  const safeCourseCode = courseCode.replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "course";
  const timestamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  return `gradebook-${safeCourseCode}-${format}-${timestamp}.csv`;
}

function parseScore(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new HttpError(400, `${field} must be a number`);
  }
  if (value < 0 || value > 100) {
    throw new HttpError(400, `${field} must be between 0 and 100`);
  }
  return Math.round(value * 100) / 100;
}

function firstRelation<T>(value: T | T[] | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function nonEmpty(value: string | null): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isMissingGradebookSchema(error: { code?: string; message?: string; details?: string; hint?: string }): boolean {
  const text = `${error.code ?? ""} ${error.message ?? ""} ${error.details ?? ""} ${error.hint ?? ""}`.toLowerCase();
  return text.includes("gradebook_entries") || text.includes("42p01") || text.includes("pgrst205") || text.includes("pgrst204");
}

function isMissingGradeExportsSchema(error: { code?: string; message?: string; details?: string; hint?: string }): boolean {
  const text = `${error.code ?? ""} ${error.message ?? ""} ${error.details ?? ""} ${error.hint ?? ""}`.toLowerCase();
  return text.includes("grade_exports") || text.includes("42p01") || text.includes("pgrst205") || text.includes("pgrst204");
}

function isMissingRosterDeactivationColumn(error: { code?: string; message?: string; details?: string; hint?: string }): boolean {
  const text = `${error.code ?? ""} ${error.message ?? ""} ${error.details ?? ""} ${error.hint ?? ""}`.toLowerCase();
  return text.includes("deactivated_at") || text.includes("42703");
}

async function requireTeacher(db: SupabaseClient, userId: string): Promise<void> {
  const { data, error } = await db
    .from("profiles")
    .select("id, role")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw new HttpError(500, "Failed to load teacher profile", error.message);
  if (!data || data.role !== "teacher") {
    throw new HttpError(403, "Teacher access required");
  }
}
