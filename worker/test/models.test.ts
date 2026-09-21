import { describe, expect, it } from "vitest";
import { SIMULATION_CODE_MODEL_OPTIONS } from "@alt-assessment/shared";
import { getModel, getSimulationCodeModel, modelCatalog, modelNeedsConfirmation, simulationCodeModelCatalog, toOpenAIModelCatalogEntry } from "../src/lib/models";

describe("model catalog", () => {
  it("returns configured logical models", () => {
    expect(getModel("grading").id).toBeTruthy();
    expect(getModel("transcription").id).toContain("transcribe");
    expect(getModel("simulationSpec")).toMatchObject({
      id: "gpt-5.4-mini",
      reasoningEffort: "high",
      verbosity: "low",
      maxOutputTokens: 32000,
      fallbackModelId: "gpt-5.5"
    });
    expect(getModel("simulationHtml")).toMatchObject({
      id: "gpt-5.5",
      reasoningEffort: "medium",
      verbosity: "low",
      maxOutputTokens: 24000
    });
    expect(getModel("simulationHtml").fallbackModelId).toBeUndefined();
    expect(getModel("simulationSketchImage").id).toBe("gpt-image-2");
    expect(getModel("simulationReadinessClassifier")).toMatchObject({
      id: "gpt-5.4-mini",
      reasoningEffort: "xhigh",
      verbosity: "low"
    });
    expect(getModel("simulationReadinessClassifier").fallbackModelId).toBeUndefined();
    expect(getModel("fidelityReview")).toMatchObject({
      id: "gpt-5.4-mini",
      reasoningEffort: "xhigh",
      verbosity: "low",
      fallbackModelId: "gpt-5.5"
    });
    expect(getModel("realtimeVoice").id).toBe("gpt-realtime");
  });

  it("does not require confirmation for default catalog entries", () => {
    expect(modelNeedsConfirmation("grading")).toBe(false);
  });

  it("exposes only sketch-aware simulation code models and excludes gpt-5.4-pro", () => {
    expect(Object.keys(simulationCodeModelCatalog)).toEqual([
      "openai:gpt-5.5",
      "openai:gpt-5.4",
      "openai:gpt-5.4-mini",
      "kimi:kimi-k2.6",
      "zai:glm-5v-turbo"
    ]);
    expect(JSON.stringify(simulationCodeModelCatalog)).not.toContain("gpt-5.4-pro");
    expect(JSON.stringify(SIMULATION_CODE_MODEL_OPTIONS)).not.toContain("gpt-5.4-pro");
    expect(getSimulationCodeModel("kimi:kimi-k2.6")).toMatchObject({
      provider: "kimi",
      providerModelId: "kimi-k2.6",
      apiKeyEnv: "MOONSHOT_API_KEY",
      baseURL: "https://api.moonshot.ai/v1",
      generationApi: "chat.completions",
      inputModalities: ["text", "image"]
    });
    expect(getSimulationCodeModel("zai:glm-5v-turbo")).toMatchObject({
      provider: "zai",
      providerModelId: "glm-5v-turbo",
      apiKeyEnv: "ZAI_API_KEY",
      baseURL: "https://api.z.ai/api/paas/v4/",
      generationApi: "chat.completions",
      inputModalities: ["text", "image"]
    });
    expect(toOpenAIModelCatalogEntry(getSimulationCodeModel("openai:gpt-5.4-mini"))).toMatchObject({
      id: "gpt-5.4-mini",
      reasoningEffort: "high",
      verbosity: "low",
      maxOutputTokens: 24000
    });
  });

  it("requires confirmation when a role explicitly sets requiresConfirmation", () => {
    const original = { ...modelCatalog.grading };
    modelCatalog.grading = { ...modelCatalog.grading, requiresConfirmation: true };
    try {
      expect(modelNeedsConfirmation("grading")).toBe(true);
    } finally {
      modelCatalog.grading = original;
    }
  });

  it("does not include gpt-5.4-pro in confirmation-gated models", () => {
    expect(modelNeedsConfirmation("simulationHtml")).toBe(false);
  });

  it("still supports confirmation checks for explicitly gated catalog entries", () => {
    const original = { ...modelCatalog.fidelityReview };
    modelCatalog.fidelityReview = { ...modelCatalog.fidelityReview, requiresConfirmation: true };
    try {
      expect(modelNeedsConfirmation("fidelityReview")).toBe(true);
    } finally {
      modelCatalog.fidelityReview = original;
    }
  });
});
