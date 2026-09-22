import type {
  TeacherCourse,
  TeacherCoursesResponse,
  TeacherRosterDeleteResponse,
  TeacherRosterImportCommitResponse,
  TeacherRosterImportPreviewError,
  TeacherRosterImportPreviewResponse,
  TeacherRosterImportPreviewRow,
  TeacherRosterResponse,
  TeacherSessionResponse,
  TeacherSetupStatusResponse
} from "@alt-assessment/shared";
import type { AppDatabaseClient } from "../lib/database";
import type { TablesUpdate } from "../lib/database";
import type { Env } from "../lib/env";
import { normalizeCourseCode } from "../lib/courseCode";
import { hashPin } from "../lib/crypto";
import { HttpError, getOptionalString, getRequiredString, readJson } from "../lib/http";
import { parseRosterCsv, type RosterCsvError, type RosterCsvRow } from "../lib/rosterCsv";
import { reconcileGradebookForCourse } from "./teacherGradebook";

interface TeacherProfileRow {
  id: string;
  display_name: string;
}

interface CourseRow {
  id: string;
  code: string;
  name: string;
  section?: string | null;
  term?: string | null;
  archived_at?: string | null;
  created_at: string;
  updated_at?: string;
}

interface RosterStudentRow {
  id: string;
  class_id: string;
  display_name: string;
  student_identifier: string | null;
  email: string | null;
  section: string | null;
  claimed_by: string | null;
  claimed_at: string | null;
  created_at: string;
  updated_at: string;
}

interface RosterAccessCodeRow {
  roster_student_id: string;
  claimed_by: string | null;
  claimed_at: string | null;
}

const DUPLICATE_CODE_MESSAGE = "Course code is already taken. Try adding a term suffix such as BIO101-S26.";
const DUPLICATE_IDENTIFIER_MESSAGE = "This roster import has duplicate student identifiers for the selected course.";
const DUPLICATE_EMAIL_MESSAGE = "This roster import has duplicate emails for the selected course.";
const COURSE_METADATA_MIGRATION_MESSAGE = "Course metadata requires database migration 0003_teacher_courses.sql";
const COURSE_SELECT = "id, code, name, section, term, archived_at, created_at, updated_at";
const ROSTER_SELECT = "id, class_id, display_name, student_identifier, email, section, claimed_by, claimed_at, created_at, updated_at";

export async function teacherSetupStatus(db: AppDatabaseClient): Promise<TeacherSetupStatusResponse> {
  return { setupAvailable: !(await teacherExists(db)) };
}

export async function setupTeacher(request: Request, env: Env, db: AppDatabaseClient, userId: string, token: string, authenticatedEmail?: string | null): Promise<TeacherSessionResponse> {
  const setupCode = (env.TEACHER_SETUP_CODE ?? "").trim();
  if (!setupCode) {
    throw new HttpError(500, "Worker TEACHER_SETUP_CODE is not configured");
  }

  const body = await readJson<Record<string, unknown>>(request);
  if (!timingSafeStringEqual(getRequiredString(body, "setupCode"), setupCode)) {
    throw new HttpError(403, "Setup code was not accepted");
  }

  const email = authenticatedEmail ?? await loadUserEmail(env, token);
  if (!email) {
    throw new HttpError(403, "Teacher email session required");
  }
  const displayName = getOptionalString(body, "displayName") ?? email ?? "Teacher";
  const { data, error } = await db
    .rpc("claim_first_teacher", {
      p_user_id: userId,
      p_display_name: displayName
    })
    .single();
  if (error && isMissingReleaseHardeningRpc(error)) {
    throw new HttpError(409, "Teacher setup requires database migration 0010_release_hardening.sql");
  }
  if (error && isTeacherSetupAlreadyCompleted(error)) {
    throw new HttpError(409, "Teacher setup has already been completed");
  }
  if (error) throw new HttpError(500, "Failed to save teacher profile", error.message);

  const profile = data as { id?: string; display_name?: string } | null;
  return { profile: { id: profile?.id ?? userId, email, displayName: profile?.display_name ?? displayName } };
}

