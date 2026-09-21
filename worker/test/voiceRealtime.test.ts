import { beforeEach, describe, expect, it, vi } from "vitest";
import * as dbLib from "../src/lib/db";
import * as openaiLib from "../src/lib/openai";
import { appendRealtimeVoiceEvents, buildRealtimeTranscript, finalizeRealtimeVoice, normalizeRealtimeVoiceEvents } from "../src/routes/voiceRealtime";

describe("realtime voice event handling", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("normalizes and redacts browser-forwarded event metadata", () => {
    const events = normalizeRealtimeVoiceEvents([
      {
        sequence: 0,
        eventType: "conversation.item.input_audio_transcription.completed",
        role: "student",
        text: "  My answer is osmosis.  ",
        occurredAt: "2026-05-02T12:00:00.000Z",
        metadata: {
          item_id: "item-1",
          audio_delta: "base64-audio",
          client_secret: "ek_abcdefghijklmnopqrstuvwxyz",
          nested: {
            authorization: "Bearer sk-proj-secret",
            safe: "kept"
          }
        }
      }
    ]);

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      sequence: 0,
      role: "student",
      text: "My answer is osmosis."
    });
    expect(events[0].metadata.item_id).toBe("item-1");
    expect(events[0].metadata.audio_delta).toBeUndefined();
    expect(events[0].metadata.client_secret).toBeUndefined();
    expect(events[0].metadata.nested).toEqual({ safe: "kept" });
  });

  it("builds a durable transcript from student and assistant turns only", () => {
    const transcript = buildRealtimeTranscript([
      { role: "status", text: "started" },
      { role: "student", text: "Water moves across the membrane." },
      { role: "assistant", text: "Good start. What causes that movement?" },
      { role: null, text: "ignored" }
    ]);

    expect(transcript).toBe([
      "Student: Water moves across the membrane.",
      "GPT: Good start. What causes that movement?"
    ].join("\n"));
  });

  it("rejects oversized batches", () => {
    expect(() => normalizeRealtimeVoiceEvents(Array.from({ length: 101 }, (_, sequence) => ({
      sequence,
      eventType: "status"
    })))).toThrow(/limited to 100 events/);
  });
});

describe("realtime session lifecycle", () => {
  it("rejects event appends when session is not active", async () => {
    const db = createSessionDb({
      id: "session-1",
      attempt_id: "attempt-1",
      student_id: "student-1",
      provider: "openai",
      model: "gpt-realtime",
      status: "finalized",
      started_at: "2026-05-02T12:00:00.000Z",
      ended_at: "2026-05-02T12:02:00.000Z",
      expires_at: "2026-05-02T12:10:00.000Z",
      continuity_diagnostics: {},
      finalized_attempt_id: "attempt-1",
      finalized_transcript: "Student: done",
      finalized_score: 88,
      finalized_feedback: { score: 88, overallComment: "ok", criteria: [], confidence: "medium", reviewFlags: [] },
      finalized_at: "2026-05-02T12:02:00.000Z",
      finalize_error: null
    });

    const request = new Request("https://worker.test/api/voice/realtime/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: "session-1", events: [{ sequence: 0, eventType: "status" }] })
    });

    await expect(appendRealtimeVoiceEvents(request, db as never, "student-1")).rejects.toMatchObject({
      status: 409,
      message: "Realtime session is not active"
    });
  });

  it("returns idempotent replay for finalized sessions without re-grading", async () => {
    vi.spyOn(openaiLib, "gradeVoice");
    vi.spyOn(dbLib, "requireAttempt").mockResolvedValue({
      attempt: {
        id: "attempt-1",
        status: "graded",
        assignment_id: "assignment-1",
        assessment_id: "assessment-1",
        student_id: "student-1",
        transcript: "Student: osmosis",
        provisional_score: 91,
        provisional_feedback: {
          score: 91,
          overallComment: "Strong answer",
          criteria: [],
          confidence: "high",
          reviewFlags: []
        }
      },
      assessment: {
        id: "assessment-1",
        type: "voice_realtime",
        title: "Realtime Voice",
        prompt: "Prompt",
        rubric: [],
        config: {}
      }
    } as any);

    const db = createSessionDb({
      id: "session-2",
      attempt_id: "attempt-1",
      student_id: "student-1",
      provider: "openai",
      model: "gpt-realtime",
      status: "finalized",
      started_at: "2026-05-02T12:00:00.000Z",
      ended_at: "2026-05-02T12:02:00.000Z",
      expires_at: "2026-05-02T12:10:00.000Z",
      continuity_diagnostics: {},
      finalized_attempt_id: "attempt-1",
      finalized_transcript: "Student: osmosis",
      finalized_score: 91,
      finalized_feedback: { score: 91, overallComment: "Strong answer", criteria: [], confidence: "high", reviewFlags: [] },
      finalized_at: "2026-05-02T12:02:00.000Z",
      finalize_error: null
    });

    const request = new Request("https://worker.test/api/voice/realtime/finalize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: "session-2" })
    });

    const result = await finalizeRealtimeVoice(request, { OPENAI_API_KEY: "key" } as never, db as never, "student-1");
    expect(result).toEqual(expect.objectContaining({
      attemptId: "attempt-1",
      score: 91,
      idempotentReplay: true,
      sessionStatus: "finalized"
    }));
    expect(openaiLib.gradeVoice).not.toHaveBeenCalled();
  });

  it("rejects event appends when an active session is expired", async () => {
    const db = createSessionDb({
      id: "session-expired",
      attempt_id: "attempt-1",
      student_id: "student-1",
      provider: "openai",
      model: "gpt-realtime",
      status: "active",
      started_at: "2026-05-02T12:00:00.000Z",
      ended_at: null,
      expires_at: "2000-01-01T00:00:00.000Z",
      continuity_diagnostics: {},
      finalized_attempt_id: null,
      finalized_transcript: null,
      finalized_score: null,
      finalized_feedback: null,
      finalized_at: null,
      finalize_error: null
    });
    const request = new Request("https://worker.test/api/voice/realtime/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: "session-expired", events: [{ sequence: 0, eventType: "status" }] })
    });

    await expect(appendRealtimeVoiceEvents(request, db as never, "student-1")).rejects.toMatchObject({
      status: 409,
      message: "Realtime session has expired"
    });
  });
});

function createSessionDb(session: Record<string, unknown>) {
  return {
    from(table: string) {
      if (table === "attempt_realtime_sessions") {
        return {
          select() {
            return this;
          },
          eq() {
            return this;
          },
          async maybeSingle() {
            return { data: session, error: null };
          }
        };
      }

      if (table === "attempt_realtime_events") {
        return {
          async upsert() {
            return { error: null };
          },
          select() {
            return this;
          },
          eq() {
            return this;
          },
          order() {
            return this;
          },
          then(resolve: (value: { data: unknown[]; error: null }) => void) {
            resolve({ data: [], error: null });
          }
        };
      }

      throw new Error(`Unexpected table ${table}`);
    }
  };
}
