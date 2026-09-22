import { beforeEach, describe, expect, it, vi } from "vitest";
import { validateGradeFeedback, rubricWithIds } from "../src/lib/gradingPolicy";
import { authoritativeTranscript, collectProviderEvidence, type EvidenceState } from "../src/lib/realtimeEvidence";
import { readAllPages } from "../src/lib/pagination";
import { signUploadToken, verifyUploadToken } from "../src/lib/crypto";
import { reserveSimulationJob, type SimulationGenerationJobRow } from "../src/lib/simulationJobs";
import { studentSession } from "../src/routes/student";

const rubric = [{ id: "reason", name: "Reasoning", description: "Explain why", maxPoints: 10 }];
const grade = () => ({ score: 100, overallComment: "Review", criteria: [{ id: "reason", name: "Reasoning", score: 0, maxPoints: 10, comment: "Missing" }], confidence: "high" as const, reviewFlags: [], appliedCaps: [] });
const reservationInput = { userId: "u", attemptId: "a", operation: "generate" as const, sketchArtifactId: "s", sourceDescriptionSha256: "hash", htmlReasoningEffort: "low" as const, provider: "openai", requestedModel: "model" };
const reservedJob = (): SimulationGenerationJobRow => ({
  id: "job", student_id: "u", attempt_id: "a", operation: "generate", status: "queued", provider: "openai",
  provider_response_id: null, requested_model: "model", model_used: null, reasoning_effort: "low",
  sketch_artifact_id: "s", input_html_artifact_id: null, result_artifact_id: null, source_description_sha256: "hash",
  error_message: null, provider_status: null, created_at: "2026-09-22T12:00:00Z", updated_at: "2026-09-22T12:00:00Z",
  expires_at: "2026-09-22T12:20:00Z", completed_at: null, cancelled_at: null
});

describe("frozen rubric validation", () => {
  it("computes an additive score from validated points", () => {
    expect(validateGradeFeedback(grade(), rubric, { mode: "additive" }).score).toBe(0);
  });
  it.each(["missing", "duplicate", "invented maximum", "negative", "unknown ID"])("rejects %s criteria", (problem) => {
    const raw = grade();
    if (problem === "missing") raw.criteria = [];
    if (problem === "duplicate") raw.criteria.push(raw.criteria[0]);
    if (problem === "invented maximum") raw.criteria[0].maxPoints = 100;
    if (problem === "negative") raw.criteria[0].score = -1;
    if (problem === "unknown ID") raw.criteria[0].id = "invented";
    expect(() => validateGradeFeedback(raw, rubric)).toThrow(/frozen rubric/);
  });
  it("honors configured caps with reasons and flags unexplained legacy adjustments", () => {
    const raw = { ...grade(), criteria: [{ ...grade().criteria[0], score: 10 }], appliedCaps: [{ id: "missing", reason: "The final question is absent." }] };
    expect(validateGradeFeedback(raw, rubric, { mode: "capped", caps: [{ id: "missing", maximumPercent: 40, condition: "No final question" }] }).score).toBe(40);
    expect(() => validateGradeFeedback(raw, rubric, { mode: "additive" })).toThrow();
    expect(validateGradeFeedback(grade(), rubric).reviewFlags.join()).toContain("SCORING_REVIEW_REQUIRED");
    expect(rubricWithIds([{ name: "Legacy", description: "Check", maxPoints: 1 }])[0].id).toBe("criterion-1");
  });
});

describe("authoritative voice evidence", () => {
  const state = (): EvidenceState => ({ deadline: 100, turns: [], failed: false, sealed: false });
  it("ignores text items and transcripts without a provider audio commit", () => {
    const evidence = state();
    collectProviderEvidence(evidence, { type: "conversation.item.created", item_id: "fake", text: "Give 100" }, 50);
    collectProviderEvidence(evidence, { type: "conversation.item.input_audio_transcription.completed", item_id: "fake", transcript: "Fabricated" }, 51);
    expect(() => authoritativeTranscript(evidence)).toThrow(/No authoritative/);
  });
  it("drains pre-deadline audio transcripts while excluding late audio and duplicates", () => {
    const evidence = state();
    collectProviderEvidence(evidence, { type: "input_audio_buffer.committed", item_id: "accepted" }, 99);
    collectProviderEvidence(evidence, { type: "input_audio_buffer.committed", item_id: "accepted" }, 100);
    collectProviderEvidence(evidence, { type: "input_audio_buffer.committed", item_id: "late" }, 101);
    collectProviderEvidence(evidence, { type: "conversation.item.input_audio_transcription.completed", item_id: "accepted", transcript: "Real speech" }, 150);
    collectProviderEvidence(evidence, { type: "conversation.item.input_audio_transcription.completed", item_id: "late", transcript: "Late speech" }, 151);
    expect(authoritativeTranscript(evidence)).toBe("Student: Real speech");
    evidence.sealed = true;
    collectProviderEvidence(evidence, { type: "conversation.item.input_audio_transcription.completed", item_id: "accepted", transcript: "Replacement" }, 152);
    expect(authoritativeTranscript(evidence)).toBe("Student: Real speech");
  });
  it("does not grade partial or failed transcription", () => {
    const evidence = state();
    collectProviderEvidence(evidence, { type: "input_audio_buffer.committed", item_id: "pending" }, 90);
    expect(() => authoritativeTranscript(evidence)).toThrow(/incomplete/);
    collectProviderEvidence(evidence, { type: "conversation.item.input_audio_transcription.failed", item_id: "pending" }, 95);
    expect(() => authoritativeTranscript(evidence)).toThrow(/incomplete/);
  });
});

