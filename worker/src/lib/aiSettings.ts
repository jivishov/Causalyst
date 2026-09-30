import { AI_MODEL_ROLES, AI_PROVIDERS, AI_REASONING_EFFORTS, DEFAULT_SIMULATION_CODE_MODEL_ID, SIMULATION_CODE_MODEL_OPTIONS,
  type AiProvider, type TeacherAiSettings, type TeacherCodeModel, type TeacherRoleModel } from "@alt-assessment/shared";
import type { AppDatabaseClient, Json } from "./database";
import { toJson } from "./database";
import type { Env } from "./env";
import { HttpError } from "./http";
import { modelCatalog, simulationCodeModelCatalog } from "./models";
import { decryptProviderSecret, encryptProviderSecret } from "./providerSecrets";

export const PROVIDER_ENV = { openai: "OPENAI_API_KEY", kimi: "MOONSHOT_API_KEY", zai: "ZAI_API_KEY" } as const;
export interface StoredAiSettings {
  apiKeys: Partial<Record<AiProvider, string>>;
  roleModels: TeacherAiSettings["roleModels"];
  codeModels: TeacherCodeModel[];
  defaultSimulationModelId: TeacherAiSettings["defaultSimulationModelId"];
  forceDefaultSimulationModel: boolean;
}
export interface AiSettingsRecord { settings: StoredAiSettings | null; updatedAt: string | null }
export interface AttemptAiContext { teacherId: string; runtime: StoredAiSettings | null; settings: StoredAiSettings | null }

export function defaultAiSettings(env: Env): StoredAiSettings {
  return {
    apiKeys: {},
    roleModels: Object.fromEntries(AI_MODEL_ROLES.map(role => [role, { id: modelCatalog[role].id, reasoningEffort: modelCatalog[role].reasoningEffort ?? "none" }])) as StoredAiSettings["roleModels"],
    codeModels: SIMULATION_CODE_MODEL_OPTIONS.map(option => {
      const model = simulationCodeModelCatalog[option.id];
      return { id: option.id, provider: option.provider, label: option.label, modelId: model.providerModelId,
        reasoningEffort: model.reasoningEffort ?? "none", enabled: Boolean(env[PROVIDER_ENV[option.provider]]) };
    }),
    defaultSimulationModelId: DEFAULT_SIMULATION_CODE_MODEL_ID,
    forceDefaultSimulationModel: false
  };
}

// Unconfigured classrooms retain the original assignment catalog, including
// the existing missing-provider-key error rather than silently changing models.
export function defaultRuntimeAiSettings(env: Env): StoredAiSettings {
  const settings = defaultAiSettings(env);
  return { ...settings, codeModels: settings.codeModels.map(model => ({ ...model, enabled: true })) };
}

export async function loadTeacherAiSettings(db: AppDatabaseClient, teacherId: string): Promise<AiSettingsRecord> {
  const { data, error } = await db.rpc("get_teacher_ai_settings", { p_teacher_id: teacherId });
  if (error) throw new HttpError(503, "AI settings are unavailable");
  return (data as unknown as AiSettingsRecord | null) ?? { settings: null, updatedAt: null };
}

export function publicAiSettings(record: AiSettingsRecord, env: Env): TeacherAiSettings {
  const settings = record.settings ?? defaultAiSettings(env);
  return {
    updatedAt: record.updatedAt,
    keys: Object.fromEntries(AI_PROVIDERS.map(provider => [provider, { configured: Boolean(settings.apiKeys[provider] || env[PROVIDER_ENV[provider]]),
      source: settings.apiKeys[provider] ? "teacher" : env[PROVIDER_ENV[provider]] ? "server" : "missing" }])) as TeacherAiSettings["keys"],
    roleModels: settings.roleModels, codeModels: settings.codeModels,
    defaultSimulationModelId: settings.defaultSimulationModelId, forceDefaultSimulationModel: settings.forceDefaultSimulationModel
  };
}

