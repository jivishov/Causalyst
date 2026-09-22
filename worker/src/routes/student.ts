import type { AppDatabaseClient } from "../lib/database";
import { isJsonObject } from "../lib/database";
import { hashPin } from "../lib/crypto";
import { normalizeCourseCode } from "../lib/courseCode";
import { HttpError, getRequiredString, readJson } from "../lib/http";
import type { Env } from "../lib/env";
import { listStudentCourseAssignments } from "../lib/db";

interface StudentGoogleClaimRow {
  claim_status: string;
  class_id: string | null;
  class_code: string | null;
  class_name: string | null;
  roster_student_id: string | null;
  display_name: string | null;
  previous_user_id: string | null;
}

interface StudentLegacyAccessCodeRow {
  id: string;
  class_id: string;
  student_label: string | null;
  claimed_by: string | null;
  roster_student_id: string | null;
}

interface StudentClassRow {
  id: string;
  code: string;
  name: string;
}

interface StudentProfileRow {
  id: string;
  role: string;
  display_name: string;
  email: string | null;
}

interface StudentRosterRow {
  id: string;
  class_id: string;
  display_name: string;
  email: string | null;
  claimed_by: string | null;
  claimed_at: string | null;
}

interface StudentMembershipRow {
  class_id: string;
  roster_student_id: string | null;
}

interface StudentAccessCodeClaimRow {
  class_id: string;
  roster_student_id: string | null;
}

export async function studentLogin(request: Request, env: Env, db: AppDatabaseClient, userId: string, email: string) {
  if (!env.PIN_PEPPER || env.PIN_PEPPER.trim() === "") {
    throw new HttpError(500, "Worker PIN_PEPPER is not configured");
  }

  const body = await readJson<Record<string, unknown>>(request);
  const classCode = normalizeCourseCode(getRequiredString(body, "classCode"));
  const pin = getRequiredString(body, "pin");
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail) {
    throw new HttpError(403, "Student Google sign-in required");
  }

  let pinHash: string;
  try {
    pinHash = await hashPin(pin, env);
  } catch (error) {
    throw new HttpError(500, "Failed to compute PIN hash", error instanceof Error ? error.message : "Unknown hash error");
  }

  const { data, error } = await db.rpc("claim_student_google_login", {
    p_user_id: userId,
    p_email: normalizedEmail,
    p_class_code: classCode,
    p_pin_hash: pinHash
  });
  if (error) {
    if (isMissingGoogleLoginRpc(error)) {
      throw new HttpError(
        503,
        "Student login is temporarily unavailable. Ask your teacher to contact support.",
        undefined,
        "student_login_unavailable"
      );
    }
    throw new HttpError(
      503,
      "Student login is temporarily unavailable. Ask your teacher to contact support.",
      error.message,
      "student_login_unavailable"
    );
  }

  const claim = firstClaimRow(data);
  if (!claim) throw new HttpError(500, "Student login claim did not return a result");
  if (claim.claim_status === "roster_email_required" && !claim.roster_student_id) {
    return studentLegacyPinLogin(db, userId, normalizedEmail, pinHash, claim);
  }
  if (claim.claim_status !== "success") {
    throwStudentClaimError(claim);
  }
  if (!claim.display_name || !claim.class_name || !claim.class_code) {
    throw new HttpError(500, "Student login claim returned incomplete profile data");
  }

  const courses = await listStudentCourseAssignments(db, userId);
  return {
    profile: {
      id: userId,
      displayName: claim.display_name,
      email: normalizedEmail,
      className: claim.class_name,
      classCode: claim.class_code
    },
    courses,
    enrollmentStatus: "matched"
  };
}

async function studentLegacyPinLogin(
  db: AppDatabaseClient,
  userId: string,
  email: string,
  pinHash: string,
  claim: StudentGoogleClaimRow
) {
  if (!claim.class_id) {
    throwStudentClaimError(claim);
  }

  const { data: classRow, error: classError } = await db
    .from("classes")
    .select("id, code, name")
    .eq("id", claim.class_id)
    .maybeSingle();
  if (classError) throw new HttpError(500, "Failed to load class for student login", classError.message);
  if (!classRow) throwStudentClaimError(claim);

  const { data: accessRow, error: accessError } = await db
    .from("student_access_codes")
    .select("id, class_id, student_label, claimed_by, roster_student_id")
    .eq("class_id", claim.class_id)
    .eq("pin_hash", pinHash)
    .maybeSingle();
  if (accessError) throw new HttpError(500, "Failed to load student access code", accessError.message);
  const access = accessRow as StudentLegacyAccessCodeRow | null;
  if (!access || access.roster_student_id) {
    throwStudentClaimError(claim);
  }

  const { data: existingProfile, error: profileReadError } = await db
    .from("profiles")
    .select("id, role, display_name, email")
    .eq("id", userId)
    .maybeSingle();
  if (profileReadError) throw new HttpError(500, "Failed to load student profile", profileReadError.message);
  if ((existingProfile as StudentProfileRow | null)?.role === "teacher") {
    throw new HttpError(403, "Student Google sign-in required");
  }

  const now = new Date().toISOString();
  const displayName = resolveLegacyDisplayName(access.student_label, email);
  const { error: profileWriteError } = await db
    .from("profiles")
    .upsert({
      id: userId,
      role: "student",
      display_name: displayName,
      email,
      updated_at: now
    }, { onConflict: "id" });
  if (profileWriteError) throw new HttpError(500, "Failed to save student profile", profileWriteError.message);

  const { error: membershipError } = await db
    .from("class_memberships")
    .upsert({
      class_id: (classRow as StudentClassRow).id,
      student_id: userId,
      display_name: displayName,
      roster_student_id: null
    }, { onConflict: "class_id,student_id" });
  if (membershipError) throw new HttpError(500, "Failed to save class membership", membershipError.message);

  const { error: accessUpdateError } = await db
    .from("student_access_codes")
    .update(access.claimed_by ? { claimed_by: userId } : { claimed_by: userId, claimed_at: now })
    .eq("id", access.id);
  if (accessUpdateError) throw new HttpError(500, "Failed to claim student access code", accessUpdateError.message);

  const course = classRow as StudentClassRow;
  const courses = await listStudentCourseAssignments(db, userId);
  return {
    profile: {
      id: userId,
      displayName,
      email,
      className: course.name,
      classCode: course.code
    },
    courses,
    enrollmentStatus: "matched"
  };
}

