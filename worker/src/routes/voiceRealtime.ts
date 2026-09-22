import { reserveAiBudget } from "../lib/aiBudget";
import { realtimeEvidence } from "../lib/realtimeEvidence";
import type { SupabaseClient } from "@supabase/supabase-js";
import { DEFAULT_REALTIME_VOICE_MAX_SESSION_SEC } from "@alt-assessment/shared";
import { markAttemptSubmissionError } from "../lib/attemptLifecycle";
import { requireAttempt, logAudit, toGradeFeedback } from "../lib/db";
import type { Env } from "../lib/env";
import { HttpError, getRequiredString, readJson } from "../lib/http";
import { openaiClient, gradeVoice, enforceModelConfirmation } from "../lib/openai";
import { getModel } from "../lib/models";

const OPENAI_REALTIME_CALLS_URL = "https://api.openai.com/v1/realtime/calls";
const MAX_SDP_LENGTH = 250_000;
const MAX_EVENTS_PER_BATCH = 100;
const MAX_EVENT_TEXT_LENGTH = 6_000;
const MAX_METADATA_STRING_LENGTH = 500;
const MAX_METADATA_JSON_LENGTH = 6_000;

type RealtimeEventRole = "student" | "assistant" | "system" | "status";

interface RealtimeSessionRow {
  id: string;
  attempt_id: string;
  student_id: string;
  provider: string;
  model: string;
  status: "connecting" | "active" | "finalizing" | "finalized" | "error";
  started_at: string;
  ended_at: string | null;
  expires_at: string | null;
  continuity_diagnostics: Record<string, unknown> | null;
  finalized_attempt_id: string | null;
  finalized_transcript: string | null;
  finalized_score: number | null;
  finalized_feedback: Record<string, unknown> | null;
  finalized_at: string | null;
  finalize_error: string | null;
}

interface NormalizedRealtimeEvent {
  sequence: number;
  eventType: string;
  role: RealtimeEventRole | null;
  text: string | null;
  metadata: Record<string, unknown>;
  occurredAt: string;
}

interface RealtimeDiagnostics {
  eventCount: number;
  studentTurnCount: number;
  assistantTurnCount: number;
  statusTurnCount: number;
  gapCount: number;
  duplicateCount: number;
  flags: string[];
}