export function validateAiModelSettings(body: Record<string, unknown>, previous: StoredAiSettings): StoredAiSettings {
  const roles = record(body.roleModels);
  const roleModels = Object.fromEntries(AI_MODEL_ROLES.map(role => [role, validateRoleModel(roles[role])])) as StoredAiSettings["roleModels"];
  if (!Array.isArray(body.codeModels) || body.codeModels.length !== SIMULATION_CODE_MODEL_OPTIONS.length) throw new HttpError(400, "Provide all simulation model options");
  const codeModels = SIMULATION_CODE_MODEL_OPTIONS.map(option => {
    const entries = (body.codeModels as unknown[]).filter(value => record(value).id === option.id);
    if (entries.length !== 1) throw new HttpError(400, "Simulation model options must be unique");
    const entry = record(entries[0]);
    const model = validateRoleModel({ id: entry.modelId, reasoningEffort: entry.reasoningEffort });
    const reasoningEffort = simulationCodeModelCatalog[option.id].reasoningEffort ?? "none";
    if (model.reasoningEffort !== reasoningEffort) throw new HttpError(400, "Simulation models retain the classroom reasoning policy");
    if (typeof entry.label !== "string" || !entry.label.trim() || entry.label.length > 100) throw new HttpError(400, "Model labels must contain 1–100 characters");
    if (typeof entry.enabled !== "boolean") throw new HttpError(400, "Select which simulation models are enabled");
    return { id: option.id, provider: option.provider, label: entry.label.trim(), modelId: model.id, reasoningEffort: model.reasoningEffort, enabled: entry.enabled };
  });
  const defaultModel = codeModels.find(model => model.id === body.defaultSimulationModelId);
  if (!defaultModel?.enabled) throw new HttpError(400, "The default student model must be enabled");
  if (typeof body.forceDefaultSimulationModel !== "boolean") throw new HttpError(400, "Select a student model policy");
  return { ...previous, roleModels, codeModels, defaultSimulationModelId: defaultModel.id, forceDefaultSimulationModel: body.forceDefaultSimulationModel };
}

function validateRoleModel(value: unknown): TeacherRoleModel {
  const model = record(value);
  if (typeof model.id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(model.id.trim())) throw new HttpError(400, "Enter a valid provider model ID (letters, numbers, dots, underscores, or hyphens)");
  if (!AI_REASONING_EFFORTS.some(effort => effort === model.reasoningEffort)) throw new HttpError(400, "Select a supported reasoning effort");
  return { id: model.id.trim(), reasoningEffort: model.reasoningEffort as TeacherRoleModel["reasoningEffort"] };
}

export async function captureRuntimeKeys(settings: StoredAiSettings, teacherId: string, env: Env): Promise<StoredAiSettings> {
  const apiKeys = { ...settings.apiKeys };
  for (const provider of AI_PROVIDERS) {
    if (!apiKeys[provider] && env[PROVIDER_ENV[provider]]) apiKeys[provider] = await encryptProviderSecret(env[PROVIDER_ENV[provider]]!, `${teacherId}:${provider}`, env);
  }
  return { ...settings, apiKeys };
}

export async function runtimeAiEnv(settings: StoredAiSettings, teacherId: string, env: Env): Promise<Env> {
  const next = { ...env, AI_SETTINGS: settings };
  for (const provider of AI_PROVIDERS) {
    const sealed = settings.apiKeys[provider];
    next[PROVIDER_ENV[provider]] = sealed ? await decryptProviderSecret(sealed, `${teacherId}:${provider}`, env) : "";
  }
  return next;
}

// Call only after checking attempt ownership. Immutable snapshots keep provider
// files, background responses, and voice calls on the account that created them.
export async function resolveAttemptAiEnv(db: AppDatabaseClient, env: Env, attemptId: string): Promise<Env> {
  const { data, error } = await db.rpc("get_attempt_ai_context", { p_attempt_id: attemptId });
  if (error) throw new HttpError(503, "Assessment AI settings are unavailable");
  const context = data as unknown as AttemptAiContext | null;
  if (!context?.teacherId) return env;
  if (context.runtime) return runtimeAiEnv(context.runtime, context.teacherId, env);
  const runtime = await captureRuntimeKeys(context.settings ?? defaultRuntimeAiSettings(env), context.teacherId, env);
  const captured = await db.rpc("capture_attempt_ai_settings", { p_attempt_id: attemptId, p_teacher_id: context.teacherId, p_settings: toJson(runtime) });
  if (captured.error || !captured.data) throw new HttpError(503, "Could not preserve assessment AI settings");
  return runtimeAiEnv(captured.data as unknown as StoredAiSettings, context.teacherId, env);
}

export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new HttpError(400, "Invalid settings object");
  return value as Record<string, unknown>;
}

// Introspection marks SQL text arguments non-nullable. The version nonce is
// deliberately null on a teacher's first save; keep that boundary explicit.
export type AiSettingsFunctions = {
  get_teacher_ai_settings: { Args: { p_teacher_id: string }; Returns: Json };
  get_attempt_ai_context: { Args: { p_attempt_id: string }; Returns: Json };
  capture_attempt_ai_settings: { Args: { p_attempt_id: string; p_teacher_id: string; p_settings: Json }; Returns: Json };
  set_teacher_ai_settings: { Args: { p_teacher_id: string; p_settings: Json; p_previous_runtime: Json; p_expected_updated_at: string | null }; Returns: Json };
};
