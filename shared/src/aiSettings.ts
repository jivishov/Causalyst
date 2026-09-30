import type { SimulationCodeModelId, SimulationCodeModelProvider } from "./assessmentConfig";

export const AI_PROVIDERS = ["openai", "kimi", "zai"] as const;
export type AiProvider = typeof AI_PROVIDERS[number];
export const AI_MODEL_ROLES = ["grading", "visionGrading", "transcription", "simulationSpec", "simulationHtml", "simulationSketchImage", "simulationReadinessClassifier", "fidelityReview", "realtimeVoice"] as const;
export type AiModelRole = typeof AI_MODEL_ROLES[number];
export const AI_REASONING_EFFORTS = ["none", "low", "medium", "high", "xhigh", "max"] as const;
export type AiReasoningEffort = typeof AI_REASONING_EFFORTS[number];
export interface TeacherRoleModel { id: string; reasoningEffort: AiReasoningEffort }
export interface TeacherCodeModel {
  id: SimulationCodeModelId;
  provider: SimulationCodeModelProvider;
  label: string;
  modelId: string;
  reasoningEffort: AiReasoningEffort;
  enabled: boolean;
}
export interface TeacherAiSettings {
  updatedAt: string | null;
  keys: Record<AiProvider, { configured: boolean; source: "teacher" | "server" | "missing" }>;
  roleModels: Record<AiModelRole, TeacherRoleModel>;
  codeModels: TeacherCodeModel[];
  defaultSimulationModelId: SimulationCodeModelId;
  forceDefaultSimulationModel: boolean;
}
export interface TeacherAiSettingsUpdate {
  updatedAt: string | null;
  roleModels: TeacherAiSettings["roleModels"];
  codeModels: TeacherCodeModel[];
  defaultSimulationModelId: SimulationCodeModelId;
  forceDefaultSimulationModel: boolean;
  apiKeys?: Partial<Record<AiProvider, string | null>>;
}
