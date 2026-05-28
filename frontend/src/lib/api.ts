import type {
  AttemptResult,
  SimulationHtmlReasoningEffort,
  StudentLifecycleErrorCode,
  StudentAssignmentSummary,
  StudentCourseAssignments,
  StudentSessionResponse,
  StudentSimulationGenerationJob,
  StudentSimulationPreview,
  StudentPublishedFinalResultResponse
} from "@alt-assessment/shared";
import type { Session } from "@supabase/supabase-js";
import { getCanonicalLocalOrigin, getLocalAuthOriginIssue } from "./localAuthOrigin";
import {
  hasStoredStudentAuthState,
  isSupabaseConfigured,
  readStudentSupabaseSessionFallback,
  rememberStudentSupabaseSession,
  resetStudentSupabaseAuthState,
  studentSupabase
} from "./supabase";

const workerUrl = (import.meta.env.VITE_WORKER_URL as string | undefined) ?? "http://localhost:8787";
const SESSION_TIMEOUT_MS = 20000;
const SESSION_RECOVERY_TIMEOUT_MS = 3000;
const REQUEST_TIMEOUT_MS = 12000;
const LONG_RUNNING_REQUEST_TIMEOUT_MS = 120000;
const STUDENT_UPLOAD_TIMEOUT_MS = LONG_RUNNING_REQUEST_TIMEOUT_MS;
const STUDENT_GRADING_TIMEOUT_MS = LONG_RUNNING_REQUEST_TIMEOUT_MS;
const SIMULATION_GENERATION_REQUEST_TIMEOUT_MS = 600000;
const SIMULATION_JOB_START_TIMEOUT_MS = 60000;
const SIMULATION_JOB_STATUS_TIMEOUT_MS = 30000;

export interface StudentProfile {
  id: string;
  displayName: string;
  email?: string;
  className?: string;
  classCode?: string;
}

export interface UploadReservation {
  artifactId: string;
  uploadUrl: string;
  uploadToken: string;
}

export interface RealtimeVoiceEventPayload {
  sequence: number;
  eventType: string;
  role?: "student" | "assistant" | "system" | "status" | null;
  text?: string | null;
  metadata?: Record<string, unknown>;
  occurredAt?: string;
}

export class ApiRequestError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: StudentLifecycleErrorCode | string,
    public details?: unknown
  ) {
    super(message);
  }
}

export async function getStudentAuthEmail(): Promise<string | null> {
  if (!isSupabaseConfigured) {
    return null;
  }
  const session = await getStudentAuthSession();
  if (!session) return null;
  if (isAnonymousSession(session)) {
    clearInvalidStudentAuthState();
    return null;
  }
  const email = getSessionEmail(session);
  if (!email) {
    clearInvalidStudentAuthState();
    return null;
  }
  return email;
}

export async function requireStudentSession() {
  if (!isSupabaseConfigured) {
    throw new Error("Configure frontend Supabase environment variables before using live login.");
  }
  const session = await getStudentAuthSession();
  if (session && !isAnonymousSession(session)) {
    if (getSessionEmail(session)) return session;
    clearInvalidStudentAuthState();
    throw new Error("Google account did not provide an email address.");
  }
  if (session) {
    clearInvalidStudentAuthState();
  }
  throw new Error("Sign in with Google to continue.");
}

export async function signInStudentWithGoogle() {
  if (!isSupabaseConfigured) {
    throw new Error("Configure frontend Supabase environment variables before using live login.");
  }
  assertSupportedLocalAuthOrigin();
  if (redirectToCanonicalLocalLoginIfNeeded()) return;
  const { error } = await withTimeout(
    studentSupabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: resolveAppUrl("login"),
        queryParams: { prompt: "select_account" }
      }
    }),
    SESSION_TIMEOUT_MS,
    "Google sign-in timed out."
  );
  if (error) throw new Error(resolveOAuthStartErrorMessage(error.message));
}

