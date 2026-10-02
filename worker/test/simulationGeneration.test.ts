import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as ai from "../src/lib/openai";
import { SimulationGeneration, SimulationScheduler, SIMULATION_CONCURRENCY, durationMs, retryDelay } from "../src/lib/simulationGeneration";
import type { Env } from "../src/lib/env";
import type { ManagedSimulationInput } from "../src/lib/simulationManaged";

vi.mock("../src/lib/supabase", () => ({ serviceSupabase: () => ({}) }));
vi.mock("../src/lib/aiSettings", () => ({ resolveAttemptAiEnv: async (_db: unknown, env: Env) => env }));
const hooks = vi.hoisted(() => ({ prepare: vi.fn(), complete: vi.fn(), update: vi.fn() }));
vi.mock("../src/routes/simulation", () => ({ prepareManagedSimulation: hooks.prepare,
  completeManagedSimulation: hooks.complete, setManagedSimulationState: hooks.update }));

class Storage {
  values = new Map<string, unknown>();
  alarmAt: number | null = null;
  async get(key: string | string[]) {
    if (Array.isArray(key)) return new Map(key.filter(k => this.values.has(k)).map(k => [k, structuredClone(this.values.get(k))]));
    return structuredClone(this.values.get(key));
  }
  async put(key: string | Record<string, unknown>, value?: unknown) {
    if (typeof key === "string") this.values.set(key, structuredClone(value));
    else for (const [k, v] of Object.entries(key)) this.values.set(k, structuredClone(v));
  }
  async transaction(fn: (txn: Storage) => Promise<unknown>) { return fn(this); }
  async setAlarm(at: number) { this.alarmAt = at; }
  async deleteAll() { this.values.clear(); this.alarmAt = null; }
}

function context(storage: Storage): DurableObjectState {
  let pending = Promise.resolve();
  return { storage, blockConcurrencyWhile<T>(fn: () => Promise<T>) {
    const result = pending.then(fn); pending = result.then(() => undefined, () => undefined); return result;
  } } as unknown as DurableObjectState;
}

function input(id: string): ManagedSimulationInput {
  return { description: id, model: { id: "gpt-6.1-sol", maxOutputTokens: 64000, fastMode: true }, job: {
    id, attempt_id: `attempt-${id}`, student_id: `student-${id}`, operation: "generate", status: "queued", provider: "openai",
    requested_model: "gpt-6.1-sol", reasoning_effort: "medium", provider_status: "managed_queued",
    expires_at: new Date(Date.now() + 20 * 60_000).toISOString(), sketch_artifact_id: `sketch-${id}`
  } as ManagedSimulationInput["job"] };
}

function harness() {
  const stores = new Map<string, Storage>();
  const owners = new Map<string, SimulationGeneration>();
  const env = { OPENAI_API_KEY: "synthetic" } as Env;
  const schedulerStorage = new Storage();
  const scheduler = new SimulationScheduler(context(schedulerStorage), env);
  env.SIMULATION_SCHEDULER = { idFromName: (s: string) => s, get: () => ({ fetch: (r: Request) => scheduler.fetch(r) }) } as unknown as DurableObjectNamespace;
  const owner = (id: string) => {
    if (!owners.has(id)) {
      const storage = stores.get(id) ?? new Storage(); stores.set(id, storage);
      owners.set(id, new SimulationGeneration(context(storage), env));
    }
    return owners.get(id)!;
  };
  env.SIMULATION_GENERATIONS = { idFromName: (s: string) => s, get: (id: string) => ({ fetch: (r: Request) => owner(id).fetch(r) }) } as unknown as DurableObjectNamespace;
  const post = (id: string, path: string, value?: unknown) => owner(id).fetch(new Request(`https://internal${path}`,
    { method: "POST", ...(value === undefined ? {} : { body: JSON.stringify(value) }) }));
  const init = async (id: string) => { await post(id, "/init", input(id)); await owner(id).alarm(); };
  return { env, stores, owners, scheduler, schedulerStorage, owner, post, init };
}

