import type { SupabaseClient } from "@supabase/supabase-js";
import type { StudentEnrollmentStatus } from "@alt-assessment/shared";
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

interface StudentAutoEnrollmentResult {
  profile: StudentProfileRow | null;
  status: StudentEnrollmentStatus;
}

export async function studentLogin(request: Request, env: Env, db: SupabaseClient, userId: string, email: string) {
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
  db: SupabaseClient,
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

export async function studentSession(db: SupabaseClient, userId: string, email?: string | null) {
  const existingProfile = await loadStudentProfile(db, userId);
  let status: StudentEnrollmentStatus = "no_roster_match";
  let studentProfile = existingProfile?.role === "student" ? existingProfile : null;

  if (existingProfile?.role === "teacher") {
    status = "teacher_profile";
  } else if (studentProfile) {
    status = "matched";
  } else if (email) {
    const enrollment = await autoEnrollStudentByEmail(db, userId, email);
    studentProfile = enrollment.profile;
    status = enrollment.status;
  }

  const courses = studentProfile ? await listStudentCourseAssignments(db, userId) : [];
  return {
    profile: studentProfile ? { id: userId, displayName: studentProfile.display_name, email: studentProfile.email ?? undefined } : null,
    courses,
    enrollmentStatus: status
  };
}

async function loadStudentProfile(db: SupabaseClient, userId: string): Promise<StudentProfileRow | null> {
  const { data: profile, error: profileError } = await db
    .from("profiles")
    .select("id, display_name, role, email")
    .eq("id", userId)
    .maybeSingle();
  if (profileError) {
    throw new HttpError(500, "Failed to load student session", profileError.message);
  }

  return profile ? profile as StudentProfileRow : null;
}

async function autoEnrollStudentByEmail(db: SupabaseClient, userId: string, email: string): Promise<StudentAutoEnrollmentResult> {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) return { profile: null, status: "no_roster_match" };

  const { data: existingProfile, error: profileReadError } = await db
    .from("profiles")
    .select("id, role, display_name, email")
    .eq("id", userId)
    .maybeSingle();
  if (profileReadError) throw new HttpError(500, "Failed to load student profile", profileReadError.message);
  if ((existingProfile as StudentProfileRow | null)?.role === "teacher") {
    return { profile: null, status: "teacher_profile" };
  }

  const rosterRows = (await loadRosterRowsByEmail(db, normalizedEmail))
    .filter((row) => normalizeEmail(row.email) === normalizedEmail);
  if (rosterRows.length === 0) return { profile: null, status: "no_roster_match" };

  const claimableRows = rosterRows.filter((row) => !row.claimed_by || row.claimed_by === userId);
  if (claimableRows.length === 0) return { profile: null, status: "claimed_by_other" };

  const classIds = Array.from(new Set(claimableRows.map((row) => row.class_id)));
  const [memberships, accessClaims] = await Promise.all([
    loadStudentMembershipsForClasses(db, userId, classIds),
    loadStudentAccessClaimsForClasses(db, userId, classIds)
  ]);
  const membershipByClass = new Map(memberships.map((row) => [row.class_id, row]));
  const accessClaimByClass = new Map(accessClaims.map((row) => [row.class_id, row]));
  const enrollableRows = claimableRows.filter((row) => {
    const membership = membershipByClass.get(row.class_id);
    if (membership && membership.roster_student_id !== row.id) return false;
    const accessClaim = accessClaimByClass.get(row.class_id);
    if (accessClaim && accessClaim.roster_student_id !== row.id) return false;
    return true;
  });
  if (enrollableRows.length === 0) return { profile: null, status: "identity_conflict" };

  const now = new Date().toISOString();
  const displayName = enrollableRows[0].display_name;
  const { error: profileWriteError } = await db
    .from("profiles")
    .upsert({
      id: userId,
      role: "student",
      display_name: displayName,
      email: normalizedEmail,
      updated_at: now
    }, { onConflict: "id" });
  if (profileWriteError) throw new HttpError(500, "Failed to save student profile", profileWriteError.message);

  for (const roster of enrollableRows) {
    const { error: membershipError } = await db
      .from("class_memberships")
      .upsert({
        class_id: roster.class_id,
        student_id: userId,
        display_name: roster.display_name,
        roster_student_id: roster.id
      }, { onConflict: "class_id,student_id" });
    if (membershipError) throw new HttpError(500, "Failed to save class membership", membershipError.message);

    const { error: accessUpdateError } = await db
      .from("student_access_codes")
      .update({ claimed_by: userId, claimed_at: now })
      .eq("roster_student_id", roster.id);
    if (accessUpdateError) throw new HttpError(500, "Failed to claim student access code", accessUpdateError.message);

    const { error: rosterUpdateError } = await db
      .from("roster_students")
      .update({
        claimed_by: userId,
        claimed_at: roster.claimed_at ?? now,
        updated_at: now
      })
      .eq("id", roster.id);
    if (rosterUpdateError) throw new HttpError(500, "Failed to claim roster student", rosterUpdateError.message);
  }

  return {
    profile: {
      id: userId,
      role: "student",
      display_name: displayName,
      email: normalizedEmail
    },
    status: "matched"
  };
}

async function loadRosterRowsByEmail(db: SupabaseClient, normalizedEmail: string): Promise<StudentRosterRow[]> {
  const select = "id, class_id, display_name, email, claimed_by, claimed_at";
  const normalized = await db
    .from("roster_students")
    .select(select)
    .eq("email_normalized", normalizedEmail);
  if (!normalized.error) return (normalized.data ?? []) as StudentRosterRow[];
  if (!isMissingEmailNormalizedColumn(normalized.error)) {
    throw new HttpError(500, "Failed to match student roster email", normalized.error.message);
  }

  const fallback = await db
    .from("roster_students")
    .select(select)
    .ilike("email", normalizedEmail);
  if (fallback.error) throw new HttpError(500, "Failed to match student roster email", fallback.error.message);
  return (fallback.data ?? []) as StudentRosterRow[];
}

async function loadStudentMembershipsForClasses(
  db: SupabaseClient,
  userId: string,
  classIds: string[]
): Promise<StudentMembershipRow[]> {
  if (classIds.length === 0) return [];
  const { data, error } = await db
    .from("class_memberships")
    .select("class_id, roster_student_id")
    .eq("student_id", userId)
    .in("class_id", classIds);
  if (error) throw new HttpError(500, "Failed to load class memberships", error.message);
  return (data ?? []) as StudentMembershipRow[];
}

async function loadStudentAccessClaimsForClasses(
  db: SupabaseClient,
  userId: string,
  classIds: string[]
): Promise<StudentAccessCodeClaimRow[]> {
  if (classIds.length === 0) return [];
  const { data, error } = await db
    .from("student_access_codes")
    .select("class_id, roster_student_id")
    .eq("claimed_by", userId)
    .in("class_id", classIds);
  if (error) throw new HttpError(500, "Failed to load student access claims", error.message);
  return (data ?? []) as StudentAccessCodeClaimRow[];
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
