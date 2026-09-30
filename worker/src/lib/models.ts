import {
  DEFAULT_SIMULATION_CODE_MODEL_ID,
  SIMULATION_CODE_MODEL_OPTIONS,
  type SimulationCodeModelId,
  type SimulationCodeModelProvider
} from "@alt-assessment/shared";
import type { StoredAiSettings } from "./aiSettings";

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
  reasoningEffort?: "low" | "medium" | "high" | "xhigh" | "max";
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
  reasoningEffort?: "low" | "medium" | "high" | "xhigh" | "max";
  verbosity?: "low" | "medium" | "high";
  maxOutputTokens?: number;
}

const CONFIRMATION_REQUIRED_MODEL_IDS = new Set<string>();
// Responses counts reasoning and visible HTML against the same output limit.
// Leave enough space for Max reasoning to finish and emit a complete document.
const SIMULATION_HTML_MAX_OUTPUT_TOKENS = 64000;

export const modelCatalog: Record<ModelRole, ModelCatalogEntry> = {
  transcription: { id: "gpt-4o-transcribe" },
  grading: { id: "gpt-6.1-sol", reasoningEffort: "max", verbosity: "low", maxOutputTokens: 8192 },
  visionGrading: { id: "gpt-6.1-sol", reasoningEffort: "max", verbosity: "low", maxOutputTokens: 8192 },
  simulationSpec: { id: "gpt-5.6-terra", reasoningEffort: "max", verbosity: "low", maxOutputTokens: 32000, fallbackModelId: "gpt-6.1-sol" },
  simulationHtml: { id: "gpt-6.1-sol", reasoningEffort: "max", verbosity: "low", maxOutputTokens: SIMULATION_HTML_MAX_OUTPUT_TOKENS },
  simulationSketchImage: { id: "gpt-image-2.5-flare", fallbackModelId: "gpt-image-2.5-sunburst" },
  simulationReadinessClassifier: { id: "gpt-5.6-terra", reasoningEffort: "max", verbosity: "low" },
  fidelityReview: { id: "gpt-5.6-terra", reasoningEffort: "max", verbosity: "low", fallbackModelId: "gpt-6.1-sol" },
  realtimeVoice: { id: "gpt-realtime" }
};

export const simulationCodeModelCatalog: Record<SimulationCodeModelId, SimulationCodeModelEntry> = {
  "openai:gpt-5.6-sol": {
    id: "openai:gpt-5.6-sol",
    label: simulationCodeModelLabel("openai:gpt-5.6-sol"),
    provider: "openai",
    providerModelId: "gpt-6.1-sol",
    apiKeyEnv: "OPENAI_API_KEY",
    generationApi: "responses",
    inputModalities: ["text", "image"],
    reasoningEffort: "max",
    verbosity: "low",
    maxOutputTokens: SIMULATION_HTML_MAX_OUTPUT_TOKENS
  },
  "openai:gpt-5.6-terra": {
    id: "openai:gpt-5.6-terra",
    label: simulationCodeModelLabel("openai:gpt-5.6-terra"),
    provider: "openai",
    providerModelId: "gpt-5.6-terra",
    apiKeyEnv: "OPENAI_API_KEY",
    generationApi: "responses",
    inputModalities: ["text", "image"],
    reasoningEffort: "max",
    verbosity: "low",
    maxOutputTokens: SIMULATION_HTML_MAX_OUTPUT_TOKENS
  },
  "openai:gpt-5.6-luna": {
    id: "openai:gpt-5.6-luna",
    label: simulationCodeModelLabel("openai:gpt-5.6-luna"),
    provider: "openai",
    providerModelId: "gpt-5.6-luna",
    apiKeyEnv: "OPENAI_API_KEY",
    generationApi: "responses",
    inputModalities: ["text", "image"],
    reasoningEffort: "max",
    verbosity: "low",
    maxOutputTokens: SIMULATION_HTML_MAX_OUTPUT_TOKENS
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

export function getModel(role: ModelRole, settings?: StoredAiSettings): ModelCatalogEntry {
  const base = modelCatalog[role];
  const override = settings?.roleModels[role];
  if (!override) return base;
  return { ...base, id: override.id, reasoningEffort: override.reasoningEffort === "none" ? undefined : override.reasoningEffort,
    // Older snapshots omitted this field and retain their original role limits.
    maxOutputTokens: override.maxOutputTokens,
    fallbackModelId: override.id === base.id ? base.fallbackModelId : undefined };
}

export function getSimulationCodeModel(modelId: SimulationCodeModelId = DEFAULT_SIMULATION_CODE_MODEL_ID, settings?: StoredAiSettings): SimulationCodeModelEntry {
  if (!settings) return simulationCodeModelCatalog[modelId] ?? simulationCodeModelCatalog[DEFAULT_SIMULATION_CODE_MODEL_ID];
  const requested = settings.codeModels.find(model => model.id === modelId);
  const selected = settings.forceDefaultSimulationModel || !requested?.enabled
    ? settings.codeModels.find(model => model.id === settings.defaultSimulationModelId) : requested;
  if (!selected?.enabled) throw new Error("No enabled student model");
  const base = simulationCodeModelCatalog[selected.id] ?? Object.values(simulationCodeModelCatalog).find(model => model.provider === selected.provider)!;
  return { ...base, id: selected.id, provider: selected.provider, label: selected.label, providerModelId: selected.modelId,
    maxOutputTokens: selected.maxOutputTokens ?? base.maxOutputTokens,
    reasoningEffort: selected.reasoningEffort === "none" ? undefined : selected.reasoningEffort };
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