export async function teacherMe(env: Env, db: AppDatabaseClient, userId: string, token: string, authenticatedEmail?: string | null): Promise<TeacherSessionResponse> {
  const profile = await requireTeacherProfile(db, userId);
  const email = authenticatedEmail ?? await loadUserEmail(env, token);
  return { profile: { id: profile.id, email, displayName: profile.display_name } };
}

export async function listTeacherCourses(db: AppDatabaseClient, userId: string, includeArchived: boolean): Promise<TeacherCoursesResponse> {
  await requireTeacherProfile(db, userId);
  let query = db
    .from("classes")
    .select(COURSE_SELECT)
    .eq("teacher_id", userId)
    .order("created_at", { ascending: false });
  if (!includeArchived) query = query.is("archived_at", null);

  const { data, error } = await query;
  if (error && isMissingCourseMetadata(error)) throwMissingCourseMetadata();
  if (error) throw new HttpError(500, "Failed to load courses", error.message);
  return { courses: (data ?? []).map(toTeacherCourse) };
}

export async function createTeacherCourse(request: Request, db: AppDatabaseClient, userId: string): Promise<{ course: TeacherCourse }> {
  await requireTeacherProfile(db, userId);
  const body = await readJson<Record<string, unknown>>(request);
  const code = normalizeCourseCode(getRequiredString(body, "code"));
  const name = getRequiredString(body, "name");
  const section = getNullableString(body, "section");
  const term = getNullableString(body, "term");

  const { data, error } = await db
    .from("classes")
    .insert({
      code,
      name,
      section,
      term,
      teacher_id: userId,
      updated_at: new Date().toISOString()
    })
    .select(COURSE_SELECT)
    .single();
  if (error && isMissingCourseMetadata(error)) throwMissingCourseMetadata();
  if (error) handleCourseWriteError(error, "Failed to create course");
  return { course: toTeacherCourse(data as CourseRow) };
}

export async function updateTeacherCourse(request: Request, db: AppDatabaseClient, userId: string, courseId: string): Promise<{ course: TeacherCourse }> {
  await requireTeacherProfile(db, userId);
  const body = await readJson<Record<string, unknown>>(request);
  const patch: TablesUpdate<"classes"> = { updated_at: new Date().toISOString() };

  if ("code" in body) patch.code = normalizeCourseCode(getRequiredString(body, "code"));
  if ("name" in body) patch.name = getRequiredString(body, "name");
  if ("section" in body) patch.section = getNullableString(body, "section");
  if ("term" in body) patch.term = getNullableString(body, "term");

  const { data, error } = await db
    .from("classes")
    .update(patch)
    .eq("id", courseId)
    .eq("teacher_id", userId)
    .select(COURSE_SELECT)
    .maybeSingle();
  if (error && isMissingCourseMetadata(error)) throwMissingCourseMetadata();
  if (error) handleCourseWriteError(error, "Failed to update course");
  if (!data) throw new HttpError(404, "Course not found");
  return { course: toTeacherCourse(data as CourseRow) };
}

export async function setTeacherCourseArchived(db: AppDatabaseClient, userId: string, courseId: string, archived: boolean): Promise<{ course: TeacherCourse }> {
  await requireTeacherProfile(db, userId);
  const now = new Date().toISOString();
  const { data, error } = await db
    .from("classes")
    .update({ archived_at: archived ? now : null, updated_at: now })
    .eq("id", courseId)
    .eq("teacher_id", userId)
    .select(COURSE_SELECT)
    .maybeSingle();
  if (error && isMissingCourseMetadata(error)) throwMissingCourseMetadata();
  if (error) throw new HttpError(500, archived ? "Failed to archive course" : "Failed to unarchive course", error.message);
  if (!data) throw new HttpError(404, "Course not found");
  return { course: toTeacherCourse(data as CourseRow) };
}

export async function previewTeacherRosterImport(request: Request, db: AppDatabaseClient, userId: string, courseId: string): Promise<TeacherRosterImportPreviewResponse> {
  const course = await requireOwnedCourse(db, userId, courseId);
  const csvText = await getCsvText(request);
  return buildRosterPreview(db, course.id, csvText);
}

