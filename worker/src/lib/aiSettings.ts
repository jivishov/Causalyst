import { AI_MODEL_ROLES, AI_PROVIDERS, AI_TEXT_MODEL_ROLES, AI_MODEL_CAPABILITIES, AI_MIN_OUTPUT_TOKENS, AI_MAX_OUTPUT_TOKENS, reasoningEffortsForModel, DEFAULT_SIMULATION_CODE_MODEL_ID, SIMULATION_CODE_MODEL_OPTIONS,
  isSimulationCodeModelId, modelCapabilitiesForModel, modelCapabilityForRole, teacherProviderModels,
  type AiProvider, type TeacherAiSettings, type TeacherCodeModel, type TeacherProviderModel, type TeacherRoleModel } from "@alt-assessment/shared";
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
  providerModels?: TeacherProviderModel[];
  defaultSimulationModelId: TeacherAiSettings["defaultSimulationModelId"];
  forceDefaultSimulationModel: boolean;
}
export interface AiSettingsRecord { settings: StoredAiSettings | null; updatedAt: string | null }
export interface AttemptAiContext { teacherId: string; runtime: StoredAiSettings | null; settings: StoredAiSettings | null }

export function defaultAiSettings(env: Env): StoredAiSettings {
  const settings: StoredAiSettings = {
    apiKeys: {},
    roleModels: Object.fromEntries(AI_MODEL_ROLES.map(role => [role, { id: modelCatalog[role].id, reasoningEffort: modelCatalog[role].reasoningEffort ?? "none", maxOutputTokens: modelCatalog[role].maxOutputTokens }])) as StoredAiSettings["roleModels"],
    codeModels: SIMULATION_CODE_MODEL_OPTIONS.map(option => {
      const model = simulationCodeModelCatalog[option.id];
      return { id: option.id, provider: option.provider, label: option.label, modelId: model.providerModelId,
        reasoningEffort: model.reasoningEffort ?? "none", maxOutputTokens: model.maxOutputTokens, enabled: Boolean(env[PROVIDER_ENV[option.provider]]) };
    }),
    defaultSimulationModelId: DEFAULT_SIMULATION_CODE_MODEL_ID,
    forceDefaultSimulationModel: false
  };
  return { ...settings, providerModels: teacherProviderModels(settings) };
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
    roleModels: settings.roleModels, codeModels: settings.codeModels, providerModels: teacherProviderModels(settings),
    defaultSimulationModelId: settings.defaultSimulationModelId, forceDefaultSimulationModel: settings.forceDefaultSimulationModel
  };
}

export function validateAiModelSettings(body: Record<string, unknown>, previous: StoredAiSettings): StoredAiSettings {
  const providerModels = body.providerModels === undefined ? undefined : validateProviderModels(body.providerModels);
  const roles = record(body.roleModels);
  const roleModels = Object.fromEntries(AI_MODEL_ROLES.map(role => {
    const model = validateRoleModel(roles[role]);
    if (!AI_TEXT_MODEL_ROLES.includes(role) && (model.reasoningEffort !== "none" || model.maxOutputTokens !== undefined)) throw new HttpError(400, "Token limits and reasoning apply to text models only");
    const selected = providerModels?.find(entry => model.catalogModelId ? entry.id === model.catalogModelId : entry.provider === "openai" && entry.modelId === model.id);
    if (providerModels && (!selected || (role !== "simulationHtml" && selected.provider !== "openai") || selected.capability !== modelCapabilityForRole(role) || selected.modelId !== model.id)) {
      throw new HttpError(400, `Choose a compatible OpenAI model from the list for ${role}`);
    }
    return [role, { ...model, catalogModelId: selected?.id ?? model.catalogModelId, maxOutputTokens: model.maxOutputTokens ?? modelCatalog[role].maxOutputTokens }];
  })) as StoredAiSettings["roleModels"];
  const sourceModels = providerModels ?? validateProviderModels(Array.isArray(body.codeModels) ? body.codeModels.map(entry => ({ ...record(entry), capability: "text" })) : body.codeModels);
  const codeModels = sourceModels.filter(model => model.capability === "text").map(({ capability: _capability, ...model }) => model);
  const defaultModel = codeModels.find(model => model.id === body.defaultSimulationModelId);
  if (!defaultModel?.enabled) throw new HttpError(400, "The default student model must be enabled");
  if (typeof body.forceDefaultSimulationModel !== "boolean") throw new HttpError(400, "Select a student model policy");
  const settings = { ...previous, roleModels, codeModels, providerModels, defaultSimulationModelId: defaultModel.id, forceDefaultSimulationModel: body.forceDefaultSimulationModel };
  return { ...settings, providerModels: teacherProviderModels(settings) };
}

