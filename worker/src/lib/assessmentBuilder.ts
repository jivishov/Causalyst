import { BUILT_IN_PROMPTS } from "./promptDefaults";
import { renderPromptSystem, renderPromptUser } from "./aiPrompts";
import type { AiPromptBundle } from "@alt-assessment/shared";
import type { AssessmentBuilderAiRequest, AssessmentBuilderAiResponse, AssessmentBuilderDraft, AiProvider, RubricCriterion } from "@alt-assessment/shared";
import { teacherProviderModels } from "@alt-assessment/shared";
import type OpenAI from "openai";
import type { StoredAiSettings } from "./aiSettings";
import { withAssessmentBuilderModel } from "./aiSettings";
import { HttpError } from "./http";
import { getModel, simulationCodeModelCatalog } from "./models";

const criterionSchema = { type: "object", additionalProperties: false, required: ["name", "description", "maxPoints"], properties: {
  name: { type: "string" }, description: { type: "string" }, maxPoints: { type: "integer" }
} };
const rubricSchema = { type: "array", items: criterionSchema };
const feedbackSchema = { type: "array", items: { type: "string" } };
const draftSchema = { type: "object", additionalProperties: false, required: ["title", "prompt", "expectedAnswer", "rubric"], properties: {
  title: { type: "string" }, prompt: { type: "string" }, expectedAnswer: { type: "string" }, rubric: rubricSchema
} };
const rubricResponseSchema = { type: "object", additionalProperties: false, required: ["rubric", "feedback"], properties: { rubric: rubricSchema, feedback: feedbackSchema } };

export function assessmentBuilderModel(source: StoredAiSettings) {
  const settings = withAssessmentBuilderModel(source);
  const role = settings.roleModels.assessmentBuilder;
  const selected = teacherProviderModels(settings).find(entry => role.catalogModelId ? entry.id === role.catalogModelId : entry.provider === "openai" && entry.modelId === role.id);
  if (!selected || selected.capability !== "text" || selected.modelId !== role.id) throw new HttpError(400, "Choose a compatible Assessment Builder model in AI settings.");
  const provider = selected.provider;
  const baseURL = provider === "openai" ? undefined : Object.values(simulationCodeModelCatalog).find(entry => entry.provider === provider)?.baseURL;
  return { provider, baseURL, model: getModel("assessmentBuilder", settings) };
}

export function parseAssessmentBuilderRequest(value: unknown): AssessmentBuilderAiRequest {
  const body = object(value, 400);
  if (!["assessment", "rubric", "reviewRubric"].includes(String(body.action))) throw new HttpError(400, "Select an assessment builder action.");
  if (!["simulation", "voice", "voice_realtime", "writing"].includes(String(body.type))) throw new HttpError(400, "Select a supported assessment type.");
  const request = text(body.request, 16000, body.action === "assessment", 400, "AI request");
  const existing = object(body.assessment, 400);
  const assessment = {
    title: text(existing.title, 200, false, 400, "Title"),
    prompt: text(existing.prompt, 30000, body.action !== "assessment", 400, "Assessment prompt"),
    expectedAnswer: text(existing.expectedAnswer, 20000, false, 400, "Expected answer"),
    rubric: parseBuilderRubric(existing.rubric, 400, body.action === "reviewRubric")
  };
  return { action: body.action as AssessmentBuilderAiRequest["action"], type: body.type as AssessmentBuilderAiRequest["type"], request, assessment };
}

export function parseBuilderRubric(value: unknown, status = 502, required = true): RubricCriterion[] {
  if (!Array.isArray(value) || value.length > 40 || (required && value.length === 0)) throw new HttpError(status, status === 400 ? "Add a valid rubric before requesting a review." : "AI returned an invalid rubric. Your draft was kept.");
  const names = new Set<string>();
  return value.map(item => {
    const row = object(item, status);
    const name = text(row.name, 200, true, status, "Criterion name");
    const description = text(row.description, 6000, true, status, "Criterion description");
    if (!Number.isInteger(row.maxPoints) || Number(row.maxPoints) < 1 || Number(row.maxPoints) > 1000 || names.has(name.toLowerCase())) throw new HttpError(status, "Rubric criteria need unique names and whole-number points from 1 to 1000.");
    names.add(name.toLowerCase());
    return { name, description, maxPoints: Number(row.maxPoints) };
  });
}

function object(value: unknown, status: number): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new HttpError(status, "Invalid assessment builder data. Your draft was kept.");
  return value as Record<string, unknown>;
}
function text(value: unknown, limit: number, required: boolean, status: number, field: string): string {
  if (typeof value !== "string" || value.length > limit || (required && !value.trim())) throw new HttpError(status, `${field} must contain ${required ? "1" : "0"}-${limit} characters.`);
  return value.trim();
}

export const builderInstructions = BUILT_IN_PROMPTS.assessmentBuilder!.system;

