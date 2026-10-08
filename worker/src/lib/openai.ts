import { parseScoringPolicy, rubricWithIds, validateGradeFeedback } from "./gradingPolicy";
import OpenAI from "openai";
import type { AiPromptBundle, GradeFeedback, RubricCriterion, SimulationHtmlReasoningEffort, SimulationReadinessSignals, SimulationSpec } from "@alt-assessment/shared";
import { DEFAULT_SIMULATION_HTML_REASONING_EFFORT, normalizeFeedback } from "@alt-assessment/shared";
import { getModel, modelNeedsConfirmation, type ModelCatalogEntry, type ModelRole, type SimulationCodeModelEntry } from "./models";
import { fidelityReviewSchema, gradeFeedbackSchema, simulationGenerationSchema, simulationReadinessClassifierSchema, writingGradeSchema } from "./schemas";
import { HttpError } from "./http";
import type { StoredAiSettings } from "./aiSettings";
import { renderPromptSystem, renderPromptUser } from "./aiPrompts";
import { BUILT_IN_PROMPTS } from "./promptDefaults";

const OPENAI_BACKGROUND_START_TIMEOUT_MS = 60000;
const OPENAI_BACKGROUND_STATUS_TIMEOUT_MS = 20000;

type ResponsePayload = OpenAI.Responses.ResponseCreateParamsNonStreaming;

const clientSettings = new WeakMap<OpenAI, StoredAiSettings>();
const clientPrompts = new WeakMap<OpenAI, AiPromptBundle>();

export function openaiClient(apiKey: string, baseURL?: string, settings?: StoredAiSettings, prompts?: AiPromptBundle): OpenAI {
  if (!apiKey?.trim()) throw new HttpError(503, "No provider key is configured. Ask your teacher to update AI settings.");
  const client = new OpenAI({ apiKey, baseURL, maxRetries: 0, timeout: 90_000 });
  if (settings) clientSettings.set(client, settings);
  if (prompts) clientPrompts.set(client, prompts);
  return client;
}

function clientModel(client: OpenAI, role: ModelRole): ModelCatalogEntry { return getModel(role, clientSettings.get(client)); }

export function enforceModelConfirmation(roles: ModelRole[], confirmed: boolean | undefined): void {
  if (roles.some(modelNeedsConfirmation) && confirmed !== true) {
    throw new HttpError(409, "This model requires explicit confirmation before execution", { requiresConfirmation: true });
  }
}

interface TranscriptionPromptContext { assessmentPrompt: string }

export async function transcribeAudio(client: OpenAI, file: File, context?: TranscriptionPromptContext): Promise<string> {
  const model = clientModel(client, "transcription");
  const result = await client.audio.transcriptions.create({
    file,
    prompt: transcriptionPrompt(clientPrompts.get(client), context),
    model: model.id
  });
  return result.text;
}

export async function gradeVoice(client: OpenAI, input: {
  prompt: string;
  expectedAnswer: string | null;
  rubric: RubricCriterion[];
  scoringPolicy?: unknown;
  transcript: string;
}): Promise<GradeFeedback> {
  const model = clientModel(client, "grading");
  const response = await client.responses.create({
    model: model.id,
    reasoning: model.reasoningEffort ? { effort: model.reasoningEffort } : undefined,
    max_output_tokens: model.maxOutputTokens ?? 8192,
    text: structuredTextFormat("voice_grade", gradeFeedbackSchema, model.verbosity),
    input: [
      {
        role: "system",
        content: renderPromptSystem(clientPrompts.get(client), "voiceGrade")
      },
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: renderPromptUser(clientPrompts.get(client), "voiceGrade", {
              assessmentPrompt: input.prompt,
              expectedAnswer: input.expectedAnswer,
              rubric: rubricWithIds(input.rubric),
              scoringPolicy: parseScoringPolicy(input.scoringPolicy),
              transcript: input.transcript,
              gradingPolicy: "Score only what the transcript supports. Mark feedback as provisional."
            })
          }
        ]
      }
    ]
  });
  return validateGradeFeedback(parseOutput<GradeFeedback>(response), input.rubric, input.scoringPolicy);
}

