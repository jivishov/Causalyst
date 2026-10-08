import { describe, expect, it, vi } from "vitest";
import { promptStagesForType, type AiPromptBundle } from "@alt-assessment/shared";
import { parsePromptOverrides, renderPromptSystem, renderPromptUser, resolvePromptContext } from "../src/lib/aiPrompts";
import { buildSimulationHtmlResponsePayload, buildRefineSimulationHtmlResponsePayload, generateSimulationHtmlChatCompletion, generateSimulationSketch, openaiClient, transcribeAudio, transcriptionPrompt } from "../src/lib/openai";
import { getSimulationCodeModel } from "../src/lib/models";
import { buildRealtimeInstructions } from "../src/routes/voiceRealtime";
import { resolveAttemptAiEnv, defaultRuntimeAiSettings } from "../src/lib/aiSettings";
import type { Env } from "../src/lib/env";

describe("teacher prompts in actual AI requests", () => {
  it("resolves each field independently and isolates assignments", () => {
    const base = { type: "simulation" as const, defaults: { simulationHtml: { system: "Teacher default", user: "Default user {{context}}" } }, assessment: { simulationHtml: { user: "Assessment user {{context}}" } } };
    const first = resolvePromptContext({ ...base, assignment: { simulationHtml: { system: "Class A" } } });
    const second = resolvePromptContext({ ...base, assignment: { simulationHtml: { system: "Class B" } } });
    expect(first.prompts.simulationHtml).toEqual({ system: "Class A", user: "Assessment user {{context}}" });
    expect(second.prompts.simulationHtml?.system).toBe("Class B");
    expect(first.inherited.simulationHtml?.system).toBe("Teacher default");
    expect(resolvePromptContext(base).prompts.simulationHtml?.system).toBe("Teacher default");
  });
  it("uses current prompts on the next action while preserving captured model settings", async () => {
    const env = { OPENAI_API_KEY: "synthetic", PIN_PEPPER: "synthetic-test-pepper" } as Env;
    const settings = defaultRuntimeAiSettings(env);
    let system = "First prompt";
    const db = { rpc: vi.fn(async () => ({ error: null, data: { teacherId: "teacher", runtime: settings, settings,
      promptContext: { type: "simulation", assignment: { simulationHtml: { system } } } } })) };
    const first = await resolveAttemptAiEnv(db as never, env, "attempt");
    system = "Updated prompt";
    const next = await resolveAttemptAiEnv(db as never, env, "attempt");
    expect(first.AI_PROMPTS?.simulationHtml?.system).toBe("First prompt");
    expect(next.AI_PROMPTS?.simulationHtml?.system).toBe("Updated prompt");
    expect(next.AI_SETTINGS).toEqual(first.AI_SETTINGS);
    expect(db.rpc).toHaveBeenCalledTimes(2); // Prompts share the existing settings read.
  });
  it("renders student evidence once, with safe JSON quoting", () => {
    const studentDescription = 'The object says "{{expectedAnswer}}" and then \\ moves.';
    const result = renderPromptUser(undefined, "simulationSketch", { studentDescription });
    expect(JSON.parse(result)).toEqual({ studentDescription });
    expect(result).toContain("{{expectedAnswer}}");
  });
  it("retains required grading evidence even when a teacher removes all variables", () => {
    const result = renderPromptUser({ voiceGrade: { system: "Custom assessor", user: "Give detailed feedback." } }, "voiceGrade", {
      assessmentPrompt: "Explain the process", expectedAnswer: "Teacher key", rubric: [{ id: "r1" }], scoringPolicy: {}, transcript: "Original evidence" });
    expect(result).toContain("Give detailed feedback.");
    expect(result).toContain("Original evidence"); expect(result).toContain("Teacher key"); expect(result).toContain('"r1"');
  });
  it("rejects unknown stages, invalid placeholders, and evidence variables in system prompts", () => {
    expect(() => parsePromptOverrides({ simulationHtml: { system: "Hello" } }, "voice")).toThrow(/not available/);
    expect(() => parsePromptOverrides({ voiceGrade: { user: "{{wrongVariable}}" } }, "voice")).toThrow(/Unknown variable/);
    expect(() => parsePromptOverrides({ voiceGrade: { system: "{{transcript}}" } }, "voice")).toThrow(/user prompt/);
    expect(() => parsePromptOverrides({ voiceGrade: { user: "" } }, "voice")).toThrow(/Reset/);
  });
  it("puts custom prompts into both Responses HTML operations without dropping attachments", () => {
    const prompts: AiPromptBundle = { simulationHtml: { system: "Generate in Spanish", user: "Spanish labels. {{context}}" }, simulationRefine: { system: "Refine in Spanish", user: "Use larger labels. {{context}}" } };
    const first = buildSimulationHtmlResponsePayload({ prompts, description: "Gas compresses", sketchFileId: "synthetic-file" });
    const refine = buildRefineSimulationHtmlResponsePayload({ prompts, description: "Gas compresses", sketchFileId: "synthetic-file", currentHtml: "<html>original</html>" });
    const request = first.payload.input as any[];
    expect(request[0].content).toContain("Generate in Spanish");
    expect(request[1].content).toContainEqual({ type: "input_image", file_id: "synthetic-file", detail: "auto" });
    expect(request[1].content[1].text).toContain("Spanish labels.");
    expect((refine.payload.input as any[])[0].content).toContain("Refine in Spanish");
    expect((refine.payload.input as any[])[1].content[1].text).toContain("original");
    expect(request[0].content).toContain("App requirements:");
  });
  it("uses the same custom prompts for a non-OpenAI HTML provider", async () => {
    const client = openaiClient("synthetic", undefined, undefined, { simulationHtml: { system: "Custom provider instructions", user: "Custom user {{context}}" } });
    const create = vi.spyOn(client.chat.completions, "create").mockResolvedValue({ id: "synthetic", model: "moonshot", choices: [{ message: { content: "<html></html>" } }] } as never);
    await generateSimulationHtmlChatCompletion(client, getSimulationCodeModel("kimi:kimi-k2.5"), { description: "A particle moves", sketchDataUrl: "data:image/png;base64,YQ==" });
    const messages = (create.mock.calls[0][0] as any).messages;
    expect(messages[0].content).toContain("Custom provider instructions");
    expect(messages[1].content[1].text).toContain("Custom user");
    expect(messages[1].content[0].image_url.url).toContain("data:image/png");
  });
  it("combines sketch instructions for the image API", async () => {
    const client = openaiClient("synthetic", undefined, undefined, { simulationSketch: { system: "Custom diagram style", user: "Custom sketch {{studentDescription}}" } });
    const create = vi.spyOn(client.images, "generate").mockResolvedValue({ data: [{ b64_json: "YQ==" }] } as never);
    await generateSimulationSketch(client, { description: "A named sphere moves" });
    expect(create.mock.calls[0][0].prompt).toContain("Custom diagram style"); expect(create.mock.calls[0][0].prompt).toContain("Custom sketch");
    expect(create.mock.calls[0][0].prompt).toContain("A named sphere moves");
  });
  it("keeps answer keys out of realtime instructions while customizing conversation and transcription", async () => {
    const prompts = resolvePromptContext({ type: "voice_realtime", defaults: { realtimeVoice: { system: "Ask one question at a time", user: "Speak Spanish. {{context}}" }, transcription: { user: "Preserve Spanish terms." } } }).prompts;
    const instructions = buildRealtimeInstructions({ prompt: "Explain energy", expectedAnswer: "SECRET ANSWER", rubric: [], prompts });
    expect(instructions).toContain("Ask one question at a time"); expect(instructions).toContain("Speak Spanish"); expect(instructions).not.toContain("SECRET ANSWER");
    expect(transcriptionPrompt(undefined)).toBeUndefined(); expect(transcriptionPrompt(prompts)).toContain("Preserve Spanish terms.");
    const client = openaiClient("synthetic", undefined, undefined, prompts);
    const create = vi.spyOn(client.audio.transcriptions, "create").mockResolvedValue({ text: "Energy" } as never);
    await transcribeAudio(client, new File(["audio"], "answer.wav"));
    expect(create.mock.calls[0][0].prompt).toContain("Preserve Spanish terms.");
  });
  it("has editable user and system templates for every active assessment step", () => {
    for (const type of ["voice", "voice_realtime", "writing", "simulation"] as const) {
      const config = resolvePromptContext({ type }, "defaults");
      for (const stage of promptStagesForType(type)) {
        expect(config.prompts[stage.id]?.system.trim()).toBeTruthy();
        expect(config.prompts[stage.id]?.user.trim()).toBeTruthy();
        expect(renderPromptSystem(undefined, stage.id)).toContain("App requirements:");
      }
    }
  });
});