describe("durable foreground simulation jobs", () => {
  beforeEach(() => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-02T16:00:00Z"));
    hooks.prepare.mockImplementation(async (_db, _env, value) => ({ description: value.description, sketchFileId: "file-synthetic",
      model: value.model, htmlReasoningEffort: value.job.reasoning_effort, currentHtml: value.currentHtml }));
    hooks.complete.mockImplementation(async (_db, _env, job) => ({ jobId: job.id, status: "completed", message: "Preview ready." }));
    hooks.update.mockImplementation(async (_db, job, status) => ({ jobId: job.id, status, message: status }));
    vi.spyOn(ai, "openaiClient").mockReturnValue({} as never);
  });
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.clearAllMocks(); });

  it("paces 25 simultaneous students, caps concurrency at five and completes every job once", async () => {
    const h = harness();
    const controls = new Map<string, () => void>();
    let active = 0, maximum = 0;
    const calls: string[] = [];
    vi.spyOn(ai, "streamSimulationForegroundResponse").mockImplementation(async (_client, prepared) => {
      calls.push(prepared.description); active++; maximum = Math.max(maximum, active);
      let finish!: () => void; const wait = new Promise<void>(resolve => { finish = resolve; });
      controls.set(prepared.description, finish);
      return { response: new Response(null), data: (async function* () {
        try {
          yield { type: "response.created", response: { id: `resp-${prepared.description}`, service_tier: "fast" } };
          yield { type: "response.output_text.delta", delta: "<!doctype html><html>" };
          await wait;
          yield { type: "response.completed", response: { model: "gpt-6.1-sol", output_text: "<!doctype html><html></html>" } };
        } finally { active--; }
      })() } as never;
    });
    await Promise.all(Array.from({ length: 25 }, (_, i) => h.init(`job-${i}`)));
    const running = new Map<string, Promise<void>>();
    for (let wave = 0; wave < 5; wave++) {
      for (let slot = 0; slot < SIMULATION_CONCURRENCY; slot++) {
        await h.scheduler.alarm();
        const id = `job-${wave * 5 + slot}`;
        const promise = h.owner(id).alarm(); running.set(id, promise);
        // Let the provider acknowledgement and first HTML event arrive.
        for (let i = 0; i < 30; i++) await Promise.resolve();
        await vi.advanceTimersByTimeAsync(2000);
      }
      expect(active).toBe(5);
      const before = calls.length;
      await h.scheduler.alarm();
      expect(calls).toHaveLength(before);
      for (let slot = 0; slot < 5; slot++) controls.get(`job-${wave * 5 + slot}`)!();
      await Promise.all([...running.values()]); running.clear();
      expect(active).toBe(0);
    }
    expect(maximum).toBe(5);
    expect(new Set(calls).size).toBe(25);
    expect(hooks.complete).toHaveBeenCalledTimes(25);
    expect(h.schedulerStorage.values.get("state")).toMatchObject({ queue: [], active: [] });
  });

  it("continues generation after a student disconnects and reconnects with a replacement snapshot", async () => {
    const h = harness(); let finish!: () => void; let signal!: AbortSignal;
    const wait = new Promise<void>(resolve => { finish = resolve; });
    vi.spyOn(ai, "streamSimulationForegroundResponse").mockImplementation(async (_client, _input, abortSignal) => {
      signal = abortSignal;
      return { response: new Response(null), data: (async function* () {
        yield { type: "response.created", response: { id: "resp-known" } };
        yield { type: "response.output_text.delta", delta: "<!doctype html>" };
        await wait;
        yield { type: "response.completed", response: { model: "gpt-6.1-sol", output_text: "<!doctype html><html></html>" } };
      })() } as never;
    });
    await h.init("job"); await h.scheduler.alarm();
    const running = h.owner("job").alarm();
    for (let i = 0; i < 30; i++) await Promise.resolve();
    const response = await h.post("job", "/stream");
    const reader = response.body!.getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toContain('"source":"<!doctype html>"');
    await reader.cancel();
    expect(signal.aborted).toBe(false);
    const reconnect = await h.post("job", "/stream");
    const secondReader = reconnect.body!.getReader();
    expect(new TextDecoder().decode((await secondReader.read()).value)).toContain('"type":"html_snapshot"');
    finish(); await running; await secondReader.cancel();
    expect(hooks.complete).toHaveBeenCalledTimes(1);
  });

  it("recovers a known response on alarm replay without another provider POST", async () => {
    const h = harness(); await h.init("job");
    const store = h.stores.get("job")!;
    await store.put("state", { phase: "running", responseId: "resp-known", retries: 0, cursor: 1, outputChunks: 0 });
    h.owners.delete("job");
    const create = vi.spyOn(ai, "streamSimulationForegroundResponse");
    vi.spyOn(ai, "retrieveSimulationBackgroundResponse").mockResolvedValue({ status: "completed", model: "gpt-6.1-sol",
      output: [{ type: "message", content: [{ type: "output_text", text: "<!doctype html><html></html>" }] }] });
    await h.owner("job").alarm();
    expect(create).not.toHaveBeenCalled();
    expect(hooks.complete).toHaveBeenCalledTimes(1);
    expect(store.values.get("state")).toMatchObject({ phase: "done" });
  });

  it("never repeats an ambiguous create and only requeues explicit temporary rejections", async () => {
    const h = harness(); await h.init("unknown"); await h.scheduler.alarm();
    const create = vi.spyOn(ai, "streamSimulationForegroundResponse").mockRejectedValue(new Error("Connection lost"));
    await h.owner("unknown").alarm();
    expect(h.stores.get("unknown")!.values.get("state")).toMatchObject({ phase: "done" });
    await h.owner("unknown").alarm(); expect(create).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(2000); await h.init("limited"); await h.scheduler.alarm();
    create.mockRejectedValue({ status: 429, code: "rate_limit_exceeded", headers: new Headers({ "retry-after": "25" }) });
    await h.owner("limited").alarm();
    expect(h.stores.get("limited")!.values.get("state")).toMatchObject({ phase: "queued", retries: 1 });
    expect(h.schedulerStorage.values.get("state")).toMatchObject({ nextStart: Date.now() + 25000 });
  });

  it("retries saving completed HTML without repeating generation", async () => {
    const h = harness(); await h.init("job"); await h.scheduler.alarm();
    vi.spyOn(ai, "streamSimulationForegroundResponse").mockResolvedValue({ response: new Response(null), data: (async function* () {
      yield { type: "response.completed", response: { model: "gpt-6.1-sol", output_text: "<!doctype html><html></html>" } };
    })() } as never);
    hooks.complete.mockRejectedValueOnce(new Error("Storage temporarily unavailable"));
    await h.owner("job").alarm();
    expect(h.stores.get("job")!.values.get("state")).toMatchObject({ phase: "saving" });
    h.owners.delete("job"); await h.owner("job").alarm();
    expect(ai.streamSimulationForegroundResponse).toHaveBeenCalledTimes(1);
    expect(hooks.complete).toHaveBeenCalledTimes(2);
  });

  it("honours reset and Retry-After values without accepting unbounded delays", () => {
    expect(durationMs("1m2.5s")).toBe(62500);
    expect(durationMs("500ms")).toBe(1000);
    expect(retryDelay(new Headers({ "retry-after": "12" }), 1)).toBe(12000);
    expect(retryDelay(new Headers({ "retry-after": "999999" }), 1)).toBe(300000);
  });

  it("cancels a queued request without creating a model response", async () => {
    const h = harness(); await h.init("cancelled");
    const create = vi.spyOn(ai, "streamSimulationForegroundResponse");
    await h.post("cancelled", "/cancel");
    await h.owner("cancelled").alarm();
    expect(create).not.toHaveBeenCalled();
    expect(hooks.update).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ id: "cancelled" }), "cancelled", undefined, undefined, "Generation was cancelled.");
    expect(h.schedulerStorage.values.get("state")).toMatchObject({ queue: [], active: [] });
  });

  it("saves a response completed before the deadline when expiry delivery is delayed", async () => {
    const h = harness(); await h.init("late");
    const store = h.stores.get("late")!;
    await store.put("state", { phase: "running", responseId: "resp-known", retries: 0, cursor: 0, outputChunks: 0 });
    h.owners.delete("late");
    await vi.advanceTimersByTimeAsync(21 * 60_000);
    await h.post("late", "/expire");
    vi.spyOn(ai, "retrieveSimulationBackgroundResponse").mockResolvedValue({ status: "completed", model: "gpt-6.1-sol", output_text: "<!doctype html><html></html>" });
    await h.owner("late").alarm();
    expect(hooks.complete).toHaveBeenCalledTimes(1);
    expect(hooks.update).not.toHaveBeenCalledWith(expect.anything(), expect.anything(), "expired", expect.anything(), expect.anything(), expect.anything());
  });

  it("confirms an active cancellation even when the provider connection is interrupted", async () => {
    const h = harness(); await h.init("active"); await h.scheduler.alarm();
    vi.spyOn(ai, "streamSimulationForegroundResponse").mockImplementation(async (_client, _input, signal) => ({
      response: new Response(null), data: (async function* () {
        yield { type: "response.created", response: { id: "resp-active" } };
        await new Promise<void>((_resolve, reject) => signal.addEventListener("abort", () => reject(new Error("Aborted")), { once: true }));
      })()
    }) as never);
    const running = h.owner("active").alarm();
    for (let i = 0; i < 30; i++) await Promise.resolve();
    await h.post("active", "/cancel"); await running;
    expect(h.stores.get("active")!.values.get("state")).toMatchObject({ phase: "done", stop: "cancelled" });
    expect(hooks.update).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ id: "active" }), "cancelled", "resp-active", undefined, "Generation was cancelled.");
    expect(ai.streamSimulationForegroundResponse).toHaveBeenCalledTimes(1);
  });

  it("does not replay an ambiguous provider server error", async () => {
    const h = harness(); await h.init("server-error"); await h.scheduler.alarm();
    vi.spyOn(ai, "streamSimulationForegroundResponse").mockRejectedValue({ status: 503, code: "server_error" });
    await h.owner("server-error").alarm(); await h.owner("server-error").alarm();
    expect(h.stores.get("server-error")!.values.get("state")).toMatchObject({ phase: "done", retries: 0 });
    expect(ai.streamSimulationForegroundResponse).toHaveBeenCalledTimes(1);
  });
});