function resolveLegacyDisplayName(studentLabel: string | null, email: string): string {
  const label = studentLabel?.trim();
  if (label) return label;
  const localPart = email.split("@")[0]?.replace(/[._-]+/g, " ").trim();
  return localPart || "Student";
}

function normalizeEmail(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

export async function studentSession(db: AppDatabaseClient, userId: string, _email?: string | null) {
  // Reconcile every login, including existing profiles. The transaction reads
  // verified email from Auth, never an email supplied by the browser.
  const { data, error } = await db.rpc("enroll_student_by_email", { p_user_id: userId });
  if (error) throw new HttpError(error.code === "23514" ? 409 : 500, "Failed to reconcile student enrollment", error.message);
  if (!isJsonObject(data)) throw new HttpError(500, "Invalid enrollment response");
  const status = data.status;
  if (status !== "matched" && status !== "no_roster_match" && status !== "claimed_by_other"
    && status !== "teacher_profile" && status !== "identity_conflict") {
    throw new HttpError(500, "Invalid enrollment status");
  }
  const profile = data.profile;
  if (profile !== null && (!isJsonObject(profile) || profile.id !== userId || profile.role !== "student"
    || typeof profile.display_name !== "string" || (profile.email !== null && typeof profile.email !== "string"))) {
    throw new HttpError(500, "Invalid enrollment profile");
  }
  return {
    profile: profile ? { id: userId, displayName: String(profile.display_name), email: typeof profile.email === "string" ? profile.email : undefined } : null,
    courses: profile ? await listStudentCourseAssignments(db, userId) : [],
    enrollmentStatus: status
  };
}

function firstClaimRow(value: unknown): StudentGoogleClaimRow | null {
  if (Array.isArray(value)) return (value[0] as StudentGoogleClaimRow | undefined) ?? null;
  if (value && typeof value === "object") return value as StudentGoogleClaimRow;
  return null;
}

function throwStudentClaimError(claim: StudentGoogleClaimRow): never {
  if (claim.claim_status === "invalid_credentials") {
    throw new HttpError(403, "Class code or PIN was not accepted");
  }
  if (claim.claim_status === "roster_email_required") {
    throw new HttpError(
      403,
      "This roster PIN needs a student email before Google login can be used",
      { classCode: claim.class_code },
      "roster_email_required"
    );
  }
  if (claim.claim_status === "roster_email_mismatch") {
    throw new HttpError(
      403,
      "Use the Google account that matches this roster PIN",
      { classCode: claim.class_code },
      "roster_email_mismatch"
    );
  }
  if (claim.claim_status === "same_course_identity_conflict") {
    throw new HttpError(
      409,
      "This Google account is already joined to this course with a different PIN",
      { classCode: claim.class_code },
      "same_course_identity_conflict"
    );
  }
  if (claim.claim_status === "teacher_profile") {
    throw new HttpError(403, "Student Google sign-in required");
  }
  throw new HttpError(500, `Unexpected student login claim status: ${claim.claim_status}`);
}

function isMissingGoogleLoginRpc(error: { code?: string; message?: string; details?: string; hint?: string }): boolean {
  const text = `${error.code ?? ""} ${error.message ?? ""} ${error.details ?? ""} ${error.hint ?? ""}`.toLowerCase();
  return text.includes("claim_student_google_login") || text.includes("pgrst202") || text.includes("could not find the function");
}

function isMissingEmailNormalizedColumn(error: { code?: string; message?: string; details?: string; hint?: string }): boolean {
  const text = `${error.code ?? ""} ${error.message ?? ""} ${error.details ?? ""} ${error.hint ?? ""}`.toLowerCase();
  return text.includes("email_normalized") || text.includes("pgrst204") || text.includes("42703") || text.includes("column");
}