export async function gradeWriting(client: OpenAI, input: {
  fileId: string;
  prompt: string;
  expectedAnswer: string | null;
  rubric: RubricCriterion[];
  scoringPolicy?: unknown;
}): Promise<{ transcribedText: string; feedback: GradeFeedback }> {
  const model = clientModel(client, "visionGrading");
  const response = await client.responses.create({
    model: model.id,
    reasoning: model.reasoningEffort ? { effort: model.reasoningEffort } : undefined,
    max_output_tokens: model.maxOutputTokens ?? 8192,
    text: structuredTextFormat("writing_grade", writingGradeSchema, model.verbosity),
    input: [
      {
        role: "system",
        content: renderPromptSystem(clientPrompts.get(client), "writingGrade")
      },
      {
        role: "user",
        content: [
          { type: "input_file", file_id: input.fileId },
          {
            type: "input_text",
            text: renderPromptUser(clientPrompts.get(client), "writingGrade", {
              assessmentPrompt: input.prompt,
              expectedAnswer: input.expectedAnswer,
              rubric: rubricWithIds(input.rubric),
              scoringPolicy: parseScoringPolicy(input.scoringPolicy),
              gradingPolicy: "Return OCR/transcription and provisional rubric feedback. Use the expected answer as the teacher answer key when provided, including acceptable alternatives and score caps. Flag unclear handwriting or missing pages."
            })
          }
        ]
      }
    ]
  });
  const parsed = parseOutput<{ transcribedText: string; feedback: GradeFeedback }>(response);
  return { ...parsed, feedback: validateGradeFeedback(parsed.feedback, input.rubric, input.scoringPolicy) };
}

export async function generateSimulationSpec(client: OpenAI, input: {
  prompt: string;
  description: string;
  retryFeedback?: string[];
}): Promise<{ spec: SimulationSpec; modelUsed: string; rawResponseText: string }> {
  const model = clientModel(client, "simulationSpec");
  const response = await createSimulationResponseWithFallback(client, model, {
    model: model.id,
    reasoning: model.reasoningEffort ? { effort: model.reasoningEffort } : undefined,
    text: structuredTextFormat("simulation_spec", simulationGenerationSchema, model.verbosity),
    max_output_tokens: model.maxOutputTokens,
    input: [
      {
        role: "system",
        content: renderPromptSystem(clientPrompts.get(client), "simulationSpec")
      },
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: renderPromptUser(clientPrompts.get(client), "simulationSpec", {
              assessmentPrompt: input.prompt,
              studentDescription: input.description,
              retryFeedback: input.retryFeedback ?? [],
              coordinatePolicy: "Use x/y positions from 0 to 100. If position is unspecified, use neutral visible positions but source them to the entity quote."
            })
          }
        ]
      }
    ]
  });
  return {
    spec: parseOutput<SimulationSpec>(response.response),
    modelUsed: response.modelUsed,
    rawResponseText: extractResponseText(response.response)
  };
}

export async function generateSimulationHtml(client: OpenAI, input: {
  prompts?: AiPromptBundle;
  description: string;
  sketchFileId?: string;
  htmlReasoningEffort?: SimulationHtmlReasoningEffort;
  model?: ModelCatalogEntry;
}): Promise<{ html: string; modelUsed: string; requestedModel: string }> {
  const { model, payload } = buildSimulationHtmlResponsePayload({ ...input, prompts: input.prompts ?? clientPrompts.get(client) });
  const response = await createSimulationResponseWithFallback(client, model, payload);

  return {
    html: requireOutputText(response.response, "Model response did not include HTML output"),
    modelUsed: response.modelUsed,
    requestedModel: model.id
  };
}