export async function signOutStudent() {
  if (!isSupabaseConfigured) return;
  await studentSupabase.auth.signOut();
}

export async function apiFetch<T>(path: string, init: RequestInit = {}, timeoutMs = REQUEST_TIMEOUT_MS): Promise<T> {
  const session = await withTimeout(requireStudentSession(), SESSION_TIMEOUT_MS, "Session bootstrap timed out.");
  const response = await fetchWithTimeout(`${workerUrl}/api${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.access_token}`,
      ...init.headers
    }
  }, timeoutMs);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw toApiRequestError(payload, response.status);
  }
  return payload as T;
}

export async function publicApiFetch<T>(path: string, init: RequestInit = {}, timeoutMs = REQUEST_TIMEOUT_MS): Promise<T> {
  const response = await fetchWithTimeout(`${workerUrl}/api${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...init.headers
    }
  }, timeoutMs);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw toApiRequestError(payload, response.status);
  }
  return payload as T;
}

export function loginStudent(input: { classCode: string; pin: string }) {
  return apiFetch<unknown>("/student/login", {
    method: "POST",
    body: JSON.stringify(input)
  }).then(validateStudentSessionResponse);
}

export function getStudentSession() {
  return apiFetch<StudentSessionResponse>("/student/me");
}

export function validateStudentSessionResponse(payload: unknown): StudentSessionResponse {
  if (!isRecord(payload)) {
    throw new Error("Login response was missing student profile");
  }

  const profile = payload.profile;
  const courses = payload.courses;
  if (!isRecord(profile) || typeof profile.id !== "string" || profile.id.trim() === "" || typeof profile.displayName !== "string" || profile.displayName.trim() === "") {
    throw new Error("Login response was missing student profile");
  }
  if (!Array.isArray(courses)) {
    throw new Error("Login response was missing courses");
  }

  return {
    profile: {
      id: profile.id,
      displayName: profile.displayName,
      email: typeof profile.email === "string" ? profile.email : undefined,
      className: typeof profile.className === "string" ? profile.className : undefined,
      classCode: typeof profile.classCode === "string" ? profile.classCode : undefined
    },
    courses: courses as StudentCourseAssignments[],
    enrollmentStatus: "matched"
  };
}

export function startAttempt(assignmentId: string) {
  return apiFetch<{
    attemptId: string;
    assignment: StudentAssignmentSummary;
    simulationDraft?: {
      description: string;
      simulationPreview: StudentSimulationPreview | null;
      simulationSketchPreview: StudentSimulationPreview | null;
      activeSimulationJob: StudentSimulationGenerationJob | null;
    } | null;
  }>("/attempts/start", {
    method: "POST",
    body: JSON.stringify({ assignmentId })
  });
}

export function reserveUpload(input: {
  attemptId: string;
  kind: "audio" | "writing" | "simulation-derived";
  mimeType: string;
  filename: string;
  byteSize: number;
}) {
  return apiFetch<UploadReservation>("/artifacts/upload-token", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export async function uploadArtifact(reservation: UploadReservation, file: Blob) {
  const session = await withTimeout(requireStudentSession(), SESSION_TIMEOUT_MS, "Session bootstrap timed out.");
  const response = await fetchWithTimeout(reservation.uploadUrl, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${session.access_token}`,
      "Content-Type": file.type || "application/octet-stream",
      "X-Upload-Token": reservation.uploadToken
    },
    body: file
  }, STUDENT_UPLOAD_TIMEOUT_MS);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw toApiRequestError(payload, response.status);
  }
  return payload as { artifactId: string; state: string };
}

export function gradeVoice(input: { attemptId: string; artifactId: string; browserTranscript?: string }) {
  return apiFetch<{ transcript: string; score: number; feedback: AttemptResult["provisionalFeedback"] }>("/voice/grade", {
    method: "POST",
    body: JSON.stringify(input)
  }, STUDENT_GRADING_TIMEOUT_MS);
}

