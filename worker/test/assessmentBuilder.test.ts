import { describe, expect, it, vi } from "vitest";
import { defaultAiSettings, publicAiSettings, validateAiModelSettings } from "../src/lib/aiSettings";
import { assessmentBuilderModel, parseAssessmentBuilderRequest, runAssessmentBuilder } from "../src/lib/assessmentBuilder";
import { openaiClient } from "../src/lib/openai";
import { generateTeacherAssessmentDraft } from "../src/routes/teacherAssessmentBuilder";
import type { Env } from "../src/lib/env";
import type { AssessmentBuilderAiRequest } from "@alt-assessment/shared";

const env = { OPENAI_API_KEY: "synthetic-current-credential" } as Env;
const draft = { title: "Pressure and volume", prompt: "Explain the pressure-volume relationship for a fixed amount of gas at constant temperature.", expectedAnswer: "Pressure is inversely proportional to volume.",
  rubric: [{ name: "Causal explanation", description: "Full credit: connects collisions and volume. Partial credit: identifies the trend without a mechanism. No credit: reverses the relationship.", maxPoints: 10 }] };
const input: AssessmentBuilderAiRequest = { action: "assessment", type: "simulation", request: "Make a 15-minute Honors Chemistry assessment with a 10-point rubric.", assessment: { title: "", prompt: "", expectedAnswer: "", rubric: [] } };