function validateProviderModels(value: unknown): TeacherProviderModel[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 100) throw new HttpError(400, "Provide 1–100 models in the provider list");
  const ids = new Set<string>();
  const providerIds = new Set<string>();
  return value.map(item => {
    const entry = record(item);
    if (!AI_PROVIDERS.includes(entry.provider as AiProvider) || !isSimulationCodeModelId(entry.id) || !entry.id.startsWith(`${entry.provider}:`)) throw new HttpError(400, "Select a supported provider for each model");
    if (!AI_MODEL_CAPABILITIES.includes(entry.capability as TeacherProviderModel["capability"])) throw new HttpError(400, "Select a model capability");
    if (typeof entry.modelId === "string" && !modelCapabilitiesForModel(entry.provider as AiProvider, entry.modelId).includes(entry.capability as TeacherProviderModel["capability"])) {
      throw new HttpError(400, "Choose a supported task capability for this provider model");
    }
    const model = validateRoleModel({ id: entry.modelId, reasoningEffort: entry.reasoningEffort, maxOutputTokens: entry.maxOutputTokens });
    const providerId = `${entry.provider}:${model.id}`;
    if (ids.has(entry.id) || providerIds.has(providerId)) throw new HttpError(400, "Models must be unique within each provider");
    ids.add(entry.id); providerIds.add(providerId);
    if (entry.provider !== "openai" && (entry.capability !== "text" || model.reasoningEffort !== "none")) throw new HttpError(400, "Kimi and Z.AI models support student simulations with provider default reasoning");
    if (entry.capability !== "text" && (model.reasoningEffort !== "none" || model.maxOutputTokens !== undefined || entry.enabled === true)) throw new HttpError(400, "Only text models have reasoning, token limits, and simulation availability");
    if (typeof entry.label !== "string" || !entry.label.trim() || entry.label.length > 100) throw new HttpError(400, "Model labels must contain 1–100 characters");
    if (typeof entry.enabled !== "boolean") throw new HttpError(400, "Select which simulation models are enabled");
    return { id: entry.id, provider: entry.provider as AiProvider, label: entry.label.trim(), modelId: model.id,
      capability: entry.capability as TeacherProviderModel["capability"], reasoningEffort: model.reasoningEffort, maxOutputTokens: model.maxOutputTokens, enabled: entry.enabled };
  });
}

function validateRoleModel(value: unknown): TeacherRoleModel {
  const model = record(value);
  if (typeof model.id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(model.id.trim())) throw new HttpError(400, "Enter a valid provider model ID (letters, numbers, dots, underscores, or hyphens)");
  if (!reasoningEffortsForModel(model.id).some(effort => effort === model.reasoningEffort)) throw new HttpError(400, "Select a supported reasoning effort for this model");
  const maxOutputTokens = model.maxOutputTokens;
  if (maxOutputTokens !== undefined && (!Number.isInteger(maxOutputTokens) || Number(maxOutputTokens) < AI_MIN_OUTPUT_TOKENS || Number(maxOutputTokens) > AI_MAX_OUTPUT_TOKENS)) {
    throw new HttpError(400, `Token limits must be whole numbers from ${AI_MIN_OUTPUT_TOKENS} to ${AI_MAX_OUTPUT_TOKENS}`);
  }
  if (model.catalogModelId !== undefined && !isSimulationCodeModelId(model.catalogModelId)) throw new HttpError(400, "Select a model from the provider list");
  return { id: model.id.trim(), reasoningEffort: model.reasoningEffort as TeacherRoleModel["reasoningEffort"], maxOutputTokens: maxOutputTokens as number | undefined,
    catalogModelId: model.catalogModelId as TeacherRoleModel["catalogModelId"] };
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
// New HTML operations can use the teacher's current model policy with those keys.
export async function resolveAttemptAiEnv(db: AppDatabaseClient, env: Env, attemptId: string,
  options: { currentSimulationModels?: boolean } = {}): Promise<Env> {
  const { data, error } = await db.rpc("get_attempt_ai_context", { p_attempt_id: attemptId });
  if (error) throw new HttpError(503, "Assessment AI settings are unavailable");
  const context = data as unknown as AttemptAiContext | null;
  if (!context?.teacherId) return env;
  let runtime = context.runtime;
  if (!runtime) {
    const initial = await captureRuntimeKeys(context.settings ?? defaultRuntimeAiSettings(env), context.teacherId, env);
    const captured = await db.rpc("capture_attempt_ai_settings", { p_attempt_id: attemptId, p_teacher_id: context.teacherId, p_settings: toJson(initial) });
    if (captured.error || !captured.data) throw new HttpError(503, "Could not preserve assessment AI settings");
    runtime = captured.data as unknown as StoredAiSettings;
  }
  const resolved = await runtimeAiEnv(runtime, context.teacherId, env);
  if (!options.currentSimulationModels || !context.settings) return resolved;
  return { ...resolved, AI_SETTINGS: { ...runtime,
    codeModels: context.settings.codeModels,
    defaultSimulationModelId: context.settings.defaultSimulationModelId,
    forceDefaultSimulationModel: context.settings.forceDefaultSimulationModel,
    roleModels: { ...runtime.roleModels, simulationHtml: context.settings.roleModels.simulationHtml }
  } };
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
