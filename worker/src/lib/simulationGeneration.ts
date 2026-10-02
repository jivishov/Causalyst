import { MAX_SIMULATION_STREAM_CHARS, type SimulationHtmlStreamEvent } from "@alt-assessment/shared";
import type { Env } from "./env";
import { serviceSupabase } from "./supabase";
import { resolveAttemptAiEnv } from "./aiSettings";
import { openaiClient, parseSimulationHtmlResponse, retrieveSimulationBackgroundResponse, streamSimulationForegroundResponse } from "./openai";
import { managedRequest, simulationOwner, simulationScheduler, type ManagedSimulationInput } from "./simulationManaged";
import { completeManagedSimulation, prepareManagedSimulation, setManagedSimulationState } from "../routes/simulation";

export const SIMULATION_CONCURRENCY = 5;
export const SIMULATION_START_INTERVAL_MS = 2_000;
const RUN_TIMEOUT_MS = 12 * 60_000; // Below the alarm's 15 minute wall-time limit.
const CHUNK_CHARS = 16_000; // UTF-8 and JSON escaping fit well below a KV value limit.
type QueueEntry = { id: string; expiresAt: number; dispatched?: boolean };
type SchedulerState = { queue: QueueEntry[]; active: QueueEntry[]; nextStart: number };
type GenerationState = {
  phase: "queued" | "dispatched" | "starting" | "running" | "saving" | "done";
  responseId?: string; retries: number; cursor: number; outputChunks: number;
  stop?: "cancelled" | "expired"; cleanupAt?: number;
  saveStartedAt?: number;
};

// The scheduler is one durable instance for every Worker instance and classroom.
// Admission is paced as well as capped; header-based pauses cover exhausted quotas.
export class SimulationScheduler {
  constructor(private ctx: DurableObjectState, private env: Env) {}

  async fetch(request: Request): Promise<Response> {
    return this.ctx.blockConcurrencyWhile(async () => {
      const state = await this.read();
      const path = new URL(request.url).pathname;
      const input = request.method === "POST" ? await request.json() as { id?: string; expiresAt?: number; until?: number } : {};
      if (path === "/enqueue" && input.id && Number.isFinite(input.expiresAt)) {
        if (!state.queue.some(e => e.id === input.id) && !state.active.some(e => e.id === input.id)) {
          state.queue.push({ id: input.id, expiresAt: input.expiresAt! });
        }
      } else if (path === "/release" && input.id) {
        state.active = state.active.filter(e => e.id !== input.id);
        state.queue = state.queue.filter(e => e.id !== input.id);
      } else if (path === "/pause" && Number.isFinite(input.until)) {
        state.nextStart = Math.max(state.nextStart, Math.min(Date.now() + 5 * 60_000, input.until!));
      } else if (path === "/position") {
        const id = new URL(request.url).searchParams.get("id");
        return Response.json({ position: state.queue.findIndex(e => e.id === id) + 1 });
      } else return new Response("Unknown scheduler operation", { status: 400 });
      await this.ctx.storage.put("state", state);
      await this.ctx.storage.setAlarm(Math.max(Date.now() + 1, state.nextStart));
      return Response.json({ ok: true });
    });
  }

  async alarm(): Promise<void> {
    await this.ctx.blockConcurrencyWhile(async () => {
      const state = await this.read();
      const now = Date.now();
      // Do not free a slot solely because a clock expired: its owner must stop first.
      for (const entry of [...state.active, ...state.queue].filter(e => e.expiresAt <= now)) {
        await managedRequest(simulationOwner(this.env, entry.id), "/expire");
        state.active = state.active.filter(e => e.id !== entry.id);
        state.queue = state.queue.filter(e => e.id !== entry.id);
      }
      for (const entry of state.active.filter(e => !e.dispatched)) {
        await managedRequest(simulationOwner(this.env, entry.id), "/start");
        entry.dispatched = true;
        await this.ctx.storage.put("state", state);
      }
      if (state.queue.length && state.active.length < SIMULATION_CONCURRENCY && now >= state.nextStart) {
        const entry = state.queue.shift()!;
        state.active.push(entry);
        state.nextStart = now + SIMULATION_START_INTERVAL_MS;
        // Persist the lease before dispatch. Repeated dispatch is idempotent.
        await this.ctx.storage.put("state", state);
        await managedRequest(simulationOwner(this.env, entry.id), "/start");
        entry.dispatched = true;
      }
      await this.ctx.storage.put("state", state);
      if (state.queue.length || state.active.length) {
        const expiry = Math.min(...[...state.queue, ...state.active].map(e => e.expiresAt));
        const next = state.queue.length && state.active.length < SIMULATION_CONCURRENCY ? state.nextStart : expiry;
        await this.ctx.storage.setAlarm(Math.max(now + 1, Math.min(next, expiry)));
      }
    });
  }