export function connectRealtimeVoice(input: { attemptId: string; sdpOffer: string }) {
  return apiFetch<{
    sessionId: string;
    sdpAnswer: string;
    model: string;
    maxSessionSec: number;
    expiresAt: string;
  }>("/voice/realtime/connect", {
    method: "POST",
    body: JSON.stringify(input)
  }, LONG_RUNNING_REQUEST_TIMEOUT_MS);
}

export function logRealtimeVoiceEvents(input: { sessionId: string; events: RealtimeVoiceEventPayload[] }) {
  return apiFetch<{ sessionId: string; storedEvents: number }>("/voice/realtime/events", {
    method: "POST",
    body: JSON.stringify(input)
  });
}

export function finalizeRealtimeVoice(input: { sessionId: string; events?: RealtimeVoiceEventPayload[] }) {
  return apiFetch<{
    transcript: string;
    score: number;
    feedback: AttemptResult["provisionalFeedback"];
    idempotentReplay: boolean;
    sessionStatus: "finalized" | "error";
  }>("/voice/realtime/finalize", {
    method: "POST",
    body: JSON.stringify(input)
  }, LONG_RUNNING_REQUEST_TIMEOUT_MS);
}

export function gradeWriting(input: { attemptId: string; artifactId: string }) {
  return apiFetch<{ ocrText: string; score: number; feedback: AttemptResult["provisionalFeedback"] }>("/writing/grade", {
    method: "POST",
    body: JSON.stringify(input)
  }, STUDENT_GRADING_TIMEOUT_MS);
}

export function generateSimulationSketch(input: { attemptId: string; description: string }) {
  return apiFetch<{
    artifactId: string;
    previewPath: string;
    previewToken: string;
    modelUsed: string;
    requestedModel: string;
    outputKind: "image";
  }>("/simulation/sketch", {
    method: "POST",
    body: JSON.stringify(input)
  }, SIMULATION_GENERATION_REQUEST_TIMEOUT_MS);
}

export function buildGenerateSimulationRequest(input: {
  attemptId: string;
  description: string;
  sketchArtifactId: string;
  htmlReasoningEffort: SimulationHtmlReasoningEffort;
}) {
  return input;
}

export function buildRefineSimulationRequest(input: {
  attemptId: string;
  description: string;
  sketchArtifactId: string;
  htmlArtifactId: string;
  htmlReasoningEffort: SimulationHtmlReasoningEffort;
}) {
  return input;
}

export function generateSimulation(input: { attemptId: string; description: string; sketchArtifactId: string; htmlReasoningEffort: SimulationHtmlReasoningEffort }) {
  return apiFetch<StudentSimulationGenerationJob>("/simulation/generate", {
    method: "POST",
    body: JSON.stringify(buildGenerateSimulationRequest(input))
  }, SIMULATION_JOB_START_TIMEOUT_MS);
}

export function refineSimulation(input: {
  attemptId: string;
  description: string;
  sketchArtifactId: string;
  htmlArtifactId: string;
  htmlReasoningEffort: SimulationHtmlReasoningEffort;
}) {
  return apiFetch<StudentSimulationGenerationJob>("/simulation/refine", {
    method: "POST",
    body: JSON.stringify(buildRefineSimulationRequest(input))
  }, SIMULATION_JOB_START_TIMEOUT_MS);
}

export function fallbackSimulationPreview(input: {
  attemptId: string;
  description: string;
  sketchArtifactId: string;
  htmlArtifactId: string;
  reasonCodes?: string[];
}) {
  return apiFetch<StudentSimulationPreview>("/simulation/fallback", {
    method: "POST",
    body: JSON.stringify(input)
  }, REQUEST_TIMEOUT_MS);
}

export function getSimulationGenerationJob(jobId: string) {
  return apiFetch<StudentSimulationGenerationJob>(`/simulation/jobs/${jobId}`, {
    method: "GET"
  }, SIMULATION_JOB_STATUS_TIMEOUT_MS);
}