export function buildSimulationHtmlResponsePayload(input: {
  prompts?: AiPromptBundle;
  description: string;
  sketchFileId?: string;
  htmlReasoningEffort?: SimulationHtmlReasoningEffort;
  model?: ModelCatalogEntry;
}): { model: ModelCatalogEntry; payload: ResponsePayload } {
  const model = input.model ?? getModel("simulationHtml");
  const reasoningEffort = input.model ? model.reasoningEffort : model.reasoningEffort ?? DEFAULT_SIMULATION_HTML_REASONING_EFFORT;
  const userContent: OpenAI.Responses.ResponseInputContent[] = [];
  if (input.sketchFileId) {
    userContent.push({
      type: "input_image",
      file_id: input.sketchFileId,
      detail: "auto"
    });
  }
  userContent.push({
    type: "input_text",
    text: renderPromptUser(input.prompts, "simulationHtml", {
      studentDescription: input.description,
      sketchPolicy: input.sketchFileId
        ? "The attached sketch is a visual draft generated from the same student description. Use it for layout, relative placement, and visible omissions only. The student's text remains the source of truth for all domain facts."
        : "No sketch image was provided. Use only the student's text.",
      sourcePolicy: "The assessment prompt and rubric are intentionally omitted. Do not infer assignment goals, formulas, labels, states, mechanisms, or explanations beyond studentDescription."
    })
  });
  return {
    model,
    payload: {
      model: model.id,
      // Explicit Standard avoids inheriting a project-level Fast default.
      service_tier: model.fastMode === true ? "fast" : "default",
      reasoning: reasoningEffort ? { effort: reasoningEffort } : undefined,
      text: model.verbosity ? { verbosity: model.verbosity } : undefined,
      max_output_tokens: model.maxOutputTokens,
      input: [
        {
          role: "system",
          content: renderPromptSystem(input.prompts, "simulationHtml")
        },
        {
          role: "user",
          content: userContent
        }
      ]
    }
  };
}

export async function refineSimulationHtml(client: OpenAI, input: {
  prompts?: AiPromptBundle;
  description: string;
  sketchFileId: string;
  currentHtml: string;
  htmlReasoningEffort?: SimulationHtmlReasoningEffort;
  model?: ModelCatalogEntry;
}): Promise<{ html: string; modelUsed: string; requestedModel: string }> {
  const { model, payload } = buildRefineSimulationHtmlResponsePayload({ ...input, prompts: input.prompts ?? clientPrompts.get(client) });
  const response = await createSimulationResponseWithFallback(client, model, payload);

  return {
    html: requireOutputText(response.response, "Model response did not include refined HTML output"),
    modelUsed: response.modelUsed,
    requestedModel: model.id
  };
}

export function buildRefineSimulationHtmlResponsePayload(input: {
  prompts?: AiPromptBundle;
  description: string;
  sketchFileId: string;
  currentHtml: string;
  htmlReasoningEffort?: SimulationHtmlReasoningEffort;
  model?: ModelCatalogEntry;
}): { model: ModelCatalogEntry; payload: ResponsePayload } {
  const model = input.model ?? getModel("simulationHtml");
  const reasoningEffort = input.model ? model.reasoningEffort : model.reasoningEffort ?? DEFAULT_SIMULATION_HTML_REASONING_EFFORT;
  return {
    model,
    payload: {
      model: model.id,
      // Explicit Standard avoids inheriting a project-level Fast default.
      service_tier: model.fastMode === true ? "fast" : "default",
      reasoning: reasoningEffort ? { effort: reasoningEffort } : undefined,
      text: model.verbosity ? { verbosity: model.verbosity } : undefined,
      max_output_tokens: model.maxOutputTokens,
      input: [
        {
          role: "system",
          content: renderPromptSystem(input.prompts, "simulationRefine")
        },
        {
          role: "user",
          content: [
            {
              type: "input_image",
              file_id: input.sketchFileId,
              detail: "auto"
            },
            {
              type: "input_text",
              text: renderPromptUser(input.prompts, "simulationRefine", {
                studentDescription: input.description,
                currentHtml: input.currentHtml,
                sketchPolicy: "Use the attached sketch as visual/layout guidance only. The student's description remains the source of truth for all domain facts.",
                repairPolicy: "Repair interface fidelity, proportions, spacing, clipping, overlap, and no-scroll viewport fit without adding or changing domain facts."
              })
            }
          ]
        }
      ]
    }
  };
}