  private async read(): Promise<SchedulerState> {
    return await this.ctx.storage.get<SchedulerState>("state") ?? { queue: [], active: [], nextStart: 0 };
  }
}

// Private bindings only. Public routes authenticate ownership before calling this object.
// The alarm owns the provider connection; browser streams are independent subscribers.
export class SimulationGeneration {
  private abort?: AbortController;
  private subscribers = new Set<(event: SimulationHtmlStreamEvent) => void>();
  private source = "";
  private state?: GenerationState;
  private input?: ManagedSimulationInput;
  private ready: Promise<void>;

  constructor(private ctx: DurableObjectState, private env: Env) {
    this.ready = ctx.blockConcurrencyWhile(async () => {
      this.state = await ctx.storage.get<GenerationState>("state");
      const serialized = await readChunks(ctx.storage, "input");
      if (serialized) this.input = JSON.parse(serialized) as ManagedSimulationInput;
      this.source = await readChunks(ctx.storage, "output");
    });
  }

  async fetch(request: Request): Promise<Response> {
    await this.ready;
    const path = new URL(request.url).pathname;
    if (path === "/init") {
      await this.ctx.blockConcurrencyWhile(async () => {
        if (!this.state) {
          this.input = await request.json() as ManagedSimulationInput;
          await writeChunks(this.ctx.storage, "input", JSON.stringify(this.input));
          this.state = { phase: "queued", retries: 0, cursor: 0, outputChunks: 0 };
          await this.persist();
        }
        if (this.state.phase === "queued") await this.ctx.storage.setAlarm(Date.now() + 1);
      });
      return Response.json({ ok: true });
    }
    if (!this.state || !this.input) return new Response("Unknown generation", { status: 404 });
    if (path === "/start") {
      if (this.state.phase === "queued") {
        this.state.phase = "dispatched";
        await this.persist();
        await this.ctx.storage.setAlarm(Date.now() + 1);
      }
      return Response.json({ ok: true });
    }
    if (path === "/cancel" || path === "/expire") {
      // Already received HTML is saved before applying a delayed deadline.
      if (this.state.phase === "saving" || this.state.phase === "done") return Response.json({ ok: true });
      this.state.stop = path === "/cancel" ? "cancelled" : "expired";
      await this.persist();
      this.abort?.abort();
      await this.ctx.storage.setAlarm(Date.now() + 1);
      return Response.json({ ok: true });
    }
    if (path === "/stream") return this.subscribe(request);
    return Response.json({ phase: this.state.phase });
  }