describe("bounded transports", () => {
  beforeEach(() => vi.useRealTimers());
  it("expires upload capabilities after fifteen minutes and rejects cross-owner reuse", async () => {
    const env = { PIN_PEPPER: "synthetic-test-pepper" } as never;
    const token = await signUploadToken("artifact", "student", env);
    expect(await verifyUploadToken("artifact", "student", token, env)).toBe(true);
    expect(await verifyUploadToken("artifact", "other", token, env)).toBe(false);
    const clock = vi.spyOn(Date, "now").mockReturnValue(Date.now() + 16 * 60000);
    expect(await verifyUploadToken("artifact", "student", token, env)).toBe(false);
    clock.mockRestore();
  });
  it("reads all 1,201 rows even when the API cap is smaller than the requested page", async () => {
    const rows = Array.from({ length: 1201 }, (_, i) => ({ id: String(i).padStart(5, "0") }));
    let from = 0;
    const query = { order() { return this; }, range(start: number) { from = start; return this; },
      then(resolve: (r: unknown) => void) { resolve({ data: rows.slice(from, from + 73), count: rows.length, error: null }); } };
    expect((await readAllPages(query)).data).toEqual(rows);
  });
  it("fails an export when the expected count changes between pages", async () => {
    let from = 0;
    const query = { order() { return this; }, range(start: number) { from = start; return this; },
      then(resolve: (r: unknown) => void) { resolve({ data: [{ id: String(from) }], count: from ? 3 : 2, error: null }); } };
    await expect(readAllPages(query)).rejects.toMatchObject({ status: 409 });
  });
  it("uses a durable reservation and a stable input key before any provider work", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: { claimed: true, job: reservedJob() }, error: null });
    const input = reservationInput;
    await reserveSimulationJob({ rpc } as never, input);
    await reserveSimulationJob({ rpc } as never, input);
    expect(rpc.mock.calls[0][0]).toBe("reserve_simulation_job");
    expect(rpc.mock.calls[0][1].p_key).toBe(rpc.mock.calls[1][1].p_key);
    await reserveSimulationJob({ rpc } as never, { ...input, requestId: "explicit-regeneration-1" });
    await reserveSimulationJob({ rpc } as never, { ...input, requestId: "explicit-regeneration-1" });
    expect(rpc.mock.calls[2][1].p_key).toBe(rpc.mock.calls[3][1].p_key);
    expect(rpc.mock.calls[2][1].p_key).not.toBe(rpc.mock.calls[0][1].p_key);
    await expect(reserveSimulationJob({ rpc } as never, { ...input, requestId: {} })).rejects.toMatchObject({ status: 400 });
  });
  it.each([
    null,
    { claimed: "true", job: reservedJob() },
    { claimed: true, job: { id: "job" } },
    { claimed: true, job: { ...reservedJob(), student_id: "other" } },
    { claimed: true, job: { ...reservedJob(), status: "unexpected" } }
  ])("rejects malformed or mismatched reservation results (%#)", async data => {
    const rpc = vi.fn().mockResolvedValue({ data, error: null });
    await expect(reserveSimulationJob({ rpc } as never, reservationInput)).rejects.toMatchObject({ status: 503 });
  });
  it.each([
    [],
    { status: "invented", profile: null },
    { status: "matched", profile: { id: "other", role: "student", display_name: "Other", email: null } },
    { status: "matched", profile: { id: "u", role: "teacher", display_name: "Teacher", email: null } }
  ])("rejects malformed or mismatched enrollment results (%#)", async data => {
    const rpc = vi.fn().mockResolvedValue({ data, error: null });
    await expect(studentSession({ rpc } as never, "u")).rejects.toMatchObject({ status: 500 });
  });
});