export async function generateSimulationHtmlChatCompletion(client: OpenAI, model: SimulationCodeModelEntry, input: {
  description: string;
  sketchDataUrl: string;
}): Promise<{ html: string; modelUsed: string; requestedModel: string; providerResponseId?: string }> {
  const response = await client.chat.completions.create({
    model: model.providerModelId,
    max_tokens: model.maxOutputTokens,
    messages: [
      {
        role: "system",
        content: renderPromptSystem(clientPrompts.get(client), "simulationHtml")
      },
      {
        role: "user",
        content: [
          {
            type: "image_url",
            image_url: { url: input.sketchDataUrl }
          },
          {
            type: "text",
            text: renderPromptUser(clientPrompts.get(client), "simulationHtml", {
              studentDescription: input.description,
              sketchPolicy: "The attached sketch image is a visual draft generated from the same student description. Use it for layout, relative placement, and visible omissions only. The student's text remains the source of truth for all domain facts.",
              sourcePolicy: "The assessment prompt and rubric are intentionally omitted. Do not infer assignment goals, formulas, labels, states, mechanisms, or explanations beyond studentDescription."
            })
          }
        ]
      }
    ]
  } as any);
  return {
    html: requireChatCompletionText(response, "Model response did not include HTML output"),
    modelUsed: typeof response.model === "string" ? response.model : model.providerModelId,
    requestedModel: model.providerModelId,
    providerResponseId: typeof response.id === "string" ? response.id : undefined
  };
}

export async function refineSimulationHtmlChatCompletion(client: OpenAI, model: SimulationCodeModelEntry, input: {
  description: string;
  sketchDataUrl: string;
  currentHtml: string;
}): Promise<{ html: string; modelUsed: string; requestedModel: string; providerResponseId?: string }> {
  const response = await client.chat.completions.create({
    model: model.providerModelId,
    max_tokens: model.maxOutputTokens,
    messages: [
      {
        role: "system",
        content: renderPromptSystem(clientPrompts.get(client), "simulationRefine")
      },
      {
        role: "user",
        content: [
          {
            type: "image_url",
            image_url: { url: input.sketchDataUrl }
          },
          {
            type: "text",
            text: renderPromptUser(clientPrompts.get(client), "simulationRefine", {
              studentDescription: input.description,
              currentHtml: input.currentHtml,
              sketchPolicy: "Use the attached sketch image as visual/layout guidance only. The student's description remains the source of truth for all domain facts.",
              repairPolicy: "Repair interface fidelity, proportions, spacing, clipping, overlap, and no-scroll viewport fit without adding or changing domain facts."
            })
          }
        ]
      }
    ]
  } as any);
  return {
    html: requireChatCompletionText(response, "Model response did not include refined HTML output"),
    modelUsed: typeof response.model === "string" ? response.model : model.providerModelId,
    requestedModel: model.providerModelId,
    providerResponseId: typeof response.id === "string" ? response.id : undefined
  };
}

export async function generateSimulationSketch(client: OpenAI, input: {
  description: string;
}): Promise<{ bytes: Uint8Array; mimeType: string; modelUsed: string; requestedModel: string }> {
  const model = clientModel(client, "simulationSketchImage");
  const prompt = `${renderPromptSystem(clientPrompts.get(client), "simulationSketch")}\n\n${renderPromptUser(clientPrompts.get(client), "simulationSketch", { studentDescription: input.description })}`;
  const response = await createImageResponseWithFallback(client, model, {
    model: model.id,
    prompt,
    output_format: "png",
    quality: "medium",
    size: "1536x1024",
    n: 1
  });
  const b64 = response.response?.data?.[0]?.b64_json;
  if (typeof b64 !== "string" || b64.trim().length === 0) {
    throw new HttpError(502, "Image model response did not include image data");
  }

  return {
    bytes: decodeBase64(b64),
    mimeType: "image/png",
    modelUsed: response.modelUsed,
    requestedModel: model.id
  };
}

export interface SimulationReadinessClassifierResult {
  decision: "allow" | "block";
  reasonCode: "unrelated" | "prompt_echo" | "insufficient_detail" | "allow";
  relatedToPrompt: boolean;
  hasDrawableStudentEvidence: boolean;
  isMostlyPromptEcho: boolean;
}

