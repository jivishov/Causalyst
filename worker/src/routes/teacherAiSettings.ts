import { AI_PROVIDERS, type AiProvider, type TeacherAiSettings } from "@alt-assessment/shared";
import type { AppDatabaseClient } from "../lib/database";
import { toJson } from "../lib/database";
import type { Env } from "../lib/env";
import { HttpError, readJson } from "../lib/http";
import { captureRuntimeKeys, defaultAiSettings, defaultRuntimeAiSettings, loadTeacherAiSettings, PROVIDER_ENV, publicAiSettings, record, runtimeAiEnv, validateAiModelSettings } from "../lib/aiSettings";
import { encryptProviderSecret } from "../lib/providerSecrets";
import { openaiClient } from "../lib/openai";
import { getSimulationCodeModel } from "../lib/models";
import { requireTeacherProfile } from "./teacher";

export async function getTeacherAiSettings(db: AppDatabaseClient, env: Env, userId: string): Promise<TeacherAiSettings> {
  await requireTeacherProfile(db, userId);
  return publicAiSettings(await loadTeacherAiSettings(db, userId), env);
}

export async function updateTeacherAiSettings(request: Request, db: AppDatabaseClient, env: Env, userId: string): Promise<TeacherAiSettings> {
  await requireTeacherProfile(db, userId);
  const body = record(await readJson<unknown>(request));
  const existing = await loadTeacherAiSettings(db, userId);
  if (body.updatedAt !== existing.updatedAt) throw new HttpError(409, "Settings changed in another tab. Reload before saving.");
  const previous = existing.settings ?? defaultAiSettings(env);
  const settings = validateAiModelSettings(body, previous);
  if (body.apiKeys !== undefined) {
    const keys = record(body.apiKeys);
    if (Object.keys(keys).some(key => !AI_PROVIDERS.includes(key as AiProvider))) throw new HttpError(400, "Unknown provider");
    settings.apiKeys = { ...settings.apiKeys };
    for (const provider of AI_PROVIDERS) {
      if (!(provider in keys)) continue;
      const value = keys[provider];
      if (value === null) { delete settings.apiKeys[provider]; continue; }
      if (typeof value !== "string" || value.trim().length < 16 || value.length > 1024 || /\s/.test(value.trim())) throw new HttpError(400, "Enter a valid API key");
      settings.apiKeys[provider] = await encryptProviderSecret(value.trim(), `${userId}:${provider}`, env);
    }
  }
  for (const model of settings.codeModels) {
    if (model.enabled && !settings.apiKeys[model.provider] && !env[PROVIDER_ENV[model.provider]]) throw new HttpError(400, `Add a ${model.provider} key before enabling its student models`);
  }
  if (!settings.apiKeys.openai && !env.OPENAI_API_KEY) throw new HttpError(400, "Add an OpenAI key for assessment grading and sketches");
  const { error } = await db.rpc("set_teacher_ai_settings", {
    p_teacher_id: userId, p_settings: toJson(settings),
    p_previous_runtime: toJson(await captureRuntimeKeys(existing.settings ?? defaultRuntimeAiSettings(env), userId, env)),
    p_expected_updated_at: existing.updatedAt
  });
  if (error?.code === "40001") throw new HttpError(409, "Settings changed in another tab. Reload before saving.");
  if (error) throw new HttpError(503, "Could not save AI settings");
  return publicAiSettings(await loadTeacherAiSettings(db, userId), env);
}

// Synthetic content only. Errors are reduced to an HTTP status; SDK error
// objects, request headers, and credentials never enter logs or responses.
export async function testTeacherAiSettings(request: Request, db: AppDatabaseClient, env: Env, userId: string) {
  await requireTeacherProfile(db, userId);
  const body = record(await readJson<unknown>(request));
  const provider = body.provider;
  if (!AI_PROVIDERS.includes(provider as AiProvider)) throw new HttpError(400, "Select a provider");
  const selectedProvider = provider as AiProvider;
  const saved = await loadTeacherAiSettings(db, userId);
  const settings = body.roleModels ? validateAiModelSettings(body, saved.settings ?? defaultAiSettings(env)) : saved.settings ?? defaultAiSettings(env);
  const runtime = await runtimeAiEnv(await captureRuntimeKeys(settings, userId, env), userId, env);
  const apiKey = typeof body.apiKey === "string" && body.apiKey.trim() ? body.apiKey.trim() : runtime[PROVIDER_ENV[selectedProvider]];
  if (!apiKey || apiKey.length > 1024 || /\s/.test(apiKey)) throw new HttpError(400, "No valid key is configured for this provider");
  const codeModel = settings.codeModels.find(model => model.provider === selectedProvider && model.enabled)
    ?? settings.codeModels.find(model => model.provider === selectedProvider)!;
  if (selectedProvider !== "openai" && !codeModel) throw new HttpError(400, "Add a text model for this provider before testing its key");
  const model = selectedProvider === "openai" ? settings.roleModels.grading : { id: codeModel.modelId, reasoningEffort: codeModel.reasoningEffort };
  const client = openaiClient(apiKey, selectedProvider === "openai" ? undefined : getSimulationCodeModel(codeModel.id).baseURL);
  try {
    if (selectedProvider === "openai") {
      const response = await client.responses.create({ model: model.id, store: false, input: "Reply with the single word OK.", max_output_tokens: 2048,
        reasoning: model.reasoningEffort === "none" ? undefined : { effort: model.reasoningEffort } }, { timeout: 60000, maxRetries: 0 });
      if (response.status !== "completed" || response.output_text?.trim() !== "OK") throw new HttpError(502, "The synthetic model check did not complete. Saved settings were not changed.");
    } else {
      const response = await client.chat.completions.create({ model: model.id, max_tokens: 256, messages: [{ role: "user", content: "Reply with the single word OK." }] }, { timeout: 60000, maxRetries: 0 });
      if (!response.choices[0]?.message.content?.trim()) throw new HttpError(502, "The synthetic model check returned no text. Saved settings were not changed.");
    }
    return { ok: true, provider: selectedProvider, model: model.id, message: "Key and text inference verified with synthetic content. Image, file, and live voice permissions are not covered by this check." };
  } catch (error) {
    if (error instanceof HttpError) throw error;
    const status = error && typeof error === "object" && "status" in error && Number.isInteger(error.status) ? Number(error.status) : null;
    return { ok: false, provider: selectedProvider, model: model.id,
      message: status ? `Provider check failed (HTTP ${status}). Check the key, model access, and account quota. Saved settings were not changed.` : "Provider check could not complete. Saved settings were not changed." };
  }
}