describe("assessment builder AI", () => {
  it("upgrades old teacher settings without changing student settings or stored credentials", () => {
    const saved = defaultAiSettings(env);
    delete (saved.roleModels as Partial<typeof saved.roleModels>).assessmentBuilder;
    saved.apiKeys.openai = "sealed-synthetic-secret";
    const before = structuredClone(saved);
    const result = publicAiSettings({ settings: saved, updatedAt: "unchanged" }, env);
    expect(result.roleModels.assessmentBuilder).toMatchObject({ id: saved.roleModels.grading.id, reasoningEffort: "medium", fastMode: false, maxOutputTokens: 16000 });
    expect(result.codeModels).toEqual(before.codeModels);
    expect(saved).toEqual(before);
    expect(JSON.stringify(result)).not.toContain("sealed-synthetic-secret");
    const { assessmentBuilder: _, ...oldRoles } = result.roleModels;
    expect(validateAiModelSettings({ ...result, roleModels: oldRoles }, saved).roleModels.assessmentBuilder.id).toBe(result.roleModels.assessmentBuilder.id);
  });

  it("uses the independently assigned builder model, reasoning, token limit, and Fast opt-in", async () => {
    const saved = defaultAiSettings(env);
    saved.roleModels.assessmentBuilder = { id: "gpt-5.6-terra", catalogModelId: "openai:gpt-5.6-terra", reasoningEffort: "high", maxOutputTokens: 24000, fastMode: true };
    const settings = validateAiModelSettings(saved as unknown as Record<string, unknown>, saved);
    const client = openaiClient("synthetic");
    const call = vi.spyOn(client.responses, "create").mockResolvedValue({ status: "completed", output_text: JSON.stringify(draft) } as never);
    const result = await runAssessmentBuilder(client, settings, input);
    expect(call.mock.calls[0][0]).toMatchObject({ model: "gpt-5.6-terra", reasoning: { effort: "high" }, max_output_tokens: 24000, service_tier: "fast", store: false,
      text: { format: { type: "json_schema", strict: true } } });
    expect(result.draft).toEqual(draft);
    expect(result.model).toMatchObject({ id: "gpt-5.6-terra", reasoningEffort: "high", maxOutputTokens: 24000, fastMode: true });
    expect(settings.codeModels[0].fastMode).toBe(false);
  });

  it("supports provider-listed Kimi builder models and rejects OpenAI-only reasoning or Fast mode", async () => {
    const saved = defaultAiSettings({ ...env, MOONSHOT_API_KEY: "synthetic" });
    saved.roleModels.assessmentBuilder = { id: "kimi-k2.6", catalogModelId: "kimi:kimi-k2.6", reasoningEffort: "none", maxOutputTokens: 18000, fastMode: false };
    const settings = validateAiModelSettings(saved as unknown as Record<string, unknown>, saved);
    expect(assessmentBuilderModel(settings)).toMatchObject({ provider: "kimi", baseURL: "https://api.moonshot.ai/v1" });
    const client = openaiClient("synthetic");
    const call = vi.spyOn(client.chat.completions, "create").mockResolvedValue({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(draft) } }] } as never);
    await runAssessmentBuilder(client, settings, input);
    expect(call.mock.calls[0][0]).toMatchObject({ model: "kimi-k2.6", max_tokens: 18000, response_format: { type: "json_object" } });
    settings.roleModels.assessmentBuilder.fastMode = true;
    expect(() => validateAiModelSettings(settings as unknown as Record<string, unknown>, settings)).toThrow("Non-OpenAI builder");
  });

  it("rejects empty generation requests, missing assessment prompts, and missing review rubrics", () => {
    expect(() => parseAssessmentBuilderRequest({ ...input, request: " " })).toThrow("AI request");
    expect(() => parseAssessmentBuilderRequest({ ...input, action: "rubric", request: "" })).toThrow("Assessment prompt");
    expect(() => parseAssessmentBuilderRequest({ ...input, action: "reviewRubric", request: "", assessment: { ...draft, rubric: [] } })).toThrow("valid rubric");
    expect(() => parseAssessmentBuilderRequest({ ...input, request: "x".repeat(16001) })).toThrow("AI request");
    expect(() => parseAssessmentBuilderRequest({ ...input, type: "external_quiz" })).toThrow("supported assessment type");
  });

  it("returns rubric review as feedback and a proposal without a draft or database writes", async () => {
    const client = openaiClient("synthetic");
    const reviewed = [{ ...draft.rubric[0], description: "Full: correct causal mechanism and constant temperature. Partial: correct trend only. None: incorrect trend." }];
    const call = vi.spyOn(client.responses, "create").mockResolvedValue({ status: "completed", output_text: JSON.stringify({ rubric: reviewed, feedback: ["Clarified constant-temperature and partial-credit expectations."] }) } as never);
    const result = await runAssessmentBuilder(client, defaultAiSettings(env), { ...input, action: "reviewRubric", request: "", assessment: draft });
    expect(result).toMatchObject({ action: "reviewRubric", draft: null, rubric: reviewed, feedback: [expect.any(String)] });
    expect(call.mock.calls[0][0]).toMatchObject({ service_tier: "default" });
    expect(JSON.stringify(call.mock.calls[0][0].input)).toContain(draft.prompt);
    expect(draft.rubric[0].description).not.toBe(reviewed[0].description);
  });

  it.each([
    { status: "incomplete", output_text: "" },
    { status: "completed", output_text: "not JSON" },
    { status: "completed", output_text: JSON.stringify({ ...draft, rubric: [{ ...draft.rubric[0], maxPoints: -1 }] }) },
    { status: "completed", output_text: JSON.stringify({ ...draft, rubric: [draft.rubric[0], draft.rubric[0]] }) }
  ])("rejects incomplete or invalid provider output before any draft can be applied", async response => {
    const client = openaiClient("synthetic");
    vi.spyOn(client.responses, "create").mockResolvedValue(response as never);
    await expect(runAssessmentBuilder(client, defaultAiSettings(env), input)).rejects.toMatchObject({ status: 502 });
  });

  it("does not expose provider error bodies or credentials", async () => {
    const client = openaiClient("synthetic");
    vi.spyOn(client.responses, "create").mockRejectedValue({ status: 403, message: "private provider response and synthetic-secret" });
    await expect(runAssessmentBuilder(client, defaultAiSettings(env), input)).rejects.toMatchObject({ status: 502, message: expect.not.stringContaining("synthetic-secret") });
  });

  it("rejects a student before reading settings or contacting a model", async () => {
    const query: any = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: { id: "student", role: "student" }, error: null }) };
    const db = { from: () => query, rpc: vi.fn() };
    await expect(generateTeacherAssessmentDraft(new Request("https://test", { method: "POST", body: JSON.stringify(input) }), db as never, env, "student")).rejects.toMatchObject({ status: 403 });
    expect(db.rpc).not.toHaveBeenCalled();
  });
});
