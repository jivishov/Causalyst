import { afterEach, describe, expect, it, vi } from "vitest";
import * as dbLib from "../src/lib/db";
import { defaultAiSettings } from "../src/lib/aiSettings";
import { getSimulationModelSettings } from "../src/routes/simulation";
import type { Env } from "../src/lib/env";

const env = { OPENAI_API_KEY: "synthetic-server-key" } as Env;
const request = new Request("https://test/api/simulation/attempts/attempt/settings");

describe("student simulation model settings", () => {
  afterEach(() => vi.restoreAllMocks());

  it("shows current teacher HTML reasoning and the captured sketch model before generation without changing the attempt or exposing credentials", async () => {
    vi.spyOn(dbLib, "requireAttempt").mockResolvedValue({ attempt: { id: "attempt" }, assessment: { type: "simulation", config: { simulationCodeModelId: "openai:gpt-5.6-terra" } } } as never);
    const frozen = defaultAiSettings(env);
    frozen.apiKeys.openai = "synthetic-encrypted-value";
    const current = defaultAiSettings(env);
    current.forceDefaultSimulationModel = true;
    current.codeModels[0] = { ...current.codeModels[0], reasoningEffort: "high", maxOutputTokens: 56000 };
    current.roleModels.simulationSketchImage.id = "synthetic-new-sketch";
    const rpc = vi.fn().mockResolvedValue({ data: { teacherId: "teacher", runtime: frozen, settings: current }, error: null });
    const fetch = vi.spyOn(globalThis, "fetch");
    const settings = await getSimulationModelSettings(request, env, { rpc } as never, "student", "attempt");
    expect(settings).toEqual({ sketchModelId: "gpt-image-2.5-flare", htmlModelId: "gpt-6.1-sol", htmlReasoningEffort: "high", htmlMaxOutputTokens: 56000 });
    expect(rpc).toHaveBeenCalledExactlyOnceWith("get_attempt_ai_context", { p_attempt_id: "attempt" });
    expect(fetch).not.toHaveBeenCalled();
    expect(frozen.codeModels[0].reasoningEffort).toBe("max");
    expect(JSON.stringify(settings)).not.toContain("synthetic-encrypted-value");
    expect(JSON.stringify(settings)).not.toContain(env.OPENAI_API_KEY);
  });

  it("honors assignment model selection when the teacher does not force the default", async () => {
    vi.spyOn(dbLib, "requireAttempt").mockResolvedValue({ assessment: { type: "simulation", config: { simulationCodeModelId: "openai:gpt-5.6-terra" } } } as never);
    const current = defaultAiSettings(env);
    current.codeModels[1] = { ...current.codeModels[1], enabled: true, reasoningEffort: "medium" };
    const rpc = vi.fn().mockResolvedValue({ data: { teacherId: "teacher", runtime: null, settings: current }, error: null });
    expect(await getSimulationModelSettings(request, env, { rpc } as never, "student", "attempt")).toMatchObject({ htmlModelId: "gpt-5.6-terra", htmlReasoningEffort: "medium" });
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("reports provider default reasoning for non-OpenAI HTML", async () => {
    vi.spyOn(dbLib, "requireAttempt").mockResolvedValue({ assessment: { type: "simulation", config: {} } } as never);
    const current = defaultAiSettings(env);
    current.defaultSimulationModelId = "kimi:kimi-k2.6";
    current.codeModels.find(model => model.id === current.defaultSimulationModelId)!.enabled = true;
    const rpc = vi.fn().mockResolvedValue({ data: { teacherId: "teacher", runtime: null, settings: current }, error: null });
    expect(await getSimulationModelSettings(request, env, { rpc } as never, "student", "attempt")).toMatchObject({ htmlModelId: "kimi-k2.6", htmlReasoningEffort: "none" });
  });

  it("checks attempt ownership before reading teacher configuration", async () => {
    vi.spyOn(dbLib, "requireAttempt").mockRejectedValue(new Error("Attempt not found"));
    const rpc = vi.fn();
    await expect(getSimulationModelSettings(request, env, { rpc } as never, "another-student", "attempt")).rejects.toThrow("Attempt not found");
    expect(rpc).not.toHaveBeenCalled();
  });
});