export async function commitTeacherRosterImport(request: Request, env: Env, db: AppDatabaseClient, userId: string, courseId: string): Promise<TeacherRosterImportCommitResponse> {
  const course = await requireOwnedCourse(db, userId, courseId);
  const csvText = await getCsvText(request);
  const preview = await buildRosterPreview(db, course.id, csvText);

  if (preview.errors.length > 0) {
    throw new HttpError(409, "Roster import has validation errors", { errors: preview.errors });
  }
  if (preview.acceptedRows.length === 0) {
    throw new HttpError(400, "Roster import did not contain any valid rows");
  }

  const pins: TeacherRosterImportCommitResponse["pins"] = [];
  const rows = [];
  for (const row of preview.acceptedRows) {
    const rosterStudentId = crypto.randomUUID();
    const pin = generatePin();
    rows.push({ ...row, id: rosterStudentId, pinHash: await hashPin(pin, env) });
    pins.push({ ...row, rosterStudentId, pin });
  }
  const { error } = await db.rpc("import_course_roster", {
    p_teacher_id: userId, p_course_id: course.id, p_rows: rows
  });
  if (error) handleRosterWriteError(error);

  await reconcileGradebookForCourse(db, userId, course.id);

  return {
    courseId: course.id,
    createdCount: pins.length,
    pins
  };
}

export async function listTeacherRoster(db: AppDatabaseClient, userId: string, courseId: string): Promise<TeacherRosterResponse> {
  const course = await requireOwnedCourse(db, userId, courseId);
  const { data: rosterRows, error: rosterError } = await db
    .from("roster_students")
    .select(ROSTER_SELECT)
    .eq("class_id", course.id)
    .order("created_at", { ascending: true });
  if (rosterError && isMissingRosterSchema(rosterError)) {
    throw new HttpError(409, "Roster import requires database migration 0004_roster_import.sql");
  }
  if (rosterError) throw new HttpError(500, "Failed to load roster", rosterError.message);

  const { data: accessRows, error: accessError } = await db
    .from("student_access_codes")
    .select("roster_student_id, claimed_by, claimed_at")
    .eq("class_id", course.id)
    .not("roster_student_id", "is", null);
  if (accessError && isMissingRosterSchema(accessError)) {
    throw new HttpError(409, "Roster import requires database migration 0004_roster_import.sql");
  }
  if (accessError) throw new HttpError(500, "Failed to load roster claim status", accessError.message);

  const claimMap = new Map<string, RosterAccessCodeRow>();
  for (const row of (accessRows ?? []) as RosterAccessCodeRow[]) {
    if (row.roster_student_id && !claimMap.has(row.roster_student_id)) {
      claimMap.set(row.roster_student_id, row);
    }
  }

  return {
    courseId: course.id,
    students: ((rosterRows ?? []) as RosterStudentRow[]).map((row) => {
      const claim = claimMap.get(row.id);
      const claimedBy = claim?.claimed_by ?? row.claimed_by ?? null;
      const claimedAt = claim?.claimed_at ?? row.claimed_at ?? null;
      return {
        id: row.id,
        displayName: row.display_name,
        studentIdentifier: row.student_identifier,
        email: row.email,
        section: row.section,
        claimed: Boolean(claimedBy),
        claimedBy,
        claimedAt,
        createdAt: row.created_at
      };
    })
  };
}

