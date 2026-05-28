import type { StudentAssignmentSummary, StudentCourseAssignments } from "@alt-assessment/shared";
import type { StudentProfile } from "../lib/api";

export const STUDENT_SESSION_CACHE_KEY = "alt-assessment.student-session.v2";

export interface CachedStudentSession {
  authEmail: string;
  profile: StudentProfile;
  courses: StudentCourseAssignments[];
}

export type StudentSessionCacheFailure =
  | "session_fetch_failed"
  | "auth_error"
  | "signed_out"
  | "anonymous"
  | "email_mismatch";

interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function readCachedStudentSession(storage: StorageLike = window.localStorage): CachedStudentSession | null {
  try {
    const raw = storage.getItem(STUDENT_SESSION_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedStudentSession;
    if (!isValidCachedStudentSession(parsed)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeCachedStudentSession(session: CachedStudentSession, storage: StorageLike = window.localStorage): void {
  storage.setItem(STUDENT_SESSION_CACHE_KEY, JSON.stringify(session));
}

export function clearCachedStudentSession(storage: StorageLike = window.localStorage): void {
  storage.removeItem(STUDENT_SESSION_CACHE_KEY);
}

export function canUseCachedStudentSession(
  cached: CachedStudentSession | null,
  currentAuthEmail: string | null,
  failure: StudentSessionCacheFailure
): cached is CachedStudentSession {
  if (!cached || !currentAuthEmail) return false;
  if (failure !== "session_fetch_failed") return false;
  return normalizeEmail(cached.authEmail) === normalizeEmail(currentAuthEmail);
}

export function flattenStudentAssignments(courses: StudentCourseAssignments[]): StudentAssignmentSummary[] {
  const rows = courses.flatMap((course) => course.assignments);
  return rows.sort((a, b) => {
    const left = a.dueAt ?? "";
    const right = b.dueAt ?? "";
    if (left && right) return left.localeCompare(right);
    if (left) return -1;
    if (right) return 1;
    return a.assessment.title.localeCompare(b.assessment.title);
  });
}

function isValidCachedStudentSession(value: CachedStudentSession): value is CachedStudentSession {
  return typeof value.authEmail === "string"
    && value.authEmail.trim().length > 0
    && typeof value.profile?.id === "string"
    && value.profile.id.trim().length > 0
    && Array.isArray(value.courses);
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
