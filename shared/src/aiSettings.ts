import type { SimulationCodeModelId, SimulationCodeModelProvider } from "./assessmentConfig";

export const AI_PROVIDERS = ["openai", "kimi", "zai"] as const;
export type AiProvider = typeof AI_PROVIDERS[number];
export const AI_MODEL_ROLES = ["grading", "visionGrading", "transcription", "simulationSpec", "simulationHtml", "simulationSketchImage", "simulationReadinessClassifier", "fidelityReview", "realtimeVoice"] as const;
export type AiModelRole = typeof AI_MODEL_ROLES[number];
export const AI_REASONING_EFFORTS = ["none", "low", "medium", "high", "xhigh", "max"] as const;
export type AiReasoningEffort = typeof AI_REASONING_EFFORTS[number];
export const AI_TEXT_MODEL_ROLES: readonly AiModelRole[] = ["grading", "visionGrading", "simulationSpec", "simulationHtml", "simulationReadinessClassifier", "fidelityReview"];
export const AI_MIN_OUTPUT_TOKENS = 16;
export const AI_MAX_OUTPUT_TOKENS = 128000;
export function reasoningEffortsForModel(modelId: string): readonly AiReasoningEffort[] {
  return /^gpt-6\.1-sol(?:-|$)/.test(modelId.trim()) ? AI_REASONING_EFFORTS.filter(effort => effort !== "none") : AI_REASONING_EFFORTS;
}
export const AI_MODEL_CAPABILITIES = ["text", "transcription", "image", "realtime"] as const;
export type AiModelCapability = typeof AI_MODEL_CAPABILITIES[number];
export function modelCapabilityForRole(role: AiModelRole): AiModelCapability {
  return role === "transcription" ? "transcription" : role === "simulationSketchImage" ? "image" : role === "realtimeVoice" ? "realtime" : "text";
}
export interface TeacherRoleModel { id: string; reasoningEffort: AiReasoningEffort; maxOutputTokens?: number; catalogModelId?: SimulationCodeModelId }
export interface TeacherCodeModel {
  id: SimulationCodeModelId;
  provider: SimulationCodeModelProvider;
  label: string;
  modelId: string;
  reasoningEffort: AiReasoningEffort;
  maxOutputTokens?: number;
  enabled: boolean;
}
export interface TeacherProviderModel extends TeacherCodeModel { capability: AiModelCapability }
export interface TeacherAiSettings {
  updatedAt: string | null;
  keys: Record<AiProvider, { configured: boolean; source: "teacher" | "server" | "missing" }>;
  roleModels: Record<AiModelRole, TeacherRoleModel>;
  codeModels: TeacherCodeModel[];
  providerModels?: TeacherProviderModel[];
  defaultSimulationModelId: SimulationCodeModelId;
  forceDefaultSimulationModel: boolean;
}
export interface TeacherAiSettingsUpdate {
  updatedAt: string | null;
  roleModels: TeacherAiSettings["roleModels"];
  codeModels: TeacherCodeModel[];
  providerModels?: TeacherProviderModel[];
  defaultSimulationModelId: SimulationCodeModelId;
  forceDefaultSimulationModel: boolean;
  apiKeys?: Partial<Record<AiProvider, string | null>>;
}

// Upgrade older saved settings in memory without altering immutable attempts.
export function teacherProviderModels(settings: Pick<TeacherAiSettings, "codeModels" | "roleModels" | "providerModels">): TeacherProviderModel[] {
  if (settings.providerModels) return settings.providerModels;
  const models: TeacherProviderModel[] = settings.codeModels.map(model => ({ ...model, capability: "text" }));
  for (const role of AI_MODEL_ROLES) {
    const model = settings.roleModels[role];
    const capability = modelCapabilityForRole(role);
    if (!models.some(entry => entry.provider === "openai" && entry.modelId === model.id && entry.capability === capability)) {
      models.push({ id: `openai:${model.id}`, provider: "openai", label: model.id, modelId: model.id, capability,
        reasoningEffort: model.reasoningEffort, maxOutputTokens: model.maxOutputTokens, enabled: false });
    }
  }
  return models;
}
