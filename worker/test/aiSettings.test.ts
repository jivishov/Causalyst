import { describe, expect, it, vi } from "vitest";
import { defaultAiSettings, publicAiSettings, resolveAttemptAiEnv, validateAiModelSettings } from "../src/lib/aiSettings";
import { encryptProviderSecret, decryptProviderSecret } from "../src/lib/providerSecrets";
import { getSimulationCodeModel } from "../src/lib/models";
import { openaiClient, transcribeAudio } from "../src/lib/openai";
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
    const db = { rpc: vi.fn(async () => ({ data: { teacherId: "teacher", runtime: settings, settings: null }, error: null })) };
    const result = await resolveAttemptAiEnv(db as never, { ...env, OPENAI_API_KEY: "synthetic-new-key" }, "attempt");
    expect(result.OPENAI_API_KEY).toBe("synthetic-original-key");
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

  it("enforces the allowed/default student model policy on the server", () => {
    const settings = defaultAiSettings(env);
    settings.codeModels[0].enabled = false;
    settings.codeModels[1].modelId = "future-approved-model";
    settings.defaultSimulationModelId = settings.codeModels[1].id;
    expect(getSimulationCodeModel(settings.codeModels[0].id, settings).providerModelId).toBe("future-approved-model");
    settings.forceDefaultSimulationModel = true;
    expect(getSimulationCodeModel(settings.codeModels[2].id, settings).providerModelId).toBe("future-approved-model");
    settings.codeModels[1].enabled = false;
    expect(() => validateAiModelSettings({ ...settings }, settings)).toThrow("default student model must be enabled");
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
