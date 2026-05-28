import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { StudentAssignmentSummary, StudentCourseAssignments } from "@alt-assessment/shared";
import {
  ApiRequestError,
  getStudentAuthEmail,
  getStudentSession,
  signInStudentWithGoogle as startStudentGoogleSignIn,
  signOutStudent,
  type StudentProfile
} from "../lib/api";
import {
  completeStudentAuthCallbackIfPresent,
  getCurrentAuthCallbackSnapshot,
  isSupabaseConfigured,
  isStudentAuthCallbackSnapshot,
  resetStudentSupabaseAuthState,
  studentSupabase
} from "../lib/supabase";
import {
  canUseCachedStudentSession,
  clearCachedStudentSession,
  flattenStudentAssignments,
  readCachedStudentSession,
  writeCachedStudentSession
} from "./studentSessionCache";

export type StudentSessionStatus = "checking" | "signed_out" | "needs_enrollment" | "authenticated";
export type StudentAuthStep =
  | "idle"
  | "checking_existing_session"
  | "completing_google_callback"
  | "reading_google_session"
  | "loading_student_workspace"
  | "resetting";

interface SessionState {
  status: StudentSessionStatus;
  authStep: StudentAuthStep;
  loading: boolean;
  authError: string | null;
  authEmail: string | null;
  profile: StudentProfile | null;
  courses: StudentCourseAssignments[];
  assignments: StudentAssignmentSummary[];
  refresh: () => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  logout: () => Promise<void>;
}

const SessionContext = createContext<SessionState | null>(null);
const BOOTSTRAP_TIMEOUT_MS = 20000;
const CHECKING_WATCHDOG_MS = 22000;
const CHECKING_WATCHDOG_RECOVERY_MS = 1000;
const CHECKING_HARD_TIMEOUT_MS = 45000;
type SessionRefreshMode = "blocking" | "background";

