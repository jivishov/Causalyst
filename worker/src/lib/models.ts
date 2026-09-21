import {
  DEFAULT_SIMULATION_CODE_MODEL_ID,
  SIMULATION_CODE_MODEL_OPTIONS,
  type SimulationCodeModelId,
  type SimulationCodeModelProvider
} from "@alt-assessment/shared";

export type ModelRole =
  | "transcription"
  | "grading"
  | "visionGrading"
  | "simulationSpec"
  | "simulationHtml"
  | "simulationSketchImage"
  | "simulationReadinessClassifier"
  | "fidelityReview"
  | "realtimeVoice";

export interface ModelCatalogEntry {
  id: string;
  reasoningEffort?: "low" | "medium" | "high" | "xhigh";
  verbosity?: "low" | "medium" | "high";
  maxOutputTokens?: number;
  requiresConfirmation?: boolean;
  fallbackModelId?: string;
}

export interface SimulationCodeModelEntry {
  id: SimulationCodeModelId;
  label: string;
  provider: SimulationCodeModelProvider;
  providerModelId: string;
  apiKeyEnv: "OPENAI_API_KEY" | "MOONSHOT_API_KEY" | "ZAI_API_KEY";
  baseURL?: string;
  generationApi: "responses" | "chat.completions";
  inputModalities: Array<"text" | "image">;
  reasoningEffort?: "low" | "medium" | "high" | "xhigh";
  verbosity?: "low" | "medium" | "high";
  maxOutputTokens?: number;
}

const CONFIRMATION_REQUIRED_MODEL_IDS = new Set<string>();

export const modelCatalog: Record<ModelRole, ModelCatalogEntry> = {
  transcription: { id: "gpt-4o-transcribe" },
  grading: { id: "gpt-5.5", reasoningEffort: "low", verbosity: "low" },
  visionGrading: { id: "gpt-5.5", reasoningEffort: "medium", verbosity: "low" },
  simulationSpec: { id: "gpt-5.4-mini", reasoningEffort: "high", verbosity: "low", maxOutputTokens: 32000, fallbackModelId: "gpt-5.5" },
  simulationHtml: { id: "gpt-5.5", reasoningEffort: "medium", verbosity: "low", maxOutputTokens: 24000 },
  simulationSketchImage: { id: "gpt-image-2", fallbackModelId: "gpt-image-1.5" },
  simulationReadinessClassifier: { id: "gpt-5.4-mini", reasoningEffort: "xhigh", verbosity: "low" },
  fidelityReview: { id: "gpt-5.4-mini", reasoningEffort: "xhigh", verbosity: "low", fallbackModelId: "gpt-5.5" },
  realtimeVoice: { id: "gpt-realtime" }
};

export const simulationCodeModelCatalog: Record<SimulationCodeModelId, SimulationCodeModelEntry> = {
  "openai:gpt-5.5": {
    id: "openai:gpt-5.5",
    label: simulationCodeModelLabel("openai:gpt-5.5"),
    provider: "openai",
    providerModelId: "gpt-5.5",
    apiKeyEnv: "OPENAI_API_KEY",
    generationApi: "responses",
    inputModalities: ["text", "image"],
    reasoningEffort: "medium",
    verbosity: "low",
    maxOutputTokens: 24000
  },
  "openai:gpt-5.4": {
    id: "openai:gpt-5.4",
    label: simulationCodeModelLabel("openai:gpt-5.4"),
    provider: "openai",
    providerModelId: "gpt-5.4",
    apiKeyEnv: "OPENAI_API_KEY",
    generationApi: "responses",
    inputModalities: ["text", "image"],
    reasoningEffort: "medium",
    verbosity: "low",
    maxOutputTokens: 24000
  },
  "openai:gpt-5.4-mini": {
    id: "openai:gpt-5.4-mini",
    label: simulationCodeModelLabel("openai:gpt-5.4-mini"),
    provider: "openai",
    providerModelId: "gpt-5.4-mini",
    apiKeyEnv: "OPENAI_API_KEY",
    generationApi: "responses",
    inputModalities: ["text", "image"],
    reasoningEffort: "high",
    verbosity: "low",
    maxOutputTokens: 24000
  },
  "kimi:kimi-k2.6": {
    id: "kimi:kimi-k2.6",
    label: simulationCodeModelLabel("kimi:kimi-k2.6"),
    provider: "kimi",
    providerModelId: "kimi-k2.6",
    apiKeyEnv: "MOONSHOT_API_KEY",
    baseURL: "https://api.moonshot.ai/v1",
    generationApi: "chat.completions",
    inputModalities: ["text", "image"],
    maxOutputTokens: 24000
  },
  "zai:glm-5v-turbo": {
    id: "zai:glm-5v-turbo",
    label: simulationCodeModelLabel("zai:glm-5v-turbo"),
    provider: "zai",
    providerModelId: "glm-5v-turbo",
    apiKeyEnv: "ZAI_API_KEY",
    baseURL: "https://api.z.ai/api/paas/v4/",
    generationApi: "chat.completions",
    inputModalities: ["text", "image"],
    maxOutputTokens: 24000
  }
};

export function getModel(role: ModelRole): ModelCatalogEntry {
  return modelCatalog[role];
}

export function getSimulationCodeModel(modelId: SimulationCodeModelId = DEFAULT_SIMULATION_CODE_MODEL_ID): SimulationCodeModelEntry {
  return simulationCodeModelCatalog[modelId];
}

export function toOpenAIModelCatalogEntry(model: SimulationCodeModelEntry): ModelCatalogEntry {
  return {
    id: model.providerModelId,
    reasoningEffort: model.reasoningEffort,
    verbosity: model.verbosity,
    maxOutputTokens: model.maxOutputTokens
  };
}

export function modelNeedsConfirmation(role: ModelRole): boolean {
  const entry = getModel(role);
  if (entry.requiresConfirmation === true) return true;
  if (modelIdNeedsConfirmation(entry.id)) return true;
  if (entry.fallbackModelId && modelIdNeedsConfirmation(entry.fallbackModelId)) return true;
  return false;
}

function simulationCodeModelLabel(modelId: SimulationCodeModelId): string {
  return SIMULATION_CODE_MODEL_OPTIONS.find((option) => option.id === modelId)?.label ?? modelId;
}

function modelIdNeedsConfirmation(modelId: string): boolean {
  return CONFIRMATION_REQUIRED_MODEL_IDS.has(modelId);
}
