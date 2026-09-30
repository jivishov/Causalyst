import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as ai from "../src/lib/openai";
import * as settings from "../src/lib/aiSettings";
import { streamSimulationGenerationJob } from "../src/routes/simulation";

const job = { id: "job", student_id: "student", attempt_id: "attempt", operation: "generate", status: "in_progress", provider: "openai",
  provider_response_id: "resp_private_provider_id", provider_status: "in_progress", requested_model: "gpt-5.6-terra", model_used: "gpt-5.6-terra",
  reasoning_effort: "max", result_artifact_id: null, sketch_artifact_id: "sketch", input_html_artifact_id: null, source_description_sha256: "private_source_hash",
  created_at: new Date().toISOString(), updated_at: new Date().toISOString(), expires_at: new Date(Date.now() + 1200000).toISOString() };

function dbFor(owner = "student") {
  const filters = new Map<string, unknown>();
  const chain = { select() { return chain; }, eq(key: string, value: unknown) { filters.set(key, value); return chain; },
    async maybeSingle() { return { data: filters.get("student_id") === owner && filters.get("id") === "job" ? job : null, error: null }; } };
  return { from: vi.fn(() => chain) } as never;
}

describe("authenticated simulation streaming", () => {
  beforeEach(() => {
    vi.spyOn(settings, "resolveAttemptAiEnv").mockImplementation(async (_db, env) => env);
    vi.spyOn(ai, "openaiClient").mockReturnValue({} as never);
  });
  afterEach(() => vi.restoreAllMocks());

  it("delivers HTML before completion, filters provider internals and wakes normal finalization", async () => {
    let finish!: () => void;
    const finished = new Promise<void>(resolve => { finish = resolve; });
    vi.spyOn(ai, "streamSimulationBackgroundResponse").mockResolvedValue((async function* () {
      yield { type: "response.reasoning_text.delta", sequence_number: 1, delta: "private_reasoning", provider_response_id: job.provider_response_id };
      yield { type: "response.output_text.delta", sequence_number: 2, delta: "<h1>Code is arriving</h1>", obfuscation: "private_metadata" };
      await finished;
      yield { type: "response.completed", sequence_number: 3, response: { id: job.provider_response_id } };
    })() as never);
    const db = dbFor();
    const response = await streamSimulationGenerationJob(new Request("https://worker.test/api/simulation/jobs/job/stream?after=0"), { OPENAI_API_KEY: "synthetic" } as never, db, "student", "job");
    expect(response.headers.get("Cache-Control")).toBe("no-store, no-transform");
    const reader = response.body!.getReader();
    let output = "";
    while (!output.includes("Code is arriving")) output += new TextDecoder().decode((await reader.read()).value);
    expect(output).not.toContain("finalizing");
    finish();
    while (true) { const chunk = await reader.read(); if (chunk.done) break; output += new TextDecoder().decode(chunk.value); }
    expect(output).toContain('"status":"finalizing"');
    expect(output).not.toMatch(/private_reasoning|private_metadata|resp_private_provider_id|private_source_hash/);
    expect(ai.streamSimulationBackgroundResponse).toHaveBeenCalledWith(expect.anything(), job.provider_response_id, 0, expect.any(AbortSignal));
    expect((db as { from: ReturnType<typeof vi.fn> }).from).toHaveBeenCalledTimes(1);
  });

  it("rejects another student's job and invalid cursors before opening a stream", async () => {
    const upstream = vi.spyOn(ai, "streamSimulationBackgroundResponse");
    await expect(streamSimulationGenerationJob(new Request("https://worker.test/api/simulation/jobs/job/stream"), {} as never, dbFor(), "other", "job")).rejects.toMatchObject({ status: 404 });
    await expect(streamSimulationGenerationJob(new Request("https://worker.test/api/simulation/jobs/job/stream?after=-1"), {} as never, dbFor(), "student", "job")).rejects.toMatchObject({ status: 400 });
    expect(upstream).not.toHaveBeenCalled();
  });

  it("leaves legacy non-streaming jobs available to status polling", async () => {
    vi.spyOn(ai, "streamSimulationBackgroundResponse").mockRejectedValue({ status: 400, message: "private_provider_error" });
    const response = await streamSimulationGenerationJob(new Request("https://worker.test/api/simulation/jobs/job/stream"), { OPENAI_API_KEY: "synthetic" } as never, dbFor(), "student", "job");
    const text = await response.text();
    expect(text).toContain('"type":"unavailable"');
    expect(text).not.toMatch(/private_provider_error|"status":"failed"/);
  });

  it("disconnects the upstream connection without cancelling generation when a tab leaves", async () => {
    let signal: AbortSignal;
    vi.spyOn(ai, "streamSimulationBackgroundResponse").mockImplementation(async (_client, _id, _cursor, upstreamSignal) => {
      signal = upstreamSignal!;
      return (async function* () { yield { type: "response.output_text.delta", sequence_number: 1, delta: "<html>" };
        await new Promise<void>(resolve => signal.addEventListener("abort", () => resolve(), { once: true }));
      })() as never;
    });
    const cancel = vi.spyOn(ai, "cancelSimulationBackgroundResponse");
    const response = await streamSimulationGenerationJob(new Request("https://worker.test/api/simulation/jobs/job/stream"), { OPENAI_API_KEY: "synthetic" } as never, dbFor(), "student", "job");
    const reader = response.body!.getReader();
    let text = "";
    while (!text.includes("html_delta")) text += new TextDecoder().decode((await reader.read()).value);
    await reader.cancel();
    expect(signal!.aborted).toBe(true);
    expect(cancel).not.toHaveBeenCalled();
  });
});