export async function classifySimulationReadiness(client: OpenAI, input: {
  assessmentPrompt: string;
  studentDescription: string;
  deterministicSignals: SimulationReadinessSignals;
}): Promise<{ result: SimulationReadinessClassifierResult; modelUsed: string; requestedModel: string }> {
  const model = clientModel(client, "simulationReadinessClassifier");
  const response = await client.responses.create({
    model: model.id,
    reasoning: model.reasoningEffort ? { effort: model.reasoningEffort } : undefined,
    text: structuredTextFormat("simulation_readiness", simulationReadinessClassifierSchema, model.verbosity),
    max_output_tokens: model.maxOutputTokens,
    input: [
      {
        role: "system",
        content: renderPromptSystem(clientPrompts.get(client), "simulationReadiness")
      },
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: renderPromptUser(clientPrompts.get(client), "simulationReadiness", {
              assessmentPrompt: input.assessmentPrompt,
              studentDescription: input.studentDescription,
              deterministicSignals: input.deterministicSignals
            })
          }
        ]
      }
    ]
  });
  return {
    result: parseOutput<SimulationReadinessClassifierResult>(response),
    modelUsed: model.id,
    requestedModel: model.id
  };
}

export async function reviewSimulationFidelity(client: OpenAI, input: {
  prompt: string;
  description: string;
  spec: SimulationSpec;
  rubric: RubricCriterion[];
  scoringPolicy?: unknown;
}): Promise<{ feedback: GradeFeedback; missingElements: string[]; addedElements: string[]; modelUsed: string }> {
  const model = clientModel(client, "fidelityReview");
  const response = await createSimulationResponseWithFallback(client, model, {
    model: model.id,
    reasoning: model.reasoningEffort ? { effort: model.reasoningEffort } : undefined,
    text: structuredTextFormat("simulation_fidelity", fidelityReviewSchema, model.verbosity),
    max_output_tokens: model.maxOutputTokens,
    input: [
      {
        role: "system",
        content: renderPromptSystem(clientPrompts.get(client), "simulationFidelity")
      },
      {
        role: "user",
        content: [
          {
            type: "input_text",
            text: renderPromptUser(clientPrompts.get(client), "simulationFidelity", {
              assessmentPrompt: input.prompt,
              studentDescription: input.description,
              simulationSpec: input.spec,
              rubric: input.rubric
            })
          }
        ]
      }
    ]
  });
  const parsed = parseOutput<{ feedback: GradeFeedback; missingElements: string[]; addedElements: string[] }>(response.response);
  return { ...parsed, feedback: validateGradeFeedback(parsed.feedback, input.rubric, input.scoringPolicy), modelUsed: response.modelUsed };
}

export async function uploadUserDataFile(client: OpenAI, file: File): Promise<string> {
  const created = await client.files.create({
    file,
    purpose: "user_data",
    expires_after: { anchor: "created_at", seconds: 86400 }
  });
  return created.id;
}

export async function deleteOpenAIFile(client: OpenAI, fileId: string): Promise<void> {
  await client.files.delete(fileId);
}

function structuredTextFormat(name: string, schema: Record<string, unknown>, verbosity?: "low" | "medium" | "high"): OpenAI.Responses.ResponseTextConfig {
  return {
    verbosity,
    format: {
      type: "json_schema",
      name,
      strict: true,
      schema
    }
  };
}

function parseOutput<T>(response: any): T {
  if (response.output_parsed) return response.output_parsed as T;
  const text = response.output_text;
  if (typeof text !== "string") {
    throw new HttpError(502, "Model response did not include structured output");
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new HttpError(502, "Model response was not valid JSON");
  }
}

function extractResponseText(response: any): string {
  if (typeof response.output_text === "string" && response.output_text.trim().length > 0) {
    return response.output_text;
  }
  if (response.output_parsed) {
    return JSON.stringify(response.output_parsed, null, 2);
  }
  return JSON.stringify(response, null, 2);
}

function requireOutputText(response: any, message: string): string {
  if (typeof response.output_text === "string" && response.output_text.trim().length > 0) {
    return response.output_text;
  }
  // Streaming terminal events do not have the SDK's output_text convenience field.
  const text = (response.output ?? []).filter((item: any) => item.type === "message")
    .flatMap((item: any) => item.content ?? []).filter((part: any) => part.type === "output_text")
    .map((part: any) => typeof part.text === "string" ? part.text : "").join("");
  if (text.trim()) return text;
  throw new HttpError(502, message);
}

