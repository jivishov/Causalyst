import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  STUDENT_PROTECTED_ROUTES,
  STUDENT_PUBLIC_ROUTES,
  TEACHER_CHILD_ROUTES
} from "../src/routes/appRoutes";
import {
  canUseCachedStudentSession,
  readCachedStudentSession,
  STUDENT_SESSION_CACHE_KEY,
  type CachedStudentSession
} from "../src/state/studentSessionCache";

describe("frontend route guardrails", () => {
  it("keeps login as the only public student route", () => {
    expect(STUDENT_PUBLIC_ROUTES.map((route) => `${route.auth} ${route.path}`)).toEqual([
      "public /login"
    ]);
    expect(STUDENT_PROTECTED_ROUTES.map((route) => `${route.auth} ${route.path}`)).toEqual([
      "student /",
      "student /assignment/:assignmentId",
      "student /attempt/:attemptId",
      "student /final/:assignmentId"
    ]);
  });

  it("keeps assessment prompts visible before result feedback", () => {
    const attemptResultSource = readFileSync(new URL("../src/pages/AttemptResultPage.tsx", import.meta.url), "utf8");
    const finalResultSource = readFileSync(new URL("../src/pages/FinalResultPage.tsx", import.meta.url), "utf8");

    for (const source of [attemptResultSource, finalResultSource]) {
      expect(source).toContain("<h2>Assessment Prompt</h2>");
      expect(source).toContain("<p>{result.assessment.prompt}</p>");
      expect(source.indexOf("<h2>Assessment Prompt</h2>")).toBeLessThan(source.indexOf("<RubricFeedback"));
    }
    expect(finalResultSource).not.toContain('result.publishedGrade.finalStatus !== "approved_ai" &&');
  });

  it("keeps simulation refinement as a draft preview action before submit", () => {
    const assessmentSource = readFileSync(new URL("../src/pages/assessment/SimulationAssessment.tsx", import.meta.url), "utf8");
    const apiSource = readFileSync(new URL("../src/lib/api.ts", import.meta.url), "utf8");

    expect(assessmentSource).toContain("Refine to Match Sketch");
    expect(assessmentSource).toContain("Refining preview...");
    expect(assessmentSource).toContain("Could not refine preview. Current preview was not changed.");
    expect(assessmentSource).toContain("Cancel generation");
    expect(assessmentSource).toContain("Regenerate HTML Preview");
    expect(assessmentSource).toContain("html-reasoning-effort");
    expect(assessmentSource).toContain("Submit Simulation");
    expect(assessmentSource).toContain("void refineHtmlPreview();");
    expect(assessmentSource).toContain("void cancelHtmlGeneration();");
    expect(assessmentSource).toContain("void regenerateHtmlPreview();");
    expect(assessmentSource).toContain("void submitFinalSimulation();");
    expect(assessmentSource).toContain('void useStructuredFallback(["manual_fallback"]);');
    expect(assessmentSource).not.toContain("shouldAutoRunSimulationFallback");
    expect(assessmentSource).not.toContain("Repairing preview with structured fallback");
    expect(apiSource).toContain('"/simulation/refine"');
    expect(apiSource).toContain("/simulation/jobs/${jobId}/cancel");
    expect(apiSource).toContain('"/simulation/submit"');
  });

  it("keeps local frontend OAuth origin pinned to port 5173", () => {
    const viteSource = readFileSync(new URL("../vite.config.ts", import.meta.url), "utf8");

    expect(viteSource).toContain("port: 5173");
    expect(viteSource).toContain("strictPort: true");
  });

  it("uses one protected student layout instead of inline per-page guards", () => {
    const appSource = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");

    expect(appSource).toContain("function StudentProtectedLayout");
    expect(appSource).toContain("<Outlet />");
    expect(appSource).toContain("STUDENT_PROTECTED_ROUTES.map");
    expect(appSource).toContain('if (status === "checking")');
    expect(appSource).toContain("Still checking your Google session");
    expect(appSource).not.toContain('status === "checking" && !loadingTimedOut');
    expect(appSource).not.toContain("profile ?");
    expect(appSource.match(/<AppShell>/g) ?? []).toHaveLength(1);
  });

  it("keeps the student login page as a Google OAuth redirect surface", () => {
    const loginSource = readFileSync(new URL("../src/pages/Login.tsx", import.meta.url), "utf8");

    expect(loginSource).toContain("signInWithGoogle");
    expect(loginSource).toContain("google-oauth-button");
    expect(loginSource).toContain("getCanonicalLocalUrl");
    expect(loginSource).toContain("getLocalAuthOriginIssue");
    expect(loginSource).toContain('status === "authenticated"');
    expect(loginSource).toContain('status === "checking"');
    expect(loginSource).toContain('status === "needs_enrollment"');
    expect(loginSource).toContain("aria-busy={submitting}");
    expect(loginSource).toContain("AUTH_STEP_MESSAGES");
    expect(loginSource).toContain("Completing Google sign-in.");
    expect(loginSource).toContain("disabled={submitting || originBlocked}");
    expect(loginSource).not.toContain("loadGoogleIdentityScript");
    expect(loginSource).not.toContain("google.accounts.id.renderButton");
    expect(loginSource).not.toContain('disabled={submitting || status === "checking"');
    expect(loginSource).not.toContain('status === "checking" || originBlocked');
    expect(loginSource).not.toContain("Still checking your Google session");
    expect(loginSource).not.toContain("sessionCheckSlow");
    expect(loginSource).not.toContain("Authorized JavaScript origin");
    expect(loginSource).not.toContain("Google client");
    expect(loginSource).not.toContain("window.location.assign");
    expect(loginSource).not.toContain("classCode");
    expect(loginSource).not.toContain("pin");
  });

  it("does not re-enter Supabase Auth synchronously from auth-state callbacks", () => {
    const sessionSource = readFileSync(new URL("../src/state/session.tsx", import.meta.url), "utf8");
    const callbackBody = sessionSource.match(/onAuthStateChange\(\(event\) => \{([\s\S]*?)\n    \}\);/)?.[1] ?? "";

    expect(sessionSource).toContain("onAuthStateChange");
    expect(sessionSource).toContain('scheduleRefresh(statusRef.current === "authenticated" ? "background" : "blocking")');
    expect(sessionSource).toContain('runSessionRefresh(mode).catch');
    expect(sessionSource).toContain('statusRef.current === "checking"');
    expect(sessionSource).toContain("setTimeout(() =>");
    expect(callbackBody).not.toContain("refresh().catch");
    expect(callbackBody).not.toContain("runSessionRefresh(");
    expect(sessionSource).toContain('const blocking = mode === "blocking" || isStudentCallback || statusRef.current !== "authenticated";');
    expect(sessionSource).toContain('if (blocking) applyChecking(nextStep);');
  });

  it("exposes student auth progress without preserving stale auth errors", () => {
    const sessionSource = readFileSync(new URL("../src/state/session.tsx", import.meta.url), "utf8");

    expect(sessionSource).toContain("export type StudentAuthStep");
    expect(sessionSource).toContain("authStep: StudentAuthStep");
    expect(sessionSource).toContain('applyProgress("checking_existing_session")');
    expect(sessionSource).toContain('applyProgress("completing_google_callback")');
    expect(sessionSource).toContain('applyProgress("reading_google_session")');
    expect(sessionSource).toContain('applyProgress("loading_student_workspace")');
    expect(sessionSource).toContain("if (blocking) applyChecking(nextStep);");
    expect(sessionSource).toContain('applyChecking("resetting")');
    expect(sessionSource).toContain("completeStudentAuthCallbackIfPresent(authCallbackSnapshot)");
    expect(sessionSource).toContain('setAuthStep("idle")');
    expect(sessionSource).not.toContain("authErrorRef");
  });

  it("keeps auth operation guards recoverable under React StrictMode", () => {
    const sessionSource = readFileSync(new URL("../src/state/session.tsx", import.meta.url), "utf8");

    expect(sessionSource).toMatch(/useEffect\(\(\) => \{\s*mountedRef\.current = true;\s*return \(\) => \{\s*mountedRef\.current = false;\s*\};\s*\}, \[\]\);/);
    expect(sessionSource).toContain("return mountedRef.current && activeOperationRef.current === operationId;");
  });

  it("wraps Google callback completion in timeout recovery", () => {
    const sessionSource = readFileSync(new URL("../src/state/session.tsx", import.meta.url), "utf8");

    expect(sessionSource).toMatch(/await withTimeout\(\s*completeStudentAuthCallbackIfPresent\(authCallbackSnapshot\),\s*BOOTSTRAP_TIMEOUT_MS,\s*"Google sign-in timed out"\s*\);/);
    expect(sessionSource).toContain("applySignedOut(isStudentCallback ? resolveAuthCheckFailure(error) : null);");
  });

  it("cleans up voice recorder browser resources on stop, reset, and unmount", () => {
    const recorderSource = readFileSync(new URL("../src/components/AudioRecorder.tsx", import.meta.url), "utf8");

    expect(recorderSource).toContain("function AudioRecorder");
    expect(recorderSource).toContain("mountedRef.current = false");
    expect(recorderSource).toContain("cleanupRecordingResources({ discardRecording: true })");
    expect(recorderSource).toContain("window.clearInterval(timerRef.current)");
    expect(recorderSource).toContain("recognition.stop()");
    expect(recorderSource).toContain("recorder.stop()");
    expect(recorderSource).toContain("streamRef.current?.getTracks().forEach((track) => track.stop())");
    expect(recorderSource).toContain("URL.revokeObjectURL(url)");
    expect(recorderSource).toContain("if (!mountedRef.current || sessionRef.current !== sessionId || discardPendingRecordingRef.current)");
  });

  it("has a watchdog so student auth cannot stay in checking indefinitely", () => {
    const sessionSource = readFileSync(new URL("../src/state/session.tsx", import.meta.url), "utf8");

    expect(sessionSource).toContain("CHECKING_WATCHDOG_MS");
    expect(sessionSource).toContain("CHECKING_HARD_TIMEOUT_MS");
    expect(sessionSource).toContain('status !== "checking"');
    expect(sessionSource).toContain("activeOperationRef.current += 1");
    expect(sessionSource).toContain("applySignedOut();");
    expect(sessionSource).toContain("Session check took too long. Sign in again.");
  });

  it("does not report Worker auth failures as missing roster enrollment", () => {
    const sessionSource = readFileSync(new URL("../src/state/session.tsx", import.meta.url), "utf8");

    expect(sessionSource).toContain("isUnauthorizedApiError");
    expect(sessionSource).toContain("Google session could not be verified");
    expect(sessionSource).toContain("resolveEnrollmentStatusMessage");
    expect(sessionSource).toContain('"claimed_by_other"');
  });

  it("clears Supabase student auth whenever the session provider signs out", () => {
    const sessionSource = readFileSync(new URL("../src/state/session.tsx", import.meta.url), "utf8");
    const applySignedOutBody = sessionSource.match(/const applySignedOut = useCallback\(\([\s\S]*?\) => \{([\s\S]*?)\n  \}, \[setSessionState\]\);/)?.[1] ?? "";

    expect(applySignedOutBody).toContain("resetStudentSupabaseAuthState();");
    expect(applySignedOutBody).toContain("clearCachedStudentSession();");
    expect(applySignedOutBody).not.toContain("resetSupabaseAuthState");
  });

  it("keeps teacher pages under the teacher workspace boundary", () => {
    const appSource = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
    const teacherSource = readFileSync(new URL("../src/pages/teacher/TeacherWorkspace.tsx", import.meta.url), "utf8");

    expect(TEACHER_CHILD_ROUTES.every((route) => route.auth === "teacher")).toBe(true);
    expect(appSource).toContain('path="/teacher/*"');
    expect(appSource).toContain("TEACHER_CHILD_ROUTES.map");
    expect(appSource).not.toContain('path="/teacher/assessments"');
    expect(teacherSource).toContain('authStatus === "checking"');
  });
});

describe("student session cache eligibility", () => {
  const cached: CachedStudentSession = {
    authEmail: "student@example.com",
    profile: { id: "student-1", displayName: "Student One", email: "student@example.com" },
    courses: []
  };

  it("never treats cache as auth without a matching live Supabase email", () => {
    expect(canUseCachedStudentSession(cached, null, "signed_out")).toBe(false);
    expect(canUseCachedStudentSession(cached, "student@example.com", "anonymous")).toBe(false);
    expect(canUseCachedStudentSession(cached, "other@example.com", "session_fetch_failed")).toBe(false);
    expect(canUseCachedStudentSession(cached, "student@example.com", "auth_error")).toBe(false);
  });

  it("allows cache only for non-auth fetch failures after email confirmation", () => {
    expect(canUseCachedStudentSession(cached, "STUDENT@example.com", "session_fetch_failed")).toBe(true);
  });

  it("rejects malformed v2 cache entries without an auth email", () => {
    const storage = new MapBackedStorage();
    storage.setItem(STUDENT_SESSION_CACHE_KEY, JSON.stringify({
      profile: cached.profile,
      courses: cached.courses
    }));

    expect(readCachedStudentSession(storage)).toBeNull();
  });
});

class MapBackedStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}
