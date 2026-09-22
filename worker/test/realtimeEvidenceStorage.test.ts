import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { authoritativeTranscript, collectProviderEvidence, MAX_EVIDENCE_TEXT_BYTES, RealtimeEvidence, type EvidenceState } from "../src/lib/realtimeEvidence";

async function fixture() {
  const saved = new Map<string, unknown>();
  let alarmAt: number | null = null;
  const write = async (key: string | Record<string, unknown>, value?: unknown) => {
    if (typeof key === "string") saved.set(key, structuredClone(value));
    else for (const [name, item] of Object.entries(key)) saved.set(name, structuredClone(item));
  };
  const storage = {
    get: vi.fn(async (key: string) => structuredClone(saved.get(key))),
    put: vi.fn(write),
    delete: vi.fn(async (key: string) => saved.delete(key)),
    deleteAll: vi.fn(async () => { saved.clear(); alarmAt = null; }),
    setAlarm: vi.fn(async (time: number) => { alarmAt = time; })
  };
  let initialized: Promise<unknown> = Promise.resolve();
  const pending: Promise<unknown>[] = [];
  const listeners = new Map<string, (message: { data: string }) => void>();
  const socket = { accept() {}, send: vi.fn(), close: vi.fn(),
    addEventListener: (type: string, listener: (message: { data: string }) => void) => listeners.set(type, listener) };
  const provider = vi.fn(async (url: string) => url.includes("?call_id=")
    ? { webSocket: socket } as unknown as Response : new Response(null, { status: 204 }));
  vi.stubGlobal("fetch", provider);
  const object = new RealtimeEvidence({ storage,
    blockConcurrencyWhile(callback: () => Promise<unknown>) { initialized = callback(); return initialized; },
    waitUntil(promise: Promise<unknown>) { pending.push(promise); }
  } as unknown as DurableObjectState, { OPENAI_API_KEY: "synthetic" } as never);
  await initialized;
  const start = await object.fetch(new Request("https://evidence.internal/start", { method: "POST",
    body: JSON.stringify({ callId: "rtc_fixture", deadline: Date.now() + 60000 }) }));
  expect(start.status).toBe(200);
  const emit = (event: Record<string, unknown>) => listeners.get("message")!({ data: JSON.stringify(event) });
  async function speech() {
    emit({ type: "input_audio_buffer.committed", item_id: "audio" });
    emit({ type: "conversation.item.input_audio_transcription.completed", item_id: "audio", transcript: "Observed evidence" });
    await Promise.all(pending);
  }
  async function seal() {
    const result = object.fetch(new Request("https://evidence.internal/seal", { method: "POST" }));
    await vi.advanceTimersByTimeAsync(1000);
    return result;
  }
  return { object, storage, saved, provider, emit, speech, seal, write, alarmAt: () => alarmAt };
}

describe("live evidence persistence and provider cleanup", () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-22T00:00:00Z")); });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it("ignores provider events that do not change captured evidence", async () => {
    const f = await fixture();
    const writes = f.storage.put.mock.calls.length;
    f.emit({ type: "response.output_audio.delta", delta: "unused-audio" });
    await Promise.resolve();
    expect(f.storage.put).toHaveBeenCalledTimes(writes);
  });

  it("never acknowledges an in-memory seal after its persistence fails", async () => {
    const f = await fixture();
    await f.speech();
    f.storage.put.mockImplementation(async (key, value) => {
      if (key === "evidence" && (value as EvidenceState).sealed) throw new Error("Storage unavailable");
      return f.write(key, value);
    });
    expect((await f.seal()).status).toBe(502);
    expect((await f.seal()).status).toBe(502);
    expect((f.saved.get("evidence") as EvidenceState).sealed).toBe(false);
  });

  it("retains sealed evidence during failed hangup and alarm retries", async () => {
    const f = await fixture();
    await f.speech();
    f.provider.mockResolvedValueOnce(new Response(null, { status: 503 }));
    const response = await f.seal();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ transcript: "Student: Observed evidence" });
    expect(f.alarmAt()).toBe(Date.now() + 60000);
    expect(f.saved.has("callId")).toBe(true);
    await vi.advanceTimersByTimeAsync(60000);
    await f.object.alarm();
    expect(f.saved.has("callId")).toBe(false);
    const evidence = f.saved.get("evidence") as EvidenceState;
    expect(evidence.sealed).toBe(true);
    expect(f.storage.deleteAll).not.toHaveBeenCalled();
    expect(f.alarmAt()).toBe(evidence.retainUntil);
    vi.setSystemTime(evidence.retainUntil! + 1);
    await f.object.alarm();
    expect(f.saved.has("evidence")).toBe(false);
  });

  it("expires transcript content even while provider closure remains unavailable", async () => {
    const f = await fixture();
    await f.speech();
    f.provider.mockImplementation(async () => new Response(null, { status: 503 }));
    expect((await f.seal()).status).toBe(200);
    const evidence = f.saved.get("evidence") as EvidenceState;
    vi.setSystemTime(evidence.retainUntil! + 1);
    await expect(f.object.alarm()).rejects.toThrow(/close provider call/);
    expect(f.saved.has("evidence")).toBe(false);
    expect(f.saved.has("callId")).toBe(true);
    expect(f.alarmAt()).toBe(Date.now() + 60000);
    f.provider.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await f.object.alarm();
    expect(f.saved.size).toBe(0);
  });
});

describe("bounded provider transcript", () => {
  const state = (): EvidenceState => ({ deadline: 1000, turns: [], failed: false, sealed: false });
  it("does not overwrite a completed turn with a conflicting completion", () => {
    const evidence = state();
    collectProviderEvidence(evidence, { type: "input_audio_buffer.committed", item_id: "one" }, 100);
    const completed = { type: "conversation.item.input_audio_transcription.completed", item_id: "one", transcript: "First" };
    collectProviderEvidence(evidence, completed, 101);
    expect(collectProviderEvidence(evidence, completed, 102)).toBe(false);
    collectProviderEvidence(evidence, { ...completed, transcript: "Different" }, 103);
    expect(evidence.turns[0].text).toBe("First");
    expect(() => authoritativeTranscript(evidence)).toThrow(/incomplete/);
  });
  it("bounds the combined UTF-8 transcript without grading a truncated prefix", () => {
    const evidence = state();
    for (let i = 0; i < 4; i++) {
      collectProviderEvidence(evidence, { type: "input_audio_buffer.committed", item_id: String(i) }, 100);
      collectProviderEvidence(evidence, { type: "conversation.item.input_audio_transcription.completed", item_id: String(i), transcript: "é".repeat(12000) }, 101);
    }
    expect(new TextEncoder().encode(evidence.turns.map(turn => turn.text ?? "").join("")).byteLength).toBeLessThanOrEqual(MAX_EVIDENCE_TEXT_BYTES);
    expect(() => authoritativeTranscript(evidence)).toThrow(/incomplete/);
  });
});
