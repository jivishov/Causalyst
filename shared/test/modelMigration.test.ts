import { describe, expect, it } from "vitest";
import { DEFAULT_SIMULATION_CODE_MODEL_ID, SIMULATION_CODE_MODEL_OPTIONS, getSimulationCodeModelLabel, isSimulationCodeModelId, resolveSimulationCodeModelId } from "../src/assessmentConfig";

describe("GPT-5.6 model migration", () => {
  it("offers exactly the three requested OpenAI text models, with Sol as default", () => {
    expect(SIMULATION_CODE_MODEL_OPTIONS.filter(model => model.provider === "openai").map(model => model.id)).toEqual([
      "openai:gpt-5.6-sol", "openai:gpt-5.6-terra", "openai:gpt-5.6-luna"
    ]);
    expect(DEFAULT_SIMULATION_CODE_MODEL_ID).toBe("openai:gpt-5.6-sol");
  });

  it.each([
    ["openai:gpt-5.5", "openai:gpt-5.6-sol"],
    ["openai:gpt-5.4", "openai:gpt-5.6-sol"],
    ["openai:gpt-5.4-mini", "openai:gpt-5.6-terra"]
  ])("resolves saved %s assessments without offering the retired ID", (oldId, currentId) => {
    expect(isSimulationCodeModelId(oldId)).toBe(false);
    expect(resolveSimulationCodeModelId(oldId)).toBe(currentId);
    expect(getSimulationCodeModelLabel(oldId)).toBe(getSimulationCodeModelLabel(currentId));
  });

  it("retains other providers and rejects unknown models", () => {
    expect(resolveSimulationCodeModelId("kimi:kimi-k2.6")).toBe("kimi:kimi-k2.6");
    expect(resolveSimulationCodeModelId("zai:glm-5v-turbo")).toBe("zai:glm-5v-turbo");
    expect(resolveSimulationCodeModelId("openai:gpt-5.4-pro")).toBeNull();
    expect(resolveSimulationCodeModelId("__proto__")).toBeNull();
  });
});