export async function streamSimulationForegroundResponse(client: OpenAI, input: {
  prompts?: AiPromptBundle; description: string; sketchFileId: string; currentHtml?: string;
  htmlReasoningEffort: SimulationHtmlReasoningEffort; model: ModelCatalogEntry;
}, signal: AbortSignal) {
  const { payload } = input.currentHtml === undefined
    ? buildSimulationHtmlResponsePayload(input)
    : buildRefineSimulationHtmlResponsePayload({ ...input, currentHtml: input.currentHtml });
  // No fallback or SDK retries: a disconnected POST has an ambiguous outcome.
  return client.responses.create({ ...payload, background: false, store: true, stream: true },
    { timeout: 60_000, maxRetries: 0, signal }).withResponse();
}

function requireChatCompletionText(response: any, message: string): string {
  const content = response?.choices?.[0]?.message?.content;
  if (typeof content === "string" && content.trim().length > 0) {
    return content;
  }
  if (Array.isArray(content)) {
    const text = content
      .map((part) => typeof part?.text === "string" ? part.text : "")
      .join("")
      .trim();
    if (text.length > 0) return text;
  }
  throw new HttpError(502, message);
}

export async function startSimulationHtmlBackgroundResponse(client: OpenAI, input: {
  prompts?: AiPromptBundle;
  description: string;
  sketchFileId?: string;
  htmlReasoningEffort?: SimulationHtmlReasoningEffort;
  model?: ModelCatalogEntry;
}): Promise<{ responseId: string; status: string; modelUsed: string; requestedModel: string; serviceTierUsed?: string | null }> {
  const { model, payload } = buildSimulationHtmlResponsePayload({ ...input, prompts: input.prompts ?? clientPrompts.get(client) });
  return startSimulationBackgroundResponse(client, model, payload);
}

export async function startRefineSimulationHtmlBackgroundResponse(client: OpenAI, input: {
  prompts?: AiPromptBundle;
  description: string;
  sketchFileId: string;
  currentHtml: string;
  htmlReasoningEffort?: SimulationHtmlReasoningEffort;
  model?: ModelCatalogEntry;
}): Promise<{ responseId: string; status: string; modelUsed: string; requestedModel: string; serviceTierUsed?: string | null }> {
  const { model, payload } = buildRefineSimulationHtmlResponsePayload({ ...input, prompts: input.prompts ?? clientPrompts.get(client) });
  return startSimulationBackgroundResponse(client, model, payload);
}

export async function retrieveSimulationBackgroundResponse(client: OpenAI, responseId: string): Promise<any> {
  return client.responses.retrieve(responseId, {}, {
    timeout: OPENAI_BACKGROUND_STATUS_TIMEOUT_MS,
    maxRetries: 0
  } as any);
}

export async function streamSimulationBackgroundResponse(client: OpenAI, responseId: string, startingAfter?: number, signal?: AbortSignal) {
  return client.responses.retrieve(responseId, {
    stream: true,
    ...(startingAfter === undefined ? {} : { starting_after: startingAfter })
  }, { timeout: OPENAI_BACKGROUND_STATUS_TIMEOUT_MS, maxRetries: 0, signal });
}

export async function cancelSimulationBackgroundResponse(client: OpenAI, responseId: string): Promise<any> {
  return client.responses.cancel(responseId, {
    timeout: OPENAI_BACKGROUND_STATUS_TIMEOUT_MS,
    maxRetries: 0
  } as any);
}

export function parseSimulationHtmlResponse(response: any, message = "Model response did not include HTML output"): string {
  return requireOutputText(response, message);
}