export function cancelSimulationGenerationJob(jobId: string) {
  return apiFetch<StudentSimulationGenerationJob>(`/simulation/jobs/${jobId}/cancel`, {
    method: "POST"
  }, SIMULATION_JOB_STATUS_TIMEOUT_MS);
}

export function submitSimulation(input: { attemptId: string; description: string; sketchArtifactId: string; htmlArtifactId: string }) {
  return apiFetch<{ attemptId: string }>("/simulation/submit", {
    method: "POST",
    body: JSON.stringify(input)
  }, SIMULATION_GENERATION_REQUEST_TIMEOUT_MS);
}

const SIMULATION_PREVIEW_FIT_MARKER = "data-alt-assessment-simulation-preview-fit";

export async function createSimulationPreviewObjectUrl(previewBlob: Blob, options: { healthNonce?: string } = {}): Promise<string> {
  if (!isHtmlPreviewBlob(previewBlob)) {
    return URL.createObjectURL(previewBlob);
  }

  const decoratedHtml = decorateSimulationPreviewHtml(await previewBlob.text(), options.healthNonce);
  const decoratedBlob = new Blob([decoratedHtml], {
    type: previewBlob.type || "text/html; charset=utf-8"
  });
  return URL.createObjectURL(decoratedBlob);
}

export async function getSimulationPreviewUrl(input: { artifactId: string; previewPath: string; previewToken: string; healthNonce?: string }) {
  const session = await withTimeout(requireStudentSession(), SESSION_TIMEOUT_MS, "Session bootstrap timed out.");
  const response = await fetchWithTimeout(`${workerUrl}/api${input.previewPath}?previewToken=${encodeURIComponent(input.previewToken)}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${session.access_token}`
    }
  }, REQUEST_TIMEOUT_MS);

  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw toApiRequestError(payload, response.status);
  }

  const previewBlob = await response.blob();
  return createSimulationPreviewObjectUrl(previewBlob, { healthNonce: input.healthNonce });
}

export function getAttemptResult(attemptId: string) {
  return apiFetch<AttemptResult>(`/attempts/${attemptId}/result`);
}

export function getPublishedFinalResult(assignmentId: string) {
  return apiFetch<StudentPublishedFinalResultResponse>(`/assignments/${assignmentId}/final`);
}

function isHtmlPreviewBlob(blob: Blob): boolean {
  const mimeType = blob.type.split(";")[0]?.trim().toLowerCase();
  return mimeType === "text/html" || mimeType === "application/xhtml+xml";
}

function decorateSimulationPreviewHtml(html: string, healthNonce?: string): string {
  if (html.includes(SIMULATION_PREVIEW_FIT_MARKER)) return html;

  const script = healthNonce ? simulationPreviewHealthScript(healthNonce) : "";
  return injectBeforeClosingHead(html, `${simulationPreviewFitStyle()}${script}`);
}

function injectBeforeClosingHead(html: string, insertion: string): string {
  const closingHead = /<\/head\s*>/i;
  if (closingHead.test(html)) {
    return html.replace(closingHead, `${insertion}$&`);
  }
  const openingBody = /<body\b[^>]*>/i;
  if (openingBody.test(html)) {
    return html.replace(openingBody, `<head>${insertion}</head>$&`);
  }
  const openingHtml = /<html\b[^>]*>/i;
  if (openingHtml.test(html)) {
    return html.replace(openingHtml, `$&<head>${insertion}</head>`);
  }
  return `${insertion}${html}`;
}

function simulationPreviewFitStyle(): string {
  return `<style ${SIMULATION_PREVIEW_FIT_MARKER}>
html,
body {
  width: 100%;
  height: 100%;
  margin: 0 !important;
  overflow: hidden !important;
  box-sizing: border-box !important;
}
body {
  position: relative !important;
  min-width: 0 !important;
  min-height: 0 !important;
}
</style>`;
}