export async function deleteTeacherRoster(request: Request, db: AppDatabaseClient, userId: string, courseId: string): Promise<TeacherRosterDeleteResponse> {
  const course = await requireOwnedCourse(db, userId, courseId);
  const body = await readJson<Record<string, unknown>>(request);
  const confirmationText = getRequiredString(body, "confirmationText");
  const confirmationPhrase = `DELETE ${course.code}`;
  if (confirmationText.trim().toUpperCase() !== confirmationPhrase.toUpperCase()) {
    throw new HttpError(400, `Confirmation text must exactly match: ${confirmationPhrase}`);
  }

  const { data: rosterRows, error: rosterError } = await db
    .from("roster_students")
    .select("id, claimed_by")
    .eq("class_id", course.id);
  if (rosterError && isMissingRosterSchema(rosterError)) {
    throw new HttpError(409, "Roster import requires database migration 0004_roster_import.sql");
  }
  if (rosterError) throw new HttpError(500, "Failed to load roster before delete", rosterError.message);

  const { data: accessRows, error: accessError } = await db
    .from("student_access_codes")
    .select("roster_student_id, claimed_by")
    .eq("class_id", course.id)
    .not("roster_student_id", "is", null);
  if (accessError && isMissingRosterSchema(accessError)) {
    throw new HttpError(409, "Roster import requires database migration 0004_roster_import.sql");
  }
  if (accessError) throw new HttpError(500, "Failed to load access codes before delete", accessError.message);

  const claimedRosterIds = new Set<string>();
  for (const row of (rosterRows ?? []) as Array<{ id: string; claimed_by: string | null }>) {
    if (row.claimed_by) claimedRosterIds.add(row.id);
  }
  for (const row of (accessRows ?? []) as Array<{ roster_student_id: string | null; claimed_by: string | null }>) {
    if (row.roster_student_id && row.claimed_by) claimedRosterIds.add(row.roster_student_id);
  }

  const unclaimedRosterIds = ((rosterRows ?? []) as Array<{ id: string; claimed_by: string | null }>)
    .map((row) => row.id)
    .filter((id) => !claimedRosterIds.has(id));
  const deletedRosterStudents = unclaimedRosterIds.length;
  const deletedAccessCodes = ((accessRows ?? []) as Array<{ roster_student_id: string | null; claimed_by: string | null }>)
    .filter((row) => row.roster_student_id && unclaimedRosterIds.includes(row.roster_student_id) && !row.claimed_by)
    .length;

  if (unclaimedRosterIds.length > 0) {
    const deleteMemberships = await db
      .from("class_memberships")
      .delete()
      .eq("class_id", course.id)
      .in("roster_student_id", unclaimedRosterIds);
    if (deleteMemberships.error) throw new HttpError(500, "Failed to clear roster-linked memberships", deleteMemberships.error.message);

    const deleteCodes = await db
      .from("student_access_codes")
      .delete()
      .eq("class_id", course.id)
      .is("claimed_by", null)
      .in("roster_student_id", unclaimedRosterIds);
    if (deleteCodes.error) throw new HttpError(500, "Failed to delete unclaimed access codes", deleteCodes.error.message);

    const deleteRoster = await db
      .from("roster_students")
      .delete()
      .eq("class_id", course.id)
      .in("id", unclaimedRosterIds);
    if (deleteRoster.error) throw new HttpError(500, "Failed to delete roster students", deleteRoster.error.message);
  }

  await reconcileGradebookForCourse(db, userId, course.id);

  return {
    courseId: course.id,
    deletedRosterStudents,
    deletedAccessCodes,
    retainedClaimedStudents: claimedRosterIds.size,
    confirmationPhrase
  };
}

async function buildRosterPreview(db: AppDatabaseClient, courseId: string, csvText: string): Promise<TeacherRosterImportPreviewResponse> {
  const parsed = parseRosterCsv(csvText);
  const duplicateErrors = await collectDuplicateErrors(db, courseId, parsed.rows);
  const errors = [...parsed.errors, ...duplicateErrors].sort((a, b) => a.rowNumber - b.rowNumber);
  const blockedRows = new Set(errors.map((item) => item.rowNumber));

  return {
    courseId,
    totalRows: parsed.rows.length,
    acceptedRows: parsed.rows
      .filter((row) => !blockedRows.has(row.rowNumber))
      .map(toPreviewRow),
    errors: errors.map(toPreviewError)
  };
}