export async function runAssessmentBuilder(client: OpenAI, settings: StoredAiSettings, input: AssessmentBuilderAiRequest, prompts?: AiPromptBundle): Promise<AssessmentBuilderAiResponse> {
  const selected = assessmentBuilderModel(settings);
  const { model, provider } = selected;
  const schema = input.action === "assessment" ? draftSchema : rubricResponseSchema;
  const context = JSON.stringify({ action: input.action, assessmentType: input.type, teacherRequest: input.request, currentAssessment: input.assessment });
  let output: string;
  try {
    if (provider === "openai") {
      const response = await client.responses.create({
        model: model.id, store: false, service_tier: model.fastMode === true ? "fast" : "default",
        reasoning: model.reasoningEffort ? { effort: model.reasoningEffort } : undefined,
        max_output_tokens: model.maxOutputTokens ?? 16000,
        text: { format: { type: "json_schema", name: input.action === "assessment" ? "assessment_draft" : "rubric_proposal", strict: true, schema } },
        input: [{ role: "developer", content: renderPromptSystem(prompts, "assessmentBuilder") }, { role: "user", content: renderPromptUser(prompts, "assessmentBuilder", JSON.parse(context)) }]
      }, { timeout: 240000, maxRetries: 0 });
      if (response.status === "incomplete") throw new HttpError(502, "The model reached its output or reasoning limit. Increase the Assessment Builder token limit in AI settings, or reduce reasoning effort. Your draft was kept.");
      if (response.status !== "completed" || !response.output_text?.trim()) throw new HttpError(502, "The model did not return a complete assessment draft. Your draft was kept.");
      output = response.output_text;
    } else {
      const response = await client.chat.completions.create({
        model: model.id, max_tokens: model.maxOutputTokens ?? 16000, response_format: { type: "json_object" },
        messages: [{ role: "system", content: renderPromptSystem(prompts, "assessmentBuilder") + "\nRequired JSON schema: " + JSON.stringify(schema) }, { role: "user", content: renderPromptUser(prompts, "assessmentBuilder", JSON.parse(context)) }]
      }, { timeout: 240000, maxRetries: 0 });
      const choice = response.choices[0];
      if (choice?.finish_reason !== "stop" || !choice.message.content?.trim()) throw new HttpError(502, "The model did not return a complete assessment draft. Check the builder token limit. Your draft was kept.");
      output = choice.message.content;
    }
  } catch (error) {
    if (error instanceof HttpError) throw error;
    const status = error && typeof error === "object" && "status" in error ? Number(error.status) : null;
    if (status === 429) throw new HttpError(429, "The AI provider is busy or its quota has been reached. Try again shortly. Your draft was kept.");
    if (status === 401 || status === 403 || status === 404) throw new HttpError(502, "The Assessment Builder model or provider key is unavailable. Check the assigned model and key in AI settings. Your draft was kept.");
    if (status === 400) throw new HttpError(502, "The provider rejected the builder model settings. Check model capabilities, reasoning effort, token limit, and Fast mode in AI settings. Your draft was kept.");
    throw new HttpError(502, "AI generation could not finish. Your draft and request were kept; try again.");
  }
  let parsed: Record<string, unknown>;
  try { parsed = object(JSON.parse(output), 502); }
  catch { throw new HttpError(502, "AI returned an unreadable draft. Your existing work was kept; try again."); }
  const rubric = parseBuilderRubric(parsed.rubric);
  let draft: AssessmentBuilderDraft | null = null;
  let feedback: string[] = [];
  if (input.action === "assessment") {
    draft = { title: text(parsed.title, 200, true, 502, "Generated title"), prompt: text(parsed.prompt, 30000, true, 502, "Generated prompt"),
      expectedAnswer: text(parsed.expectedAnswer, 20000, false, 502, "Generated expected answer"), rubric };
  } else {
    if (!Array.isArray(parsed.feedback) || parsed.feedback.length > 12) throw new HttpError(502, "AI returned invalid rubric feedback. Your rubric was kept.");
    feedback = parsed.feedback.map(item => text(item, 2000, true, 502, "Rubric feedback"));
    if (input.action === "reviewRubric" && feedback.length === 0) throw new HttpError(502, "AI returned no review feedback. Your rubric was kept.");
    if (input.action === "reviewRubric" && !input.request.trim() && rubric.reduce((sum, row) => sum + row.maxPoints, 0) !== input.assessment.rubric.reduce((sum, row) => sum + row.maxPoints, 0)) {
      throw new HttpError(502, "The proposed revision changed the rubric total without instructions. Your rubric was kept; ask AI to preserve the total.");
    }
  }
  return { action: input.action, draft, rubric, feedback, model: { provider: provider as AiProvider, id: model.id,
    reasoningEffort: model.reasoningEffort ?? "none", maxOutputTokens: model.maxOutputTokens ?? 16000, fastMode: provider === "openai" && model.fastMode === true } };
}