function simulationPreviewHealthScript(healthNonce: string): string {
  return `<script ${SIMULATION_PREVIEW_FIT_MARKER}>
(function(){
  var nonce=${JSON.stringify(healthNonce)};
  function report(){
    try {
      var doc=document.documentElement;
      var body=document.body;
      var width=Math.max(doc.scrollWidth,body?body.scrollWidth:0);
      var height=Math.max(doc.scrollHeight,body?body.scrollHeight:0);
      var viewWidth=window.innerWidth||doc.clientWidth||0;
      var viewHeight=window.innerHeight||doc.clientHeight||0;
      var reasons=[];
      if(width>viewWidth+2) reasons.push("horizontal_overflow");
      if(height>viewHeight+2) reasons.push("vertical_overflow");
      var visibleText=(body&&body.innerText?body.innerText:"").trim();
      if(visibleText.length<16) reasons.push("blank_or_too_sparse");
      var elements=Array.prototype.slice.call(document.querySelectorAll("body *")).slice(0,600);
      var clipped=0;
      var textOverflow=0;
      for(var i=0;i<elements.length;i+=1){
        var el=elements[i];
        var rect=el.getBoundingClientRect();
        if(rect.width<=0||rect.height<=0) continue;
        if(rect.left<-2||rect.top<-2||rect.right>viewWidth+2||rect.bottom>viewHeight+2) clipped+=1;
        if(el.scrollWidth>el.clientWidth+2||el.scrollHeight>el.clientHeight+2) textOverflow+=1;
      }
      if(clipped>0) reasons.push("clipped_elements");
      if(textOverflow>0) reasons.push("text_overflow");
      window.parent.postMessage({
        type:"alt-assessment:simulation-preview-health",
        nonce:nonce,
        ok:reasons.length===0,
        reasonCodes:reasons,
        metrics:{width:width,height:height,viewWidth:viewWidth,viewHeight:viewHeight,clippedElements:clipped,textOverflowElements:textOverflow}
      },"*");
    } catch(error) {
      window.parent.postMessage({
        type:"alt-assessment:simulation-preview-health",
        nonce:nonce,
        ok:false,
        reasonCodes:["health_check_failed"],
        metrics:{}
      },"*");
    }
  }
  window.addEventListener("load",function(){setTimeout(report,350);});
  setTimeout(report,1000);
})();
</script>`;
}