async function collectDuplicateErrors(db: AppDatabaseClient, courseId: string, rows: RosterCsvRow[]): Promise<RosterCsvError[]> {
  const errors: RosterCsvError[] = [];
  const identifierMap = new Map<string, number>();
  const emailMap = new Map<string, number>();

  for (const row of rows) {
    if (row.studentIdentifier) {
      const normalized = normalizeIdentifier(row.studentIdentifier);
      const previous = identifierMap.get(normalized);
      if (typeof previous === "number") {
        errors.push({ rowNumber: previous, field: "student_identifier", message: DUPLICATE_IDENTIFIER_MESSAGE });
        errors.push({ rowNumber: row.rowNumber, field: "student_identifier", message: DUPLICATE_IDENTIFIER_MESSAGE });
      } else {
        identifierMap.set(normalized, row.rowNumber);
      }
    }

    if (row.email) {
      const normalized = normalizeEmail(row.email);
      const previous = emailMap.get(normalized);
      if (typeof previous === "number") {
        errors.push({ rowNumber: previous, field: "email", message: DUPLICATE_EMAIL_MESSAGE });
        errors.push({ rowNumber: row.rowNumber, field: "email", message: DUPLICATE_EMAIL_MESSAGE });
      } else {
        emailMap.set(normalized, row.rowNumber);
      }
    }
  }

  const { data: existingRows, error } = await db
    .from("roster_students")
    .select("id, student_identifier, email")
    .eq("class_id", courseId);
  if (error && isMissingRosterSchema(error)) {
    throw new HttpError(409, "Roster import requires database migration 0004_roster_import.sql");
  }
  if (error) throw new HttpError(500, "Failed to validate roster duplicates", error.message);

  const existingIdentifiers = new Set<string>();
  const existingEmails = new Set<string>();
  for (const row of (existingRows ?? []) as Array<{ student_identifier: string | null; email: string | null }>) {
    if (row.student_identifier) existingIdentifiers.add(normalizeIdentifier(row.student_identifier));
    if (row.email) existingEmails.add(normalizeEmail(row.email));
  }

  for (const row of rows) {
    if (row.studentIdentifier && existingIdentifiers.has(normalizeIdentifier(row.studentIdentifier))) {
      errors.push({ rowNumber: row.rowNumber, field: "student_identifier", message: DUPLICATE_IDENTIFIER_MESSAGE });
    }
    if (row.email && existingEmails.has(normalizeEmail(row.email))) {
      errors.push({ rowNumber: row.rowNumber, field: "email", message: DUPLICATE_EMAIL_MESSAGE });
    }
  }

  return dedupeErrors(errors);
}

async function getCsvText(request: Request): Promise<string> {
  const body = await readJson<Record<string, unknown>>(request);
  return getRequiredString(body, "csvText");
}

async function teacherExists(db: AppDatabaseClient): Promise<boolean> {
  const { data, error } = await db
    .from("profiles")
    .select("id")
    .eq("role", "teacher")
    .limit(1);
  if (error) throw new HttpError(500, "Failed to check teacher setup status", error.message);
  return Array.isArray(data) && data.length > 0;
}

export async function requireTeacherProfile(db: AppDatabaseClient, userId: string): Promise<TeacherProfileRow> {
  const { data, error } = await db
    .from("profiles")
    .select("id, display_name, role")
    .eq("id", userId)
    .maybeSingle();
  if (error) throw new HttpError(500, "Failed to load teacher profile", error.message);
  if (!data || data.role !== "teacher") {
    throw new HttpError(403, "Teacher access required");
  }
  return { id: data.id, display_name: data.display_name };
}

async function requireOwnedCourse(db: AppDatabaseClient, userId: string, courseId: string): Promise<{ id: string; code: string }> {
  await requireTeacherProfile(db, userId);
  const { data, error } = await db
    .from("classes")
    .select("id, code")
    .eq("id", courseId)
    .eq("teacher_id", userId)
    .maybeSingle();
  if (error) throw new HttpError(500, "Failed to load course", error.message);
  if (!data) throw new HttpError(404, "Course not found");
  return { id: data.id, code: data.code };
}

function toTeacherCourse(row: CourseRow): TeacherCourse {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    section: row.section ?? null,
    term: row.term ?? null,
    archivedAt: row.archived_at ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at ?? row.created_at
  };
}

function toPreviewRow(row: RosterCsvRow): TeacherRosterImportPreviewRow {
  return {
    rowNumber: row.rowNumber,
    displayName: row.displayName,
    studentIdentifier: row.studentIdentifier,
    email: row.email,
    section: row.section
  };
}