async function startSimulationBackgroundResponse(
  client: OpenAI,
  model: ModelCatalogEntry,
  payload: ResponsePayload
): Promise<{ responseId: string; status: string; modelUsed: string; requestedModel: string; serviceTierUsed?: string | null }> {
  // A response must be created with streaming enabled to replay/resume its events.
  // Disconnect after the acknowledgement; background mode keeps the generation
  // running, and the authenticated job stream reconnects to this same response.
  const create = (modelId: string) => client.responses.create({
    ...payload, model: modelId, background: true, store: true, stream: true
  }, { timeout: OPENAI_BACKGROUND_START_TIMEOUT_MS, maxRetries: 0 });
  let modelUsed = model.id;
  let stream;
  try {
    stream = await create(modelUsed);
  } catch (error) {
    if (!model.fallbackModelId || model.fallbackModelId === modelUsed || !shouldFallbackToAlternateModel(error)) throw error;
    modelUsed = model.fallbackModelId;
    stream = await create(modelUsed);
  }
  try {
    for await (const event of stream) {
      if (event.type === "response.created" || event.type === "response.queued" || event.type === "response.in_progress") {
        if (!event.response.id) break;
        return {
          responseId: event.response.id,
          status: event.response.status ?? "queued",
          modelUsed,
          requestedModel: model.id,
          serviceTierUsed: event.response.service_tier
        };
      }
    }
    throw new HttpError(502, "Simulation generation did not return a background response id");
  } finally {
    // Aborts this HTTP connection, not the background generation.
    stream.controller.abort();
  }
}

export async function createSimulationResponseWithFallback(
  client: OpenAI,
  preferredModel: ModelCatalogEntry,
  payload: ResponsePayload,
  options?: { timeout?: number; maxRetries?: number }
): Promise<{ response: OpenAI.Responses.Response; modelUsed: string }> {
  const requestedModel = getRequestedModelId(payload) ?? preferredModel.id;
  try {
    const response = await client.responses.create(payload, options);
    return { response, modelUsed: requestedModel };
  } catch (error) {
    const fallbackModel = preferredModel.fallbackModelId;
    if (!fallbackModel || fallbackModel === requestedModel) throw error;
    if (!shouldFallbackToAlternateModel(error)) throw error;
    const response = await client.responses.create({ ...payload, model: fallbackModel }, options);
    return { response, modelUsed: fallbackModel };
  }
}

export async function createImageResponseWithFallback(
  client: OpenAI,
  preferredModel: ModelCatalogEntry,
  payload: OpenAI.Images.ImageGenerateParamsNonStreaming
): Promise<{ response: OpenAI.Images.ImagesResponse; modelUsed: string }> {
  const requestedModel = getRequestedModelId(payload) ?? preferredModel.id;
  try {
    const response = await client.images.generate(payload, { timeout: 180_000, maxRetries: 0 });
    return { response, modelUsed: requestedModel };
  } catch (error) {
    const fallbackModel = preferredModel.fallbackModelId;
    if (!fallbackModel || fallbackModel === requestedModel) throw error;
    if (!shouldFallbackToAlternateModel(error)) throw error;
    const response = await client.images.generate({ ...payload, model: fallbackModel }, { timeout: 180_000, maxRetries: 0 });
    return { response, modelUsed: fallbackModel };
  }
}

function shouldFallbackToAlternateModel(error: unknown): boolean {
  const status = typeof error === "object" && error !== null && "status" in error ? Number((error as any).status) : undefined;
  const code = typeof error === "object" && error !== null && "code" in error ? String((error as any).code || "") : "";
  const message = typeof error === "object" && error !== null && "message" in error ? String((error as any).message || "") : "";
  const text = `${code} ${message}`.toLowerCase();
  if (status !== 400 && status !== 404) return false;
  return text.includes("model") && (
    text.includes("not found")
    || text.includes("not available")
    || text.includes("unsupported")
    || text.includes("does not exist")
  );
}

function getRequestedModelId(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  if (!("model" in payload)) return undefined;
  const model = (payload as { model?: unknown }).model;
  return typeof model === "string" && model.trim().length > 0 ? model : undefined;
}

function decodeBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

export function transcriptionPrompt(prompts?: AiPromptBundle, context?: TranscriptionPromptContext): string | undefined {
  const pair = prompts?.transcription;
  const builtIn = BUILT_IN_PROMPTS.transcription!;
  // Preserve the existing speech recognition behavior until a teacher customizes it.
  if (!pair || (pair.system === builtIn.system && pair.user === builtIn.user)) return undefined;
  return renderPromptSystem(prompts, "transcription") + "\n" + renderPromptUser(prompts, "transcription", context ? { assessmentPrompt: context.assessmentPrompt } : {});
}