  async alarm(): Promise<void> {
    await this.ready;
    if (!this.state || !this.input) return;
    if (this.state.phase === "done") {
      await this.release();
      if (Date.now() >= (this.state.cleanupAt ?? 0)) await this.ctx.storage.deleteAll();
      else await this.ctx.storage.setAlarm(this.state.cleanupAt!);
      return;
    }
    if (this.state.phase === "queued" && !this.state.stop) {
      await managedRequest(simulationScheduler(this.env), "/enqueue", { id: this.input.job.id, expiresAt: Date.parse(this.input.job.expires_at) });
      // Also covers a lost initial enqueue acknowledgement without creating provider work.
      if (this.state.phase === "queued") await this.ctx.storage.setAlarm(Date.parse(this.input.job.expires_at));
      return;
    }

    const db = serviceSupabase(this.env);
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const runtime = await resolveAttemptAiEnv(db, this.env, this.input.job.attempt_id);
      const client = openaiClient(runtime.OPENAI_API_KEY, undefined, runtime.AI_SETTINGS);
      if (this.state.phase === "saving") {
        if (Date.now() - (this.state.saveStartedAt ?? Date.now()) > 60 * 60_000) {
          await this.finish("failed", "The model finished, but saving remained unavailable. Your sketch is saved.");
          return;
        }
        await this.saveCompleted(runtime);
        return;
      }
      // Alarm delivery is at least once. Never replay a possibly accepted POST.
      if (this.state.phase === "starting" || this.state.phase === "running" || this.state.stop) {
        if (this.state.responseId) {
          const response = await retrieveSimulationBackgroundResponse(client, this.state.responseId);
          if (response.status === "completed") {
            await this.recordCompleted(response);
            await this.saveCompleted(runtime);
            return;
          }
          if (!this.state.stop && Date.now() < Date.parse(this.input.job.expires_at)
            && ["queued", "in_progress"].includes(response.status)) {
            await this.ctx.storage.setAlarm(Date.now() + 15_000);
            return;
          }
        }
        await this.finish(this.state.stop ?? "failed", this.state.stop ? undefined : "Connection interrupted before completion. The model request will not be repeated automatically.");
        return;
      }
      if (Date.now() >= Date.parse(this.input.job.expires_at)) { await this.finish("expired"); return; }
      const prepared = await prepareManagedSimulation(db, runtime, this.input);
      if (this.state.stop) { await this.finish(this.state.stop); return; }
      this.abort = new AbortController();
      timeout = setTimeout(() => this.abort?.abort(), Math.max(1, Math.min(RUN_TIMEOUT_MS, Date.parse(this.input.job.expires_at) - Date.now())));
      // Write the intent before the POST so a restart cannot create a duplicate.
      this.state.phase = "starting";
      await this.persist();
      const { data: stream, response: httpResponse } = await streamSimulationForegroundResponse(client, prepared, this.abort.signal);
      await this.observeLimits(httpResponse.headers, prepared.model.maxOutputTokens ?? 64_000);
      let lastCheckpoint = 0;
      for await (const event of stream) {
        if (event.type === "response.created" || event.type === "response.in_progress") {
          this.state.responseId = event.response.id;
          this.state.phase = "running";
          await this.persist();
          const job = await setManagedSimulationState(db, this.input.job, "in_progress", this.state.responseId, event.response.service_tier);
          this.emit({ type: "job", job });
        } else if (event.type === "response.output_text.delta") {
          if (this.state.stop) break;
          this.source += event.delta;
          if (this.source.length > MAX_SIMULATION_STREAM_CHARS) throw new Error("Output display limit exceeded");
          this.state.cursor++;
          this.emit({ type: "html_delta", delta: event.delta, cursor: this.state.cursor });
          if (this.source.length - lastCheckpoint >= CHUNK_CHARS) {
            await this.checkpoint();
            lastCheckpoint = this.source.length;
          }
        } else if (event.type === "response.completed") {
          await this.recordCompleted(event.response);
          await this.saveCompleted(runtime);
          return;
        } else if (event.type === "response.failed" || event.type === "response.incomplete" || event.type === "error") {
          await this.finish(event.type === "response.incomplete" ? "incomplete" : "failed", "The model could not finish this preview. Your sketch is saved.");
          return;
        }
      }
      // A broken stream is recovered by its known response ID, never by a new POST.
      await this.checkpoint();
      await this.ctx.storage.setAlarm(Date.now() + 1);
    } catch (error) {
      const status = error && typeof error === "object" && "status" in error ? Number(error.status) : 0;
      const code = error && typeof error === "object" && "code" in error ? String(error.code) : "";
      console.error("Managed simulation interrupted", { jobId: this.input.job.id, phase: this.state.phase, status, code });
      if (this.state.phase === "saving") {
        // Keep the completed HTML for a storage retry; no model request is needed.
        await this.ctx.storage.setAlarm(Date.now() + 15_000);
      } else if (!this.state.responseId && [429, 503].includes(status) && code !== "insufficient_quota" && this.state.retries < 3 && !this.state.stop) {
        this.state.retries++;
        this.state.phase = "queued";
        const headers = error && typeof error === "object" && "headers" in error ? error.headers as Headers : undefined;
        const delay = retryDelay(headers, this.state.retries);
        await this.persist();
        await managedRequest(simulationScheduler(this.env), "/pause", { until: Date.now() + delay });
        await this.release();
        await this.ctx.storage.setAlarm(Date.now() + delay);
      } else if (this.state.responseId && Date.now() < Date.parse(this.input.job.expires_at)) {
        await this.ctx.storage.setAlarm(Date.now() + 15_000);
      } else {
        await this.finish(this.state.stop ?? (Date.now() >= Date.parse(this.input.job.expires_at) ? "expired" : "failed"), "Generation did not finish safely. Your sketch is saved. This request will not be repeated automatically.");
      }
    } finally {
      clearTimeout(timeout);
      this.abort = undefined;
    }
  }

  private async recordCompleted(response: { model: string; service_tier?: string | null }): Promise<void> {
    this.source = parseSimulationHtmlResponse(response);
    if (this.source.length > MAX_SIMULATION_STREAM_CHARS) throw new Error("Output display limit exceeded");
    await this.checkpoint();
    await this.ctx.storage.put("completed", { model: response.model, service_tier: response.service_tier ?? null });
    this.state!.phase = "saving";
    this.state!.saveStartedAt = Date.now();
    await this.persist();
    // Saving can retry independently without occupying a model execution slot.
    await this.release();
  }

  private async saveCompleted(runtime: Env): Promise<void> {
    const metadata = await this.ctx.storage.get<{ model: string; service_tier: string | null }>("completed");
    const job = await completeManagedSimulation(serviceSupabase(this.env), runtime, this.input!.job,
      { ...metadata, status: "completed", output_text: this.source });
    this.emit({ type: "job", job });
    await this.done();
  }

  private async finish(status: "failed" | "incomplete" | "cancelled" | "expired", message?: string): Promise<void> {
    const job = await setManagedSimulationState(serviceSupabase(this.env), this.input!.job, status, this.state?.responseId,
      undefined, message ?? (status === "cancelled" ? "Generation was cancelled." : "Generation timed out. Your sketch is saved."));
    this.emit({ type: "job", job });
    await this.done();
  }

  private async done(): Promise<void> {
    this.state!.phase = "done";
    this.state!.cleanupAt = Date.now() + 60 * 60_000;
    await this.persist();
    await this.release();
    await this.ctx.storage.setAlarm(this.state!.cleanupAt);
  }

  private async release(): Promise<void> {
    await managedRequest(simulationScheduler(this.env), "/release", { id: this.input!.job.id });
  }

  private async observeLimits(headers: Headers, outputLimit: number): Promise<void> {
    const remaining = headers.get("x-ratelimit-remaining-tokens");
    const requests = headers.get("x-ratelimit-remaining-requests");
    const delays = [];
    if (remaining !== null && Number(remaining) < outputLimit) delays.push(durationMs(headers.get("x-ratelimit-reset-tokens")));
    if (requests !== null && Number(requests) < 1) delays.push(durationMs(headers.get("x-ratelimit-reset-requests")));
    if (delays.length) await managedRequest(simulationScheduler(this.env), "/pause", { until: Date.now() + Math.max(2_000, ...delays) });
  }

  private async checkpoint(): Promise<void> {
    this.state!.outputChunks = await writeChunks(this.ctx.storage, "output", this.source);
    await this.persist();
  }

  private async persist(): Promise<void> { await this.ctx.storage.put("state", this.state!); }
  private emit(event: SimulationHtmlStreamEvent): void { for (const send of this.subscribers) send(event); }

  private subscribe(request: Request): Response {
    let close = () => {};
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start: controller => {
        let closed = false;
        const send = (event: SimulationHtmlStreamEvent) => {
          if (!closed) controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        };
        const heartbeat = setInterval(() => send({ type: "heartbeat" }), 10_000);
        const deadline = setTimeout(() => close(), 55_000);
        close = () => {
          if (closed) return;
          closed = true;
          clearInterval(heartbeat); clearTimeout(deadline);
          request.signal.removeEventListener("abort", close);
          this.subscribers.delete(send);
          try { controller.close(); } catch { /* Reader cancellation already closed it. */ }
        };
        this.subscribers.add(send);
        request.signal.addEventListener("abort", close, { once: true });
        send({ type: "html_snapshot", source: this.source, cursor: this.state!.cursor });
        if (request.signal.aborted || this.state!.phase === "done") close();
      },
      cancel() { close(); }
    });
    return new Response(body, { headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store, no-transform" } });
  }
}

