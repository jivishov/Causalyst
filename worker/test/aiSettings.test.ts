import { describe, expect, it, vi } from "vitest";
import { defaultAiSettings, publicAiSettings, resolveAttemptAiEnv, validateAiModelSettings } from "../src/lib/aiSettings";
import { encryptProviderSecret, decryptProviderSecret } from "../src/lib/providerSecrets";
import { getSimulationCodeModel } from "../src/lib/models";
import { buildSimulationHtmlResponsePayload, classifySimulationReadiness, openaiClient, transcribeAudio } from "../src/lib/openai";
import { toOpenAIModelCatalogEntry } from "../src/lib/models";
import { getTeacherAiSettings, updateTeacherAiSettings } from "../src/routes/teacherAiSettings";
import type { Env } from "../src/lib/env";

const env = { PIN_PEPPER: "synthetic-pepper-for-test-context-only", OPENAI_API_KEY: "synthetic-current-credential" } as Env;

describe("teacher assessment AI settings", () => {
  it("encrypts credentials with random IVs and rejects a different teacher/provider scope", async () => {
    const first = await encryptProviderSecret("synthetic-api-value", "teacher-a:openai", env);
    const second = await encryptProviderSecret("synthetic-api-value", "teacher-a:openai", env);
    expect(first).not.toBe(second);
    expect(first).not.toContain("synthetic-api-value");
    expect(await decryptProviderSecret(first, "teacher-a:openai", env)).toBe("synthetic-api-value");
    await expect(decryptProviderSecret(first, "teacher-b:openai", env)).rejects.toMatchObject({ status: 503 });
    await expect(decryptProviderSecret(first, "teacher-a:kimi", env)).rejects.toMatchObject({ status: 503 });
  });

  it("never returns plaintext or encrypted credentials in teacher settings", () => {
    const settings = defaultAiSettings(env);
    settings.apiKeys.openai = "encrypted-envelope";
    const response = publicAiSettings({ settings, updatedAt: null }, env);
    expect(response.keys.openai).toEqual({ configured: true, source: "teacher" });
    expect(JSON.stringify(response)).not.toContain("encrypted-envelope");
    expect(JSON.stringify(response)).not.toContain(env.OPENAI_API_KEY);
  });

  it("rejects student profiles before reading or saving any AI credentials", async () => {
    const query: any = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: { id: "student", role: "student" }, error: null }) };
    const db = { from: () => query, rpc: vi.fn() };
    await expect(getTeacherAiSettings(db as never, env, "student")).rejects.toMatchObject({ status: 403 });
    await expect(updateTeacherAiSettings(new Request("https://test", { method: "PUT", body: "{}" }), db as never, env, "student")).rejects.toMatchObject({ status: 403 });
    expect(db.rpc).not.toHaveBeenCalled();
  });

  it("uses the frozen attempt credential after teacher/server key changes", async () => {
    const settings = defaultAiSettings(env);
    settings.apiKeys.openai = await encryptProviderSecret("synthetic-original-key", "teacher:openai", env);
    settings.codeModels[0] = { ...settings.codeModels[0], modelId: "gpt-5.6-sol", reasoningEffort: "high", maxOutputTokens: 32000 };
    const db = { rpc: vi.fn(async () => ({ data: { teacherId: "teacher", runtime: settings, settings: null }, error: null })) };
    const result = await resolveAttemptAiEnv(db as never, { ...env, OPENAI_API_KEY: "synthetic-new-key" }, "attempt");
    expect(result.OPENAI_API_KEY).toBe("synthetic-original-key");
    expect(getSimulationCodeModel(settings.codeModels[0].id, result.AI_SETTINGS)).toMatchObject({ providerModelId: "gpt-5.6-sol", reasoningEffort: "high", maxOutputTokens: 32000 });
    expect(db.rpc).toHaveBeenCalledTimes(1);
  });

  it("captures shared keys before first use and respects a concurrently frozen configuration", async () => {
    const frozen = defaultAiSettings(env);
    frozen.apiKeys.openai = await encryptProviderSecret("synthetic-winning-key", "teacher:openai", env);
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: { teacherId: "teacher", runtime: null, settings: null }, error: null })
      .mockResolvedValueOnce({ data: frozen, error: null });
    const result = await resolveAttemptAiEnv({ rpc } as never, env, "attempt");
    const [name, args] = rpc.mock.calls[1];
    expect(name).toBe("capture_attempt_ai_settings");
    expect(await decryptProviderSecret(args.p_settings.apiKeys.openai, "teacher:openai", env)).toBe(env.OPENAI_API_KEY);
    expect(args.p_settings.codeModels.every((model: { enabled: boolean }) => model.enabled)).toBe(true);
    expect(result.OPENAI_API_KEY).toBe("synthetic-winning-key");
  });

  it("applies the current Terra policy to new HTML with the captured key and preserves other attempt settings", async () => {
    const frozen = defaultAiSettings(env);
    frozen.apiKeys.openai = await encryptProviderSecret("synthetic-original-key", "teacher:openai", env);
    const current = defaultAiSettings(env);
    current.apiKeys.openai = await encryptProviderSecret("synthetic-replacement-key", "teacher:openai", env);
    current.defaultSimulationModelId = "openai:gpt-5.6-terra";
    current.forceDefaultSimulationModel = true;
    current.codeModels[1] = { ...current.codeModels[1], reasoningEffort: "high", maxOutputTokens: 48000 };
    current.roleModels.grading = { id: "synthetic-new-grading-model", reasoningEffort: "low" };
    const rpc = vi.fn().mockResolvedValue({ data: { teacherId: "teacher", runtime: frozen, settings: current }, error: null });
    const result = await resolveAttemptAiEnv({ rpc } as never, env, "attempt", { currentSimulationModels: true });
    expect(result.OPENAI_API_KEY).toBe("synthetic-original-key");
    expect(result.AI_SETTINGS?.apiKeys).toEqual(frozen.apiKeys);
    expect(result.AI_SETTINGS?.roleModels.grading).toEqual(frozen.roleModels.grading);
    const model = getSimulationCodeModel("openai:gpt-5.6-sol", result.AI_SETTINGS);
    expect(buildSimulationHtmlResponsePayload({ description: "Synthetic classroom example", model: toOpenAIModelCatalogEntry(model) }).payload)
      .toMatchObject({ model: "gpt-5.6-terra", reasoning: { effort: "high" }, max_output_tokens: 48000 });
    const polling = await resolveAttemptAiEnv({ rpc } as never, env, "attempt");
    expect(polling.AI_SETTINGS).toEqual(frozen);
    expect(frozen.defaultSimulationModelId).toBe("openai:gpt-5.6-sol");
    expect(rpc.mock.calls.every(([name]) => name === "get_attempt_ai_context")).toBe(true);
  });

  it("enforces the allowed/default student model policy on the server", () => {
    const settings = defaultAiSettings(env);
    settings.codeModels[0].enabled = false;
    settings.codeModels[1].modelId = "future-approved-model";
    settings.defaultSimulationModelId = settings.codeModels[1].id;
    expect(getSimulationCodeModel(undefined, settings).providerModelId).toBe("future-approved-model");
    expect(getSimulationCodeModel(settings.codeModels[0].id, settings).providerModelId).toBe("future-approved-model");
    settings.forceDefaultSimulationModel = true;
    expect(getSimulationCodeModel(settings.codeModels[2].id, settings).providerModelId).toBe("future-approved-model");
    settings.codeModels[1].enabled = false;
    expect(() => validateAiModelSettings({ ...settings, providerModels: undefined }, settings)).toThrow("default student model must be enabled");
  });

  it("adds provider models, removes unused models, and applies a custom student default", () => {
    const settings = defaultAiSettings(env);
    const custom = { ...settings.providerModels![0], id: "openai:classroom-sol" as const, modelId: "synthetic-approved-text-model", label: "Classroom Sol", reasoningEffort: "xhigh" as const, maxOutputTokens: 28000 };
    const next = validateAiModelSettings({ ...settings, providerModels: [...settings.providerModels!.filter(model => model.id !== "openai:gpt-5.6-luna"), custom],
      defaultSimulationModelId: custom.id, forceDefaultSimulationModel: true,
      roleModels: { ...settings.roleModels, grading: { id: custom.modelId, catalogModelId: custom.id, reasoningEffort: "low", maxOutputTokens: 22000 } } }, settings);
    expect(next.codeModels.some(model => model.id === "openai:gpt-5.6-luna")).toBe(false);
    expect(getSimulationCodeModel("openai:gpt-5.6-luna", next)).toMatchObject({ id: custom.id, providerModelId: "synthetic-approved-text-model", reasoningEffort: "xhigh", maxOutputTokens: 28000 });
    const payload = buildSimulationHtmlResponsePayload({ description: "Synthetic classroom example", model: toOpenAIModelCatalogEntry(getSimulationCodeModel(custom.id, next)) });
    expect(payload.payload).toMatchObject({ model: "synthetic-approved-text-model", reasoning: { effort: "xhigh" }, max_output_tokens: 28000 });
  });

  it("rejects duplicates, removed role assignments, incompatible capabilities, and untrusted providers", () => {
    const settings = defaultAiSettings(env);
    expect(() => validateAiModelSettings({ ...settings, providerModels: [...settings.providerModels!, settings.providerModels![0]] }, settings)).toThrow("unique");
    expect(() => validateAiModelSettings({ ...settings, providerModels: settings.providerModels!.filter(model => model.modelId !== settings.roleModels.transcription.id) }, settings)).toThrow("compatible OpenAI model");
    expect(() => validateAiModelSettings({ ...settings, roleModels: { ...settings.roleModels, transcription: { ...settings.roleModels.transcription, catalogModelId: settings.providerModels![0].id } } }, settings)).toThrow("compatible OpenAI model");
    expect(() => validateAiModelSettings({ ...settings, providerModels: [{ ...settings.providerModels![0], provider: "https://untrusted.invalid" }] }, settings)).toThrow("supported provider");
  });

  it.each([
    ["gpt-6.1-sol", "image"],
    ["gpt-6.1-sol", "transcription"],
    ["gpt-6.1-sol", "realtime"],
    ["gpt-image-2.5-flare", "text"],
    ["gpt-4o-transcribe", "image"],
    ["gpt-realtime", "text"]
  ])("rejects the unsupported %s task API %s even when submitted directly", (modelId, capability) => {
    const settings = defaultAiSettings(env);
    const model = { ...settings.providerModels![0], id: "openai:unsupported-classification", modelId, capability, reasoningEffort: "none", enabled: false, maxOutputTokens: undefined };
    expect(() => validateAiModelSettings({ ...settings, providerModels: [...settings.providerModels!, model] }, settings)).toThrow("supported task capability");
  });

  it.each([15, 128001, 25.5, "25000", null])("rejects an invalid token limit %s", maxOutputTokens => {
    const settings = defaultAiSettings(env);
    expect(() => validateAiModelSettings({ ...settings, roleModels: { ...settings.roleModels, grading: { ...settings.roleModels.grading, maxOutputTokens } } }, settings)).toThrow("whole numbers");
  });

  it("rejects None for GPT-6.1 Sol and sends teacher role limits to Responses", async () => {
    const settings = defaultAiSettings(env);
    expect(() => validateAiModelSettings({ ...settings, roleModels: { ...settings.roleModels, grading: { id: "gpt-6.1-sol", reasoningEffort: "none" } } }, settings)).toThrow("supported reasoning effort");
    settings.roleModels.simulationReadinessClassifier = { id: "gpt-6.1-sol", reasoningEffort: "low", maxOutputTokens: 25000 };
    const client = openaiClient("synthetic", undefined, settings);
    const call = vi.spyOn(client.responses, "create").mockResolvedValue({ output_parsed: { decision: "allow" } } as never);
    await classifySimulationReadiness(client, { assessmentPrompt: "Synthetic", studentDescription: "A to B", deterministicSignals: {} as never });
    expect(call.mock.calls[0][0]).toMatchObject({ model: "gpt-6.1-sol", reasoning: { effort: "low" }, max_output_tokens: 25000 });
  });

  it("applies custom models per client without contaminating another classroom request", async () => {
    const custom = defaultAiSettings(env);
    custom.roleModels.transcription.id = "teacher-transcription-model";
    const customClient = openaiClient("synthetic", undefined, custom);
    const defaultClient = openaiClient("synthetic");
    const customCall = vi.spyOn(customClient.audio.transcriptions, "create").mockResolvedValue({ text: "Custom" } as never);
    const defaultCall = vi.spyOn(defaultClient.audio.transcriptions, "create").mockResolvedValue({ text: "Default" } as never);
    await Promise.all([transcribeAudio(customClient, new File(["x"], "audio.webm")), transcribeAudio(defaultClient, new File(["x"], "audio.webm"))]);
    expect(customCall.mock.calls[0][0].model).toBe("teacher-transcription-model");
    expect(defaultCall.mock.calls[0][0].model).toBe("gpt-4o-transcribe");
  });
});
