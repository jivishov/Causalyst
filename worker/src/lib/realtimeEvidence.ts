import type { Env } from "./env";
import { HttpError } from "./http";

interface AudioTurn { id: string; sequence: number; text: string | null }
export const MAX_EVIDENCE_TEXT_BYTES = 64 * 1024;
const MAX_AUDIO_TURNS = 500;
const RETENTION_MS = 86400_000;
const CLOSE_RETRY_MS = 60_000;
export interface EvidenceState {
  deadline: number;
  turns: AudioTurn[];
  failed: boolean;
  sealed: boolean;
  pendingAudio?: string[];
  retainUntil?: number;
}

// Only events received on the authenticated provider-to-server socket enter here.
// Client conversation items and client timestamps never establish audio evidence.
export function collectProviderEvidence(state: EvidenceState, event: Record<string, unknown>, receivedAt: number): boolean {
  if (state.sealed || state.failed) return false;
  const id = event.item_id;
  if (typeof id !== "string" || !["input_audio_buffer.speech_started", "input_audio_buffer.committed",
    "conversation.item.input_audio_transcription.completed", "conversation.item.input_audio_transcription.failed"].includes(String(event.type))) return false;
  if (id.length > 200) { state.failed = true; return true; }
  let changed = false;
  state.pendingAudio ??= [];
  if (event.type === "input_audio_buffer.speech_started" && receivedAt <= state.deadline) {
    if (!state.pendingAudio.includes(id)) {
      if (state.pendingAudio.length >= MAX_AUDIO_TURNS) state.failed = true;
      else state.pendingAudio.push(id);
      changed = true;
    }
  }
  if (event.type === "input_audio_buffer.committed" && state.pendingAudio.includes(id)) {
    if (receivedAt > state.deadline) state.failed = true;
    state.pendingAudio = state.pendingAudio.filter((pending) => pending !== id);
    changed = true;
  }
  if (event.type === "input_audio_buffer.committed" && receivedAt <= state.deadline) {
    if (!state.turns.some((turn) => turn.id === id)) {
      if (state.turns.length >= MAX_AUDIO_TURNS) { state.failed = true; return true; }
      state.turns.push({ id, sequence: state.turns.length, text: null });
      changed = true;
    }
  }
  const turn = state.turns.find((entry) => entry.id === id);
  if (turn && event.type === "conversation.item.input_audio_transcription.completed") {
    if (typeof event.transcript !== "string" || event.transcript.length > 24000) state.failed = true;
    else {
      const text = event.transcript.trim();
      if (turn.text !== null) {
        if (turn.text === text) return changed;
        state.failed = true; // Conflicting completions cannot replace captured evidence.
      } else {
        const totalBytes = new TextEncoder().encode(state.turns.map(entry => entry.text ?? "").join("") + text).byteLength;
        if (totalBytes > MAX_EVIDENCE_TEXT_BYTES) state.failed = true;
        else turn.text = text;
      }
    }
    changed = true;
  }
  if (turn && event.type === "conversation.item.input_audio_transcription.failed") { state.failed = true; changed = true; }
  return changed;
}

export function authoritativeTranscript(state: EvidenceState): string {
  if (state.failed || Boolean(state.pendingAudio?.length) || state.turns.some((turn) => turn.text === null)) {
    throw new HttpError(409, "Authoritative audio evidence is incomplete; retry finalization or ask your teacher for review.");
  }
  const text = state.turns.filter((turn) => turn.text).map((turn) => `Student: ${turn.text}`).join("\n");
  if (!text) throw new HttpError(422, "No authoritative speech transcript was captured. Start a new attempt.");
  return text;
}

export async function realtimeEvidence(env: Env, sessionId: string, action: "start" | "seal", body: Record<string, unknown> = {}): Promise<{ transcript: string; turns: number }> {
  if (!env.REALTIME_SESSIONS) throw new HttpError(503, "Live voice evidence service is not configured");
  const stub = env.REALTIME_SESSIONS.get(env.REALTIME_SESSIONS.idFromName(sessionId));
  const response = await stub.fetch(`https://evidence.internal/${action}`, { method: "POST", body: JSON.stringify(body) });
  const result = await response.json() as { transcript: string; turns: number; error?: string };
  if (!response.ok) throw new HttpError(response.status, result.error ?? "Live voice evidence is unavailable");
  return result;
}

/** Private binding only: never routed from public HTTP. Persists provider evidence
 * before acknowledging finalization, and fails closed if the socket is lost. */