export async function connectRealtimeVoice(request: Request, env: Env, db: SupabaseClient, userId: string) {
  const body = await readJson<Record<string, unknown>>(request);
  const attemptId = getRequiredString(body, "attemptId");
  const sdpOffer = getRequiredString(body, "sdpOffer");
  if (sdpOffer.length > MAX_SDP_LENGTH) {
    throw new HttpError(400, "Realtime SDP offer is too large");
  }
  const confirmed = body.expensiveModelConfirmed === true;
  enforceModelConfirmation(["realtimeVoice"], confirmed);

  const { attempt, assessment } = await requireAttempt(db, userId, attemptId);
  if (assessment.type !== "voice_realtime") {
    throw new HttpError(400, "Attempt is not a live voice assessment");
  }
  if (attempt.status !== "draft") {
    throw new HttpError(409, "Attempt is no longer in draft state", { attemptId, status: attempt.status });
  }

  if (!env.REALTIME_SESSIONS) throw new HttpError(503, "Live voice evidence service is not configured");
  await reserveAiBudget(db, userId, attempt.id, "live_voice", 10);
  const model = getModel("realtimeVoice");
  const maxSessionSec = resolveRealtimeMaxSessionSec(assessment.config);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + maxSessionSec * 1000).toISOString();
  const sessionId = crypto.randomUUID();

  const { error: insertError } = await db.from("attempt_realtime_sessions").insert({
    id: sessionId,
    attempt_id: attempt.id,
    student_id: userId,
    provider: "openai",
    model: model.id,
    status: "connecting",
    started_at: now.toISOString(),
    expires_at: expiresAt
  });
  if (insertError) throw new HttpError(500, "Failed to create realtime session", insertError.message);

  const sessionConfig = {
    type: "realtime",
    model: model.id,
    instructions: buildRealtimeInstructions({
      prompt: assessment.prompt,
      expectedAnswer: assessment.expectedAnswer ?? null,
      rubric: assessment.rubric
    }),
    audio: {
      input: {
        transcription: { model: getModel("transcription").id },
        turn_detection: {
          type: "server_vad",
          create_response: true,
          interrupt_response: true,
          silence_duration_ms: 700
        }
      },
      output: {
        voice: "marin"
      }
    },
    output_modalities: ["audio"],
    max_output_tokens: 900
  };

  const form = new FormData();
  form.set("sdp", sdpOffer);
  form.set("session", JSON.stringify(sessionConfig));

  let callId = "";
  try {
    const response = await fetch(OPENAI_REALTIME_CALLS_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.OPENAI_API_KEY}`
      },
      body: form,
      signal: AbortSignal.timeout(20_000)
    });

    if (!response.ok) {
      throw new HttpError(502, "Realtime session could not be created");
    }

    const location = response.headers.get("Location") ?? "";
    callId = location.split("/").pop() ?? "";
    const sdpAnswer = await response.text();
    if (!sdpAnswer.trim()) {
      throw new HttpError(502, "Realtime session did not return an SDP answer");
    }

    await realtimeEvidence(env, sessionId, "start", { callId, deadline: Date.parse(expiresAt) });

    const { error: updateError } = await db
      .from("attempt_realtime_sessions")
      .update({ status: "active", updated_at: new Date().toISOString() })
      .eq("id", sessionId)
      .eq("student_id", userId);
    if (updateError) throw new HttpError(500, "Failed to activate realtime session", updateError.message);

    await logAudit(db, {
      attemptId: attempt.id,
      route: "/api/voice/realtime/connect",
      provider: "openai",
      model: model.id,
      requestSummary: { sessionId, maxSessionSec, sdpOfferLength: sdpOffer.length },
      rawResponse: { sdpAnswerLength: sdpAnswer.length }
    });

    return {
      sessionId,
      sdpAnswer,
      model: model.id,
      maxSessionSec,
      expiresAt
    };
  } catch (error) {
    if (/^rtc_[\w-]+$/.test(callId)) await openaiClient(env.OPENAI_API_KEY).realtime.calls.hangup(callId).catch(() => {});
    await markRealtimeSessionStatusBestEffort(db, userId, sessionId, "error");
    throw error;
  }
}

export async function appendRealtimeVoiceEvents(request: Request, db: SupabaseClient, userId: string) {
  const body = await readJson<Record<string, unknown>>(request);
  const sessionId = getRequiredString(body, "sessionId");
  const session = await requireRealtimeSession(db, userId, sessionId);
  assertRealtimeSessionActive(session, "Realtime session is not active");
  const inserted = await storeRealtimeEvents(db, session, body.events);
  return { sessionId, storedEvents: inserted };
}

export async function finalizeRealtimeVoice(request: Request, env: Env, db: SupabaseClient, userId: string) {
  const body = await readJson<Record<string, unknown>>(request);
  const sessionId = getRequiredString(body, "sessionId");
  const confirmed = body.expensiveModelConfirmed === true;
  enforceModelConfirmation(["grading"], confirmed);

  const session = await requireRealtimeSession(db, userId, sessionId);
  if (session.status === "finalized") {
    return replayFinalizedRealtimeSession(db, userId, session);
  }
  if (session.status !== "active") {
    throw new HttpError(409, "Realtime session is not active", { sessionId, status: session.status });
  }
  const deadline = Date.parse(session.expires_at ?? "");
  if (!Number.isFinite(deadline) || Date.now() > deadline + 120_000) {
    throw new HttpError(409, "The live voice finalization window has closed. Ask your teacher to review the session.");
  }
  // Validate telemetry before claiming, but never use it as grading evidence.
  const normalizedFinalizeEvents = body.events === undefined ? [] : normalizeRealtimeVoiceEvents(body.events);
  const { attempt, assessment } = await requireAttempt(db, userId, session.attempt_id);
  if (assessment.type !== "voice_realtime") throw new HttpError(400, "Attempt is not a live voice assessment");
  const evidence = await realtimeEvidence(env, session.id, "seal");
  const transcript = evidence.transcript;
  const diagnostics = { eventCount: evidence.turns, studentTurnCount: evidence.turns, assistantTurnCount: 0,
    statusTurnCount: 0, gapCount: 0, duplicateCount: 0, flags: [], source: "provider_audio" };

  let claimed = false;
  try {
    await storeRealtimeEventsNormalized(db, session, normalizedFinalizeEvents);
    // Checkpoint sealed evidence and claim both state machines in one transaction.
    const { error: claimError } = await db.rpc("claim_realtime_submission", {
      p_user_id: userId, p_session_id: session.id, p_transcript: transcript
    });
    if (claimError) throw new HttpError(claimError.code === "23514" ? 409 : 500,
      "Live voice finalization is already in progress or unavailable", claimError.message);
    claimed = true;

    const client = openaiClient(env.OPENAI_API_KEY);
    const feedback = await gradeVoice(client, {
      prompt: assessment.prompt,
      expectedAnswer: assessment.expectedAnswer ?? null,
      rubric: assessment.rubric,
      scoringPolicy: assessment.config.scoringPolicy,
      transcript
    });
    const normalizedFeedback = toGradeFeedback(feedback);
    if (!normalizedFeedback) {
      throw new HttpError(502, "Realtime grading response was invalid");
    }

    await logAudit(db, {
      attemptId: attempt.id,
      route: "/api/voice/realtime/finalize",
      provider: "openai",
      model: `${session.model},${getModel("grading").id}`,
      requestSummary: { sessionId, transcriptLength: transcript.length, diagnostics },
      rawResponse: { feedback: normalizedFeedback }
    });

    const { error: gradeError } = await db.rpc("save_realtime_grade", {
      p_user_id: userId, p_session_id: session.id, p_transcript: transcript,
      p_feedback: normalizedFeedback, p_diagnostics: diagnostics,
      p_metadata: { model: getModel("grading").id, policyVersion: "rubric-v2", promptVersion: "grading-v2", assessmentVersionId: attempt.assessment_version_id, gradedAt: new Date().toISOString() }
    });
    if (gradeError) throw new HttpError(500, "Failed to finalize live voice grade", gradeError.message);

    return {
      attemptId: attempt.id,
      transcript,
      score: normalizedFeedback.score,
      feedback: normalizedFeedback,
      idempotentReplay: false,
      sessionStatus: "finalized" as const
    };
  } catch (error) {
    if (claimed) {
      await markRealtimeSessionStatusBestEffort(db, userId, session.id, "error", {
        diagnostics,
        finalizeError: error instanceof Error ? error.message : String(error)
      });
      await markRealtimeSubmissionErrorBestEffort(db, userId, attempt.id);
    }
    throw error;
  }
}

export function normalizeRealtimeVoiceEvents(events: unknown): NormalizedRealtimeEvent[] {
  if (!Array.isArray(events)) return [];
  if (events.length > MAX_EVENTS_PER_BATCH) {
    throw new HttpError(400, `Realtime event batch is limited to ${MAX_EVENTS_PER_BATCH} events`);
  }

  return events.map((event, index) => {
    if (!isRecord(event)) {
      throw new HttpError(400, `Realtime event ${index + 1} must be an object`);
    }
    const sequence = typeof event.sequence === "number" && Number.isInteger(event.sequence) && event.sequence >= 0
      ? event.sequence
      : Number.NaN;
    if (!Number.isFinite(sequence)) {
      throw new HttpError(400, `Realtime event ${index + 1} has an invalid sequence`);
    }

    const eventType = typeof event.eventType === "string" && event.eventType.trim()
      ? event.eventType.trim().slice(0, 120)
      : typeof event.type === "string" && event.type.trim()
        ? event.type.trim().slice(0, 120)
        : "event";
    const role = event.role === "student" ? "student" as const : "status" as const;
    const text = typeof event.text === "string" && event.text.trim()
      ? event.text.trim().slice(0, MAX_EVENT_TEXT_LENGTH)
      : null;
    const metadata = sanitizeMetadata(event.metadata ?? event.raw ?? {});
    const occurredAt = new Date().toISOString();

    return { sequence, eventType, role, text, metadata, occurredAt };
  });
}

async function storeRealtimeEvents(db: SupabaseClient, session: RealtimeSessionRow, events: unknown): Promise<number> {
  const normalized = normalizeRealtimeVoiceEvents(events);
  return storeRealtimeEventsNormalized(db, session, normalized);
}

async function storeRealtimeEventsNormalized(
  db: SupabaseClient,
  session: RealtimeSessionRow,
  normalized: NormalizedRealtimeEvent[]
): Promise<number> {
  if (normalized.length === 0) return 0;

  const rows = normalized.map((event) => ({
    session_id: session.id,
    attempt_id: session.attempt_id,
    student_id: session.student_id,
    sequence: event.sequence,
    event_type: event.eventType,
    role: event.role,
    text: event.text,
    metadata: event.metadata,
    occurred_at: event.occurredAt
  }));

  const { error } = await db
    .from("attempt_realtime_events")
    .upsert(rows, { onConflict: "session_id,sequence", ignoreDuplicates: true });
  if (error) throw new HttpError(500, "Failed to save realtime events", error.message);
  return rows.length;
}

async function requireRealtimeSession(db: SupabaseClient, userId: string, sessionId: string): Promise<RealtimeSessionRow> {
  const { data, error } = await db
    .from("attempt_realtime_sessions")
    .select("id, attempt_id, student_id, provider, model, status, started_at, ended_at, expires_at, continuity_diagnostics, finalized_attempt_id, finalized_transcript, finalized_score, finalized_feedback, finalized_at, finalize_error")
    .eq("id", sessionId)
    .eq("student_id", userId)
    .maybeSingle();
  if (error && isMissingRealtimeHardeningSchema(error)) {
    throw new HttpError(409, "Realtime voice requires database migration 0013_realtime_voice_hardening.sql");
  }
  if (error) throw new HttpError(500, "Failed to load realtime session", error.message);
  if (!data) throw new HttpError(404, "Realtime session not found");
  return data as RealtimeSessionRow;
}

export function buildRealtimeInstructions(input: {
  prompt: string;
  expectedAnswer: string | null;
  rubric: unknown;
}): string {
  return [
    "You are conducting a live voice-based assessment for a student.",
    "Keep the conversation focused on the assessment prompt.",
    "Ask concise follow-up questions only when the student's answer needs clarification.",
    "Give brief spoken feedback during the session, but do not announce a final numeric grade.",
    "Do not invent evidence not stated by the student.",
    "At the end, summarize strengths and gaps in a classroom-appropriate tone.",
    `Assessment prompt: ${input.prompt}`,
    `Rubric: ${JSON.stringify(input.rubric ?? [])}`
  ].join("\n");
}

function resolveRealtimeMaxSessionSec(config: Record<string, unknown>): number {
  const value = config.maxSessionSec;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return DEFAULT_REALTIME_VOICE_MAX_SESSION_SEC;
  }
  return Math.min(1800, Math.max(30, Math.round(value)));
}

function sanitizeMetadata(value: unknown, depth = 0): Record<string, unknown> {
  const sanitized = sanitizeValue(value, depth);
  if (isRecord(sanitized)) {
    const json = safeJsonStringify(sanitized);
    if (json.length <= MAX_METADATA_JSON_LENGTH) return sanitized;
  }
  return {};
}

function sanitizeValue(value: unknown, depth: number): unknown {
  if (depth > 4) return "[truncated]";
  if (value === null || value === undefined) return null;
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string") {
    return redactSensitiveString(value).slice(0, MAX_METADATA_STRING_LENGTH);
  }
  if (Array.isArray(value)) {
    return value.slice(0, 20).map((entry) => sanitizeValue(entry, depth + 1));
  }
  if (!isRecord(value)) return null;

  const output: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (isSensitiveMetadataKey(key)) continue;
    output[key.slice(0, 80)] = sanitizeValue(entry, depth + 1);
  }
  return output;
}

function isSensitiveMetadataKey(key: string): boolean {
  return /audio|base64|bytes|delta|sdp|secret|token|api[_-]?key|authorization|credential/i.test(key);
}

function redactSensitiveString(value: string): string {
  return value
    .replace(/sk-(?:proj|live|test)?-[a-z0-9_-]{20,}/gi, "[redacted-key]")
    .replace(/ek_[a-z0-9_-]{12,}/gi, "[redacted-client-secret]")
    .replace(/v=0\r?\n[\s\S]*/i, "[redacted-sdp]");
}

function assertRealtimeSessionActive(session: RealtimeSessionRow, message: string): void {
  if (session.status !== "active") {
    throw new HttpError(409, message, { sessionId: session.id, status: session.status });
  }
  const expiresMs = session.expires_at ? Date.parse(session.expires_at) : Number.NaN;
  if (Number.isFinite(expiresMs) && expiresMs <= Date.now()) {
    throw new HttpError(409, "Realtime session has expired", { sessionId: session.id, expiresAt: session.expires_at });
  }
}

async function replayFinalizedRealtimeSession(
  db: SupabaseClient,
  userId: string,
  session: RealtimeSessionRow
): Promise<{
  attemptId: string;
  transcript: string;
  score: number;
  feedback: NonNullable<ReturnType<typeof toGradeFeedback>>;
  idempotentReplay: boolean;
  sessionStatus: "finalized" | "error";
}> {
  const { attempt } = await requireAttempt(db, userId, session.attempt_id);
  const feedback = toGradeFeedback(attempt.provisional_feedback) ?? toGradeFeedback(session.finalized_feedback ?? null);
  if (!feedback || typeof attempt.provisional_score !== "number" || !attempt.transcript) {
    throw new HttpError(409, "Realtime session is finalized but graded data is unavailable", { sessionId: session.id });
  }
  return {
    attemptId: attempt.id,
    transcript: attempt.transcript,
    score: attempt.provisional_score,
    feedback,
    idempotentReplay: true,
    sessionStatus: "finalized"
  };
}

async function markRealtimeSessionStatusBestEffort(
  db: SupabaseClient,
  userId: string,
  sessionId: string,
  status: RealtimeSessionRow["status"],
  input?: { diagnostics?: RealtimeDiagnostics; finalizeError?: string | null }
): Promise<void> {
  try {
    const now = new Date().toISOString();
    const { error } = await db
      .from("attempt_realtime_sessions")
      .update({
        status,
        ended_at: status === "active" ? null : now,
        updated_at: now,
        continuity_diagnostics: input?.diagnostics ?? undefined,
        finalize_error: input?.finalizeError ?? undefined
      })
      .eq("id", sessionId)
      .eq("student_id", userId)
      .in("status", ["connecting", "active", "finalizing"]);
    if (error) throw error;
  } catch (error) {
    console.error("Failed to update realtime session status", {
      sessionId,
      userId,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

async function markRealtimeSubmissionErrorBestEffort(db: SupabaseClient, userId: string, attemptId: string): Promise<void> {
  try {
    await markAttemptSubmissionError(db, userId, attemptId, new Date().toISOString());
  } catch (error) {
    console.error("Failed to mark realtime voice attempt as error", {
      attemptId,
      userId,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

function safeJsonStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return "";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isMissingRealtimeHardeningSchema(error: { code?: string; message?: string; details?: string; hint?: string }): boolean {
  const text = `${error.code ?? ""} ${error.message ?? ""} ${error.details ?? ""} ${error.hint ?? ""}`.toLowerCase();
  return (
    text.includes("attempt_realtime_sessions")
    || text.includes("continuity_diagnostics")
    || text.includes("finalized_feedback")
    || text.includes("finalized_score")
    || text.includes("42703")
    || text.includes("42p01")
    || text.includes("pgrst204")
  );
}