async function writeChunks(storage: DurableObjectStorage, prefix: string, value: string): Promise<number> {
  const entries: Record<string, string | number> = {};
  const count = Math.ceil(value.length / CHUNK_CHARS);
  for (let i = 0; i < count; i++) entries[`${prefix}:${i}`] = value.slice(i * CHUNK_CHARS, (i + 1) * CHUNK_CHARS);
  entries[`${prefix}:count`] = count;
  // Writes and the manifest commit together so restart snapshots never mix versions.
  await storage.transaction(async txn => {
    const pairs = Object.entries(entries);
    for (let offset = 0; offset < pairs.length; offset += 64) {
      await txn.put(Object.fromEntries(pairs.slice(offset, offset + 64)));
    }
  });
  return count;
}

async function readChunks(storage: DurableObjectStorage, prefix: string): Promise<string> {
  const count = await storage.get<number>(`${prefix}:count`) ?? 0;
  if (!count) return "";
  const keys = Array.from({ length: count }, (_, i) => `${prefix}:${i}`);
  let value = "";
  for (let offset = 0; offset < keys.length; offset += 64) {
    const batch = keys.slice(offset, offset + 64);
    const chunks = await storage.get<string>(batch);
    value += batch.map(key => chunks.get(key) ?? "").join("");
  }
  return value;
}

export function durationMs(value: string | null): number {
  if (!value) return 30_000;
  let total = 0;
  for (const match of value.matchAll(/(\d+(?:\.\d+)?)(ms|s|m|h)/g)) {
    total += Number(match[1]) * ({ ms: 1, s: 1_000, m: 60_000, h: 3_600_000 }[match[2]] ?? 0);
  }
  return Math.max(1_000, Math.min(300_000, total || 30_000));
}

export function retryDelay(headers: Headers | undefined, retry: number): number {
  const raw = headers?.get("retry-after");
  const delay = raw ? (/^\d+(?:\.\d+)?$/.test(raw) ? Number(raw) * 1000 : Date.parse(raw) - Date.now()) : 5_000 * 2 ** retry;
  return Math.max(2_000, Math.min(300_000, Number.isFinite(delay) ? delay : 30_000));
}