function toPreviewError(error: RosterCsvError): TeacherRosterImportPreviewError {
  return {
    rowNumber: error.rowNumber,
    field: error.field,
    message: error.message
  };
}

function normalizeIdentifier(value: string): string {
  return value.trim().toUpperCase();
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function getNullableString(input: Record<string, unknown>, key: string): string | null {
  if (!(key in input)) return null;
  const value = input[key];
  if (value === null) return null;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function dedupeErrors(errors: RosterCsvError[]): RosterCsvError[] {
  const seen = new Set<string>();
  const output: RosterCsvError[] = [];
  for (const error of errors) {
    const key = `${error.rowNumber}:${error.field}:${error.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(error);
  }
  return output;
}

function handleCourseWriteError(error: { code?: string; message?: string }, fallback: string): never {
  if (error.code === "23505" || error.message?.toLowerCase().includes("duplicate")) {
    throw new HttpError(409, DUPLICATE_CODE_MESSAGE);
  }
  throw new HttpError(500, fallback, error.message);
}

function handleRosterWriteError(error: { code?: string; message?: string }): never {
  const message = `${error.code ?? ""} ${error.message ?? ""}`.toLowerCase();
  if (message.includes("identifier")) {
    throw new HttpError(409, DUPLICATE_IDENTIFIER_MESSAGE);
  }
  if (message.includes("email")) {
    throw new HttpError(409, DUPLICATE_EMAIL_MESSAGE);
  }
  throw new HttpError(500, "Failed to save roster student", error.message);
}

function isMissingCourseMetadata(error: { code?: string; message?: string; details?: string }): boolean {
  const text = `${error.code ?? ""} ${error.message ?? ""} ${error.details ?? ""}`.toLowerCase();
  return (
    text.includes("pgrst204") ||
    text.includes("42703") ||
    (
      text.includes("column") &&
      (text.includes("section") || text.includes("term") || text.includes("archived_at") || text.includes("updated_at"))
    )
  );
}

function throwMissingCourseMetadata(): never {
  throw new HttpError(409, COURSE_METADATA_MIGRATION_MESSAGE);
}

function isMissingReleaseHardeningRpc(error: { code?: string; message?: string; details?: string; hint?: string }): boolean {
  const text = `${error.code ?? ""} ${error.message ?? ""} ${error.details ?? ""} ${error.hint ?? ""}`.toLowerCase();
  return text.includes("claim_first_teacher") || text.includes("42883") || text.includes("pgrst202");
}

function isTeacherSetupAlreadyCompleted(error: { code?: string; message?: string; details?: string; hint?: string }): boolean {
  const text = `${error.code ?? ""} ${error.message ?? ""} ${error.details ?? ""} ${error.hint ?? ""}`.toLowerCase();
  return text.includes("teacher setup has already been completed") || text.includes("teacher setup already completed");
}

function isMissingRosterSchema(error: { code?: string; message?: string; details?: string; hint?: string }): boolean {
  const text = `${error.code ?? ""} ${error.message ?? ""} ${error.details ?? ""} ${error.hint ?? ""}`.toLowerCase();
  return (
    text.includes("pgrst205") ||
    text.includes("42p01") ||
    text.includes("roster_students") ||
    text.includes("roster_student_id")
  );
}

function generatePin(): string {
  const bytes = new Uint32Array(1);
  crypto.getRandomValues(bytes);
  return String(bytes[0] % 1_000_000).padStart(6, "0");
}

function timingSafeStringEqual(a: string, b: string): boolean {
  const maxLength = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let index = 0; index < maxLength; index += 1) {
    diff |= (a.charCodeAt(index) || 0) ^ (b.charCodeAt(index) || 0);
  }
  return diff === 0;
}

async function loadUserEmail(env: Env, token: string): Promise<string | null> {
  const response = await fetch(`${env.SUPABASE_URL}/auth/v1/user`, {
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: env.SUPABASE_SERVICE_ROLE_KEY
    }
  });
  if (!response.ok) return null;
  const payload = await response.json().catch(() => null) as { email?: unknown } | null;
  return typeof payload?.email === "string" ? payload.email : null;
}