export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<StudentSessionStatus>("checking");
  const [authStep, setAuthStep] = useState<StudentAuthStep>("checking_existing_session");
  const [authError, setAuthError] = useState<string | null>(null);
  const [authEmail, setAuthEmail] = useState<string | null>(null);
  const [profile, setProfile] = useState<StudentProfile | null>(null);
  const [courses, setCourses] = useState<StudentCourseAssignments[]>([]);
  const [assignments, setAssignments] = useState<StudentAssignmentSummary[]>([]);
  const activeOperationRef = useRef(0);
  const mountedRef = useRef(true);
  const statusRef = useRef<StudentSessionStatus>("checking");

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  const beginOperation = useCallback(() => {
    activeOperationRef.current += 1;
    return activeOperationRef.current;
  }, []);

  const isCurrentOperation = useCallback((operationId: number) => {
    return mountedRef.current && activeOperationRef.current === operationId;
  }, []);

  const setSessionState = useCallback((
    nextStatus: StudentSessionStatus,
    nextAuthEmail: string | null,
    nextProfile: StudentProfile | null,
    nextCourses: StudentCourseAssignments[],
    nextAuthError: string | null = null
  ) => {
    statusRef.current = nextStatus;
    setStatus(nextStatus);
    setAuthStep("idle");
    setAuthError(nextAuthError);
    setAuthEmail(nextAuthEmail);
    setProfile(nextProfile);
    setCourses(nextCourses);
    setAssignments(flattenStudentAssignments(nextCourses));
  }, []);

  const applyChecking = useCallback((nextStep: StudentAuthStep) => {
    statusRef.current = "checking";
    setStatus("checking");
    setAuthStep(nextStep);
    setAuthError(null);
  }, []);

  const applySignedOut = useCallback((nextAuthError: string | null = null) => {
    resetStudentSupabaseAuthState();
    clearCachedStudentSession();
    setSessionState("signed_out", null, null, [], nextAuthError);
  }, [setSessionState]);

  const applyNeedsEnrollment = useCallback((nextAuthEmail: string) => {
    setSessionState("needs_enrollment", nextAuthEmail, null, []);
  }, [setSessionState]);

  const applyAuthCheckError = useCallback((nextAuthEmail: string | null, nextAuthError: string) => {
    clearCachedStudentSession();
    setSessionState("signed_out", nextAuthEmail, null, [], nextAuthError);
  }, [setSessionState]);

  const applyAuthenticated = useCallback((
    nextAuthEmail: string,
    nextProfile: StudentProfile,
    nextCourses: StudentCourseAssignments[]
  ) => {
    writeCachedStudentSession({ authEmail: nextAuthEmail, profile: nextProfile, courses: nextCourses });
    setSessionState("authenticated", nextAuthEmail, nextProfile, nextCourses);
  }, [setSessionState]);

  const runSessionRefresh = useCallback(async (mode: SessionRefreshMode) => {
    const operationId = beginOperation();
    const authCallbackSnapshot = getCurrentAuthCallbackSnapshot();
    const isStudentCallback = isStudentAuthCallbackSnapshot(authCallbackSnapshot);
    const blocking = mode === "blocking" || isStudentCallback || statusRef.current !== "authenticated";
    const applyProgress = (nextStep: StudentAuthStep) => {
      if (blocking) applyChecking(nextStep);
    };

    applyProgress("checking_existing_session");
    try {
      if (!isSupabaseConfigured) {
        if (!isCurrentOperation(operationId)) return;
        if (blocking) applySignedOut();
        return;
      }
      if (isStudentCallback) {
        applyProgress("completing_google_callback");
      }
      await withTimeout(
        completeStudentAuthCallbackIfPresent(authCallbackSnapshot),
        BOOTSTRAP_TIMEOUT_MS,
        "Google sign-in timed out"
      );
      if (!isCurrentOperation(operationId)) return;
      applyProgress("reading_google_session");
      const currentAuthEmail = await getStudentAuthEmail();
      if (!isCurrentOperation(operationId)) return;
      if (!currentAuthEmail) {
        if (blocking) {
          applySignedOut(isStudentCallback
            ? "Google sign-in returned to the app, but no Supabase session was stored. Use Reset sign-in, then try Google again."
            : null);
        }
        return;
      }

      setAuthEmail(currentAuthEmail);
      applyProgress("loading_student_workspace");

      try {
        const session = await withTimeout(
          getStudentSession(),
          BOOTSTRAP_TIMEOUT_MS,
          "Session bootstrap timed out"
        );
        if (!isCurrentOperation(operationId)) return;
        if (session.profile) {
          applyAuthenticated(currentAuthEmail, session.profile, session.courses);
        } else {
          clearCachedStudentSession();
          const enrollmentError = resolveEnrollmentStatusMessage(session.enrollmentStatus);
          if (session.enrollmentStatus === "teacher_profile") {
            applyAuthCheckError(currentAuthEmail, enrollmentError ?? "This Google account cannot be used for student login.");
          } else {
            setSessionState("needs_enrollment", currentAuthEmail, null, [], enrollmentError);
          }
        }
      } catch (error) {
        if (!isCurrentOperation(operationId)) return;
        if (isUnauthorizedApiError(error)) {
          clearCachedStudentSession();
          applySignedOut("Google session could not be verified. Sign in again.");
          return;
        }
        if (isForbiddenApiError(error)) {
          applyAuthCheckError(currentAuthEmail, resolveAuthCheckFailure(error));
          return;
        }
        const cached = readCachedStudentSession();
        if (canUseCachedStudentSession(cached, currentAuthEmail, "session_fetch_failed")) {
          applyAuthenticated(cached.authEmail, cached.profile, cached.courses);
          return;
        }
        if (!blocking) return;
        clearCachedStudentSession();
        applyAuthCheckError(currentAuthEmail, resolveAuthCheckFailure(error));
      }
    } catch (error) {
      if (!isCurrentOperation(operationId)) return;
      if (blocking) {
        applySignedOut(isStudentCallback ? resolveAuthCheckFailure(error) : null);
      }
    }
  }, [applyAuthCheckError, applyAuthenticated, applyChecking, applySignedOut, beginOperation, isCurrentOperation, setSessionState]);

  const refresh = useCallback(async () => {
    await runSessionRefresh("blocking");
  }, [runSessionRefresh]);

  useEffect(() => {
    refresh().catch(() => undefined);
  }, [refresh]);

  useEffect(() => {
    if (status !== "checking") return;
    const timer = setTimeout(() => {
      const operationId = beginOperation();
      void withTimeout(
        getStudentAuthEmail(),
        CHECKING_WATCHDOG_RECOVERY_MS,
        "Session bootstrap timed out."
      ).then((currentAuthEmail) => {
        if (!isCurrentOperation(operationId)) return;
        if (currentAuthEmail) {
          applyNeedsEnrollment(currentAuthEmail);
          return;
        }
        applySignedOut("Session bootstrap timed out.");
      }).catch(() => {
        if (isCurrentOperation(operationId)) {
          applySignedOut("Session bootstrap timed out.");
        }
      });
    }, CHECKING_WATCHDOG_MS);
    return () => clearTimeout(timer);
  }, [applyNeedsEnrollment, applySignedOut, beginOperation, isCurrentOperation, status]);

  useEffect(() => {
    if (status !== "checking") return;
    const timer = setTimeout(() => {
      if (mountedRef.current && statusRef.current === "checking") {
        applySignedOut("Session check took too long. Sign in again.");
      }
    }, CHECKING_HARD_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [applySignedOut, status]);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;
    const scheduleRefresh = (mode: SessionRefreshMode) => {
      if (statusRef.current === "checking") return;
      if (refreshTimer) clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => {
        runSessionRefresh(mode).catch(() => undefined);
      }, 0);
    };
    const { data } = studentSupabase.auth.onAuthStateChange((event) => {
      if (event === "INITIAL_SESSION") return;
      if (event === "SIGNED_OUT") {
        scheduleRefresh("blocking");
      }
      if (event === "SIGNED_IN" || event === "TOKEN_REFRESHED") {
        scheduleRefresh(statusRef.current === "authenticated" ? "background" : "blocking");
      }
    });
    return () => {
      if (refreshTimer) clearTimeout(refreshTimer);
      data.subscription.unsubscribe();
    };
  }, [runSessionRefresh]);

  const signInWithGoogle = useCallback(async () => {
    await startStudentGoogleSignIn();
  }, []);

  const logout = useCallback(async () => {
    const operationId = beginOperation();
    applyChecking("resetting");
    try {
      await signOutStudent();
    } finally {
      if (!isCurrentOperation(operationId)) return;
      applySignedOut();
    }
  }, [applyChecking, applySignedOut, beginOperation, isCurrentOperation]);

  const value = useMemo(
    () => ({
      status,
      authStep,
      loading: status === "checking",
      authError,
      authEmail,
      profile,
      courses,
      assignments,
      refresh,
      signInWithGoogle,
      logout
    }),
    [status, authStep, authError, authEmail, profile, courses, assignments, refresh, signInWithGoogle, logout]
  );
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const context = useContext(SessionContext);
  if (!context) throw new Error("useSession must be used inside SessionProvider");
  return context;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race<T>([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), timeoutMs);
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function isUnauthorizedApiError(error: unknown): boolean {
  return error instanceof ApiRequestError && error.status === 401;
}

function isForbiddenApiError(error: unknown): boolean {
  return error instanceof ApiRequestError && error.status === 403;
}

function resolveEnrollmentStatusMessage(status: string | undefined): string | null {
  if (status === "claimed_by_other") {
    return "This Google account matches a roster record that is already claimed. Ask your teacher to check the roster.";
  }
  if (status === "teacher_profile") {
    return "This Google account is registered as a teacher account. Use a student Google account.";
  }
  if (status === "identity_conflict") {
    return "This Google account is already linked to a different student record for this course. Ask your teacher to check the roster.";
  }
  return null;
}

function resolveAuthCheckFailure(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  return "Google sign-in did not finish. Try again, or use Reset sign-in.";
}