async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error(`Request timed out after ${Math.round(timeoutMs / 1000)}s. Check Worker and Supabase status.`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toApiRequestError(payload: unknown, status: number): ApiRequestError {
  const fallback = `Request failed: ${status}`;
  if (!isRecord(payload)) {
    return new ApiRequestError(fallback, status);
  }

  const message = typeof payload.error === "string" && payload.error.trim()
    ? payload.error
    : fallback;
  const code = typeof payload.code === "string" && payload.code.trim()
    ? payload.code
    : undefined;
  const details = Object.prototype.hasOwnProperty.call(payload, "details")
    ? payload.details
    : undefined;
  return new ApiRequestError(message, status, code, details);
}

async function getStudentAuthSession(): Promise<Session | null> {
  const fallbackSession = readStudentSupabaseSessionFallback();
  if (fallbackSession) return fallbackSession;
  if (!hasStoredStudentAuthState()) {
    return null;
  }

  const recovered = await withTimeout(
    studentSupabase.auth.getSession(),
    SESSION_RECOVERY_TIMEOUT_MS,
    "Session recovery timed out."
  ).catch(() => undefined);
  if (recovered?.data.session) {
    rememberStudentSupabaseSession(recovered.data.session);
    return recovered.data.session;
  }
  if (recovered === undefined) {
    return null;
  }

  resetStudentSupabaseAuthState();
  return null;
}

function clearInvalidStudentAuthState(): void {
  resetStudentSupabaseAuthState();
  void studentSupabase.auth.signOut({ scope: "local" }).catch(() => undefined);
}

function isAnonymousSession(session: { user?: { is_anonymous?: boolean } | null }): boolean {
  try {
    return session.user?.is_anonymous === true;
  } catch {
    return false;
  }
}

function getSessionEmail(session: Session): string | null {
  try {
    const userEmail = readEmailFromUser(session.user);
    if (userEmail) return userEmail;
  } catch {
    // Stored sessions can be missing a materialized user object; the JWT remains the source of truth.
  }
  return readEmailFromAccessToken(session.access_token);
}

function readEmailFromUser(user: unknown): string | null {
  if (!isRecord(user)) return null;
  const directEmail = readStringValue(user.email);
  if (directEmail) return directEmail;

  const metadataEmail = readEmailFromRecord(user.user_metadata);
  if (metadataEmail) return metadataEmail;

  const appMetadataEmail = readEmailFromRecord(user.app_metadata);
  if (appMetadataEmail) return appMetadataEmail;

  const identities = user.identities;
  if (Array.isArray(identities)) {
    for (const identity of identities) {
      if (!isRecord(identity)) continue;
      const identityEmail = readEmailFromRecord(identity.identity_data);
      if (identityEmail) return identityEmail;
    }
  }
  return null;
}

function readEmailFromRecord(value: unknown): string | null {
  if (!isRecord(value)) return null;
  return readStringValue(value.email)
    ?? readStringValue(value.email_address)
    ?? readStringValue(value.preferred_email);
}

function readStringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readEmailFromAccessToken(accessToken: string): string | null {
  try {
    const payload = accessToken.split(".")[1];
    if (!payload || typeof atob !== "function") return null;
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const parsed = JSON.parse(atob(padded)) as { email?: unknown };
    return typeof parsed.email === "string" && parsed.email.trim() ? parsed.email : null;
  } catch {
    return null;
  }
}

function assertSupportedLocalAuthOrigin(): void {
  if (typeof window === "undefined") return;
  const issue = getLocalAuthOriginIssue(window.location.origin);
  if (issue) throw new Error(issue);
}

function resolveOAuthStartErrorMessage(message: string): string {
  const trimmed = message.trim();
  const suffix = typeof window === "undefined" ? "" : ` Confirm Supabase Auth redirect URLs include ${resolveAppUrl("login")}.`;
  if (/redirect|allow.?list|not allowed|site url/i.test(trimmed)) {
    return `${trimmed || "Google sign-in could not start."}${suffix}`;
  }
  return trimmed || "Google sign-in could not start.";
}

function parseUrlHash(url: URL): URLSearchParams {
  const hash = url.hash.startsWith("#") ? url.hash.slice(1) : url.hash;
  return new URLSearchParams(hash);
}

function clearAuthCallbackUrl(url: URL): void {
  for (const key of ["code", "state", "error", "error_code", "error_description"]) {
    url.searchParams.delete(key);
  }
  url.hash = "";
  window.history.replaceState(null, "", url.toString());
}

function resolveAppUrl(path: string): string {
  const base = import.meta.env.BASE_URL || "/";
  const normalizedBase = base.endsWith("/") ? base : `${base}/`;
  return new URL(`${normalizedBase}${path.replace(/^\/+/, "")}`, window.location.origin).toString();
}

function redirectToCanonicalLocalLoginIfNeeded(): boolean {
  if (typeof window === "undefined") return false;
  const canonicalOrigin = getCanonicalLocalOrigin(window.location.origin);
  if (canonicalOrigin === window.location.origin) return false;
  const base = import.meta.env.BASE_URL || "/";
  const normalizedBase = base.endsWith("/") ? base : `${base}/`;
  window.location.replace(new URL(`${normalizedBase}login?resetAuth=1`, canonicalOrigin).toString());
  return true;
}