export class RealtimeEvidence {
  private socket: WebSocket | null = null;
  private evidence: EvidenceState | null = null;
  private callId: string | null = null;
  private sealing: Promise<Response> | null = null;
  private writes: Promise<void> = Promise.resolve();
  constructor(private ctx: DurableObjectState, private env: Env) {
    ctx.blockConcurrencyWhile(async () => {
      this.evidence = await ctx.storage.get<EvidenceState>("evidence") ?? null;
      this.callId = await ctx.storage.get<string>("callId") ?? null;
      // An interrupted transport cannot be reconstructed from browser telemetry.
      if (this.evidence && !this.evidence.sealed) this.evidence.failed = true;
    });
  }
  async fetch(request: Request): Promise<Response> {
    try {
      const action = new URL(request.url).pathname;
      if (action === "/start") return await this.start(await request.json() as { callId: string; deadline: number });
      if (action === "/seal") {
        if (!this.sealing) this.sealing = this.seal().finally(() => { this.sealing = null; });
        return (await this.sealing).clone();
      }
      return new Response(null, { status: 404 });
    } catch (error) {
      return Response.json({ error: error instanceof HttpError ? error.message : "Live evidence collection failed" }, { status: error instanceof HttpError ? error.status : 502 });
    }
  }
  private async start(input: { callId: string; deadline: number }): Promise<Response> {
    if (this.evidence) throw new HttpError(409, "Evidence session already exists");
    if (!/^rtc_[\w-]+$/.test(input.callId) || !Number.isFinite(input.deadline) || input.deadline <= Date.now() || input.deadline > Date.now() + 1800_000) {
      throw new HttpError(400, "Invalid evidence session");
    }
    this.callId = input.callId;
    this.evidence = { deadline: input.deadline, turns: [], failed: false, sealed: false };
    await this.ctx.storage.put({ evidence: this.evidence, callId: this.callId });
    // Even an unsuccessful sideband attachment must leave a cleanup alarm.
    await this.ctx.storage.setAlarm(input.deadline);
    const response = await fetch(`https://api.openai.com/v1/realtime?call_id=${encodeURIComponent(input.callId)}`, {
      headers: { Upgrade: "websocket", Authorization: `Bearer ${this.env.OPENAI_API_KEY}` },
      signal: AbortSignal.timeout(10_000)
    });
    if (!response.webSocket) throw new HttpError(502, "Could not attach authoritative voice evidence");
    this.socket = response.webSocket;
    this.socket.accept();
    this.socket.addEventListener("message", (message) => {
      const receivedAt = Date.now();
      try {
        if (!this.evidence) return;
        const event = JSON.parse(String(message.data)) as Record<string, unknown>;
        if (!collectProviderEvidence(this.evidence, event, receivedAt)) return;
        const snapshot = structuredClone(this.evidence!);
        this.writes = this.writes.then(() => this.ctx.storage.put("evidence", snapshot));
        this.ctx.waitUntil(this.writes.catch(() => { if (this.evidence) this.evidence.failed = true; }));
      } catch { if (this.evidence) this.evidence.failed = true; }
    });
    this.socket.addEventListener("close", () => {
      if (this.evidence && !this.evidence.sealed && Date.now() < this.evidence.deadline) this.evidence.failed = true;
    });
    this.socket.addEventListener("error", () => { if (this.evidence && !this.evidence.sealed) this.evidence.failed = true; });
    return Response.json({ transcript: "", turns: 0 });
  }
  private async seal(): Promise<Response> {
    if (!this.evidence) throw new HttpError(409, "Authoritative evidence session is unavailable");
    if (!this.evidence.sealed) {
      // Flush while the call is still connected. Only provider commits received
      // before the server deadline qualify, even when transcription arrives later.
      try { this.socket?.send(JSON.stringify({ type: "input_audio_buffer.commit" })); } catch { /* Already closed at cutoff. */ }
      await new Promise((resolve) => setTimeout(resolve, 1000));
      this.evidence.deadline = Math.min(this.evidence.deadline, Date.now());
      for (let i = 0; i < 20 && this.evidence.turns.some((turn) => turn.text === null); i++) {
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      await this.writes;
      authoritativeTranscript(this.evidence);
      const sealed = { ...structuredClone(this.evidence), sealed: true, retainUntil: Date.now() + RETENTION_MS };
      // Do not expose an in-memory success state before the write succeeds.
      await this.ctx.storage.put("evidence", sealed);
      this.evidence = sealed;
    }
    // Hangup is external: retain the sealed evidence while retrying a failure.
    await this.ctx.storage.setAlarm(Date.now() + CLOSE_RETRY_MS);
    try {
      await this.hangup();
      await this.ctx.storage.setAlarm(this.evidence.retainUntil ?? this.evidence.deadline + RETENTION_MS);
    } catch { /* The durable alarm retries closure; grading uses the saved transcript. */ }
    return Response.json({ transcript: authoritativeTranscript(this.evidence), turns: this.evidence.turns.length });
  }
  private async hangup(): Promise<void> {
    if (this.callId) {
      const response = await fetch(`https://api.openai.com/v1/realtime/calls/${encodeURIComponent(this.callId)}/hangup`, {
        method: "POST", headers: { Authorization: `Bearer ${this.env.OPENAI_API_KEY}` }, signal: AbortSignal.timeout(10_000)
      });
      if (!response.ok && response.status !== 404) throw new HttpError(502, "Could not close provider call");
      await this.ctx.storage.delete("callId");
      this.callId = null;
    }
    this.socket?.close();
    this.socket = null;
  }
  async alarm(): Promise<void> {
    if (!this.evidence && !this.callId) return;
    const retainUntil = this.evidence ? this.evidence.retainUntil ?? this.evidence.deadline + RETENTION_MS : 0;
    if (this.evidence && Date.now() >= retainUntil) {
      await this.writes.catch(() => {});
      await this.ctx.storage.delete("evidence");
      this.evidence = null;
    }
    // Stop provider billing/audio at the recording deadline. Already committed
    // turns may finish transcription during a short drain interval.
    if (this.evidence && !this.evidence.sealed && Date.now() < this.evidence.deadline + 2000) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    await this.ctx.storage.setAlarm(Date.now() + CLOSE_RETRY_MS);
    await this.hangup();
    await this.writes.catch(() => { if (this.evidence) this.evidence.failed = true; });
    if (this.evidence) {
      await this.ctx.storage.put("evidence", this.evidence);
      await this.ctx.storage.setAlarm(retainUntil);
    } else {
      await this.ctx.storage.deleteAll();
    }
  }
}
